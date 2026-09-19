/**
 * App self-updater
 *
 * electron-updater does not support the portable target, so this does it by
 * hand:
 *
 *   1. check()    — ask GitHub for the latest release and compare versions
 *   2. download() — fetch YouTube-Checker-<version>.exe next to the running
 *                   exe and verify its sha256 against the digest GitHub
 *                   publishes for the asset
 *   3. apply()    — launch the new exe and quit. The new instance waits for
 *                   this process to exit, takes over, and deletes the old exe.
 *
 * The running exe is never overwritten: Windows will not let a running exe be
 * replaced, and a versioned filename keeps each copy honest about what it is.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { app } = require('electron');
const CONFIG = require('../config');
const logger = require('../utils/logger');

const MAX_REDIRECTS = 5;

/** Emits 'status' with the current state whenever it changes. */
const events = new EventEmitter();

let status = {
    state: 'idle',          // idle | checking | available | up-to-date | downloading | ready | error
    current: null,
    latest: null,
    percent: 0,
    error: '',
    releaseUrl: '',
    downloadedPath: '',
    checkedAt: 0
};
let latestInfo = null;
let timer = null;

function setStatus(patch) {
    status = { ...status, ...patch };
    events.emit('status', getStatus());
}

/**
 * @returns {Object} A copy of the updater state
 */
function getStatus() {
    return { ...status, canInstall: canApply() };
}

/**
 * Compare two x.y.z versions.
 * @param {string} a
 * @param {string} b
 * @returns {number} >0 if a is newer, <0 if b is newer, 0 if equal
 */
function compareVersions(a, b) {
    const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

/**
 * Only a packaged portable build can replace itself. In dev there is no exe
 * of ours to swap, so checking works but installing does not.
 * @returns {boolean}
 */
function canApply() {
    return app.isPackaged && Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'youtube-checker-app', Accept: 'application/vnd.github+json' } }, (res) => {
            let data = '';
            res.on('data', chunk => (data += chunk));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (res.statusCode !== 200) {
                        reject(new Error(`GitHub API: ${parsed.message || `HTTP ${res.statusCode}`}`));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    reject(new Error(`GitHub API returned unreadable data: ${e.message}`));
                }
            });
        }).on('error', reject);
    });
}

/**
 * Ask GitHub whether a newer release exists.
 * @returns {Promise<Object>} The updater status after checking
 */
async function check() {
    const current = app.getVersion();
    setStatus({ state: 'checking', current, error: '' });

    try {
        const release = await fetchJson(`https://api.github.com/repos/${CONFIG.UPDATE_REPO}/releases/latest`);
        const latest = String(release.tag_name || '').replace(/^v/, '');

        // Match the exact asset name. Releases have been known to carry stray
        // assets from older naming schemes, so "any .exe" is not good enough.
        const expectedName = `YouTube-Checker-${latest}.exe`;
        const asset = (release.assets || []).find(a => a.name === expectedName);

        latestInfo = asset ? {
            version: latest,
            name: asset.name,
            size: asset.size,
            url: asset.browser_download_url,
            digest: asset.digest || ''
        } : null;

        if (compareVersions(latest, current) <= 0) {
            logger.info(`App is up to date (v${current}).`);
            setStatus({ state: 'up-to-date', latest, releaseUrl: release.html_url, checkedAt: Date.now() });
        } else if (!asset) {
            logger.error(`Release v${latest} has no ${expectedName} asset — cannot update.`);
            setStatus({ state: 'error', latest, releaseUrl: release.html_url, error: `Release v${latest} has no ${expectedName}.`, checkedAt: Date.now() });
        } else {
            logger.success(`App update available: v${current} → v${latest}`);
            logger.activityLog('APP_UPDATE', `available v${current} -> v${latest}`);
            setStatus({ state: 'available', latest, releaseUrl: release.html_url, checkedAt: Date.now() });
        }
    } catch (error) {
        logger.error(`App update check failed: ${error.message}`);
        setStatus({ state: 'error', error: error.message, checkedAt: Date.now() });
    }

    return getStatus();
}

/**
 * Stream a URL to a file while hashing it. Follows a bounded number of
 * redirects; GitHub serves assets from a separate CDN host.
 * @returns {Promise<string>} Hex sha256 of what was written
 */
