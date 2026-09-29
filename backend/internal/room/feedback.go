package room

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	localauth "github.com/shroom/backend/internal/auth"
)

type Feedback struct {
	Rating string `json:"rating"`
	Issue  string `json:"issue"`
	Note   string `json:"note"`
}

var feedbackIssues = map[string]bool{
	"audio": true, "video": true, "joining": true, "chat": true,
	"controls": true, "connection": true, "other": true,
}

func (h *Handler) HandleFeedback(w http.ResponseWriter, r *http.Request) {
	claims, ok := localauth.GetClaims(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	roomID := chi.URLParam(r, "id")
	if roomID == "" || len(roomID) > 20 {
		http.Error(w, "Invalid room", http.StatusBadRequest)
		return
	}
	var feedback Feedback
	if json.NewDecoder(r.Body).Decode(&feedback) != nil {
		http.Error(w, "Invalid feedback", http.StatusBadRequest)
		return
	}
	feedback.Note = strings.TrimSpace(feedback.Note)
	if (feedback.Rating != "good" && feedback.Rating != "problem") ||
		(feedback.Rating == "problem" && !feedbackIssues[feedback.Issue]) ||
		(feedback.Rating == "good" && feedback.Issue != "") ||
		utf8.RuneCountInString(feedback.Note) > 500 {
		http.Error(w, "Invalid feedback", http.StatusBadRequest)
		return
	}
	if h.service == nil || h.service.repo == nil || h.service.repo.SaveFeedback(r.Context(), roomID, claims.UserID, feedback) != nil {
		http.Error(w, "Could not save feedback", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
