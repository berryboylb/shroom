package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/shroom/backend/internal/auth"
	"github.com/shroom/backend/internal/config"
	"github.com/shroom/backend/internal/db"
	"github.com/shroom/backend/internal/middleware"
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
	r.Use(middleware.Logging)
	r.Use(middleware.Metrics) // Added Prometheus metrics tracking

	tokenService := auth.NewTokenService(cfg.Server.JWTSecret)
	authHandler := auth.NewHandler(tokenService)
	roomRepo := room.NewRepository(dbConn)
	roomService := room.NewService(roomRepo, cfg)
	roomHandler := room.NewHandler(roomService)
	
	hub := ws.NewHub(redisClient.Raw())
	go hub.Run()
	wsHandler := ws.NewHandler(hub, tokenService)

	// Phase 7 Observability: Prometheus metrics endpoint
	r.Handle("/metrics", promhttp.Handler())

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	r.Post("/api/auth/guest", authHandler.HandleGuestLogin)

	r.Get("/ws", wsHandler.ServeWS)
	r.Post("/api/webhooks/livekit", roomHandler.HandleLiveKitWebhook)

	r.Group(func(r chi.Router) {
		r.Use(auth.AuthMiddleware(tokenService))
		r.Post("/api/rooms", roomHandler.HandleCreateRoom)
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
