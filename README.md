# queueue

A shared mosaic for you and your friends. Drop in a movie folder, an album, a book or a photo dump. queueue finds the artwork and details, everyone in your queueue sees it as a tile, chats about it, and pulls a real copy straight from whoever has one. No server in the middle.

## How it works

- **Mac desktop app** built on Electron + React.
- **Peer to peer** over [Holepunch](https://holepunch.to): Hyperswarm for finding friends, one encrypted Hyperdrive per member for files and records.
- **A queueue is a secret key.** The invite link (`queueue://join/<key>`) derives the swarm topic and the drive encryption key. Peers prove they hold the key in a handshake before anything is exchanged.
- **Feed = every member's drive merged.** Posts, chat, reactions and "I have a copy" markers are small records in each member's drive. Nobody needs to approve new members.
- **Any holder can serve a download.** Once a friend has a copy, they seed it to everyone else even if the original sharer is offline.
- **Metadata** from TMDB (optional key), TVmaze, MusicBrainz + Cover Art Archive, Open Library and Wikipedia, plus local tags (music-metadata, exifr, ffprobe). Artwork is stored in the drive so it shows for everyone offline.

## Develop

```bash
npm install
npm run dev          # electron-vite with hot reload
npm run typecheck
npm run dist         # unsigned dmg + zip in dist/
```

Run extra local instances with separate storage:

```bash
QUEUEUE_PROFILE=b QUEUEUE_DEBUG=1 npx electron .
```

`spike/` holds the replication spikes and a small CDP driver (`spike/cdp.mjs`) used to test multiple instances.
