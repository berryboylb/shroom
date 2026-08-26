# Shroom — Architecture Blueprint

**Version:** 1.0.0
**Date:** 2026-08-26
**Status:** Active — Source of Truth

> A production-grade, lightweight, resilient video calling platform.
> The network should be allowed to become terrible without the call becoming terrible.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Principles](#2-product-principles)
3. [Research Findings](#3-research-findings)
4. [Architecture Overview](#4-architecture-overview)
5. [Architectural Decision Records](#5-architectural-decision-records)
6. [Backend Architecture](#6-backend-architecture)
7. [Frontend Architecture](#7-frontend-architecture)
8. [WebRTC Client Architecture](#8-webrtc-client-architecture)
9. [Signaling Architecture](#9-signaling-architecture)
10. [SFU Architecture](#10-sfu-architecture)
11. [STUN/TURN Architecture](#11-stunturn-architecture)
12. [Network Adaptation Strategy](#12-network-adaptation-strategy)
13. [Audio Architecture](#13-audio-architecture)
14. [Video Architecture](#14-video-architecture)
15. [Device/Browser Compatibility Matrix](#15-devicebrowser-compatibility-matrix)
16. [Failure-Mode Matrix](#16-failure-mode-matrix)
17. [Recovery Strategies](#17-recovery-strategies)
18. [Security Architecture](#18-security-architecture)
19. [Database Architecture](#19-database-architecture)
20. [Redis Usage](#20-redis-usage)
21. [State Ownership](#21-state-ownership)
22. [Observability Architecture](#22-observability-architecture)
23. [UX Philosophy & Design System](#23-ux-philosophy--design-system)
24. [UX for Bad Conditions](#24-ux-for-bad-conditions)
25. [Accessibility](#25-accessibility)
26. [Performance Budgets](#26-performance-budgets)
27. [End-to-End Flows](#27-end-to-end-flows)
28. [State Machines](#28-state-machines)
29. [Participant Scaling Model](#29-participant-scaling-model)
30. [Infrastructure Architecture](#30-infrastructure-architecture)
31. [Cost Model](#31-cost-model)
32. [Testing Strategy](#32-testing-strategy)
33. [Security Threat Model](#33-security-threat-model)
34. [Development Phases](#34-development-phases)
35. [Technical Risks & Unknowns](#35-technical-risks--unknowns)
36. [Architectural Invariants](#36-architectural-invariants)

**Reference Documents:**
- [API Contracts](docs/api-contracts.md)
- [Database Schema & Redis](docs/database.md)
- [Repository File Structure](docs/file-structure.md)
- [Implementation Plan](docs/implementation-plan.md)

---

## 1. Executive Summary

Shroom is a video calling platform built to work reliably across the widest possible range of real-world conditions — poor networks, old devices, mobile browsers, restrictive firewalls — while presenting a modern, lightweight interface that feels nothing like corporate communication software.

### Core Architecture

```
┌─────────────┐    HTTPS/WSS     ┌──────────────┐    Redis Pub/Sub    ┌──────────────┐
│   Browser    │◄───────────────►│   Go Backend  │◄──────────────────►│    Redis      │
│  (React/TS)  │                 │  (API + WS)   │                    │  (Ephemeral)  │
└──────┬───────┘                 └──────┬────────┘                    └──────────────┘
       │                                │
       │ WebRTC (SRTP/UDP)              │ LiveKit Server SDK
       │                                │
       ▼                                ▼
┌──────────────┐                 ┌──────────────┐
│   LiveKit     │◄──────────────►│  PostgreSQL   │
│   SFU Server  │                │ (Persistent)  │
└──────┬────────┘                └──────────────┘
       │
       │ STUN/TURN (UDP/TCP)
       ▼
┌──────────────┐
│    coturn     │
│  TURN Server  │
└──────────────┘
```

### Key Decisions (Summarized)

| Decision | Choice | Primary Reason |
|----------|--------|---------------|
| Media routing | SFU (LiveKit) | O(1) client upload, adaptive per-subscriber quality |
| SFU implementation | LiveKit (open-source) | Go-native, production-proven, Pion-based, Apache 2.0 |
| Signaling transport | WebSocket | Full-duplex, universal browser support, persistent |
| Primary video codec | H.264 | Universal hardware acceleration including Safari/iOS |
| Primary audio codec | Opus | Industry standard, built-in FEC, excellent packet-loss resilience |
| TURN server | coturn | Battle-tested, TURN REST API for time-limited credentials |
| Backend language | Go | Performance, concurrency, Pion/LiveKit ecosystem |
| Frontend framework | React + TypeScript + Vite | Developer productivity, ecosystem, type safety |
| Persistent storage | PostgreSQL | ACID, proven, excellent for relational data |
| Ephemeral state | Redis | Sub-millisecond latency, pub/sub, TTL-based expiry |
| State management | Zustand (minimal) | Lightweight, no boilerplate, outside React tree |

### What This Architecture Enables

- **1:1 and small group calls** (2–25 participants) in Phase 1
- **Graceful degradation** from 1080p → audio-only based on real-time metrics
- **Auto-recovery** from network failures, device changes, and backend restarts
- **Sub-2-second reconnection** in most scenarios
- **Works on**: Chrome, Firefox, Safari, Edge, Android Chrome, iOS Safari, low-end Android devices
- **TURN fallback** for restrictive networks (corporate firewalls, CGNAT, symmetric NAT)
- **Real-time quality monitoring** with diagnostic capability per-call

---

## 2. Product Principles

1. **Reliability over features.** A call that works on bad internet is more valuable than a call with virtual backgrounds on good internet.
2. **Audio over video.** If one must be sacrificed, it is always video.
3. **Degrade, don't crash.** Every failure mode has a degraded state that keeps the user connected.
4. **Detect, don't assume.** Browser capabilities, network quality, device power — all detected at runtime, never assumed.
5. **Lightweight.** Minimal JavaScript, fast time-to-interactive, low memory footprint.
6. **Anti-corporate.** The UI should feel human, modern, and something people choose to use — not endure.
7. **Observable.** When a user says "the call was bad," we can determine exactly why.
8. **Simple until forced to be complex.** No premature abstractions, no unnecessary microservices, no infrastructure without justification.
9. **Performance is a feature.** Bundle size, connection time, CPU usage — all have budgets.
10. **Honest about limitations.** If a device or browser cannot support WebRTC, say so clearly. Do not pretend.

---

## 3. Research Findings

### 3.1 WebRTC Browser Landscape (2026)

**Universal support:** WebRTC is natively supported in all modern browsers. No plugins required.

**Critical finding — iOS:** ALL iOS browsers (Chrome, Edge, Firefox on iOS) use the WebKit WebRTC engine due to Apple's App Store policy. Safari's WebRTC limitations apply universally on iOS.

**Safari-specific limitations:**
- Strongly prefers H.264 (hardware-accelerated). VP8/VP9 fall back to software decoding → high CPU, battery drain
- Simulcast support is present but less flexible than Chrome
- mDNS IP anonymization enabled by default → breaks P2P without TURN
- Background tab: camera tracks immediately paused on iOS when app is minimized
- AV1 support is limited/unsupported

**Low-end Android devices (2GB RAM, older SoCs):**
- Thermal throttling causes cascading frame drops, audio jitter, app crashes
- Must hard-cap to 360p/15fps and enforce hardware-only codecs (H.264 or VP8)
- Background blur, noise suppression, and AI features must be disabled
- Monitor `getStats()` processingTime to detect throttling before the OS intervenes

**Codec availability (2026):**

| Codec | Chrome/Edge | Firefox | Safari (macOS/iOS) | Decision |
|-------|-------------|---------|-------------------|----------|
| H.264 | ✅ HW | ✅ | ✅ HW (preferred) | **Primary** — universal HW support |
| VP8 | ✅ | ✅ | ✅ SW (high CPU) | Fallback only |
| VP9 | ✅ | ✅ partial | ⚠️ SW (high CPU) | Not used initially |
| AV1 | ✅ | ✅ (v136+) | ❌ Limited | Future — when Safari ships HW support |
| Opus | ✅ | ✅ | ✅ | **Audio standard** |

**Key API availability:**
- `MediaDevices` + `getDisplayMedia`: Universal on desktop. Mobile screen sharing heavily restricted.
- Insertable Streams / Encoded Transform: Chromium only. Safari does NOT support → affects E2EE strategy.
- WebTransport: Baseline support as of March 2026. Not needed for initial architecture.
- Wake Lock API: Keeps screen on when tab is visible only. Does NOT prevent background throttling.

### 3.2 SFU Architecture Landscape

**SFU dominance confirmed.** SFU provides the best balance for our scale:
- Client uploads once (O(1) upload bandwidth)
- SFU forwards to each subscriber (no transcoding = low server CPU)
- Per-subscriber quality adaptation via simulcast layer selection
- Mesh is limited to 3-5 participants. MCU costs 10-50x more server CPU.

**LiveKit selected over alternatives:**

| SFU | Language | Verdict |
|-----|----------|---------|
| **LiveKit** | Go | ✅ Selected. Batteries-included, Apache 2.0, Pion-based, production-proven, client SDKs for all platforms, native cascading, excellent docs |
| mediasoup | Node/C++ | Strong engine but requires building all room/signaling logic. Better for custom protocols |
| Janus | C | Mature but GPLv3, steep C codebase, designed as a gateway not a modern SFU |
| Pion | Go | Toolkit, not a product. LiveKit is built on Pion. Use Pion if building a custom SFU |
| ion-sfu | Go | Community momentum shifted to LiveKit |

**Simulcast vs SVC:**
- Simulcast: 3 separate encodes (e.g., 1080p/720p/360p). ~43% extra upload bandwidth, 2.5x encoder CPU. Universally supported.
- SVC: Single encode with nested layers. 10-25% bandwidth savings. Primarily VP9/AV1 — poor Safari support.
- **Decision:** Use H.264 Simulcast for Phase 1. Maximum compatibility. Revisit SVC when Safari AV1 HW support ships.

**Scaling model:**
- Horizontal: Different rooms → different SFU instances (Redis-backed assignment)
- Cascading: For rooms spanning regions, link SFUs via backbone to avoid cross-ocean per-user streams
- Single SFU handles 100+ participants per room for receive-only scenarios

### 3.3 Network Resilience

**Bandwidth estimation:** Google Congestion Control (GCC) with Transport-CC (TWCC) is the dominant paradigm. TWCC sends packet-level arrival timestamps to the sender, enabling accurate sender-side BWE. More accurate than legacy REMB.

**Packet loss handling layers:**
1. Opus RED: Redundant audio frames → recovers single-packet loss without latency
2. Video FEC: Parity packets for mathematical reconstruction
3. NACK: Request retransmission of specific missing packets (effective when RTT < ~200ms)
4. PLI/FIR: Request fresh keyframe when too many packets lost for recovery

**Tolerances:**
- Audio: Handles up to ~10% loss gracefully with RED + PLC (Packet Loss Concealment)
- Video: Noticeably degrades above 5% loss

**Quality thresholds (from getStats()):**

| Quality | RTT | Jitter | Packet Loss |
|---------|-----|--------|-------------|
| Excellent (Green) | < 150ms | < 30ms | < 1% |
| Good (Yellow) | 150-300ms | 30-50ms | 1-5% |
| Poor (Red) | > 300ms | > 50ms | > 5% |

**ICE restart:** When `iceconnectionstatechange` fires `disconnected` or `failed`, call `createOffer({ iceRestart: true })` to generate new ICE credentials and restart gathering without destroying the RTCPeerConnection. Typical recovery: 1-5 seconds.

**Background/sleep behavior:**
- iOS: Camera tracks immediately paused when minimized. Audio can sometimes persist.
- Android: More forgiving — background audio usually continues, video pauses.
- Desktop: JavaScript timers throttled to 1-minute intervals in background tabs → signaling timeouts.
- Mitigation: Web Workers for critical timers, WebSocket push for signaling, invisible Web Audio track to maintain tab priority.

### 3.4 Security & Infrastructure

**DTLS-SRTP is mandatory** for all WebRTC connections. The browser enforces this — media is always encrypted in transit.

**E2EE with SFU:** Possible via `RTCRtpScriptTransform` (Insertable Streams) + SFrame protocol. The SFU forwards encrypted payloads it cannot decrypt. **However, Safari support for Insertable Streams is inconsistent.** Decision: Do NOT implement E2EE in Phase 1. Revisit when Safari support stabilizes. DTLS-SRTP provides strong transport encryption regardless.

**TURN usage in production:** 15-40% of calls require TURN relay (higher on mobile/enterprise). This is the largest variable cost driver.

**TURN credential strategy:** TURN REST API with time-limited credentials. Backend generates `[unix_timestamp]:[user_id]` username + HMAC-SHA1 signature using shared secret. TTL: 24 hours. No database storage needed.

**Go ecosystem maturity:**
- Pion: Massive maturity, pure Go (no Cgo), used by OpenAI Realtime API infrastructure
- LiveKit: Production-grade, actively maintained, strong community
- gorilla/websocket: Stable, widely used. nhooyr/websocket for zero-allocation paths.

---

## 4. Architecture Overview

### 4.1 System Architecture Diagram

```mermaid
graph TB
    subgraph "Client (Browser)"
        UI["React UI<br/>(Features/Components)"]
        CS["CallSession<br/>(Lifecycle)"]
        MM["MediaManager<br/>(Tracks/Devices)"]
        SC["SignalingClient<br/>(WebSocket)"]
        QM["QualityMonitor<br/>(getStats)"]
        AQ["AdaptiveQuality<br/>(Adaptation)"]
    end

    subgraph "Backend (Go)"
        API["HTTP API<br/>(Chi Router)"]
        WSG["WebSocket Gateway<br/>(gorilla/websocket)"]
        AUTH["Auth Service<br/>(JWT/bcrypt)"]
        RM["Room Manager<br/>(Lifecycle)"]
        PM["Participant Manager"]
        SIG["Signaling Service<br/>(SDP/ICE relay)"]
        LK["LiveKit SDK<br/>(Server-side)"]
        QS["Quality Service<br/>(Ingestion)"]
    end

    subgraph "Infrastructure"
        PG["PostgreSQL<br/>(Persistent)"]
        RD["Redis<br/>(Ephemeral + Pub/Sub)"]
        LKSFU["LiveKit SFU<br/>(Media Routing)"]
        CT["coturn<br/>(TURN Relay)"]
    end

    UI --> CS
    UI --> MM
    CS --> SC
    CS --> MM
    CS --> QM
    QM --> AQ
    AQ --> CS

    SC -- "WSS" --> WSG
    CS -- "WebRTC/SRTP" --> LKSFU
    CS -- "STUN/TURN" --> CT

    WSG --> SIG
    WSG --> RM
    WSG --> PM
    API --> AUTH
    API --> RM
    API --> QS

    RM --> PG
    RM --> RD
    AUTH --> PG
    SIG --> RD
    SIG --> LK
    LK --> LKSFU
    QS --> PG

    WSG -- "Pub/Sub" --> RD
```

### 4.2 Technology Responsibility Map

| Responsibility | Technology | Why |
|---------------|-----------|-----|
| **Signaling** (SDP, ICE, room events) | WebSocket (Go → browser) | Full-duplex, persistent, universal support |
| **Media transport** (audio/video) | WebRTC RTP/SRTP over UDP | Real-time, low latency, browser-native |
| **Media routing** | LiveKit SFU | Forwards packets without transcoding, per-subscriber adaptation |
| **NAT traversal** | STUN (built into LiveKit) + coturn (TURN) | STUN for discovery, TURN for relay when direct fails |
| **Media encryption** | DTLS-SRTP (mandatory in WebRTC) | Transport encryption, browser-enforced |
| **Application API** | Go HTTP (Chi router) | REST endpoints for rooms, auth, quality |
| **Real-time state broadcast** | Redis Pub/Sub | Cross-node WebSocket event relay |
| **Ephemeral room state** | Redis hashes/sets with TTL | Participant presence, media state, routing |
| **Persistent data** | PostgreSQL | Users, rooms, call history, quality summaries |
| **Frontend rendering** | React + TypeScript | Component model, ecosystem, type safety |
| **Styling** | Tailwind CSS + shadcn/ui | Utility-first, customizable, accessible base |
| **Client state** | Zustand (minimal stores) | Lightweight, no boilerplate, works outside React tree |
| **Build** | Vite | Fast HMR, efficient bundling, ESM-native |

### 4.3 What Does NOT Belong Where

| Do NOT put this... | In this place... | Put it here instead |
|--------------------|-----------------|---------------------|
| WebRTC logic | React components | `src/call/`, `src/media/`, `src/quality/` modules |
| Media track management | Global store | `MediaManager` class |
| Room UI state | Zustand | React component state or CallProvider context |
| Ephemeral presence | PostgreSQL | Redis with TTL |
| Call history | Redis | PostgreSQL |
| Quality metrics (raw) | PostgreSQL | Browser memory → periodic batch → PostgreSQL (aggregated) |
| TURN credentials | Database | Generated on-the-fly via HMAC-SHA1 |
| Signaling events | REST API | WebSocket |
| File uploads | Go backend | Object storage (S3/R2) via pre-signed URLs |

---

## 5. Architectural Decision Records

### ADR-001: SFU over MCU and Mesh

**Decision:** Use an SFU (Selective Forwarding Unit) for media routing.

**Context:** Three architectures exist for multi-party WebRTC: Mesh (P2P), SFU, and MCU.

**Alternatives Considered:**
- **Mesh:** Each client sends to every other client. Upload bandwidth = O(N-1). Encoder CPU = O(N-1). Fails beyond 3-5 participants on mobile. No server-side adaptation possible.
- **MCU:** Server decodes all streams, composites into one, re-encodes. Single stream to each client. Server CPU = 10-50x higher than SFU. Cannot adapt per-subscriber.
- **SFU:** Client uploads once. SFU forwards to each subscriber. Server routes packets without transcoding. Per-subscriber quality via simulcast layer selection.

**Decision Rationale:**
- O(1) upload from each client → works on mobile and constrained networks
- No server-side transcoding → dramatically lower server cost
- Per-subscriber adaptation → each receiver gets quality matching their network
- LiveKit (our chosen SFU) handles simulcast layer switching automatically

**Tradeoffs:**
- Download bandwidth scales O(N-1) per client (mitigated by simulcast — only active speaker at high quality)
- Cannot composite a single grid view server-side (not needed for our use case)
- Requires TURN fallback for clients behind restrictive NATs

**Consequences:** Architecture must include simulcast encoding on clients and layer-switching logic on the SFU.

---

### ADR-002: LiveKit as SFU

**Decision:** Use LiveKit (open-source, self-hosted) as the SFU rather than building a custom SFU or using mediasoup/Janus.

**Context:** We need a production-grade SFU that integrates well with our Go backend.

**Alternatives Considered:**
- **Build custom SFU with Pion:** Maximum flexibility. Massive engineering effort (6-12 months for production quality). Pion is a toolkit, not a product.
- **mediasoup:** Excellent performance (C++ media plane). Requires Node.js control plane. Unopinionated — we'd need to build room logic, signaling, reconnection, simulcast switching ourselves.
- **Janus:** Mature but GPLv3 license. C codebase with steeper learning curve. Plugin architecture adds complexity.
- **LiveKit:** Go-based SFU built on Pion. Apache 2.0. Includes: room management, participant tracking, simulcast/SVC, client SDKs (JS, React, Go, Swift, Kotlin), server SDK for control, cascading for multi-region. Production-proven (used by major platforms).

**Decision Rationale:**
- Go-native: integrates naturally with our Go backend via server SDK
- Batteries-included: room management, track management, simulcast switching handled
- Client SDK: `livekit-client-sdk-js` provides the complete WebRTC lifecycle (connection, tracks, reconnection, quality adaptation)
- Apache 2.0: no license concerns
- Active development: regular releases, responsive community
- Reduces time-to-market by months compared to building on raw Pion

**Tradeoffs:**
- Dependency on LiveKit's abstractions and update cycle
- Less low-level control than raw Pion (acceptable for our use case)
- Must run LiveKit server as additional infrastructure component

**Consequences:**
- Frontend uses `livekit-client-sdk-js` for WebRTC
- Backend uses `livekit-server-sdk-go` for room/token management
- Our WebSocket signaling handles room-level events (chat, presence, custom state); LiveKit handles media signaling internally
- LiveKit server runs as a separate Docker service

---

### ADR-003: H.264 as Primary Video Codec

**Decision:** Use H.264 as the primary video codec with simulcast. Do not use VP9, AV1, or HEVC as primary codecs.

**Context:** Codec choice directly affects device compatibility, CPU usage, battery life, and quality.

**Alternatives Considered:**
- **VP9:** Better compression than H.264 at same quality. BUT: Safari uses software decoding → high CPU, battery drain on Apple devices. Breaks our compatibility goal.
- **AV1:** Best compression efficiency. BUT: No hardware decode on Safari/iOS, older Android devices, many laptops. Not viable as primary codec in 2026.
- **HEVC (H.265):** Excellent on Apple devices (HW accelerated). BUT: Firefox has no support at all. Cannot be primary.
- **VP8:** Universal support but oldest codec. Worse compression than H.264. No advantage.

**Decision Rationale:**
- H.264 has hardware acceleration on every platform: Chrome, Firefox, Safari, iOS, Android, Intel, AMD, Apple Silicon, Qualcomm
- Hardware acceleration means: lower CPU usage, lower power consumption, no thermal throttling
- Safari/iOS strongly prefers H.264 — our biggest compatibility risk
- LiveKit handles H.264 simulcast natively

**Consequences:**
- SDP offers must prefer H.264 with proper profile levels
- Three simulcast layers: high (720p+), medium (360p), low (180p)
- Clients that can handle VP9/AV1 may negotiate up in future phases

---

### ADR-004: Opus for Audio

**Decision:** Use Opus as the sole audio codec.

**Rationale:** Universal browser support. Built-in FEC (Forward Error Correction). Handles 6-510 kbps. Excellent packet-loss resilience up to ~10% with RED. Supports mono and stereo. Adaptive bitrate built-in. No alternative comes close for real-time communication.

**Configuration:**
- Enable Opus RED (redundant encoding) for packet loss resilience
- Enable DTX (Discontinuous Transmission) to reduce bandwidth when user is silent
- Bitrate: 32 kbps mono for voice (sufficient quality, low bandwidth)
- Sample rate: 48 kHz (Opus native)

---

### ADR-005: Custom WebSocket Signaling + LiveKit Media Signaling

**Decision:** Maintain our own WebSocket signaling layer for application-level events while LiveKit handles its own internal media signaling.

**Context:** LiveKit has its own signaling protocol for SDP/ICE/track management. We need signaling for: room state, participant metadata, chat, custom presence, quality reports.

**Architecture:**
```
Browser ──WSS──► Our Go WebSocket Gateway ──► Room events, chat, presence, quality
Browser ──WSS──► LiveKit Server (internal) ──► SDP, ICE, track, media control
```

**Rationale:**
- Separation of concerns: media signaling (complex, handled by LiveKit) vs application signaling (our domain logic)
- Our WS gateway handles: room join/leave, participant state sync, chat, quality telemetry, presence heartbeat
- LiveKit's protocol handles: SDP offer/answer, ICE candidates, track publish/subscribe, simulcast layer selection
- Avoids reimplementing WebRTC signaling (error-prone, complex)

**Tradeoffs:**
- Two WebSocket connections per client (ours + LiveKit's). Acceptable — browsers support 6+ concurrent connections per origin.
- Must keep room state consistent between our backend and LiveKit's internal state

---

### ADR-006: PostgreSQL + Redis (No Other Databases)

**Decision:** Use PostgreSQL for persistent data and Redis for ephemeral real-time state. No additional databases.

**Rationale:**
- PostgreSQL: ACID-compliant, excellent for relational data (users, rooms, call history). Well-understood. Go ecosystem has excellent drivers (pgx).
- Redis: Sub-millisecond latency for ephemeral state (participant presence, room active state). Pub/Sub for cross-node WebSocket relay. TTL for automatic cleanup.
- No need for MongoDB, Cassandra, TimescaleDB, or ClickHouse in Phase 1. Quality metrics are batched and aggregated before PostgreSQL storage.

**State ownership rule:** If the data survives a server restart, it belongs in PostgreSQL. If it's only relevant while a call is active, it belongs in Redis. If it's only relevant within a single browser tab, it belongs in browser memory.

---

### ADR-007: Zustand over Redux/Context for Client State

**Decision:** Use Zustand for global client state. Do NOT use Redux, MobX, or React Context for state management.

**Rationale:**
- Zustand stores work outside the React tree → can be used by non-React modules (MediaManager, SignalingClient, QualityMonitor)
- No boilerplate (unlike Redux)
- No re-render cascading issues (unlike React Context)
- Tiny bundle size (~1KB)
- Only 2 global stores needed: `authStore` (user, tokens) and `settingsStore` (device preferences, theme)
- Call-specific state lives in `CallSession` class + React component state, NOT in a global store

**What does NOT go in Zustand:**
- Call state (managed by CallSession class, exposed via React context to call components)
- Media tracks (managed by MediaManager)
- WebRTC connection state (managed by LiveKit client SDK)
- Transient UI state (component-local useState)

### ADR-008: Phase 1 MVP Product Behaviors

**Decision:** The Phase 1 MVP will enforce low-friction onboarding with specific fallback and resolution states, defined as follows:
1. **Optional Accounts & Guest Access:** User registration is completely optional. Guests do not need an account to create or join a meeting.
2. **Ephemeral Rooms:** Rooms created by guests issue a temporary `host_token` in `LocalStorage`. The room and its data are automatically purged 24 hours after the last participant leaves.
3. **Mandatory Pre-Join Lobby:** A Google Meet-style lobby is mandatory. Guests must test mic/camera, grant hardware permissions, and enter a display name *before* joining the call.
4. **JWT Transport Strategy:** Long-lived Refresh tokens use secure `HttpOnly` cookies. Short-lived Access tokens are kept in memory and passed via the WebSocket payload (`ws:authenticate`) to bypass WebSocket header limitations.
5. **Production Infrastructure:** Phase 1 targets a Single VPS (e.g., DigitalOcean, Hetzner) using `docker-compose`. LiveKit requires open UDP port ranges (e.g., 50000-60000), making standard Serverless/PaaS platforms unviable.
6. **Network Degradation UX:** When the aggressive network manager kills a user's video to save their audio, the UI broadcasts a `video_suspended_network` state, rendering a distinct "Poor Connection" overlay (rather than a black screen, which implies voluntary mute).
7. **Split-Brain Resolution:** Our WebSocket is the absolute source of truth. If a WebSocket drops for >15s without reconnecting, the Go backend forces LiveKit to kick the user via the Server API, ensuring they drop from both systems simultaneously.

**Rationale:** These decisions close critical implementation gaps while staying true to the "low friction, anti-corporate, highly resilient" product vision.

---

## 6. Backend Architecture

### 6.1 Overview

The Go backend is a single binary that serves:
1. **HTTP API** — RESTful endpoints for auth, rooms, health, quality ingestion
2. **WebSocket gateway** — persistent connections for real-time room events
3. **Background workers** — stale session cleanup, quality aggregation

It is NOT a microservice architecture. Premature decomposition adds complexity without benefit at our scale. The binary can be horizontally scaled by running multiple instances behind a load balancer, with Redis providing cross-node coordination.

### 6.2 Package Structure

```
backend/
├── main.go                 # Entry point: config → deps → server.Start()
├── internal/
│   ├── config/             # Environment-based configuration
│   ├── server/             # HTTP server, middleware, routes
│   ├── auth/               # Registration, login, JWT, middleware
│   ├── room/               # Room CRUD, lifecycle, state machine
│   ├── participant/        # Participant tracking
│   ├── ws/                 # WebSocket gateway, hub, events, presence
│   ├── signal/             # LiveKit integration, token generation
│   ├── quality/            # Quality report ingestion and aggregation
│   ├── turn/               # TURN credential generation
│   ├── redis/              # Redis client, room state, pub/sub
│   ├── db/                 # PostgreSQL connection, query helpers
│   ├── metrics/            # Prometheus metric definitions
│   └── errors/             # Structured error types
├── migrations/             # SQL migrations (golang-migrate)
└── tests/                  # Integration tests
```

### 6.3 Dependency Injection

No framework. Simple struct composition in `main.go`:

```go
func main() {
    cfg := config.Load()

    db := db.Connect(cfg.DatabaseURL)
    rdb := redis.NewClient(cfg.RedisURL)
    lkClient := livekit.NewClient(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)

    authStore := auth.NewStore(db)
    authService := auth.NewService(authStore, cfg.JWTSecret)

    roomStore := room.NewStore(db)
    roomRedis := redis.NewRoomState(rdb)
    roomService := room.NewService(roomStore, roomRedis, lkClient)

    // ... wire remaining services

    srv := server.New(cfg, authService, roomService, /* ... */)
    srv.Start()
}
```

### 6.4 Middleware Stack

Applied in order:
1. **Request ID** — generates unique ID per request, adds to context and response header
2. **Structured logging** — logs method, path, status, duration, request ID (slog, JSON format)
3. **Recovery** — catches panics, returns 500, logs stack trace
4. **CORS** — configurable origins, credentials support
5. **Rate limiting** — per-IP sliding window via Redis (configurable per endpoint)
6. **Authentication** — JWT validation middleware (applied to protected routes only)

### 6.5 Graceful Shutdown

```go
// In server.Start():
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()

// 1. Stop accepting new HTTP connections
// 2. Close WebSocket hub (send close frames to all clients)
// 3. Wait for in-flight requests (30s timeout)
// 4. Close Redis connection
// 5. Close database pool
// 6. Exit
```

### 6.6 WebSocket Gateway Design

The WebSocket gateway manages persistent connections for real-time events.

**Connection lifecycle:**
1. Client connects to `GET /ws` with JWT in query parameter
2. Server validates JWT, upgrades to WebSocket
3. Server creates `Conn` wrapper with read/write goroutines
4. Client sends `room:join` event
5. Server adds connection to room's subscriber set
6. Server broadcasts room state to all subscribers
7. On disconnect: cleanup, notify other participants, update Redis

**Hub pattern:**
```go
type Hub struct {
    rooms     map[string]map[string]*Conn  // roomID → connID → Conn
    register  chan *Conn
    unregister chan *Conn
    broadcast  chan *RoomMessage
    mu        sync.RWMutex
}
```

**Cross-node messaging:** When multiple backend instances run behind a load balancer, a `room:join` on node A must notify participants connected to node B. Redis Pub/Sub channel per room (`sig:{roomId}`) relays events across nodes.

**Keepalive:** Ping/pong every 30 seconds. If no pong received within 10 seconds, connection is considered dead and cleaned up.

---

## 7. Frontend Architecture

### 7.1 Philosophy

The frontend is structured around two principles:
1. **Feature-based organization** — pages and their components grouped by feature, not by type
2. **Extracted non-UI modules** — WebRTC, signaling, media, and quality logic lives in plain TypeScript classes/modules outside of React

This separation ensures that:
- WebRTC logic can be tested without rendering React components
- The same media/signaling logic could theoretically power a different UI framework
- React components are thin wrappers that subscribe to state and render

### 7.2 Module Architecture

```
src/
├── features/          # React pages and components (UI layer)
│   ├── auth/          # Login, register pages
│   ├── home/          # Landing page, create/join room
│   ├── lobby/         # Pre-join device preview
│   ├── call/          # Call page, video grid, controls
│   └── settings/      # User settings
├── media/             # Media acquisition and device management (no React)
├── call/              # Call session lifecycle (no React)
├── signaling/         # WebSocket client (no React)
├── quality/           # Quality monitoring and adaptation (no React)
├── stores/            # Zustand stores (auth, settings)
├── hooks/             # Shared React hooks
├── components/ui/     # shadcn/ui base components
├── lib/               # Utilities, API client, constants
└── types/             # Shared TypeScript types
```

### 7.3 Module Boundaries

| Module | Knows About | Does NOT Know About |
|--------|------------|-------------------|
| `media/` | Browser MediaDevices API, tracks, constraints | React, UI, signaling, rooms |
| `call/` | LiveKit client SDK, media module, signaling | React components, DOM, CSS |
| `signaling/` | WebSocket API, event types | Media tracks, WebRTC, React |
| `quality/` | getStats(), metric thresholds | React, UI, specific adaptation implementation |
| `features/call/` | React, call module's state, quality state | WebRTC internals, SDP, ICE |
| `stores/` | Zustand | React rendering, call state |

### 7.4 Key Non-UI Classes

#### `MediaManager` (src/media/MediaManager.ts)

Manages local media track acquisition and device lifecycle.

```typescript
class MediaManager {
  // State
  private localAudioTrack: MediaStreamTrack | null;
  private localVideoTrack: MediaStreamTrack | null;
  private devices: MediaDeviceInfo[];

  // Public API
  async requestMedia(constraints: MediaConstraints): Promise<void>;
  async switchCamera(deviceId: string): Promise<void>;
  async switchMicrophone(deviceId: string): Promise<void>;
  muteAudio(): void;
  unmuteAudio(): void;
  enableVideo(): void;
  disableVideo(): void;
  getLocalAudioTrack(): MediaStreamTrack | null;
  getLocalVideoTrack(): MediaStreamTrack | null;
  getDevices(): MediaDeviceInfo[];

  // Events
  on(event: 'deviceChange' | 'trackEnded' | 'permissionDenied', handler): void;

  // Cleanup
  dispose(): void;
}
```

**Does NOT know about:** LiveKit, signaling, React, rooms.

#### `CallSession` (src/call/CallSession.ts)

Orchestrates a single call lifecycle. Wraps LiveKit Room.

```typescript
class CallSession {
  // Dependencies
  private mediaManager: MediaManager;
  private signalingClient: SignalingClient;
  private qualityMonitor: QualityMonitor;
  private lkRoom: LivekitRoom;

  // State (observable)
  state: CallState; // 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'
  participants: Map<string, Participant>;
  networkQuality: NetworkQuality;

  // Public API
  async join(roomId: string, token: string, turnServers: RTCIceServer[]): Promise<void>;
  async leave(): Promise<void>;
  toggleMute(): void;
  toggleCamera(): void;
  getParticipant(id: string): Participant;

  // Events
  on(event: 'stateChange' | 'participantJoined' | 'participantLeft' | 'qualityChange', handler): void;

  // Cleanup
  dispose(): void;
}
```

**Does NOT know about:** React, DOM, CSS, specific UI components.

#### `SignalingClient` (src/signaling/SignalingClient.ts)

Manages WebSocket connection to our backend for room-level events.

```typescript
class SignalingClient {
  private ws: WebSocket | null;
  private reconnectAttempt: number;

  // Public API
  connect(url: string, token: string): void;
  disconnect(): void;
  send(event: string, payload: unknown): void;

  // Events
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler): void;

  // State
  get connectionState(): 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
}
```

Includes built-in exponential backoff reconnection (1s, 2s, 4s, 8s, 16s, max 30s, with ±500ms jitter).

#### `QualityMonitor` (src/quality/QualityMonitor.ts)

Polls WebRTC stats and computes quality scores.

```typescript
class QualityMonitor {
  // Polls getStats() every 2 seconds
  start(peerConnection: RTCPeerConnection): void;
  stop(): void;

  // Current metrics
  getMetrics(): QualityMetrics;
  getScore(): QualityScore; // 1-5

  // Events
  on(event: 'qualityChange' | 'alert', handler): void;
}

interface QualityMetrics {
  rtt: number;          // ms
  jitter: number;       // ms
  packetLoss: number;   // percentage (0-100)
  bitrate: number;      // kbps
  frameRate: number;    // fps
  resolution: { width: number; height: number };
  codec: string;
  freezeCount: number;
  audioLevel: number;   // 0-1
  iceState: string;
  candidateType: string; // 'host' | 'srflx' | 'relay'
}

type QualityScore = 1 | 2 | 3 | 4 | 5;
// 5 = Excellent, 4 = Good, 3 = Fair, 2 = Poor, 1 = Very Poor
```

### 7.5 React Integration

The `CallPage` connects non-UI modules to React rendering via a `CallProvider`:

```typescript
// features/call/CallProvider.tsx
function CallProvider({ roomId, children }: Props) {
  const [callSession] = useState(() => new CallSession(/* deps */));
  const [state, setState] = useState<CallState>('connecting');
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [quality, setQuality] = useState<QualityScore>(5);

  useEffect(() => {
    callSession.on('stateChange', setState);
    callSession.on('participantJoined', /* update participants */);
    callSession.on('participantLeft', /* update participants */);
    callSession.on('qualityChange', setQuality);

    callSession.join(roomId, token, turnServers);
    return () => callSession.dispose();
  }, [roomId]);

  return (
    <CallContext.Provider value={{ callSession, state, participants, quality }}>
      {children}
    </CallContext.Provider>
  );
}
```

Components consume state via `useCall()` hook:

```typescript
function ControlBar() {
  const { callSession, state } = useCall();
  return (
    <div>
      <MuteButton onClick={() => callSession.toggleMute()} />
      <CameraButton onClick={() => callSession.toggleCamera()} />
      <LeaveButton onClick={() => callSession.leave()} disabled={state === 'reconnecting'} />
    </div>
  );
}
```

---

## 8. WebRTC Client Architecture

### 8.1 LiveKit Client SDK Integration

We use `livekit-client-sdk-js` which wraps the raw WebRTC API and provides:
- Automatic ICE restart on connection failure
- Automatic TURN fallback
- Simulcast with automatic layer switching
- Track publish/subscribe management
- Connection quality monitoring
- Reconnection with state recovery
- Adaptive bitrate based on subscriber bandwidth

This means we do NOT need to build:
- Raw PeerConnection management
- Manual ICE candidate handling
- Manual SDP offer/answer
- Manual simulcast layer selection
- Manual reconnection logic

We DO need to build:
- `MediaManager` — because we want control over device acquisition before publishing to LiveKit
- `QualityMonitor` — to supplement LiveKit's quality events with our own metrics and scoring
- `AdaptiveQuality` — to make application-level decisions (e.g., switch to audio-only) based on quality data
- `CallSession` — to orchestrate the overall call lifecycle including our signaling + LiveKit

### 8.2 Connection Flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant API as Go Backend API
    participant WS as Go WebSocket
    participant LK as LiveKit Server
    participant CT as coturn

    B->>API: POST /api/rooms/{id}/join (JWT)
    API-->>B: { wsUrl, lkToken, turnServers }

    par Signaling Connection
        B->>WS: Connect WebSocket (JWT)
        WS-->>B: ws:authenticated
        B->>WS: room:join { roomId }
        WS-->>B: room:joined { participants, state }
    and Media Connection
        B->>LK: Connect (lkToken, turnServers)
        LK-->>B: Connected
        B->>LK: Publish audio + video tracks
        LK-->>B: Remote tracks from other participants
    end

    Note over B,CT: If direct connection fails, LiveKit automatically falls back to TURN via coturn
```

### 8.3 Track Lifecycle

```
User grants permission → MediaManager acquires tracks
    → CallSession publishes tracks to LiveKit Room
        → LiveKit encodes simulcast layers (high/medium/low)
            → SFU forwards appropriate layer to each subscriber
                → Subscriber renders remote track in <video> element
```

**Track states:**
- `live` — track is active and producing media
- `muted` — track exists but is not sending media (user muted)
- `ended` — track has been permanently stopped (device disconnected, permission revoked)

**When a track ends unexpectedly** (device unplugged, permission revoked):
1. `MediaManager` detects `track.onended` event
2. Emits `trackEnded` event with track kind (audio/video)
3. `CallSession` updates participant state
4. UI shows appropriate fallback (avatar for video, "mic disconnected" for audio)
5. `MediaManager` attempts to reacquire if another device is available

---

## 9. Signaling Architecture

### 9.1 Dual Signaling Model

Shroom uses two concurrent signaling channels:

1. **Our WebSocket** — for application-level events (room state, chat, presence, quality reports)
2. **LiveKit's internal signaling** — for media-level events (SDP, ICE, track management)

This separation is intentional:
- LiveKit's signaling is highly optimized for WebRTC media negotiation
- Our signaling carries domain-specific events that LiveKit doesn't know about
- If our WebSocket drops, the LiveKit media connection continues uninterrupted
- If LiveKit reconnects, our application state is preserved

### 9.2 Our WebSocket Protocol

**Message format:**
```typescript
interface WSMessage {
  event: string;      // e.g., 'room:join', 'participant:updated'
  payload: unknown;   // event-specific data
  id?: string;        // optional message ID for request/response correlation
}
```

**Serialization:** JSON over WebSocket text frames. Binary frames not needed for signaling.

### 9.3 Participant Lifecycle (via our signaling)

```mermaid
stateDiagram-v2
    [*] --> Connecting: POST /api/rooms/:id/join
    Connecting --> Authenticating: WebSocket opened
    Authenticating --> Joining: ws:authenticated
    Joining --> Connected: room:joined (receive room state)
    Connected --> Connected: participant:updated (state changes)
    Connected --> Reconnecting: WebSocket drops
    Reconnecting --> Connected: WebSocket restored + room:join
    Reconnecting --> Disconnected: Max retries exceeded
    Connected --> Leaving: room:leave
    Leaving --> [*]: room:left
    Disconnected --> [*]: cleanup
```

### 9.4 Room State Synchronization

When a participant joins:
1. Backend sends `room:joined` with full current state (participant list, their media states) and the participant's own `participantId`
2. Subsequent changes arrive as delta events (`participant:joined`, `participant:updated`, `participant:left`)
3. If the client reconnects (WebSocket drop), it re-sends `room:join` **with its previous `participantId`**. The backend recognizes this as a resume (not a fresh join), skips creating a duplicate participant record, increments `join_count`, and returns fresh full state → this is the **resync** mechanism
4. If the `participantId` is missing or not found in Redis (stale session), the backend treats it as a fresh join

This avoids complex CRDT or OT algorithms. Full state on join, deltas during session, full state on reconnect. The `participantId` field prevents double-counting during reconnect storms.

---

## 10. SFU Architecture

### 10.1 LiveKit Server Configuration

LiveKit runs as a separate Docker service in our stack.

**Key configuration:**
```yaml
port: 7880           # WebSocket signaling
rtc:
  port_range_start: 50000  # UDP media port range
  port_range_end: 60000
  use_external_ip: true
  tcp_fallback_port: 7881  # TCP fallback when UDP blocked
keys:
  devkey: secret     # API key/secret pair
turn:
  enabled: true
  domain: turn.shroom.app
  tls_port: 5349     # TURN over TLS (port 443 in production)
  udp_port: 3478     # TURN over UDP
```

### 10.2 Simulcast Configuration

Three layers published by each client:

| Layer | Resolution | Bitrate | Frame Rate | Purpose |
|-------|-----------|---------|------------|---------|
| High (f) | 720p | 2500 kbps | 30 fps | Active speaker, fullscreen |
| Medium (h) | 360p | 500 kbps | 20 fps | Grid view, thumbnail |
| Low (q) | 180p | 150 kbps | 15 fps | Minimal visibility, many participants |

LiveKit automatically selects which layer to forward to each subscriber based on:
- Subscriber's available bandwidth (TWCC)
- Video element size on subscriber's screen
- Whether the participant is visible in the subscriber's viewport

### 10.3 SFU Scaling Strategy

**Phase 1 (MVP):** Single LiveKit instance. Handles up to ~100 concurrent participants across all rooms.

**Phase 2 (Growth):** Multiple LiveKit instances behind a load balancer. Redis-based room-to-SFU assignment. Each room is pinned to one SFU instance.

**Phase 3 (Scale):** LiveKit's built-in multi-node support with cascading. Rooms can span multiple SFU instances across regions. Backbone connections between SFUs reduce cross-region bandwidth.

---

## 11. STUN/TURN Architecture

### 11.1 Why TURN Matters

**15-40% of calls require TURN relay.** This percentage is higher for:
- Mobile users on carrier-grade NAT (CGNAT)
- Enterprise users behind corporate firewalls
- Users on VPNs
- Users behind symmetric NATs

Without TURN, these users simply cannot connect. TURN is not optional — it is critical infrastructure.

### 11.2 TURN Architecture

```
Client → STUN (discover public IP) → attempt direct to SFU
         ↓ (if direct fails)
Client → TURN UDP (port 3478) → relay to SFU
         ↓ (if UDP blocked)
Client → TURN TCP (port 443) → relay to SFU
         ↓ (if TCP blocked by DPI)
Client → TURN TLS (port 443, masquerade as HTTPS) → relay to SFU
```

### 11.3 coturn Configuration

```
# coturn.conf
listening-port=3478
tls-listening-port=5349
alt-listening-port=443          # TURN over TLS on 443 for firewall bypass
use-auth-secret
static-auth-secret=SHARED_SECRET  # Same secret as Go backend for HMAC verification
realm=shroom.app
cert=/etc/ssl/shroom.pem
pkey=/etc/ssl/shroom.key
no-cli
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255   # Block private ranges
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
```

### 11.4 TURN Credential Generation (Go)

```go
func GenerateTURNCredentials(userID string, sharedSecret string, ttl time.Duration) (username, credential string) {
    timestamp := time.Now().Add(ttl).Unix()
    username = fmt.Sprintf("%d:%s", timestamp, userID)

    mac := hmac.New(sha1.New, []byte(sharedSecret))
    mac.Write([]byte(username))
    credential = base64.StdEncoding.EncodeToString(mac.Sum(nil))

    return username, credential
}
```

TTL: 24 hours. Credentials are generated per join request and not stored.

### 11.5 TURN Cost Awareness

TURN relays double bandwidth (in + out) **per relayed leg**. However, an SFU architecture provides a massive scaling advantage for TURN usage. In a mesh (P2P) network, TURN allocations scale **O(N-1)** per client as room size grows (each peer-to-peer connection might need a relay). With an SFU, each client needs exactly **O(1)** TURN allocation (just the client → SFU leg) regardless of how many participants are in the room. This makes TURN costs highly predictable at scale compared to mesh.

At scale:
- 1 Mbps stream × 1 hour = 450 MB transferred through TURN (single leg)
- At $0.09/GB (cloud egress), that's ~$0.04/hour/user on TURN
- If 30% of users need TURN: cost ≈ $0.012/hour/user blended

This is the single largest variable cost in the system.

---

## 12. Network Adaptation Strategy

### 12.1 Quality Tiers

| Tier | Conditions | Video | Audio | Action |
|------|-----------|-------|-------|--------|
| **Excellent** | RTT < 100ms, Loss < 0.5%, BW > 2.5 Mbps | 720p 30fps (high layer) | Opus 32kbps | Full quality |
| **Good** | RTT < 200ms, Loss < 2%, BW > 800 kbps | 360p 20fps (medium layer) | Opus 32kbps | Reduce video |
| **Fair** | RTT < 350ms, Loss < 5%, BW > 300 kbps | 180p 15fps (low layer) | Opus 24kbps | Minimal video |
| **Poor** | RTT < 500ms, Loss < 10%, BW > 50 kbps | OFF (audio-only) | Opus 16kbps | Audio only |
| **Critical** | RTT > 500ms OR Loss > 10% OR BW < 50 kbps | OFF | Opus 12kbps + aggressive FEC | Survival mode |

### 12.2 Adaptation Algorithm

```typescript
class AdaptiveQuality {
  private currentTier: QualityTier = 'excellent';
  private stableCount: number = 0;

  onMetricsUpdate(metrics: QualityMetrics): void {
    const targetTier = this.computeTier(metrics);

    if (targetTier < this.currentTier) {
      // Downgrade immediately (user is suffering)
      this.applyTier(targetTier);
      this.stableCount = 0;
    } else if (targetTier > this.currentTier) {
      // Upgrade cautiously (require 5 consecutive good readings = 10 seconds)
      this.stableCount++;
      if (this.stableCount >= 5) {
        this.applyTier(targetTier);
        this.stableCount = 0;
      }
    } else {
      this.stableCount = 0;
    }
  }
}
```

**Key principle:** Downgrade immediately, upgrade cautiously. This prevents oscillation.

### 12.3 What Happens at Each Level

**Excellent → Good:** LiveKit switches subscriber to medium simulcast layer. User sees slightly lower resolution. No notification needed.

**Good → Fair:** LiveKit switches to low simulcast layer. UI shows subtle quality indicator (yellow dot).

**Fair → Poor:** Video tracks are disabled (stop sending/receiving video). UI transitions to audio-only mode with avatars. Connection quality indicator turns red. User sees "Video paused due to network conditions."

**Poor → Critical:** Audio bitrate reduced. Aggressive FEC enabled (more redundancy at cost of some bandwidth). UI shows "Unstable connection" with reconnect option. If this persists > 30 seconds, suggest the user check their internet connection.

**Any → Disconnected:** LiveKit auto-reconnects (ICE restart, TURN fallback). UI shows reconnecting overlay. If reconnection fails after 30 seconds, show "Connection lost. Attempting to reconnect..." with a manual retry button.

---

## 13. Audio Architecture

### 13.1 Processing Pipeline

```
Microphone → getUserMedia → [Browser: Echo Cancellation] →
  [Browser: Noise Suppression] → [Browser: Auto Gain Control] →
    Opus Encoder (browser) → RTP → SFU → RTP → Opus Decoder (browser) → Speaker
```

**All audio processing happens in the browser.** No server-side audio processing needed for our use case. The browser's built-in AEC (Acoustic Echo Cancellation), NS (Noise Suppression), and AGC (Automatic Gain Control) are mature and sufficient.

### 13.2 Configuration

```typescript
const audioConstraints: MediaTrackConstraints = {
  echoCancellation: true,     // Prevent feedback loops
  noiseSuppression: true,     // Reduce background noise
  autoGainControl: true,      // Normalize volume levels
  sampleRate: 48000,          // Opus native sample rate
  channelCount: 1,            // Mono (voice doesn't need stereo)
};
```

### 13.3 Packet Loss Resilience

- **Opus RED:** Enabled. Includes redundant copy of previous audio frame in each packet. Recovers from single-packet loss with zero latency cost.
- **Opus FEC:** Enabled. Forward Error Correction within the Opus stream. Helps with burst loss up to ~10%.
- **DTX (Discontinuous Transmission):** Enabled. When user is silent, reduces bitrate to near-zero. Saves bandwidth in multi-party calls where only one person speaks at a time.

### 13.4 Device Handling

**Device change detection:**
```typescript
navigator.mediaDevices.addEventListener('devicechange', async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  // Compare with previous device list
  // If current device disappeared, auto-switch to another
  // If new device appeared, notify user (e.g., Bluetooth headset connected)
});
```

**Bluetooth quirks:** When a Bluetooth headset connects/disconnects, the browser may change both input and output devices simultaneously. The `devicechange` event fires, but the new device may not be ready for ~500ms. Add a brief delay before attempting to switch.

### 13.5 Audio Priority

Audio packets are prioritized over video in several ways:
1. **SFU-level:** LiveKit prioritizes audio forwarding when bandwidth is constrained
2. **DSCP marking:** Audio packets are marked with EF (Expedited Forwarding) DSCP when supported
3. **Adaptation:** Video is degraded/disabled before audio quality is reduced
4. **Browser-level:** Chrome's jitter buffer (NetEQ) uses time-stretching (WSOLA) to maintain smooth audio even with jitter

---

## 14. Video Architecture

### 14.1 Encoding Strategy

**Codec:** H.264 Constrained Baseline (for maximum compatibility) or High profile (for better compression on capable devices).

**Simulcast layers (published by each client):**
```typescript
const videoEncodings = [
  { rid: 'q', maxBitrate: 150_000, maxFramerate: 15, scaleResolutionDownBy: 4 },  // 180p
  { rid: 'h', maxBitrate: 500_000, maxFramerate: 20, scaleResolutionDownBy: 2 },  // 360p
  { rid: 'f', maxBitrate: 2_500_000, maxFramerate: 30 },                          // 720p
];
```

### 14.2 Camera Constraints

```typescript
function getVideoConstraints(deviceCapability: 'high' | 'medium' | 'low'): MediaTrackConstraints {
  switch (deviceCapability) {
    case 'high':
      return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    case 'medium':
      return { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20 } };
    case 'low':
      return { width: { ideal: 320 }, height: { ideal: 180 }, frameRate: { ideal: 15 } };
  }
}
```

**Device capability detection:** On first load, request 720p. If the encoder reports high `qualityLimitationReason: 'cpu'` via getStats(), downgrade to medium constraints. If still constrained, downgrade to low. Cache the result in localStorage.

### 14.3 Keyframe Management

- Keyframes are larger than delta frames (5-10x)
- Too many keyframes waste bandwidth
- Too few keyframes delay recovery from packet loss
- LiveKit manages keyframe requests (PLI) automatically when subscribers need them
- We do NOT need to manually manage keyframes in application code

### 14.4 Hardware Acceleration

- H.264: Hardware-accelerated on all modern platforms (Intel QSV, AMD VCE, Apple VideoToolbox, Qualcomm)
- Monitor `encoderImplementation` in getStats() — if it shows "libvpx" instead of hardware, the device is using software encoding
- On mobile devices, hardware encoding is critical for battery life. Software encoding VP9 on a phone will drain battery 3-5x faster.

---

## 15. Device/Browser Compatibility Matrix

| Platform | Browser | Min Version | Video Codec | Simulcast | Screen Share | Audio-Only Fallback | Notes |
|----------|---------|-------------|-------------|-----------|-------------|---------------------|-------|
| Desktop | Chrome | 90+ | H.264 HW | ✅ | ✅ | ✅ | Gold standard |
| Desktop | Firefox | 100+ | H.264 | ✅ | ✅ | ✅ | Strong support |
| Desktop | Safari | 15.4+ | H.264 HW | ⚠️ Limited | ✅ | ✅ | mDNS may require TURN |
| Desktop | Edge | 90+ | H.264 HW | ✅ | ✅ | ✅ | Chromium-based |
| Android | Chrome | 90+ | H.264 HW | ✅ | ❌ | ✅ | No screen share on mobile |
| Android | Samsung Internet | 16+ | H.264 HW | ✅ | ❌ | ✅ | Chromium-based |
| Android | Firefox | 100+ | H.264 | ⚠️ | ❌ | ✅ | Limited simulcast |
| iOS | Safari | 15.4+ | H.264 HW | ⚠️ Limited | ❌ | ✅ | Background → camera paused |
| iOS | Chrome/Edge/Firefox | Any | H.264 HW | ⚠️ Limited | ❌ | ✅ | All use WebKit engine |
| Low-end Android | Chrome | 90+ | H.264 HW | ⚠️ 2 layers | ❌ | ✅ | Cap 360p/15fps |

### Unsupported

| Platform | Reason | Fallback |
|----------|--------|----------|
| Internet Explorer | No WebRTC support | Show "unsupported browser" page with download links |
| Android WebView (bare) | Permission handling issues | Redirect to Chrome |
| Browsers < minimum version | Missing required APIs | Show upgrade message |
| Feature phones without modern browser | No WebRTC capability | No fallback possible — show message |

### Feature Detection Strategy

```typescript
function detectCapabilities(): BrowserCapabilities {
  return {
    webrtc: !!window.RTCPeerConnection,
    getUserMedia: !!navigator.mediaDevices?.getUserMedia,
    getDisplayMedia: !!navigator.mediaDevices?.getDisplayMedia,
    mediaRecorder: !!window.MediaRecorder,
    webSocket: !!window.WebSocket,
    insertableStreams: !!window.RTCRtpScriptTransform,
    audioContext: !!window.AudioContext,
    wakeLock: 'wakeLock' in navigator,
  };
}
```

Never use user-agent sniffing for capability decisions. Always use feature detection.

---

## 16. Failure-Mode Matrix

| Failure | Detection | Impact | Automatic Recovery | User Action |
|---------|-----------|--------|-------------------|-------------|
| **WebSocket disconnects** | `onclose` event | No room events, no chat | Reconnect with exponential backoff (1-30s). Re-join room on success. | None if recovery < 5s. Otherwise: "Reconnecting..." banner |
| **ICE connection fails** | `iceconnectionstatechange → 'failed'` | No media | LiveKit auto ICE restart + TURN fallback | None if recovery < 5s. Otherwise: reconnecting overlay |
| **TURN server unavailable** | ICE gathering timeout, no relay candidates | Cannot connect through firewalls | Retry with backup TURN server (if configured) | "Cannot connect. Check firewall settings." |
| **Camera disconnected** | `track.onended` | No outgoing video | Attempt re-acquisition from another camera | "Camera disconnected" with device selector |
| **Microphone disconnected** | `track.onended` | No outgoing audio | Attempt re-acquisition from another mic | "Microphone disconnected" with device selector |
| **Permission revoked** | `track.onended` + `getUserMedia` throws `NotAllowedError` | No media access | Cannot auto-recover (browser requires user gesture) | "Permission needed" with instructions per browser |
| **Tab backgrounded** | `visibilitychange` event | iOS: camera paused. Desktop: timers throttled | Resume on tab focus. Use Web Worker for critical timers | None (automatic) |
| **Device sleeps** | `visibilitychange` + WebSocket close | Full disconnect | Reconnect everything on wake | Brief reconnecting state |
| **Network switch (Wi-Fi → cellular)** | ICE `disconnected` state | Brief media interruption | ICE restart (1-5s recovery) | None if transparent |
| **Bandwidth drops** | getStats() metrics | Quality degradation | Adaptive quality (lower resolution/fps) | Quality indicator changes color |
| **High packet loss (>10%)** | getStats() metrics | Audio/video artifacts | Audio-only fallback, aggressive FEC | "Poor connection" indicator |
| **Backend restarts** | WebSocket closes, HTTP 502/503 | No API, no signaling | WebSocket reconnect. LiveKit media continues independently | Brief reconnecting banner |
| **SFU restarts** | LiveKit disconnect event | No media | LiveKit auto-reconnect to new SFU instance | Reconnecting overlay |
| **Redis unavailable** | Backend detects connection failure | No cross-node signaling, no room state | Backend operates in degraded single-node mode | Users on other nodes lose presence updates |
| **Database unavailable** | Backend detects connection failure | No new rooms, no auth | Backend returns 503 for affected endpoints | "Service temporarily unavailable" |
| **Browser crash** | N/A (process dies) | Full disconnect | Other participants see "disconnected" after heartbeat timeout (30s) | User must rejoin |
| **VPN connected/disconnected** | Network change, new IP | ICE path changes | ICE restart | Brief interruption |
| **Captive portal** | HTTP requests redirected, WebSocket fails | Full disconnect | Cannot auto-recover (requires user to authenticate with portal) | "Network requires login" if detectable |

---

## 17. Recovery Strategies

### 17.1 WebSocket Recovery

```typescript
class ReconnectStrategy {
  private attempt = 0;
  private maxAttempts = 10;

  getDelay(): number {
    const base = Math.min(1000 * Math.pow(2, this.attempt), 30000); // 1s → 30s
    const jitter = Math.random() * 1000 - 500; // ±500ms
    this.attempt++;
    return base + jitter;
  }

  reset(): void { this.attempt = 0; }
  isExhausted(): boolean { return this.attempt >= this.maxAttempts; }
}
```

On reconnect success:
1. Re-authenticate WebSocket with JWT
2. Re-join room (receives fresh state)
3. Reset reconnect counter

### 17.2 Media Recovery (LiveKit handles internally)

LiveKit's reconnection strategy:
1. Detect connection issue (ICE state change)
2. Attempt ICE restart (new candidates, same session)
3. If ICE restart fails, attempt full reconnect (new PeerConnection)
4. If direct connection fails, fall back to TURN relay
5. If all fails, emit `Disconnected` event → our UI shows appropriate state

### 17.3 Device Recovery

When a media device is lost:
1. Check if another device of the same kind exists
2. If yes: automatically switch (camera → next camera, mic → next mic)
3. If no: enter degraded state (no video or no audio as appropriate)
4. Listen for `devicechange` event — new device may appear (e.g., Bluetooth reconnects)
5. When user has no mic: show prominent "Mic unavailable" banner with device selector

### 17.4 The "Never Force Refresh" Principle

The user should NEVER need to manually refresh the page unless:
- The browser has a fatal error (crash, out of memory)
- The browser has revoked permissions and the user must grant them again via browser settings
- The application code itself has a fatal bug

All other recovery is automatic. The worst case is a brief "Reconnecting..." overlay.

---

## 18. Security Architecture

### 18.1 Authentication Flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant API as Go Backend

    B->>API: POST /api/auth/register { email, password }
    Note over API: bcrypt hash password (cost 12)
    API-->>B: { user, accessToken, refreshToken }

    B->>API: POST /api/auth/login { email, password }
    Note over API: Verify bcrypt hash
    API-->>B: { user, accessToken (15min), refreshToken (7d) }

    B->>API: POST /api/auth/refresh { refreshToken }
    Note over API: Verify, rotate (old token invalidated)
    API-->>B: { accessToken, refreshToken }
```

### 18.2 Token Strategy

| Token | Type | Storage | Lifetime | Purpose |
|-------|------|---------|----------|---------|
| Access token | JWT (HS256) | Memory (JavaScript variable) | 15 minutes | API authentication |
| Refresh token | Opaque (UUID) | HttpOnly Secure cookie | 7 days | Renew access token |
| Room token | JWT (HS256) | Memory | 1 hour | Room access authorization |
| LiveKit token | JWT | Memory | 1 hour | SFU authentication |
| TURN credential | HMAC-SHA1 | Memory | 24 hours | TURN server authentication |

**Access tokens in memory only.** Not localStorage (XSS risk). Not sessionStorage (lost on tab duplication). Refresh token in HttpOnly Secure SameSite=Strict cookie.

### 18.3 Room Authorization

```go
// Room join handler
func (h *Handler) JoinRoom(w http.ResponseWriter, r *http.Request) {
    userID := auth.UserFromContext(r.Context())
    roomID := chi.URLParam(r, "roomId")

    // Verify room exists and user has access
    room, err := h.roomService.GetRoom(r.Context(), roomID)
    if err != nil {
        // Don't reveal whether room exists (prevent enumeration)
        respondError(w, ErrNotFound, "Room not found or access denied")
        return
    }

    // Generate room-specific tokens
    roomToken := h.authService.GenerateRoomToken(userID, roomID, room.Role)
    lkToken := h.lkService.GenerateToken(userID, roomID)
    turnCreds := turn.GenerateCredentials(userID, h.turnSecret, 24*time.Hour)

    respond(w, JoinResponse{
        WSUrl:       h.config.WSUrl,
        RoomToken:   roomToken,
        LKToken:     lkToken,
        TurnServers: turnCreds.ToICEServers(),
    })
}
```

### 18.4 Rate Limiting

| Endpoint | Limit | Window | Key |
|----------|-------|--------|-----|
| POST /api/auth/register | 5 | 1 hour | IP |
| POST /api/auth/login | 10 | 15 min | IP + email |
| POST /api/rooms | 20 | 1 hour | User ID |
| POST /api/rooms/:id/join | 30 | 1 min | User ID |
| WebSocket connect | 10 | 1 min | IP |
| WebSocket messages | 100 | 1 min | Connection |

Implemented with Redis sliding window:
```go
func (rl *RateLimiter) Allow(key string, limit int, window time.Duration) bool {
    now := time.Now().UnixMilli()
    pipe := rl.redis.Pipeline()
    pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprintf("%d", now-window.Milliseconds()))
    pipe.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: fmt.Sprintf("%d", now)})
    pipe.ZCard(ctx, key)
    pipe.Expire(ctx, key, window)
    results, _ := pipe.Exec(ctx)
    count := results[2].(*redis.IntCmd).Val()
    return count <= int64(limit)
}
```

### 18.5 WebRTC Security

- **DTLS-SRTP:** Mandatory. All media is encrypted in transit. Browser-enforced, no application code needed.
- **E2EE:** NOT implemented in Phase 1. Requires Insertable Streams (Safari support incomplete). DTLS-SRTP provides transport encryption which is sufficient for most use cases.
- **TURN credentials:** Time-limited (24h TTL). Generated per-session. Shared secret never exposed to client.
- **Room enumeration:** Room IDs are 8-character alphanumeric (62^8 ≈ 218 trillion possibilities). Rate limiting on join endpoint prevents brute force.

### 18.6 Security Headers

```go
func SecurityHeaders(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("X-Content-Type-Options", "nosniff")
        w.Header().Set("X-Frame-Options", "DENY")
        w.Header().Set("X-XSS-Protection", "0") // Disabled, use CSP instead
        w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
        w.Header().Set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)")
        w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
        // CSP configured per environment
        next.ServeHTTP(w, r)
    })
}
```

---

## 19. Database Architecture

> Full schema with CREATE TABLE statements, indexes, and migrations: [docs/database.md](docs/database.md)

### 19.1 Tables Overview

| Table | Purpose | Cardinality | Growth |
|-------|---------|-------------|--------|
| `users` | User accounts | Low | Slow |
| `rooms` | Room metadata | Medium | Moderate (rooms are ephemeral-ish) |
| `room_participants` | Who was in which room | Medium-High | One row per join event |
| `call_sessions` | Call-level metadata | Medium | One per room activation |
| `call_quality_snapshots` | Aggregated quality data | High | Batched writes, time-partitioned |
| `refresh_tokens` | Active refresh tokens | Low | Cleaned up on expiry |

### 19.2 Key Design Decisions

- **Room IDs are short alphanumeric codes** (e.g., `a3kx9m2p`), NOT UUIDs. Humans share these in chat, over voice, on sticky notes. They must be typeable.
- **`room_participants.left_at IS NULL`** means the participant is currently in the room. This is the query pattern for "who's in this room right now" (backed by Redis for real-time, PostgreSQL for history).
- **Quality snapshots use JSONB** for metrics because the schema evolves (new metrics added over time) and we don't query individual metrics in SQL.
- **Quality snapshots are partitioned by time** (monthly) with a 90-day retention policy. Old partitions are dropped, not deleted row-by-row.

---

## 20. Redis Usage

> Full key patterns, TTLs, and commands: [docs/database.md](docs/database.md)

### 20.1 Key Pattern Summary

| Pattern | Type | TTL | Purpose |
|---------|------|-----|---------|
| `room:{id}:state` | Hash | 24h | Room status, started_at, participant_count |
| `room:{id}:participants` | Set | 24h | Set of currently connected participant IDs |
| `room:{id}:participant:{pid}` | Hash | 1h | Media state, display name, connection quality |
| `sig:{roomId}` | Pub/Sub channel | N/A | Cross-node signaling relay |
| `session:{userId}:ws` | String | 1h | Which WS server node this user is on |
| `ratelimit:{ip}:{endpoint}` | Sorted Set | Varies | Sliding window rate limiting |

### 20.2 Memory Estimation

Per active room: ~2 KB base + ~500 bytes per participant
- 100 active rooms × 5 participants = ~350 KB
- 1,000 active rooms × 5 participants = ~3.5 MB
- 10,000 active rooms × 5 participants = ~35 MB

Redis single instance handles this trivially. Redis Cluster not needed until 100K+ concurrent rooms.

---

## 21. State Ownership

| State | Primary Owner | Storage | Backup | TTL |
|-------|--------------|---------|--------|-----|
| User identity (email, name) | Backend | PostgreSQL | Backups | Permanent |
| User session (JWT) | Browser | Memory (access), Cookie (refresh) | PostgreSQL (refresh token hash) | 15min / 7d |
| Room config (title, max) | Backend | PostgreSQL | Backups | Permanent |
| Room active state | Backend | Redis | Reconstructable from participants | 24h |
| Participant presence | Backend | Redis | Heartbeat-based | 1h (renewed on heartbeat) |
| Participant media state (muted, camera) | Browser + Backend | Redis (synced via WS) | Browser is source of truth | 1h |
| WebRTC connection | Browser | Browser memory | LiveKit manages | Session |
| Local media tracks | Browser | Browser memory | Re-acquirable | Session |
| Remote media tracks | SFU → Browser | SFU + browser memory | SFU re-sends on reconnect | Session |
| Quality metrics (live) | Browser | Browser memory | Sent to backend periodically | Session |
| Quality metrics (historical) | Backend | PostgreSQL (aggregated) | Backups | 90 days |
| Call history | Backend | PostgreSQL | Backups | Permanent |

**Rule:** If you're unsure where state belongs, ask: "Does this survive a page refresh?" If yes → backend. If no → browser or Redis.

---

## 22. Observability Architecture

### 22.1 The "Why Was This Call Bad?" Query

When a user reports a bad call, we must be able to determine:

| Question | Source |
|----------|--------|
| What network were they on? | Client quality report (candidateType: host/srflx/relay) |
| What was the packet loss? | Client quality report (getStats → packetsLost/packetsReceived) |
| What was the RTT? | Client quality report (getStats → currentRoundTripTime) |
| What was the jitter? | Client quality report (getStats → jitter) |
| What codec was used? | Client quality report (getStats → codec) |
| What resolution? | Client quality report (getStats → frameWidth, frameHeight) |
| What browser/device? | Client quality report (navigator.userAgent + parsed) |
| CPU pressure? | Client quality report (if Compute Pressure API available) |
| Was TURN used? | Client quality report (selectedCandidatePair → candidateType) |
| How many reconnects? | Client quality report (reconnectCount) |
| Video freezes? | Client quality report (freezeCount, totalFreezesDuration) |
| Audio interruptions? | Client quality report (audioLevel === 0 duration) |

### 22.2 Client-Side Telemetry

`QualityMonitor` polls `getStats()` every 2 seconds and computes metrics. Every 30 seconds, it sends a batch report to the backend:

```typescript
// Sent via our WebSocket
signalingClient.send('quality:report', {
  sessionId: callSession.id,
  timestamp: Date.now(),
  metrics: {
    rtt: 45,
    jitter: 12,
    packetLoss: 0.3,
    sendBitrate: 2100,
    recvBitrate: 1800,
    frameRate: 28,
    resolution: { width: 1280, height: 720 },
    codec: 'H264',
    freezeCount: 0,
    audioLevel: 0.42,
    iceState: 'connected',
    candidateType: 'srflx',
    qualityScore: 5,
    reconnectCount: 0,
  }
});
```

### 22.3 Backend Metrics (Prometheus)

```go
// Counters
roomsCreated := prometheus.NewCounter(...)
roomsActive := prometheus.NewGauge(...)
participantsActive := prometheus.NewGauge(...)
wsConnectionsActive := prometheus.NewGauge(...)
wsMessagesTotal := prometheus.NewCounterVec(..., []string{"event_type"})

// Histograms
httpRequestDuration := prometheus.NewHistogramVec(..., []string{"method", "path", "status"})
wsMessageProcessingDuration := prometheus.NewHistogram(...)
roomJoinDuration := prometheus.NewHistogram(...)

// Call quality
callQualityScore := prometheus.NewHistogramVec(..., []string{"browser", "platform"})
turnUsageRate := prometheus.NewGauge(...)
reconnectsTotal := prometheus.NewCounter(...)
```

### 22.4 Structured Logging

```go
// Every log line includes:
slog.Info("participant joined room",
    "request_id", requestID,
    "user_id", userID,
    "room_id", roomID,
    "participant_count", count,
    "browser", browserInfo,
    "ip_country", geoIP,
)
```

JSON format for machine parsing. Request ID propagated through all operations for distributed tracing.

---

## 23. UX Philosophy & Design System

### 23.1 Visual Identity

**Anti-corporate. Human. Lightweight. Confident.**

The product should feel like it was designed for people who have taste — not for enterprise procurement committees.

### 23.2 Design Tokens

```css
/* tailwind.config.ts theme extension */

/* Typography */
--font-sans: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', monospace;

/* Border Radius — generous, never sharp */
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-full: 9999px;

/* Shadows — subtle, organic */
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.08);

/* Motion — quick, never sluggish */
--duration-fast: 100ms;
--duration-normal: 200ms;
--duration-slow: 350ms;
--ease-default: cubic-bezier(0.4, 0, 0.2, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

/* Spacing scale */
4px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px, 64px
```

### 23.3 Color Philosophy

**Dark mode default.** Light mode supported.

Dark mode is not "invert the colors." It's a different palette designed for:
- Reduced eye strain during calls
- Video content looks better against dark backgrounds
- Modern, premium feel

```css
/* Dark mode (default) */
--bg-primary: #0a0a0b;        /* Near-black, not pure black */
--bg-secondary: #141416;      /* Cards, panels */
--bg-elevated: #1c1c1f;       /* Modals, dropdowns */
--text-primary: #fafafa;      /* High contrast */
--text-secondary: #a1a1aa;    /* Muted text */
--accent: #6366f1;            /* Indigo — distinctive, not corporate blue */
--accent-hover: #818cf8;
--success: #22c55e;
--warning: #f59e0b;
--error: #ef4444;
--surface-glass: rgba(255, 255, 255, 0.04); /* Glass-morphism for overlays */
```

### 23.4 Component Philosophy

- **Controls in the call are large and touch-friendly** (min 44px tap target)
- **Mute button is the most prominent control** (audio priority)
- **Video grid adapts to participant count** (1×1, 2×1, 2×2, 3×2, etc.)
- **Self-view is a small PiP** (not a full grid tile — you don't need to stare at yourself)
- **Minimal chrome** — hide non-essential UI elements after 3 seconds of inactivity, show on mouse move/tap

### 23.5 Empty States

Every empty state has:
1. A brief, human explanation (not "No data available")
2. A clear action ("Create a room" / "Join a call")
3. Optional: a subtle illustration or icon

### 23.6 Loading States

- Skeleton screens for content-heavy pages
- Inline spinners (not full-page loaders) for actions
- Optimistic updates where safe (mute/unmute → instant UI, confirmed by server)

### 23.7 Error States

Errors are honest but not alarming:
- ✅ "Couldn't connect to your camera. Try selecting a different device."
- ❌ "Error: MediaDevicesError: NotFoundError: Requested device not found"

Never show raw error messages, stack traces, or error codes to users.

---

## 24. UX for Bad Conditions

### 24.1 Connection Quality Indicator

Small dot next to self-view:
- 🟢 Green: Excellent connection
- 🟡 Yellow: Fair connection (reduced quality)
- 🔴 Red: Poor connection (significant degradation)
- ⚫ Gray: Disconnected / reconnecting

Tapping/hovering shows details: "Your connection: Fair — video quality reduced"

### 24.2 Reconnecting State

```
Full-screen semi-transparent overlay:
┌─────────────────────────────────┐
│                                 │
│    ◉ Reconnecting...            │
│                                 │
│    Your audio/video will        │
│    resume automatically.        │
│                                 │
│    [Check connection]           │
│                                 │
└─────────────────────────────────┘
```

- Appears after 3 seconds of disconnected state (brief blips are invisible)
- Audio from other participants replays immediately on reconnection
- Video resumes in 1-2 seconds

### 24.3 Audio-Only Fallback

When video is disabled due to poor network:
- Video tiles replaced with avatars (initials or profile picture)
- Subtle banner: "Video paused — poor connection"
- Active speaker highlighted with audio-level ring around avatar
- "Resume video" button appears when network improves

### 24.4 Participant Connection States

Each participant tile shows their status:
- **Connected:** normal video/avatar
- **Reconnecting:** dimmed video with spinner
- **Poor connection:** avatar with ⚠️ icon
- **Disconnected:** grayed out, "(reconnecting...)" text, removed after 30s timeout

---

## 25. Accessibility

### 25.1 Requirements

| Requirement | Implementation |
|-------------|---------------|
| Keyboard navigation | All interactive elements focusable via Tab. Enter/Space to activate. Escape to dismiss modals. |
| Screen readers | ARIA labels on all controls. Live regions for dynamic state changes. `aria-live="polite"` for participant join/leave, `aria-live="assertive"` for connection loss. |
| Focus management | Focus trapped in modals. Focus returns to trigger on modal close. Focus moves to video grid on call join. |
| Contrast | All text meets WCAG 2.1 AA (4.5:1 for normal text, 3:1 for large text). |
| Reduced motion | Respect `prefers-reduced-motion`. Disable animations, transitions, and video effects. |
| Captions | Not in MVP. Planned for Phase 2 using browser Speech Recognition API or server-side ASR. |
| Touch targets | Minimum 44×44px for all interactive elements on touch devices. |

### 25.2 Call Controls Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `M` | Toggle mute |
| `V` | Toggle camera |
| `L` | Leave call |
| `Space` (hold) | Push-to-talk (mutes on release) |
| `Escape` | Close any open panel |
| `P` | Toggle participant list |

---

## 26. Performance Budgets

| Metric | Budget | Rationale |
|--------|--------|-----------|
| Initial JS (compressed) | < 150 KB | Call page only. Auth and settings lazy-loaded. |
| Initial CSS (compressed) | < 30 KB | Tailwind purges unused styles |
| Time to Interactive (3G) | < 3 seconds | Users on poor networks must reach the join button quickly |
| Room join time (API + WS) | < 1 second | From clicking "Join" to WebSocket connected |
| Media connection time | < 3 seconds | From join to seeing/hearing first remote participant |
| Memory usage (idle call) | < 100 MB | 1:1 call, Chrome, desktop |
| Memory usage (5p call) | < 200 MB | 5-person call, Chrome, desktop |
| CPU usage (idle, 1:1, desktop) | < 15% | Single core, 720p send + receive, HW encoding |

### Code Splitting Strategy

```typescript
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor-react': ['react', 'react-dom'],
        'vendor-livekit': ['livekit-client'],
        // Auth, settings, lobby loaded on demand
      }
    }
  }
}

// App.tsx — lazy load non-critical routes
const LoginPage = lazy(() => import('./features/auth/LoginPage'));
const RegisterPage = lazy(() => import('./features/auth/RegisterPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));
// CallPage is NOT lazy — it's the core experience
```

---

## 27. End-to-End Flows

### 27.1 Create Room

```
User clicks "New Room"
  → Frontend: POST /api/rooms { title?: string }
    → Backend: auth middleware validates JWT
    → Backend: room.Service.Create()
      → Generate 8-char room ID (crypto/rand, base62)
      → INSERT INTO rooms (id, owner_id, status='waiting', ...)
      → Redis: HSET room:{id}:state status=waiting owner={userId}
    → Backend: responds 201 { room: { id, title, status } }
  → Frontend: navigate to /room/{id} (lobby)
```

### 27.2 Join Room

```
User on lobby page (/room/{id})
  → Frontend: Preview camera/mic (MediaManager.requestMedia())
  → User clicks "Join"
  → Frontend: POST /api/rooms/{id}/join (JWT)
    → Backend: Verify room exists, user authorized
    → Backend: Generate LiveKit token (room + identity)
    → Backend: Generate TURN credentials (HMAC-SHA1)
    → Backend: Return { wsUrl, lkToken, turnServers }
  → Frontend: Create CallSession
    → CallSession: Connect SignalingClient to wsUrl
      → SignalingClient: WebSocket connect + authenticate
      → SignalingClient: send 'room:join' { roomId }
      → Backend: Add participant to Redis, broadcast 'participant:joined' to room
      → SignalingClient: receive 'room:joined' { participants, state }
    → CallSession: Connect to LiveKit (lkToken, turnServers)
      → LiveKit SDK: ICE gathering → STUN → attempt direct → TURN fallback
      → LiveKit SDK: DTLS-SRTP handshake
      → LiveKit SDK: Publish local audio + video tracks (simulcast)
      → LiveKit SDK: Receive remote tracks from existing participants
    → CallSession emits 'connected'
  → Frontend: Render video grid with local + remote tracks
```

### 27.3 Network Degradation

```
Network quality drops (bandwidth reduction, packet loss increase)
  → Browser: WebRTC congestion control (GCC/TWCC) detects congestion
  → Browser: Reduces encoding bitrate automatically
  → LiveKit SFU: Detects subscriber bandwidth constraint via TWCC feedback
  → LiveKit SFU: Switches subscriber to lower simulcast layer
  → Client: QualityMonitor detects metric changes via getStats()
  → Client: QualityMonitor computes new quality score
  → Client: AdaptiveQuality determines target tier
    → If downgrade needed: apply immediately
      → Fair: show quality indicator (yellow)
      → Poor: disable video, switch to audio-only
      → Critical: reduce audio bitrate, show warning
    → If upgrade possible: wait 5 consecutive good readings (10s)
  → Client: Report metrics to backend via 'quality:report' event
```

### 27.4 Network Failure + Recovery

```
Network completely drops (Wi-Fi off, cable unplugged)
  → WebSocket: onclose fires
    → SignalingClient: enters 'reconnecting' state
    → SignalingClient: starts exponential backoff (1s, 2s, 4s...)
  → LiveKit: ICE state → 'disconnected' (within 5-10s)
    → LiveKit: Attempts ICE restart
    → If network returns within ~30s: ICE restart succeeds, media resumes
    → If network returns after 30s: Full reconnect (new PeerConnection)

  When network returns:
    → SignalingClient: WebSocket reconnects
    → SignalingClient: re-authenticates, re-joins room
    → SignalingClient: receives fresh room state (reconcile)
    → LiveKit: ICE restart or full reconnect succeeds
    → LiveKit: Re-subscribes to remote tracks
    → QualityMonitor: resumes polling
    → UI: reconnecting overlay dismissed
    → CallSession: emits 'connected'

  Total recovery time: 1-5 seconds (direct) to 5-15 seconds (TURN fallback)
```

### 27.5 Camera Failure

```
Camera physically disconnected OR permissions revoked
  → Browser: track.onended fires
  → MediaManager: detects track ended
  → MediaManager: emits 'trackEnded' { kind: 'video' }
  → CallSession: handles video track loss
    → LiveKit: unpublish video track
    → Signaling: send 'participant:updated' { videoEnabled: false }
  → UI: Self-view switches to avatar, "Camera disconnected" toast

  Recovery:
  → MediaManager: checks for other available cameras
  → If another camera exists:
    → Show "Switch to [camera name]?" notification
    → On user confirmation (or auto-switch if configured):
      → MediaManager: acquire new track
      → CallSession: publish new track to LiveKit
      → UI: video resumes

  If permission revoked:
  → getUserMedia throws NotAllowedError
  → Cannot auto-recover (requires user gesture to re-grant)
  → Show: "Camera access was blocked. Click here to learn how to re-enable."
  → Link to browser-specific instructions
```

### 27.6 Participant Disconnect

```
Remote participant's network drops
  → LiveKit SFU: detects participant connection loss (no media, no heartbeat)
  → After 5s: LiveKit sends 'participantDisconnected' event to subscribers
  → Our backend: Heartbeat timeout on WebSocket (30s)
    → Remove participant from Redis
    → Broadcast 'participant:left' { reason: 'timeout' } to room
  → UI:
    → Participant tile shows dimmed state + "Reconnecting..."
    → After 30s without reconnection: tile removed from grid
    → If participant was speaking: subtle notification "Alex disconnected"

  If participant reconnects:
  → LiveKit: 'participantConnected' event
  → Backend: 'participant:joined' broadcast
  → UI: Participant tile reappears, brief "Alex reconnected" notification
```

---

## 28. State Machines

### 28.1 Call State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Connecting: join()
    Connecting --> Connected: media established
    Connecting --> Failed: connection timeout / error
    Connected --> Reconnecting: connection lost
    Reconnecting --> Connected: connection restored
    Reconnecting --> Failed: max retries exceeded
    Connected --> Disconnecting: leave()
    Disconnecting --> [*]: cleanup complete
    Failed --> [*]: dispose()
    Failed --> Connecting: retry()
```

### 28.2 Room State Machine

```mermaid
stateDiagram-v2
    [*] --> Waiting: Room created
    Waiting --> Active: First participant joins + media established
    Active --> Active: Participants join/leave
    Active --> Waiting: Last participant leaves (grace period: 5 min)
    Waiting --> Ended: Grace period expires OR owner closes
    Active --> Ended: Owner closes room
    Ended --> [*]: Cleanup Redis, update PostgreSQL
```

### 28.3 Network Quality State Machine

```mermaid
stateDiagram-v2
    [*] --> Excellent
    Excellent --> Good: metrics degrade
    Good --> Excellent: 5 consecutive good readings
    Good --> Fair: metrics degrade further
    Fair --> Good: 5 consecutive good readings
    Fair --> Poor: metrics degrade further
    Poor --> Fair: 5 consecutive good readings
    Poor --> Critical: metrics degrade further
    Critical --> Poor: 5 consecutive good readings

    note right of Poor: Video disabled,\naudio-only mode
    note right of Critical: Reduced audio bitrate,\nwarning shown
```

---

## 29. Participant Scaling Model

### 29.1 Architecture Impact by Scale

| Participants | Architecture | Video Strategy | Bandwidth per Client (Down) | SFU CPU Impact | Notes |
|-------------|-------------|----------------|---------------------------|----------------|-------|
| 2 (1:1) | LiveKit SFU | High quality (720p) both | ~2.5 Mbps | Minimal | Could be P2P but SFU provides consistency |
| 5 | LiveKit SFU | Active speaker high, others medium | ~3.5 Mbps | Low | Grid layout 2×3 |
| 10 | LiveKit SFU | Active speaker high, visible medium, off-screen paused | ~5 Mbps | Moderate | Pause video for off-screen participants |
| 25 | LiveKit SFU | Active speaker high, visible low, most paused | ~4 Mbps | Moderate | Gallery pagination, max 9 visible |
| 50 | LiveKit SFU (potentially cascaded) | Active speaker only video, rest audio-only | ~3 Mbps | High | Single SFU may need larger instance |
| 100+ | Cascaded LiveKit SFU | Broadcast-style: 1-3 speakers with video, rest audio | ~2 Mbps | Multiple SFUs | Requires LiveKit multi-node. Different UX (webinar-like) |

### 29.2 When Architecture Must Change

**At 50+ participants:** Single LiveKit SFU may hit CPU limits. Need larger instance or multi-node LiveKit with cascading.

**At 100+ participants:** Architecture shifts from "everyone is equal" to "speakers vs audience." UI must change to webinar/broadcast mode. Cannot render 100 video tiles.

**At 1000+ participants:** Needs dedicated LiveKit multi-node cluster. CDN for large audience. Out of scope for Phase 1.

**Phase 1 target:** Optimized for 2-10 participants. Tested up to 25. Architecture supports up to 50 on a single SFU instance.

---

## 30. Infrastructure Architecture

### 30.1 Local Development

```yaml
# docker-compose.yml
services:
  backend:
    build: { context: ./backend, dockerfile: ../docker/backend.Dockerfile }
    ports: ["8080:8080"]
    environment:
      DATABASE_URL: postgres://shroom:shroom@postgres:5432/shroom?sslmode=disable
      REDIS_URL: redis://redis:6379
      LIVEKIT_URL: ws://livekit:7880
      LIVEKIT_API_KEY: devkey
      LIVEKIT_API_SECRET: devsecret
      TURN_SECRET: devturnsecret
      JWT_SECRET: devjwtsecret
    depends_on: [postgres, redis, livekit]

  frontend:
    build: { context: ./frontend, dockerfile: ../docker/frontend.Dockerfile }
    ports: ["5173:5173"]
    volumes: ["./frontend/src:/app/src"]  # HMR

  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_DB: shroom, POSTGRES_USER: shroom, POSTGRES_PASSWORD: shroom }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  livekit:
    image: livekit/livekit-server:latest
    command: --dev --bind 0.0.0.0
    ports: ["7880:7880", "7881:7881", "50000-50100:50000-50100/udp"]

  coturn:
    image: coturn/coturn:latest
    ports: ["3478:3478/udp", "3478:3478/tcp"]
    command: >
      --use-auth-secret
      --static-auth-secret=devturnsecret
      --realm=localhost
      --no-cli

volumes:
  pgdata:
```

### 30.2 Production Architecture

```mermaid
graph TB
    subgraph "CDN / Edge"
        CF["Cloudflare CDN<br/>(Static assets + DDoS)"]
    end

    subgraph "Load Balancer"
        LB["Layer 7 LB<br/>(TLS termination)"]
    end

    subgraph "Application Tier"
        API1["Go Backend #1"]
        API2["Go Backend #2"]
        API3["Go Backend #N"]
    end

    subgraph "Media Tier"
        SFU1["LiveKit SFU #1<br/>(Region A)"]
        SFU2["LiveKit SFU #2<br/>(Region B)"]
    end

    subgraph "TURN Tier"
        TURN1["coturn #1<br/>(Region A)"]
        TURN2["coturn #2<br/>(Region B)"]
    end

    subgraph "Data Tier"
        PG["PostgreSQL<br/>(Primary + Replica)"]
        RD["Redis<br/>(Primary + Sentinel)"]
    end

    CF --> LB
    LB --> API1
    LB --> API2
    LB --> API3
    API1 --> PG
    API1 --> RD
    API2 --> PG
    API2 --> RD
    API1 --> SFU1
    API2 --> SFU2
    SFU1 <--> SFU2
```

### 30.3 Component Scalability

| Component | Stateful? | Horizontal Scaling | Failure Domain |
|-----------|-----------|-------------------|----------------|
| Go Backend (API) | No | ✅ Add instances behind LB | Any instance can handle any request |
| Go Backend (WS) | Yes (connections) | ✅ With Redis pub/sub relay | Losing a node disconnects its WS clients (they reconnect to another) |
| LiveKit SFU | Yes (media sessions) | ✅ Room-level assignment, cascading | Losing an SFU disconnects rooms on that instance |
| coturn | Partially (allocations) | ✅ DNS round-robin or Anycast | Losing a TURN server forces ICE restart through another |
| PostgreSQL | Yes | Read replicas for reads. Writes to primary only | Primary failure requires failover (automated with Patroni/RDS) |
| Redis | Yes | Sentinel for HA. Cluster for partitioning (not needed initially) | Sentinel auto-promotes replica |

---

## 31. Cost Model

### 31.1 Infrastructure Cost Estimates (Monthly)

| Scale | Users | Concurrent Calls | Backend | SFU | TURN | Database | Redis | CDN | Total |
|-------|-------|-------------------|---------|-----|------|----------|-------|-----|-------|
| Dev/Staging | 10 | 2-3 | $20 (1 small VM) | $20 (1 small VM) | $0 (dev) | $15 (managed small) | $0 (included) | $0 | ~$55 |
| Small | 100 | 10-20 | $40 (2 vCPU) | $60 (4 vCPU) | $50 | $30 | $15 | $5 | ~$200 |
| Medium | 1,000 | 100-200 | $120 (2×2 vCPU) | $300 (2×8 vCPU) | $300 | $80 | $30 | $20 | ~$850 |
| Large | 10,000 | 1,000-2,000 | $500 (4×4 vCPU) | $2,000 (4×16 vCPU) | $3,000 | $200 | $60 | $50 | ~$5,800 |
| Scale | 100,000 | 10,000+ | $3,000 | $15,000 | $25,000 | $800 | $200 | $200 | ~$44,000 |

### 31.2 Biggest Cost Drivers

1. **TURN bandwidth** — the #1 variable cost. Grows linearly with TURN-relayed calls × duration × bitrate. Mitigation: optimize for direct connections, reduce video bitrate, audio-only where possible.
2. **SFU bandwidth/compute** — grows with concurrent participants. Simulcast helps (SFU only forwards necessary layers). Mitigation: pause off-screen video, limit max participant video.
3. **Cloud egress** — all traffic leaving the cloud provider. Mitigation: choose provider with included bandwidth (Hetzner, OVH) or use Cloudflare (free egress for Workers/R2).

### 31.3 Cost Optimization Strategies

- Use cloud providers with cheap/free egress (Hetzner, OVH, Cloudflare) for TURN/SFU
- Implement aggressive video pausing for off-screen participants
- Use audio-only mode early in degradation curve (saves ~90% bandwidth)
- Enable Opus DTX (no packets during silence)
- Monitor TURN usage percentage — investigate if unexpectedly high

---

## 32. Testing Strategy

### 32.1 Test Pyramid

```
            ┌─────────┐
           │  E2E     │ Few, critical flows only
          │ (Playwright)│
         ├─────────────┤
        │ Integration    │ Backend + DB + Redis + WS
       │   (Go tests)     │
      ├───────────────────┤
     │      Unit Tests       │ Core logic, pure functions
    │ (Go tests + Vitest)      │
   └───────────────────────────┘
```

### 32.2 Unit Tests

**Backend (Go):**
- Room ID generation uniqueness
- TURN credential generation and verification
- JWT token creation and validation
- Room state machine transitions
- Rate limiter logic
- Quality score computation

**Frontend (Vitest):**
- `QualityMonitor` metric extraction from mock getStats data
- `AdaptiveQuality` tier transitions
- `SignalingClient` reconnection backoff timing
- `NetworkQualityScore` computation
- Utility functions

### 32.3 Integration Tests

**Backend:**
- Full HTTP API flows (register → login → create room → join)
- WebSocket connection + authentication + room events
- Redis pub/sub message relay between two WebSocket connections
- Database migration up/down
- Rate limiting behavior

### 32.4 E2E Tests (Playwright)

```typescript
// Playwright config with fake media
use: {
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-video-capture=/path/to/test-video.y4m',
    ]
  }
}
```

**Critical flows:**
1. Register → login → create room → join room → see self-view
2. Two browsers join same room → both see each other's video
3. Mute/unmute → other participant sees mute indicator
4. Camera toggle → other participant sees avatar/video switch
5. Leave call → other participant sees "left" notification
6. Reconnection: kill WebSocket mid-call → verify reconnection

### 32.5 Network Simulation

```bash
#!/bin/bash
# scripts/network-sim.sh — Uses tc/netem on Linux (Docker container)

# Simulate 3G: 300ms latency, 5% loss, 100kbps
tc qdisc add dev eth0 root netem delay 300ms 50ms loss 5%
tc qdisc add dev eth0 root tbf rate 100kbit burst 10kbit latency 100ms

# Simulate packet loss burst
tc qdisc change dev eth0 root netem loss 15% 25%  # 15% loss with 25% correlation

# Simulate network switch (brief disconnect)
tc qdisc add dev eth0 root netem loss 100%
sleep 3
tc qdisc change dev eth0 root netem loss 0%

# Reset
tc qdisc del dev eth0 root
```

### 32.6 Chaos Tests

| Test | Procedure | Expected Result |
|------|-----------|----------------|
| Kill signaling server | `docker kill shroom-backend` mid-call | Media continues (LiveKit independent). WS reconnects when backend restarts. |
| Kill SFU | `docker kill shroom-livekit` mid-call | Media stops. LiveKit SDK reconnects when SFU restarts. Brief freeze. |
| Kill Redis | `docker kill shroom-redis` mid-call | WS continues on single node. Cross-node signaling fails. Backend operates degraded. |
| Revoke camera | Chrome DevTools → remove camera permission | Video stops. UI shows avatar. User prompted to re-grant. |
| Network interrupt | `tc netem loss 100%` for 10 seconds | Reconnecting overlay. Automatic recovery. |

---

## 33. Security Threat Model

| Threat | Mitigation |
|--------|-----------|
| Room ID enumeration | 8-char alphanumeric (218T possibilities) + rate limiting on join |
| Brute force login | Rate limiting (10 attempts/15min/IP+email) + bcrypt cost 12 |
| JWT theft | Short-lived (15min), memory-only storage, refresh via HttpOnly cookie |
| WebSocket flooding | Per-connection message rate limit (100/min) |
| TURN abuse | Time-limited credentials, bandwidth quotas per allocation |
| XSS | React escapes by default, CSP headers, no `dangerouslySetInnerHTML` |
| CSRF | SameSite=Strict cookies, no cookie-based auth for state-changing APIs |
| Media interception | DTLS-SRTP encryption (browser-enforced, mandatory) |
| Room recording without consent | No recording in MVP. Future: requires explicit participant consent + visual indicator |
| DDoS | Cloudflare in front, rate limiting at application layer |

---

## 34. Development Phases

### Phase 1: MVP (Weeks 1-16)

**Goal:** Working 1:1 and small group calls (up to 10 participants) with graceful degradation.

**Includes:**
- User registration and login
- Room creation and joining via shareable link
- Lobby (device preview before joining)
- Video/audio call via LiveKit
- Mute, camera toggle, leave
- Participant list
- Connection quality indicator
- Auto-reconnection (WebSocket + LiveKit)
- Audio-only fallback on poor network
- Network quality monitoring
- Basic structured logging and metrics
- Docker-based local development
- Core E2E tests

**Does NOT include:**
- Screen sharing
- Chat
- Recording
- E2EE
- Scheduled rooms
- Guest/anonymous access
- Custom backgrounds
- Reactions/emoji
- Breakout rooms
- Admin dashboard

### Phase 2: Production Hardening (Weeks 17-24)

- Security hardening (rate limiting, headers, input validation)
- In-call text chat
- Screen sharing (desktop only)
- Call quality diagnostics page
- Prometheus metrics + Grafana dashboard
- Network simulation test suite
- Chaos test suite
- Production Docker images
- CI/CD pipeline
- Staging environment
- Performance optimization (bundle size, lazy loading)
- Guest access (join without account)
- Browser compatibility testing (Safari, Firefox, mobile)

### Phase 3: Scale & Features (Weeks 25+)

- Multi-region SFU deployment
- Scheduled rooms
- Recording (with consent UI)
- E2EE (when Safari Insertable Streams is stable)
- Advanced noise suppression (Web Audio)
- Captions (Speech Recognition API)
- Admin/analytics dashboard
- Horizontal backend scaling
- Load testing at scale
- Mobile-optimized UI
- PWA support

---

## 35. Technical Risks & Unknowns

### 35.1 Known Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Safari WebRTC bugs | High | Extensive Safari testing. TURN always available. H.264 only. |
| TURN bandwidth costs at scale | High | Monitor usage, optimize for direct connections, consider self-hosted TURN on cheap-egress providers |
| LiveKit dependency | Medium | LiveKit is open-source. Worst case: fork or migrate to mediasoup. API boundary is clean. |
| Background tab throttling | Medium | Web Workers for timers, WebSocket push, audio track hack for priority |
| Low-end Android thermal throttling | Medium | Aggressive quality caps (360p/15fps), device capability detection, hardware codecs only |
| Redis single point of failure | Medium | Redis Sentinel for HA in production |
| H.264 licensing for server-side recording (Phase 3) | Medium | See detailed note below |

**H.264 Licensing Note:**

For **live calls**, H.264 licensing is not our concern: encode/decode happens inside the browser using the browser vendor's own licensed implementation (Chrome/Firefox use Cisco's OpenH264 binary which Cisco covers royalty-free; Safari uses Apple's licensed VideoToolbox stack). We are not on the hook.

However, **Phase 3 "Recording"** changes this. If we ever transcode, re-encode, or composite recordings server-side (e.g., using FFmpeg with H.264), we may trigger MPEG-LA / Via Licensing patent obligations directly. Via Licensing's 2026 fee restructuring pushed large-platform annual fees as high as $4.5M for the top tier (small platforms pay far less, typically $0–$100K depending on volume, but it is a non-zero line item).

**Mitigations when we reach Phase 3:**
1. **Store recordings as raw WebM/VP8** (royalty-free) instead of H.264 MP4
2. **Use browser-side MediaRecorder** (covered by browser's H.264 license) instead of server-side transcoding
3. **Consult IP counsel** before shipping any server-side H.264 processing
4. **Monitor Via Licensing terms** — they change periodically

This does not affect Phase 1 or Phase 2. It is captured here so it is not forgotten when recording is designed.

### 35.2 Unknowns Requiring Experimental Validation

1. **Actual TURN usage percentage** for our user base — varies dramatically by audience demographic and geography. Must measure in production.
2. **LiveKit reconnection reliability** on iOS Safari background → foreground transitions. Needs real-device testing.
3. **Optimal quality adaptation thresholds** — the values in this document are starting points. Must be tuned based on real user experience data.
4. **Battery impact on mobile** during extended calls. Must benchmark on low-end and mid-range Android devices.
5. **Maximum comfortable participant count** before the UI becomes unusable — depends on device capabilities and layout.
6. **Opus RED effectiveness** across different packet loss patterns (random vs burst). Must test with tc/netem.
7. **H.264 patent licensing cost** for server-side recording at scale (Phase 3). Requires legal review before implementation.

---

## 36. Architectural Invariants

These rules are inviolable throughout the project. Every implementation decision must satisfy all of them.

1. **Audio takes priority over video.** When bandwidth is constrained, video degrades first. When CPU is constrained, video resolution/framerate drops first. Audio is the last thing to degrade.

2. **The call must degrade gracefully.** There is no state where the system goes from "working" to "completely broken" without intermediate degradation steps.

3. **Network failure must not automatically mean call failure.** A temporary network interruption triggers reconnection, not call termination.

4. **The client must recover whenever technically possible.** If the browser supports it and the server is reachable, recovery should be automatic.

5. **Media logic must be separated from UI logic.** WebRTC, LiveKit, MediaDevices, and quality monitoring code lives in plain TypeScript classes. React components only render state.

6. **Ephemeral state must not be treated as persistent state.** Participant presence, media state, and active room data belong in Redis (or browser memory), not PostgreSQL.

7. **Browser capabilities must be detected rather than assumed.** Use feature detection, not user-agent parsing. Never assume a codec, API, or behavior is available.

8. **Every major real-time failure must have a recovery strategy.** Documented in the failure-mode matrix. No "it shouldn't happen" dismissals.

9. **Performance is a product feature.** Bundle size, connection time, memory, and CPU have budgets. Exceeding them is a bug.

10. **Reliability is more important than visual complexity.** A working call with a simple UI beats a broken call with beautiful animations.

11. **Do not introduce infrastructure without explaining its necessity.** Every service in docker-compose has a documented reason for existing.

12. **Do not introduce abstractions without explaining their value.** Every class, module boundary, and indirection has a documented justification.

13. **Do not make architectural decisions without considering degraded conditions.** "What happens when the network is bad?" must be answered for every feature.

14. **Every important architectural choice must have a documented reason.** Captured in ADRs above.

15. **The architecture must be understandable by another engineer without relying on undocumented tribal knowledge.** This document is the source of truth.

---

## Appendix A: Technology Versions

| Technology | Version | Notes |
|-----------|---------|-------|
| Go | 1.23+ | Latest stable |
| Node.js | 22 LTS | For frontend build tooling |
| React | 19+ | Latest stable |
| TypeScript | 5.5+ | Strict mode enabled |
| Vite | 6+ | Latest stable |
| Tailwind CSS | 4+ | Latest stable |
| LiveKit Server | Latest | Docker image |
| LiveKit Client SDK | Latest | npm package |
| PostgreSQL | 16 | Alpine Docker image |
| Redis | 7 | Alpine Docker image |
| coturn | Latest | Docker image |
| Docker Compose | v2 | For local development |

## Appendix B: Acronyms

| Acronym | Meaning |
|---------|---------|
| ABR | Adaptive Bitrate |
| AEC | Acoustic Echo Cancellation |
| AGC | Automatic Gain Control |
| BWE | Bandwidth Estimation |
| CGNAT | Carrier-Grade NAT |
| DTLS | Datagram Transport Layer Security |
| DTX | Discontinuous Transmission |
| E2EE | End-to-End Encryption |
| FEC | Forward Error Correction |
| FIR | Full Intra Request |
| GCC | Google Congestion Control |
| ICE | Interactive Connectivity Establishment |
| MCU | Multipoint Control Unit |
| NACK | Negative Acknowledgement |
| NAT | Network Address Translation |
| PLC | Packet Loss Concealment |
| PLI | Picture Loss Indication |
| RED | Redundant Encoding |
| RTCP | RTP Control Protocol |
| RTP | Real-time Transport Protocol |
| SDP | Session Description Protocol |
| SFU | Selective Forwarding Unit |
| SRTP | Secure Real-time Transport Protocol |
| STUN | Session Traversal Utilities for NAT |
| SVC | Scalable Video Coding |
| TURN | Traversal Using Relays around NAT |
| TWCC | Transport-Wide Congestion Control |
