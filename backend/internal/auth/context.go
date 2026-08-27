package auth

import "context"

type contextKey string

const claimsKey = contextKey("claims")

// GetClaims safely extracts the JWT claims from the context
func GetClaims(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(claimsKey).(*Claims)
	return claims, ok
}
