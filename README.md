# Natter · Sovereign Canadian E2EE Lounge

A private, Slack-like group chat and file-sharing app built for friends and close circles (~20 people).

- **100% End-to-End Encrypted (AES-GCM-256)**: Messages and files are encrypted in your browser before leaving your machine.
- **Blind Relay Storage**: The server acts like a locked mail deposit box. It only ever sees and stores encrypted ciphertext. No keys, no unencrypted file contents, no US cloud dependencies.
- **Cross-Platform (Windows, Mac, Linux, Mobile)**: Works in any modern browser and installs with 1 click as a standalone desktop app via PWA.
- **1-Click Onboarding**: Send a friend a link like `https://chat.ourdomain.ca/#key=ROOM_SECRET`. When they open it, keys are derived in the background. Zero cryptographic setup friction.

---

## Quick Start (Local Testing)

```bash
cd natter
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## How to Share with a Friend (POC Testing)

### Option A: Tunnel from your Mac (Quick 5-Minute Test)
Run ngrok or Cloudflare tunnel to get an HTTPS public link:

```bash
ngrok http 5173
```
Copy the generated URL (e.g., `https://abc123xyz.ngrok-free.app`).

1. Open your app and click **🍁 E2EE Active · Invite Bud** in the top right.
2. Click **Copy Link**.
3. Send that link to your friend via text or Signal.
4. Your friend opens the link on Windows, Mac, or Linux, types their name, and they are in.

### Option B: Deploy to a Sovereign Canadian Server (Always-On)
To keep the room alive 24/7 without keeping your laptop open, run it on an **OVH Beauharnois (Quebec)** or Canadian VPS:

```bash
# Build frontend
npm run build

# Start production server
NODE_ENV=production node server/index.js
```
The server will run on port `3847` (or whatever `PORT` you specify) and serve both the API, WebSocket relay, and static frontend assets.

---

## Features

- **Drag & Drop Encrypted Files**: Drag photos, videos, audio clips, or PDFs into the chat window. They are encrypted with AES-256-GCM locally, then uploaded as raw ciphertext.
- **Inline Decrypted Media**: Images, video, and audio decrypt on the client side and play directly in the chat stream.
- **Slack Aesthetic**: Dark aubergine sidebar, `#channels`, 1-on-1 Direct Messages, online presence indicators, and clean message grouping.
- **Message Threads**: Full Slack-like right-hand drawer for threaded discussions and file replies.
- **Emoji Reactions**: Hover over any message to quickly react with emojis and view who reacted in real-time.
- **Desktop Notifications & Sound Alerts**: Native desktop popups when backgrounded plus optional two-tone audio chime.
