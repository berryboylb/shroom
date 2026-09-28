# People's feedback: status and implementation plan

## Implementation update

All requests other than the already integrated Google sign in have local implementations in the current working tree:

- Screen sharing asks the browser to exclude the current Shroom tab and omits the sharer's own screen tile from their grid.
- Raised hands use a distinct quieter cue, a badge, and a visible tile outline. Call sounds default to raised hands only, with `All` and `Off` choices.
- Chat detects and links web URLs and shows a compact title/description preview when the server can safely fetch page metadata.
- Approval rooms withhold LiveKit tokens until the creator admits a participant. The host has a request panel; applicants see a waiting screen. Migration 009 stores room hosts and admission decisions.
- Mobile camera flip, supported browser speaker selection, and an optional low resolution outgoing video enhancement are available from call controls.

Verification: frontend build and lint pass; 26 frontend tests pass. Backend auth, room, WebSocket, and server tests pass. Migration 009 and an approval/denial integration test pass against a fresh PostgreSQL 17 database. Real device and multi-browser call checks remain before release. The video enhancement is intentionally simple color/exposure processing; performance on low-end phones still needs measurement. Some browsers do not offer speaker selection or multiple cameras.

The table below records the starting point before this implementation update; the delivery sections describe the intended scope and release checks.

Status assessed from the local working tree on 28 September 2026. “In progress” means code exists locally but is uncommitted and has not been verified in a live call. The existing `docs/implementation-plan.md` describes the original platform build; this plan covers the ten newer requests.

| # | Request | Current status | Evidence / remaining gap |
| --- | --- | --- | --- |
| 1 | Google sign in and remembered accounts | **In progress** | Local changes add Google Identity Services UI, server side ID token checks, account storage, refresh sessions, and sign out. `GOOGLE_CLIENT_ID`, migration 008, deployment configuration, browser testing, and account return flow verification remain. Guest entry still works. |
| 2 | Prevent the infinite mirror during screen share | **Not started** | The active room uses LiveKit `VideoConference` with its default screen share tile. There is no local screen share preview suppression. |
| 3 | Play a sound when someone raises a hand | **In progress** | A local change in `CallAccessibility` plays the existing join chime for a new remote hand. It needs a distinct, quieter hand cue, notification preference, and live verification. |
| 4 | Lightweight video beautification | **Not started** | No video processor or filter control is wired to the published camera track. |
| 5 | Detect and format links in chat | **Not started** | The active room uses LiveKit's default chat renderer. Voice notes augment that chat, but there is no URL renderer or preview card. |
| 6 | Host approval for secure meetings | **Not started** | `JoinRoom` immediately issues a LiveKit token. `rooms.owner_id` exists in the schema but is not populated on room creation. The WebSocket room subscription does not check room membership. Existing media encryption is separate from admission approval. |
| 7 | Flip the mobile camera | **Not started** | Prejoin can select camera device IDs; there is no front/back flip button or in-call facing mode switch. |
| 8 | Switch speakers | **Not started** | Device discovery includes audio outputs, but neither prejoin nor the active room routes playback to a selected output. Browser and OS support must be checked at runtime. |
| 9 | Make join/leave sounds less distracting | **Not started** | `ChimeController` plays join/leave cues without a user preference, including a local join cue. |
| 10 | Make raised hands visible in the call and outline the profile | **Partial** | A raised hand queue, button badge, and participant list exist. The video tile/profile has no raised hand outline or prominent in-grid indicator. |

## Delivery order

### 1. Finish identity and room ownership (#1, prerequisite for #6)

- Complete the existing Google branch, apply migration 008, configure the Google web client for local and production origins, and verify login, refresh after reload, sign out, expired session, and guest entry. Preserve the guest option.
- Set `rooms.owner_id` from the authenticated account at room creation. Decide how guest-created rooms are hosted: issue a scoped host capability at creation, or require a Google account to enable approval mode. Use a durable identifier rather than the display name.
- Check that opening a shared link while signed in does not silently bypass prejoin device confirmation. Add a return-path test for users who sign in from an invite.

**Done when:** a returning account holder enters with the same identity without retyping a name during a valid session; a new device can sign in; sign out revokes its refresh session; the room creator can be identified reliably.

### 2. Improve call cues and raised hand visibility (#3, #9, #10)

