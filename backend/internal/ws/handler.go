package ws

import (
	"log/slog"
	"net/http"
	"net/url"

	"github.com/gorilla/websocket"
	"github.com/shroom/backend/internal/auth"
)

type Handler struct {
	hub            *Hub
	tokenService   *auth.TokenService
	allowedOrigins map[string]struct{}
}

func NewHandler(hub *Hub, ts *auth.TokenService, origins []string) *Handler {
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		allowed[origin] = struct{}{}
	}
	return &Handler{hub: hub, tokenService: ts, allowedOrigins: allowed}
}

func (h *Handler) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Native clients do not send Origin; JWT authentication still applies.
		return true
	}
	if _, ok := h.allowedOrigins[origin]; ok {
		return true
	}
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Host == r.Host
}

func (h *Handler) ServeWS(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     h.checkOrigin,
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("Failed to upgrade WS", "error", err)
		return
	}

	// ADR-008: Auth happens via payload after connection, so we don't block here.
	client := &Client{
		hub:          h.hub,
		conn:         conn,
		send:         make(chan []byte, 256),
		tokenService: h.tokenService,
	}

	// Register will happen in the hub, but we don't consider them "active" until they authenticate.
	// For simplicity, we register them, but they must send ws:authenticate.
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}
