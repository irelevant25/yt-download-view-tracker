/**
 * Logging utility for app
 * Handles log message formatting and delivery to both console and UI
 */
const fs = require('fs');
const CONFIG = require('../config');

let mainWindow = null;
let messageQueue = [];

/**
 * Initialize the logger with a reference to the main window
 * @param {BrowserWindow} window - Electron BrowserWindow instance
 */
function init(window) {
    mainWindow = window;

    // Send any queued messages to the renderer
    if (messageQueue.length > 0) {
        flushMessageQueue();
    }
}

/**
 * Send all queued messages to the renderer
 */
function flushMessageQueue() {
    if (!mainWindow || !mainWindow.webContents) return;

    messageQueue.forEach(item => {
        mainWindow.webContents.send('log', item.datetime, item.message, item.type);
    });

    messageQueue = [];
}

/**
 * Log a message to both console and UI
 * @param {string} message - The message to log
 * @param {string} [type] - Optional message type (red, green, blue)
 */
function log(message, type) {
    const datetime = new Date().toLocaleString();
    console.log(`[${datetime}] ${message}`);

    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('log', datetime, message, type);
    } else {
        messageQueue.push({ message, type, datetime });
    }
}

/**
 * Log an error message
 * @param {string} message - The error message
 */
function error(message) {
    log(message, 'red');
}

/**
 * Log a success message
 * @param {string} message - The success message
 */
function success(message) {
    log(message, 'green');
}

/**
 * Log an info message
 * @param {string} message - The info message
 */
function info(message) {
    log(message, 'blue');
}

/**
 * Append a line to the activity log file.
 * Format: YYYY-MM-DD HH:MM:SS | STATUS        | label
 * @param {string} status - Status string (e.g. STARTED, SUCCESS, ERROR)
 * @param {string} label  - Video URL or descriptive label
 */
function activityLog(status, label) {
    try {
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const line = `${timestamp} | ${status.padEnd(13)} | ${label}\n`;
        fs.appendFileSync(CONFIG.ACTIVITY_LOG_FILE, line);
    } catch {
        // Silent fail — logs directory may not exist yet on very early calls
    }
}

function updateDownloadVideos(videos) {
    videos.forEach(videoUrl => {
        mainWindow.webContents.send('download-completed', videoUrl);
    });
}

module.exports = {
    init,
    log,
    error,
    success,
    info,
    activityLog,
    updateDownloadVideos
};
