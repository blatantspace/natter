# Natter · A private chat lounge for friends

A private, Slack-like group chat and file-sharing app built for friends and close circles (~20 people).

- **Runs on your own server**: Messages and files are kept in a small database and a folder on the machine you run it on. Nothing goes to a cloud service. They are stored as plain text and plain files, so keep the server and its backups somewhere you trust.
- **Cross-Platform (Windows, Mac, Linux, Mobile)**: Works in any modern browser and installs with 1 click as a standalone desktop app via PWA.
- **1-Click Onboarding**: Send a friend the site address. They open it, pick a name, and they are in.

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

1. Open your app and click **Invite** in the top right.
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
The server will run on port `3847` (or whatever `PORT` you specify) and serve both the API, live updates, and static frontend assets.

---

## Features

- **Drag & Drop Files**: Drag photos, videos, audio clips, or PDFs into the chat window and they upload as they are.
- **Inline Media**: Images, video, and audio play directly in the chat stream.
- **Slack Aesthetic**: Dark aubergine sidebar, `#channels`, 1-on-1 Direct Messages, online presence indicators, and clean message grouping.
- **Message Threads**: Full Slack-like right-hand drawer for threaded discussions and file replies.
- **Emoji Reactions**: Hover over any message to quickly react with emojis and view who reacted in real-time.
- **Desktop Notifications & Sound Alerts**: Native desktop popups when backgrounded plus optional two-tone audio chime.
