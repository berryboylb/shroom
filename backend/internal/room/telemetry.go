package room

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

type QualityMetrics struct {
	RTTMs                        float64 `json:"rttMs"`
	JitterMs                     float64 `json:"jitterMs"`
	PacketLossPercent            float64 `json:"packetLossPercent"`
	AvailableOutgoingBitrateKbps float64 `json:"availableOutgoingBitrateKbps"`
	SendBitrateKbps              float64 `json:"sendBitrateKbps"`
	FrameRate                    float64 `json:"frameRate"`
	Resolution                   struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"resolution"`
	Codec          string `json:"codec"`
	CandidateType  string `json:"candidateType"`
	FreezeCount    int    `json:"freezeCount"`
	ReconnectCount int    `json:"reconnectCount"`
}

type TelemetryData struct {
	RoomID          string         `json:"roomId"`
	ParticipantName string         `json:"participantName"`
	Quality         string         `json:"quality"`
	Browser         string         `json:"browser"`
	Metrics         QualityMetrics `json:"metrics"`
	ReceivedAt      time.Time      `json:"receivedAt"`
}

// TelemetryStore deliberately keeps only a small rolling window in memory.
// It provides useful single-node diagnostics without another monitoring service.
type TelemetryStore struct {
	mu      sync.RWMutex
	max     int
	reports []TelemetryData
}

func NewTelemetryStore(max int) *TelemetryStore {
	return &TelemetryStore{max: max, reports: make([]TelemetryData, 0, max)}
}

func (s *TelemetryStore) Add(data TelemetryData) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.reports) == s.max {
		copy(s.reports, s.reports[1:])
		s.reports = s.reports[:s.max-1]
	}
	s.reports = append(s.reports, data)
}

func (s *TelemetryStore) Recent(roomID string, limit int) []TelemetryData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit < 1 || limit > 100 {
		limit = 50
	}
	result := make([]TelemetryData, 0, limit)
	for i := len(s.reports) - 1; i >= 0 && len(result) < limit; i-- {
		if roomID == "" || s.reports[i].RoomID == roomID {
			result = append(result, s.reports[i])
		}
	}
	return result
}

func (h *Handler) HandleTelemetry(w http.ResponseWriter, r *http.Request) {
	var data TelemetryData
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	data.RoomID = strings.TrimSpace(data.RoomID)
	data.ParticipantName = strings.TrimSpace(data.ParticipantName)
	if data.RoomID == "" || len(data.RoomID) > 64 || len(data.ParticipantName) > 80 || len(data.Browser) > 512 {
		http.Error(w, "Invalid telemetry payload", http.StatusBadRequest)
		return
	}
	data.ReceivedAt = time.Now().UTC()
	h.telemetry.Add(data)

	// We log the telemetry payload as a structured JSON log.
	// In production, this can be scraped by Loki or ElasticSearch.
	slog.Info("Client Telemetry Received",
		"room_id", data.RoomID,
		"participant", data.ParticipantName,
		"quality", data.Quality,
		"rtt_ms", data.Metrics.RTTMs,
		"packet_loss_percent", data.Metrics.PacketLossPercent,
		"candidate_type", data.Metrics.CandidateType,
		"codec", data.Metrics.Codec,
	)

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) HandleRecentTelemetry(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"reports":  h.telemetry.Recent(r.URL.Query().Get("roomId"), 50),
		"capacity": 500,
	})
}
