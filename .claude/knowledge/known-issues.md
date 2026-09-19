# Known issues

Audited 2026-09-19 against commit `5922963`. Strike an item through when you fix
it, and delete it once the fix has shipped in a release.

Severity: **S1** exploitable / data loss · **S2** breaks for real users · **S3** latent or cosmetic

---

## S1 — Security

### 1. Remote command injection via `POST /download`

`src/services/downloader.js:47` builds a shell string and runs it through `exec()`:

```js
const command = `"${ytDlpPath}" ${args.join(' ')} --verbose >> "${logFilePath}" 2>&1`;
```

`videoUrl` comes straight from the request body (`src/api/routes.js:31`) and is
interpolated unescaped, both as the yt-dlp positional argument and inside the
`--exec` value at `downloader.js:29`. Combined with issue #2 this means **any web
page the user visits can run arbitrary commands** with the user's privileges:

```js
fetch('http://localhost:5000/download', {method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({url: 'https://youtube.com/watch?v=x" & calc.exe & rem '})})
```

Fix: `execFile(ytDlpPath, argvArray)` with the log file as a piped stream rather
than a shell redirect, plus a strict allowlist regex on `url` in the route.

### 2. The local API trusts every origin

`src/api/server.js:26` reflects the request's `Origin` header back as
`Access-Control-Allow-Origin` and sets `Allow-Credentials: true`. There is no
token, no origin allowlist and no `Host`-header check. Every endpoint is callable
cross-origin by any site.

Fix: allowlist the YouTube origins (the userscript uses `GM_xmlhttpRequest`, which
is not subject to CORS at all, so tightening this does not break it), bind the
listener to `127.0.0.1`, and require a shared secret generated on first run.

### 3. Path traversal into the log filename

`src/services/downloader.js:43`: `const videoId = videoUrl.split('=').pop()` —
attacker-controlled, then used directly in `path.join(LOGS_DIRECTORY, ...)`.
A url ending in `=../../../foo` writes outside `logs/`.

### 4. Binaries are downloaded and executed without verification

`src/services/updater.js:47` follows redirects with **no redirect limit** and no
checksum or signature check, then executes the result. `tryDownload` recurses on
any `Location` header, so the chain is unbounded.

`scripts/install-binaries.js` was fixed: redirects are capped at 5, and the
`GITHUB_TOKEN` it now sends is scoped to `api.github.com` only, so it is never
forwarded to the CDN host an asset download redirects to. `updater.js` still
needs the redirect cap; it sends no token, so it has nothing to leak.
Neither verifies a checksum — that is still open for both.

### 5. Insecure renderer

`src/ui/window.js:23-26` uses `nodeIntegration: true` + `contextIsolation: false`,
and `index.html` has no CSP. Today `renderer.js` only uses `textContent`, so there
is no live XSS, but the blast radius of any future `innerHTML` is full RCE.
Prefer a `preload` script + `contextBridge`.

---

## S2 — Breaks for real users

### 6. Any install path containing a space breaks downloads

`downloader.js:33-41` joins every option with `' '` and never quotes values.
`--output C:\Users\John Smith\videos\%(title)s.%(ext)s` is parsed by the shell as
two arguments. Same for `--ffmpeg-location`. The `--exec` value at line 29 also
wraps the ffmpeg path *inside* the outer quotes instead of quoting it separately.
Fixing #1 with `execFile` fixes this too.

### 7. ~~Fresh IndexedDB installs cannot write anything~~ — FIXED

`tamper-monkey-script.js:52` creates the store with `keyPath: "videoCode"`, but
every write passes an explicit out-of-line key
(`tamper-monkey-script.js:80`, `:778`). `IDBObjectStore.put(value, key)` throws
`DataError` on a keyPath store. Existing users are unaffected — their store was
created *without* a keyPath by an older version and still works (confirmed: no
record in `YouTubeWatchTracker.json` has a `videoCode` field). **New installs are
broken.**

**Fixed** in `tamper-monkey-script.js:59` — the store is now created with no
keyPath, matching the out-of-line keys every call site passes.

### 8. ~~Toggling like/dislike wipes the first-watch date and the download flag~~ — FIXED

`tamper-monkey-script.js:516-521` replaces the whole record when `like` or
`dislike` changed, resetting `datetime` to now and `download` to `false`.
Un-liking then re-liking an already-downloaded video loses its original watch
date and triggers a re-download.

**Fixed** at `tamper-monkey-script.js:794-797` — `datetime` and `download` are
carried over from the stored record.

### 9. `download()` → `upload()` round-trip corrupts the database

`download(true, …)` stringifies `datetime`, and `upload()` writes records back
verbatim. After a backup/restore cycle every `datetime` is a string, so
`new Date(item.datetime * 1000)` yields `Invalid Date` everywhere in the UI.
`upload()` should parse `DD.MM.YYYY HH:MM:SS` back to a unix timestamp.

### 10. `downloaded_videos.json` is write-only

