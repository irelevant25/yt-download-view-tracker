# Architecture & invariants

## Processes

```
Browser (YouTube tab)                Electron main process
┌────────────────────────┐           ┌──────────────────────────────┐
│ tamper-monkey-script.js│           │ src/main.js                  │
│  IndexedDB "YouTube    │           │  ├ api/server.js  :5000      │
│   WatchTracker"/videos │──HTTP────▶│  │  └ api/routes.js         │
│  GM_xmlhttpRequest     │           │  ├ services/downloader.js    │
└────────────────────────┘           │  │    └ exec(yt-dlp.exe)    │
         ▲                           │  ├ services/updater.js       │
         │ youtube-checker://        │  ├ services/metadata.js      │
         └───────────────────────────│  └ ui/{window,tray}.js       │
           (protocol wakes the app)  └──────────────────────────────┘
                                                │ IPC 'log'
                                       renderer/renderer.js (log viewer)
```

## Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/` | — | `{status:'ok'}` — used as a liveness probe by the userscript |
| POST | `/download` | `{url}` | `{message}` — fire-and-forget; download runs async |
| POST | `/upload-db` | `{data: Video[]}` | `{message, downloadedVideoCodes: string[]}` |

## Sync contract (userscript ⇄ app)

This is the part that is easy to break. Both sides must agree:

1. On startup the userscript calls `download(true, cb)` which reads the whole
   IndexedDB store via cursor and **rewrites `datetime` from a unix timestamp to
   the display string `DD.MM.YYYY HH:MM:SS`** before POSTing to `/upload-db`.
   → `YouTubeWatchTracker.json` on disk therefore holds *strings*, not numbers.
   → The in-browser DB still holds numbers. Do not confuse the two.

2. `/upload-db` refuses to save when the incoming array is **shorter** than the
   saved one (data-loss guard) and skips saving when lengths are **equal**
   (change detection). Equal-length-but-different-content changes are silently
   dropped — a known limitation, not a bug to "fix" casually.

3. The response `downloadedVideoCodes` is the `?v=` code of every URL in the
   app's in-memory `downloadedVideos` list. The userscript flips those records to
   `download: true` locally.

4. `downloadedVideos` is populated at startup **from the MP4 metadata scan**
   (`services/metadata.js` reads the `comment` tag embedded by ffmpeg), *not*
   from `downloaded_videos.json`. Deleting a video file makes the app forget it.

## Record shape

In IndexedDB (store `videos`, out-of-line keys — key is the 11-char video code):

```js
{ title: string, datetime: number /*unix s*/, like: boolean, dislike: boolean, download: boolean }
```

In `YouTubeWatchTracker.json`: same, plus `key: string`, and `datetime` is a string.

## Path resolution

`src/config.js` is the only place that decides where things live.

| | dev (`npm run dev`) | packaged portable exe |
|---|---|---|
| `BASE_DIR` | repo root | `PORTABLE_EXECUTABLE_DIR` (falls back to `dirname(process.execPath)`) |
| `BIN_DIR` | `<repo>/bin` | `BASE_DIR` — electron-builder `extraFiles` copies the exes flat next to the app |
| `RESOURCES_DIR` | `<repo>/resources` | `process.resourcesPath` — icons must live outside the asar |

`videos/`, `logs/`, `downloaded_videos.json` and `YouTubeWatchTracker.json` all sit
under `BASE_DIR`, i.e. next to the exe in production.

## Startup order (src/main.js `initializeApp`)

1. `ensureDirectories()` — must be first so `logs/` exists for `activityLog`
2. `createMainWindow()`
3. `createTray()`
4. `registerProtocolHandler()`
5. `startServer()` — bails out of init if it fails
6. `extractVideoUrlsFromMetadata()` → `initializeDownloadedVideos()`
7. `startUpdateScheduler()` — `ensureBinaries()` then a check every 24 h
8. `logger.updateDownloadVideos()`

Note step 5 opens the API **before** step 7 guarantees yt-dlp exists.
