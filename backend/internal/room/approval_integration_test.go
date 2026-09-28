package room

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/shroom/backend/internal/config"
	"github.com/shroom/backend/internal/db"
)

func TestApprovalGateWithDatabase(t *testing.T) {
	databaseURL := os.Getenv("SHROOM_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set SHROOM_TEST_DATABASE_URL to run database admission test")
	}
	ctx := context.Background()
	database, err := db.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repo := NewRepository(database)
	service := NewService(repo, &config.Config{LiveKit: config.LiveKitConfig{APIKey: "test-key", APISecret: "test-secret"}})
	r, err := service.CreateRoom(ctx, "Approval test", "test-host", true)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = database.Pool.Exec(ctx, `DELETE FROM rooms WHERE id = $1`, r.ID) }()
	if _, err := service.JoinRoom(ctx, r.ID, "guest-one", "Guest One", true); !errors.Is(err, ErrWaitingApproval) {
		t.Fatalf("unapproved guest should wait: %v", err)
	}
	if service.CanSubscribe(ctx, r.ID, "guest-one") {
		t.Fatal("waiting guest could subscribe to signaling")
	}
	if _, err := service.DecideJoin(ctx, r.ID, "guest-one", "guest-one", true); !errors.Is(err, ErrNotHost) {
		t.Fatalf("non-host could approve: %v", err)
	}
	requests, err := service.PendingJoins(ctx, r.ID, "test-host")
	if err != nil || len(requests) != 1 {
		t.Fatalf("expected one request: %v, %d", err, len(requests))
	}
	if decided, err := service.DecideJoin(ctx, r.ID, "test-host", "guest-one", true); err != nil || !decided {
		t.Fatalf("host could not approve: %v", err)
	}
	join, err := service.JoinRoom(ctx, r.ID, "guest-one", "Guest One", true)
	if err != nil || join.Token == "" || join.IsHost {
		t.Fatalf("approved guest could not join: %v", err)
	}
	if !service.CanSubscribe(ctx, r.ID, "guest-one") {
		t.Fatal("approved guest could not subscribe")
	}
	if _, err := service.JoinRoom(ctx, r.ID, "guest-two", "Guest Two", true); !errors.Is(err, ErrWaitingApproval) {
		t.Fatalf("second guest should wait: %v", err)
	}
	if decided, err := service.DecideJoin(ctx, r.ID, "test-host", "guest-two", false); err != nil || !decided {
		t.Fatalf("host could not deny: %v", err)
	}
	if _, err := service.JoinRoom(ctx, r.ID, "guest-two", "Guest Two", true); !errors.Is(err, ErrJoinDenied) {
		t.Fatalf("denied guest was not blocked: %v", err)
	}
}
