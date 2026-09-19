/**
 * IPC surface for the app window.
 *
 * Everything the renderer can ask for or act on is registered here, in one
 * place, so the set of things the UI can reach stays easy to audit.
 */
const { ipcMain, app, shell, dialog } = require('electron');
const CONFIG = require('../config');
const logger = require('../utils/logger');
const queue = require('../services/queue');
const library = require('../services/library');
const tracker = require('../services/tracker');
const stats = require('../services/stats');
const downloader = require('../services/downloader');
const settings = require('../services/settings');
const appUpdater = require('../services/appUpdater');

// Parsed watch history, kept in memory so searching 11k rows is instant.
let records = [];
let getDownloadedVideos = () => [];

/**
 * Re-read YouTubeWatchTracker.json and re-join it with downloaded state.
 * @returns {Promise<number>} Record count
 */
async function refreshRecords() {
    records = await tracker.load(getDownloadedVideos());
    return records.length;
}

/**
 * Send a message to the window, if there is one.
 * @param {BrowserWindow|null} window
 * @param {string} channel
 * @param {*} payload
 */
function send(window, channel, payload) {
    if (!window || window.isDestroyed() || !window.webContents) return;
    window.webContents.send(channel, payload);
}

/**
 * Register every handler and start pushing live updates at the window.
 *
 * @param {Object} options
 * @param {function} options.getWindow - Returns the current BrowserWindow
 * @param {function} options.getDownloadedVideos - Returns the downloaded URL list
 */
function register({ getWindow, getDownloadedVideos: downloadedGetter }) {
    getDownloadedVideos = downloadedGetter || (() => []);

    ipcMain.handle('get-app-version', () => app.getVersion());

    ipcMain.handle('get-queue', () => queue.status());

    ipcMain.handle('retry-failed', () => queue.retryFailed());

    ipcMain.handle('remove-queued', (_event, videoId) => queue.remove(videoId));

    ipcMain.handle('requeue-video', (_event, videoId) => {
        if (!downloader.VIDEO_ID_PATTERN.test(String(videoId ?? ''))) return false;
        const result = queue.enqueue(`https://www.youtube.com/watch?v=${videoId}`);
        return result.queued;
    });

    ipcMain.handle('get-storage-stats', () => stats.getStorageStats());

    ipcMain.handle('get-library-summary', async () => {
        if (records.length === 0) await refreshRecords();
        return tracker.summarise(records);
    });

    ipcMain.handle('query-library', async (_event, options) => {
        if (records.length === 0) await refreshRecords();
        return tracker.query(records, options || {});
    });

    ipcMain.handle('refresh-library', async () => {
        const count = await refreshRecords();
        return { records: count, summary: tracker.summarise(records) };
    });

    ipcMain.handle('inspect-library', () => library.inspect());

    ipcMain.handle('repair-library', async (_event, options) => {
        logger.info('Library repair requested from the UI.');
        const result = await library.repair(options || {});
        await refreshRecords();
        return result;
    });

    ipcMain.handle('open-videos-folder', async () => {
        const error = await shell.openPath(CONFIG.VIDEOS_DIRECTORY);
        return error === '';
    });

    ipcMain.handle('open-logs-folder', async () => {
        const error = await shell.openPath(CONFIG.LOGS_DIRECTORY);
        return error === '';
    });

    // ── settings ───────────────────────────────────────────────────────────

    ipcMain.handle('get-settings', () => ({
        settings: settings.get(),
        browsers: CONFIG.COOKIE_BROWSERS
    }));

    ipcMain.handle('save-settings', (_event, next) => {
        const result = settings.save(next);
        if (result.settings.updates.autoCheck) appUpdater.startScheduler();
        else appUpdater.stopScheduler();
        return result;
    });

    // The file picker runs in the main process, so the renderer never has to
    // invent a path itself.
    ipcMain.handle('choose-cookies-file', async () => {
        const result = await dialog.showOpenDialog(getWindow(), {
            title: 'Choose a cookies.txt file',
            properties: ['openFile'],
            filters: [
                { name: 'Cookies file', extensions: ['txt'] },
                { name: 'All files', extensions: ['*'] }
            ]
        });
        return result.canceled ? null : result.filePaths[0];
    });

    // ── app updates ────────────────────────────────────────────────────────

    ipcMain.handle('get-update-status', () => appUpdater.getStatus());
    ipcMain.handle('check-for-update', () => appUpdater.check());
    ipcMain.handle('download-update', () => appUpdater.download());
    ipcMain.handle('install-update', () => appUpdater.apply());
    ipcMain.handle('open-release-page', async () => {
        const { releaseUrl } = appUpdater.getStatus();
        if (releaseUrl && releaseUrl.startsWith('https://github.com/')) {
            await shell.openExternal(releaseUrl);
            return true;
        }
        return false;
    });

    // ── live pushes ────────────────────────────────────────────────────────

    appUpdater.events.on('status', (status) => {
        send(getWindow(), 'update-status', status);
    });

    downloader.events.on('progress', (progress) => {
        send(getWindow(), 'download-progress', progress);
    });

    const pushQueue = () => send(getWindow(), 'queue-changed', queue.status());
    downloader.events.on('state', pushQueue);
    queue.events.on('change', pushQueue);
}

module.exports = {
    register,
    refreshRecords
};
