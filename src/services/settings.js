/**
 * User settings for app
 *
 * Stored in settings.json next to the exe. Everything read from disk or
 * received from the window goes through normalise(), so a hand-edited or
 * corrupt file degrades to defaults instead of breaking downloads.
 */
const fs = require('fs');
const CONFIG = require('../config');
const logger = require('../utils/logger');

const DEFAULTS = Object.freeze({
    cookies: {
        // none | browser | file
        mode: 'none',
        browser: 'firefox',
        // Optional browser profile name or path; empty means the default profile.
        profile: '',
        // Path to a Netscape-format cookies.txt when mode is 'file'.
        file: ''
    },
    updates: {
        // Check GitHub for a newer release at startup and once a day.
        autoCheck: true
    }
});

let current = structuredClone(DEFAULTS);

/**
 * Coerce anything into a valid settings object.
 * @param {*} input
 * @returns {Object}
 */
function normalise(input) {
    const cookiesIn = input?.cookies ?? {};
    const updatesIn = input?.updates ?? {};

    const mode = ['none', 'browser', 'file'].includes(cookiesIn.mode) ? cookiesIn.mode : DEFAULTS.cookies.mode;
    const browser = CONFIG.COOKIE_BROWSERS.includes(cookiesIn.browser) ? cookiesIn.browser : DEFAULTS.cookies.browser;

    // yt-dlp parses BROWSER[:PROFILE][::CONTAINER]; a '::' inside the profile
    // would be read as a container separator.
    const profile = typeof cookiesIn.profile === 'string' && !cookiesIn.profile.includes('::')
        ? cookiesIn.profile.trim().slice(0, 512)
        : '';

    const file = typeof cookiesIn.file === 'string' ? cookiesIn.file.trim().slice(0, 1024) : '';

    return {
        cookies: { mode, browser, profile, file },
        updates: { autoCheck: updatesIn.autoCheck !== false }
    };
}

/**
 * Load settings from disk. Missing or unreadable files yield defaults.
 * @returns {Object}
 */
function load() {
    try {
        const raw = fs.readFileSync(CONFIG.SETTINGS_FILE, 'utf-8');
        current = normalise(JSON.parse(raw));
    } catch (error) {
        if (error.code !== 'ENOENT') {
            logger.error(`Could not read settings, using defaults: ${error.message}`);
        }
        current = structuredClone(DEFAULTS);
    }
    return get();
}

/**
 * @returns {Object} A copy of the current settings
 */
function get() {
    return structuredClone(current);
}

/**
 * Validate, apply and persist new settings.
 * @param {Object} next
 * @returns {{settings: Object, warnings: string[]}}
 */
function save(next) {
    const settings = normalise(next);
    const warnings = [];

    if (settings.cookies.mode === 'file') {
        if (!settings.cookies.file) {
            warnings.push('No cookies file chosen — downloads will run without cookies.');
        } else if (!fs.existsSync(settings.cookies.file)) {
            warnings.push('The cookies file does not exist.');
        }
    }

    current = settings;

    try {
        fs.writeFileSync(CONFIG.SETTINGS_FILE, JSON.stringify(settings, null, 2));
        logger.info('Settings saved.');
    } catch (error) {
        logger.error(`Could not save settings: ${error.message}`);
        warnings.push(`Settings could not be written to disk: ${error.message}`);
    }

    return { settings: get(), warnings };
}

/**
 * yt-dlp arguments for the configured cookie source.
 * Empty when cookies are off, or when a file is configured but missing —
 * a missing file makes yt-dlp fail outright, which is worse than no cookies.
 * @returns {string[]}
 */
function cookieArgs() {
    const { mode, browser, profile, file } = current.cookies;

    if (mode === 'browser') {
        return ['--cookies-from-browser', profile ? `${browser}:${profile}` : browser];
    }

    if (mode === 'file' && file && fs.existsSync(file)) {
        return ['--cookies', file];
    }

    return [];
}

module.exports = {
    DEFAULTS,
    load,
    get,
    save,
    normalise,
    cookieArgs
};
