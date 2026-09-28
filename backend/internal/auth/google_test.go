package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func signedGoogleCredential(t *testing.T, key *rsa.PrivateKey, claims *googleClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = "test-key"
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func TestGoogleVerifierChecksAudienceIssuerAndNonce(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	verifier := NewGoogleVerifier()
	verifier.keys["test-key"] = &key.PublicKey
	verifier.expiresAt = time.Now().Add(time.Hour)
	claims := &googleClaims{
		Email:         "Alice@Example.com",
		EmailVerified: true,
		Name:          "Alice",
		Nonce:         "login-nonce",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "https://accounts.google.com",
			Subject:   "google-subject",
			Audience:  jwt.ClaimStrings{"shroom-client-id"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	credential := signedGoogleCredential(t, key, claims)

	identity, err := verifier.Verify(context.Background(), credential, "wrong-client-id", "login-nonce")
	if err == nil {
		t.Fatal("expected the wrong audience to be rejected")
	}
	identity, err = verifier.Verify(context.Background(), credential, "shroom-client-id", "wrong-nonce")
	if err == nil {
		t.Fatal("expected the wrong nonce to be rejected")
	}
	identity, err = verifier.Verify(context.Background(), credential, "shroom-client-id", "login-nonce")
	if err != nil {
		t.Fatal(err)
	}
	if identity.Email != "alice@example.com" || identity.Subject != "google-subject" {
		t.Fatalf("unexpected verified identity: %#v", identity)
	}
}
