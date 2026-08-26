package room

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type TelemetryData struct {
	RoomID          string `json:"roomId"`
	ParticipantName string `json:"participantName"`
	Quality         string `json:"quality"`
	Browser         string `json:"browser"`
}

func (h *Handler) HandleTelemetry(w http.ResponseWriter, r *http.Request) {
	var data TelemetryData
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// We log the telemetry payload as a structured JSON log.
	// In production, this can be scraped by Loki or ElasticSearch.
	slog.Info("Client Telemetry Received",
		"room_id", data.RoomID,
		"participant", data.ParticipantName,
		"quality", data.Quality,
		"browser", data.Browser,
	)

	w.WriteHeader(http.StatusOK)
}
