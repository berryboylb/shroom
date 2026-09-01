package ws

import (
	"encoding/json"
	"testing"
)

func TestRaisedHandsAreOrderedAndIdempotent(t *testing.T) {
	hub := NewHub(nil)
	alice := &Client{hub: hub, UserID: "alice", DisplayName: "Alice", RoomID: "room-1"}
	bob := &Client{hub: hub, UserID: "bob", DisplayName: "Bob", RoomID: "room-1"}

	hub.setRaisedHand(alice, true)
	hub.setRaisedHand(bob, true)
	hub.setRaisedHand(alice, true)

	queue := hub.handQueues["room-1"]
	if len(queue) != 2 {
		t.Fatalf("expected two raised hands, got %d", len(queue))
	}
	if queue[0].ParticipantID != "alice" || queue[1].ParticipantID != "bob" {
		t.Fatalf("expected Alice then Bob, got %#v", queue)
	}

	hub.setRaisedHand(alice, false)
	hub.setRaisedHand(alice, true)
	queue = hub.handQueues["room-1"]
	if queue[0].ParticipantID != "bob" || queue[1].ParticipantID != "alice" {
		t.Fatalf("expected re-raised hand at end of queue, got %#v", queue)
	}
}

func TestHandQueueMessageUsesAuthoritativeOrder(t *testing.T) {
	hub := NewHub(nil)
	hub.handQueues["room-1"] = []raisedHand{
		{ParticipantID: "first", DisplayName: "First"},
		{ParticipantID: "second", DisplayName: "Second"},
	}

	var message struct {
		Type    string `json:"type"`
		Payload struct {
			Queue []raisedHand `json:"queue"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(hub.handQueueMessage("room-1"), &message); err != nil {
		t.Fatal(err)
	}
	if message.Type != "hand_queue:updated" || len(message.Payload.Queue) != 2 {
		t.Fatalf("unexpected queue message: %#v", message)
	}
	if message.Payload.Queue[0].ParticipantID != "first" || message.Payload.Queue[1].ParticipantID != "second" {
		t.Fatalf("queue order changed in message: %#v", message.Payload.Queue)
	}
}

func TestDisconnectRemovesRaisedHand(t *testing.T) {
	hub := NewHub(nil)
	hub.handQueues["room-1"] = []raisedHand{
		{ParticipantID: "alice", DisplayName: "Alice"},
		{ParticipantID: "bob", DisplayName: "Bob"},
	}

	hub.removeRaisedHand("room-1", "alice")
	queue := hub.handQueues["room-1"]
	if len(queue) != 1 || queue[0].ParticipantID != "bob" {
		t.Fatalf("expected only Bob after Alice disconnected, got %#v", queue)
	}
}

func TestRoomMessageRedisEnvelopeRoundTrips(t *testing.T) {
	original := roomMessage{RoomID: "room-1", Message: []byte(`{"type":"hand_queue:updated"}`)}
	encoded, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var decoded roomMessage
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.RoomID != original.RoomID || string(decoded.Message) != string(original.Message) {
		t.Fatalf("room message did not survive Redis serialization: %#v", decoded)
	}
}
