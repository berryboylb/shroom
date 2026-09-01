package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

type Hub struct {
	clients map[*Client]bool
	rooms   map[string]map[*Client]bool

	roomJoin   chan *Client
	roomMsg    chan roomMessage
	handAction chan handAction
	register   chan *Client
	unregister chan *Client

	redisClient *redis.Client
	handQueues  map[string][]raisedHand
	ActiveCount int32
}

type roomMessage struct {
	RoomID  string `json:"roomId"`
	Message []byte `json:"message"`
}

type raisedHand struct {
	ParticipantID string    `json:"participantId"`
	DisplayName   string    `json:"displayName"`
	RaisedAt      time.Time `json:"raisedAt"`
}

type handAction struct {
	client *Client
	raised bool
}

func NewHub(rdb *redis.Client) *Hub {
	h := &Hub{
		roomJoin:    make(chan *Client),
		roomMsg:     make(chan roomMessage, 256),
		handAction:  make(chan handAction, 256),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		clients:     make(map[*Client]bool),
		rooms:       make(map[string]map[*Client]bool),
		handQueues:  make(map[string][]raisedHand),
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
			h.roomMsg <- rm
		}
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			atomic.AddInt32(&h.ActiveCount, 1)
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				atomic.AddInt32(&h.ActiveCount, -1)
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
						h.publishToRoom(client.RoomID, resp)
					}
					h.removeRaisedHand(client.RoomID, client.UserID)
				}
				close(client.send)
				slog.Info("Client disconnected", "user_id", client.UserID)
			}
		case client := <-h.roomJoin:
			if _, ok := h.rooms[client.RoomID]; !ok {
				h.rooms[client.RoomID] = make(map[*Client]bool)
			}
			h.rooms[client.RoomID][client] = true
			h.sendHandQueue(client)
		case action := <-h.handAction:
			h.setRaisedHand(action.client, action.raised)
		case rm := <-h.roomMsg:
			h.broadcastToRoomUnsafe(rm.RoomID, rm.Message)
		}
	}
}

func (h *Hub) setRaisedHand(client *Client, raised bool) {
	if client.RoomID == "" {
		return
	}
	queue := h.handQueues[client.RoomID]
	found := -1
	for i, hand := range queue {
		if hand.ParticipantID == client.UserID {
			found = i
			break
		}
	}
	if raised && found == -1 {
		h.handQueues[client.RoomID] = append(queue, raisedHand{
			ParticipantID: client.UserID,
			DisplayName:   client.DisplayName,
			RaisedAt:      time.Now().UTC(),
		})
		h.broadcastHandQueue(client.RoomID)
	} else if !raised && found >= 0 {
		h.handQueues[client.RoomID] = append(queue[:found], queue[found+1:]...)
		h.broadcastHandQueue(client.RoomID)
	}
}

func (h *Hub) removeRaisedHand(roomID, participantID string) {
	queue := h.handQueues[roomID]
	for i, hand := range queue {
		if hand.ParticipantID == participantID {
			h.handQueues[roomID] = append(queue[:i], queue[i+1:]...)
			if len(h.handQueues[roomID]) == 0 {
				delete(h.handQueues, roomID)
			}
			h.broadcastHandQueue(roomID)
			return
		}
	}
}

func (h *Hub) handQueueMessage(roomID string) []byte {
	queue := h.handQueues[roomID]
	if queue == nil {
		queue = []raisedHand{}
	}
	message, _ := json.Marshal(map[string]interface{}{
		"type":    "hand_queue:updated",
		"payload": map[string]interface{}{"queue": queue},
	})
	return message
}

func (h *Hub) sendHandQueue(client *Client) {
	select {
	case client.send <- h.handQueueMessage(client.RoomID):
	default:
	}
}

func (h *Hub) broadcastHandQueue(roomID string) {
	h.publishToRoom(roomID, h.handQueueMessage(roomID))
}

func (h *Hub) publishToRoom(roomID string, message []byte) {
	if h.redisClient != nil {
		rm := roomMessage{RoomID: roomID, Message: message}
		b, _ := json.Marshal(rm)
		h.redisClient.Publish(context.Background(), "room_events", b)
	} else {
		h.roomMsg <- roomMessage{RoomID: roomID, Message: message}
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
				atomic.AddInt32(&h.ActiveCount, -1)
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
		if err != nil || claims.TokenType != "access" {
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
	case "room:hand:set":
		raised, ok := payload["raised"].(bool)
		if ok && client.RoomID != "" {
			h.handAction <- handAction{client: client, raised: raised}
		}
	}
}

func (h *Hub) GetActiveClientCount() int {
	return int(atomic.LoadInt32(&h.ActiveCount))
}
