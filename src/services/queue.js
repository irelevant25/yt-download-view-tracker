/**
 * Download queue for app
 *
 * Downloads used to be fire-and-forget: every request spawned a yt-dlp
 * immediately, nothing limited how many ran at once, and a failure was logged
 * and then lost. This queue owns them instead.
 *
 *   - at most CONFIG.MAX_CONCURRENT_DOWNLOADS run at a time
 *   - failures are retried with exponential backoff, up to MAX_DOWNLOAD_ATTEMPTS
 *   - the queue is written to disk, so a restart resumes rather than forgets
 *
 * Items are keyed by video id, so the same video cannot be queued twice.
 */
const fs = require('fs').promises;
const { EventEmitter } = require('events');
const CONFIG = require('../config');
const logger = require('../utils/logger');
const downloader = require('./downloader');

/** Emits 'change' whenever the queue contents or an item's state moves. */
const events = new EventEmitter();

/** videoId -> item */
const items = new Map();

let running = 0;
let tickTimer = null;
let onDownloaded = null;
let writeChain = Promise.resolve();

/**
 * @typedef {Object} QueueItem
 * @property {string} url
 * @property {string} videoId
 * @property {'pending'|'active'|'failed'} state
 * @property {number} attempts
 * @property {number} nextAttemptAt - epoch ms; not eligible before this
 * @property {string} lastError
 * @property {number} addedAt
 */

/**
 * Delay before attempt n (1-based): 30s, 2m, 8m, ...
 * @param {number} attempts
 * @returns {number} milliseconds
 */
function backoffMs(attempts) {
    return CONFIG.RETRY_BASE_DELAY_MS * Math.pow(CONFIG.RETRY_FACTOR, Math.max(0, attempts - 1));
}

/**
 * Persist the queue. Writes are chained so two rapid changes cannot interleave
 * and leave a half-written file behind.
 * @returns {Promise<void>}
 */
function persist() {
    writeChain = writeChain.then(async () => {
        try {
            const payload = [...items.values()].map(item => ({ ...item, state: item.state === 'active' ? 'pending' : item.state }));
            await fs.writeFile(CONFIG.QUEUE_FILE, JSON.stringify(payload, null, 2));
        } catch (error) {
            logger.error(`Could not write download queue: ${error.message}`);
        }
    });
    return writeChain;
}

/**
 * Load a queue persisted by a previous run.
 * Anything that was mid-flight when the app stopped comes back as pending.
 * @returns {Promise<number>} How many items were restored
 */
async function load() {
    let raw;
    try {
        raw = await fs.readFile(CONFIG.QUEUE_FILE, 'utf-8');
    } catch {
        return 0;
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        logger.error(`Download queue file is corrupt, ignoring it: ${error.message}`);
        return 0;
    }

    if (!Array.isArray(parsed)) return 0;

    for (const entry of parsed) {
        const videoId = downloader.extractVideoId(entry?.url ?? '');
        if (!videoId) continue;

        items.set(videoId, {
            url: entry.url,
            videoId,
            state: entry.state === 'failed' ? 'failed' : 'pending',
            attempts: Number(entry.attempts) || 0,
            nextAttemptAt: Number(entry.nextAttemptAt) || 0,
            lastError: typeof entry.lastError === 'string' ? entry.lastError : '',
            addedAt: Number(entry.addedAt) || Date.now()
        });
    }

    if (items.size > 0) {
        logger.info(`Restored ${items.size} item(s) from the download queue.`);
    }
    events.emit('change');
    return items.size;
}

/**
 * Add a video to the queue.
 * @param {string} videoUrl - A validated watch URL
 * @returns {{queued: boolean, reason: string}}
 */
function enqueue(videoUrl) {
    const videoId = downloader.extractVideoId(videoUrl);
    if (!videoId) return { queued: false, reason: 'invalid-url' };

    const existing = items.get(videoId);
    if (existing) {
        // A previously exhausted item gets a fresh start when asked again.
        if (existing.state === 'failed') {
            existing.state = 'pending';
            existing.attempts = 0;
            existing.nextAttemptAt = 0;
            persist();
            events.emit('change');
            pump();
            return { queued: true, reason: 'retrying' };
        }
        return { queued: false, reason: 'already-queued' };
    }

    items.set(videoId, {
        url: videoUrl,
        videoId,
        state: 'pending',
        attempts: 0,
        nextAttemptAt: 0,
        lastError: '',
        addedAt: Date.now()
    });

    logger.info(`Queued: ${videoUrl} (${items.size} in queue)`);
    logger.activityLog('QUEUED', videoUrl);

    persist();
    events.emit('change');
    pump();

    return { queued: true, reason: 'queued' };
}

