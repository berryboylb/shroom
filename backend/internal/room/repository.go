package room

import (
	"context"
	"errors"
	"time"

	"github.com/shroom/backend/internal/db"
)

var ErrStorageUnavailable = errors.New("storage unavailable")

type Repository struct {
	db *db.DB
}

func NewRepository(db *db.DB) *Repository {
	return &Repository{db: db}
}

type Room struct {
	ID               string
	Title            string
	Type             string
	Status           string
	MaxParticipants  int
	HostIdentity     string
	ApprovalRequired bool
}

type JoinRequest struct {
	ParticipantID string    `json:"participant_id"`
	DisplayName   string    `json:"display_name"`
	RequestedAt   time.Time `json:"requested_at"`
}

func (r *Repository) CreateRoom(ctx context.Context, room *Room) error {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return ErrStorageUnavailable
	}
	query := `
		INSERT INTO rooms (id, title, type, status, max_participants, host_identity, approval_required)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err := r.db.Pool.Exec(ctx, query, room.ID, room.Title, room.Type, room.Status, room.MaxParticipants, room.HostIdentity, room.ApprovalRequired)
	return err
}

func (r *Repository) GetRoom(ctx context.Context, id string) (*Room, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return nil, ErrStorageUnavailable
	}
	query := `SELECT id, title, type, status, max_participants, COALESCE(host_identity, ''), approval_required FROM rooms WHERE id = $1`
	row := r.db.Pool.QueryRow(ctx, query, id)

	var room Room
	if err := row.Scan(&room.ID, &room.Title, &room.Type, &room.Status, &room.MaxParticipants, &room.HostIdentity, &room.ApprovalRequired); err != nil {
		return nil, err
	}
	return &room, nil
}

func (r *Repository) RequestJoin(ctx context.Context, roomID, participantID, displayName string) (string, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return "", ErrStorageUnavailable
	}
	var status string
	err := r.db.Pool.QueryRow(ctx, `
		INSERT INTO room_join_requests (room_id, participant_id, display_name)
		VALUES ($1, $2, $3)
		ON CONFLICT (room_id, participant_id) DO UPDATE SET display_name = EXCLUDED.display_name
		RETURNING status
	`, roomID, participantID, displayName).Scan(&status)
	return status, err
}

func (r *Repository) JoinApproved(ctx context.Context, roomID, participantID string) (bool, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return false, ErrStorageUnavailable
	}
	var approved bool
	err := r.db.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM room_join_requests WHERE room_id = $1 AND participant_id = $2 AND status = 'approved')`, roomID, participantID).Scan(&approved)
	return approved, err
}

func (r *Repository) PendingJoins(ctx context.Context, roomID string) ([]JoinRequest, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return nil, ErrStorageUnavailable
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT participant_id, display_name, requested_at FROM room_join_requests WHERE room_id = $1 AND status = 'pending' ORDER BY requested_at LIMIT 50`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	requests := make([]JoinRequest, 0)
	for rows.Next() {
		var item JoinRequest
		if err := rows.Scan(&item.ParticipantID, &item.DisplayName, &item.RequestedAt); err != nil {
			return nil, err
		}
		requests = append(requests, item)
	}
	return requests, rows.Err()
}

func (r *Repository) DecideJoin(ctx context.Context, roomID, participantID, status string) (bool, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return false, ErrStorageUnavailable
	}
	result, err := r.db.Pool.Exec(ctx, `UPDATE room_join_requests SET status = $3, decided_at = NOW() WHERE room_id = $1 AND participant_id = $2 AND status = 'pending'`, roomID, participantID, status)
	return err == nil && result.RowsAffected() == 1, err
}

func (r *Repository) CancelJoin(ctx context.Context, roomID, participantID string) error {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return ErrStorageUnavailable
	}
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM room_join_requests WHERE room_id = $1 AND participant_id = $2 AND status = 'pending'`, roomID, participantID)
	return err
}

func (r *Repository) UpdateRoomStatus(ctx context.Context, id string, status string) error {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return ErrStorageUnavailable
	}
	query := `UPDATE rooms SET status = $1 WHERE id = $2`
	_, err := r.db.Pool.Exec(ctx, query, status, id)
	return err
}
