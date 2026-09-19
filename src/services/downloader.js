/**
 * Downloader service for app
 * Runs yt-dlp and reports progress.
 *
 * yt-dlp is launched with spawn() and an argv array — never through a shell.
 * The URL, the video title and the install path all end up on this command
 * line, and any of them can contain characters a shell would interpret.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const CONFIG = require('../config');
const logger = require('../utils/logger');

/** A YouTube video id is always 11 chars of [A-Za-z0-9_-]. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Emits 'progress' ({ videoId, url, percent, speed, eta }) and 'state' (). */
const events = new EventEmitter();

// videoId -> { url, videoId, percent, speed, eta, startedAt }
const activeDownloads = new Map();

/**
 * Pull the video id out of a watch URL.
 * @param {string} videoUrl
 * @returns {string|null} The 11-char id, or null if the URL has no valid one
 */
function extractVideoId(videoUrl) {
    let parsed;
    try {
        parsed = new URL(videoUrl);
    } catch {
        return null;
    }

    const id = parsed.searchParams.get('v');
    return id && VIDEO_ID_PATTERN.test(id) ? id : null;
}

/**
 * Build the yt-dlp argument vector.
 *
 * The output template carries the video id in the filename. That is what makes
 * the library self-describing: the app can tell what it has by reading the
 * directory, with no need to parse metadata out of every file.
 *
 * @param {string} videoUrl
 * @returns {string[]}
 */
function buildArgs(videoUrl) {
    return [
        videoUrl,
        '--ffmpeg-location', CONFIG.FFMPEG_PATH,
        '--format', CONFIG.DOWNLOAD_FORMAT,
        '--output', path.join(CONFIG.VIDEOS_DIRECTORY, CONFIG.OUTPUT_TEMPLATE),
        '--merge-output-format', CONFIG.MERGE_OUTPUT_FORMAT,
        '--write-sub',
        '--sub-lang', CONFIG.SUBTITLE_LANGUAGES,
        '--sub-format', 'srt',
        '--http-chunk-size', '10M',
        '--force-ipv4',
        '--no-update',
        // Record where the file came from, without the old shell --exec hack.
        '--embed-metadata',
        '--parse-metadata', 'webpage_url:%(meta_comment)s',
        // Machine-readable progress on its own lines, so it can be parsed live.
        '--newline',
        '--progress-template',
        `${CONFIG.PROGRESS_PREFIX}%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s`,
        '--verbose'
    ];
}

/**
 * Parse one yt-dlp progress line, if that is what it is.
 * @param {string} line
 * @returns {{percent: number, speed: string, eta: string}|null}
 */
function parseProgressLine(line) {
    if (!line.startsWith(CONFIG.PROGRESS_PREFIX)) return null;

    const [percentRaw, speed, eta] = line.slice(CONFIG.PROGRESS_PREFIX.length).split('|');
    const percent = parseFloat(String(percentRaw).replace('%', '').trim());

    return {
        percent: Number.isFinite(percent) ? percent : 0,
        speed: (speed || '').trim(),
        eta: (eta || '').trim()
    };
}

/**
 * Download a single video with yt-dlp.
 * @param {string} videoUrl - Already validated by the caller
 * @param {string} videoId  - Already validated by the caller
 * @returns {Promise<void>} Resolves on success, rejects with an Error otherwise
 */
function downloadVideo(videoUrl, videoId) {
    const logFilePath = path.join(CONFIG.LOGS_DIRECTORY, `${videoId}.log`);
    const args = buildArgs(videoUrl);

    logger.info(`Running yt-dlp for ${videoId} (${args.length} args, no shell)`);

    return new Promise((resolve, reject) => {
        const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
        logStream.write(`\n===== ${new Date().toISOString()} ${videoUrl} =====\n`);

        // shell defaults to false: arguments are passed to the process verbatim.
        const child = spawn(CONFIG.YTDLP_PATH, args, { windowsHide: true });

        let stdoutTail = '';
        let stderrTail = '';

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString();
            logStream.write(text);

            stdoutTail = (stdoutTail + text).slice(-8192);

            for (const line of text.split(/\r?\n/)) {
                const progress = parseProgressLine(line);
                if (!progress) continue;

                const entry = activeDownloads.get(videoId);
                if (entry) Object.assign(entry, progress);
                events.emit('progress', { videoId, url: videoUrl, ...progress });
            }
        });

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString();
            logStream.write(text);
            stderrTail = (stderrTail + text).slice(-8192);
        });

        child.on('error', (err) => {
            logStream.end();
            reject(new Error(`Failed to start yt-dlp: ${err.message}`));
        });

        child.on('close', (code) => {
            logStream.end();

            if (code === 0) {
                resolve();
                return;
            }

            // yt-dlp puts the useful one-liner on stderr; fall back to stdout.
            const detail = (stderrTail || stdoutTail)
                .split(/\r?\n/)
                .filter(l => l.includes('ERROR'))
                .pop();

            reject(new Error(detail ? detail.trim() : `yt-dlp exited with code ${code}`));
        });
    });
}

/**
 * Start a download and manage its lifecycle.
 * @param {string} videoUrl - Validated watch URL
 * @param {function} [onComplete] - Called as (url, success)
 * @returns {Promise<boolean>} Whether the download succeeded
 */
async function initiateDownload(videoUrl, onComplete) {
    const videoId = extractVideoId(videoUrl);

    if (!videoId) {
        logger.error(`Refusing to download, not a valid watch URL: ${videoUrl}`);
        if (onComplete) onComplete(videoUrl, false);
        return false;
    }

    if (activeDownloads.has(videoId)) {
        logger.info(`Video already being downloaded: ${videoUrl}`);
        return false;
    }

    activeDownloads.set(videoId, {
        url: videoUrl,
        videoId,
        percent: 0,
        speed: '',
        eta: '',
        startedAt: Date.now()
    });
    events.emit('state');

    logger.info(`Starting download: ${videoUrl}`);
    logger.activityLog('STARTED', videoUrl);

    try {
        await downloadVideo(videoUrl, videoId);

        logger.success(`Download completed: ${videoUrl}`);
        logger.activityLog('SUCCESS', videoUrl);
        if (onComplete) onComplete(videoUrl, true);
        return true;
    } catch (err) {
        logger.error(`Download failed: ${videoUrl} — ${err.message}`);
        logger.activityLog('ERROR', `${videoUrl} — ${err.message}`);
        if (onComplete) onComplete(videoUrl, false);
        return false;
    } finally {
        activeDownloads.delete(videoId);
        events.emit('state');
    }
}

/**
 * Check if a video is currently being downloaded.
 * @param {string} videoUrl
 * @returns {boolean}
 */
function isDownloading(videoUrl) {
    const videoId = extractVideoId(videoUrl);
    return videoId !== null && activeDownloads.has(videoId);
}

/**
 * Snapshot of everything currently downloading.
 * @returns {Array<Object>}
 */
function getActiveDownloads() {
    return [...activeDownloads.values()];
}

module.exports = {
    events,
    initiateDownload,
    isDownloading,
    getActiveDownloads,
    extractVideoId,
    VIDEO_ID_PATTERN
};
