/**
 * Window management for app
 * Handles Electron window creation and lifecycle
 */
const { BrowserWindow } = require('electron');
const path = require('path');
const CONFIG = require('../config');

// Track if app is quitting (to handle window close events)
let isQuiting = false;
let mainWindow = null;

/**
 * Create the main application window
 * @returns {BrowserWindow} The created window
 */
function createMainWindow() {
    // Create the browser window - use ICO for Windows
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 700,
        show: false, // Start hidden
        webPreferences: {
            // The renderer gets no Node access. Everything it may call is
            // enumerated in preload.js and registered in ui/ipc.js.
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: CONFIG.ICON_ICO_PATH256,
        title: CONFIG.APP_NAME
    });

    // Load the index.html file
    mainWindow.loadFile(path.join(__dirname, '../../index.html'));

    // Prevent closing, hide instead
    mainWindow.on('close', (event) => {
        if (!isQuiting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    return mainWindow;
}

/**
 * Toggle window visibility
 */
function toggleWindow() {
    if (!mainWindow) return;

    if (mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        mainWindow.show();
    }
}

/**
 * Set app quitting state
 * @param {boolean} quitting - Whether app is quitting
 */
function setQuittingState(quitting) {
    isQuiting = quitting;
}

/**
 * Get the main window
 * @returns {BrowserWindow|null} The main window
 */
function getMainWindow() {
    return mainWindow;
}

module.exports = {
    createMainWindow,
    toggleWindow,
    setQuittingState,
    getMainWindow
};