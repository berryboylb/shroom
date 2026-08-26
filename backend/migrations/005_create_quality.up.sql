CREATE TABLE call_quality_snapshots (
    id BIGSERIAL,
    session_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES room_participants(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metrics JSONB NOT NULL,
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

CREATE TABLE call_quality_snapshots_2026_08 PARTITION OF call_quality_snapshots
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
