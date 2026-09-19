/**
 * App Main Application Entry Point
 * An Electron application for downloading and tracking YouTube videos
 */
const { app, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Import core services
const CONFIG = require('./config');
const logger = require('./utils/logger');
const notifications = require('./utils/notifications');
const apiServer = require('./api/server');
const protocol = require('./services/protocol');
const storage = require('./services/storage');
const library = require('./services/library');
const queue = require('./services/queue');
const ipc = require('./ui/ipc');
const updater = require('./services/updater');
const settings = require('./services/settings');
const appUpdater = require('./services/appUpdater');
const handover = require('./services/handover');
const windowManager = require('./ui/window');
const trayManager = require('./ui/tray');

// Downloaded URLs, shared with the IPC layer by reference so the library
// panel always sees the current list.
let downloadedVideosRef = [];

// Set when this instance was launched by a self-update of an older one.
const launchArgs = handover.parseLaunchArgs(process.argv);

/**
 * Set app user model ID - MUST be called before app ready
 */
app.setAppUserModelId('com.yourdomain.youtubechecker');

/**
 * Create Start Menu shortcut
 * @returns {void}
 */
function createShortcut() {
    if (process.platform !== 'win32') return;

    // Same reasoning as the protocol handler: a dev run would point the Start
    // Menu entry at bare electron.exe.
    if (!app.isPackaged) return;

    // Define the Start Menu shortcut path.
    const shortcutPath = path.join(
        process.env.APPDATA,
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        `${CONFIG.APP_NAME}.lnk`
    );

    // Define shortcut options including target, icon, and AppUserModelId.
    const options = {
        // The exe the user launched, not process.execPath — in a portable
        // build that is a temp copy deleted on exit, which left the shortcut
        // pointing at nothing.
        target: CONFIG.LAUNCHED_EXE,
        // args: '',
        // description: 'My Portable Electron App',
        // icon: path.join(__dirname, 'icon.ico'),
        // iconIndex: 0,
        appUserModelId: CONFIG.APP_ID
    };

    if (fs.existsSync(shortcutPath)) {
        const shortcutItem = shell.readShortcutLink(shortcutPath);

        if (shortcutItem
            && shortcutItem.appUserModelId === options.appUserModelId
            && shortcutItem.target === options.target) {
            logger.info(`Shortcut already exists: ${shortcutPath}`);
            return;
        }
    }

    const result = shell.writeShortcutLink(shortcutPath, options);
    logger.success(`Shortcut created: ${result}`);
}

/**
 * Initialize the application
 * Called when Electron is ready
 */
async function initializeApp() {
    app.setAppUserModelId(CONFIG.APP_ID);
    createShortcut();

    logger.success('Initializing application...');
    try {
        // Ensure required directories exist (must run first so logs/ is available)
        await storage.ensureDirectories();

        // Cookie source and update preferences
        settings.load();

        // Create main window
        const mainWindow = windowManager.createMainWindow();

        // Registered after mainWindow exists. This used to close over the
        // const before its declaration and only worked because the renderer's
        // message always arrived later.
        ipcMain.on('ui-initialized', () => {
            logger.init(mainWindow);
        });

        // Everything the window can ask for lives in ui/ipc.js. Registered
        // before the renderer loads so its first requests cannot race us.
        ipc.register({
            getWindow: windowManager.getMainWindow,
            getDownloadedVideos: () => downloadedVideosRef
        });

        logger.info('Application starting...');

        // Create system tray
        trayManager.createTray();

        // Register protocol handler (Windows only)
        await protocol.registerProtocolHandler();

        // Start API server
        const serverStarted = await apiServer.startServer();
        if (!serverStarted) {
            logger.error('Failed to start API server!');
            notifications.showNotification('Error', 'Failed to start API server.');
            return;
        }

        // Reconcile videos/ against downloaded_videos.json
        const downloadedVideos = await library.loadDownloadedVideos();
        downloadedVideosRef = downloadedVideos;

        // Initialize routes with downloaded videos
        apiServer.initializeDownloadedVideos(downloadedVideos);

        // Resume anything left in the download queue from a previous run
        await queue.start({
            onDownloaded: async (url) => {
                await apiServer.recordDownloaded(url);
                if (!downloadedVideosRef.includes(url)) downloadedVideosRef.push(url);
                await ipc.refreshRecords();
            }
        });

        // Parse the watch history once so the library panel opens instantly
        await ipc.refreshRecords();

        // Start daily yt-dlp update checker
        updater.startUpdateScheduler();

        // Check GitHub for a newer version of the app itself. The app lives in
        // the tray, so say so with a notification rather than only in a window
        // nobody may have open.
        let notifiedVersion = null;
        appUpdater.events.on('status', (status) => {
            if (status.state === 'available' && status.latest !== notifiedVersion) {
                notifiedVersion = status.latest;
                notifications.showNotification(
                    `Update available: v${status.latest}`,
                    'Open YouTube Checker → Settings to install it.'
                );
            }
        });

        if (settings.get().updates.autoCheck) {
            appUpdater.startScheduler();
        }

        // If a self-update launched us, the old exe can go once it lets go
        if (launchArgs.replacedExe) {
            handover.removeReplacedExe(launchArgs.replacedExe);
        }

        // Initialize UI downloaded videos list
        logger.updateDownloadVideos(downloadedVideos);

        // Show notification
        notifications.showNotification(
            CONFIG.APP_NAME + ' is running',
            'The app is running in the system tray.'
        );

        logger.success('Application successfully initialized!');
    } catch (error) {
        logger.error(`Initialization error: ${error.message}`);
        notifications.showNotification('Error', 'Failed to initialize application.');
    }
}

// ----- ELECTRON APP LIFECYCLE EVENTS -----

/**
 * Only one instance may run: two would fight over port 5000 and both put an
 * icon in the tray. A second launch — a double-click, or the userscript's
 * "Run" button — just brings the existing window forward.
 *
 * A self-update launches the new version while the old one is still quitting,
 * so it is told to wait for the old process before claiming the lock.
 *
 * @returns {Promise<boolean>} Whether this instance should carry on
 */
async function claimInstance() {
    if (launchArgs.waitForPid) {
        const exited = await handover.waitForExit(launchArgs.waitForPid, 30000);
        if (!exited) {
            logger.error(`Previous instance (pid ${launchArgs.waitForPid}) did not exit in time.`);
        }
    }

    if (!app.requestSingleInstanceLock()) {
        app.quit();
        return false;
    }

    app.on('second-instance', () => {
        const window = windowManager.getMainWindow();
        if (!window) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
    });

    return true;
}

// App ready event
app.on('ready', async () => {
    if (await claimInstance()) {
        initializeApp();
    }
});

// Prevent default quit behavior
app.on('window-all-closed', (event) => {
    // Do nothing, to keep app running in tray
});

// Release the API port on the way out instead of holding it during a slow quit
app.on('before-quit', () => {
    windowManager.setQuittingState(true);
    queue.stop();
    appUpdater.stopScheduler();
    apiServer.stopServer();
});

// Activate event (macOS)
app.on('activate', () => {
    // On macOS re-create window when dock icon is clicked
    if (!windowManager.getMainWindow()) {
        windowManager.createMainWindow();
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error.message}`);
    logger.error(error.stack);
});