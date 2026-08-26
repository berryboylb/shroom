CREATE TABLE call_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id VARCHAR(8) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    participant_count INT DEFAULT 0,
    duration_seconds INT DEFAULT 0,
    quality_summary JSONB DEFAULT '{}'
);
CREATE INDEX idx_call_sessions_room_id ON call_sessions(room_id);
CREATE INDEX idx_call_sessions_started_at ON call_sessions(started_at);
