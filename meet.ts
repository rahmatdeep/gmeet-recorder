import { chromium, type BrowserContext } from 'playwright';
import path from 'path';

async function run() {
    const meetUrl = process.argv[2];
    const name = process.argv[3] || 'Assistant'; // Default name if none provided
    if (!meetUrl) {
        console.log('Usage: bun meet.ts <google-meet-url> [your-name]');
        process.exit(1);
    }

    const userDataDir = path.join(process.cwd(), 'user_data');
    console.log(`Using user data directory: ${userDataDir}`);

    // Launch persistent context
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        permissions: ['microphone', 'camera'],
        args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--disable-blink-features=AutomationControlled', // Help avoid bot detection
        ],
        ignoreDefaultArgs: ['--enable-automation'], // Help avoid bot detection
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
    await page.goto(meetUrl, { waitUntil: 'networkidle' });

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

        // Second, check if we need to enter a name (if not logged in)
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

    console.log('Meeting script is running. Keep this window open.');

    // Handle closure
    page.on('close', () => {
        console.log('Browser window closed.');
        process.exit(0);
    });

    // Keep active
    await new Promise(() => { });
}

run().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
