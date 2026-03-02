# YouTube Checker

An Electron application for downloading and tracking YouTube videos. Works together with a TamperMonkey userscript that monitors YouTube interactions — when you like a video it is automatically queued for download via yt-dlp.

---

## How it works

1. The TamperMonkey script runs on YouTube and tracks liked/disliked videos in the browser's IndexedDB.
2. When a liked video is detected the script sends a download request to the local Express API (port 5000).
3. The Electron app downloads the video with yt-dlp + ffmpeg and embeds the source URL in the file's metadata.
4. On the next YouTube session the TamperMonkey script syncs with the app to learn which downloads actually succeeded and updates its local database accordingly.

---

## Requirements

- **Windows 10/11** (the app is Windows-only)
- **Node.js 22** — use [nvm-windows](https://github.com/coreybutler/nvm-windows) to manage versions
- **npm 10**
- The binaries below are downloaded automatically — you do **not** need to install them manually

| Binary | Source | Purpose |
|--------|--------|---------|
| `yt-dlp.exe` | [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | Video downloader |
| `ffmpeg.exe` | [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) | Video/audio merging |
| `ffprobe.exe` | same | Stream analysis (used internally by yt-dlp) |

---

## Development

### First-time setup (fresh clone)

```bash
npm install
npm run setup
```

`npm run setup` creates the required directories (`bin/`, `logs/`, `videos/`) and automatically downloads `yt-dlp.exe` and the ffmpeg suite into `bin/`. This takes a minute — ffmpeg is ~170 MB.

### Run in development mode

```bash
npm run dev
```

> **Note:** In dev mode the taskbar icon shows Electron's own icon instead of the app icon. This is a known Electron limitation and does not affect functionality.

`npm run start` does the same but first checks your active Node.js version via nvm and switches if needed.

### If binaries go missing

The app detects missing binaries on every startup and re-downloads them automatically. You can also trigger it manually:

```bash
npm run install-bins
```

---

## Building for production

```bash
npm run build
```

This runs three steps in sequence:

1. **Download binaries** — `node scripts/install-binaries.js` downloads `yt-dlp.exe` and `ffmpeg.exe/ffprobe.exe` into `bin/` if they are not already there (skips existing files).
2. **Clean** — kills any running Electron/YouTube Checker processes and removes the `dist/` folder.
3. **Package** — `electron-builder` bundles everything into a Windows portable executable at `dist/YouTube Checker.exe`. The three binaries above are included via `extraFiles` and placed next to the exe.

The resulting `dist/YouTube Checker.exe` is fully self-contained — just move it anywhere and run it.

---

## TamperMonkey userscript

Install `tamper-monkey-script.js` as a userscript in [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Firefox/Edge).

The script:
- Highlights tracked videos on the YouTube homepage and search results (orange border).
- Displays the date you first watched each video.
- Sends a download request to the local app when you like a video.
- Syncs download status with the app on every page load — videos are only marked as downloaded once the app confirms the file exists.

### Sync behaviour

- **Liking a video** → sends a queued-download request; the video is **not** immediately marked as downloaded.
- **Next YouTube page load** → the script uploads its database to the app and receives back the list of video codes that were actually downloaded; those are then marked as `download: true` locally.
- This means a failed download stays as "not downloaded" and will be retried the next time you visit that video's page.

---

## Logging

All logs are written to the `logs/` directory (relative to where the app/exe is running):

| File | Content |
|------|---------|
| `logs/activity.log` | One line per event: `TIMESTAMP \| STATUS \| url-or-label` |
| `logs/<videoId>.log` | Full verbose yt-dlp output for that specific video |

### Activity log statuses

| Status | Meaning |
|--------|---------|
| `STARTED` | Download process started |
| `SUCCESS` | Download completed successfully |
| `ERROR` | Download failed |
| `DUPLICATE` | Video already downloaded or in progress |
| `UPDATE_CHECK` | yt-dlp daily version check |
| `UP_TO_DATE` | yt-dlp is current |
| `UPDATING` | Downloading newer yt-dlp version |
| `UPDATED` | yt-dlp updated successfully |
| `UPDATE_FAIL` | yt-dlp update/check failed |
| `INSTALLING` | First-time binary download |
| `INSTALLED` | Binary installed successfully |
| `INSTALL_FAIL` | Binary download failed |

---

## yt-dlp auto-update

On every app startup the updater checks GitHub for a new yt-dlp release. If a newer version is found it downloads and replaces `yt-dlp.exe` automatically. The check also repeats every 24 hours while the app is running. All activity is logged to `logs/activity.log` and visible in the app window.

---

## GitHub Releases (automated)

Releases are built and published automatically via [GitHub Actions](.github/workflows/release.yml).

### Create a release

```bash
git tag v2.1.0
git push --tags
```

The workflow:
1. Checks out the code on a `windows-latest` runner.
2. Runs `npm ci` to install dependencies.
3. Downloads the required binaries (`node scripts/install-binaries.js`).
4. Builds the portable exe (`electron-builder`).
5. Creates a GitHub Release with auto-generated release notes and attaches the built `.exe`.

No extra secrets are required — the workflow uses the built-in `GITHUB_TOKEN`.

### Manual release

1. Run `npm run build` locally.
2. Go to **GitHub → Releases → Draft a new release**.
3. Create a new tag (e.g. `v2.1.0`).
4. Drag `dist/YouTube Checker.exe` into the assets section.
5. Publish.

---

## Data files

These files are gitignored and live next to the app (or exe in production):

| File | Description |
|------|-------------|
| `downloaded_videos.json` | `string[]` of YouTube URLs the app has successfully downloaded (app-managed) |
| `YouTubeWatchTracker.json` | Latest snapshot of the TamperMonkey IndexedDB (written on each sync) |

---

## Project structure

```
src/
  main.js              — Electron entry point
  config.js            — Central configuration and paths
  api/
    server.js          — Express server (port 5000)
    routes.js          — GET /, POST /download, POST /upload-db
  services/
    downloader.js      — Runs yt-dlp, manages active downloads
    metadata.js        — Reads embedded URLs from downloaded MP4 files
    storage.js         — Read/write JSON data files
    updater.js         — Binary installer + yt-dlp auto-updater
    protocol.js        — Windows custom protocol handler
  ui/
    window.js          — BrowserWindow lifecycle
    tray.js            — System tray icon and menu
  utils/
    logger.js          — IPC logger (UI) + activity.log file writer
    notifications.js   — Desktop notifications

scripts/
  setup.js             — First-time setup (dirs + binaries)
  install-binaries.js  — Downloads yt-dlp.exe and ffmpeg suite to bin/

renderer/
  renderer.js          — Log viewer UI logic
  styles.css           — Dark theme styles

bin/                   — 3rd-party executables (gitignored, auto-downloaded)
dist/                  — Build output (gitignored)
logs/                  — Runtime logs (gitignored)
videos/                — Downloaded video files (gitignored)
```
