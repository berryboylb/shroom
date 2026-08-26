# Database & Redis Architecture: Shroom

This document details the database schema, Redis caching strategy, and overall data architecture for Shroom, a lightweight, resilient video calling platform.

---

## 1. PostgreSQL Schema

The primary datastore for Shroom is PostgreSQL. It handles persistent configurations, user identity, historic call records, and aggregated quality metrics.

### 1.1 Tables and Schema Definition

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS TABLE
-- Stores user identity and authentication details.
-- ============================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'))
);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- ROOMS TABLE
-- Stores meeting room metadata.
-- Uses an 8-char short ID for shareability (NOT UUID).
-- ============================================================
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

-- ============================================================
-- ROOM PARTICIPANTS TABLE
-- Tracks participants in a room, including anonymous guests.
-- user_id is nullable to support guest access (Phase 2).
-- left_at IS NULL means participant is currently in the room.
-- ============================================================
CREATE TABLE room_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id VARCHAR(8) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    display_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'participant' CHECK (role IN ('host', 'participant')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    join_count INT NOT NULL DEFAULT 1
);
CREATE INDEX idx_room_participants_room_id ON room_participants(room_id);
CREATE INDEX idx_room_participants_user_id ON room_participants(user_id);
-- Partial index for "currently in room" queries
CREATE INDEX idx_room_participants_active ON room_participants(room_id) WHERE left_at IS NULL;

-- ============================================================
-- CALL SESSIONS TABLE
-- Tracks distinct active sessions of a room.
-- A room can have multiple sessions (room is reused).
-- ============================================================
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

