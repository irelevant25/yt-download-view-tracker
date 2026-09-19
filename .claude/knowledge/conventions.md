# Conventions

## Style

- **4 spaces**, single quotes, semicolons. CommonJS (`require` / `module.exports`).
- Ignore `.prettierrc` — it is an Angular leftover that says `tabWidth: 2` for `.js`.
  Match the surrounding file.
- Every exported function gets a JSDoc block with `@param` / `@returns`.
- Every file opens with a short block comment naming the module and its job.

## Module layout

```
src/
  config.js        single source of truth for every path and constant
  main.js          lifecycle only — no business logic
  api/             express server + routes; routes hold the in-memory download list
  services/        one concern per file, no Electron UI imports
  ui/              BrowserWindow + Tray, no business logic
  utils/           logger + notifications, imported by everything
```

Rules:
- `services/` must not import from `ui/`. Go through `utils/logger` or a callback.
- New constants go in `CONFIG`, never `path.join(__dirname, …)` inside `src/`.
- `utils/logger` is safe to require from anywhere, including before `app.whenReady`.

## Logging

Two independent sinks, both in `utils/logger.js`:

| Call | Goes to | Use for |
|---|---|---|
| `logger.info/success/error(msg)` | console + renderer log pane (queued until the UI is up) | anything the user might want to watch live |
| `logger.activityLog(STATUS, label)` | `logs/activity.log`, append-only | durable, greppable events |

`activityLog` statuses are a closed set — see the table in README.md. Adding one
means adding it there too. `STATUS` is padded to 13 chars; keep new ones shorter.

Per-video yt-dlp output goes to `logs/<videoId>.log`.

## Error handling

- Services return `false` / `[]` on failure and log; they do not throw at callers.
- `main.js` wraps init in one try/catch — a throw anywhere in `initializeApp`
  silently aborts the rest of startup, so prefer explicit checks over throws there.
- Reject with `Error` objects, never bare values (see known-issues #14).

## Subprocess calls

`execFile` / `spawn` with an argv array. Never `exec` with an interpolated string.
The one remaining `exec` call in `downloader.js` is a known defect, not a pattern
to copy.

## Adding an API endpoint

1. Add the handler to `src/api/routes.js` on the shared `router`.
2. Validate the body — assume a hostile caller (the API is open to every origin).
3. Log one `logger.info` on entry and one `logger.activityLog` for anything durable.
4. Return JSON with a `message` key on success and an `error` key on failure —
   the userscript surfaces `result.message` directly in its notification UI.
5. Mirror the change in `tamper-monkey-script.js` and bump its `@version`.
6. Update the endpoint table in `.claude/knowledge/architecture.md` and README.md.

## Userscript

- No build step, no dependencies. One IIFE, `'use strict'`.
- All network calls go through `customFetch` (wraps `GM_xmlhttpRequest`) — plain
  `fetch` to localhost is blocked by the page's CSP.
- Adding a host means adding a `@connect` line.
- DOM built with the local `createElement(tag, options)` helper, `textContent` only.
- YouTube selectors (`ytd-watch-metadata`, `ytd-rich-grid-media`, …) break often;
  every query is guarded with an early return rather than an assertion.
