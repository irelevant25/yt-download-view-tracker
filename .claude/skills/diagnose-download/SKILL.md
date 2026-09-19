---
name: diagnose-download
description: Trace why a YouTube video failed to download, was skipped, or never appeared in videos/. Use when the user says a download failed, nothing downloaded, the video is missing, yt-dlp errored, "it says already downloaded but it isn't", or the userscript shows an error notification.
---

# Diagnose a failed download

Work outward from the logs. Do not change code until you know which of the four
stages broke.

## Stage 0 — where are the logs?

`BASE_DIR` differs by build (see `.claude/knowledge/architecture.md`):
- dev: repo root
- portable exe: the folder containing the exe

So `logs/`, `videos/` and the JSON files are **next to the exe**, not in the repo,
when the user is running a release build. Ask which one they are on.

## Stage 1 — did the request reach the app?

```bash
tail -n 50 logs/activity.log
```

| What you see | Meaning |
|---|---|
| no line at all | the userscript never sent it — go to stage 1b |
| `DUPLICATE` | `routes.js` rejected it; the URL is already in the in-memory list or in flight |
| `STARTED` then nothing | yt-dlp is still running, or the process died without an exit code |
| `STARTED` then `ERROR` | yt-dlp ran and failed — go to stage 2 |
| `STARTED` then `SUCCESS` | the download worked; go to stage 3 |

**1b — the userscript side.** Open the YouTube tab's console and look for
`[YT-Tracker]` lines. `sendDownloadRequest` silently returns when the video is
not in IndexedDB, is not liked, or is already `download: true`. It only reaches
the network when all three pass. `GET /` is used as the liveness probe; if the
app is not running the user gets the "API is not running" modal instead.

A `DUPLICATE` that the user disputes is usually known-issue #10: the app's list
comes from scanning MP4 metadata in `videos/`, so a file that was moved or renamed
is "forgotten", while `downloaded_videos.json` is never read back.

## Stage 2 — what did yt-dlp say?

```bash
tail -n 80 "logs/<videoId>.log"
```

The whole verbose yt-dlp run is there. Common causes, in order of frequency:

1. **Format unavailable** — the hardcoded
   `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]` in `downloader.js:21`
   has no match. Live streams, premieres and some music videos hit this.
2. **Sign-in / age gate / bot check** — yt-dlp needs cookies. Not supported by the
   app today.
3. **yt-dlp out of date** — YouTube changed its player. Check `activity.log` for
   `UPDATE_FAIL` / the last `UP_TO_DATE`. The updater runs at startup and every 24 h.
4. **`ffmpeg` not found** — `--ffmpeg-location` points at `CONFIG.FFMPEG_PATH`.
   Confirm the exe exists at `BIN_DIR`. `ensureBinaries()` should have fetched it;
   look for `INSTALL_FAIL`.
5. **Nothing in the log at all** — the command never launched. Almost always
   known-issue #6: a space in the install path. `--output` and `--ffmpeg-location`
   values are not quoted, so `C:\Users\John Smith\...` splits into two arguments.
   Reproduce by checking whether `BASE_DIR` contains a space.

The exact command is echoed to the app window and console by
`logger.success('Executing download command: ...')` — get it from the user if the
per-video log is empty.

## Stage 3 — it downloaded but the app or userscript disagrees

The post-download `--exec` step re-muxes the file with ffmpeg to embed the source
URL in the `comment` tag, then `move /Y`s it into place. If that step fails the
MP4 exists but has no metadata, so:

- `metadata.extractVideoUrlsFromMetadata()` will not find it on next startup,
- it never appears in `downloadedVideoCodes`,
- the userscript keeps it at `download: false` and re-requests it forever.

Check with `ffprobe`:

```bash
"bin/ffprobe.exe" -v quiet -show_entries format_tags=comment -of default=nw=1 "videos/<title>.mp4"
```

Empty output confirms it. A title containing shell metacharacters (`&`, `"`, `%`)
is the usual reason — same root cause as known-issue #1/#6.

## Stage 4 — reproduce in isolation

Run yt-dlp by hand with the same arguments before touching any code:

```bash
"bin/yt-dlp.exe" "https://www.youtube.com/watch?v=<id>" \
  --ffmpeg-location "bin/ffmpeg.exe" \
  --format "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" \
  --output "videos/%(title)s.%(ext)s" \
  --merge-output-format mp4 --verbose
```

If that works and the app does not, the bug is in how `downloader.js` builds the
command line — not in yt-dlp.

## Before you "fix" it

Read `.claude/knowledge/known-issues.md` first. Items #1, #3, #6, #10 and #14
each explain a whole class of download failures and are still open.
