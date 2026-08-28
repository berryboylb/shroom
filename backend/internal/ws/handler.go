package ws

import (
	"log/slog"
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/shroom/backend/internal/auth"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		// Allow production domain and local development
		return origin == "https://shroom.agentiq.build" ||
			origin == "http://localhost:5173" ||
			origin == "http://localhost:3000"
	},
}

type Handler struct {
	hub          *Hub
	tokenService *auth.TokenService
}

func NewHandler(hub *Hub, ts *auth.TokenService) *Handler {
	return &Handler{hub: hub, tokenService: ts}
}

func (h *Handler) ServeWS(w http.ResponseWriter, r *http.Request) {
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
