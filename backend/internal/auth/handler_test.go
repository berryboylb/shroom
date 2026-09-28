package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeGoogleVerifier struct {
	identity *GoogleIdentity
	err      error
	nonce    string
}

func (f *fakeGoogleVerifier) Verify(_ context.Context, _, _, nonce string) (*GoogleIdentity, error) {
	f.nonce = nonce
	return f.identity, f.err
}

type fakeAccountStore struct {
	account     *Account
	createdHash string
	rotatedFrom string
	rotatedTo   string
	revokedHash string
}

func (f *fakeAccountStore) UpsertGoogleAccount(context.Context, GoogleIdentity) (*Account, error) {
	if f.account == nil {
		return nil, errors.New("missing test account")
	}
	return f.account, nil
}

func (f *fakeAccountStore) CreateRefreshSession(_ context.Context, _ string, tokenHash string, _ time.Time) error {
	f.createdHash = tokenHash
	return nil
}

func (f *fakeAccountStore) RotateRefreshSession(_ context.Context, oldHash, newHash string, _ time.Time) (*Account, error) {
	f.rotatedFrom, f.rotatedTo = oldHash, newHash
	return f.account, nil
}

func (f *fakeAccountStore) RevokeRefreshSession(_ context.Context, tokenHash string) error {
	f.revokedHash = tokenHash
	return nil
}

func TestHandleGuestLogin_UnhappyPaths(t *testing.T) {
	ts := NewTokenService("test_secret")
	handler := NewHandler(ts)

	tests := []struct {
		name           string
		payload        interface{}
		expectedStatus int
	}{
		{
			name:           "Empty Request Body",
			payload:        nil,
			expectedStatus: http.StatusBadRequest,
		},
		{
			name: "Missing Display Name",
			payload: GuestLoginRequest{
				DisplayName: "",
			},
			expectedStatus: http.StatusBadRequest,
		},
		{
			name: "Valid Request",
			payload: GuestLoginRequest{
				DisplayName: "Tester",
			},
			expectedStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var body []byte
			if tt.payload != nil {
				body, _ = json.Marshal(tt.payload)
			}

			req := httptest.NewRequest(http.MethodPost, "/api/auth/guest", bytes.NewReader(body))
			w := httptest.NewRecorder()

			handler.HandleGuestLogin(w, req)

			if w.Code != tt.expectedStatus {
				t.Errorf("expected status %d, got %d", tt.expectedStatus, w.Code)
			}
		})
	}
}

func TestGuestSessionSeparatesAccessAndRefreshTokens(t *testing.T) {
	service := NewTokenService("test_secret")
	access, refresh, err := service.GenerateGuestSession("Tester")
	if err != nil {
		t.Fatal(err)
	}
	accessClaims, err := service.ValidateToken(access)
	if err != nil || accessClaims.TokenType != "access" {
		t.Fatalf("expected access token, got %#v, %v", accessClaims, err)
	}
	refreshClaims, err := service.ValidateToken(refresh)
	if err != nil || refreshClaims.TokenType != "refresh" {
		t.Fatalf("expected refresh token, got %#v, %v", refreshClaims, err)
	}
	if accessClaims.UserID != refreshClaims.UserID {
		t.Fatal("session tokens must preserve the same guest identity")
	}
	rotated, err := service.RefreshAccessToken(refresh)
	if err != nil {
		t.Fatal(err)
	}
	rotatedClaims, _ := service.ValidateToken(rotated)
	if rotatedClaims.TokenType != "access" || rotatedClaims.UserID != accessClaims.UserID {
		t.Fatal("refresh must issue access token for the same identity")
	}
	if _, err := service.RefreshAccessToken(access); err == nil {
		t.Fatal("access token must never be accepted as a refresh token")
	}
}

func TestRefreshHandlerRequiresHttpOnlyCookie(t *testing.T) {
	service := NewTokenService("test_secret")
	handler := NewHandler(service)

	missing := httptest.NewRecorder()
	handler.HandleRefresh(missing, httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil))
	if missing.Code != http.StatusUnauthorized {
		t.Fatalf("expected missing cookie to be unauthorized, got %d", missing.Code)
	}

	_, refresh, _ := service.GenerateGuestSession("Tester")
	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: "refresh_token", Value: refresh})
	response := httptest.NewRecorder()
	handler.HandleRefresh(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("expected refresh success, got %d", response.Code)
	}
}

