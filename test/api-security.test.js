// Security regression test: boots the real Express server with electron stubbed out,
// then fires real HTTP requests at it — including the original RCE payload.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
        return {
            app: { isPackaged: false, getVersion: () => '2.0.1' },
            Notification: class { constructor() {} show() {} },
            ipcMain: { on() {}, handle() {} }
        };
    }
    return origLoad(request, parent, isMain);
};

const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG = require('../src/config');

// Keep the test away from real data: a valid URL gets queued, and the queue
// persists, so without this it would start a real download into videos/.
const SANDBOX = fs.mkdtempSync(path.join(require('os').tmpdir(), 'yt-checker-api-test-'));
CONFIG.LOGS_DIRECTORY = path.join(SANDBOX, 'logs');
CONFIG.ACTIVITY_LOG_FILE = path.join(SANDBOX, 'logs', 'activity.log');
CONFIG.VIDEOS_DIRECTORY = path.join(SANDBOX, 'videos');
CONFIG.QUEUE_FILE = path.join(SANDBOX, 'download_queue.json');
CONFIG.DOWNLOADED_VIDEOS_FILE = path.join(SANDBOX, 'downloaded_videos.json');
CONFIG.WATCH_TRACKER_FILE = path.join(SANDBOX, 'YouTubeWatchTracker.json');
CONFIG.YTDLP_PATH = path.join(SANDBOX, 'no-such-yt-dlp.exe');
fs.mkdirSync(CONFIG.LOGS_DIRECTORY, { recursive: true });

const server = require('../src/api/server');

function request(method, urlPath, body, headers = {}) {
    return new Promise((resolve) => {
        const payload = body === undefined ? null : JSON.stringify(body);
        const req = http.request({
            host: '127.0.0.1', port: CONFIG.PORT, path: urlPath, method,
            headers: {
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...headers
            }
        }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 200), acao: res.headers['access-control-allow-origin'] }));
        });
        req.on('error', e => resolve({ status: 0, body: e.message }));
        if (payload) req.write(payload);
        req.end();
    });
}

const CANARY = path.join(require('os').tmpdir(), 'yt-checker-rce-canary.txt');

(async () => {
    try { fs.unlinkSync(CANARY); } catch {}

    const ok = await server.startServer();
    if (!ok) { console.log('SERVER FAILED TO START'); process.exit(1); }

    const results = [];
    const check = (name, got, want) => results.push({ name, got, want, pass: got === want });

    // 1. Health check, no Origin header
    check('GET / (no origin)', (await request('GET', '/')).status, 200);

    // 2. Allowed origin
    const yt = await request('GET', '/', undefined, { Origin: 'https://www.youtube.com' });
    check('GET / (youtube origin)', yt.status, 200);
    check('  -> ACAO echoes youtube', yt.acao, 'https://www.youtube.com');

    // 3. Hostile origin must be refused
    const evil = await request('GET', '/', undefined, { Origin: 'https://evil.example.com' });
    check('GET / (evil origin)', evil.status, 403);
    check('  -> ACAO absent for evil', evil.acao, undefined);

    // 4. The original RCE payload
    const rce = await request('POST', '/download', { url: `https://youtube.com/watch?v=x" & cmd /c echo pwned > "${CANARY}" & rem ` });
    check('POST /download (RCE payload)', rce.status, 400);

    // 5. Other malformed inputs
    check('POST /download (traversal)', (await request('POST', '/download', { url: 'https://www.youtube.com/watch?v=../../../x' })).status, 400);
    check('POST /download (wrong host)', (await request('POST', '/download', { url: 'https://evil.com/watch?v=dQw4w9WgXcQ' })).status, 400);
    check('POST /download (http)', (await request('POST', '/download', { url: 'http://www.youtube.com/watch?v=dQw4w9WgXcQ' })).status, 400);
    check('POST /download (number)', (await request('POST', '/download', { url: 12345 })).status, 400);
    check('POST /download (missing)', (await request('POST', '/download', {})).status, 400);

    // 6. A legitimate URL is accepted
    check('POST /download (valid url)', (await request('POST', '/download', { url: 'https://youtube.com/watch?v=dQw4w9WgXcQ&t=9' })).status, 200);

    await new Promise(r => setTimeout(r, 1200));
    check('RCE canary file NOT created', fs.existsSync(CANARY), false);

    console.log('');
    for (const r of results) {
        console.log(`${r.pass ? '  ok  ' : '  FAIL'} | ${r.name.padEnd(34)} got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
    }
    const failed = results.filter(r => !r.pass).length;
    console.log('\n' + (failed ? `${failed} FAILURES` : `all ${results.length} checks pass`));

    server.stopServer();
    fs.rmSync(SANDBOX, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
})();
