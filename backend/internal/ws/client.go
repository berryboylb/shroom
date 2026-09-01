package ws

import (
	"encoding/json"
	"time"

	"github.com/gorilla/websocket"
	"github.com/shroom/backend/internal/auth"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096
)

type Client struct {
	hub          *Hub
	conn         *websocket.Conn
	send         chan []byte
	tokenService *auth.TokenService

	Authenticated bool
	UserID        string
	DisplayName   string
	RoomID        string
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	// Timeout if not authenticated within 5 seconds
	go func() {
		time.Sleep(5 * time.Second)
		if !c.Authenticated {
			c.conn.Close()
		}
	}()

	// Per-connection sliding window prevents one authenticated client from
	// monopolizing the hub without introducing an external rate-limit service.
	windowStarted := time.Now()
	messagesInWindow := 0
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if time.Since(windowStarted) >= time.Minute {
			windowStarted = time.Now()
			messagesInWindow = 0
		}
		messagesInWindow++
		if messagesInWindow > 100 {
			c.conn.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "message rate exceeded"),
				time.Now().Add(writeWait))
			return
		}

		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err == nil {
			c.hub.HandleMessage(c, msg)
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.WriteMessage(websocket.TextMessage, message)
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
