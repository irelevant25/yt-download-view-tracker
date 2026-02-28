/**
 * Downloader service for app
 * Handles video download operations
 */
const path = require('path');
const { exec } = require('child_process');
const CONFIG = require('../config');
const logger = require('../utils/logger');

// Track downloads in progress
let activeDownloads = [];

/**
 * Download a YouTube video using yt-dlp
 * @param {string} videoUrl - URL of the video to download
 * @returns {Promise<boolean>} Success indicator
 */
function downloadVideo(videoUrl) {
    // Build basic options
    const options = {
        ffmpegLocation: CONFIG.FFMPEG_PATH,
        format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
        output: path.join(CONFIG.VIDEOS_DIRECTORY, '%(title)s.%(ext)s'),
        writeSub: true,
        subLang: 'en',
        subFormat: 'srt',
        mergeOutputFormat: CONFIG.MERGE_OUTPUT_FORMAT,
        httpChunkSize: '10M',
        forceIpv4: true,
        exec: `"${CONFIG.FFMPEG_PATH} -y -i {} -metadata comment=${videoUrl} -c copy -f mp4 {}.temp.mp4 && move /Y {}.temp.mp4 {}"`
    };

    // Generate command line arguments
    const args = [videoUrl];
    Object.entries(options).forEach(([key, value]) => {
        const option = `--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;

        if (value === true) {
            args.push(option);
        } else if (value !== false) {
            args.push(option, value.toString());
        }
    });

    // Create log file path
    const videoId = videoUrl.split('=').pop();
    const logFilePath = path.join(CONFIG.LOGS_DIRECTORY, `${videoId}.log`);

    // Build the command
    const ytDlpPath = path.resolve(CONFIG.YTDLP_PATH);
    const command = `"${ytDlpPath}" ${args.join(' ')} --verbose >> "${logFilePath}" 2>&1`;

    logger.success(`Executing download command: ${command}`);

    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(false);
            }
            else {
                resolve(true);
            }
        });
    });
}

/**
 * Initiate a download and manage its lifecycle
 * @param {string} videoUrl - URL of the video to download
 * @param {function} onComplete - Callback when download completes
 */
async function initiateDownload(videoUrl, onComplete) {
    if (isDownloading(videoUrl)) {
        logger.info(`Video already being downloaded: ${videoUrl}`);
        return false;
    }

    // Add to active downloads
    activeDownloads.push(videoUrl);
    logger.info(`Starting download: ${videoUrl}`);

    try {
        const success = await downloadVideo(videoUrl);

        // Remove from active downloads
        activeDownloads = activeDownloads.filter(url => url !== videoUrl);

        if (success) {
            logger.success(`Download completed: ${videoUrl}`);
            if (onComplete) onComplete(videoUrl, true);
            return true;
        } else {
            logger.error(`Download failed: ${videoUrl}`);
            if (onComplete) onComplete(videoUrl, false);
            return false;
        }
    } catch (err) {
        // Remove from active downloads
        activeDownloads = activeDownloads.filter(url => url !== videoUrl);

        logger.error(`Exception during download: ${err}`);
        if (onComplete) onComplete(videoUrl, false);
        return false;
    }
}

/**
 * Check if a video is currently being downloaded
 * @param {string} videoUrl - URL to check
 * @returns {boolean} True if downloading
 */
function isDownloading(videoUrl) {
    return activeDownloads.includes(videoUrl);
}

/**
 * Get list of currently downloading videos
 * @returns {string[]} Array of downloading video URLs
 */
function getActiveDownloads() {
    return [...activeDownloads];
}

module.exports = {
    initiateDownload,
    isDownloading,
    getActiveDownloads
};