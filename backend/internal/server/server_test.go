package server

import (
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

	if rr.Body.String() != "OK" {
		t.Errorf("Expected 'OK', got %s", rr.Body.String())
	}
}
