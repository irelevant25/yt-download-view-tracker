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
const metadata = require('./services/metadata');
const updater = require('./services/updater');
const windowManager = require('./ui/window');
const trayManager = require('./ui/tray');

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
        target: process.execPath,
        // args: '',
        // description: 'My Portable Electron App',
        // icon: path.join(__dirname, 'icon.ico'),
        // iconIndex: 0,
        appUserModelId: CONFIG.APP_ID
    };

    if (fs.existsSync(shortcutPath)) {
        const shortcutItem = shell.readShortcutLink(shortcutPath);

        if (shortcutItem && shortcutItem.appUserModelId === options.appUserModelId) {
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
        ipcMain.on('ui-initialized', () => {
            // Initialize logger with main window
            logger.init(mainWindow);
        });

        // Ensure required directories exist (must run first so logs/ is available)
        await storage.ensureDirectories();

        // Create main window
        const mainWindow = windowManager.createMainWindow();

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

        // Load downloaded videos from metadata
        const videosFromMetadata = await metadata.extractVideoUrlsFromMetadata();

        // Initialize routes with downloaded videos
        apiServer.initializeDownloadedVideos(videosFromMetadata);

        // Start daily yt-dlp update checker
        updater.startUpdateScheduler();

        // Initialize UI downloaded videos list
        logger.updateDownloadVideos(videosFromMetadata);

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

// App ready event
app.on('ready', initializeApp);

// Prevent default quit behavior
app.on('window-all-closed', (event) => {
    // Do nothing, to keep app running in tray
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