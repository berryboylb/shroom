# Shroom Implementation Plan

This document outlines the comprehensive implementation plan for Shroom, a lightweight, resilient video calling platform alternative to Google Meet.

**Stack:** Go backend, React/TypeScript/Vite/Tailwind/shadcn frontend, PostgreSQL, Redis, LiveKit (SFU), coturn (TURN), Docker.

---

## Phase 1: Foundation (Week 1-2)

### Step 1.1: Repository Setup
**1. Objective:** Initialize the monorepo structure, tooling, and basic configuration to establish a solid foundation for both frontend and backend development.
**2. Files to create:**
- `/go.mod`, `/go.sum`
- `/frontend/package.json`, `/frontend/vite.config.ts`, `/frontend/tsconfig.json`
- `/Makefile`
- `/.env.example`
- `/.gitignore`, `/.editorconfig`
- `/frontend/.eslintrc.cjs`, `/frontend/.prettierrc`
- `/.golangci.yml`
**3. Files to modify:** None
**4. Key interfaces/types:** N/A
**5. Dependencies:** None
**6. Implementation details:** 
- Run `go mod init github.com/shroom/backend`.
- Run `npm create vite@latest frontend -- --template react-ts`.
- Set up Makefile targets: `dev`, `build`, `lint`, `test`, `db-migrate`.
- Configure `golangci-lint` with standard rules (errcheck, govet, staticcheck).
**7. Tests:** N/A
**8. Acceptance criteria:** `make lint` passes on both frontend and backend. 
**9. Failure cases:** Dependency conflicts in JS; Go module path mismatches.
**10. What must work before moving on:** Repository must be cloneable and lintable without errors.

### Step 1.2: Docker Compose Local Dev Stack
**1. Objective:** Create a reproducible local development environment encompassing all backing services.
**2. Files to create:**
- `/docker-compose.yml`
- `/docker/postgres/init.sql`
- `/docker/redis/redis.conf`
- `/docker/livekit/livekit.yaml`
- `/docker/coturn/turnserver.conf`
- `/Caddyfile` (Reverse proxy)
**3. Files to modify:** `/.env.example`
**4. Key interfaces/types:** N/A
**5. Dependencies:** 1.1 Repository Setup
**6. Implementation details:**
- Define services: `postgres` (image: postgres:16-alpine), `redis` (image: redis:7-alpine), `livekit` (image: livekit/livekit-server:latest), `coturn` (image: coturn/coturn:latest).
- Use `air` for Go hot-reloading in a separate `backend` service if desired, or run backend locally outside docker. Provide network mapping.
- Map Caddy to port 80/443 for local TLS or 8080 for HTTP routing to `/api` and `/`.
**7. Tests:** Basic connection tests via Makefile (`make check-services`).
**8. Acceptance criteria:** `docker compose up -d` successfully starts all containers. Services are accessible on mapped ports.
**9. Failure cases:** Port conflicts on host machine.
**10. What must work before moving on:** All containers stay in "running" state; logs show successful initialization.

### Step 1.3: Database Migrations
**1. Objective:** Set up database schema versioning and create the initial tables.
**2. Files to create:**
- `backend/migrations/001_create_users.up.sql`
- `backend/migrations/001_create_users.down.sql`
- `backend/migrations/002_create_rooms.up.sql`
- `backend/migrations/002_create_rooms.down.sql`
- `backend/migrations/003_create_participants.up.sql`
- `backend/migrations/003_create_participants.down.sql`
- `backend/migrations/004_create_sessions.up.sql`
- `backend/migrations/004_create_sessions.down.sql`
- `backend/migrations/005_create_quality.up.sql`
- `backend/migrations/005_create_quality.down.sql`
- `backend/migrations/006_create_refresh_tokens.up.sql`
- `backend/migrations/006_create_refresh_tokens.down.sql`
- `scripts/seed_dev.sh`
**3. Files to modify:** `Makefile` (add `migrate-up`, `migrate-down` commands)
**4. Key interfaces/types:** N/A
**5. Dependencies:** 1.2 Docker Compose (running Postgres)
**6. Implementation details:**
- Install `golang-migrate/migrate`.
- **The source of truth for all table definitions, column names, types, and indexes is [database.md](database.md).** Copy the CREATE TABLE statements from that document verbatim into the migration files. Do not restate or simplify the schema here.
- One migration file pair per table (matching the naming convention in database.md).
- Migration path is `backend/migrations/` (not repo root).
**7. Tests:** N/A
**8. Acceptance criteria:** `make migrate-up` succeeds, all 6 tables exist in Postgres with correct columns and indexes.
**9. Failure cases:** Invalid SQL syntax, connection refused to Postgres.
**10. What must work before moving on:** Schema correctly applied to database, matches database.md exactly.

