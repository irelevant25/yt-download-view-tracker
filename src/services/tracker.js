/**
 * Watch-history reader for app
 *
 * YouTubeWatchTracker.json holds the whole browser-side history — around
 * 11,000 records. This turns it into something the window can search and sort
 * without loading every row into the DOM.
 *
 * Note the datetime split: the userscript stringifies datetime to
 * "DD.MM.YYYY HH:MM:SS" before uploading, while the browser's own database
 * keeps unix seconds. Both shapes are accepted here.
 */
const CONFIG = require('../config');
const logger = require('../utils/logger');
const storage = require('./storage');

/**
 * Parse either representation of a record's datetime.
 * @param {string|number} value
 * @returns {number} epoch milliseconds, or 0 if unparseable
 */
function parseDatetime(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value * 1000;
    }

    if (typeof value === 'string') {
        // "DD.MM.YYYY HH:MM:SS"
        const match = /^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
        if (match) {
            const [, d, mo, y, h, mi, s] = match.map(Number);
            return new Date(y, mo - 1, d, h, mi, s).getTime();
        }

        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) return parsed;
    }

    return 0;
}

/**
 * Load the history, joined with what has actually been downloaded.
 * @param {string[]} downloadedUrls
 * @returns {Promise<Array<Object>>}
 */
async function load(downloadedUrls = []) {
    const raw = await storage.readWatchTracker();
    if (!Array.isArray(raw)) return [];

    const downloadedIds = new Set(
        downloadedUrls
            .map(url => { try { return new URL(url).searchParams.get('v'); } catch { return null; } })
            .filter(Boolean)
    );

    return raw.map((record) => {
        const videoId = record?.key ?? record?.videoCode ?? null;
        return {
            videoId,
            title: typeof record?.title === 'string' ? record.title : '(untitled)',
            watchedAt: parseDatetime(record?.datetime),
            like: record?.like === true,
            dislike: record?.dislike === true,
            // What the browser believes, and what the app can actually prove.
            downloadFlag: record?.download === true,
            onDisk: videoId ? downloadedIds.has(videoId) : false
        };
    });
}

/**
 * Search, sort and page the history.
 *
 * Paging is what keeps this usable — 11,000 rows in the DOM is not.
 *
 * @param {Array<Object>} records
 * @param {Object} [options]
 * @param {string} [options.search] - Case-insensitive title or id match
 * @param {string} [options.filter] - all | liked | downloaded | missing
 * @param {string} [options.sort] - watchedAt | title
 * @param {string} [options.direction] - asc | desc
 * @param {number} [options.offset]
 * @param {number} [options.limit]
 * @returns {{total: number, matched: number, rows: Array<Object>}}
 */
function query(records, options = {}) {
    const {
        search = '',
        filter = 'all',
        sort = 'watchedAt',
        direction = 'desc',
        offset = 0,
        limit = 200
    } = options;

    const needle = search.trim().toLowerCase();

    let rows = records;

    if (needle) {
        rows = rows.filter(r =>
            r.title.toLowerCase().includes(needle) ||
            (r.videoId && r.videoId.toLowerCase().includes(needle))
        );
    }

    switch (filter) {
        case 'liked':
            rows = rows.filter(r => r.like);
            break;
        case 'downloaded':
            rows = rows.filter(r => r.onDisk);
            break;
        case 'missing':
            // Liked, but the app has no file for it — the interesting gap.
            rows = rows.filter(r => r.like && !r.onDisk);
            break;
        default:
            break;
    }

    const factor = direction === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
        if (sort === 'title') return factor * a.title.localeCompare(b.title);
        return factor * (a.watchedAt - b.watchedAt);
    });

    return {
        total: records.length,
        matched: rows.length,
        rows: rows.slice(offset, offset + limit)
    };
}

/**
 * Headline counts for the library panel.
 * @param {Array<Object>} records
 * @returns {Object}
 */
function summarise(records) {
    const liked = records.filter(r => r.like).length;
    const onDisk = records.filter(r => r.onDisk).length;
    return {
        total: records.length,
        liked,
        disliked: records.filter(r => r.dislike).length,
        onDisk,
        likedMissing: records.filter(r => r.like && !r.onDisk).length,
        // Records the browser thinks are downloaded but the app cannot find.
        flaggedButMissing: records.filter(r => r.downloadFlag && !r.onDisk).length
    };
}

module.exports = {
    load,
    query,
    summarise,
    parseDatetime
};
