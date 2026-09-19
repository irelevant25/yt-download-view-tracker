/**
 * /upload-db change detection and the data-loss guard.
 *
 * The endpoint used to treat "same array length" as "unchanged", so a session
 * that only toggled a like never got saved.
 */
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: { isPackaged: false, getVersion: () => '0.0.0' },
            Notification: class { show() {} },
            ipcMain: { on() {}, handle() {} }
        };
    }
    return origLoad(request, parent, isMain);
};

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG = require('../src/config');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-checker-uploaddb-'));
CONFIG.LOGS_DIRECTORY = path.join(SANDBOX, 'logs');
CONFIG.ACTIVITY_LOG_FILE = path.join(SANDBOX, 'logs', 'activity.log');
CONFIG.VIDEOS_DIRECTORY = path.join(SANDBOX, 'videos');
CONFIG.QUEUE_FILE = path.join(SANDBOX, 'download_queue.json');
CONFIG.DOWNLOADED_VIDEOS_FILE = path.join(SANDBOX, 'downloaded_videos.json');
CONFIG.WATCH_TRACKER_FILE = path.join(SANDBOX, 'YouTubeWatchTracker.json');
CONFIG.YTDLP_PATH = path.join(SANDBOX, 'no-such-yt-dlp.exe');
fs.mkdirSync(CONFIG.LOGS_DIRECTORY, { recursive: true });

const server = require('../src/api/server');

function post(body) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            host: '127.0.0.1', port: CONFIG.PORT, path: '/upload-db', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                let parsed = {};
                try { parsed = JSON.parse(d); } catch {}
                resolve({ status: res.statusCode, ...parsed });
            });
        });
        req.on('error', () => resolve({ status: 0 }));
        req.write(payload);
        req.end();
    });
}

const record = (key, like) => ({ key, title: `Video ${key}`, datetime: '08.09.2024 20:20:51', like, dislike: false, download: false });
const saved = () => JSON.parse(fs.readFileSync(CONFIG.WATCH_TRACKER_FILE, 'utf-8'));

const results = [];
const check = (name, got, want) => results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

(async () => {
    if (!await server.startServer()) { console.log('SERVER FAILED TO START'); process.exit(1); }

    const base = [record('aaaaaaaaaaa', false), record('bbbbbbbbbbb', false)];

    let res = await post({ data: base });
    check('first upload saves', res.message, 'Data saved successfully.');
    check('  written to disk', saved().length, 2);

    res = await post({ data: base });
    check('identical upload is skipped', res.message, 'Data has not changed.');

    // The regression: same length, different content.
    const liked = [record('aaaaaaaaaaa', true), record('bbbbbbbbbbb', false)];
    res = await post({ data: liked });
    check('same length, changed content IS saved', res.message, 'Data saved successfully.');
    check('  the like reached disk', saved()[0].like, true);

    const grown = [...liked, record('ccccccccccc', false)];
    res = await post({ data: grown });
    check('a longer upload saves', res.message, 'Data saved successfully.');
    check('  all three on disk', saved().length, 3);

    res = await post({ data: [record('aaaaaaaaaaa', true)] });
    check('a shorter upload is refused', res.status, 400);
    check('  disk untouched by the refusal', saved().length, 3);

    res = await post({ data: 'not an array' });
    check('non-array refused', res.status, 400);

    check('downloadedVideoCodes returned', Array.isArray((await post({ data: grown })).downloadedVideoCodes), true);

    server.stopServer();
    fs.rmSync(SANDBOX, { recursive: true, force: true });

    console.log('');
    for (const r of results) {
        console.log(`${r.pass ? '  ok  ' : '  FAIL'} | ${r.name.padEnd(42)} got=${JSON.stringify(r.got)}`);
    }
    const failed = results.filter(r => !r.pass).length;
    console.log('\n' + (failed ? `${failed} FAILURES` : `all ${results.length} checks pass`));
    process.exit(failed ? 1 : 0);
})();