### Step 1.4: Configuration
**1. Objective:** Implement type-safe configuration loading for the Go backend.
**2. Files to create:**
- `/backend/internal/config/config.go`
**3. Files to modify:** `/backend/cmd/server/main.go`
**4. Key interfaces/types:**
```go
type Config struct {
    Server   ServerConfig
    Database DatabaseConfig
    Redis    RedisConfig
    LiveKit  LiveKitConfig
}
```
**5. Dependencies:** 1.1 Repository Setup
**6. Implementation details:** Use `joho/godotenv` to load `.env`. Use `kelseyhightower/envconfig` for parsing env vars into the `Config` struct. Validate required fields.
**7. Tests:** Write `/backend/internal/config/config_test.go` testing missing fields.
**8. Acceptance criteria:** Server fails to start if required configs are missing.
**9. Failure cases:** Missing default values leading to silent failures.
**10. What must work before moving on:** Configuration loads cleanly on startup.

---

## Phase 2: Backend Core (Week 2-4)

### Step 2.1: HTTP Server Foundation
**1. Objective:** Establish the Go HTTP server with routing and core middleware.
**2. Files to create:**
- `/backend/cmd/server/main.go`
- `/backend/internal/server/server.go`
- `/backend/internal/middleware/logging.go`
**3. Files to modify:** `/backend/internal/config/config.go`
**4. Key interfaces/types:**
```go
type Server struct {
    router *chi.Mux
    config *config.Config
}
```
**5. Dependencies:** 1.4 Configuration
**6. Implementation details:** Use `go-chi/chi`. Implement slog middleware. Setup `context.WithTimeout` for graceful shutdown handling `SIGINT`/`SIGTERM`.
**7. Tests:** Test `/health` endpoint returns 200 OK.
**8. Acceptance criteria:** Server starts, responds to `/health`, logs request, and shuts down gracefully.
**9. Failure cases:** Dangling goroutines during shutdown.
**10. What must work before moving on:** Robust server lifecycle management.

### Step 2.2: Authentication
**1. Objective:** Implement user identity and session management.
**2. Files to create:**
- `/backend/internal/auth/handler.go`, `service.go`, `jwt.go`
**3. Files to modify:** `/backend/internal/server/server.go` (register routes)
**4. Key interfaces/types:**
```go
type AuthService interface {
    Register(ctx context.Context, email, password string) (User, error)
    Login(ctx context.Context, email, password string) (Tokens, error)
}
```
**5. Dependencies:** 1.3 DB Migrations, 2.1 HTTP Server
**6. Implementation details:** Use `golang.org/x/crypto/bcrypt`. Use `golang-jwt/jwt/v5`. Generate short-lived Access Token (15m) and long-lived Refresh Token (7d). Store Refresh Tokens in Redis for revocation.
**7. Tests:** Unit tests for password hashing, JWT signing/verification. Integration tests for login flow.
**8. Acceptance criteria:** Can successfully register, login, and access a protected route with JWT.
**9. Failure cases:** Weak JWT secrets, SQL injection in auth queries.
**10. What must work before moving on:** Secure endpoints verifying JWT correctly.

