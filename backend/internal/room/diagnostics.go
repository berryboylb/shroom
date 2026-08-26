package room

import (
	"encoding/json"
	"net/http"
	"runtime"
)

type DiagnosticsData struct {
	GoVersion    string `json:"goVersion"`
	NumGoroutine int    `json:"numGoroutines"`
	NumCPU       int    `json:"numCpu"`
	MemAlloc     uint64 `json:"memAllocBytes"`
	MemSys       uint64 `json:"memSysBytes"`
}

func (h *Handler) HandleDiagnostics(w http.ResponseWriter, r *http.Request) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	data := DiagnosticsData{
		GoVersion:    runtime.Version(),
		NumGoroutine: runtime.NumGoroutine(),
		NumCPU:       runtime.NumCPU(),
		MemAlloc:     m.Alloc,
		MemSys:       m.Sys,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}
