package auth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const googleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"

type GoogleIdentity struct {
	Subject     string
	Email       string
	DisplayName string
	AvatarURL   string
}

type GoogleIdentityVerifier interface {
	Verify(context.Context, string, string, string) (*GoogleIdentity, error)
}

type googleClaims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	Nonce         string `json:"nonce"`
	jwt.RegisteredClaims
}

type googleJWK struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type googleJWKS struct {
	Keys []googleJWK `json:"keys"`
}

type GoogleVerifier struct {
	client    *http.Client
	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	expiresAt time.Time
}

func NewGoogleVerifier() *GoogleVerifier {
	return &GoogleVerifier{
		client: &http.Client{Timeout: 5 * time.Second},
		keys:   make(map[string]*rsa.PublicKey),
	}
}

func (v *GoogleVerifier) Verify(ctx context.Context, credential, audience, expectedNonce string) (*GoogleIdentity, error) {
	if credential == "" || audience == "" || expectedNonce == "" {
		return nil, errors.New("google credential is incomplete")
	}

	claims := &googleClaims{}
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithAudience(audience),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
	)
	token, err := parser.ParseWithClaims(credential, claims, func(token *jwt.Token) (interface{}, error) {
		kid, _ := token.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("google token has no key id")
		}
		return v.key(ctx, kid)
	})
	if err != nil || !token.Valid {
		return nil, errors.New("invalid google credential")
	}
	if claims.Issuer != "https://accounts.google.com" && claims.Issuer != "accounts.google.com" {
		return nil, errors.New("invalid google token issuer")
	}
	if !claims.EmailVerified || claims.Email == "" || claims.Subject == "" {
		return nil, errors.New("google email is not verified")
	}
	if claims.Nonce != expectedNonce {
		return nil, errors.New("google login nonce does not match")
	}
	displayName := sanitizeDisplayName(claims.Name)
	if displayName == "" {
		displayName = strings.Split(claims.Email, "@")[0]
	}
	return &GoogleIdentity{
		Subject:     claims.Subject,
		Email:       strings.ToLower(strings.TrimSpace(claims.Email)),
		DisplayName: displayName,
		AvatarURL:   claims.Picture,
	}, nil
}

func (v *GoogleVerifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.RLock()
	key := v.keys[kid]
	fresh := time.Now().Before(v.expiresAt)
	v.mu.RUnlock()
	if key != nil && fresh {
		return key, nil
	}
	if err := v.refreshKeys(ctx); err != nil {
		return nil, err
	}
	v.mu.RLock()
	defer v.mu.RUnlock()
	key = v.keys[kid]
	if key == nil {
		return nil, errors.New("google signing key not found")
	}
	return key, nil
}

func (v *GoogleVerifier) refreshKeys(ctx context.Context) error {
	v.mu.Lock()
	defer v.mu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, googleJWKSURL, nil)
	if err != nil {
		return err
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch google signing keys: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fetch google signing keys: status %d", resp.StatusCode)
	}

	var set googleJWKS
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 64*1024))
	if err := decoder.Decode(&set); err != nil {
		return fmt.Errorf("decode google signing keys: %w", err)
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, jwk := range set.Keys {
		if jwk.Kty != "RSA" || jwk.Alg != "RS256" || jwk.Use != "sig" {
			continue
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(jwk.N)
		if err != nil {
			continue
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
		if err != nil || len(eBytes) == 0 || len(eBytes) > 4 {
			continue
		}
		exponent := 0
		for _, b := range eBytes {
			exponent = exponent<<8 + int(b)
		}
		keys[jwk.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: exponent}
	}
	if len(keys) == 0 {
		return errors.New("google returned no usable signing keys")
	}

	maxAge := 60 * time.Minute
	for _, directive := range strings.Split(resp.Header.Get("Cache-Control"), ",") {
		name, value, ok := strings.Cut(strings.TrimSpace(directive), "=")
		if ok && name == "max-age" {
			if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
				maxAge = time.Duration(seconds) * time.Second
			}
		}
	}
	v.keys = keys
	v.expiresAt = time.Now().Add(maxAge)
	return nil
}
