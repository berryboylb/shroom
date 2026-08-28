package auth

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type Handler struct {
	tokenService *TokenService
}

func NewHandler(ts *TokenService) *Handler {
	return &Handler{tokenService: ts}
}

type GuestLoginRequest struct {
	DisplayName string `json:"display_name"`
}

type LoginResponse struct {
	AccessToken string `json:"access_token"`
}

// stripHTMLTags removes any HTML tags from a string to prevent XSS
var htmlTagRegex = regexp.MustCompile(`<[^>]*>`)

func sanitizeDisplayName(name string) string {
	name = htmlTagRegex.ReplaceAllString(name, "")
	name = strings.TrimSpace(name)
	if len(name) > 50 {
		name = name[:50]
	}
	return name
}

func (h *Handler) HandleGuestLogin(w http.ResponseWriter, r *http.Request) {
	var req GuestLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.DisplayName = sanitizeDisplayName(req.DisplayName)
	if req.DisplayName == "" {
		http.Error(w, "Display name required", http.StatusBadRequest)
		return
	}

	token, err := h.tokenService.GenerateGuestToken(req.DisplayName)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "refresh_token",
		Value:    token,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		Path:     "/",
		Expires:  time.Now().Add(24 * time.Hour),
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(LoginResponse{AccessToken: token})
}
