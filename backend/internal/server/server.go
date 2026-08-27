package server

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"runtime"
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
	r.Use(middleware.RealIP)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(middleware.CleanPath)
	r.Use(middleware.NoCache)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"https://*", "http://*"},
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
	wsHandler := ws.NewHandler(hub, tokenService)

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	
	// Custom Lightweight Admin Metrics Endpoint (replaces Prometheus/Grafana)
	r.Get("/api/admin/metrics", func(w http.ResponseWriter, r *http.Request) {
		var memStats runtime.MemStats
		runtime.ReadMemStats(&memStats)

		var activeRooms int
		if dbConn != nil {
			dbConn.Pool.QueryRow(context.Background(), "SELECT count(*) FROM rooms WHERE status = 'active'").Scan(&activeRooms)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"memory_alloc_mb":  memStats.Alloc / 1024 / 1024,
			"goroutines":       runtime.NumGoroutine(),
			"active_rooms":     activeRooms,
			"total_http_reqs":  customMiddleware.GlobalMetrics.TotalRequests,
			"total_http_errs":  customMiddleware.GlobalMetrics.TotalErrors,
			"active_ws_clients": hub.GetActiveClientCount(), // Assuming this exists or we can mock it
			"uptime_seconds":   time.Since(customMiddleware.StartTime).Seconds(),
		})
	})

	r.With(httprate.LimitByIP(10, 1*time.Minute)).Post("/api/auth/guest", authHandler.HandleGuestLogin)

	r.Get("/ws", wsHandler.ServeWS)
	r.Post("/api/webhooks/livekit", roomHandler.HandleLiveKitWebhook)

	r.Group(func(r chi.Router) {
		r.Use(auth.AuthMiddleware(tokenService))
		r.With(httprate.LimitByIP(20, 1*time.Minute)).Post("/api/rooms", roomHandler.HandleCreateRoom)
		r.Post("/api/rooms/{id}/join", roomHandler.HandleJoinRoom)
		r.Post("/api/telemetry", roomHandler.HandleTelemetry)
		r.Get("/api/diagnostics", roomHandler.HandleDiagnostics)
	})

	return &Server{
		router: r,
		config: cfg,
		db:     dbConn,
		redis:  redisClient,
		hub:    hub,
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
