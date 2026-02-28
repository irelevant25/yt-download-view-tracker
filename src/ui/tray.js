/**
 * Tray service for app
 * Handles system tray integration
 */
const { Tray, Menu } = require('electron');
const CONFIG = require('../config');
const windowManager = require('./window');

let tray = null;

/**
 * Create the application system tray
 * @returns {Tray} The system tray instance
 */
function createTray() {
    tray = new Tray(CONFIG.ICON_PATH48);

    // Create context menu
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show/Hide',
            click: () => windowManager.toggleWindow()
        },
        {
            label: 'Open DevTools',
            click: () => {
                const mainWindow = windowManager.getMainWindow();
                if (mainWindow) {
                    mainWindow.webContents.openDevTools();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Exit',
            click: () => {
                windowManager.setQuittingState(true);
                require('electron').app.quit();
            }
        }
    ]);

    // Configure tray
    tray.setToolTip(CONFIG.APP_NAME);
    tray.setContextMenu(contextMenu);

    // Handle double-click
    tray.on('double-click', () => windowManager.toggleWindow());

    return tray;
}

/**
 * Get the tray instance
 * @returns {Tray|null} The tray instance
 */
function getTray() {
    return tray;
}

module.exports = {
    createTray,
    getTray
};