-- ============================================================
-- CALL QUALITY SNAPSHOTS TABLE
-- Stores time-series quality data from participants.
-- Partitioned by timestamp for efficient insert and cleanup.
-- ============================================================
CREATE TABLE call_quality_snapshots (
    id BIGSERIAL,
    session_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES room_participants(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metrics JSONB NOT NULL,
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Create initial monthly partitions
CREATE TABLE call_quality_snapshots_2026_08 PARTITION OF call_quality_snapshots
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE call_quality_snapshots_2026_09 PARTITION OF call_quality_snapshots
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE call_quality_snapshots_2026_10 PARTITION OF call_quality_snapshots
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

-- ============================================================
-- REFRESH TOKENS TABLE
-- Manages JWT refresh tokens for session persistence.
-- ============================================================
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
```

### 1.2 Quality Metrics JSONB Schema

The `metrics` field in `call_quality_snapshots` follows this structure:

```jsonc
{
  "rtt": 45,                    // Round-trip time in ms
  "jitter": 12,                 // Jitter in ms
  "packetLoss": 0.3,            // Percentage (0-100)
  "sendBitrate": 2100,          // kbps
  "recvBitrate": 1800,          // kbps
  "frameRate": 28,              // fps
  "resolution": {
    "width": 1280,
    "height": 720
  },
  "codec": "H264",
  "freezeCount": 0,
  "audioLevel": 0.42,           // 0-1
  "iceState": "connected",
  "candidateType": "srflx",     // host | srflx | relay
  "qualityScore": 5,            // 1-5
  "reconnectCount": 0
}
```

### 1.3 Indexing Strategy Justifications

| Index | Type | Justification |
|-------|------|---------------|
| `idx_users_email` | B-tree | O(log N) authentication lookups. Most frequent query. |
| `idx_rooms_owner_id` | B-tree | "My rooms" queries by owner. |
| `idx_rooms_status` | B-tree | Filter active vs ended rooms. |
| `idx_room_participants_room_id` | B-tree | List participants for a specific room. |
| `idx_room_participants_active` | Partial B-tree | Fast "who is currently in this room" query. Only indexes rows where `left_at IS NULL`. |
| `idx_call_sessions_started_at` | B-tree | Time-range queries for call history. |
| `idx_refresh_tokens_expires_at` | B-tree | Cleanup of expired tokens. |
| `call_quality_snapshots` partitioning | Range (timestamp) | O(1) old data removal via partition drop. Fast inserts (no index bloat on massive table). |

---

## 2. Migration Strategy

### 2.1 Tool: golang-migrate

Using `github.com/golang-migrate/migrate/v4` for its native Go integration, CLI support, and database driver flexibility.

### 2.2 Naming Convention

```
{NNN}_{description}.up.sql
{NNN}_{description}.down.sql
```

Examples:
```
backend/migrations/
├── 001_create_users.up.sql
├── 001_create_users.down.sql
├── 002_create_rooms.up.sql
├── 002_create_rooms.down.sql
├── 003_create_participants.up.sql
├── 003_create_participants.down.sql
├── 004_create_sessions.up.sql
├── 004_create_sessions.down.sql
├── 005_create_quality.up.sql
├── 005_create_quality.down.sql
└── 006_create_refresh_tokens.up.sql
└── 006_create_refresh_tokens.down.sql
```

### 2.3 Policy

- Both `up` and `down` migrations are **required**.
- Down migrations must safely roll back the corresponding up migration.
- Migrations must be **idempotent** where possible (`IF NOT EXISTS`).
- Production index creation uses `CREATE INDEX CONCURRENTLY` to avoid locking.
- Migrations are run automatically on backend startup in development; manually via CLI in production.

### 2.4 Go Migration CLI

```go
// cmd/migrate/main.go
package main

import (
    "flag"
    "log"
    "github.com/golang-migrate/migrate/v4"
    _ "github.com/golang-migrate/migrate/v4/database/postgres"
    _ "github.com/golang-migrate/migrate/v4/source/file"
)

func main() {
    direction := flag.String("direction", "up", "Migration direction: up or down")
    steps := flag.Int("steps", 0, "Number of steps (0 = all)")
    flag.Parse()

    m, err := migrate.New("file://migrations", os.Getenv("DATABASE_URL"))
    if err != nil { log.Fatal(err) }

    switch *direction {
    case "up":
        if *steps > 0 { err = m.Steps(*steps) } else { err = m.Up() }
    case "down":
        if *steps > 0 { err = m.Steps(-*steps) } else { err = m.Down() }
    }

    if err != nil && err != migrate.ErrNoChange {
        log.Fatal(err)
    }
    log.Println("Migration complete")
}
```

### 2.5 Partition Maintenance (Automated)

> **⚠️ This is not optional.** Without automated partition creation, inserts to
> `call_quality_snapshots` will fail with `ERROR: no partition of relation ... found for row`
> as soon as the date advances past the last pre-created partition.

The backend runs a background goroutine on startup that:
1. Creates partitions **2 months ahead** of the current date (ensures runway even if the job misses a run)
2. Drops partitions **older than 90 days** (retention policy)
3. Runs **once daily** (idempotent — `IF NOT EXISTS` / `IF EXISTS` prevent errors on re-runs)

```go
// internal/db/partitions.go
package db

import (
    "context"
    "fmt"
    "log/slog"
    "time"
)

// MaintainPartitions runs partition maintenance immediately, then daily.
// Call this in a goroutine from main.go: go db.MaintainPartitions(ctx)
func (db *DB) MaintainPartitions(ctx context.Context) {
    db.runPartitionMaintenance(ctx) // run once on startup

    ticker := time.NewTicker(24 * time.Hour)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            db.runPartitionMaintenance(ctx)
        }
    }
}

