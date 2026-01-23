# Google Meet Recorder 🎥

A robust tool to record Google Meet sessions with audio and video using Playwright and Bun. Designed to run seamlessly either locally or in a containerized environment.

---

## 🛠 Docker Setup (Recommended)

Using Docker ensures all dependencies (Chromium, Xvfb, Bun) are correctly configured.

### 1. Build the Image
```bash
docker-compose build
```

### 2. Run the Recorder
To start recording a meeting, use the following command:
```bash
docker-compose run --rm recorder bun meet.ts "<MEET_URL>" "<YOUR_BOT_NAME>"
```
*Replace `<MEET_URL>` with the Google Meet link and `<YOUR_NAME>` with the name the bot should use to join.*

### 📂 Volumes
- **`recordings/`**: All captured `.webm` files are saved here.
- **`user_data/`**: Stores browser profiles and session data (useful for staying logged in).

---

## 💻 Local Usage

### Prerequisites
- [Bun](https://bun.sh) installed.
- Playwright browsers installed (`bunx playwright install`).

### 1. Install Dependencies
```bash
bun install
```

### 2. Run Locally
```bash
bun meet.ts <google-meet-url> [your-name] [--headless]
```

#### Example:
```bash
bun meet.ts https://meet.google.com/abc-defg-hij "Recorder Bot"
```

---

## 🔐 Authentication
If it's your first time running or if the session expired:
1. Run **without** `--headless` (or use the persistent volumes in Docker).
2. Complete the Google login manually in the browser window.
3. The session will be saved in the `user_data` directory for future automated runs.

---

Built with ⚡️ [Bun](https://bun.sh) and 🎭 [Playwright](https://playwright.dev/).

