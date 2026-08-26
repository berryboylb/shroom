package ws

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/redis/go-redis/v9"
)

type Hub struct {
	clients    map[*Client]bool
	rooms      map[string]map[*Client]bool
	
	roomJoin   chan *Client
	roomMsg    chan roomMessage
	register   chan *Client
	unregister chan *Client
	
	redisClient *redis.Client
}

type roomMessage struct {
	roomID  string
	message []byte
}

func NewHub(rdb *redis.Client) *Hub {
	h := &Hub{
		roomJoin:    make(chan *Client),
		roomMsg:     make(chan roomMessage),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		clients:     make(map[*Client]bool),
		rooms:       make(map[string]map[*Client]bool),
		redisClient: rdb,
	}
	
	if rdb != nil {
		go h.listenRedisPubSub()
	}
	
	return h
}

func (h *Hub) listenRedisPubSub() {
	pubsub := h.redisClient.Subscribe(context.Background(), "room_events")
	defer pubsub.Close()
	
	ch := pubsub.Channel()
	for msg := range ch {
		var rm roomMessage
		if err := json.Unmarshal([]byte(msg.Payload), &rm); err == nil {
			// This is safe since we only read from h.rooms?
			// Wait, calling broadcastToRoomUnsafe from another goroutine is a race.
			// Better send it to h.roomMsg channel so Run() handles it safely.
			h.roomMsg <- rm
		}
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				if client.RoomID != "" {
					if clientsInRoom, ok := h.rooms[client.RoomID]; ok {
						delete(clientsInRoom, client)
						if len(clientsInRoom) == 0 {
							delete(h.rooms, client.RoomID)
						}
						resp, _ := json.Marshal(map[string]interface{}{
							"type": "participant:left",
							"payload": map[string]string{
								"participantId": client.UserID,
							},
						})
						// Publish to Redis instead of local broadcast
						h.publishToRoom(client.RoomID, resp)
					}
				}
				close(client.send)
				slog.Info("Client disconnected", "user_id", client.UserID)
			}
		case client := <-h.roomJoin:
			if _, ok := h.rooms[client.RoomID]; !ok {
				h.rooms[client.RoomID] = make(map[*Client]bool)
			}
			h.rooms[client.RoomID][client] = true
		case rm := <-h.roomMsg:
			// Actually broadcast to local clients
			h.broadcastToRoomUnsafe(rm.roomID, rm.message)
		}
	}
}

func (h *Hub) publishToRoom(roomID string, message []byte) {
	if h.redisClient != nil {
		rm := roomMessage{roomID: roomID, message: message}
		b, _ := json.Marshal(rm)
		h.redisClient.Publish(context.Background(), "room_events", b)
	} else {
		// Fallback to local
		h.roomMsg <- roomMessage{roomID: roomID, message: message}
	}
}

func (h *Hub) broadcastToRoomUnsafe(roomID string, message []byte) {
	if clientsInRoom, ok := h.rooms[roomID]; ok {
		for client := range clientsInRoom {
			select {
			case client.send <- message:
			default:
				close(client.send)
				delete(h.clients, client)
				delete(clientsInRoom, client)
			}
		}
	}
}

func (h *Hub) HandleMessage(client *Client, msg map[string]interface{}) {
	msgType, _ := msg["type"].(string)
	payload, ok := msg["payload"].(map[string]interface{})
	if !ok {
		payload = make(map[string]interface{})
	}

	if msgType == "ws:authenticate" {
		token, _ := payload["token"].(string)
		claims, err := client.tokenService.ValidateToken(token)
		if err != nil {
			client.conn.Close()
			return
		}
		client.Authenticated = true
		client.UserID = claims.UserID
		client.DisplayName = claims.DisplayName
		
		resp, _ := json.Marshal(map[string]interface{}{"type": "ws:authenticated"})
		client.send <- resp
		return
	}

	if !client.Authenticated {
		return
	}

	switch msgType {
	case "room:join":
		roomID, _ := payload["roomId"].(string)
		client.RoomID = roomID
		h.roomJoin <- client
		
		resp := map[string]interface{}{
			"type": "participant:joined",
			"payload": map[string]string{
				"participantId": client.UserID,
				"displayName":   client.DisplayName,
			},
		}
		b, _ := json.Marshal(resp)
		h.publishToRoom(roomID, b)
	}
}