func (db *DB) runPartitionMaintenance(ctx context.Context) {
    now := time.Now().UTC()

    // Create partitions for current month + 2 months ahead
    for i := 0; i < 3; i++ {
        month := time.Date(now.Year(), now.Month()+time.Month(i), 1, 0, 0, 0, 0, time.UTC)
        nextMonth := month.AddDate(0, 1, 0)
        partName := fmt.Sprintf("call_quality_snapshots_%s", month.Format("2006_01"))

        query := fmt.Sprintf(
            `CREATE TABLE IF NOT EXISTS %s PARTITION OF call_quality_snapshots
             FOR VALUES FROM ('%s') TO ('%s')`,
            partName,
            month.Format("2006-01-02"),
            nextMonth.Format("2006-01-02"),
        )
        if _, err := db.Pool.Exec(ctx, query); err != nil {
            slog.Error("failed to create partition", "partition", partName, "error", err)
        } else {
            slog.Debug("partition ensured", "partition", partName)
        }
    }

    // Drop partitions older than 90 days
    cutoff := now.AddDate(0, -3, 0) // ~90 days
    for i := 0; i < 6; i++ { // check 6 months back to catch any stragglers
        month := time.Date(cutoff.Year(), cutoff.Month()-time.Month(i), 1, 0, 0, 0, 0, time.UTC)
        partName := fmt.Sprintf("call_quality_snapshots_%s", month.Format("2006_01"))

        query := fmt.Sprintf("DROP TABLE IF EXISTS %s", partName)
        if _, err := db.Pool.Exec(ctx, query); err != nil {
            slog.Error("failed to drop old partition", "partition", partName, "error", err)
        }
    }

    slog.Info("partition maintenance complete")
}
```

**Startup integration in `main.go`:**
```go
// After db.Connect(...)
go database.MaintainPartitions(ctx)
```

The initial migration (005_create_quality.up.sql) should still create the first partition for the current month to avoid a race between the migration running and the goroutine starting. But the goroutine ensures future months are always covered.

---

## 3. Redis Usage

Redis manages highly ephemeral, volatile data: live room presence, signaling relay, session tracking, and rate limiting.

### 3.1 Key Patterns

#### Room State (Ephemeral)

| Key | Type | TTL | Purpose | Writer | Reader |
|-----|------|-----|---------|--------|--------|
| `room:{roomId}:state` | HASH | 24h | Room status, participant count, started_at | Room Service | WS Gateway, API |
| `room:{roomId}:participants` | SET | 24h | Set of participant IDs currently in room | WS Gateway | WS Gateway, API |
| `room:{roomId}:participant:{pid}` | HASH | 4h | display_name, media_state, connection_quality, joined_at | WS Gateway | WS Gateway (broadcast to new joiners) |

**Example commands:**
```redis
# Room state
HSET room:a3kx9m2p:state status active participant_count 3 started_at 1724688000
EXPIRE room:a3kx9m2p:state 86400

# Add participant
SADD room:a3kx9m2p:participants user-uuid-1
HSET room:a3kx9m2p:participant:user-uuid-1 display_name "Alice" muted false camera_on true quality 5
EXPIRE room:a3kx9m2p:participant:user-uuid-1 14400

# Remove participant
SREM room:a3kx9m2p:participants user-uuid-1
DEL room:a3kx9m2p:participant:user-uuid-1
HINCRBY room:a3kx9m2p:state participant_count -1
```

#### Signaling Pub/Sub

| Key | Type | Purpose |
|-----|------|---------|
| `sig:{roomId}` | Pub/Sub Channel | Cross-node WebSocket event relay |

```redis
# Node A publishes
PUBLISH sig:a3kx9m2p '{"event":"participant:joined","payload":{"id":"user-2","name":"Bob"}}'

