package middleware

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name: "shroom_http_duration_seconds",
		Help: "Duration of HTTP requests.",
		Buckets: prometheus.DefBuckets,
	}, []string{"path", "method", "status"})
	
	httpRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "shroom_http_requests_total",
		Help: "Total number of HTTP requests.",
	}, []string{"path", "method", "status"})
)

func Metrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		
		// Use chi's WrapResponseWriter to get the status code
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		
		next.ServeHTTP(ww, r)
		
		duration := time.Since(start).Seconds()
		status := strconv.Itoa(ww.Status())
		
		// If it's a 404, we don't want metric cardinality explosion
		path := r.URL.Path
		if ww.Status() == http.StatusNotFound {
			path = "/404"
		}

		httpDuration.WithLabelValues(path, r.Method, status).Observe(duration)
		httpRequests.WithLabelValues(path, r.Method, status).Inc()
	})
}
