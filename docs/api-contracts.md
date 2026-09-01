# Shroom API Contracts

This document defines the HTTP REST and WebSocket signaling contracts for Shroom, a lightweight, resilient video calling platform. The backend is written in Go, the frontend in React/TypeScript, and it uses LiveKit as the SFU.

## 1. HTTP REST API

All endpoints require the `Content-Type: application/json` header for requests with a body. Endpoints that require authentication expect a bearer token in the `Authorization` header: `Authorization: Bearer <token>`.

### Auth

#### `POST /api/auth/register`
Register a new user with email and password.

- **Request Body:**
```typescript
interface RegisterRequest {
  email: string;
  password: string; // Minimum 8 characters
  displayName: string;
}
```
- **Response Body (201 Created):**
```typescript
interface RegisterResponse {
  user: User;
  token: string; // JWT access token
  refreshToken: string;
}
```
- **Auth Required:** No
- **Errors:** `VALIDATION_ERROR`, `EMAIL_IN_USE`

#### `POST /api/auth/login`
Authenticate a user and return a JWT.

- **Request Body:**
```typescript
interface LoginRequest {
  email: string;
  password: string;
}
```
- **Response Body (200 OK):**
```typescript
interface LoginResponse {
  user: User;
  token: string; // JWT access token
  refreshToken: string;
}
```
- **Auth Required:** No
- **Errors:** `INVALID_CREDENTIALS`

#### `POST /api/auth/refresh`
Refresh an expired access token using a refresh token.

- **Request Body:**
```typescript
interface RefreshRequest {
  refreshToken: string;
}
```
- **Response Body (200 OK):**
```typescript
interface RefreshResponse {
  token: string; // New JWT access token
  refreshToken: string; // New refresh token
}
```
- **Auth Required:** No
- **Errors:** `INVALID_TOKEN`, `TOKEN_EXPIRED`

#### `POST /api/auth/logout`
Invalidate the current session.

- **Request Body:** None
- **Response Body (204 No Content):** Empty
- **Auth Required:** Yes
- **Errors:** `UNAUTHORIZED`

### Users

#### `GET /api/users/me`
Retrieve the authenticated user's profile.

- **Request Body:** None
- **Response Body (200 OK):**
```typescript
interface GetMeResponse {
  user: User;
}
```
- **Auth Required:** Yes
- **Errors:** `UNAUTHORIZED`, `USER_NOT_FOUND`

#### `PATCH /api/users/me`
Update the authenticated user's profile.

- **Request Body:**
```typescript
interface UpdateProfileRequest {
  displayName?: string;
  avatarUrl?: string;
}
```
- **Response Body (200 OK):**
```typescript
interface UpdateProfileResponse {
  user: User;
}
```
- **Auth Required:** Yes
- **Errors:** `UNAUTHORIZED`, `VALIDATION_ERROR`

### Rooms

#### `POST /api/rooms`
Create a new video room.

- **Request Body:**
```typescript
interface CreateRoomRequest {
  name?: string; // Optional custom name
  settings?: RoomSettings; // Optional room settings
}
```
- **Response Body (201 Created):**
```typescript
interface CreateRoomResponse {
  roomId: string;
  joinToken: string; // Token required to join the room
  room: Room;
}
```
- **Auth Required:** Yes
- **Errors:** `UNAUTHORIZED`, `RATE_LIMIT_EXCEEDED`

#### `GET /api/rooms/:id`
Retrieve public metadata for a specific room.

- **Request Body:** None
- **Response Body (200 OK):**
```typescript
interface GetRoomResponse {
  room: Room;
}
```
- **Auth Required:** No (Depends on room privacy)
- **Errors:** `ROOM_NOT_FOUND`

#### `POST /api/rooms/:id/join`
Request to join a specific room. This endpoint provisions the necessary credentials for the LiveKit SFU and WebSocket signaling server.

- **Request Body:**
```typescript
interface JoinRoomRequest {
  joinToken?: string; // Required if room is private/password protected
}
```
- **Response Body (200 OK):**
```typescript
interface JoinRoomResponse {
  wsUrl: string; // WebSocket signaling URL
  livekitUrl: string; // LiveKit SFU URL
  livekitToken: string; // Access token for LiveKit
  turnCredentials: TurnCredentials[]; // ICE/TURN servers
  participantId: string;
}
```
- **Auth Required:** Yes (Guest auth supported)
- **Errors:** `UNAUTHORIZED`, `ROOM_NOT_FOUND`, `ROOM_FULL`

#### `DELETE /api/rooms/:id`
Close and delete a room. Only the room owner can perform this action.

- **Request Body:** None
- **Response Body (204 No Content):** Empty
- **Auth Required:** Yes
- **Errors:** `UNAUTHORIZED`, `FORBIDDEN`, `ROOM_NOT_FOUND`

### Health

#### `GET /api/health`
Basic liveness check.

- **Request Body:** None
- **Response Body (200 OK):**
```typescript
interface HealthResponse {
  status: 'ok';
}
```
- **Auth Required:** No

#### `GET /api/health/ready`
Readiness check, verifying connections to DB, Redis, and LiveKit.