# Node B subscribes
SUBSCRIBE sig:a3kx9m2p
```

#### Session Management

| Key | Type | TTL | Purpose | Writer | Reader |
|-----|------|-----|---------|--------|--------|
| `session:{userId}:ws` | STRING | 12h | Which WS node this user is connected to | WS Gateway | WS Gateway (for targeted messages) |
| `session:{userId}:rooms` | SET | 12h | Room IDs the user is currently in | WS Gateway | WS Gateway, API |

```redis
SET session:user-uuid-1:ws ws-node-01 EX 43200
SADD session:user-uuid-1:rooms a3kx9m2p
```

#### Rate Limiting

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `ratelimit:{ip}:{endpoint}` | Sorted Set | Window duration | Sliding window rate limiting by IP |
| `ratelimit:{userId}:{action}` | Sorted Set | Window duration | Per-user rate limiting |

```redis
# Sliding window implementation
ZADD ratelimit:192.168.1.1:/api/auth/login <now_ms> <now_ms>
ZREMRANGEBYSCORE ratelimit:192.168.1.1:/api/auth/login 0 <now_ms - window_ms>
ZCARD ratelimit:192.168.1.1:/api/auth/login  # Compare against limit
EXPIRE ratelimit:192.168.1.1:/api/auth/login <window_seconds>
```

---

## 4. State Ownership Matrix

| State | Owner | Storage | TTL | Justification |
|-------|-------|---------|-----|---------------|
| User identity (email, name, password) | API | PostgreSQL | Permanent | Source of truth for accounts |
| Room configuration (title, max, settings) | API | PostgreSQL | Permanent | Persistent links and room settings |
| Room active state (status, participant count) | WS Gateway | Redis | 24h | High read/write volume, completely ephemeral |
| Participant presence | WS Gateway | Redis | 4h (renewed on heartbeat) | Needs fast broadcast on connect/disconnect |
| Participant media state (muted, camera) | Browser → WS | Redis (synced via WS) | 4h | Browser is source of truth, Redis replicates for sync |
| WebRTC connection | Browser | Browser memory | Session | Purely transient ICE/SDP state |
| Local media tracks | Browser | Browser memory | Session | Re-acquirable from devices |
| Remote media tracks | SFU → Browser | SFU + browser memory | Session | SFU re-sends on reconnect |
| Quality metrics (live) | Browser | Browser memory | Session | Computed from getStats() |
| Quality metrics (periodic) | Backend | Redis (brief buffer) → PostgreSQL | 90 days (PG) | Batched writes prevent PG overload |
| Call history | Backend | PostgreSQL | Permanent | Audit trail |
| Chat messages (if persisted) | Backend | PostgreSQL | Permanent | Phase 2 consideration |

---

## 5. Data Flow Lifecycle

### 5.1 Room Created

```
User clicks "New Room"
  → API: INSERT INTO rooms (id, owner_id, status='waiting', ...)
  → No Redis interaction yet (no participants)
```

### 5.2 Participant Joins

```
User joins room
  → API: INSERT INTO room_participants (room_id, user_id, display_name, role, joined_at)
  → Redis: SADD room:{roomId}:participants {participantId}
  → Redis: HSET room:{roomId}:participant:{pid} display_name "Alice" muted false camera_on true
  → Redis: HINCRBY room:{roomId}:state participant_count 1
  → Redis: PUBLISH sig:{roomId} '{"event":"participant:joined",...}'
  → If first participant: UPDATE rooms SET status='active', Redis: HSET room:{id}:state status active
```

### 5.3 During Call

```
Mute toggle:
  → Browser: update local state
  → WS: send participant:updated { muted: true }
  → Backend: Redis HSET room:{roomId}:participant:{pid} muted true
  → Backend: PUBLISH sig:{roomId} participant:updated event
  → Other clients: receive event, update UI

Quality metrics (every 30 seconds):
  → Browser: QualityMonitor.getMetrics()
  → WS: send quality:report { metrics }
  → Backend: buffer in memory (batch)
  → Backend: every 60 seconds, bulk INSERT INTO call_quality_snapshots
```

### 5.4 Call Ends

```
Last participant leaves:
  → Backend: Start 5-minute grace period
  → If nobody rejoins:
    → Redis: DEL room:{roomId}:state, room:{roomId}:participants
    → PostgreSQL: UPDATE rooms SET status='ended', ended_at=NOW()
    → PostgreSQL: UPDATE call_sessions SET ended_at=NOW(), duration_seconds=...
    → PostgreSQL: UPDATE call_sessions SET quality_summary = (aggregated from snapshots)
