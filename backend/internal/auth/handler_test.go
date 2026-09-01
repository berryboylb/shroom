package auth

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

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
