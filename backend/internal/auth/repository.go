package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/shroom/backend/internal/db"
)

var ErrAuthStorageUnavailable = errors.New("auth storage unavailable")
var ErrInvalidRefreshSession = errors.New("invalid refresh session")

type Account struct {
	ID          string
	Email       string
	DisplayName string
	AvatarURL   string
}

type AccountStore interface {
	UpsertGoogleAccount(context.Context, GoogleIdentity) (*Account, error)
	CreateRefreshSession(context.Context, string, string, time.Time) error
	RotateRefreshSession(context.Context, string, string, time.Time) (*Account, error)
	RevokeRefreshSession(context.Context, string) error
}

type Repository struct {
	db *db.DB
}

func NewRepository(database *db.DB) *Repository {
	return &Repository{db: database}
}

func (r *Repository) UpsertGoogleAccount(ctx context.Context, identity GoogleIdentity) (*Account, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return nil, ErrAuthStorageUnavailable
	}

	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var account Account
	err = tx.QueryRow(ctx, `
		SELECT u.id, u.email, u.display_name, COALESCE(u.avatar_url, '')
		FROM auth_identities ai
		JOIN users u ON u.id = ai.user_id
		WHERE ai.provider = 'google' AND ai.provider_subject = $1 AND u.status = 'active'
	`, identity.Subject).Scan(&account.ID, &account.Email, &account.DisplayName, &account.AvatarURL)

	if err == nil {
		err = tx.QueryRow(ctx, `
			UPDATE users
			SET email = $2, display_name = $3, avatar_url = NULLIF($4, ''),
			    last_seen_at = NOW(), updated_at = NOW()
			WHERE id = $1 AND status = 'active'
			RETURNING id, email, display_name, COALESCE(avatar_url, '')
		`, account.ID, identity.Email, identity.DisplayName, identity.AvatarURL).
			Scan(&account.ID, &account.Email, &account.DisplayName, &account.AvatarURL)
	} else if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			INSERT INTO users (email, display_name, avatar_url, password_hash, last_seen_at)
			VALUES ($1, $2, NULLIF($3, ''), NULL, NOW())
			ON CONFLICT (email) DO UPDATE SET
				display_name = EXCLUDED.display_name,
				avatar_url = EXCLUDED.avatar_url,
				last_seen_at = NOW(),
				updated_at = NOW()
			WHERE users.status = 'active'
			RETURNING id, email, display_name, COALESCE(avatar_url, '')
		`, identity.Email, identity.DisplayName, identity.AvatarURL).
			Scan(&account.ID, &account.Email, &account.DisplayName, &account.AvatarURL)
		if err == nil {
			_, err = tx.Exec(ctx, `
				INSERT INTO auth_identities (user_id, provider, provider_subject)
				VALUES ($1, 'google', $2)
				ON CONFLICT (provider, provider_subject) DO NOTHING
			`, account.ID, identity.Subject)
		}
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &account, nil
}

func (r *Repository) CreateRefreshSession(ctx context.Context, userID, tokenHash string, expiresAt time.Time) error {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return ErrAuthStorageUnavailable
	}
	_, err := r.db.Pool.Exec(ctx, `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, userID, tokenHash, expiresAt)
	return err
}

func (r *Repository) RotateRefreshSession(ctx context.Context, oldHash, newHash string, expiresAt time.Time) (*Account, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return nil, ErrAuthStorageUnavailable
	}
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var account Account
	err = tx.QueryRow(ctx, `
		SELECT u.id, u.email, u.display_name, COALESCE(u.avatar_url, '')
		FROM refresh_tokens rt
		JOIN users u ON u.id = rt.user_id
		WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()
		FOR UPDATE OF rt
	`, oldHash).Scan(&account.ID, &account.Email, &account.DisplayName, &account.AvatarURL)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidRefreshSession
		}
		return nil, err
	}
	if _, err = tx.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`, oldHash); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, account.ID, newHash, expiresAt); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &account, nil
}

func (r *Repository) RevokeRefreshSession(ctx context.Context, tokenHash string) error {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return ErrAuthStorageUnavailable
	}
	_, err := r.db.Pool.Exec(ctx, `
		UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE token_hash = $1
	`, tokenHash)
	return err
}
