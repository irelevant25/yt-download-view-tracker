/**
 * Binary installer for yt-dlp and ffmpeg.
 * Downloads missing executables to the bin/ directory.
 * Safe to run multiple times — skips files that are already present.
 *
 * Sources:
 *   yt-dlp  : https://github.com/yt-dlp/yt-dlp/releases/latest   (single exe)
 *   ffmpeg  : https://github.com/yt-dlp/FFmpeg-Builds/releases/latest  (zip)
 *
 * Usage:
 *   node scripts/install-binaries.js
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'bin');

const YTDLP_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const FFMPEG_API = 'https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest';
const FFMPEG_ASSET = 'ffmpeg-master-latest-win64-gpl.zip';

// ─── Helpers ───────────────────────────────────────────────────────────────

function log(msg) {
    console.log(`[install-binaries] ${msg}`);
}

/**
 * Fetch a URL as parsed JSON, following up to one redirect.
 */
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'youtube-checker-app' } }, (res) => {
            let data = '';
            res.on('data', chunk => (data += chunk));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.message) reject(new Error(`GitHub API: ${parsed.message}`));
                    else resolve(parsed);
                } catch (e) {
                    reject(new Error(`Failed to parse JSON: ${e.message}`));
                }
            });
        }).on('error', reject);
    });
}

/**
 * Download a URL to destPath, following HTTP redirects.
 * Writes to destPath.tmp first and atomically renames on completion.
 */
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const tryDownload = (dlUrl) => {
            https.get(dlUrl, { headers: { 'User-Agent': 'youtube-checker-app' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    tryDownload(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} downloading ${dlUrl}`));
                    return;
                }

                const total = parseInt(res.headers['content-length'] || '0', 10);
                let received = 0;
                let lastPct = -1;

                const tmp = destPath + '.tmp';
                const file = fs.createWriteStream(tmp);

                res.on('data', chunk => {
                    received += chunk.length;
                    if (total && onProgress) {
                        const pct = Math.floor((received / total) * 100);
                        if (pct !== lastPct && pct % 10 === 0) {
                            onProgress(pct);
                            lastPct = pct;
                        }
                    }
                });

                res.pipe(file);

                file.on('finish', () => {
                    file.close(() => {
                        try {
                            fs.renameSync(tmp, destPath);
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    });
                });

                file.on('error', (err) => {
                    fs.unlink(tmp, () => {});
                    reject(err);
                });
            }).on('error', reject);
        };

        tryDownload(url);
    });
}

/**
 * Extract all .exe entries from a ZIP archive to destDir using PowerShell.
 * Writes a temporary .ps1 file to avoid command-line escaping issues.
 */
function extractExesFromZip(zipPath, destDir) {
    return new Promise((resolve, reject) => {
        const script = [
            `Add-Type -Assembly System.IO.Compression.FileSystem`,
            `$zip = [IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/\\/g, '/')}')`,
            `$zip.Entries | Where-Object { $_.Name -like '*.exe' } | ForEach-Object {`,
            `  $dest = Join-Path '${destDir.replace(/\\/g, '/')}' $_.Name`,
            `  [IO.Compression.ZipFileExtensions]::ExtractToFile($_, $dest, $true)`,
            `}`,
            `$zip.Dispose()`
        ].join('\n');

        const ps1 = path.join(os.tmpdir(), 'yt-checker-extract.ps1');
        fs.writeFileSync(ps1, script, 'utf-8');

        exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, (err, _out, stderr) => {
            try { fs.unlinkSync(ps1); } catch {}
            if (err) reject(new Error(`ZIP extraction failed: ${stderr || err.message}`));
            else resolve();
        });
    });
}

// ─── Installers ────────────────────────────────────────────────────────────

async function installYtDlp() {
    const dest = path.join(BIN_DIR, 'yt-dlp.exe');
    if (fs.existsSync(dest)) {
        log('yt-dlp.exe already present — skipping.');
        return;
    }

    log('Fetching latest yt-dlp release info...');
    const release = await fetchJson(YTDLP_API);
    const asset = release.assets?.find(a => a.name === 'yt-dlp.exe');
    if (!asset) throw new Error('yt-dlp.exe not found in release assets');

    log(`Downloading yt-dlp.exe v${release.tag_name}...`);
    await downloadFile(asset.browser_download_url, dest, pct => log(`  yt-dlp: ${pct}%`));
    log(`yt-dlp.exe v${release.tag_name} installed.`);
}

async function installFfmpeg() {
    const ffmpegDest = path.join(BIN_DIR, 'ffmpeg.exe');
    if (fs.existsSync(ffmpegDest)) {
        log('ffmpeg.exe already present — skipping.');
        return;
    }

    log('Fetching latest FFmpeg release info...');
    const release = await fetchJson(FFMPEG_API);
    const asset = release.assets?.find(a => a.name === FFMPEG_ASSET);
    if (!asset) throw new Error(`Asset "${FFMPEG_ASSET}" not found in yt-dlp/FFmpeg-Builds releases`);

    const zipPath = path.join(os.tmpdir(), 'ffmpeg-builds.zip');
    log(`Downloading ffmpeg ${release.tag_name} (~170 MB)...`);
    await downloadFile(asset.browser_download_url, zipPath, pct => log(`  ffmpeg: ${pct}%`));

    log('Extracting ffmpeg.exe, ffprobe.exe, ffplay.exe...');
    await extractExesFromZip(zipPath, BIN_DIR);

    try { fs.unlinkSync(zipPath); } catch {}
    log('ffmpeg suite installed.');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
    fs.mkdirSync(BIN_DIR, { recursive: true });

    let allOk = true;

    try {
        await installYtDlp();
    } catch (e) {
        console.error(`[install-binaries] ERROR (yt-dlp): ${e.message}`);
        allOk = false;
    }

    try {
        await installFfmpeg();
    } catch (e) {
        console.error(`[install-binaries] ERROR (ffmpeg): ${e.message}`);
        allOk = false;
    }

    log(allOk ? 'All binaries ready.' : 'Finished with errors — some binaries may be missing.');
    return allOk;
}

if (require.main === module) {
    main().then(ok => process.exit(ok ? 0 : 1));
}

module.exports = { main };
