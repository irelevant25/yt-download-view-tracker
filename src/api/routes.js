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

// Authoritative list of URLs the app has actually downloaded (string[])
let downloadedVideos = [];

/**
 * Initialize downloaded videos list from metadata scan on startup.
 * @param {string[]} videos - List of video URLs found in video files
 */
function initializeDownloadedVideos(videos) {
    downloadedVideos = videos || [];
    logger.info(`Initialized with ${downloadedVideos.length} downloaded videos.`);
}

// API endpoint: Health check
router.get('/', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'API is running' });
});

/**
 * Accept only real YouTube watch URLs.
 *
 * Everything reaching this endpoint is untrusted: it becomes a yt-dlp argument
 * and part of a log filename. Rebuilding the URL from its parsed parts, rather
 * than passing the caller's string through, means nothing unexpected survives.
 *
 * @param {unknown} value
 * @returns {string|null} A normalised watch URL, or null if it is not one
 */
function normaliseWatchUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;

    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return null;
    }

    if (parsed.protocol !== 'https:') return null;

    const host = parsed.hostname.toLowerCase();
    const allowedHosts = ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com'];
    if (!allowedHosts.includes(host)) return null;
    if (parsed.pathname !== '/watch') return null;

    const videoId = parsed.searchParams.get('v');
    if (!videoId || !downloader.VIDEO_ID_PATTERN.test(videoId)) return null;

    return `https://www.youtube.com/watch?v=${videoId}`;
}

// API endpoint: Download a video
router.post('/download', (req, res) => {
    const videoUrl = normaliseWatchUrl(req.body?.url);

    if (!videoUrl) {
        logger.error(`Rejected download request with invalid URL: ${String(req.body?.url).slice(0, 120)}`);
        return res.status(400).json({ error: 'Not a valid YouTube watch URL' });
    }

    if (downloadedVideos.includes(videoUrl) || downloader.isDownloading(videoUrl)) {
        logger.info(`Video already downloaded or downloading: ${videoUrl}`);
        logger.activityLog('DUPLICATE', videoUrl);
        return res.status(200).json({ message: 'Video already downloaded or in progress.' });
    }

    logger.info(`Received request to download: ${videoUrl}`);

    downloader.initiateDownload(videoUrl, async (url, success) => {
        if (success) {
            downloadedVideos.push(url);
            await storage.appendDownloadedVideo(url);
        }
    });

    return res.status(200).json({ message: 'Video download successfully started.' });
});

// API endpoint: Upload TamperMonkey database snapshot
//
// Saves the full video-object array to YouTubeWatchTracker.json and returns
// the list of video codes the app has actually downloaded so TamperMonkey
// can update its local IndexedDB to reflect the real download status.
router.post('/upload-db', async (req, res) => {
    const data = req.body?.data;

    if (!data || !Array.isArray(data)) {
        return res.status(400).json({ error: 'Invalid or missing data' });
    }

    logger.info(`Received watch tracker upload: ${data.length} record(s)`);

    // Data-loss guard: compare against the last saved snapshot
    const savedData = await storage.readWatchTracker();

    if (savedData?.length === data.length) {
        logger.info('Watch tracker data has not changed.');
        return res.status(200).json({
            message: 'Data has not changed.',
            downloadedVideoCodes: extractVideoCodes(downloadedVideos)
        });
    }

    if (savedData?.length > data.length) {
        logger.error(`Received data (${data.length}) is smaller than saved data (${savedData.length})`);
        logger.error('Possible data loss detected. Manual investigation required.');

        notifications.showNotification(
            'Data Error',
            'Received data is smaller than saved data! Manual intervention required.'
        );

        return res.status(400).json({
            error: 'Data integrity issue detected',
            message: 'Data were not saved.'
        });
    }

    const success = await storage.saveWatchTracker(data);

    if (success) {
        return res.status(200).json({
            message: 'Data saved successfully.',
            downloadedVideoCodes: extractVideoCodes(downloadedVideos)
        });
    } else {
        return res.status(500).json({ error: 'Failed to save data' });
    }
});

/**
 * Extract YouTube video codes (the ?v= value) from a list of full URLs.
 * @param {string[]} urls
 * @returns {string[]}
 */
function extractVideoCodes(urls) {
    return urls
        .map(url => {
            try { return new URL(url).searchParams.get('v'); }
            catch { return null; }
        })
        .filter(Boolean);
}

module.exports = {
    router,
    initializeDownloadedVideos
};