`storage.readDownloadedVideos()` / `saveDownloadedVideos()` /
`readDownloadedVideosSync()` are never called from outside `storage.js`.
`routes.downloadedVideos` is seeded purely from the MP4 metadata scan
(`src/main.js`), so moving or deleting a downloaded file makes the app re-download
it and de-syncs the userscript. Either merge the file into the startup list or
delete the dead functions and the file.

### 11. ~~Trusted Types policy never activates~~ — FIXED

`tamper-monkey-script.js:23` checks `window.TrustedTypes`; the actual global is
`window.trustedTypes` (lowercase). The policy is never created, so the branch at
`:149` always falls through to raw `innerHTML`. Harmless today (no caller passes
`innerHTML`), but the script's own `@description` claimed otherwise.

**Fixed** at `tamper-monkey-script.js:25` — correct lowercase global, and policy
creation is wrapped in try/catch.

### 12. Startup race on `logger.updateDownloadVideos`

`src/utils/logger.js:93-97` dereferences `mainWindow` without a null check, but
`mainWindow` is only set once the renderer sends `ui-initialized`. `main.js` calls
it during `initializeApp`. With a non-empty `videos/` folder and a slow renderer
this throws, and the whole init `try` block aborts silently into the catch.

### 13. `mainWindow` referenced before declaration

`src/main.js:73-76` registers the `ui-initialized` handler in a closure over
`const mainWindow`, which is declared ~10 lines later. It works only because the
IPC message always arrives after that line executes. Move the registration below
the declaration.

---

## S3 — Latent / cleanup

14. `downloader.js:53` `reject(false)` rejects with a non-Error. `initiateDownload`'s
    `else` branch (`downloader.js:87`) is therefore unreachable; every failure is
    logged as `Exception during download: false`.
15. `services/metadata.js:30` does a dynamic `import('music-metadata')` inside the
    per-file loop. Hoist it above the loop.
16. `api/server.js:65` `stopServer()` is never called — the port stays held during
    a slow quit. Wire it to `before-quit`.
17. `updater.js` replaces `yt-dlp.exe` via `renameSync` with no retry; if a download
    is in flight the rename fails with `EBUSY` and the error is only logged.
18. `updater.js:95` and `install-binaries.js:119` interpolate paths into a
    PowerShell single-quoted string. A path containing an apostrophe breaks or
    injects. Low risk (tmpdir + bin dir) but trivially fixed by doubling it.
19. ~~Version drift across `package.json`, `index.html` and the git tag.~~
    **Fixed.** `package.json` is the single source of truth. The exe filename is
    version-free and stable (`YouTube-Checker.exe`), while the workflow renames the
    published asset to `YouTube-Checker-<version>.exe`. The version is in the
    Windows file properties, `showVersion()` fills the header span from
    `app.getVersion()` over IPC, and the workflow fails when the tag and
    `package.json` disagree.
    Bump with `npm version <patch|minor|major>`.
20. `package.json` → `build.win.icon` is `"256.ico"`, which does not exist anywhere
    in the repo. electron-builder silently falls back to `icon.ico` at the project
    root, so the exe does get the right icon — by accident. Point it at a real path
    (`icon.ico`, or `resources/icon256.ico` if you prefer that artwork) so the
    config stops lying. Confirm the icon afterwards; the two files differ.
21. `.vscode/launch.json` points at `${workspaceFolder}\main.js`, which does not
    exist (it is `src/main.js`), and is a plain node launch rather than Electron.
22. `.prettierrc` / `.prettierignore` are leftovers from an Angular project
    (`.angular/`, `projects/library-test/`) and specify `tabWidth: 2` for `.js`
    while the whole codebase uses 4.
23. `npm audit` reports 6 advisories (`path-to-regexp` high via express 4, plus
    `qs` and `file-type` via `music-metadata`). All DoS-class, all reachable only
    from the local API. `npm audit fix` clears them.
24. Dead exports: `downloader.getActiveDownloads`, `tray.getTray`.
25. `utils/notifications.js` imports `app` and `path`, uses neither.
26. `old - cmd ui/` and `old - electron simple/` are committed dead projects, and
    `README-old.md` is superseded. Consider deleting.

---

## Release pipeline

The workflow at `.github/workflows/release.yml` exists and works — `v1.0` and
`v2.0.0` both built and published. The `v2.0.1` run
([22587901371](https://github.com/irelevant25/yt-download-view-tracker/actions/runs/22587901371))
**failed after 45 s**, against 238 s for the successful `v2.0.0` run, so it died at
or before the *Download required binaries* step. Logs have expired.

Most likely cause: `scripts/install-binaries.js` calls `api.github.com`
**unauthenticated**, and Actions runners share an IP pool with a 60 req/h
anonymous limit. `fetchJson` turns the rate-limit JSON into a rejection, `main()`
exits 1, and the step fails — intermittently, which matches "worked in the
morning, failed in the evening on the same code".

Fix: pass `GITHUB_TOKEN` through as an `Authorization` header when present.
See the `/release` skill.