func TestGoogleLoginCreatesPersistentAccountSession(t *testing.T) {
	service := NewTokenService("test_secret")
	store := &fakeAccountStore{account: &Account{
		ID: "8c39a697-c48c-4ae7-abf8-ccf0b044d50d", Email: "alice@example.com", DisplayName: "Alice", AvatarURL: "https://example.com/alice.jpg",
	}}
	verifier := &fakeGoogleVerifier{identity: &GoogleIdentity{
		Subject: "google-123", Email: "alice@example.com", DisplayName: "Alice",
	}}
	handler := NewGoogleHandler(service, store, verifier, "client-id.apps.googleusercontent.com")

	nonceResponse := httptest.NewRecorder()
	handler.HandleGoogleNonce(nonceResponse, httptest.NewRequest(http.MethodGet, "/api/auth/google/nonce", nil))
	if nonceResponse.Code != http.StatusOK {
		t.Fatalf("expected nonce request to succeed, got %d", nonceResponse.Code)
	}
	var nonceCookie *http.Cookie
	for _, cookie := range nonceResponse.Result().Cookies() {
		if cookie.Name == googleNonceCookie {
			nonceCookie = cookie
		}
	}
	if nonceCookie == nil || nonceCookie.Value == "" || !nonceCookie.HttpOnly {
		t.Fatal("expected an HttpOnly Google login nonce cookie")
	}

	loginRequest := httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"credential":"google-id-token"}`))
	loginRequest.AddCookie(nonceCookie)
	loginResponseRecorder := httptest.NewRecorder()
	handler.HandleGoogleLogin(loginResponseRecorder, loginRequest)
	if loginResponseRecorder.Code != http.StatusOK {
		t.Fatalf("expected Google login to succeed, got %d: %s", loginResponseRecorder.Code, loginResponseRecorder.Body.String())
	}
	if verifier.nonce != nonceCookie.Value {
		t.Fatal("expected the nonce cookie to be verified with the Google credential")
	}

	var response LoginResponse
	if err := json.NewDecoder(loginResponseRecorder.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	claims, err := service.ValidateToken(response.AccessToken)
	if err != nil || claims.IsGuest || claims.UserID != store.account.ID {
		t.Fatalf("expected a non-guest account access token, got %#v, %v", claims, err)
	}
	var refreshCookie *http.Cookie
	for _, cookie := range loginResponseRecorder.Result().Cookies() {
		if cookie.Name == refreshCookieName && strings.HasPrefix(cookie.Value, accountTokenPrefix) {
			refreshCookie = cookie
		}
	}
	if refreshCookie == nil || !refreshCookie.HttpOnly || refreshCookie.MaxAge < int((29*24*time.Hour).Seconds()) {
		t.Fatal("expected a persistent HttpOnly account refresh cookie")
	}
	rawToken := strings.TrimPrefix(refreshCookie.Value, accountTokenPrefix)
	if store.createdHash != hashToken(rawToken) || store.createdHash == rawToken {
		t.Fatal("expected only the refresh token hash to be stored")
	}

	refreshRequest := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	refreshRequest.AddCookie(refreshCookie)
	refreshResponse := httptest.NewRecorder()
	handler.HandleRefresh(refreshResponse, refreshRequest)
	if refreshResponse.Code != http.StatusOK || store.rotatedFrom != store.createdHash || store.rotatedTo == store.rotatedFrom {
		t.Fatal("expected account refresh tokens to rotate")
	}
	var rotatedCookie *http.Cookie
	for _, cookie := range refreshResponse.Result().Cookies() {
		if cookie.Name == refreshCookieName && strings.HasPrefix(cookie.Value, accountTokenPrefix) {
			rotatedCookie = cookie
		}
	}
	if rotatedCookie == nil || rotatedCookie.Value == refreshCookie.Value {
		t.Fatal("expected a new refresh cookie after rotation")
	}

	logoutRequest := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	logoutRequest.AddCookie(rotatedCookie)
	logoutResponse := httptest.NewRecorder()
	handler.HandleLogout(logoutResponse, logoutRequest)
	if logoutResponse.Code != http.StatusNoContent || store.revokedHash != hashToken(strings.TrimPrefix(rotatedCookie.Value, accountTokenPrefix)) {
		t.Fatal("expected logout to revoke the current account session")
	}
}

func TestGoogleLoginRequiresConfigurationAndNonce(t *testing.T) {
	service := NewTokenService("test_secret")
	disabled := NewGoogleHandler(service, nil, nil, "")
	response := httptest.NewRecorder()
	disabled.HandleGoogleNonce(response, httptest.NewRequest(http.MethodGet, "/api/auth/google/nonce", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected disabled Google login to return 503, got %d", response.Code)
	}

	configured := NewGoogleHandler(service, &fakeAccountStore{}, &fakeGoogleVerifier{}, "client-id")
	response = httptest.NewRecorder()
	configured.HandleGoogleLogin(response, httptest.NewRequest(http.MethodPost, "/api/auth/google", strings.NewReader(`{"credential":"token"}`)))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected a missing nonce to be unauthorized, got %d", response.Code)
	}
}
