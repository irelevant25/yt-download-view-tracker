/**
 * Download queue behaviour: concurrency cap, backoff retry, give-up, and
 * surviving a restart. The downloader is replaced with a stub so nothing is
 * actually fetched.
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

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG = require('../src/config');

// Fast timings so the test finishes in seconds rather than minutes.
CONFIG.MAX_CONCURRENT_DOWNLOADS = 2;
CONFIG.MAX_DOWNLOAD_ATTEMPTS = 3;
CONFIG.RETRY_BASE_DELAY_MS = 120;
CONFIG.RETRY_FACTOR = 1;
CONFIG.QUEUE_TICK_MS = 40;
CONFIG.QUEUE_FILE = path.join(os.tmpdir(), `yt-checker-queue-test-${process.pid}.json`);
// Queue events go to activity.log; keep them out of the real one.
CONFIG.LOGS_DIRECTORY = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-checker-queue-logs-'));
CONFIG.ACTIVITY_LOG_FILE = path.join(CONFIG.LOGS_DIRECTORY, 'activity.log');

// Stub the downloader before the queue requires it.
const downloader = require('../src/services/downloader');
const realInitiate = downloader.initiateDownload;

let concurrent = 0;
let maxConcurrent = 0;
const attemptsByUrl = new Map();
/** url -> how many attempts should fail before it succeeds (Infinity = never) */
let failPlan = new Map();

downloader.initiateDownload = async function (url, onComplete) {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);

    const n = (attemptsByUrl.get(url) || 0) + 1;
    attemptsByUrl.set(url, n);

    await new Promise(r => setTimeout(r, 60));
    concurrent -= 1;

    const failuresWanted = failPlan.get(url) ?? 0;
    const success = n > failuresWanted;
    if (onComplete) onComplete(url, success);
    return success;
};

const queue = require('../src/services/queue');

const url = (id) => `https://www.youtube.com/watch?v=${id}`;
const results = [];
const check = (name, got, want) => results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function waitUntil(predicate, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (predicate()) return true;
        await wait(25);
    }
    return false;
}

(async () => {
    try { fs.unlinkSync(CONFIG.QUEUE_FILE); } catch {}

    const downloaded = [];
    await queue.start({ onDownloaded: async (u) => { downloaded.push(u); } });

    // --- concurrency cap -------------------------------------------------
    const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'];
    ids.forEach(id => queue.enqueue(url(id)));

    check('all five queued', queue.status().items.length, 5);

    await waitUntil(() => downloaded.length === 5);
    check('all five downloaded', downloaded.length, 5);
    check('never exceeded concurrency limit', maxConcurrent <= 2, true);
    check('queue drained', queue.status().items.length, 0);

    // --- retry with backoff ----------------------------------------------
    const flaky = url('fffffffffff');
    failPlan.set(flaky, 2);           // fails twice, succeeds on attempt 3
    attemptsByUrl.clear();
    downloaded.length = 0;

    queue.enqueue(flaky);
    const recovered = await waitUntil(() => downloaded.includes(flaky), 5000);
    check('flaky download eventually succeeded', recovered, true);
    check('  took three attempts', attemptsByUrl.get(flaky), 3);

    // --- gives up after MAX_DOWNLOAD_ATTEMPTS ----------------------------
    const doomed = url('ggggggggggg');
    failPlan.set(doomed, Infinity);
    attemptsByUrl.clear();

    queue.enqueue(doomed);
    const gaveUp = await waitUntil(() => queue.status().failed === 1, 5000);
    check('gave up on permanently failing item', gaveUp, true);
    check('  after exactly MAX_DOWNLOAD_ATTEMPTS', attemptsByUrl.get(doomed), 3);
    check('  item retained as failed, not dropped', queue.status().items.length, 1);

    // --- duplicate protection --------------------------------------------
    queue.enqueue(url('hhhhhhhhhhh'));
    const before = queue.status().items.length;
    queue.enqueue(url('hhhhhhhhhhh'));
    check('duplicate not queued twice', queue.status().items.length, before);

    // --- persistence across a restart ------------------------------------
    await wait(150);
    queue.stop();

    const onDisk = JSON.parse(fs.readFileSync(CONFIG.QUEUE_FILE, 'utf-8'));
    check('queue persisted to disk', Array.isArray(onDisk) && onDisk.length > 0, true);
    check('  nothing persisted as active', onDisk.some(i => i.state === 'active'), false);

    // Simulate a restart: wipe memory, reload from the file.
    queue._items.clear();
    failPlan.set(doomed, Infinity);
    await queue.start({ onDownloaded: async (u) => { downloaded.push(u); } });
    const restored = queue.status().items.length;
    check('queue restored after restart', restored > 0, true);
    queue.stop();

    try { fs.unlinkSync(CONFIG.QUEUE_FILE); } catch {}
    fs.rmSync(CONFIG.LOGS_DIRECTORY, { recursive: true, force: true });
    downloader.initiateDownload = realInitiate;

    console.log('');
    for (const r of results) {
        console.log(`${r.pass ? '  ok  ' : '  FAIL'} | ${r.name.padEnd(42)} got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`);
    }
    const failed = results.filter(r => !r.pass).length;
    console.log('\n' + (failed ? `${failed} FAILURES` : `all ${results.length} checks pass`));
    process.exit(failed ? 1 : 0);
})();
