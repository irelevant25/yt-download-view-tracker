/**
 * Storage statistics for app
 *
 * Reports how much space the library is using and how much is left on the
 * drive it lives on, so the window can warn before a download fails halfway
 * through for want of room.
 */
const fs = require('fs').promises;
const path = require('path');
const CONFIG = require('../config');
const logger = require('../utils/logger');

/**
 * Total size of every file directly inside a directory.
 * Not recursive — neither videos/ nor logs/ has subdirectories.
 * @param {string} directory
 * @returns {Promise<{bytes: number, count: number}>}
 */
async function directorySize(directory) {
    let bytes = 0;
    let count = 0;

    let names;
    try {
        names = await fs.readdir(directory);
    } catch {
        return { bytes, count };
    }

    for (const name of names) {
        try {
            const info = await fs.stat(path.join(directory, name));
            if (!info.isFile()) continue;
            bytes += info.size;
            count += 1;
        } catch { /* vanished mid-scan */ }
    }

    return { bytes, count };
}

/**
 * Free and total bytes on the volume holding a path.
 * @param {string} target
 * @returns {Promise<{freeBytes: number, totalBytes: number}>}
 */
async function diskSpace(target) {
    try {
        const info = await fs.statfs(target);
        return {
            freeBytes: info.bavail * info.bsize,
            totalBytes: info.blocks * info.bsize
        };
    } catch (error) {
        logger.error(`Could not read disk space for ${target}: ${error.message}`);
        return { freeBytes: 0, totalBytes: 0 };
    }
}

/**
 * Everything the UI needs to describe storage.
 * @returns {Promise<Object>}
 */
async function getStorageStats() {
    const [videos, logs, disk] = await Promise.all([
        directorySize(CONFIG.VIDEOS_DIRECTORY),
        directorySize(CONFIG.LOGS_DIRECTORY),
        diskSpace(CONFIG.VIDEOS_DIRECTORY)
    ]);

    const usedBytes = disk.totalBytes - disk.freeBytes;

    return {
        videosBytes: videos.bytes,
        videoCount: videos.count,
        logsBytes: logs.bytes,
        logCount: logs.count,
        averageVideoBytes: videos.count ? Math.round(videos.bytes / videos.count) : 0,
        freeBytes: disk.freeBytes,
        totalBytes: disk.totalBytes,
        usedBytes,
        // Roughly how many more videos fit, at the current average size.
        estimatedRoomForVideos: videos.count && videos.bytes
            ? Math.floor(disk.freeBytes / (videos.bytes / videos.count))
            : null,
        videosDirectory: CONFIG.VIDEOS_DIRECTORY
    };
}

module.exports = {
    getStorageStats,
    directorySize
};