- **Request Body:** None
- **Response Body (200 OK / 503 Service Unavailable):**
```typescript
interface ReadyResponse {
  status: 'ready' | 'error';
  components: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
    livekit: 'ok' | 'error';
  };
}
```
- **Auth Required:** No

---

## 2. WebSocket Signaling Events

All WebSocket messages follow a standard envelope:

```typescript
interface WsMessage<T = unknown> {
  event: string;
  payload: T;
  timestamp: number;
}
```

### Connection

| Event | Direction | Payload | Description | When it's sent |
|-------|-----------|---------|-------------|----------------|
| `ws:authenticate` | C → S | `{ token: string }` | JWT authentication | Immediately after connecting |
| `ws:authenticated`| S → C | `{ sessionId: string }` | Confirmation | After successful auth |
| `ws:error` | S → C | `ApiError` | Generic error | On protocol or validation error |
| `ws:ping` / `ws:pong`| Bidirectional | `{ ts: number }` | Keepalive | Every 15 seconds |

### Room

| Event | Direction | Payload | Description | When it's sent |
|-------|-----------|---------|-------------|----------------|
| `room:join` | C → S | `{ roomId: string, participantId?: string }` | Request to join room logic | After WS auth. Include `participantId` on reconnect to resume existing session (see note below). |
| `room:joined` | S → C | `RoomStateSync` | Confirmation of join | After successful room join |
| `room:leave` | C → S | `{}` | Intent to leave | Before disconnecting intentionally |
| `room:left` | S → C | `{ reason?: string }` | Acknowledgment | After leave request |
| `room:state` | S → C | `RoomStateSync` | Full state synchronization | On join or major desync |
| `room:closed` | S → C | `{ reason?: string }` | Room terminated by owner | When room is deleted |

> **Reconnection vs. fresh join:** When the WebSocket drops and the client reconnects, it must
> include its previous `participantId` in the `room:join` payload. The backend uses this to:
> 1. Skip creating a duplicate `room_participants` row (increment `join_count` instead)
> 2. Avoid double-counting in the Redis participant set (`SADD` is idempotent, but `HINCRBY participant_count` is not — the backend must check set membership before incrementing)
> 3. Preserve the participant's role and display name across reconnects
>
> If `participantId` is omitted or invalid (not found in Redis for this room), the backend treats
> it as a fresh join and assigns a new participantId.
>
> The client receives its `participantId` in the `RoomStateSync` response and must store it in
> memory for the duration of the call session.

```typescript
interface RoomStateSync {
  room: Room;
  participants: Participant[];
  self: {
    participantId: string;  // Store this — needed for reconnection
    role: 'host' | 'participant';
  };
}
```

### Participants

| Event | Direction | Payload | Description | When it's sent |
|-------|-----------|---------|-------------|----------------|
| `participant:joined`| S → C | `{ participant: Participant }` | New user | When another user joins |
| `participant:left` | S → C | `{ participantId: string }` | User left | When another user leaves |
| `participant:updated`| Bidirectional | `{ participantId: string, state: Partial<Participant> }` | State change | Mute, camera toggle, etc. |
| `participant:speaking`| S → C | `{ participantId: string, level: number }` | Audio activity | High frequency, driven by SFU |
| `room:hand:set` | C → S | `{ raised: boolean }` | Raise or lower the authenticated participant's hand | Raising twice is idempotent; lowering and raising again moves the participant to the end |
| `hand_queue:updated` | S → C | `{ queue: Array<{ participantId: string, displayName: string, raisedAt: string }> }` | Authoritative raised-hand queue in first-raised order | Sent on room join and after every queue change |

### Quality

