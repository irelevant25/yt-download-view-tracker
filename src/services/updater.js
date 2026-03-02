/**
 * Binary manager and yt-dlp auto-updater service.
 *
 * On startup:
 *   1. ensureBinaries() — downloads yt-dlp.exe and ffmpeg suite if any are missing
 *   2. checkAndUpdate() — updates yt-dlp.exe if a newer version is available
 *   3. Repeats step 2 every 24 hours
 */
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const CONFIG = require('../config');
const logger = require('../utils/logger');

const YTDLP_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const FFMPEG_API = 'https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest';
const FFMPEG_ASSET = 'ffmpeg-master-latest-win64-gpl.zip';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Directory where binaries live (derived from the configured yt-dlp path)
const BIN_DIR = path.dirname(CONFIG.YTDLP_PATH);

// ─── Shared Helpers ────────────────────────────────────────────────────────

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
                } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

/**
 * Download a URL to destPath, following HTTP redirects.
 * Writes to destPath.tmp first and atomically renames on completion.
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const tryDownload = (downloadUrl) => {
            https.get(downloadUrl, { headers: { 'User-Agent': 'youtube-checker-app' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    tryDownload(res.headers.location);
                    return;
                }

                if (res.statusCode !== 200) {
                    reject(new Error(`Download failed with HTTP ${res.statusCode}`));
                    return;
                }

                const tmpPath = destPath + '.tmp';
                const file = fs.createWriteStream(tmpPath);
                res.pipe(file);

                file.on('finish', () => {
                    file.close(() => {
                        try {
                            fs.renameSync(tmpPath, destPath);
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    });
                });

                file.on('error', (err) => {
                    fs.unlink(tmpPath, () => {});
                    reject(err);
                });
            }).on('error', reject);
        };

        tryDownload(url);
    });
}

/**
 * Extract all .exe entries from a ZIP to destDir using a PowerShell .ps1 file.
 * Writing to a temp .ps1 avoids command-line escaping issues with long paths.
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

// ─── yt-dlp helpers ────────────────────────────────────────────────────────

function getCurrentVersion() {
    return new Promise((resolve) => {
        exec(`"${CONFIG.YTDLP_PATH}" --version`, (error, stdout) => {
            resolve(error ? null : stdout.trim());
        });
    });
}

// ─── Binary installers ─────────────────────────────────────────────────────

async function downloadYtDlp() {
    logger.info('Downloading yt-dlp.exe...');
    logger.activityLog('INSTALLING', 'yt-dlp.exe');

    const release = await fetchJson(YTDLP_API);
    const asset = release.assets?.find(a => a.name === 'yt-dlp.exe');
    if (!asset) throw new Error('yt-dlp.exe not found in release assets');

    await downloadFile(asset.browser_download_url, CONFIG.YTDLP_PATH);

    logger.success(`yt-dlp.exe v${release.tag_name} installed.`);
    logger.activityLog('INSTALLED', `yt-dlp.exe v${release.tag_name}`);
}

async function downloadFfmpeg() {
    logger.info('Downloading ffmpeg suite (~170 MB)...');
    logger.activityLog('INSTALLING', 'ffmpeg suite');

    const release = await fetchJson(FFMPEG_API);
    const asset = release.assets?.find(a => a.name === FFMPEG_ASSET);
    if (!asset) throw new Error(`"${FFMPEG_ASSET}" not found in yt-dlp/FFmpeg-Builds releases`);

    const zipPath = path.join(os.tmpdir(), 'ffmpeg-builds.zip');
    await downloadFile(asset.browser_download_url, zipPath);

    logger.info('Extracting ffmpeg.exe, ffprobe.exe, ffplay.exe...');
    await extractExesFromZip(zipPath, BIN_DIR);

    try { fs.unlinkSync(zipPath); } catch {}

    logger.success('ffmpeg suite installed.');
    logger.activityLog('INSTALLED', 'ffmpeg suite');
}

/**
 * Check that all required binaries exist; download any that are missing.
 * Called once at startup before the update check cycle begins.
 */
async function ensureBinaries() {
    const missing = [];
    if (!fs.existsSync(CONFIG.YTDLP_PATH)) missing.push('yt-dlp.exe');
    if (!fs.existsSync(CONFIG.FFMPEG_PATH)) missing.push('ffmpeg.exe');

    if (missing.length === 0) {
        logger.info('All required binaries are present.');
        return;
    }

    logger.info(`Missing binaries: ${missing.join(', ')}. Downloading now...`);
    logger.activityLog('MISSING_BINS', missing.join(', '));

    if (!fs.existsSync(CONFIG.YTDLP_PATH)) {
        try {
            await downloadYtDlp();
        } catch (e) {
            logger.error(`Failed to install yt-dlp.exe: ${e.message}`);
            logger.activityLog('INSTALL_FAIL', `yt-dlp.exe: ${e.message}`);
        }
    }

    if (!fs.existsSync(CONFIG.FFMPEG_PATH)) {
        try {
            await downloadFfmpeg();
        } catch (e) {
            logger.error(`Failed to install ffmpeg: ${e.message}`);
            logger.activityLog('INSTALL_FAIL', `ffmpeg: ${e.message}`);
        }
    }
}

// ─── yt-dlp update cycle ───────────────────────────────────────────────────

async function checkAndUpdate() {
    logger.info('Checking for yt-dlp updates...');

    try {
        const currentVersion = await getCurrentVersion();
        const label = currentVersion ? `v${currentVersion}` : 'unknown';
        logger.info(`yt-dlp current version: ${label}`);
        logger.activityLog('UPDATE_CHECK', `yt-dlp current=${label}`);

        const release = await fetchJson(YTDLP_API);
        const latestVersion = release.tag_name;
        logger.info(`yt-dlp latest version: v${latestVersion}`);

        if (currentVersion && currentVersion === latestVersion) {
            logger.info('yt-dlp is up to date.');
            logger.activityLog('UP_TO_DATE', `yt-dlp v${latestVersion}`);
            return;
        }

        logger.info(`yt-dlp update available: ${label} → v${latestVersion}`);
        logger.activityLog('UPDATING', `yt-dlp ${label} -> v${latestVersion}`);

        const asset = release.assets?.find(a => a.name === 'yt-dlp.exe');
        if (!asset) {
            const msg = 'yt-dlp.exe not found in latest release assets';
            logger.error(msg);
            logger.activityLog('UPDATE_FAIL', `yt-dlp ${msg}`);
            return;
        }

        logger.info(`Downloading yt-dlp.exe v${latestVersion}...`);
        await downloadFile(asset.browser_download_url, CONFIG.YTDLP_PATH);

        const newVersion = await getCurrentVersion();
        logger.success(`yt-dlp updated to v${newVersion}`);
        logger.activityLog('UPDATED', `yt-dlp ${label} -> v${newVersion}`);
    } catch (error) {
        logger.error(`yt-dlp update check failed: ${error.message}`);
        logger.activityLog('UPDATE_FAIL', `yt-dlp ${error.message}`);
    }
}

/**
 * Start the binary manager and update scheduler.
 *   1. Ensure all required binaries exist (download if missing).
 *   2. Run an immediate yt-dlp update check.
 *   3. Repeat the update check every 24 hours.
 */
async function startUpdateScheduler() {
    await ensureBinaries();
    checkAndUpdate();
    setInterval(checkAndUpdate, CHECK_INTERVAL_MS);
}

module.exports = { startUpdateScheduler };
