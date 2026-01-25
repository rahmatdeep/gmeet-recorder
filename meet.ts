import { chromium, type BrowserContext } from 'playwright';
import path from 'path';

async function run() {
    const args = process.argv.slice(2);
    if (!args[0]) {
        console.log('Usage: bun meet.ts <google-meet-url> [your-name] [--headless]');
        process.exit(1);
    }
    const meetUrl = args[0];
    const name = args.find(a => !a.startsWith('--') && a !== meetUrl) || 'Assistant';
    const isHeadless = args.includes('--headless');

    const userDataDir = path.join(process.cwd(), 'user_data');
    const recordingsDir = path.join(process.cwd(), 'recordings');
    console.log(`Using user data directory: ${userDataDir}`);
    if (isHeadless) console.log('Running in HEADLESS mode');

    // Ensure recordings directory exists
    if (!require('fs').existsSync(recordingsDir)) {
        require('fs').mkdirSync(recordingsDir);
    }

    // Launch persistent context
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: isHeadless,
        permissions: ['microphone', 'camera'],
        args: [
            '--use-fake-ui-for-media-stream',
            '--disable-blink-features=AutomationControlled',
            '--auto-select-tab-capture-source-by-title="Meet"',
            '--enable-features=TabCapture,WebRTCPipeWireCapturer',
            '--allow-http-screen-capture',
            '--autoplay-policy=no-user-gesture-required',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        viewport: { width: 1280, height: 720 },
    });

    // Grant permissions for camera and microphone
    await context.grantPermissions(['camera', 'microphone'], { origin: 'https://meet.google.com' });

    // Use the first page created by the persistent context
    let page = context.pages()[0];
    if (!page) {
        page = await context.newPage();
    }

    console.log(`Navigating to ${meetUrl}...`);
    // Pipe browser console logs to terminal
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    await page.goto(meetUrl, { waitUntil: 'networkidle' });

    // --- Merged Recording Setup (Audio + Video) ---
    const recordingPath = path.join(recordingsDir, `meet-record-${Date.now()}.webm`);
    const recordingStream = require('fs').createWriteStream(recordingPath);

    await context.exposeFunction('saveRecordingChunk', (data: any) => {
        // Playwright might send this as an object of {index: value}
        // or a Buffer/Uint8Array depending on versions. We handle both.
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(Object.values(data) as number[]);
        recordingStream.write(buffer);
        console.log(`Saved chunk. Current file size: ${require('fs').statSync(recordingPath).size} bytes`);
    });

    const startMergedRecording = async () => {
        console.log('Attempting to start browser-side recording (Composite Mode)...');
        await page.waitForTimeout(5000); // Wait for media to load

        try {
            console.log('Simulating user gesture for MediaRecorder...');
            await page.click('body', { force: true });
        } catch (e) { }

        await page.evaluate(async () => {
            console.log('Browser: Starting composite stream capture...');
            try {
                // 1. Get Video track from Tab Capture
                // @ts-ignore
                const displayStream = await navigator.mediaDevices.getDisplayMedia({
                    video: { displaySurface: 'browser' } as any,
                    // @ts-ignore
                    preferCurrentTab: true,
                    audio: false // We will handle audio via WebAudio for robustness
                });
                const videoTrack = displayStream.getVideoTracks()[0];
                if (!videoTrack) throw new Error('No video track');
                console.log('Browser: Got video track:', videoTrack.label);

                // 2. Setup AudioContext to capture page audio
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                console.log('Browser: AudioContext created. State:', audioCtx.state);

                if (audioCtx.state === 'suspended') {
                    await audioCtx.resume();
                    console.log('Browser: AudioContext resumed. New State:', audioCtx.state);
                }

                const destination = audioCtx.createMediaStreamDestination();

                const connectElements = () => {
                    const videoElements = Array.from(document.querySelectorAll('video'));
                    const audioElements = Array.from(document.querySelectorAll('audio'));
                    const mediaElements = [...videoElements, ...audioElements];

                    mediaElements.forEach(el => {
                        // @ts-ignore
                        if (el._connected) return;

                        // Debug log element state
                        // @ts-ignore
                        console.log(`Browser: Found media element <${el.tagName}>. Muted: ${el.muted}, Volume: ${el.volume}, Paused: ${el.paused}, ReadyState: ${el.readyState}`);

                        try {
                            let source;
                            // @ts-ignore
                            if (el.srcObject) {
                                // Check if the stream actually has audio tracks
                                // @ts-ignore
                                const audioTracks = el.srcObject.getAudioTracks();
                                if (audioTracks.length === 0) {
                                    console.log('Browser: Element has srcObject but NO audio tracks. Skipping for now.');
                                    return;
                                }

                                console.log('Browser: Element has srcObject with audio tracks. Using createMediaStreamSource.');
                                // @ts-ignore
                                source = audioCtx.createMediaStreamSource(el.srcObject);
                            } else if (el.src && el.src !== '') {
                                console.log('Browser: Element has src URL. Using createMediaElementSource.');
                                source = audioCtx.createMediaElementSource(el);
                            } else {
                                console.log('Browser: Element has no valid source yet. Skipping.');
                                return;
                            }

                            // Connect to Destination (for recording) -> Hardware (for hearing)
                            source.connect(destination); // To Recording
                            source.connect(audioCtx.destination); // To Speaker

                            // @ts-ignore
                            el._connected = true;
                            console.log('Browser: Successfully connected audio from', el.tagName);
                        } catch (e) {
                            console.warn('Browser: Failed to connect source:', e);
                        }
                    });
                };

                connectElements();
                const checkInterval = setInterval(connectElements, 3000); // Check more frequently initially

                // 3. Combine tracks into a new stream
                // @ts-ignore
                const compositeStream = new MediaStream([videoTrack]);
                const audioTracks = destination.stream.getAudioTracks();
                if (audioTracks[0]) {
                    compositeStream.addTrack(audioTracks[0]);
                    console.log('Browser: Added audio track to composite stream');
                }

                const mediaRecorder = new MediaRecorder(compositeStream, {
                    mimeType: 'video/webm'
                });

                mediaRecorder.ondataavailable = async (e: BlobEvent) => {
                    if (e.data.size > 0) {
                        const buffer = await e.data.arrayBuffer();
                        // @ts-ignore
                        window.saveRecordingChunk(new Uint8Array(buffer));
                    }
                };

                mediaRecorder.onstart = () => console.log('Browser: MediaRecorder started (Composite)');
                mediaRecorder.onstop = () => {
                    console.log('Browser: MediaRecorder stopped');
                    clearInterval(checkInterval);
                    audioCtx.close();
                };

                mediaRecorder.start(1000);

                // Storage for cleanup
                // @ts-ignore
                window._mediaRecorder = mediaRecorder;
                // @ts-ignore
                window._recordingStream = compositeStream;
            } catch (err) {
                console.error('Browser: Failed composite recording:', err);
            }
        });
    };

    // Check if we need to log in
    if (page.url().includes('accounts.google.com')) {
        console.log('------------------------------------------------------------');
        console.log('ACTION REQUIRED: Please sign in to your Google Account.');
        console.log('Authentication will be saved for future runs.');
        console.log('------------------------------------------------------------');

        // Wait for navigation back to Google Meet after login
        try {
            await page.waitForURL(/meet.google.com/, { timeout: 0 });
            console.log('Successfully returned to Google Meet.');
        } catch (err) {
            console.error('Wait for Meet URL failed or timed out.');
        }
    }

    console.log('Waiting for meeting room to be ready...');

    // Function to click join button if found
    const attemptJoin = async () => {
        // First, try to dismiss any overlays (like microphone/camera blocked popups)
        const dismissSelectors = [
            'button:has-text("Dismiss")',
            'button:has-text("Got it")',
            'button:has-text("OK")'
        ];

        for (const selector of dismissSelectors) {
            try {
                const btn = page.locator(selector).first();
                if (await btn.isVisible({ timeout: 500 })) {
                    await btn.click();
                    console.log(`Dismissed overlay using selector: ${selector}`);
                }
            } catch (e) { }
        }

        // Second, ensure mic and camera are off before joining
        try {
            const micButton = page.locator('[aria-label*="microphone"][aria-label*="off"], [aria-label*="microphone"][data-is-muted="false"]').first();
            const camButton = page.locator('[aria-label*="camera"][aria-label*="off"], [aria-label*="camera"][data-is-muted="false"]').first();

            // Note: Google Meet's labels can be tricky. Usually, if data-is-muted is "false", it's currently ON.
            // We want to click it to turn it OFF.

            // Check mic
            const micLabel = await micButton.getAttribute('aria-label') || '';
            if (micLabel.toLowerCase().includes('turn off') || micLabel.toLowerCase().includes('mute')) {
                await micButton.click();
                console.log('Muted microphone.');
            }

            // Check cam
            const camLabel = await camButton.getAttribute('aria-label') || '';
            if (camLabel.toLowerCase().includes('turn off') || camLabel.toLowerCase().includes('disable')) {
                await camButton.click();
                console.log('Disabled camera.');
            }
        } catch (e) {
            // If they are already off, the "Turn off" selectors might not match.
        }

        // Third, check if we need to enter a name (if not logged in)
        try {
            const nameInput = page.locator('input[placeholder*="name"], input[aria-label*="name"]').first();
            if (await nameInput.isVisible({ timeout: 1000 })) {
                const currentVal = await nameInput.inputValue();
                if (!currentVal) {
                    await nameInput.fill(name);
                    console.log(`Entered name: ${name}`);
                }
            }
        } catch (e) {
            // Log once if it fails but don't stop the loop
        }

        const selectors = [
            'span:has-text("Join now")',
            'span:has-text("Ask to join")',
            'button:has-text("Join now")',
            'button:has-text("Ask to join")',
            '[aria-label="Join now"]'
        ];

        for (const selector of selectors) {
            try {
                const button = page.locator(selector).first();
                if (await button.isVisible({ timeout: 2000 })) {
                    await button.click();
                    console.log(`Clicked join button using selector: ${selector}`);
                    return true;
                }
            } catch (e) {
                // Ignore and try next
            }
        }
        return false;
    };

    // Keep checking for the join button
    let joined = false;
    for (let i = 0; i < 30; i++) { // Try for 60 seconds (2s x 30)
        joined = await attemptJoin();
        if (joined) break;
        await page.waitForTimeout(2000);
    }

    if (!joined) {
        console.log('Join button not found or already in meeting. Please join manually if not joined.');
    }

    // Wait for the meeting to actually start (indicated by the presence of in-meeting UI markers)
    console.log('Waiting for in-meeting UI to appear (Chat/People buttons) before starting recording...');
    try {
        // Wait for indicators that ONLY appear once INSIDE the meeting
        const inMeetingSelectors = [
            'button[aria-label="Chat with everyone"]',
            'button[aria-label="Show everyone"]',
            'button[aria-label="Meeting details"]'
        ];

        await Promise.any(inMeetingSelectors.map(s => page.waitForSelector(s, { timeout: 300000, state: 'visible' })));

        // Additional check: The "Please wait until a meeting host brings you into the call" message should be gone
        const askingMessage = page.locator('text="Please wait until a meeting host brings you into the call"');
        if (await askingMessage.isVisible({ timeout: 2000 })) {
            console.log('Bot is still in the "Asking to join" state. Waiting for admission...');
            await askingMessage.waitFor({ state: 'hidden', timeout: 300000 });
        }

        console.log('Bot has been admitted to the meeting.');
        await page.waitForTimeout(3000); // Small buffer for UI to fully load
        await startMergedRecording();
        console.log('Audio and Video recording initialized.');
    } catch (e) {
        console.error('Timed out waiting to join the meeting or in-meeting UI not found.');
    }

    console.log('Meeting script is running. Keep this window open.');

    // Keep active
    await new Promise((resolve) => {
        const cleanup = async () => {
            console.log('\nLeaving meeting and saving recordings...');

            // Stop recording browser-side first
            try {
                await page.evaluate(() => {
                    // @ts-ignore
                    if (window._mediaRecorder && window._mediaRecorder.state !== 'inactive') {
                        // @ts-ignore
                        window._mediaRecorder.stop();
                        console.log('Browser: MediaRecorder stopped via cleanup');
                    }
                    // @ts-ignore
                    if (window._recordingStream) {
                        // @ts-ignore
                        window._recordingStream.getTracks().forEach(t => t.stop());
                        console.log('Browser: Stream tracks stopped');
                    }
                });
                // Wait for final chunks to be processed
                await page.waitForTimeout(2000);
            } catch (e) {
                console.error('Error stopping browser recording:', e);
            }

            try {
                // Try to click the "Leave call" button
                const leaveButton = page.locator('button[aria-label="Leave call"], button:has-text("Leave call")').first();
                if (await leaveButton.isVisible({ timeout: 2000 })) {
                    await leaveButton.click();
                    console.log('Clicked "Leave call" button.');
                    // Give it a moment to send the 'leaving' signaling to Google servers
                    await page.waitForTimeout(1000);
                }
            } catch (e) {
                console.log('Could not find leave button, closing directly.');
            }

            recordingStream.end();
            await context.close();
            console.log('Browser closed and recordings saved.');
            process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        page.on('close', () => {
            console.log('Browser window closed.');
            process.exit(0);
        });
    });
}

run().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
