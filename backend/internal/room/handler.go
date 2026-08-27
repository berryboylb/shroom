package room

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/webhook"
	localauth "github.com/shroom/backend/internal/auth"
)

type Handler struct {
	service *Service
}

func NewHandler(s *Service) *Handler {
	return &Handler{service: s}
}

type CreateRoomRequest struct {
	Title string `json:"title"`
}

func (h *Handler) HandleCreateRoom(w http.ResponseWriter, r *http.Request) {
	var req CreateRoomRequest
	json.NewDecoder(r.Body).Decode(&req)
	
	if req.Title == "" {
		req.Title = "Instant Meeting"
	}

	room, err := h.service.CreateRoom(r.Context(), req.Title)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(room)
}

func (h *Handler) HandleJoinRoom(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "id")
	if roomID == "" {
		http.Error(w, "Room ID required", http.StatusBadRequest)
		return
	}

	claims, ok := r.Context().Value("claims").(*localauth.Claims)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	token, err := h.service.JoinRoom(r.Context(), roomID, claims.UserID, claims.DisplayName, claims.IsGuest)
	if err != nil {
		if strings.Contains(err.Error(), "room not found") || strings.Contains(err.Error(), "room has already ended") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"livekit_token": token,
		"room_id":       roomID,
	})
}

func (h *Handler) HandleLiveKitWebhook(w http.ResponseWriter, r *http.Request) {
	authProvider := auth.NewFileBasedKeyProviderFromMap(map[string]string{
		h.service.config.LiveKit.APIKey: h.service.config.LiveKit.APISecret,
	})

	event, err := webhook.ReceiveWebhookEvent(r, authProvider)
	if err != nil {
		http.Error(w, "Invalid webhook", http.StatusUnauthorized)
		return
	}

	if event.Event == "room_finished" && event.Room != nil {
		roomID := event.Room.Name
		h.service.EndRoom(r.Context(), roomID)
	}

	w.WriteHeader(http.StatusOK)
}

// Stubs for telemetry endpoints