```

### 5.5 Quality Data Pipeline

```
Browser (every 2s) → getStats() → QualityMonitor → metrics in memory
Browser (every 30s) → batch report → WebSocket → Backend
Backend → buffer in goroutine (max 100 or 60 seconds) → bulk INSERT → call_quality_snapshots
Call end → aggregate snapshots into call_sessions.quality_summary JSONB
Partition maintenance → drop partitions > 90 days
```

---

## 6. Scaling Considerations

### 6.1 PostgreSQL Connection Pooling

**PgBouncer** in transaction mode is required in production.

- Each Go backend instance opens a pool of 20-50 connections to PgBouncer
- PgBouncer maintains a smaller pool of actual PostgreSQL connections
- Transaction mode: connections are returned to pool after each transaction (not held for session)

```
Go Backend #1 ──┐
Go Backend #2 ──┤──► PgBouncer (pool: 100) ──► PostgreSQL (max_connections: 200)
Go Backend #N ──┘
```

### 6.2 Redis Memory Estimation

| Component | Memory per Unit | Scale Factor |
|-----------|----------------|-------------|
| Room state hash | ~200 bytes | × active rooms |
| Participant set | ~50 bytes per member | × active participants |
| Participant hash | ~300 bytes | × active participants |
| Session tracking | ~100 bytes per user | × connected users |
| Rate limiting | ~50 bytes per entry | × active rate limit keys |

**Projections:**
- 100 active rooms × 5 participants: ~350 KB
- 1,000 active rooms × 5 participants: ~3.5 MB
- 10,000 active rooms × 5 participants: ~35 MB
- 100,000 active rooms × 5 participants: ~350 MB

A single Redis instance with 1 GB RAM handles up to ~100K concurrent rooms easily.

### 6.3 When to Scale

| Component | Trigger | Solution |
|-----------|---------|----------|
| PostgreSQL reads slow | Dashboard/analytics queries competing with writes | Add read replica |
| PostgreSQL connections exhausted | >200 concurrent backend instances | Increase PgBouncer pool |
| Redis memory >75% | ~75K+ concurrent rooms | Upgrade instance size or add Redis Cluster |
| Redis Pub/Sub throughput | >100K messages/second | Redis Cluster with sharded pub/sub |
| Quality snapshots table large | >100M rows in active partitions | Reduce retention from 90 to 30 days, or move to TimescaleDB |

### 6.4 Go Data Access Layer

```go
// internal/db/db.go
package db

import (
    "context"
    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
    Pool *pgxpool.Pool
}

func Connect(ctx context.Context, databaseURL string) (*DB, error) {
    config, err := pgxpool.ParseConfig(databaseURL)
    if err != nil {
        return nil, err
    }
    config.MaxConns = 30
    config.MinConns = 5

    // CRITICAL: pgx v5 defaults to QueryExecModeCacheStatement, which uses
    // protocol-level prepared statements tied to a specific PostgreSQL backend.
    // PgBouncer in transaction-pooling mode (§6.1) returns backends to the pool
    // after each transaction, so the next query may land on a different backend
    // where the prepared statement doesn't exist — producing intermittent
    // "prepared statement does not exist" errors under load.
    //
    // QueryExecModeSimpleProtocol sends the query as a simple text command,
    // avoiding prepared statements entirely. This is safe for our use case and
    // compatible with PgBouncer transaction mode.
    //
    // See: https://github.com/jackc/pgx/issues/1562
    config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

    pool, err := pgxpool.NewWithConfig(ctx, config)
    if err != nil {
        return nil, err
    }

    if err := pool.Ping(ctx); err != nil {
        return nil, err
    }

    return &DB{Pool: pool}, nil
}

func (db *DB) Close() {
    db.Pool.Close()
}
```

> **⚠️ PgBouncer compatibility:** If you ever change the connection pooler or remove PgBouncer,
> you can switch back to `QueryExecModeCacheDescribe` for better performance (avoids re-parsing
> queries). But with PgBouncer in transaction mode, `SimpleProtocol` is mandatory.

```go
// internal/room/store.go
package room

