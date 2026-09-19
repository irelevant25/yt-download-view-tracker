# CLAUDE.md — YouTube Checker

Windows-only Electron tray app + Express API (port 5000) + TamperMonkey userscript.
Liking a video on YouTube → userscript POSTs to the local API → yt-dlp downloads it.

**Read [README.md](README.md) for user-facing setup, build and release docs.**
This file covers only what the README does not: invariants, landmines and conventions.

## Knowledge base

| File | Contents |
|---|---|
| [.claude/knowledge/architecture.md](.claude/knowledge/architecture.md) | Data flow, the sync contract, path resolution rules |
| [.claude/knowledge/known-issues.md](.claude/knowledge/known-issues.md) | Audited defects, ranked. Check before "fixing" something |
| [.claude/knowledge/conventions.md](.claude/knowledge/conventions.md) | Code style, logging, module layout |

## Skills

- `/release` — cut and verify a GitHub release (version sync is *manual*; see skill)
- `/diagnose-download` — a download failed; trace it through the logs
- `/userscript` — edit `tamper-monkey-script.js` without corrupting users' IndexedDB

## Hard rules

1. **Never build a shell command by string concatenation with a URL, filename or
   video title.** `src/services/downloader.js` currently does this and it is the
   app's most serious defect (see known-issues #1). Any new subprocess call must use
   `execFile`/`spawn` with an argv array.

2. **Every path in the app comes from `src/config.js`.** Never call
   `path.join(__dirname, ...)` inside `src/` — dev and packaged builds resolve
   differently (`BASE_DIR` vs `PORTABLE_EXECUTABLE_DIR`). Add a new constant to
   `CONFIG` instead.

3. **The API is unauthenticated and reachable from any web page.** CORS reflects
   whatever `Origin` it is given. Treat every field in a request body as hostile —
   validate `url` against `^https://(www\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}`
   before it reaches yt-dlp or the filesystem.

4. **Do not change the userscript's IndexedDB schema or the `/upload-db` response
   shape independently.** They are one contract. See architecture.md → Sync contract.

5. **The renderer runs with `nodeIntegration: true`, `contextIsolation: false`.**
   Anything reaching `logger.log()` reaches a Node-enabled renderer. Keep using
   `textContent` (never `innerHTML`) in `renderer/renderer.js`.

6. **`package.json` `version` is the single source of truth.** The header reads
   it over IPC and the workflow refuses a tag that disagrees. Never hardcode a
   version anywhere else.

7. **`build.portable.unpackDirName` must stay `true`.** The default extracts every
   launch of a build into the same `%TEMP%` folder, so a second launch — or the
   self-update handover — wipes the running instance's files. (`false` does *not*
   fix it; electron-builder treats it like the default.)

8. **Anything that must outlive this run uses `CONFIG.LAUNCHED_EXE`,** never
   `process.execPath`. A portable build runs from a temp copy deleted on exit.
   Protocol registration and the Start Menu shortcut are skipped in dev, where
   the exe is bare `electron.exe`.

9. **Tests must not touch real data.** Every test points `CONFIG` paths at a temp
   sandbox before requiring services. `npm test` runs all three suites.

## Quick facts

- Entry point `src/main.js`; `main` field in package.json points at it.
- App never quits on window close — tray only. `windowManager.setQuittingState(true)` first.
- `logger.init(mainWindow)` is wired to the renderer's `ui-initialized` IPC message.
  Anything logged before that is queued in `messageQueue`.
- Binaries (`yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe`) are never committed. They are
  fetched at startup by `src/services/updater.js` and pre-build by `scripts/install-binaries.js`.
- `.prettierrc` is a leftover from an Angular project and contradicts the actual
  4-space style in `src/`. Match surrounding code, not the config.