/**
 * Start as many eligible downloads as the concurrency limit allows.
 */
function pump() {
    if (running >= CONFIG.MAX_CONCURRENT_DOWNLOADS) return;

    const now = Date.now();
    const eligible = [...items.values()]
        .filter(item => item.state === 'pending' && item.nextAttemptAt <= now)
        .sort((a, b) => a.addedAt - b.addedAt);

    for (const item of eligible) {
        if (running >= CONFIG.MAX_CONCURRENT_DOWNLOADS) break;
        run(item);
    }
}

/**
 * Run one item to completion, then retry, drop or finish it.
 * @param {QueueItem} item
 */
async function run(item) {
    item.state = 'active';
    item.attempts += 1;
    running += 1;
    events.emit('change');

    let succeeded = false;
    let failure = '';

    await downloader.initiateDownload(item.url, (url, success) => {
        succeeded = success;
    }).catch((error) => {
        failure = error.message;
    });

    running -= 1;

    if (succeeded) {
        items.delete(item.videoId);
        if (onDownloaded) await onDownloaded(item.url);
    } else if (item.attempts >= CONFIG.MAX_DOWNLOAD_ATTEMPTS) {
        item.state = 'failed';
        item.lastError = failure || 'download failed';
        logger.error(`Giving up on ${item.url} after ${item.attempts} attempts.`);
        logger.activityLog('GAVE_UP', `${item.url} after ${item.attempts} attempts`);
    } else {
        const delay = backoffMs(item.attempts);
        item.state = 'pending';
        item.nextAttemptAt = Date.now() + delay;
        item.lastError = failure || 'download failed';
        logger.info(`Retrying ${item.url} in ${Math.round(delay / 1000)}s (attempt ${item.attempts + 1}/${CONFIG.MAX_DOWNLOAD_ATTEMPTS}).`);
        logger.activityLog('RETRY_SCHEDULED', `${item.url} in ${Math.round(delay / 1000)}s`);
    }

    await persist();
    events.emit('change');
    pump();
}

/**
 * Put every failed item back in line, ignoring their backoff.
 * @returns {number} How many were reset
 */
function retryFailed() {
    let count = 0;
    for (const item of items.values()) {
        if (item.state !== 'failed') continue;
        item.state = 'pending';
        item.attempts = 0;
        item.nextAttemptAt = 0;
        count += 1;
    }

    if (count > 0) {
        logger.info(`Re-queued ${count} failed download(s).`);
        persist();
        events.emit('change');
        pump();
    }
    return count;
}

/**
 * Drop an item from the queue.
 * @param {string} videoId
 * @returns {boolean} Whether anything was removed
 */
function remove(videoId) {
    const item = items.get(videoId);
    if (!item || item.state === 'active') return false;

    items.delete(videoId);
    persist();
    events.emit('change');
    return true;
}

/**
 * Current queue contents, newest information first.
 * @returns {Object}
 */
function status() {
    const all = [...items.values()];
    return {
        running,
        limit: CONFIG.MAX_CONCURRENT_DOWNLOADS,
        pending: all.filter(i => i.state === 'pending').length,
        failed: all.filter(i => i.state === 'failed').length,
        items: all.map(item => ({
            ...item,
            // Live progress comes from the downloader, which owns the process.
            progress: downloader.getActiveDownloads().find(d => d.videoId === item.videoId) || null
        }))
    };
}

/**
 * Whether this video is already queued or downloading.
 * @param {string} videoUrl
 * @returns {boolean}
 */
function has(videoUrl) {
    const videoId = downloader.extractVideoId(videoUrl);
    return videoId !== null && items.has(videoId);
}

/**
 * Load any persisted queue and start processing.
 * @param {Object} [options]
 * @param {function} [options.onDownloaded] - Called with the URL after a success
 * @returns {Promise<void>}
 */
async function start({ onDownloaded: handler } = {}) {
    onDownloaded = handler || null;

    await load();

    // A steady tick is what makes backoff work without a timer per item.
    if (!tickTimer) {
        tickTimer = setInterval(pump, CONFIG.QUEUE_TICK_MS);
        if (tickTimer.unref) tickTimer.unref();
    }

    pump();
}

/**
 * Stop processing. In-flight downloads are left to finish.
 */
function stop() {
    if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}

module.exports = {
    events,
    start,
    stop,
    enqueue,
    retryFailed,
    remove,
    status,
    has,
    // exported for tests
    _items: items
};
