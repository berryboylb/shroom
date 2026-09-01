package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shroom/backend/internal/config"
)

func TestHealthCheck(t *testing.T) {
	cfg := &config.Config{} // dummy
	srv := New(cfg)

	req, _ := http.NewRequest("GET", "/health", nil)
	rr := httptest.NewRecorder()

	srv.router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected 200 OK, got %d", rr.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil || body["status"] != "ok" {
		t.Errorf("Expected JSON health response, got %s", rr.Body.String())
	}
}
