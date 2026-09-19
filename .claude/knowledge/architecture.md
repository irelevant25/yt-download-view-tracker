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
| POST | `/download` | `{url}` | `{message}` — validated, then enqueued |
| GET | `/queue` | — | queue contents with live progress per item |
| POST | `/upload-db` | `{data: Video[]}` | `{message, downloadedVideoCodes: string[]}` |

`/download` rejects anything that is not an `https` YouTube `/watch` URL with a
valid 11-character id, and rebuilds the URL from the parsed parts. The server
binds to `127.0.0.1` and allowlists origins.

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

4. `downloadedVideos` comes from `services/library.js`, which merges the
   `videos/` scan with `downloaded_videos.json` and persists the union. Ids are
   read from the filename (`Title [videoId].mp4`); files written before that
   template are identified from their embedded `comment` tag instead, and
   `library.repair()` can rename them.

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

## Services

| Module | Owns |
|---|---|
| `services/downloader.js` | One yt-dlp process. spawn + argv, never a shell. Emits `progress`. |
| `services/queue.js` | Which downloads run, retries, and the on-disk queue file |
| `services/library.js` | What is actually downloaded; scan, inspect, repair |
| `services/tracker.js` | Reading and querying the ~14k-record watch history |
| `services/stats.js` | Directory sizes and free space on the videos drive |
| `services/updater.js` | Fetching and updating yt-dlp/ffmpeg |
| `ui/ipc.js` | Every channel the window can call, in one auditable place |

## Window

Four panels (`index.html` + `renderer/renderer.js`), switched by the tab bar:

- **Logs** — the original log stream, now capped at 2000 rows
- **Queue** — one row per item with a live progress bar, retry and remove
- **Library** — the watch history, searchable and filterable, paged at 200 rows
  because putting 14,000 rows in the DOM is not viable
- **Storage** — claimed space, free space, a drive meter, and library repair

The renderer builds nodes with a small `el()` helper and `textContent` only.
`index.html` carries a CSP; the renderer still has Node integration, so that
matters.
