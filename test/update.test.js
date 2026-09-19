/**
 * Settings normalisation, cookie arguments, version comparison, and the
 * safety rules that decide whether the update handover may delete a file.
 */
const Module = require('module');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Pretend to be a packaged portable build living in a temp folder, so the
// handover rules run exactly as they would in production.
const FAKE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-checker-update-test-'));
const FAKE_EXE = path.join(FAKE_DIR, 'YouTube-Checker-2.0.2.exe');
process.env.PORTABLE_EXECUTABLE_FILE = FAKE_EXE;
process.env.PORTABLE_EXECUTABLE_DIR = FAKE_DIR;
// Only Electron sets this; config.js reads it for a packaged build.
process.resourcesPath = FAKE_DIR;

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: { isPackaged: true, getVersion: () => '2.0.2' },
            Notification: class { show() {} },
            ipcMain: { on() {}, handle() {} }
        };
    }
    return origLoad(request, parent, isMain);
};

const CONFIG = require('../src/config');
CONFIG.SETTINGS_FILE = path.join(FAKE_DIR, 'settings.json');

const settings = require('../src/services/settings');
const appUpdater = require('../src/services/appUpdater');
const handover = require('../src/services/handover');

const results = [];
const check = (name, got, want) => results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

// ── settings ─────────────────────────────────────────────────────────────

check('defaults when nothing on disk', settings.load().cookies.mode, 'none');
check('no cookie args by default', settings.cookieArgs(), []);

settings.save({ cookies: { mode: 'browser', browser: 'firefox', profile: '' } });
check('browser mode -> --cookies-from-browser', settings.cookieArgs(), ['--cookies-from-browser', 'firefox']);

settings.save({ cookies: { mode: 'browser', browser: 'edge', profile: 'Profile 2' } });
check('browser + profile', settings.cookieArgs(), ['--cookies-from-browser', 'edge:Profile 2']);

settings.save({ cookies: { mode: 'browser', browser: 'netscape-navigator' } });
check('unknown browser falls back to firefox', settings.get().cookies.browser, 'firefox');

settings.save({ cookies: { mode: 'browser', browser: 'firefox', profile: 'x::container' } });
check("profile with '::' is dropped", settings.get().cookies.profile, '');

const cookieFile = path.join(FAKE_DIR, 'cookies.txt');
fs.writeFileSync(cookieFile, '# Netscape HTTP Cookie File\n');
settings.save({ cookies: { mode: 'file', file: cookieFile } });
check('file mode -> --cookies <file>', settings.cookieArgs(), ['--cookies', cookieFile]);

const missing = settings.save({ cookies: { mode: 'file', file: path.join(FAKE_DIR, 'nope.txt') } });
check('missing cookie file warns', missing.warnings.length > 0, true);
check('missing cookie file -> no args, not a broken download', settings.cookieArgs(), []);

check('garbage mode normalised', settings.normalise({ cookies: { mode: 'rm -rf' } }).cookies.mode, 'none');
check('settings persisted to disk', JSON.parse(fs.readFileSync(CONFIG.SETTINGS_FILE, 'utf-8')).cookies.mode, 'file');

// ── version comparison ──────────────────────────────────────────────────

check('2.0.10 > 2.0.9', appUpdater.compareVersions('2.0.10', '2.0.9') > 0, true);
check('v2.1.0 > 2.0.99', appUpdater.compareVersions('v2.1.0', '2.0.99') > 0, true);
check('2.0.1 == v2.0.1', appUpdater.compareVersions('2.0.1', 'v2.0.1'), 0);
check('2.0.0 < 2.0.1', appUpdater.compareVersions('2.0.0', '2.0.1') < 0, true);

// ── handover argument parsing ───────────────────────────────────────────

const parsed = handover.parseLaunchArgs(['exe', '--wait-for-pid=1234', `--replaced-exe=${FAKE_DIR}\\old.exe`]);
check('parses --wait-for-pid', parsed.waitForPid, 1234);
check('parses --replaced-exe', parsed.replacedExe, `${FAKE_DIR}\\old.exe`);

const viaProtocol = handover.parseLaunchArgs(['exe', 'com.yourdomain.youtubechecker://--replaced-exe=C:\\Windows\\notepad.exe']);
check('protocol URL cannot smuggle --replaced-exe', viaProtocol.replacedExe, null);

check('rejects own pid', handover.parseLaunchArgs(['--wait-for-pid=' + process.pid]).waitForPid, null);
check('rejects non-numeric pid', handover.parseLaunchArgs(['--wait-for-pid=abc']).waitForPid, null);

// ── handover deletion safety ────────────────────────────────────────────