- Add per-user notification settings: `All sounds`, `Hands only`, `Off`, with a lower default volume. Persist locally and expose them in call settings. Use separate short sounds for join, leave, and hand raise. Do not play the hand cue for an initial queue snapshot, the local user's own hand, or a reconnect replay.
- Keep the existing raised hand queue and render a clear hand icon with queue position on each affected video tile. Add a high contrast amber outline around the person's tile or avatar, including camera-off state. Keep the participant list in sync.
- Verify keyboard and screen-reader announcements, multiple simultaneous hands, lowering a hand, reconnects, and mobile layouts.

**Done when:** other participants notice a newly raised hand in the grid without opening a panel, while anyone can reduce or silence call event sounds.

### 3. Fix screen share and device controls (#2, #7, #8)

- While the local user shares the Shroom tab or window, suppress or collapse only their local screen share tile into a small “You are sharing” status; keep the shared track published and visible to everyone else. Offer a `Hide my preview` control for other share surfaces. Test tab, window, and entire-screen capture; browser capture controls cannot guarantee that the user never selects a recursive surface.
- Add a `Flip camera` control on mobile prejoin and in call. Switch between front and rear cameras with facing mode or available device IDs, replace the published camera track cleanly, and restore the prior track if switching fails.
- Add speaker selection where the browser exposes audio output devices and supports output routing. Route all remote audio and call notification sounds to the chosen output, remember the choice, and handle device removal. Show a plain explanation and rely on system output settings on unsupported browsers.

**Done when:** sharing does not force a distracting local recursive preview; mobile users can flip cameras without leaving; supported desktops can switch output during a call.

### 4. Link-aware chat (#5)

- Replace the default chat message body renderer with a Shroom renderer while preserving LiveKit chat delivery and the existing voice note controls. Detect multiple URLs, make them clickable, display readable domains, and keep all message text escaped.
- Add an optional WhatsApp-style card for the first supported URL: title, description, image, and domain. Fetch metadata through a server endpoint with strict URL validation, public-host checks, redirect limits, timeouts, response size limits, caching, and a no-preview fallback. Never fetch private network addresses or execute page content.
- Test plain text, punctuation around links, Unicode domains, malicious markup, unavailable sites, and mobile wrapping.

**Done when:** links are clearly tappable and safe; supported pages show a compact preview without blocking message delivery.

### 5. Host-approved meetings (#6)

- Add a room setting for `open` or `approval required`, tied to an authenticated owner or explicit host capability. Store pending join requests with expiry and states `pending`, `approved`, `denied`, `cancelled`. Give the host an in-call queue with approve/deny actions and a waiting screen for applicants.
- Keep token issuance on the server: a pending or denied person must receive no LiveKit join token. Re-check authorization on reconnect and token renewal. Scope host actions to the room, validate identity on every HTTP and WebSocket path, and revoke stale requests when a meeting ends.
- Make notification transport durable across backend instances. The current hand queue is process-local even though it broadcasts through Redis; approval decisions need shared state and atomic transitions. Audit concurrent approvals, duplicate requests, host disconnect, host transfer, and a guest with the invite link.

**Done when:** a participant cannot join or hear/see media until an authorized host approves them, including by calling the API directly or reconnecting with an old token.

### 6. Lightweight video enhancement (#4)

- Add an optional `Enhance video` control with a side-by-side preview before joining and an in-call toggle. Start with restrained brightness, contrast, and color adjustment on the outgoing camera track; avoid face reshaping and heavyweight models in the first release.
- Run processing only when enabled, cap output resolution and frame rate as needed, and automatically fall back to the original camera track on slow devices, battery pressure, processor errors, or unsupported browsers. Keep audio and screen share untouched.
- Measure CPU load, frame rate, latency, and battery impact on representative low-end mobile hardware before enabling by default. If simple adjustments cannot produce a useful effect within that budget, leave the feature optional and evaluate a dedicated processor separately.

**Done when:** remote participants see the enhancement, switching it off is immediate, and low-end phones can call smoothly with it disabled.

## Verification and release gates

1. Run frontend build, targeted component tests, and backend tests after dependencies are installed. Add end-to-end two-browser tests for sign in, admission, hand notifications, chat links, and device fallbacks.
2. Manually exercise Chrome, Safari, and Firefox on desktop plus iOS Safari and Android Chrome with two real participants. Device output and camera flip are capability-dependent.
3. Release identity and small call controls first; release approval mode only after server-side bypass and reconnect tests pass. Observe errors and call quality after each release.

At assessment time, frontend dependencies are absent (`vitest` and `tsc` cannot run). The backend test command first needed the Go 1.26 toolchain download, so passing tests are not yet established.
