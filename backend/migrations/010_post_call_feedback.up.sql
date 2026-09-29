CREATE TABLE IF NOT EXISTS post_call_feedback (
    id BIGSERIAL PRIMARY KEY,
    room_id VARCHAR(20) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    rating VARCHAR(8) NOT NULL CHECK (rating IN ('good', 'problem')),
    issue VARCHAR(16) CHECK (issue IN ('audio', 'video', 'joining', 'chat', 'controls', 'connection', 'other')),
    note VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (room_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_post_call_feedback_created_at ON post_call_feedback(created_at DESC);
