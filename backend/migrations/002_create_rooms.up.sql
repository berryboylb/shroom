CREATE TABLE rooms (
    id VARCHAR(8) PRIMARY KEY,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255),
    type VARCHAR(20) NOT NULL DEFAULT 'instant' CHECK (type IN ('instant', 'scheduled')),
    status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'ended')),
    max_participants INT NOT NULL DEFAULT 10,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);
CREATE INDEX idx_rooms_owner_id ON rooms(owner_id);
CREATE INDEX idx_rooms_status ON rooms(status);
