package room

import (
	"context"
	"errors"

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
	ID              string
	Title           string
	Type            string
	Status          string
	MaxParticipants int
}

func (r *Repository) CreateRoom(ctx context.Context, room *Room) error {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return ErrStorageUnavailable
	}
	query := `
		INSERT INTO rooms (id, title, type, status, max_participants)
		VALUES ($1, $2, $3, $4, $5)
	`
	_, err := r.db.Pool.Exec(ctx, query, room.ID, room.Title, room.Type, room.Status, room.MaxParticipants)
	return err
}

func (r *Repository) GetRoom(ctx context.Context, id string) (*Room, error) {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return nil, ErrStorageUnavailable
	}
	query := `SELECT id, title, type, status, max_participants FROM rooms WHERE id = $1`
	row := r.db.Pool.QueryRow(ctx, query, id)

	var room Room
	if err := row.Scan(&room.ID, &room.Title, &room.Type, &room.Status, &room.MaxParticipants); err != nil {
		return nil, err
	}
	return &room, nil
}

func (r *Repository) UpdateRoomStatus(ctx context.Context, id string, status string) error {
	if r == nil || r.db == nil || r.db.Pool == nil {
		return ErrStorageUnavailable
	}
	query := `UPDATE rooms SET status = $1 WHERE id = $2`
	_, err := r.db.Pool.Exec(ctx, query, status, id)
	return err
}
