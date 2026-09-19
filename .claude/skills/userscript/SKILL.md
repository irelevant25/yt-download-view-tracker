---
name: userscript
description: Edit tamper-monkey-script.js — the YouTube TamperMonkey userscript. Use when changing tracking behaviour, YouTube DOM selectors, the IndexedDB schema, the notification UI, or the client side of the localhost API contract.
---

# Editing the userscript

`tamper-monkey-script.js` is a single dependency-free IIFE installed by users from
the raw GitHub URL. **There is no update channel** — a user on an old version
stays on it until they reinstall. Every change must be backward compatible with
whatever is already in people's browsers.

## The three things that will bite you

### 1. The IndexedDB store uses out-of-line keys

Records in the wild look like this, keyed by the 11-char video code:

```js
{ title: string, datetime: number /* unix seconds */, like: bool, dislike: bool, download: bool }
```

`onupgradeneeded` at line 52 currently creates the store with
`keyPath: "videoCode"`, which contradicts every `put(value, key)` call in the file
and throws `DataError` on fresh installs (known-issue #7). Existing users are fine
because their store predates that line.

- Never bump `indexedDB.open(DB_NAME, 1)` to version 2 without a migration in
  `onupgradeneeded` that handles a store created *both* ways.
- A schema change strands every existing user's data. Prefer additive optional
  fields with a default read at the call site.

### 2. `datetime` has two representations

- In the browser DB: **unix seconds** (number).
- In `YouTubeWatchTracker.json` on disk: the string `DD.MM.YYYY HH:MM:SS`, because
  `uploadDBToApi()` calls `download(true, …)` which rewrites it.

`upload()` does not convert back, so a backup/restore cycle poisons the DB
(known-issue #9). If you touch either function, fix the pair together.

### 3. Network calls must go through `customFetch`

Plain `fetch('http://localhost:5000/…')` is blocked by YouTube's CSP and by mixed
content rules. `customFetch` wraps `GM_xmlhttpRequest`, which bypasses both — and
also bypasses CORS entirely, so tightening the server's CORS policy does **not**
break the script.

Any new host needs a `// @connect` line in the metadata block.

## The sync contract

Both halves must change together — server side lives in `src/api/routes.js`.

| Direction | Shape |
|---|---|
| `POST /upload-db` | `{ data: Video[] }` — the whole store, datetime stringified |
| response | `{ message, downloadedVideoCodes: string[] }` |
| `POST /download` | `{ url: "https://www.youtube.com/watch?v=<code>" }` |
| response | `{ message }` — shown verbatim in the notification toast |

Rules the client relies on:
- The app is the authority on `download`. The script sets `download: true` **only**
  from `downloadedVideoCodes`, never optimistically after a request.
- `/upload-db` silently skips saving when the array length is unchanged, and
  refuses when it shrank. Do not send partial arrays.

## DOM work

- Everything is polled on a 1 s `setInterval` (`monitorVideoPage`,
  `monitorSearchResults`, `monitorMainPage`) because YouTube is an SPA and does
  not emit navigation events the script can rely on. Keep new work inside the
  existing intervals rather than adding a fourth.
- Guard every `querySelector` with an early `return`. YouTube renames custom
  elements (`ytd-watch-metadata`, `like-button-view-model`, `ytd-rich-grid-media`)
  without notice, and the script must degrade to doing nothing rather than throw.
- Build nodes with the local `createElement(tag, options)` helper.
  Use `textContent`. The `innerHTML` branch is effectively dead — its Trusted
  Types guard checks `window.TrustedTypes`, but the real global is
  `window.trustedTypes` (known-issue #11).
- Injected elements carry the `yt-tracker-` prefix. Remove the previous one before
  appending on re-render; the intervals re-run on every DOM change.

## Checklist for any change

1. Bump `// @version` in the metadata block — TamperMonkey uses it for reinstalls.
2. Backward compatible with records written by older versions?
3. Does the server side in `src/api/routes.js` need the same change?
4. Update the endpoint table in `.claude/knowledge/architecture.md` if the contract moved.
5. Tell the user to reinstall the script from the raw URL — nothing is automatic.

## Testing

No test harness. Reload a YouTube tab with the script installed and watch the
console for `[YT-Tracker]` lines. `unsafeWindow.download()`, `.size()` and
`.upload()` are exposed as console helpers — `download()` with no arguments saves
the store to a JSON file, which is the safest way to snapshot before an experiment.
