package middleware

import (
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

type MetricsStore struct {
	TotalRequests uint64 `json:"total_requests"`
	TotalErrors   uint64 `json:"total_errors"`
}

var GlobalMetrics MetricsStore
var StartTime = time.Now()

func Metrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Ignore the dashboard's own polling so it doesn't inflate traffic numbers
		if !strings.HasPrefix(r.URL.Path, "/api/admin/metrics") {
			atomic.AddUint64(&GlobalMetrics.TotalRequests, 1)
		}

		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)

		if ww.Status() >= 400 && ww.Status() != http.StatusNotFound {
			atomic.AddUint64(&GlobalMetrics.TotalErrors, 1)
		}
	})
}
