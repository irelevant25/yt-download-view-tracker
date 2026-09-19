/**
 * Protocol service for app
 * Handles custom protocol registration (CONFIG.APP_ID://)
 */
const { app } = require('electron');
const path = require('path');
const CONFIG = require('../config');
const logger = require('../utils/logger');

/**
 * Register the custom protocol handler
 * @returns {Promise<boolean>} Success indicator
 */
function registerProtocolHandler() {
    // Only register on Windows
    if (process.platform !== 'win32') {
        logger.info('Protocol registration not needed (non-Windows platform).');
        return Promise.resolve();
    }

    // In dev the running exe is node_modules' bare electron.exe, which opens an
    // empty window when launched without the app path. Registering that
    // hijacked the handler away from the real install until it next started.
    if (!app.isPackaged) {
        logger.info('Protocol registration skipped in development.');
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const exePath = app.isPackaged ? CONFIG.LAUNCHED_EXE : path.resolve(process.execPath);
        // logger.info(JSON.stringify(process.env)); // debuging purpose

        const isExists = app.isDefaultProtocolClient(CONFIG.APP_ID, exePath);
        if (isExists) {
            logger.info('Protocol already registered.');
            resolve();
        }
        else {
            logger.info('Protocol not registered.');
            logger.info('Registering protocol...');

            const isSuccess = app.setAsDefaultProtocolClient(CONFIG.APP_ID, exePath);
            if (isSuccess) {
                logger.info('Protocol registered successfully.');
            }
            else {
                logger.error('Protocol registration failed.');
            }
            resolve();
        }
    });
}

module.exports = {
    registerProtocolHandler
};