ALTER TABLE rooms ADD COLUMN IF NOT EXISTS host_identity TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS room_join_requests (
    room_id VARCHAR(20) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    PRIMARY KEY (room_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_room_join_requests_pending ON room_join_requests(room_id, requested_at) WHERE status = 'pending';
