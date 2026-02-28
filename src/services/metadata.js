/**
 * Metadata service for app
 * Handles video metadata extraction and management
 */
const fs = require('fs').promises;
const path = require('path');
const CONFIG = require('../config');
const logger = require('../utils/logger');

/**
 * Extract video URLs from metadata of downloaded videos
 * @returns {Promise<string[]>} Array of video URLs
 */
async function extractVideoUrlsFromMetadata() {
    try {
        const videoUrls = [];

        // Read the videos directory
        const files = await fs.readdir(CONFIG.VIDEOS_DIRECTORY);

        // Filter videos with the correct extension
        const videoFiles = files.filter(file =>
            path.extname(file) === `.${CONFIG.MERGE_OUTPUT_FORMAT}`
        );

        // Extract URLs from metadata
        for (const file of videoFiles) {
            const filePath = path.join(CONFIG.VIDEOS_DIRECTORY, file);
            try {
                const mm = await import('music-metadata');
                const metadata = await mm.parseFile(filePath);
                const comments = metadata.common.comment;

                if (Array.isArray(comments) && comments.length > 0) {
                    videoUrls.push(comments[0].text.replace(/\\=/g, '='));
                }
            } catch (parseErr) {
                logger.error(`Error reading metadata from ${file}: ${parseErr.message}`);
            }
        }

        logger.info(`Found ${videoUrls.length} videos with metadata.`);
        return videoUrls;
    } catch (err) {
        logger.error(`Failed to scan videos directory: ${err.message}`);
        return [];
    }
}

module.exports = {
    extractVideoUrlsFromMetadata
};