### Step 2.3: Room Management
**1. Objective:** Handle room creation and state logic.
**2. Files to create:**
- `/backend/internal/room/handler.go`, `service.go`, `repository.go`
**3. Files to modify:** `/backend/internal/server/server.go`
**4. Key interfaces/types:**
```go
type RoomService interface {
    CreateRoom(ctx context.Context, userID uuid.UUID) (Room, error)
    JoinRoom(ctx context.Context, roomID string, userID uuid.UUID) (JoinResponse, error)
}
```
**5. Dependencies:** 2.2 Authentication
**6. Implementation details:** Create 9-character room IDs (e.g., `abc-defg-hij`). `JoinRoom` must generate a LiveKit access token using `livekit/server-sdk-go` and return it.
**7. Tests:** Mock LiveKit SDK, test room generation collision avoidance.
**8. Acceptance criteria:** Authenticated user can create a room, receive a room ID, and fetch a LiveKit join token.
**9. Failure cases:** LiveKit token generation fails due to bad API keys.
**10. What must work before moving on:** Valid LiveKit tokens returned from API.

### Step 2.4: WebSocket Gateway
**1. Objective:** Establish persistent connections for real-time signaling.
**2. Files to create:**
- `/backend/internal/ws/hub.go`, `client.go`, `handler.go`
**3. Files to modify:** `/backend/internal/server/server.go`
**4. Key interfaces/types:**
```go
type Hub struct {
    register   chan *Client
    unregister chan *Client
    clients    map[*Client]bool
}
```
**5. Dependencies:** 2.2 Authentication
**6. Implementation details:** Use `gorilla/websocket`. Authenticate via query param token or initial WS message. Implement ping/pong (every 30s). Integrate Redis Pub/Sub for scaling multiple WS nodes.
**7. Tests:** Connection establishment and ping/pong timeout test.
**8. Acceptance criteria:** Client can connect to `/ws`, authenticate, and stay connected.
**9. Failure cases:** Memory leaks from unclosed WS connections.
**10. What must work before moving on:** WS connection stability.

---

## Phase 3: Signaling (Week 4-5)

### Step 3.1: Room Signaling
**1. Objective:** Synchronize room participants and state over WS.
**2. Files to create:** `/backend/internal/ws/room_manager.go`
**3. Files to modify:** `/backend/internal/ws/hub.go`
**4. Key interfaces/types:**
```typescript
interface WSMessage { type: 'join' | 'leave' | 'state', payload: any }
```
**5. Dependencies:** 2.4 WebSocket Gateway
**6. Implementation details:** When user joins room, broadcast to others. Track participant state (audio muted, video on) in Redis.
**7. Tests:** Integration test for broadcasting `user_joined`.
**8. Acceptance criteria:** Joining a room via WS notifies other connected clients.
**9. Failure cases:** Race conditions in tracking state across nodes.
**10. What must work before moving on:** State replication across clients.

### Step 3.2: WebRTC Signaling
**1. Objective:** Relay WebRTC specific negotiation messages.
**2. Files to create:** `/backend/internal/ws/webrtc.go`
**3. Files to modify:** `/backend/internal/ws/client.go`
**4. Key interfaces/types:**
```go
type SignalMessage struct { Target string `json:"target"`; Data interface{} `json:"data"` }
```
**5. Dependencies:** 3.1 Room Signaling
**6. Implementation details:** Implement routing of SDP Offers, Answers, and ICE Candidates between specific clients using Redis Pub/Sub routing.
**7. Tests:** Test message routing between two mocked WS clients.
**8. Acceptance criteria:** Can exchange SDP/ICE JSON payloads.
**9. Failure cases:** Malformed SDP strings crashing parsers.
**10. What must work before moving on:** Point-to-point message delivery.

### Step 3.3: Presence
**1. Objective:** Track active sessions and handle ghost connections.
**2. Files to create:** `/backend/internal/presence/service.go`
**3. Files to modify:** `/backend/internal/ws/client.go`
**4. Key interfaces/types:** N/A
**5. Dependencies:** 2.4 WebSocket Gateway
**6. Implementation details:** Use Redis SETEX to maintain presence TTL. WS handler refreshes TTL on Ping. If WS drops, clean up presence after 10s grace period.
**7. Tests:** Test presence expiration in Redis.
**8. Acceptance criteria:** Client disconnecting removes them from presence list within 15 seconds.
**9. Failure cases:** False positives during brief network blips.
**10. What must work before moving on:** Accurate global presence tracking.

---

## Phase 4: Media (Week 5-7)