const sibling = path.join(FAKE_DIR, 'YouTube-Checker-2.0.1.exe');
check('allows sibling YouTube Checker exe', handover.refuseReason(sibling), null);
check('allows legacy dotted name', handover.refuseReason(path.join(FAKE_DIR, 'YouTube.Checker.2.0.0.exe')), null);
check('refuses the running exe', handover.refuseReason(FAKE_EXE), 'that is the running exe');
check('refuses another folder', handover.refuseReason('C:\\Windows\\YouTube-Checker.exe'), 'not in the same folder as this exe');
check('refuses non-matching name', handover.refuseReason(path.join(FAKE_DIR, 'important.exe')), 'does not look like a YouTube Checker exe');
check('refuses relative path', handover.refuseReason('YouTube-Checker.exe'), 'path is not absolute');
check('refuses traversal out of folder', handover.refuseReason(path.join(FAKE_DIR, '..', 'YouTube-Checker.exe')), 'not in the same folder as this exe');

(async () => {
    fs.writeFileSync(sibling, 'old exe');
    const removed = await handover.removeReplacedExe(sibling);
    check('removes the replaced sibling exe', removed && !fs.existsSync(sibling), true);

    const bystander = path.join(FAKE_DIR, 'important.exe');
    fs.writeFileSync(bystander, 'do not touch');
    await handover.removeReplacedExe(bystander);
    check('leaves an unrelated exe alone', fs.existsSync(bystander), true);

    // ── download verification, offline ──────────────────────────────────
    // https.get is swapped for a fake GitHub so the checksum paths can be
    // exercised deterministically, including a tampered download.
    const https = require('https');
    const crypto = require('crypto');
    const { PassThrough } = require('stream');
    const realGet = https.get;

    const GOOD = Buffer.from('the real exe bytes');
    const BAD = Buffer.from('something else entirely');
    const goodDigest = crypto.createHash('sha256').update(GOOD).digest('hex');
    let serveBytes = GOOD;

    const respond = (cb, statusCode, body, headers = {}) => {
        const res = new PassThrough();
        res.statusCode = statusCode;
        res.headers = headers;
        setImmediate(() => { cb(res); res.end(body); });
        return { on() { return this; } };
    };

    https.get = (url, options, cb) => {
        const target = String(url);
        if (target.includes('/releases/latest')) {
            return respond(cb, 200, JSON.stringify({
                tag_name: 'v9.9.9',
                html_url: 'https://github.com/example/release',
                assets: [
                    // A stray from an old naming scheme, which must be ignored.
                    { name: 'YouTube-Checker.exe', size: 1, browser_download_url: 'https://example.invalid/stray', digest: 'sha256:' + '0'.repeat(64) },
                    { name: 'YouTube-Checker-9.9.9.exe', size: GOOD.length, browser_download_url: 'https://example.invalid/asset', digest: `sha256:${goodDigest}` }
                ]
            }));
        }
        if (target === 'https://example.invalid/asset') {
            return respond(cb, 302, '', { location: 'https://cdn.example.invalid/asset' });
        }
        if (target === 'https://cdn.example.invalid/asset') {
            return respond(cb, 200, serveBytes, { 'content-length': String(serveBytes.length) });
        }
        return respond(cb, 404, '');
    };

    fs.mkdirSync(FAKE_DIR, { recursive: true });
    const expectedFile = path.join(FAKE_DIR, 'YouTube-Checker-9.9.9.exe');

    let status = await appUpdater.check();
    check('update detected', status.state, 'available');

    serveBytes = GOOD;
    status = await appUpdater.download();
    check('matching digest -> ready', status.state, 'ready');
    check('  picked the exact asset, not the stray', path.basename(status.downloadedPath), 'YouTube-Checker-9.9.9.exe');
    check('  file content is what was served', fs.readFileSync(expectedFile).equals(GOOD), true);

    fs.rmSync(expectedFile, { force: true });
    await appUpdater.check();
    serveBytes = BAD;
    status = await appUpdater.download();
    check('tampered download -> refused', status.state, 'error');
    check('  error names the checksum', /Checksum mismatch/.test(status.error), true);
    check('  no exe left behind', fs.existsSync(expectedFile), false);
    check('  no partial file left behind', fs.existsSync(`${expectedFile}.download`), false);

    https.get = realGet;
    fs.rmSync(FAKE_DIR, { recursive: true, force: true });

    console.log('');
    for (const r of results) {
        console.log(`${r.pass ? '  ok  ' : '  FAIL'} | ${r.name.padEnd(48)} got=${JSON.stringify(r.got)}`);
    }
    const failed = results.filter(r => !r.pass).length;
    console.log('\n' + (failed ? `${failed} FAILURES` : `all ${results.length} checks pass`));
    process.exit(failed ? 1 : 0);
})();