> **Note:** WebRTC media signaling (SDP offer/answer, ICE candidates, track management) is handled
> entirely by LiveKit's internal protocol via the LiveKit client SDK. Our WebSocket carries only
> application-level events. See [ARCHITECTURE.md ADR-005](../ARCHITECTURE.md#adr-005-custom-websocket-signaling--livekit-media-signaling).



| Event | Direction | Payload | Description | When it's sent |
|-------|-----------|---------|-------------|----------------|
| `quality:report` | C → S | `QualityMetrics` | Client telemetry | Every 10 seconds |
| `quality:alert` | S → C | `NetworkQualityAlert` | Degradation warning | When server detects poor network |

### Chat

| Event | Direction | Payload | Description | When it's sent |
|-------|-----------|---------|-------------|----------------|
| `chat:message` | Bidirectional | `ChatMessage` | Text message | User sends a message in room |

```typescript
interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
}
```

---

## 3. Shared Types

```typescript
// users.ts
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
}

// rooms.ts
export interface Room {
  id: string;
  name: string;
  ownerId: string;
  settings: RoomSettings;
  createdAt: string;
  status: 'active' | 'closed';
}

export interface RoomSettings {
  isLocked: boolean;
  maxParticipants: number;
  enableChat: boolean;
}

// participant.ts
export interface Participant {
  id: string;
  userId: string;
  roomId: string;
  displayName: string;
  joinedAt: string;
  mediaState: MediaState;
  connectionState: ConnectionState;
}

export interface MediaState {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  deviceInfo?: DeviceInfo;
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface DeviceInfo {
  os: string;
  browser: string;
  version: string;
}

// quality.ts
export interface QualityMetrics {
  packetLoss: number; // percentage
  latency: number; // ms
  jitter: number; // ms
  bitrate: number; // kbps
}

export interface NetworkQualityAlert {
  level: 'warning' | 'critical';
  message: string;
  suggestedAction?: 'disable_video' | 'lower_resolution';
}

// turn.ts
export interface TurnCredentials {
  urls: string | string[];
  username?: string;
  credential?: string;
}
```

---

## 4. Error Contract

All API errors return a standard envelope structure:

```typescript
interface ApiError {
  code: string;        // machine-readable enum (e.g., 'ROOM_NOT_FOUND')
  message: string;     // human-readable description
  details?: unknown;   // optional context (e.g., validation field errors)
  requestId: string;   // correlation ID for tracing in logs
}
```

### Common Error Codes

- `VALIDATION_ERROR`: Request payload fails schema validation.
- `UNAUTHORIZED`: Missing or invalid authentication token.
- `FORBIDDEN`: Valid token, but lacking permissions for the action.
- `INTERNAL_SERVER_ERROR`: Unexpected backend failure.
- `RATE_LIMIT_EXCEEDED`: Too many requests.

### Specific Error Codes

- `EMAIL_IN_USE`: Attempted to register with an existing email.
- `INVALID_CREDENTIALS`: Login failed.
- `INVALID_TOKEN` / `TOKEN_EXPIRED`: JWT issues.
- `ROOM_NOT_FOUND`: Room ID does not exist or was deleted.
- `ROOM_FULL`: Cannot join, max participants reached.

---

## 5. Go Server Types

To maintain parity between the Go backend and the TypeScript frontend, here are the equivalent struct definitions in Go.

```go
package models

import "time"

// User corresponds to the TypeScript User interface
type User struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"displayName"`
	AvatarURL   *string   `json:"avatarUrl,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Room corresponds to the TypeScript Room interface
type Room struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	OwnerID   string       `json:"ownerId"`
	Settings  RoomSettings `json:"settings"`
	CreatedAt time.Time    `json:"createdAt"`
	Status    string       `json:"status"` // "active" or "closed"
}

type RoomSettings struct {
	IsLocked        bool `json:"isLocked"`
	MaxParticipants int  `json:"maxParticipants"`
	EnableChat      bool `json:"enableChat"`
}

// Participant corresponds to the TypeScript Participant interface
type Participant struct {
	ID              string    `json:"id"`
	UserID          string    `json:"userId"`
	RoomID          string    `json:"roomId"`
	DisplayName     string    `json:"displayName"`
	JoinedAt        time.Time `json:"joinedAt"`
	MediaState      MediaState `json:"mediaState"`
	ConnectionState string    `json:"connectionState"`
}

type MediaState struct {
	AudioEnabled  bool        `json:"audioEnabled"`
	VideoEnabled  bool        `json:"videoEnabled"`
	ScreenSharing bool        `json:"screenSharing"`
	DeviceInfo    *DeviceInfo `json:"deviceInfo,omitempty"`
}

type DeviceInfo struct {
	OS      string `json:"os"`
	Browser string `json:"browser"`
	Version string `json:"version"`
}

// ApiError corresponds to the standardized error envelope
type APIError struct {
	Code      string      `json:"code"`
	Message   string      `json:"message"`
	Details   interface{} `json:"details,omitempty"`
	RequestID string      `json:"requestId"`
}
```

---

## 6. Contract Sharing Strategy

To ensure synchronization between the Go backend and the React/TypeScript frontend without duplication errors, the following strategy is recommended:

### Approach: OpenAPI (Swagger) with Code Generation

1. **Single Source of Truth**: Define the HTTP REST API in a central `openapi.yaml` file.
2. **Backend Validation (Go)**: Use a tool like `oapi-codegen` to generate Go structs and server scaffolding directly from the OpenAPI spec. This ensures the Go API handles requests exactly as documented.
3. **Frontend Client (TypeScript)**: Use a tool like `openapi-typescript-codegen` or `orval` in the frontend repository to generate TypeScript interfaces and Axios/Fetch client functions.
4. **WebSocket Types**: Since OpenAPI doesn't cover WebSocket payloads robustly, define a shared JSON Schema for WebSocket events (e.g., using AsyncAPI or standard JSON schema). Use `quicktype` or `json-schema-to-typescript` and `json-schema-to-go` to generate the respective types for both sides.
5. **CI/CD Enforcement**: Add a CI step that runs the code generators and fails the build if the generated output differs from what is committed, ensuring that PRs always contain updated types when the spec changes.

**Alternative Approach (Protobufs):**
If performance and strict typing for WebSockets are paramount, switch the definitions to Protocol Buffers (`.proto`). Use `protoc` to generate Go structs and TypeScript interfaces. This is highly recommended for signaling events, as LiveKit already heavily utilizes protobufs internally.