### Step 4.1: Local Media
**1. Objective:** Access and manage user media devices in the browser.
**2. Files to create:** `/frontend/src/hooks/useMediaDevices.ts`, `/frontend/src/lib/media.ts`
**3. Files to modify:** N/A
**4. Key interfaces/types:**
```typescript
interface DeviceState { audioInputs: MediaDeviceInfo[]; videoInputs: MediaDeviceInfo[] }
```
**5. Dependencies:** 1.1 Repository Setup (Frontend)
**6. Implementation details:** Use `navigator.mediaDevices.getUserMedia` and `enumerateDevices`. Handle permission denied errors gracefully.
**7. Tests:** Mock `navigator.mediaDevices` in Vitest.
**8. Acceptance criteria:** UI can list available cameras/mics and show local preview.
**9. Failure cases:** Browsers without permissions API support.
**10. What must work before moving on:** Robust device acquisition.

### Step 4.2: WebRTC Connection (via LiveKit)
**1. Objective:** Connect to SFU and publish/subscribe tracks.
**2. Files to create:** `/frontend/src/hooks/useLiveKitRoom.ts`
**3. Files to modify:** N/A
**4. Key interfaces/types:** N/A
**5. Dependencies:** 2.3 Room Management, 4.1 Local Media
**6. Implementation details:** Use `@livekit/components-react` or `livekit-client`. Fetch token from backend API. Connect to `ws://localhost:7880`. Publish local tracks.
**7. Tests:** Unit test token retrieval.
**8. Acceptance criteria:** Can connect to LiveKit and see own track in LiveKit dashboard.
**9. Failure cases:** Token validation failures.
**10. What must work before moving on:** Successful SFU connection.

### Step 4.3: Call UI
**1. Objective:** Build the primary video grid interface.
**2. Files to create:** `/frontend/src/components/Room.tsx`, `/frontend/src/components/VideoTile.tsx`
**3. Files to modify:** `/frontend/src/App.tsx`
**4. Key interfaces/types:** N/A
**5. Dependencies:** 4.2 WebRTC Connection
**6. Implementation details:** Implement a flex/grid layout that dynamically adjusts based on participant count. Use shadcn buttons for controls.
**7. Tests:** Component rendering tests with mocked participants.
**8. Acceptance criteria:** Video grid displays remote participants properly.
**9. Failure cases:** Layout breaks with >10 participants.
**10. What must work before moving on:** Basic AV communication between two tabs.

### Step 4.4: Device Management
**1. Objective:** Handle runtime device changes.
**2. Files to create:** `/frontend/src/components/DeviceSettings.tsx`
**3. Files to modify:** `/frontend/src/hooks/useMediaDevices.ts`
**4. Key interfaces/types:** N/A
**5. Dependencies:** 4.1 Local Media, 4.3 Call UI
**6. Implementation details:** Listen to `devicechange` event. Allow selecting specific devices and applying constraints to active tracks via LiveKit SDK.
**7. Tests:** Verify event listener attachments.
**8. Acceptance criteria:** User can switch camera mid-call.
**9. Failure cases:** Device disconnected while in use causing crash.
**10. What must work before moving on:** Graceful fallback on device removal.

---

## Phase 5: Network Resilience (Week 7-9)

### Step 5.1: Connection Quality Monitoring
**1. Objective:** Monitor WebRTC stats for quality metrics.
**2. Files to create:** `/frontend/src/lib/qualityMonitor.ts`
**3. Files to modify:** `/frontend/src/hooks/useLiveKitRoom.ts`
**4. Key interfaces/types:**
```typescript
interface NetworkStats { rtt: number; packetLoss: number; score: 1|2|3|4|5 }
```
**5. Dependencies:** 4.2 WebRTC Connection
**6. Implementation details:** Parse `RTCPeerConnection.getStats()`. Calculate derived score.
**7. Tests:** Mock stats responses and verify score computation.
**8. Acceptance criteria:** Quality score logged to console dynamically.
**9. Failure cases:** Cross-browser differences in stats implementation.
**10. What must work before moving on:** Reliable stats extraction.