import (
    "context"
    "github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
    db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
    return &Store{db: db}
}

func (s *Store) Create(ctx context.Context, room *Room) error {
    _, err := s.db.Exec(ctx,
        `INSERT INTO rooms (id, owner_id, title, type, status, max_participants, settings)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        room.ID, room.OwnerID, room.Title, room.Type, room.Status,
        room.MaxParticipants, room.Settings,
    )
    return err
}

func (s *Store) GetByID(ctx context.Context, id string) (*Room, error) {
    var room Room
    err := s.db.QueryRow(ctx,
        `SELECT id, owner_id, title, type, status, max_participants, settings,
                created_at, updated_at, ended_at
         FROM rooms WHERE id = $1`,
        id,
    ).Scan(
        &room.ID, &room.OwnerID, &room.Title, &room.Type, &room.Status,
        &room.MaxParticipants, &room.Settings,
        &room.CreatedAt, &room.UpdatedAt, &room.EndedAt,
    )
    if err != nil {
        return nil, err
    }
    return &room, nil
}

func (s *Store) UpdateStatus(ctx context.Context, id string, status string) error {
    _, err := s.db.Exec(ctx,
        `UPDATE rooms SET status = $1, updated_at = NOW() WHERE id = $2`,
        status, id,
    )
    return err
}
```

```go
// internal/redis/room.go
package redis

import (
    "context"
    "fmt"
    "github.com/redis/go-redis/v9"
    "time"
)

type RoomState struct {
    client *redis.Client
}

func NewRoomState(client *redis.Client) *RoomState {
    return &RoomState{client: client}
}

func (rs *RoomState) SetRoomActive(ctx context.Context, roomID string) error {
    key := fmt.Sprintf("room:%s:state", roomID)
    pipe := rs.client.Pipeline()
    pipe.HSet(ctx, key, map[string]interface{}{
        "status":            "active",
        "participant_count": 0,
        "started_at":        time.Now().Unix(),
    })
    pipe.Expire(ctx, key, 24*time.Hour)
    _, err := pipe.Exec(ctx)
    return err
}

func (rs *RoomState) AddParticipant(ctx context.Context, roomID, participantID, displayName string) error {
    pipe := rs.client.Pipeline()

    participantsKey := fmt.Sprintf("room:%s:participants", roomID)
    pipe.SAdd(ctx, participantsKey, participantID)
    pipe.Expire(ctx, participantsKey, 24*time.Hour)

    pKey := fmt.Sprintf("room:%s:participant:%s", roomID, participantID)
    pipe.HSet(ctx, pKey, map[string]interface{}{
        "display_name": displayName,
        "muted":        "false",
        "camera_on":    "true",
        "quality":      "5",
        "joined_at":    time.Now().Unix(),
    })
    pipe.Expire(ctx, pKey, 4*time.Hour)

    stateKey := fmt.Sprintf("room:%s:state", roomID)
    pipe.HIncrBy(ctx, stateKey, "participant_count", 1)

    _, err := pipe.Exec(ctx)
    return err
}

func (rs *RoomState) RemoveParticipant(ctx context.Context, roomID, participantID string) error {
    pipe := rs.client.Pipeline()
    pipe.SRem(ctx, fmt.Sprintf("room:%s:participants", roomID), participantID)
    pipe.Del(ctx, fmt.Sprintf("room:%s:participant:%s", roomID, participantID))
    pipe.HIncrBy(ctx, fmt.Sprintf("room:%s:state", roomID), "participant_count", -1)
    _, err := pipe.Exec(ctx)
    return err
}

func (rs *RoomState) GetParticipants(ctx context.Context, roomID string) ([]string, error) {
    return rs.client.SMembers(ctx, fmt.Sprintf("room:%s:participants", roomID)).Result()
}
```
