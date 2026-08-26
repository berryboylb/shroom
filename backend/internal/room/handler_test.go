package room

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	
	"github.com/go-chi/chi/v5"
	"github.com/shroom/backend/internal/auth"
)

func TestHandleJoinRoom_UnhappyPaths(t *testing.T) {
	// A handler with no real service just to test HTTP/middleware boundaries
	handler := NewHandler(nil)

	t.Run("Missing Claims in Context", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/rooms/123/join", nil)
		
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", "123")
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
		
		w := httptest.NewRecorder()

		handler.HandleJoinRoom(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Errorf("expected status %d for missing claims, got %d", http.StatusUnauthorized, w.Code)
		}
	})
	
	t.Run("Missing Room ID", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/rooms//join", nil)
		
		// Setup context WITH claims but missing Room ID (chi URLParam)
		claims := &auth.Claims{UserID: "123", DisplayName: "Test"}
		ctx := context.WithValue(req.Context(), "claims", claims)
		
		rctx := chi.NewRouteContext()
		req = req.WithContext(context.WithValue(ctx, chi.RouteCtxKey, rctx))
		
		w := httptest.NewRecorder()
		handler.HandleJoinRoom(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status %d for missing room ID, got %d", http.StatusBadRequest, w.Code)
		}
	})
}
