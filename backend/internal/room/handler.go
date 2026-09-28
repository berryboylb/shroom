package room

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/webhook"
	localauth "github.com/shroom/backend/internal/auth"
)

type Handler struct {
	service   *Service
	telemetry *TelemetryStore
}

func NewHandler(s *Service) *Handler {
	return &Handler{service: s, telemetry: NewTelemetryStore(500)}
}

type CreateRoomRequest struct {
	Title            string `json:"title"`
	ApprovalRequired bool   `json:"approval_required"`
}

func (h *Handler) HandleCreateRoom(w http.ResponseWriter, r *http.Request) {
	var req CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Title == "" {
		req.Title = "Instant Meeting"
	}

	claims, ok := localauth.GetClaims(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	room, err := h.service.CreateRoom(r.Context(), req.Title, claims.UserID, req.ApprovalRequired)
	if err != nil {
		if errors.Is(err, ErrStorageUnavailable) {
			http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "Unable to create room", http.StatusInternalServerError)
		}
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

	claims, ok := localauth.GetClaims(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	join, err := h.service.JoinRoom(r.Context(), roomID, claims.UserID, claims.DisplayName, claims.IsGuest)
	if err != nil {
		if errors.Is(err, ErrWaitingApproval) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(map[string]string{"status": "pending", "room_id": roomID})
			return
		}
		if errors.Is(err, ErrJoinDenied) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"message": "Host declined your request"})
			return
		}
		if errors.Is(err, ErrStorageUnavailable) {
			http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		// Generic error to prevent room ID enumeration (M1)
		http.Error(w, "Unable to join room", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"livekit_token":     join.Token,
		"room_id":           roomID,
		"is_host":           join.IsHost,
		"approval_required": join.ApprovalRequired,
	})
}

func (h *Handler) HandlePendingJoins(w http.ResponseWriter, r *http.Request) {
	claims, ok := localauth.GetClaims(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	requests, err := h.service.PendingJoins(r.Context(), chi.URLParam(r, "id"), claims.UserID)
	if err != nil {
		if errors.Is(err, ErrNotHost) {
			http.Error(w, "Forbidden", http.StatusForbidden)
		} else {
			http.Error(w, "Unable to load requests", http.StatusServiceUnavailable)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(requests)
}

func (h *Handler) HandleDecideJoin(w http.ResponseWriter, r *http.Request) {
	claims, ok := localauth.GetClaims(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var body struct {
		ParticipantID string `json:"participant_id"`
		Approve       bool   `json:"approve"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || body.ParticipantID == "" {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	decided, err := h.service.DecideJoin(r.Context(), chi.URLParam(r, "id"), claims.UserID, body.ParticipantID, body.Approve)
	if err != nil {
		if errors.Is(err, ErrNotHost) {
			http.Error(w, "Forbidden", http.StatusForbidden)
		} else {
			http.Error(w, "Unable to decide request", http.StatusServiceUnavailable)
		}
		return
	}
	if !decided {
		http.Error(w, "Request no longer pending", http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) HandleCancelJoin(w http.ResponseWriter, r *http.Request) {
	claims, ok := localauth.GetClaims(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if err := h.service.CancelJoin(r.Context(), chi.URLParam(r, "id"), claims.UserID); err != nil {
		http.Error(w, "Unable to cancel request", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
