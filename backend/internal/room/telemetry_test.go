package room

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

func TestTelemetryStoreIsBounded(t *testing.T) {
	store := NewTelemetryStore(3)
	for i := 0; i < 5; i++ {
		store.Add(TelemetryData{RoomID: "room", ParticipantName: fmt.Sprintf("user-%d", i)})
	}

	reports := store.Recent("room", 10)
	if len(reports) != 3 {
		t.Fatalf("expected 3 retained reports, got %d", len(reports))
	}
	if reports[0].ParticipantName != "user-4" || reports[2].ParticipantName != "user-2" {
		t.Fatalf("expected newest-first rolling reports, got %#v", reports)
	}
}

func TestRepositoryFailsSafelyWhenDatabaseIsUnavailable(t *testing.T) {
	repository := NewRepository(nil)
	if err := repository.CreateRoom(context.Background(), &Room{}); !errors.Is(err, ErrStorageUnavailable) {
		t.Fatalf("expected storage unavailable, got %v", err)
	}
	if _, err := repository.GetRoom(context.Background(), "room"); !errors.Is(err, ErrStorageUnavailable) {
		t.Fatalf("expected storage unavailable, got %v", err)
	}
}

func TestTelemetryStoreFiltersRooms(t *testing.T) {
	store := NewTelemetryStore(10)
	store.Add(TelemetryData{RoomID: "one"})
	store.Add(TelemetryData{RoomID: "two"})

	reports := store.Recent("one", 10)
	if len(reports) != 1 || reports[0].RoomID != "one" {
		t.Fatalf("expected only room one, got %#v", reports)
	}
}
