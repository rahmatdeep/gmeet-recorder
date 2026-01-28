# Google Meet Recorder 🎥

A robust tool to record Google Meet sessions with audio and video using Playwright and Bun. Designed to run seamlessly either locally or in a containerized environment.

[**View on Docker Hub 🐳**](https://hub.docker.com/r/rahmatdeep/gmeet-recorder)

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
docker-compose run --rm recorder bun meet.ts "<MEET_URL>" "<YOUR_BOT_NAME>" <DURATION_MINS>
```
*Replace `<MEET_URL>` with the Google Meet link, `<BOT_NAME>` with the name, and `<DURATION_MINS>` with the auto-exit time (e.g., 30).*

### 📂 Volumes
- **`recordings/`**: All captured `.webm` files are saved here.

### ⚙️ Environment Variables
- **`MAX_DURATION_MINUTES`**: The number of minutes before the bot automatically leaves the meeting. Default is `15`. (Note: Providing a duration as a positional argument will override this value).
- **`CI=true`**: Ensures a headless, non-interactive browser experience.

---

## 🔐 Stateless Recording
The bot is now completely **stateless**. It uses in-memory browser profiles for every run, which means:
- No file locks (`SingletonLock`).
- You can run multiple bots concurrently.
- No login or "seeding" is required for most meetings.

To run concurrently:
```bash
docker-compose run --rm recorder bun meet.ts <URL_1> "Bot 1"
docker-compose run --rm recorder bun meet.ts <URL_2> "Bot 2"
```

To override the timeout (e.g., 30 minutes):
```bash
docker-compose run --rm recorder bun meet.ts <URL> "My Bot" 30
```


---

## 🤖 Programmatic Usage (Node.js)

If you are building a larger system and want to spawn recording bots on demand, you can use the `dockerode` library:

```javascript
const Docker = require('dockerode');
const docker = new Docker();

async function startBot(meetUrl, botName, durationMins) {
  const container = await docker.createContainer({
    Image: 'rahmatdeep/gmeet-recorder:latest',
    Cmd: ['bun', 'meet.ts', meetUrl, botName, durationMins.toString()],
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

Built with ⚡️ [Bun](https://bun.sh) and 🎭 [Playwright](https://playwright.dev/).

