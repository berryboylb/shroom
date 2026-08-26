package room

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/shroom/backend/internal/config"
)

type Service struct {
	repo   *Repository
	config *config.Config
}

func NewService(repo *Repository, cfg *config.Config) *Service {
	return &Service{repo: repo, config: cfg}
}

func generateRoomID() string {
	b := make([]byte, 5) // 10 hex chars
	rand.Read(b)
	hexStr := hex.EncodeToString(b)
	return fmt.Sprintf("%s-%s-%s", hexStr[0:3], hexStr[3:7], hexStr[7:10])
}

func (s *Service) CreateRoom(ctx context.Context, title string) (*Room, error) {
	room := &Room{
		ID:              generateRoomID(),
		Title:           title,
		Type:            "instant",
		Status:          "waiting",
		MaxParticipants: 10,
	}

	if err := s.repo.CreateRoom(ctx, room); err != nil {
		return nil, err
	}
	return room, nil
}

func (s *Service) JoinRoom(ctx context.Context, roomID string, participantID string, displayName string, isGuest bool) (string, error) {
	r, err := s.repo.GetRoom(ctx, roomID)
	if err != nil {
		return "", fmt.Errorf("room not found: %w", err)
	}

	if r.Status == "ended" {
		return "", fmt.Errorf("room has already ended")
	}

	// Update status to active if it was waiting
	if r.Status == "waiting" {
		_ = s.repo.UpdateRoomStatus(ctx, roomID, "active")
	}

	claims := jwt.MapClaims{
		"iss": s.config.LiveKit.APIKey,
		"sub": participantID,
		"name": displayName,
		"video": map[string]interface{}{
			"roomJoin": true,
			"room":     roomID,
		},
		"exp": time.Now().Add(24 * time.Hour).Unix(),
		"nbf": time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.config.LiveKit.APISecret))
}

func (s *Service) EndRoom(ctx context.Context, roomID string) error {
	return s.repo.UpdateRoomStatus(ctx, roomID, "ended")
}
