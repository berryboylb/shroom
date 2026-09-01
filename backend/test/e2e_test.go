package test

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shroom/backend/internal/config"
	"github.com/shroom/backend/internal/server"
)

func TestE2EFlow(t *testing.T) {
	connection, err := net.DialTimeout("tcp", "localhost:5433", 300*time.Millisecond)
	if err != nil {
		if os.Getenv("REQUIRE_INTEGRATION") == "1" {
			t.Fatalf("PostgreSQL integration dependency is unavailable: %v", err)
		}
		t.Skipf("PostgreSQL is not running; set REQUIRE_INTEGRATION=1 to make this a required gate: %v", err)
	}
	connection.Close()

	// 1. Setup Test Server
	cfg := &config.Config{
		Server: config.ServerConfig{
			Port:      "9090",
			JWTSecret: "test-secret",
		},
		Database: config.DatabaseConfig{
			URL: "postgres://postgres:postgres@localhost:5433/shroom?sslmode=disable",
		},
		LiveKit: config.LiveKitConfig{
			URL:       "http://localhost:7880",
			APIKey:    "devkey",
			APISecret: "secret",
		},
	}

	srv := server.New(cfg)
	defer srv.Stop(context.Background())

	httpServer := httptest.NewServer(srv.Router())
	defer httpServer.Close()

	// 2. Auth - Get Guest Token
	authReqBody := []byte(`{"display_name": "Test User"}`)
	resp, err := http.Post(httpServer.URL+"/api/auth/guest", "application/json", bytes.NewBuffer(authReqBody))
	if err != nil {
		t.Fatalf("Failed to call auth: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected 200 OK for auth, got %d", resp.StatusCode)
	}

	var authResp map[string]string
	json.NewDecoder(resp.Body).Decode(&authResp)
	token := authResp["access_token"]
	if token == "" {
		t.Fatal("Expected access token")
	}

	// 3. Create Room
	req, _ := http.NewRequest("POST", httpServer.URL+"/api/rooms", strings.NewReader(`{"title": "Test Room"}`))
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{}
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("Failed to create room: %v", err)
	}
	defer resp.Body.Close()

	var roomResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&roomResp)
	roomID, _ := roomResp["ID"].(string)
	if roomID == "" {
		t.Fatal("Expected room ID")
	}

	// 4. Join Room
	req, _ = http.NewRequest("POST", httpServer.URL+"/api/rooms/"+roomID+"/join", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatalf("Failed to join room: %v", err)
	}
	defer resp.Body.Close()

	var joinResp map[string]string
	json.NewDecoder(resp.Body).Decode(&joinResp)
	if joinResp["livekit_token"] == "" {
		t.Fatal("Expected livekit_token")
	}

	// 5. Connect WebSocket
	wsURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/ws"
	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Failed to connect WS: %v", err)
	}
	defer ws.Close()

	// 6. Authenticate WS
	ws.WriteJSON(map[string]interface{}{
		"type": "ws:authenticate",
		"payload": map[string]string{
			"token": token,
		},
	})

	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	var authAck map[string]interface{}
	if err := ws.ReadJSON(&authAck); err != nil {
		t.Fatalf("Failed to read auth ack: %v", err)
	}
	if authAck["type"] != "ws:authenticated" {
		t.Fatalf("Expected ws:authenticated, got %v", authAck["type"])
	}

	// 7. Send room:join
	ws.WriteJSON(map[string]interface{}{
		"type": "room:join",
		"payload": map[string]string{
			"roomId": roomID,
		},
	})

	// 8. Receive the authoritative raised-hand queue snapshot.
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	var wsResp map[string]interface{}
	if err := ws.ReadJSON(&wsResp); err != nil {
		t.Fatalf("Failed to read WS message: %v", err)
	}
	if wsResp["type"] != "hand_queue:updated" {
		t.Fatalf("Expected hand_queue:updated snapshot, got %v", wsResp["type"])
	}

	// 9. Receive participant:joined broadcast.
	if err := ws.ReadJSON(&wsResp); err != nil {
		t.Fatalf("Failed to read participant broadcast: %v", err)
	}
	if wsResp["type"] != "participant:joined" {
		t.Fatalf("Expected participant:joined broadcast, got %v", wsResp["type"])
	}
}