function downloadTo(url, destPath, expectedSize) {
    return new Promise((resolve, reject) => {
        const attempt = (target, redirectsLeft) => {
            https.get(target, { headers: { 'User-Agent': 'youtube-checker-app' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
                    return attempt(res.headers.location, redirectsLeft - 1);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
                }

                const hash = crypto.createHash('sha256');
                const file = fs.createWriteStream(destPath);
                const total = Number(res.headers['content-length']) || expectedSize || 0;
                let received = 0;
                let lastReported = -1;

                res.on('data', (chunk) => {
                    hash.update(chunk);
                    received += chunk.length;
                    const percent = total ? Math.floor((received / total) * 100) : 0;
                    if (percent !== lastReported) {
                        lastReported = percent;
                        setStatus({ percent });
                    }
                });

                res.pipe(file);
                file.on('finish', () => file.close(() => resolve(hash.digest('hex'))));
                file.on('error', reject);
                res.on('error', reject);
            }).on('error', reject);
        };

        attempt(url, MAX_REDIRECTS);
    });
}

/**
 * Download the available update next to the running exe and verify it.
 * @returns {Promise<Object>} The updater status afterwards
 */
async function download() {
    if (!latestInfo || status.state !== 'available') {
        return getStatus();
    }

    // Without a published digest there is nothing to verify against, and an
    // unverified exe is not something to launch automatically.
    const expected = /^sha256:([0-9a-f]{64})$/i.exec(latestInfo.digest);
    if (!expected) {
        setStatus({ state: 'error', error: 'The release does not publish a sha256 digest for its exe, so it cannot be verified.' });
        return getStatus();
    }

    const directory = path.dirname(CONFIG.LAUNCHED_EXE);
    const finalPath = path.join(directory, latestInfo.name);
    const partialPath = `${finalPath}.download`;

    if (path.resolve(finalPath).toLowerCase() === path.resolve(CONFIG.LAUNCHED_EXE).toLowerCase()) {
        setStatus({ state: 'error', error: 'The update has the same filename as the running exe.' });
        return getStatus();
    }

    setStatus({ state: 'downloading', percent: 0, error: '' });
    logger.info(`Downloading ${latestInfo.name} (${Math.round(latestInfo.size / 1048576)} MB)...`);

    try {
        const actual = await downloadTo(latestInfo.url, partialPath, latestInfo.size);

        if (actual.toLowerCase() !== expected[1].toLowerCase()) {
            fs.rmSync(partialPath, { force: true });
            throw new Error(`Checksum mismatch — expected ${expected[1].slice(0, 12)}…, got ${actual.slice(0, 12)}…. The download was discarded.`);
        }

        fs.rmSync(finalPath, { force: true });
        fs.renameSync(partialPath, finalPath);

        logger.success(`Update downloaded and verified: ${finalPath}`);
        logger.activityLog('APP_UPDATE', `downloaded v${latestInfo.version} sha256 ok`);
        setStatus({ state: 'ready', percent: 100, downloadedPath: finalPath });
    } catch (error) {
        fs.rmSync(partialPath, { force: true });
        logger.error(`Update download failed: ${error.message}`);
        setStatus({ state: 'error', error: error.message });
    }

    return getStatus();
}

/**
 * Launch the downloaded exe and quit.
 *
 * The new instance is told which process to wait for — so it does not collide
 * with this one on the single-instance lock or port 5000 — and which exe it
 * replaced, so it can delete it once this one has fully exited.
 *
 * @returns {boolean} Whether the handover started
 */
function apply() {
    if (!canApply()) {
        setStatus({ state: 'error', error: 'Updates can only be installed from the packaged app.' });
        return false;
    }
    if (status.state !== 'ready' || !fs.existsSync(status.downloadedPath)) {
        setStatus({ state: 'error', error: 'No verified update is ready to install.' });
        return false;
    }

    logger.info(`Handing over to ${path.basename(status.downloadedPath)}...`);
    logger.activityLog('APP_UPDATE', `installing ${path.basename(status.downloadedPath)}`);

    const child = spawn(status.downloadedPath, [
        `--wait-for-pid=${process.pid}`,
        `--replaced-exe=${CONFIG.LAUNCHED_EXE}`
    ], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
    });
    child.unref();

    // Give the spawn a moment to take hold, then leave.
    setTimeout(() => app.quit(), 500);
    return true;
}

/**
 * Check now and then once a day.
 */
function startScheduler() {
    setTimeout(check, 15 * 1000);
    if (!timer) {
        timer = setInterval(check, CONFIG.UPDATE_CHECK_INTERVAL_MS);
        if (timer.unref) timer.unref();
    }
}

function stopScheduler() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

module.exports = {
    events,
    check,
    download,
    apply,
    getStatus,
    canApply,
    compareVersions,
    startScheduler,
    stopScheduler
};
