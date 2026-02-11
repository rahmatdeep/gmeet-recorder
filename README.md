# Google Meet Recorder 🎥

A robust, self-contained bot to record Google Meet sessions with synchronized audio and video using **Playwright** and **Bun**. Runs seamlessly in Docker with zero login required — just point it at a Meet URL.

[**View on Docker Hub 🐳**](https://hub.docker.com/r/rahmatdeep/gmeet-recorder)

---

## ✨ Key Features

| Feature | Details |
|---|---|
| 🎥 **Composite A/V Recording** | Captures tab video via `getDisplayMedia` and page audio via `WebAudio`, merging them into a single `.webm` file using the browser's `MediaRecorder` API. |
| 📝 **Custom Filenames** | Use `--filename "my-recording"` to name the output. Defaults to `<meeting-id>_<timestamp>.webm`. |
| 🔐 **Stateless & Concurrent** | Every run uses a fresh in-memory browser profile — no `SingletonLock`, no login, no file-lock contention. Spin up multiple bots in parallel. |
| 🤖 **Intelligent Auto-Join** | Automatically dismisses overlays ("Dismiss"/"Got it"/"OK"), mutes mic & camera, enters the bot name, and clicks "Join now" or "Ask to join". |
| 🚪 **Kick & End Detection** | Four detection methods: UI buttons ("Return to home screen"), text scanning (removal messages, "meeting ended"), ARIA/data attributes, and URL-based checks (`/bye`, `?uhb=`). |
| ⏱️ **Smart Auto-Exit** | Monitors participant count via button text, ARIA labels, and video tiles. Triggers a 15-second countdown when the bot is the only participant, with a 10-second initial grace period to avoid false positives. |
| ⏳ **Duration-Based Timeout** | Set a max recording duration via CLI arg or `MAX_DURATION_MINUTES` env var (CLI takes priority). |
| 🔍 **Meeting ID Validation** | Validates the link before recording: checks HTTP 404 responses *and* SPA-rendered error pages (e.g. "Check your meeting code", "Return to home screen"). Exits early with a non-zero code on invalid links. |
| 💾 **Chunked Streaming** | Recording data is written to disk in 1-second chunks via `ondataavailable`, keeping memory usage low and ensuring partial recordings are saved even on crash. |
| 🐳 **Docker Optimized** | Multi-arch image (`AMD64` + `ARM64`). Uses Xvfb for a virtual display, Microsoft's Playwright base image, and `--ipc=host` with 2GB shared memory for stability. |
| 🎬 **Headless Mode** | Pass `--headless` to run without a display server (useful for local non-Docker usage). |
| 🛡️ **Graceful Shutdown** | Handles `SIGINT` and `SIGTERM` — stops the `MediaRecorder`, flushes final chunks, clicks "Leave call", and closes the browser cleanly. |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker Container                               │
│  ┌────────────┐    ┌──────────────────────────┐ │
│  │   Xvfb     │───▶│   Chromium (Playwright)  │ │
│  │ :99 display│    │                          │ │
│  └────────────┘    │  ┌────────────────────┐  │ │
│                    │  │   meet.ts (Bun)    │  │ │
│                    │  │                    │  │ │
│                    │  │  getDisplayMedia → │  │ │
│                    │  │  Tab video track   │  │ │
│                    │  │                    │  │ │
│                    │  │  WebAudio API →    │  │ │
│                    │  │  Page audio track  │  │ │
│                    │  │                    │  │ │
│                    │  │  MediaRecorder →   │  │ │
│                    │  │  1s chunks →       │──┼─┼──▶ recordings/*.webm
│                    │  │  saveRecordingChunk│  │ │
│                    │  └────────────────────┘  │ │
│                    └──────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## 🛠 Docker Setup (Recommended)

Using Docker ensures all dependencies (Chromium, Xvfb, Bun) are correctly configured.

### 1. Build the Image
```bash
docker-compose build
```

### 2. Run the Recorder
```bash
# Basic usage
docker-compose run --rm recorder bun meet.ts "<MEET_URL>" "<BOT_NAME>" <DURATION_MINS>

# With custom filename
docker-compose run --rm recorder bun meet.ts "<MEET_URL>" "<BOT_NAME>" <DURATION_MINS> --filename "my-recording"
```

| Argument | Required | Default | Description |
|---|---|---|---|
| `<MEET_URL>` | ✅ | — | Full Google Meet URL (e.g. `https://meet.google.com/abc-defg-hij`) |
| `<BOT_NAME>` | ❌ | `Shadow NoteTaker` | Display name shown to other participants |
| `<DURATION_MINS>` | ❌ | `15` (from env) | Auto-exit after this many minutes |
| `--filename` | ❌ | `<meetingId>_<timestamp>.webm` | Custom output filename |
| `--headless` | ❌ | `false` | Run Chromium without a display (local use only) |

### 📂 Volumes
| Host | Container | Purpose |
|---|---|---|
| `./recordings/` | `/app/recordings` | Where `.webm` files are persisted |

### ⚙️ Environment Variables
| Variable | Default | Description |
|---|---|---|
| `MAX_DURATION_MINUTES` | `15` | Fallback duration if no CLI arg is passed |
| `CI` | `true` | Ensures non-interactive browser behavior |
| `DISPLAY` | `:99` | Set in Dockerfile; matches Xvfb display |

### 🚀 Direct Docker Usage
Pull from Docker Hub without cloning the repo:
```bash
docker run --rm \
  -v $(pwd)/recordings:/app/recordings \
  --ipc=host --shm-size=2gb \
  rahmatdeep/gmeet-recorder:latest \
  bun meet.ts "<MEET_URL>" "<BOT_NAME>" <DURATION_MINS> --filename "custom-name"
```

> [!IMPORTANT]
> Always use `--ipc=host` and `--shm-size=2gb` (or equivalent `shm_size` in compose) to prevent Chromium crashes during recording.

---

## 🔐 Stateless Recording

The bot is completely **stateless** — each run launches an ephemeral browser profile (no `userDataDir`). This means:
- No file locks (`SingletonLock`).
- Multiple bots can record different meetings concurrently.
- No Google login or browser "seeding" is required.

```bash
# Run multiple bots in parallel
docker-compose run --rm recorder bun meet.ts <URL_1> "Bot 1" &
docker-compose run --rm recorder bun meet.ts <URL_2> "Bot 2" &
```

---

## 🧠 How It Works

### 1. Meeting Validation
Before attempting to join, the bot validates the meeting link in two phases:
- **HTTP check** — exits immediately on a `404` response.
- **SPA check** — waits 5 seconds for the page to render, then scans for error text ("Check your meeting code", "Invalid meeting code", "Returning to home screen") and a "Return to home screen" button.

### 2. Joining the Meeting
The `attemptJoin` loop runs up to 30 iterations (≈60 seconds):
1. **Dismiss overlays** — clicks "Dismiss", "Got it", or "OK" buttons from permission popups.
2. **Mute mic & camera** — detects un-muted state via `aria-label` and clicks to disable.
3. **Enter bot name** — fills the name input if present (guest/non-logged-in flow).
4. **Click join** — tries `"Join now"` and `"Ask to join"` selectors.

After clicking join, the bot waits up to 5 minutes for in-meeting UI markers (Chat/People/Meeting details buttons) to confirm admission.

### 3. Recording
The recording pipeline runs entirely inside the browser page via `page.evaluate`:
1. **Video** — captured from the current tab using `getDisplayMedia({ preferCurrentTab: true })`.
2. **Audio** — captured by creating an `AudioContext` and connecting all `<video>` and `<audio>` element sources to a `MediaStreamDestination`. A polling interval (every 3s) detects and connects new media elements as participants join.
3. **Merge** — video and audio tracks are combined into a single `MediaStream` fed to a `MediaRecorder` (WebM format).
4. **Streaming to disk** — every 1-second chunk is passed via `window.saveRecordingChunk()` (exposed by Playwright's `context.exposeFunction`) to a Node.js `WriteStream`.

### 4. Monitoring & Auto-Exit
A 3-second polling interval monitors the meeting state:

| Check | Method |
|---|---|
| **Kick detection** | Scans for "Return to home screen" button, "removed from meeting" text, removal ARIA attributes, and URL changes (`/bye`, `?uhb=`) |
| **Participant count** | Reads button text matching `/^\d+$/`, ARIA labels matching `(N)` or "N participants", and counts `[data-participant-id]` tiles |
| **Alone detection** | If participant count ≤ 1, starts a 15s countdown. Resets if participants rejoin. Skipped during a 10s initial grace period. |
| **Duration timeout** | If `maxDurationMins` is set, a `setTimeout` triggers `cleanup()` after that many minutes. |

### 5. Cleanup
`cleanup()` is triggered by auto-exit, kick detection, duration timeout, `SIGINT`, or `SIGTERM`:
1. Stops the browser-side `MediaRecorder` and all stream tracks.
2. Waits 2 seconds for final chunks to flush.
3. Clicks the "Leave call" button (if visible).
4. Closes the `WriteStream`, browser context, and browser.
5. Exits with code `0`.

---

## 🤖 Programmatic Usage (Node.js)

Spawn recording bots on demand with `dockerode`:

```javascript
const Docker = require('dockerode');
const docker = new Docker();

async function startBot(meetUrl, botName, durationMins, filename) {
  const cmd = ['bun', 'meet.ts', meetUrl, botName, durationMins.toString()];

  if (filename) {
    cmd.push('--filename', filename);
  }

  const container = await docker.createContainer({
    Image: 'rahmatdeep/gmeet-recorder:latest',
    Cmd: cmd,
    HostConfig: {
      ShmSize: 2 * 1024 * 1024 * 1024, // 2GB
      Binds: [`${process.cwd()}/recordings:/app/recordings`],
      AutoRemove: true
    }
  });
  await container.start();
}
```

> [!IMPORTANT]
> Always ensure `ShmSize` is at least **2GB** to prevent browser crashes during recording.

---

## 📋 Bot Log States

A complete reference of every log message the bot can emit, organized by lifecycle phase.

### 1. Startup

| Log | Level | Condition |
|---|---|---|
| `Usage: bun meet.ts <google-meet-url> [your-name] [duration-mins] [--headless]` | info | No URL argument provided |
| `Running in HEADLESS mode` | info | `--headless` flag passed |
| `Auto-exit timer set for <N> minutes.` | info | Duration arg or `MAX_DURATION_MINUTES` env set |

### 2. Navigation

| Log | Level | Condition |
|---|---|---|
| `Navigating to <url>...` | info | Always |
| `BROWSER LOG: <message>` | info | Any browser console output (includes Meet's own logs) |

### 3. Meeting Validation

| Log | Level | Condition |
|---|---|---|
| `ERROR: Invalid meeting ID (404 Not Found).` | ❌ error | HTTP 404 response — exits with code 1 |
| `ERROR: Invalid meeting ID. Please check the meeting code or URL.` | ❌ error | SPA error page detected (e.g. "Check your meeting code") — exits with code 1 |

### 4. Pre-Join & Join

| Log | Level | Condition |
|---|---|---|
| `Recording file will be saved to: <path>` | info | Always |
| `Waiting for meeting room to be ready...` | info | Always |
| `Dismissed overlay using selector: <selector>` | info | Clicked a "Dismiss"/"Got it"/"OK" popup |
| `Muted microphone.` | info | Mic was on, clicked to mute |
| `Disabled camera.` | info | Camera was on, clicked to disable |
| `Entered name: <name>` | info | Name input was empty, filled it |
| `Clicked join button using selector: <selector>` | info | Found & clicked "Join now" or "Ask to join" |
| `Join button not found or already in meeting. Please join manually if not joined.` | info | 30 join attempts failed |
| `Waiting for in-meeting UI to appear (Chat/People buttons) before starting recording...` | info | Always, after join attempt |
| `Bot is still in the "Asking to join" state. Waiting for admission...` | info | Host hasn't admitted the bot yet |
| `Bot has been admitted to the meeting.` | info | In-meeting UI detected |
| `Entry declined: Someone in the call denied the bot's request to join.` | ❌ error | Host declined the "Ask to join" request — exits with code 1 |
| `Timed out waiting to join the meeting or in-meeting UI not found.` | ❌ error | 5-minute admission timeout exceeded |

### 5. Recording Initialization

| Log | Level | Condition |
|---|---|---|
| `Attempting to start browser-side recording (Composite Mode)...` | info | Always |
| `Simulating user gesture for MediaRecorder...` | info | Always |
| `Browser: Starting composite stream capture...` | 🌐 browser | Always |
| `Browser: Got video track: <label>` | 🌐 browser | Tab capture succeeded |
| `Browser: AudioContext created. State: <state>` | 🌐 browser | Always |
| `Browser: AudioContext resumed. New State: <state>` | 🌐 browser | AudioContext was suspended |
| `Browser: Found media element <TAG>. Muted: ..., Volume: ..., Paused: ..., ReadyState: ...` | 🌐 browser | For each `<audio>`/`<video>` element found |
| `Browser: Element has srcObject with audio tracks. Using createMediaStreamSource.` | 🌐 browser | Media element uses `srcObject` |
| `Browser: Element has src URL. Using createMediaElementSource.` | 🌐 browser | Media element uses `src` attribute |
| `Browser: Element has srcObject but NO audio tracks. Skipping for now.` | 🌐 browser | `srcObject` has no audio tracks |
| `Browser: Element has no valid source yet. Skipping.` | 🌐 browser | No `src` or `srcObject` |
| `Browser: Successfully connected audio from <TAG>` | 🌐 browser | Audio source connected |
| `Browser: Failed to connect source: <error>` | ⚠️ browser warn | Audio connection failed |
| `Browser: Added audio track to composite stream` | 🌐 browser | Audio track merged into recording |
| `Browser: MediaRecorder started (Composite)` | 🌐 browser | Recording is live |
| `Browser: Failed composite recording: <error>` | ❌ browser error | Entire recording setup failed |
| `Audio and Video recording initialized.` | info | Recording pipeline ready |
| `Meeting script is running. Keep this window open.` | info | Always |

### 6. Recording Data

| Log | Level | Condition |
|---|---|---|
| `Saved chunk. Current file size: <N> bytes` | info | Every 1-second data chunk written to disk |

### 7. Monitoring (every 3 seconds)

| Log | Level | Condition |
|---|---|---|
| `[Monitor] maxCount=<N>, inGrace=<bool>, elapsed=<N>s, debugInfo=[...]` | info | Every poll cycle |
| `Bot is alone (maxCount: <N>). Starting 15s countdown...` | info | Only participant remaining |
| `Still alone after 15s. Auto-exiting.` | info | Alone for 15+ seconds — triggers cleanup |
| `Participants back (maxCount: <N>). Resetting timer.` | info | Others rejoined during countdown |
| `No participant count found. Resetting timer for safety.` | info | Could not determine count — avoids false exits |
| `[Monitor] Error: <error>` | ❌ error | Monitoring poll failed |

### 8. Kick & End Detection

| Log | Level | Condition |
|---|---|---|
| `[Kick Detection] Bot was removed from meeting: <reason>` | info | Kick/end detected — triggers cleanup |
| `Stopping recording and exiting...` | info | Always follows kick detection |

Possible `<reason>` values:
- `Found "Return to home screen" button`
- `Found "Returning to home screen" countdown`
- `Found removal message`
- Any match from: `You've been removed`, `The meeting has ended`, `You can't join this video call`, etc.
- `Detected removal/ended UI element`
- `URL indicates meeting ended`

### 9. Cleanup & Shutdown

| Log | Level | Condition |
|---|---|---|
| `Time limit of <N> minutes reached. Auto-exiting...` | info | Duration timeout hit |
| `Leaving meeting and saving recordings...` | info | Always during cleanup |
| `Browser: MediaRecorder stopped via cleanup` | 🌐 browser | Recorder stopped |
| `Browser: Stream tracks stopped` | 🌐 browser | All tracks released |
| `Browser: MediaRecorder stopped` | 🌐 browser | Final stop confirmation |
| `Error stopping browser recording: <error>` | ❌ error | Browser-side stop failed |
| `Clicked "Leave call" button.` | info | Leave button found & clicked |
| `Could not find leave button, closing directly.` | info | Leave button not visible |
| `Browser closed and recordings saved.` | info | Clean exit complete |
| `Browser window closed.` | info | Page close event fired |
| `Error: <error>` | ❌ error | Top-level uncaught error — exits with code 1 |

---

## 📦 Tech Stack

| Component | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Browser automation | [Playwright](https://playwright.dev/) (Chromium) |
| Container base | `mcr.microsoft.com/playwright:v1.57.0-jammy` |
| Virtual display | Xvfb (1280×720) |
| Recording format | WebM via browser `MediaRecorder` API |
| Audio capture | Web Audio API (`AudioContext` → `MediaStreamDestination`) |
| Video capture | `getDisplayMedia` with `preferCurrentTab` |

---

Built with ⚡️ [Bun](https://bun.sh) and 🎭 [Playwright](https://playwright.dev/).
