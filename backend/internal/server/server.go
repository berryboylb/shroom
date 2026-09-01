package server

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"runtime"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/shroom/backend/internal/auth"
	"github.com/shroom/backend/internal/config"
	"github.com/shroom/backend/internal/db"
	customMiddleware "github.com/shroom/backend/internal/middleware"
	"github.com/shroom/backend/internal/redis"
	"github.com/shroom/backend/internal/room"
	"github.com/shroom/backend/internal/ws"
)

type Server struct {
	router *chi.Mux
	config *config.Config
	srv    *http.Server
	db     *db.DB
	redis  *redis.Client
	hub    *ws.Hub
}

func (s *Server) Router() *chi.Mux {
	return s.router
}

func New(cfg *config.Config) *Server {
	dbConn, err := db.Connect(context.Background(), cfg.Database.URL)
	if err == nil {
		go dbConn.MaintainPartitions(context.Background())
	}
	if err != nil {
		slog.Error("Database connection failed", "error", err)
	}

	redisClient, err := redis.Connect(context.Background(), cfg.Redis.URL)
	if err != nil {
		slog.Error("Redis connection failed", "error", err)
	}

	r := chi.NewRouter()

	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(middleware.CleanPath)
	r.Use(middleware.NoCache)
	r.Use(customMiddleware.SecurityHeaders)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.Server.CORSAllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Use(httprate.LimitByIP(100, 1*time.Second))

	r.Use(customMiddleware.Logging)
	r.Use(customMiddleware.Metrics)

	tokenService := auth.NewTokenService(cfg.Server.JWTSecret)
	authHandler := auth.NewHandler(tokenService)
	roomRepo := room.NewRepository(dbConn)
	roomService := room.NewService(roomRepo, cfg)
	roomHandler := room.NewHandler(roomService)

	hub := ws.NewHub(redisClient.Raw())
	go hub.Run()
	wsHandler := ws.NewHandler(hub, tokenService, cfg.Server.CORSAllowedOrigins)

	// Global request body size limit: 8KB max to prevent memory bomb attacks (M4)
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
			}
			next.ServeHTTP(w, r)
		})
	})

	healthHandler := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}
	r.Get("/health", healthHandler)
	r.Get("/api/health", healthHandler)
	r.Get("/api/health/ready", sReadinessHandler(dbConn, redisClient, cfg.LiveKit.URL))

	r.With(httprate.LimitByIP(10, 1*time.Minute)).Post("/api/auth/guest", authHandler.HandleGuestLogin)
	r.With(httprate.LimitByIP(30, 1*time.Minute)).Post("/api/auth/refresh", authHandler.HandleRefresh)
	r.Post("/api/auth/logout", authHandler.HandleLogout)

	r.Get("/ws", wsHandler.ServeWS)
	r.Post("/api/webhooks/livekit", roomHandler.HandleLiveKitWebhook)

	r.Group(func(r chi.Router) {
		r.Use(auth.AuthMiddleware(tokenService))
		r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/api/rooms", roomHandler.HandleCreateRoom)
		r.Post("/api/rooms/{id}/join", roomHandler.HandleJoinRoom)
		r.Post("/api/telemetry", roomHandler.HandleTelemetry)
		r.Get("/api/diagnostics", roomHandler.HandleDiagnostics)
		r.Get("/api/admin/telemetry", roomHandler.HandleRecentTelemetry)

		// Admin metrics — now behind JWT auth (C1)
		r.Get("/api/admin/metrics", func(w http.ResponseWriter, r *http.Request) {
			var memStats runtime.MemStats
			runtime.ReadMemStats(&memStats)

			var activeRooms int
			if dbConn != nil {
				dbConn.Pool.QueryRow(context.Background(), "SELECT count(*) FROM rooms WHERE status = 'active'").Scan(&activeRooms)
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"memory_alloc_mb":   memStats.Alloc / 1024 / 1024,
				"memory_sys_mb":     memStats.Sys / 1024 / 1024,
				"memory_budget_mb":  600,
				"goroutines":        runtime.NumGoroutine(),
				"active_rooms":      activeRooms,
				"total_http_reqs":   customMiddleware.GlobalMetrics.TotalRequests,
				"total_http_errs":   customMiddleware.GlobalMetrics.TotalErrors,
				"active_ws_clients": hub.GetActiveClientCount(),
				"uptime_seconds":    time.Since(customMiddleware.StartTime).Seconds(),
			})
		})
	})

	return &Server{
		router: r,
		config: cfg,
		db:     dbConn,
		redis:  redisClient,
		hub:    hub,
	}
}

func sReadinessHandler(dbConn *db.DB, redisClient *redis.Client, liveKitURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		components := map[string]string{"database": "error", "redis": "error", "livekit": "error"}
		if dbConn != nil && dbConn.Pool.Ping(ctx) == nil {
			components["database"] = "ok"
		}
		if redisClient != nil && redisClient.Raw().Ping(ctx).Err() == nil {
			components["redis"] = "ok"
		}

		probeURL := strings.Replace(strings.Replace(liveKitURL, "wss://", "https://", 1), "ws://", "http://", 1)
		if probeURL != "" {
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, probeURL, nil)
			if response, err := http.DefaultClient.Do(req); err == nil {
				components["livekit"] = "ok"
				response.Body.Close()
			}
		}

		status := "ready"
		code := http.StatusOK
		for _, component := range components {
			if component != "ok" {
				status, code = "error", http.StatusServiceUnavailable
				break
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		json.NewEncoder(w).Encode(map[string]any{"status": status, "components": components})
	}
}

func (s *Server) Start() error {
	s.srv = &http.Server{
		Addr:    ":" + s.config.Server.Port,
		Handler: s.router,
	}
	slog.Info("Starting server", "addr", s.srv.Addr)
	if err := s.srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (s *Server) Stop(ctx context.Context) error {
	slog.Info("Shutting down server gracefully")
	if s.db != nil {
		s.db.Close()
	}
	if s.redis != nil {
		s.redis.Close()
	}
	if s.srv != nil {
		return s.srv.Shutdown(ctx)
	}
	return nil
}
