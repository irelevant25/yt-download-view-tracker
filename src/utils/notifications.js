/**
 * Notification utilities for the app
 */
const { Notification, app } = require('electron');
const path = require('path');
const CONFIG = require('../config');

/**
 * Show a desktop notification
 * @param {string} title - Notification title
 * @param {string} [body] - Optional notification body
 */
function showNotification(title, body = '') {
    const options = {
        title: title,             // Use passed title directly
        subtitle: CONFIG.APP_NAME, // Add app name as subtitle
        body: body,
        silent: false,
        // icon: CONFIG.ICON_PATH48
    };

    // Create and show the notification
    new Notification(options).show();
}

module.exports = {
    showNotification
};