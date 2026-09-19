/**
 * Library service for app
 *
 * Owns the answer to "what has actually been downloaded?".
 *
 * Two sources are reconciled:
 *   1. the files in videos/ — the ground truth, since a file either exists or not
 *   2. downloaded_videos.json — the record of what the app downloaded
 *
 * A video id is read from the filename ("Title [dQw4w9WgXcQ].mp4"). Files
 * written before that template existed carry the source URL in their embedded
 * metadata instead, so those are parsed once and can be renamed by repair().
 */
const fs = require('fs').promises;
const path = require('path');
const CONFIG = require('../config');
const logger = require('../utils/logger');
const storage = require('./storage');

/** Matches the id in "Some Title [dQw4w9WgXcQ].mp4". */
const ID_IN_FILENAME = /\[([A-Za-z0-9_-]{11})\]\.[^.]+$/;

const watchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

/**
 * Read the video id out of a filename, if the new template was used.
 * @param {string} filename
 * @returns {string|null}
 */
function idFromFilename(filename) {
    const match = ID_IN_FILENAME.exec(filename);
    return match ? match[1] : null;
}

/**
 * Read the video id from a file's embedded metadata comment.
 * Only needed for files downloaded before the id was part of the filename.
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
async function idFromMetadata(filePath) {
    try {
        const mm = await import('music-metadata');
        const metadata = await mm.parseFile(filePath);
        const comments = metadata.common.comment;
        if (!Array.isArray(comments) || comments.length === 0) return null;

        const text = String(comments[0]?.text ?? comments[0] ?? '').replace(/\\=/g, '=');
        const id = new URL(text).searchParams.get('v');
        return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    } catch {
        return null;
    }
}

/**
 * Scan videos/ and report what is on disk.
 * @returns {Promise<{entries: Array<Object>, ids: Set<string>}>}
 */
async function scan() {
    const entries = [];
    const ids = new Set();

    let files;
    try {
        files = await fs.readdir(CONFIG.VIDEOS_DIRECTORY);
    } catch (error) {
        logger.error(`Failed to read videos directory: ${error.message}`);
        return { entries, ids };
    }

    const videoFiles = files.filter(f => path.extname(f) === `.${CONFIG.MERGE_OUTPUT_FORMAT}`);
    let metadataReads = 0;

    for (const filename of videoFiles) {
        const filePath = path.join(CONFIG.VIDEOS_DIRECTORY, filename);

        let videoId = idFromFilename(filename);
        const fromFilename = videoId !== null;

        if (!videoId) {
            videoId = await idFromMetadata(filePath);
            metadataReads++;
        }

        let size = 0;
        try {
            size = (await fs.stat(filePath)).size;
        } catch { /* file vanished between readdir and stat */ }

        entries.push({ filename, filePath, videoId, fromFilename, size });
        if (videoId) ids.add(videoId);
    }

    if (metadataReads > 0) {
        logger.info(`Read metadata from ${metadataReads} legacy file(s) with no id in the filename.`);
    }
    logger.info(`Library scan: ${entries.length} file(s), ${ids.size} identified.`);

    return { entries, ids };
}

/**
 * Build the authoritative downloaded-URL list at startup.
 *
 * The union of what is on disk and what downloaded_videos.json records. The
 * file is what survives a video being moved elsewhere for storage; the disk
 * scan is what picks up files the app did not download itself.
 *
 * @returns {Promise<string[]>}
 */
async function loadDownloadedVideos() {
    const { ids } = await scan();
    const recorded = await storage.readDownloadedVideos();

    const urls = new Set(recorded.filter(u => typeof u === 'string'));
    for (const id of ids) urls.add(watchUrl(id));

    const merged = [...urls];

    // Persist the union so the record catches up with the disk.
    if (merged.length !== recorded.length) {
        await storage.saveDownloadedVideos(merged);
    }

    logger.success(`Library: ${merged.length} downloaded video(s) known.`);
    return merged;
}

/**
 * Reconcile the record against the disk and report the differences.
 * @returns {Promise<Object>} Report of files, identified ids and mismatches
 */
async function inspect() {
    const { entries, ids } = await scan();
    const recorded = await storage.readDownloadedVideos();

    const recordedIds = new Set(
        recorded
            .map(url => { try { return new URL(url).searchParams.get('v'); } catch { return null; } })
            .filter(Boolean)
    );

    const unidentified = entries.filter(e => !e.videoId);
    const legacyNames = entries.filter(e => e.videoId && !e.fromFilename);
    const missingFiles = [...recordedIds].filter(id => !ids.has(id));
    const untracked = [...ids].filter(id => !recordedIds.has(id));

    return {
        fileCount: entries.length,
        totalBytes: entries.reduce((sum, e) => sum + e.size, 0),
        identified: ids.size,
        unidentified: unidentified.map(e => e.filename),
        legacyNames: legacyNames.map(e => e.filename),
        missingFiles: missingFiles.map(watchUrl),
        untracked: untracked.map(watchUrl)
    };
}

/**
 * Repair the library: rename legacy files so the id is in the filename, and
 * bring downloaded_videos.json in line with what is actually on disk.
 *
 * @param {Object} [options]
 * @param {boolean} [options.rename=true] - Rename legacy files
 * @param {boolean} [options.forget=false] - Drop records whose file is gone
 * @returns {Promise<Object>} What was changed
 */
async function repair({ rename = true, forget = false } = {}) {
    const { entries } = await scan();
    const renamed = [];
    const failed = [];

    if (rename) {
        for (const entry of entries) {
            if (!entry.videoId || entry.fromFilename) continue;

            const ext = path.extname(entry.filename);
            const base = path.basename(entry.filename, ext);
            const target = path.join(CONFIG.VIDEOS_DIRECTORY, `${base} [${entry.videoId}]${ext}`);

            try {
                // Never clobber an existing file.
                try {
                    await fs.access(target);
                    continue;
                } catch { /* target is free */ }

                await fs.rename(entry.filePath, target);
                renamed.push({ from: entry.filename, to: path.basename(target) });
            } catch (error) {
                failed.push({ filename: entry.filename, error: error.message });
                logger.error(`Could not rename ${entry.filename}: ${error.message}`);
            }
        }
    }

    const after = await scan();
    const recorded = await storage.readDownloadedVideos();

    const urls = forget
        ? new Set([...after.ids].map(watchUrl))
        : new Set([...recorded, ...[...after.ids].map(watchUrl)]);

    await storage.saveDownloadedVideos([...urls]);

    const result = { renamed, failed, recordCount: urls.size, fileCount: after.entries.length };
    logger.success(`Library repair: renamed ${renamed.length}, ${urls.size} record(s) tracked.`);
    logger.activityLog('REPAIR', `renamed=${renamed.length} failed=${failed.length} records=${urls.size}`);

    return result;
}

module.exports = {
    scan,
    inspect,
    repair,
    loadDownloadedVideos,
    idFromFilename,
    ID_IN_FILENAME
};
