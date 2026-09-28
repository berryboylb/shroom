package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type Handler struct {
	tokenService   *TokenService
	accounts       AccountStore
	googleVerifier GoogleIdentityVerifier
	googleClientID string
}

func NewHandler(ts *TokenService) *Handler {
	return &Handler{tokenService: ts}
}

func NewGoogleHandler(ts *TokenService, accounts AccountStore, verifier GoogleIdentityVerifier, clientID string) *Handler {
	return &Handler{
		tokenService:   ts,
		accounts:       accounts,
		googleVerifier: verifier,
		googleClientID: strings.TrimSpace(clientID),
	}
}

type GuestLoginRequest struct {
	DisplayName string `json:"display_name"`
}

type LoginResponse struct {
	AccessToken string `json:"access_token"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email,omitempty"`
	AvatarURL   string `json:"avatar_url,omitempty"`
	IsGuest     bool   `json:"is_guest"`
}

type GoogleLoginRequest struct {
	Credential string `json:"credential"`
}

const (
	refreshCookieName  = "refresh_token"
	googleNonceCookie  = "google_login_nonce"
	accountTokenPrefix = "acct_"
	accountSessionTTL  = 30 * 24 * time.Hour
)

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
	json.NewEncoder(w).Encode(LoginResponse{AccessToken: accessToken, DisplayName: req.DisplayName, IsGuest: true})
}

func (h *Handler) HandleAuthConfig(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"google_enabled":   h.googleClientID != "",
		"google_client_id": h.googleClientID,
	})
}

func (h *Handler) HandleGoogleNonce(w http.ResponseWriter, r *http.Request) {
	if h.googleClientID == "" {
		http.Error(w, "Google login is not configured", http.StatusServiceUnavailable)
		return
	}
	nonce, err := randomToken(32)
	if err != nil {
		http.Error(w, "Unable to start Google login", http.StatusInternalServerError)
		return
	}
	setPrivateCookie(w, r, googleNonceCookie, nonce, time.Now().Add(10*time.Minute))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"nonce": nonce})
}

func (h *Handler) HandleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if h.googleClientID == "" || h.googleVerifier == nil || h.accounts == nil {
		http.Error(w, "Google login is not configured", http.StatusServiceUnavailable)
		return
	}
	var req GoogleLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Credential) == "" {
		http.Error(w, "Google credential required", http.StatusBadRequest)
		return
	}
	nonceCookie, err := r.Cookie(googleNonceCookie)
	if err != nil || nonceCookie.Value == "" {
		http.Error(w, "Google login session expired", http.StatusUnauthorized)
		return
	}
	setPrivateCookie(w, r, googleNonceCookie, "", time.Unix(0, 0))

	identity, err := h.googleVerifier.Verify(r.Context(), req.Credential, h.googleClientID, nonceCookie.Value)
	if err != nil {
		http.Error(w, "Invalid Google credential", http.StatusUnauthorized)
		return
	}
	account, err := h.accounts.UpsertGoogleAccount(r.Context(), *identity)
	if err != nil {
		http.Error(w, "Unable to sign in with Google", http.StatusServiceUnavailable)
		return
	}
	accessToken, err := h.tokenService.GenerateAccountAccessToken(account.ID, account.DisplayName)
	if err != nil {
		http.Error(w, "Unable to create session", http.StatusInternalServerError)
		return
	}
	rawRefresh, err := randomToken(32)
	if err != nil {
		http.Error(w, "Unable to create session", http.StatusInternalServerError)
		return
	}
	expiresAt := time.Now().Add(accountSessionTTL)
	if err := h.accounts.CreateRefreshSession(r.Context(), account.ID, hashToken(rawRefresh), expiresAt); err != nil {
		http.Error(w, "Unable to create session", http.StatusServiceUnavailable)
		return
	}
	setRefreshCookie(w, r, accountTokenPrefix+rawRefresh, expiresAt)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(loginResponse(accessToken, account, false))
}

func (h *Handler) HandleRefresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(refreshCookieName)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if strings.HasPrefix(cookie.Value, accountTokenPrefix) {
		h.handleAccountRefresh(w, r, strings.TrimPrefix(cookie.Value, accountTokenPrefix))
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
	json.NewEncoder(w).Encode(LoginResponse{AccessToken: accessToken, DisplayName: claims.DisplayName, IsGuest: true})
}

func (h *Handler) handleAccountRefresh(w http.ResponseWriter, r *http.Request, oldToken string) {
	if h.accounts == nil || oldToken == "" {
		setRefreshCookie(w, r, "", time.Unix(0, 0))
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	newToken, err := randomToken(32)
	if err != nil {
		http.Error(w, "Unable to refresh session", http.StatusInternalServerError)
		return
	}
	expiresAt := time.Now().Add(accountSessionTTL)
	account, err := h.accounts.RotateRefreshSession(r.Context(), hashToken(oldToken), hashToken(newToken), expiresAt)
	if err != nil {
		if errors.Is(err, ErrInvalidRefreshSession) {
			setRefreshCookie(w, r, "", time.Unix(0, 0))
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
		} else {
			http.Error(w, "Unable to refresh session", http.StatusServiceUnavailable)
		}
		return
	}
	accessToken, err := h.tokenService.GenerateAccountAccessToken(account.ID, account.DisplayName)
	if err != nil {
		http.Error(w, "Unable to refresh session", http.StatusInternalServerError)
		return
	}
	setRefreshCookie(w, r, accountTokenPrefix+newToken, expiresAt)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(loginResponse(accessToken, account, false))
}

func (h *Handler) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(refreshCookieName); err == nil && strings.HasPrefix(cookie.Value, accountTokenPrefix) && h.accounts != nil {
		_ = h.accounts.RevokeRefreshSession(r.Context(), hashToken(strings.TrimPrefix(cookie.Value, accountTokenPrefix)))
	}
	setRefreshCookie(w, r, "", time.Unix(0, 0))
	w.WriteHeader(http.StatusNoContent)
}

func setRefreshCookie(w http.ResponseWriter, r *http.Request, value string, expires time.Time) {
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
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

func setPrivateCookie(w http.ResponseWriter, r *http.Request, name, value string, expires time.Time) {
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     name,
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

func randomToken(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func loginResponse(accessToken string, account *Account, isGuest bool) LoginResponse {
	if account == nil {
		return LoginResponse{AccessToken: accessToken, IsGuest: isGuest}
	}
	return LoginResponse{
		AccessToken: accessToken,
		DisplayName: account.DisplayName,
		Email:       account.Email,
		AvatarURL:   account.AvatarURL,
		IsGuest:     isGuest,
	}
}
