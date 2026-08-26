package middleware

import (
	"log/slog"
	"net/http"
	"time"
)

// Logging middleware logs the incoming HTTP request and its duration.
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		// Simple implementation; could wrap ResponseWriter to capture status code
		next.ServeHTTP(w, r)
		slog.Info("Request",
			"method", r.Method,
			"path", r.URL.Path,
			"remote_addr", r.RemoteAddr,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}
