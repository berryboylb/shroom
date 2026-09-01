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
	DisplayName string `json:"display_name"`
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

	accessToken, refreshToken, err := h.tokenService.GenerateGuestSession(req.DisplayName)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	setRefreshCookie(w, r, refreshToken, time.Now().Add(24*time.Hour))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(LoginResponse{AccessToken: accessToken, DisplayName: req.DisplayName})
}

func (h *Handler) HandleRefresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("refresh_token")
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	claims, validationErr := h.tokenService.ValidateToken(cookie.Value)
	accessToken, err := h.tokenService.RefreshAccessToken(cookie.Value)
	if validationErr != nil || err != nil {
		setRefreshCookie(w, r, "", time.Unix(0, 0))
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(LoginResponse{AccessToken: accessToken, DisplayName: claims.DisplayName})
}

func (h *Handler) HandleLogout(w http.ResponseWriter, r *http.Request) {
	setRefreshCookie(w, r, "", time.Unix(0, 0))
	w.WriteHeader(http.StatusNoContent)
}

func setRefreshCookie(w http.ResponseWriter, r *http.Request, value string, expires time.Time) {
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     "refresh_token",
		Value:    value,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		Path:     "/",
		Expires:  expires,
		MaxAge: func() int {
			if value == "" {
				return -1
			}
			return int(time.Until(expires).Seconds())
		}(),
	})
}
