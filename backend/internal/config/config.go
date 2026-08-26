package config

import (
	"fmt"

	"github.com/joho/godotenv"
	"github.com/kelseyhightower/envconfig"
)

type ServerConfig struct {
	Port               string   `envconfig:"PORT" default:"8080"`
	JWTSecret          string   `envconfig:"JWT_SECRET" required:"true"`
	CORSAllowedOrigins []string `envconfig:"CORS_ALLOWED_ORIGINS" default:"http://localhost:5173"`
}

type DatabaseConfig struct {
	URL string `envconfig:"DATABASE_URL" required:"true"`
}

type RedisConfig struct {
	URL string `envconfig:"REDIS_URL" required:"true"`
}

type LiveKitConfig struct {
	URL       string `envconfig:"LIVEKIT_URL" required:"true"`
	APIKey    string `envconfig:"LIVEKIT_API_KEY" required:"true"`
	APISecret string `envconfig:"LIVEKIT_API_SECRET" required:"true"`
}

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Redis    RedisConfig
	LiveKit  LiveKitConfig
}

// Load reads .env if present and populates the Config struct via env vars.
func Load() (*Config, error) {
	_ = godotenv.Load("../.env") // Try to load .env from repo root if running locally
	_ = godotenv.Load()             // Also try current directory

	var cfg Config
	if err := envconfig.Process("", &cfg); err != nil {
		return nil, fmt.Errorf("failed to process env vars: %w", err)
	}

	return &cfg, nil
}
