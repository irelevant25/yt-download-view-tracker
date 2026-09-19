/**
 * Update handover for app
 *
 * The receiving side of appUpdater.apply(). A freshly launched new version
 * gets two arguments:
 *
 *   --wait-for-pid=<pid>   the old instance; wait for it to exit before taking
 *                          the single-instance lock and port 5000
 *   --replaced-exe=<path>  the old exe; delete it once nothing holds it open
 *
 * The exe can also be started by the youtube-checker:// protocol handler with
 * an arbitrary URL as its argument, so neither value is trusted blindly.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const CONFIG = require('../config');
const logger = require('../utils/logger');

/** Only ever delete something that looks like one of our own exes. */
const OUR_EXE_NAME = /^YouTube[-. ]Checker[-. \w]*\.exe$/i;

/**
 * Read our flags from argv. A flag must be a whole argument that starts with
 * the exact prefix — a protocol URL starts with its scheme, so it cannot
 * smuggle one in.
 * @param {string[]} argv
 * @returns {{waitForPid: number|null, replacedExe: string|null}}
 */
function parseLaunchArgs(argv) {
    let waitForPid = null;
    let replacedExe = null;

    for (const arg of argv) {
        if (typeof arg !== 'string') continue;

        if (arg.startsWith('--wait-for-pid=')) {
            const pid = Number(arg.slice('--wait-for-pid='.length));
            if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) waitForPid = pid;
        } else if (arg.startsWith('--replaced-exe=')) {
            const value = arg.slice('--replaced-exe='.length);
            if (value) replacedExe = value;
        }
    }

    return { waitForPid, replacedExe };
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function isRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM means it exists but belongs to someone else — still running.
        return error.code === 'EPERM';
    }
}

/**
 * Wait until a process has exited, or give up after the timeout.
 * @param {number} pid
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} Whether it exited in time
 */
async function waitForExit(pid, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isRunning(pid)) return true;
        await new Promise(r => setTimeout(r, 250));
    }
    return !isRunning(pid);
}

/**
 * Decide whether a path is safe to delete as "the exe we replaced".
 * @param {string} candidate
 * @returns {string|null} Why not, or null if it is safe
 */
function refuseReason(candidate) {
    if (!app.isPackaged) return 'not a packaged build';
    if (!path.isAbsolute(candidate)) return 'path is not absolute';

    const target = path.resolve(candidate);
    const self = path.resolve(CONFIG.LAUNCHED_EXE);

    if (target.toLowerCase() === self.toLowerCase()) return 'that is the running exe';
    if (path.dirname(target).toLowerCase() !== path.dirname(self).toLowerCase()) return 'not in the same folder as this exe';
    if (!OUR_EXE_NAME.test(path.basename(target))) return 'does not look like a YouTube Checker exe';

    return null;
}

/**
 * Delete the exe this version replaced. The old portable wrapper holds its
 * file open until it has cleaned up its temp folder, so retry for a while.
 * @param {string} candidate
 * @returns {Promise<boolean>}
 */
async function removeReplacedExe(candidate) {
    const reason = refuseReason(candidate);
    if (reason) {
        logger.error(`Not deleting replaced exe "${candidate}": ${reason}.`);
        return false;
    }

    if (!fs.existsSync(candidate)) return true;

    for (let attempt = 1; attempt <= 30; attempt++) {
        try {
            fs.rmSync(candidate);
            logger.success(`Removed previous version: ${path.basename(candidate)}`);
            logger.activityLog('APP_UPDATE', `removed ${path.basename(candidate)}`);
            return true;
        } catch (error) {
            if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
                logger.error(`Could not remove ${candidate}: ${error.message}`);
                return false;
            }
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    logger.error(`Gave up removing ${path.basename(candidate)} — it is still in use. Delete it by hand.`);
    return false;
}

module.exports = {
    parseLaunchArgs,
    waitForExit,
    removeReplacedExe,
    refuseReason,
    OUR_EXE_NAME
};
