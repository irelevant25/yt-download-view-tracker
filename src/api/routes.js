/**
 * API routes for app
 * Defines endpoints for the Express server
 */
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const notifications = require('../utils/notifications');
const downloader = require('../services/downloader');
const storage = require('../services/storage');

// Track downloaded videos
let downloadedVideos = [];

/**
 * Initialize downloaded videos list
 * @param {string[]} videos - List of video URLs
 */
function initializeDownloadedVideos(videos) {
    downloadedVideos = videos || [];
    logger.info(`Initialized with ${downloadedVideos.length} downloaded videos.`);
}

// API endpoint: Health check
router.get('/', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'API is running' });
});

// API endpoint: Download a video
router.post('/download', (req, res) => {
    const videoUrl = req.body?.url;

    // Validate request
    if (!videoUrl) {
        return res.status(400).json({ error: 'No video URL provided' });
    }

    // Check if video is already downloaded or downloading
    if (downloadedVideos.includes(videoUrl) || downloader.isDownloading(videoUrl)) {
        logger.info(`Video already downloaded or downloading: ${videoUrl}`);
        return res.status(200).json({ message: 'Video already downloaded or in progress.' });
    }

    // Start download
    logger.info(`Received request to download: ${videoUrl}`);

    downloader.initiateDownload(videoUrl, (url, success) => {
        if (success) {
            downloadedVideos.push(url);
        }
    });

    return res.status(200).json({ message: 'Video download successfully started.' });
});

// API endpoint: Upload database
router.post('/upload-db', async (req, res) => {
    const data = req.body?.data;

    // Validate request
    if (!data || !Array.isArray(data)) {
        return res.status(400).json({ error: 'Invalid or missing data' });
    }

    logger.info(`Received request to save data: ${data.length} record(s)`);

    // Get current data
    const savedData = await storage.readDownloadedVideos();

    // Compare data sizes
    if (savedData?.length === data.length) {
        logger.info('Data has not changed.');
        return res.status(200).json({ message: 'Data has not changed.' });
    }

    if (savedData?.length > data.length) {
        logger.error(`Received data (${data.length}) is smaller than saved data (${savedData.length})`);
        logger.error('Possible data loss detected. Manual investigation required.');
        logger.error('Consider restoring data from file to browser IndexedDB.');

        notifications.showNotification(
            'Data Error',
            'Received data is smaller than saved data! Manual intervention required.'
        );

        return res.status(400).json({
            error: 'Data integrity issue detected',
            message: 'Data were not saved.'
        });
    }

    // Save the data
    const success = await storage.saveDownloadedVideos(data);

    if (success) {
        // Update in-memory list
        downloadedVideos = [...data];
        return res.status(200).json({ message: 'Data saved successfully.' });
    } else {
        return res.status(500).json({ error: 'Failed to save data' });
    }
});

module.exports = {
    router,
    initializeDownloadedVideos
};