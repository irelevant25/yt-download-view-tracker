/**
 * Express server for app
 * Handles API setup and requests
 */
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const CONFIG = require('../config');
const logger = require('../utils/logger');
const routes = require('./routes');

// Server instance
let server = null;

/**
 * Start the Express API server
 * @returns {Promise<boolean>} Success indicator
 */
function startServer() {
    return new Promise((resolve) => {
        const app = express();

        // Comprehensive CORS and Private Network Access handling
        app.use((req, res, next) => {
            // Set CORS headers
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            res.setHeader('Access-Control-Allow-Credentials', 'true');

            // Critical: Add Private Network Access header
            res.setHeader('Access-Control-Allow-Private-Network', 'true');

            // Handle preflight
            if (req.method === 'OPTIONS') {
                return res.status(200).end();
            }

            next();
        });

        // Parse JSON and URL-encoded data
        app.use(bodyParser.json({ limit: '50mb' }));
        app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

        // Register routes
        app.use('/', routes.router);

        // Start server
        server = app.listen(CONFIG.PORT, () => {
            logger.success(`API server running on http://localhost:${CONFIG.PORT}`);
            resolve(true);
        });

        server.on('error', (error) => {
            logger.error(`API server error: ${error.message}`);
            resolve(false);
        });
    });
}

/**
 * Stop the Express API server
 */
function stopServer() {
    if (server) {
        server.close();
        logger.info('API server stopped.');
    }
}

module.exports = {
    startServer,
    stopServer,
    initializeDownloadedVideos: routes.initializeDownloadedVideos
};