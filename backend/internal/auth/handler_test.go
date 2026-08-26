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
