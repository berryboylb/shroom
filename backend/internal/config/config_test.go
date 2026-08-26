package config

import (
	"os"
	"testing"
)

func TestLoad_Success(t *testing.T) {
	// Setup env vars
	os.Setenv("PORT", "9090")
	os.Setenv("JWT_SECRET", "test-secret")
	os.Setenv("DATABASE_URL", "postgres://test")
	os.Setenv("REDIS_URL", "redis://test")
	os.Setenv("LIVEKIT_URL", "http://test")
	os.Setenv("LIVEKIT_API_KEY", "key")
	os.Setenv("LIVEKIT_API_SECRET", "secret")
	defer os.Clearenv()

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.Server.Port != "9090" {
		t.Errorf("expected port 9090, got %s", cfg.Server.Port)
	}
}

func TestLoad_MissingRequired(t *testing.T) {
	os.Clearenv() // Ensure JWT_SECRET is missing

	_, err := Load()
	if err == nil {
		t.Fatal("expected error for missing required fields, got nil")
	}
}
