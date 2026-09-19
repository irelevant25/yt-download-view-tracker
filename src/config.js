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

// The exe the user actually launched. A portable build runs a copy extracted
// to %TEMP% and deletes it on exit, so anything that must outlive this run —
// the Start Menu shortcut, the protocol handler, self-update — points here,
// never at process.execPath.
const LAUNCHED_EXE = app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_FILE || process.execPath)
    : process.execPath;

// Application settings
const CONFIG = {
    APP_NAME: 'YouTube Checker',
    APP_ID: 'com.yourdomain.youtubechecker',
    PORT: 5000,
    MERGE_OUTPUT_FORMAT: 'mp4',

    // Download behaviour
    DOWNLOAD_FORMAT: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
    SUBTITLE_LANGUAGES: 'en',
    // The video id in the filename is what makes the library self-describing:
    // the app knows what it has from the directory listing alone.
    OUTPUT_TEMPLATE: '%(title)s [%(id)s].%(ext)s',
    // Marker yt-dlp prefixes progress lines with, so they can be told apart
    // from ordinary output. Must not appear in normal yt-dlp text.
    PROGRESS_PREFIX: '@@PROGRESS@@',

    // Download queue
    MAX_CONCURRENT_DOWNLOADS: 2,
    MAX_DOWNLOAD_ATTEMPTS: 4,
    // Backoff between attempts: 30s, 2m, 8m — doubling by 4 each time.
    RETRY_BASE_DELAY_MS: 30 * 1000,
    RETRY_FACTOR: 4,
    // How often the queue re-checks whether a retry has come due.
    QUEUE_TICK_MS: 5 * 1000,

    // App self-update
    UPDATE_REPO: 'irelevant25/yt-download-view-tracker',
    UPDATE_CHECK_INTERVAL_MS: 24 * 60 * 60 * 1000,
    LAUNCHED_EXE,

    // Browsers yt-dlp can read cookies from (its --cookies-from-browser names)
    COOKIE_BROWSERS: ['firefox', 'chrome', 'edge', 'brave', 'opera', 'vivaldi', 'chromium', 'whale'],

    // Only these origins may call the local API. The userscript uses
    // GM_xmlhttpRequest, which is not subject to CORS, so this does not affect it.
    ALLOWED_ORIGINS: [
        'https://www.youtube.com',
        'https://youtube.com',
        'https://m.youtube.com',
        'https://music.youtube.com'
    ],

    // Directories
    VIDEOS_DIRECTORY: path.join(BASE_DIR, 'videos'),
    LOGS_DIRECTORY: LOGS_DIR,
    RESOURCES_DIRECTORY: RESOURCES_DIR,

    // Files
    DOWNLOADED_VIDEOS_FILE: path.join(BASE_DIR, 'downloaded_videos.json'),
    QUEUE_FILE: path.join(BASE_DIR, 'download_queue.json'),
    SETTINGS_FILE: path.join(BASE_DIR, 'settings.json'),
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