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

var ErrWaitingApproval = fmt.Errorf("waiting for host approval")
var ErrJoinDenied = fmt.Errorf("join request denied")
var ErrNotHost = fmt.Errorf("not room host")

type Service struct {
	repo   *Repository
	config *config.Config
}

type JoinResult struct {
	Token            string
	IsHost           bool
	ApprovalRequired bool
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

func (s *Service) CreateRoom(ctx context.Context, title, hostIdentity string, approvalRequired bool) (*Room, error) {
	room := &Room{
		ID:               generateRoomID(),
		Title:            title,
		Type:             "instant",
		Status:           "waiting",
		MaxParticipants:  10,
		HostIdentity:     hostIdentity,
		ApprovalRequired: approvalRequired,
	}

	if err := s.repo.CreateRoom(ctx, room); err != nil {
		return nil, err
	}
	return room, nil
}

func (s *Service) JoinRoom(ctx context.Context, roomID string, participantID string, displayName string, isGuest bool) (JoinResult, error) {
	r, err := s.repo.GetRoom(ctx, roomID)
	if err != nil {
		return JoinResult{}, fmt.Errorf("room not found: %w", err)
	}

	if r.Status == "ended" {
		return JoinResult{}, fmt.Errorf("room has already ended")
	}
	if r.ApprovalRequired && r.HostIdentity != participantID {
		status, err := s.repo.RequestJoin(ctx, roomID, participantID, displayName)
		if err != nil {
			return JoinResult{}, err
		}
		if status == "pending" {
			return JoinResult{}, ErrWaitingApproval
		}
		if status == "denied" {
			return JoinResult{}, ErrJoinDenied
		}
	}

	// Update status to active if it was waiting
	if r.Status == "waiting" {
		if err := s.repo.UpdateRoomStatus(ctx, roomID, "active"); err != nil {
			return JoinResult{}, fmt.Errorf("failed to update room status: %w", err)
		}
	}

	claims := jwt.MapClaims{
		"iss":  s.config.LiveKit.APIKey,
		"sub":  participantID,
		"name": displayName,
		"video": map[string]interface{}{
			"roomJoin": true,
			"room":     roomID,
		},
		"exp": time.Now().Add(24 * time.Hour).Unix(),
		"nbf": time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(s.config.LiveKit.APISecret))
	if err != nil {
		return JoinResult{}, err
	}
	return JoinResult{Token: signed, IsHost: r.HostIdentity == participantID, ApprovalRequired: r.ApprovalRequired}, nil
}

func (s *Service) PendingJoins(ctx context.Context, roomID, hostID string) ([]JoinRequest, error) {
	r, err := s.repo.GetRoom(ctx, roomID)
	if err != nil {
		return nil, err
	}
	if !r.ApprovalRequired || r.HostIdentity != hostID {
		return nil, ErrNotHost
	}
	return s.repo.PendingJoins(ctx, roomID)
}

func (s *Service) DecideJoin(ctx context.Context, roomID, hostID, participantID string, approve bool) (bool, error) {
	r, err := s.repo.GetRoom(ctx, roomID)
	if err != nil {
		return false, err
	}
	if !r.ApprovalRequired || r.HostIdentity != hostID {
		return false, ErrNotHost
	}
	status := "denied"
	if approve {
		status = "approved"
	}
	return s.repo.DecideJoin(ctx, roomID, participantID, status)
}

func (s *Service) CanSubscribe(ctx context.Context, roomID, participantID string) bool {
	r, err := s.repo.GetRoom(ctx, roomID)
	if err != nil || r.Status == "ended" {
		return false
	}
	if !r.ApprovalRequired || r.HostIdentity == participantID {
		return true
	}
	approved, err := s.repo.JoinApproved(ctx, roomID, participantID)
	return err == nil && approved
}

func (s *Service) CancelJoin(ctx context.Context, roomID, participantID string) error {
	return s.repo.CancelJoin(ctx, roomID, participantID)
}

func (s *Service) EndRoom(ctx context.Context, roomID string) error {
	return s.repo.UpdateRoomStatus(ctx, roomID, "ended")
}
