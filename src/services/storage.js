/**
 * Storage service for app
 * Handles persistence of downloaded videos data
 */
const fs = require('fs').promises;
const fsSync = require('fs');
const CONFIG = require('../config');
const logger = require('../utils/logger');

/**
 * Read downloaded videos data from JSON file
 * @returns {Promise<Array>} Array of downloaded video URLs
 */
async function readDownloadedVideos() {
    try {
        // Check if file exists
        try {
            await fs.access(CONFIG.DOWNLOADED_VIDEOS_FILE);
        } catch (err) {
            logger.info(`Downloaded videos file not found. Creating new file.`);
            return [];
        }

        // Read and parse the file
        const fileContent = await fs.readFile(CONFIG.DOWNLOADED_VIDEOS_FILE, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        logger.error(`Error reading downloaded videos: ${error.message}`);
        return [];
    }
}

/**
 * Save downloaded videos data to JSON file
 * @param {Array} data - Array of video URLs to save
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
 * Synchronous version of reading videos data (for initialization)
 * @returns {Array} Array of downloaded video URLs
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
    saveDownloadedVideos,
    ensureDirectories,
    readDownloadedVideosSync
};