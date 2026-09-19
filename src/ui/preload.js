/**
 * Preload bridge for the app window.
 *
 * The renderer used to run with nodeIntegration and no context isolation,
 * which meant anything that reached the page — a log line, a video title —
 * was one innerHTML away from full Node access. The window now runs isolated
 * and reaches the main process only through the calls named here.
 *
 * Every method maps to exactly one channel registered in ui/ipc.js. There is
 * deliberately no generic invoke(): the surface is the list below.
 *
 * Exposed as window.ytChecker rather than window.api because contextBridge
 * defines it as a non-configurable global, which collides with a top-level
 * `const api` in the renderer and stops that script parsing entirely.
 */
const { contextBridge, ipcRenderer } = require('electron');

/**
 * Wrap a push channel so the renderer never sees the IpcRendererEvent.
 * @param {string} channel
 * @returns {function(function): void}
 */
const listener = (channel) => (handler) => {
    ipcRenderer.on(channel, (_event, ...args) => handler(...args));
};

contextBridge.exposeInMainWorld('ytChecker', {
    ready: () => ipcRenderer.send('ui-initialized'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),

    queue: {
        get: () => ipcRenderer.invoke('get-queue'),
        retryFailed: () => ipcRenderer.invoke('retry-failed'),
        remove: (videoId) => ipcRenderer.invoke('remove-queued', videoId),
        requeue: (videoId) => ipcRenderer.invoke('requeue-video', videoId)
    },

    library: {
        summary: () => ipcRenderer.invoke('get-library-summary'),
        query: (options) => ipcRenderer.invoke('query-library', options),
        refresh: () => ipcRenderer.invoke('refresh-library'),
        inspect: () => ipcRenderer.invoke('inspect-library'),
        repair: (options) => ipcRenderer.invoke('repair-library', options)
    },

    storage: {
        stats: () => ipcRenderer.invoke('get-storage-stats'),
        openVideosFolder: () => ipcRenderer.invoke('open-videos-folder'),
        openLogsFolder: () => ipcRenderer.invoke('open-logs-folder')
    },

    settings: {
        get: () => ipcRenderer.invoke('get-settings'),
        save: (settings) => ipcRenderer.invoke('save-settings', settings),
        chooseCookiesFile: () => ipcRenderer.invoke('choose-cookies-file')
    },

    updates: {
        status: () => ipcRenderer.invoke('get-update-status'),
        check: () => ipcRenderer.invoke('check-for-update'),
        download: () => ipcRenderer.invoke('download-update'),
        install: () => ipcRenderer.invoke('install-update'),
        openReleasePage: () => ipcRenderer.invoke('open-release-page')
    },

    onLog: listener('log'),
    onDownloadCompleted: listener('download-completed'),
    onQueueChanged: listener('queue-changed'),
    onDownloadProgress: listener('download-progress'),
    onUpdateStatus: listener('update-status')
});
