package auth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type TokenService struct {
	secret []byte
}

func NewTokenService(secret string) *TokenService {
	return &TokenService{secret: []byte(secret)}
}

type Claims struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	IsGuest     bool   `json:"is_guest"`
	TokenType   string `json:"token_type"`
	jwt.RegisteredClaims
}

func (s *TokenService) GenerateGuestToken(displayName string) (string, error) {
	return s.generateToken(uuid.NewString(), displayName, "access", 15*time.Minute)
}

func (s *TokenService) GenerateGuestSession(displayName string) (accessToken string, refreshToken string, err error) {
	userID := uuid.NewString()
	accessToken, err = s.generateToken(userID, displayName, "access", 15*time.Minute)
	if err != nil {
		return "", "", err
	}
	refreshToken, err = s.generateToken(userID, displayName, "refresh", 24*time.Hour)
	return accessToken, refreshToken, err
}

func (s *TokenService) RefreshAccessToken(refreshToken string) (string, error) {
	claims, err := s.ValidateToken(refreshToken)
	if err != nil || claims.TokenType != "refresh" {
		return "", jwt.ErrTokenInvalidClaims
	}
	return s.generateToken(claims.UserID, claims.DisplayName, "access", 15*time.Minute)
}

func (s *TokenService) generateToken(userID, displayName, tokenType string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:      userID,
		DisplayName: displayName,
		IsGuest:     true,
		TokenType:   tokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "shroom",
			Subject:   userID,
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secret)
}

func (s *TokenService) ValidateToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		return s.secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer("shroom"))

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}
	return nil, jwt.ErrSignatureInvalid
}
