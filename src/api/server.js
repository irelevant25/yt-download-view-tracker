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

        // CORS: allowlist only. This previously reflected whatever Origin the
        // caller sent, with credentials enabled, which let any page the user
        // visited drive the API. The userscript talks to us through
        // GM_xmlhttpRequest, which ignores CORS entirely, so it is unaffected.
        app.use((req, res, next) => {
            const origin = req.headers.origin;

            if (origin) {
                if (!CONFIG.ALLOWED_ORIGINS.includes(origin)) {
                    logger.error(`Blocked cross-origin request from: ${origin}`);
                    return res.status(403).json({ error: 'Origin not allowed' });
                }
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Vary', 'Origin');
            }

            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('Access-Control-Allow-Private-Network', 'true');

            if (req.method === 'OPTIONS') {
                return res.status(204).end();
            }

            next();
        });

        // Parse JSON and URL-encoded data
        app.use(bodyParser.json({ limit: '50mb' }));
        app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

        // Register routes
        app.use('/', routes.router);

        // Bind to loopback only — this API has no business being reachable
        // from the local network.
        server = app.listen(CONFIG.PORT, '127.0.0.1', () => {
            logger.success(`API server running on http://127.0.0.1:${CONFIG.PORT}`);
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