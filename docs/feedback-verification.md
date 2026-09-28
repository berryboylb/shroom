# Verify the feedback features

## Automated checks

From `frontend`, run `npm ci` once, then:

```bash
npm run test:e2e -- e2e/feedback.spec.ts
npm run test:unit
npm run build
```

The Playwright command starts Vite and uses a browser with fake camera and microphone devices. It mocks API responses to verify the approval UI and mobile device controls deterministically. It does **not** prove that LiveKit media, real speakers, screen capture, or backend authorization work. Playwright needs its browser installed (`npx playwright install chromium` if missing).

The backend admission integration test needs a migrated test database:

```bash
docker compose up -d postgres
make db-migrate-up
cd backend
SHROOM_TEST_DATABASE_URL='postgres://postgres:postgres@localhost:5433/shroom?sslmode=disable' go test ./internal/room -run TestApprovalGateWithDatabase -count=1
```

Use a disposable database for that command. The test creates and deletes meeting rows. Other backend tests can be run with `cd backend && go test ./...`.

## Live call acceptance check

Start Postgres, Redis, LiveKit, the Go backend, and Vite as described in [README](../README.md#-local-development). Open two separate browser profiles as **Host** and **Guest**. They must have separate sessions. Run through these checks:

| Feedback | What to do | Expected result |
| --- | --- | --- |
| Screen share mirror | Host joins, clicks **Share**, and chooses a tab or screen. | The app tab is excluded from the tab picker where supported. The host's own shared screen does not take a large tile in their grid; Guest still sees the share. Browser screen picker behavior varies by browser. |
| Raised hand sound and visibility | Guest raises a hand while both are in the call. | Host hears one short cue, sees a highlighted Guest tile with a hand and queue position, and sees Guest in the raised hands list. Lowering the hand removes the indicators. |
| Video enhancement | Host enables **Enhance video** in call settings while publishing video. | Host's local preview changes subtly; Guest sees the enhanced outgoing video. Turning it off restores the original picture. Test performance on a low powered phone. |
| Chat links | Guest sends a public HTTPS URL in chat. | The URL is clickable, and a title/description/image card appears when that site permits metadata retrieval. Plain text and unsafe URLs remain safe text. |
| Host approval | Host checks **Require host approval** before starting. Guest opens the invite. Host approves, then repeat with a denied guest. | Guest stays on **Waiting for the host** without a LiveKit connection until approved. Host sees the request. Approval leads to the device check. Denial prevents entry. |
| Mobile camera flip | Open the room on a phone with front and rear cameras, tap **Flip camera** before joining and again in the call. | Preview and published video switch cameras without leaving the meeting. The browser must grant camera access. |
| Speaker selection | On a browser with multiple output devices, open call settings and change **Speaker**. | Remote audio moves to the selected output. If the browser has no output routing support, use system sound settings; the selector is hidden. |
| Join and leave sound preference | Choose each **Call sounds** option; have Guest leave and rejoin. | **Off** is silent; **Raised hands only** omits join/leave cues; **Join, leave, and hands** plays all cues. The choice persists after reload. |

Use two real devices for the sound, speaker, and camera checks. Fake media and browser automation cannot confirm what a person hears or how a phone camera looks. The Google sign-in item was already integrated before these changes and is outside this checklist.