### Step 5.2: Adaptive Quality
**1. Objective:** Adjust streams based on network conditions.
**2. Files to create:** N/A
**3. Files to modify:** `/frontend/src/hooks/useLiveKitRoom.ts`
**4. Key interfaces/types:** N/A
**5. Dependencies:** 5.1 Connection Quality
**6. Implementation details:** Enable LiveKit Adaptive Stream and Dynacast. Let the SDK handle simulcast layer selection automatically, ensure it's configured in Room connect options.
**7. Tests:** N/A (Integration test dependent)
**8. Acceptance criteria:** Video degrades instead of freezing on bad connection.
**9. Failure cases:** Aggressive degradation causing poor UX.
**10. What must work before moving on:** Simulcast functioning.

### Step 5.3: Reconnection
**1. Objective:** Recover from network interruptions.
**2. Files to create:** `/frontend/src/lib/reconnect.ts`
**3. Files to modify:** `/frontend/src/components/Room.tsx`
**4. Key interfaces/types:** N/A
**5. Dependencies:** 4.2 WebRTC Connection
**6. Implementation details:** Handle `RoomEvent.Reconnecting` and `RoomEvent.Disconnected`. Show UI overlay. Configure ICE restarts.
**7. Tests:** Trigger offline state in browser, assert reconnect logic.
**8. Acceptance criteria:** Call recovers if wifi is disabled and re-enabled.
**9. Failure cases:** Reconnection loop.
**10. What must work before moving on:** ICE restart logic.

### Step 5.4: Edge Cases
**1. Objective:** Handle OS/browser level interruptions.
**2. Files to create:** `/frontend/src/hooks/useVisibility.ts`
**3. Files to modify:** `/frontend/src/components/Room.tsx`
**4. Key interfaces/types:** N/A
**5. Dependencies:** 4.3 Call UI
**6. Implementation details:** Handle `visibilitychange` for mobile backgrounding (iOS Safari pauses video).
**7. Tests:** Simulate visibility change events.
**8. Acceptance criteria:** Video resumes when returning to tab.
**9. Failure cases:** Audio context suspended by OS.
**10. What must work before moving on:** Stable behavior across tab switches.

---
*(Phases 6-9 follow the same rigorous structure, implementing Design Systems, Observability with Prometheus/Grafana, comprehensive testing suites, and production deployment via Docker/K8s).*

## Phase 6: Frontend Polish (Week 9-11)
### Step 6.1: Design System
(Objective: Configure Tailwind, shadcn, dark mode. Setup UI foundations.)
### Step 6.2: Responsive Design
(Objective: Ensure mobile, tablet, and desktop layouts work seamlessly.)
### Step 6.3: UX for Bad Conditions
(Objective: Build robust UI overlays for reconnecting and error states.)
### Step 6.4: Accessibility
(Objective: Keyboard navigation, ARIA tags, contrast ratios.)

## Phase 7: Observability (Week 11-12)
### Step 7.1: Backend Observability
(Objective: Prometheus metrics, structured slog logs, Grafana dashboard.)
### Step 7.2: Client Quality Telemetry
(Objective: Send client WebRTC stats to backend for aggregation.)
### Step 7.3: Diagnostics
(Objective: Build an internal debug page `/#/diagnostics` for calls.)

## Phase 8: Testing (Week 12-14)
### Step 8.1: Backend Tests
(Objective: Unit + Integration tests using testcontainers for Postgres/Redis.)
### Step 8.2: Frontend Tests
(Objective: Vitest + Testing Library for components.)
### Step 8.3: E2E Tests
(Objective: Playwright scenarios with fake media streams.)
### Step 8.4: Network Simulation
(Objective: Docker-compose network throttling tests.)
### Step 8.5: Chaos Tests
(Objective: Documented runbooks for node failure recovery.)

## Phase 9: Production Hardening (Week 14-16)
### Step 9.1: Security Hardening
(Objective: Rate limits, secure headers, CORS, input validation.)
### Step 9.2: Performance
(Objective: Code splitting, bundle analysis, compression.)
### Step 9.3: Production Docker
(Objective: Multi-stage non-root distroless containers.)
### Step 9.4: Deployment
(Objective: TLS, compose files, reverse proxy production configs.)
