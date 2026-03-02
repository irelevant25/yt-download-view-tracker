/**
 * Global configuration constants for the app
 */
const { app } = require('electron');
const path = require('path');

// Base directory (either __dirname or the executable's directory)
// Fallback to path.dirname(process.execPath) if PORTABLE_EXECUTABLE_DIR is not set (e.g. win-unpacked)
const BASE_DIR = app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
    : path.resolve(__dirname, '..');
// In production, icons must be read from the real filesystem (not inside asar),
// so we use process.resourcesPath which points to the temp extraction directory
// where extraFiles are placed. In dev, use the project resources/ folder.
const RESOURCES_DIR = app.isPackaged ? process.resourcesPath : path.join(BASE_DIR, 'resources');
const LOGS_DIR = path.join(BASE_DIR, 'logs');

// Binaries are in bin/ during development; electron-builder extraFiles copies them to app root in production
const BIN_DIR = app.isPackaged ? BASE_DIR : path.join(BASE_DIR, 'bin');

// Application settings
const CONFIG = {
    APP_NAME: 'YouTube Checker',
    APP_ID: 'com.yourdomain.youtubechecker',
    PORT: 5000,
    MERGE_OUTPUT_FORMAT: 'mp4',

    // Directories
    VIDEOS_DIRECTORY: path.join(BASE_DIR, 'videos'),
    LOGS_DIRECTORY: LOGS_DIR,
    RESOURCES_DIRECTORY: RESOURCES_DIR,

    // Files
    DOWNLOADED_VIDEOS_FILE: path.join(BASE_DIR, 'downloaded_videos.json'),
    WATCH_TRACKER_FILE: path.join(BASE_DIR, 'YouTubeWatchTracker.json'),
    ACTIVITY_LOG_FILE: path.join(LOGS_DIR, 'activity.log'),
    FFMPEG_PATH: path.join(BIN_DIR, 'ffmpeg.exe'),
    YTDLP_PATH: path.join(BIN_DIR, 'yt-dlp.exe'),

    // Resources
    ICON_PATH16: path.join(RESOURCES_DIR, 'icon16.png'),
    ICON_PATH20: path.join(RESOURCES_DIR, 'icon20.png'),
    ICON_PATH24: path.join(RESOURCES_DIR, 'icon24.png'),
    ICON_PATH32: path.join(RESOURCES_DIR, 'icon32.png'),
    ICON_PATH40: path.join(RESOURCES_DIR, 'icon40.png'),
    ICON_PATH48: path.join(RESOURCES_DIR, 'icon48.png'),
    ICON_PATH64: path.join(RESOURCES_DIR, 'icon64.png'),
    ICON_PATH128: path.join(RESOURCES_DIR, 'icon128.png'),
    ICON_PATH256: path.join(RESOURCES_DIR, 'icon256.png'),
    ICON_PATH512: path.join(RESOURCES_DIR, 'icon512.png'),
    ICON_ICO_PATH256: path.join(RESOURCES_DIR, 'icon256.ico'),
};

module.exports = CONFIG;