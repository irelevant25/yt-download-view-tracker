---
name: release
description: Cut, publish and verify a GitHub release of YouTube Checker. Use when the user says "release", "new version", "cut v2.x", "tag a release", "publish a build", or asks why a release did not appear / why the Build and Release workflow failed.
---

# Release

The release is built by `.github/workflows/release.yml` on any pushed `v*` tag,
on a `windows-latest` runner, and published by `softprops/action-gh-release@v2`
using the built-in `GITHUB_TOKEN`. No extra secrets exist or are needed.

Repo: `irelevant25/yt-download-view-tracker`. There is no `gh` CLI on this
machine — query the GitHub REST API directly with `node -e` + `https` when you
need run status (anonymous reads work; log downloads return 403).

## Versioning

`package.json` → `version` is the **single source of truth**. Everything else
derives from it:

| Derived | How |
|---|---|
| Windows file properties of both exes | electron-builder reads `version` |
| the version shown in the app header | `main.js` answers `get-app-version` with `app.getVersion()`; `renderer.js` → `showVersion()` asks over IPC |
| the git tag | you create it — the workflow enforces that it matches |

**Local build output carries no version; the published asset does.**
`build.artifactName` is `YouTube-Checker.${ext}`, deliberately — do not add
`${version}` back to it. The *Name the release asset with the version* workflow
step renames the file to `YouTube-Checker-<version>.exe` just before upload.

So bumping is one command. It writes `package.json`, commits, and tags:

```bash
npm version patch      # or minor / major / an explicit 2.0.2
git push && git push --tags
```

Do **not** hardcode a version in `index.html` again — that span is filled at
runtime and was a source of drift (`v2.0.1` was tagged while `package.json` still
said `2.0.0`, so the build produced an exe labelled 2.0.0).

The *Check tag matches package.json version* step fails the run on a mismatch
rather than publishing a wrongly-named artifact.

**Pushing a tag is an outward-facing action — confirm with the user first.**
Re-running a failed tag means deleting it locally and on the remote
(`git tag -d vX.Y.Z && git push --delete origin vX.Y.Z`) before re-tagging, which
also deletes nothing already published. Confirm that too.

## Checking a run

```bash
node -e "
const https=require('https');
const get=p=>new Promise(r=>{https.get('https://api.github.com'+p,{headers:{'User-Agent':'x'}},s=>{let d='';s.on('data',c=>d+=c);s.on('end',()=>r(JSON.parse(d)))})});
(async()=>{
  const runs=await get('/repos/irelevant25/yt-download-view-tracker/actions/runs');
  runs.workflow_runs.slice(0,5).forEach(r=>console.log(r.head_branch,r.status,r.conclusion,r.html_url));
  const rel=await get('/repos/irelevant25/yt-download-view-tracker/releases');
  rel.forEach(r=>console.log('RELEASE',r.tag_name,r.assets.map(a=>a.name)));
})();"
```

A healthy run takes **~3–4 minutes**. Anything under a minute died before
electron-builder started.

## Known failure modes

**Run fails in ~45 s → almost certainly `Download required binaries`.**
`scripts/install-binaries.js` hits `api.github.com` unauthenticated. Actions
runners share an IP pool against the 60 req/h anonymous limit, so this fails
intermittently. `fetchJson` rejects on the rate-limit body, `main()` exits 1.

Fixed by `ghHeaders(url)` in `scripts/install-binaries.js`, plus
`GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` on that workflow step. Two rules that
must not be relaxed if you touch it:

- **The token goes to `api.github.com` and nowhere else.** `browser_download_url`
  redirects to `github.com` and then to a pre-signed
  `objects.githubusercontent.com`/S3 URL. Sending a bearer there leaks it to a
  third-party host, and S3 rejects a request that carries both a pre-signed query
  and an `Authorization` header (*"only one auth mechanism allowed"*) — so it
  breaks the download as well as leaking. Only `fetchJson` actually needs auth.
- **Re-derive headers on every redirect hop**, never reuse the first hop's map.
  `ghHeaders` takes the URL for exactly this reason.
- Keep the token optional so local `npm run setup` still works without one.

The same unscoped-redirect pattern exists in `src/services/updater.js`, which
sends no token today. If you ever add one there, apply the same host check.

**`fail_on_unmatched_files: true` with nothing matching `dist/YouTube-Checker-*.exe`**
— either the rename step did not run, or electron-builder produced a different
target. Check `package.json` → `build.win.target` is still `portable` and that
`build.artifactName` still yields `YouTube-Checker.exe`.

**`npm ci` fails** — `package-lock.json` is out of sync with `package.json`.
Note the lock records `engines.node: 22.5.1` while `package.json` says `22.15.0`;
harmless today (no `engine-strict`), but re-run `npm install` and commit the lock
if you touch dependencies.

## What `npm run build` produces

```
dist/
  YouTube-Checker.exe             ← the distributable. This is what ships.
  win-unpacked/
    YouTube Checker.exe           ← intermediate; the app binary the portable wrapper embeds
    ffmpeg.exe ffprobe.exe yt-dlp.exe   ← extraFiles, copied flat
```

Neither *local* filename carries a version, by design: the build output keeps a
stable path so scripts and docs never go stale, and the unpacked exe is named
after `productName` because that is the name users see in Task Manager and on the
Start Menu shortcut (electron-builder offers no template for it anyway).

The **published** asset is different — the workflow renames the distributable to
`YouTube-Checker-<version>.exe` before attaching it, so people can tell releases
apart after downloading. Avoid spaces in that name: GitHub rewrites them on
upload, which is why the v2.0.0 asset landed as `YouTube-Checker-2.0.0.exe`
despite being built as `YouTube Checker 2.0.0.exe`.

The version is in the Windows file properties of both, and it is the same value:

```powershell
(Get-Item "dist\YouTube-Checker.exe").VersionInfo.FileVersion
(Get-Item "dist\win-unpacked\YouTube Checker.exe").VersionInfo.FileVersion
```

The upload glob is `dist/YouTube-Checker-*.exe`, which matches only the renamed
file — keep it in step with the rename if you change either.

Never upload the unpacked exe anywhere — on its own it cannot run, since it
depends on the DLLs and `resources/` beside it.

## Manual fallback

`npm run build` locally, rename `dist/YouTube-Checker.exe` to
`YouTube-Checker-<version>.exe` (the workflow step does this for you on CI), then
upload it to a release created by hand in the GitHub UI.
