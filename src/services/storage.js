/**
 * Storage service for app
 * Handles persistence of downloaded videos data
 */
const fs = require('fs').promises;
const fsSync = require('fs');
const CONFIG = require('../config');
const logger = require('../utils/logger');

/**
 * Read downloaded videos data from JSON file.
 * This file contains a string[] of video URLs the app has actually downloaded.
 * @returns {Promise<string[]>} Array of downloaded video URLs
 */
async function readDownloadedVideos() {
    try {
        try {
            await fs.access(CONFIG.DOWNLOADED_VIDEOS_FILE);
        } catch {
            return [];
        }

        const fileContent = await fs.readFile(CONFIG.DOWNLOADED_VIDEOS_FILE, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        logger.error(`Error reading downloaded videos: ${error.message}`);
        return [];
    }
}

/**
 * Append a single video URL to downloaded_videos.json (no-op if already present).
 * @param {string} url - Video URL to add
 * @returns {Promise<boolean>} Success indicator
 */
async function appendDownloadedVideo(url) {
    try {
        const current = await readDownloadedVideos();
        if (current.includes(url)) return true;
        current.push(url);
        await fs.writeFile(CONFIG.DOWNLOADED_VIDEOS_FILE, JSON.stringify(current, null, 2));
        return true;
    } catch (error) {
        logger.error(`Error appending downloaded video: ${error.message}`);
        return false;
    }
}

/**
 * Overwrite downloaded_videos.json with a full array.
 * Only called during initialisation from metadata scan.
 * @param {string[]} data - Array of video URLs
 * @returns {Promise<boolean>} Success indicator
 */
async function saveDownloadedVideos(data) {
    try {
        await fs.writeFile(
            CONFIG.DOWNLOADED_VIDEOS_FILE,
            JSON.stringify(data, null, 2)
        );
        logger.success(`Saved ${data.length} videos to storage.`);
        return true;
    } catch (error) {
        logger.error(`Error saving downloaded videos: ${error.message}`);
        return false;
    }
}

/**
 * Read the full TamperMonkey DB snapshot (YouTubeWatchTracker.json).
 * @returns {Promise<Array>} Array of video objects
 */
async function readWatchTracker() {
    try {
        try {
            await fs.access(CONFIG.WATCH_TRACKER_FILE);
        } catch {
            return [];
        }

        const fileContent = await fs.readFile(CONFIG.WATCH_TRACKER_FILE, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        logger.error(`Error reading watch tracker: ${error.message}`);
        return [];
    }
}

/**
 * Save the full TamperMonkey DB snapshot to YouTubeWatchTracker.json.
 * @param {Array} data - Array of video objects from TamperMonkey
 * @returns {Promise<boolean>} Success indicator
 */
async function saveWatchTracker(data) {
    try {
        await fs.writeFile(CONFIG.WATCH_TRACKER_FILE, JSON.stringify(data, null, 2));
        logger.success(`Watch tracker saved: ${data.length} record(s).`);
        return true;
    } catch (error) {
        logger.error(`Error saving watch tracker: ${error.message}`);
        return false;
    }
}

/**
 * Create necessary directories if they don't exist
 */
async function ensureDirectories() {
    const directories = [
        CONFIG.VIDEOS_DIRECTORY,
        CONFIG.LOGS_DIRECTORY
    ];

    for (const dir of directories) {
        try {
            await fs.mkdir(dir, { recursive: true });
            logger.info(`Ensured directory exists: ${dir}`);
        } catch (error) {
            logger.error(`Error creating directory ${dir}: ${error.message}`);
        }
    }
}

/**
 * Synchronous version of reading downloaded videos (for initialization)
 * @returns {string[]} Array of downloaded video URLs
 */
function readDownloadedVideosSync() {
    if (!fsSync.existsSync(CONFIG.DOWNLOADED_VIDEOS_FILE)) {
        return [];
    }

    try {
        const fileContent = fsSync.readFileSync(CONFIG.DOWNLOADED_VIDEOS_FILE, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        logger.error(`Error reading downloaded videos: ${error.message}`);
        return [];
    }
}

module.exports = {
    readDownloadedVideos,
    appendDownloadedVideo,
    saveDownloadedVideos,
    readWatchTracker,
    saveWatchTracker,
    ensureDirectories,
    readDownloadedVideosSync
};
