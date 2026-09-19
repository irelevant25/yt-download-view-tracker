/**
 * App - Renderer Process
 *
 * Runs isolated: no Node, no require. Everything it can reach is the surface
 * exposed by src/ui/preload.js as window.ytChecker.
 *
 * Five panels: the log stream, the download queue, the watch-history library,
 * storage and settings. Everything it knows comes over IPC from ui/ipc.js.
 */
// The bridge from src/ui/preload.js. This renderer has no Node access.
const api = window.ytChecker;

const $ = (id) => document.getElementById(id);

const logContainer = $('logContainer');
const clearBtn = $('clearBtn');
const scrollLockBtn = $('scrollLockBtn');
const downloadCount = $('downloadCount');
const appVersion = $('appVersion');

// Application State
let isScrollLocked = false;
const downloadedVideos = new Set();
let libraryState = { search: '', filter: 'all', sort: 'watchedAt', direction: 'desc', limit: 200 };
let librarySearchTimer = null;

document.addEventListener('DOMContentLoaded', initializeUI);

/**
 * Initialize the UI components
 */
function initializeUI() {
    showVersion();
    wireTabs();
    wireLogControls();
    wireQueue();
    wireLibrary();
    wireStorage();
    wireSettings();

    api.onLog(handleLogMessage);
    api.onUpdateStatus(renderUpdateStatus);
    api.onDownloadCompleted(handleDownloadCompleted);
    api.onQueueChanged(renderQueue);
    api.onDownloadProgress(updateProgress);

    addLogMessage(new Date().toLocaleString(), 'App started. Logs will appear here.', 'green');

    refreshQueue();
    api.updates.status().then(renderUpdateStatus);
    api.ready();
}

/**
 * Display the app version in the header, from app.getVersion() in the main
 * process. This renderer cannot read package.json itself, and an earlier
 * attempt to require() it silently failed anyway: a relative require in a
 * renderer resolved against the HTML file's directory, not this script's.
 */
async function showVersion() {
    try {
        appVersion.textContent = `v${await api.getAppVersion()}`;
    } catch (error) {
        appVersion.textContent = '';
        console.error('Could not read app version:', error);
    }
}

// ── Tabs ────────────────────────────────────────────────────────────────

function wireTabs() {
    $('tabs').addEventListener('click', (event) => {
        const tab = event.target.closest('.tab');
        if (!tab) return;
        selectPanel(tab.dataset.panel);
    });
}

/**
 * Show one panel and load whatever it needs on first view.
 * @param {string} name
 */
function selectPanel(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.panel === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('is-active', p.id === `panel-${name}`));

    // The log controls only mean anything on the log panel.
    const onLogs = name === 'logs';
    clearBtn.hidden = !onLogs;
    scrollLockBtn.hidden = !onLogs;

    if (name === 'library') refreshLibrary();
    if (name === 'storage') refreshStorage();
    if (name === 'queue') refreshQueue();
    if (name === 'settings') loadSettings();
}

// ── Logs ────────────────────────────────────────────────────────────────

function wireLogControls() {
    clearBtn.addEventListener('click', clearLogs);
    scrollLockBtn.addEventListener('click', toggleScrollLock);
}

function handleLogMessage(datetime, message, type) {
    addLogMessage(datetime, message, type);

    if (message.startsWith('Download completed:')) {
        downloadedVideos.add(message.replace('Download completed:', '').trim());
        updateDownloadCount();
    }
}

/**
 * Add a new log message to the UI
 * @param {string} datetime
 * @param {string} message
 * @param {string} type
 */
function addLogMessage(datetime, message, type) {
    const wrapper = document.createElement('div');
    wrapper.classList.add('message-wrapper');

    const timestamp = document.createElement('div');
    timestamp.classList.add('timestamp');
    timestamp.textContent = datetime;

    const body = document.createElement('div');
    body.textContent = message;
    if (type) body.classList.add(type);

    wrapper.append(timestamp, body);
    logContainer.appendChild(wrapper);

    // Keep the log bounded; this window can be open for days.
    while (logContainer.childElementCount > 2000) {
        logContainer.removeChild(logContainer.firstElementChild);
    }

    if (!isScrollLocked) scrollToBottom();
}

function handleDownloadCompleted(url) {
    downloadedVideos.add(url);
    updateDownloadCount();
}

function updateDownloadCount() {
    downloadCount.textContent = downloadedVideos.size;
}

function clearLogs() {
    logContainer.replaceChildren();
    addLogMessage(new Date().toLocaleString(), 'Logs cleared', 'blue');
}

function toggleScrollLock() {
    isScrollLocked = !isScrollLocked;
    scrollLockBtn.classList.toggle('locked', isScrollLocked);
    scrollLockBtn.textContent = isScrollLocked ? '🔓' : '🔒';
    if (!isScrollLocked) scrollToBottom();
}

function scrollToBottom() {
    logContainer.scrollTop = logContainer.scrollHeight;
}

// ── Queue ───────────────────────────────────────────────────────────────

function wireQueue() {
    $('retryFailedBtn').addEventListener('click', async () => {
        const count = await api.queue.retryFailed();
        if (count === 0) addLogMessage(new Date().toLocaleString(), 'No failed downloads to retry.', 'blue');
    });
}

async function refreshQueue() {
    renderQueue(await api.queue.get());
}

/**
 * Render the queue panel, the tab badge and the footer summary.
 * @param {Object} status
 */
function renderQueue(status) {
    if (!status) return;

    const list = $('queueList');
    const active = status.running + status.pending;

    const badge = $('queueBadge');
    badge.textContent = String(active);
    badge.hidden = active === 0;

    $('queueSummary').textContent = status.items.length === 0
        ? 'Queue is empty.'
        : `${status.running} downloading (limit ${status.limit}), ${status.pending} waiting, ${status.failed} failed`;

    $('footerQueue').textContent = active > 0 ? `${active} in queue` : '';
    $('retryFailedBtn').disabled = status.failed === 0;

    if (status.items.length === 0) {
        list.replaceChildren(el('p', { class: 'empty', text: 'Nothing queued. Like a video on YouTube and it will appear here.' }));
        return;
    }

    const order = { active: 0, pending: 1, failed: 2 };
    const items = [...status.items].sort((a, b) => (order[a.state] - order[b.state]) || (a.addedAt - b.addedAt));

    list.replaceChildren(...items.map(renderQueueItem));
}

/**
 * One queue row, with a progress bar while it is running.
 * @param {Object} item
 * @returns {HTMLElement}
 */
function renderQueueItem(item) {
    const row = el('div', { class: `queue-item queue-item--${item.state}` });
    row.dataset.videoId = item.videoId;

    const head = el('div', { class: 'queue-head' });
    head.append(
        el('span', { class: 'queue-state', text: item.state }),
        el('span', { class: 'queue-id', text: item.videoId })
    );

    if (item.attempts > 1) {
        head.append(el('span', { class: 'muted', text: `attempt ${item.attempts}` }));
    }

    head.append(el('span', { class: 'spacer' }));

    if (item.state === 'failed') {
        const retry = el('button', { class: 'btn btn--small', text: 'Retry' });
        retry.addEventListener('click', () => api.queue.requeue(item.videoId));
        head.append(retry);
    }

    if (item.state !== 'active') {
        const remove = el('button', { class: 'btn btn--small', text: 'Remove' });
        remove.addEventListener('click', () => api.queue.remove(item.videoId));
        head.append(remove);
    }

    row.append(head);

    if (item.state === 'active') {
        const percent = item.progress ? item.progress.percent : 0;
        const bar = el('div', { class: 'progress' });
        const fill = el('div', { class: 'progress-fill' });
        fill.style.width = `${percent}%`;
        bar.append(fill);

        const detail = el('div', { class: 'queue-detail muted' });
        detail.textContent = formatProgress(item.progress);

        row.append(bar, detail);
    } else if (item.lastError) {
        row.append(el('div', { class: 'queue-detail error', text: item.lastError }));
    }

    return row;
}

/**
 * Update just the affected row, rather than re-rendering the whole queue on
 * every progress tick.
 * @param {Object} progress
 */
function updateProgress(progress) {
    const row = document.querySelector(`.queue-item[data-video-id="${CSS.escape(progress.videoId)}"]`);
    if (!row) return;

    const fill = row.querySelector('.progress-fill');
    if (fill) fill.style.width = `${progress.percent}%`;

    const detail = row.querySelector('.queue-detail');
    if (detail) detail.textContent = formatProgress(progress);
}

function formatProgress(progress) {
    if (!progress) return 'starting…';
    const parts = [`${progress.percent.toFixed(1)}%`];
    if (progress.speed) parts.push(progress.speed);
    if (progress.eta) parts.push(`ETA ${progress.eta}`);
    return parts.join('  ·  ');
}

// ── Library ─────────────────────────────────────────────────────────────

function wireLibrary() {
    $('librarySearch').addEventListener('input', (event) => {
        libraryState.search = event.target.value;
        clearTimeout(librarySearchTimer);
        librarySearchTimer = setTimeout(refreshLibrary, 180);
    });

    $('libraryFilter').addEventListener('change', (event) => {
        libraryState.filter = event.target.value;
        refreshLibrary();
    });

    $('librarySort').addEventListener('change', (event) => {
        const [sort, direction] = event.target.value.split(':');
        libraryState = { ...libraryState, sort, direction };
        refreshLibrary();
    });

    $('refreshLibraryBtn').addEventListener('click', async () => {
        await api.library.refresh();
        refreshLibrary();
    });
}

async function refreshLibrary() {
    const [result, summary] = await Promise.all([
        api.library.query(libraryState),
        api.library.summary()
    ]);

    renderStats($('librarySummary'), [
        ['Tracked', summary.total.toLocaleString()],
        ['Liked', summary.liked.toLocaleString()],
        ['Downloaded', summary.onDisk.toLocaleString()],
        ['Liked, not downloaded', summary.likedMissing.toLocaleString()]
    ]);

    const body = $('libraryRows');
    body.replaceChildren(...result.rows.map(renderLibraryRow));

    const shown = result.rows.length;
    $('libraryMore').textContent = shown < result.matched
        ? `Showing ${shown.toLocaleString()} of ${result.matched.toLocaleString()} matches — narrow the search to see more.`
        : `${result.matched.toLocaleString()} match${result.matched === 1 ? '' : 'es'}.`;
}

/**
 * @param {Object} record
 * @returns {HTMLElement}
 */
function renderLibraryRow(record) {
    const tr = el('tr');

    const marks = [];
    if (record.like) marks.push('👍');
    if (record.dislike) marks.push('👎');
    if (record.onDisk) marks.push('💾');
    tr.append(el('td', { class: 'col-state', text: marks.join(' ') }));

    tr.append(el('td', { class: 'col-title', text: record.title, title: record.title }));
    tr.append(el('td', { class: 'col-date', text: record.watchedAt ? new Date(record.watchedAt).toLocaleDateString() : '—' }));
    tr.append(el('td', { class: 'col-id mono', text: record.videoId || '—' }));

    const action = el('td', { class: 'col-action' });
    if (record.videoId && !record.onDisk) {
        const button = el('button', { class: 'btn btn--small', text: 'Download' });
        button.addEventListener('click', async () => {
            button.disabled = true;
            button.textContent = 'Queued';
            await api.queue.requeue(record.videoId);
        });
        action.append(button);
    }
    tr.append(action);

    return tr;
}

// ── Storage ─────────────────────────────────────────────────────────────

function wireStorage() {
    $('openVideosBtn').addEventListener('click', () => api.storage.openVideosFolder());
    $('openLogsBtn').addEventListener('click', () => api.storage.openLogsFolder());

    $('inspectBtn').addEventListener('click', async () => {
        const report = await api.library.inspect();
        renderRepairReport(report);
        $('repairBtn').disabled = report.legacyNames.length === 0 && report.untracked.length === 0;
    });

    $('repairBtn').addEventListener('click', async () => {
        const button = $('repairBtn');
        button.disabled = true;
        button.textContent = 'Repairing…';
        const result = await api.library.repair({ rename: true });
        button.textContent = 'Repair';
        renderRepairResult(result);
        refreshStorage();
    });
}

async function refreshStorage() {
    const s = await api.storage.stats();

    $('storagePath').textContent = s.videosDirectory;

    renderStats($('storageStats'), [
        ['Videos', `${s.videoCount.toLocaleString()} files`],
        ['Claimed', formatBytes(s.videosBytes)],
        ['Average size', s.averageVideoBytes ? formatBytes(s.averageVideoBytes) : '—'],
        ['Logs', formatBytes(s.logsBytes)],
        ['Free on drive', formatBytes(s.freeBytes)],
        ['Room for roughly', s.estimatedRoomForVideos === null ? '—' : `${s.estimatedRoomForVideos.toLocaleString()} more`]
    ]);

    const usedPct = s.totalBytes ? (s.usedBytes / s.totalBytes) * 100 : 0;
    const videosPct = s.totalBytes ? (s.videosBytes / s.totalBytes) * 100 : 0;

    $('driveFill').style.width = `${usedPct}%`;
    $('videosFill').style.width = `${videosPct}%`;
    $('driveLabel').textContent = `${formatBytes(s.usedBytes)} of ${formatBytes(s.totalBytes)} used`;

    // A library this size warrants a nudge before downloads start failing.
    const lowSpace = s.totalBytes > 0 && s.freeBytes < Math.max(s.averageVideoBytes * 3, 2 * 1024 ** 3);
    $('storageStats').classList.toggle('is-warning', lowSpace);
}

function renderRepairReport(report) {
    const target = $('repairReport');
    const lines = [
        `${report.fileCount} file(s), ${formatBytes(report.totalBytes)}, ${report.identified} identified.`
    ];

    if (report.legacyNames.length) lines.push(`${report.legacyNames.length} file(s) have no video id in the filename and can be renamed.`);
    if (report.unidentified.length) lines.push(`${report.unidentified.length} file(s) cannot be identified at all: ${report.unidentified.slice(0, 5).join(', ')}`);
    if (report.missingFiles.length) lines.push(`${report.missingFiles.length} record(s) point at files that are gone.`);
    if (report.untracked.length) lines.push(`${report.untracked.length} file(s) on disk are not in the download record.`);
    if (lines.length === 1) lines.push('Nothing to repair.');

    target.replaceChildren(...lines.map(text => el('p', { text })));
}

function renderRepairResult(result) {
    const lines = [`Renamed ${result.renamed.length} file(s). ${result.recordCount} record(s) tracked.`];
    if (result.failed.length) lines.push(`${result.failed.length} could not be renamed — see the log.`);
    $('repairReport').replaceChildren(...lines.map(text => el('p', { text })));
}

// ── Settings ────────────────────────────────────────────────────────────

function wireSettings() {
    document.querySelectorAll('input[name="cookieMode"]').forEach((radio) => {
        radio.addEventListener('change', syncCookieFields);
    });

    $('chooseCookieFileBtn').addEventListener('click', async () => {
        const chosen = await api.settings.chooseCookiesFile();
        if (chosen) $('cookieFile').value = chosen;
    });

    $('saveSettingsBtn').addEventListener('click', saveSettings);

    $('checkUpdateBtn').addEventListener('click', () => api.updates.check());
    $('downloadUpdateBtn').addEventListener('click', () => api.updates.download());
    $('installUpdateBtn').addEventListener('click', () => api.updates.install());
    $('releasePageBtn').addEventListener('click', () => api.updates.openReleasePage());
}

async function loadSettings() {
    const { settings, browsers } = await api.settings.get();

    const select = $('cookieBrowser');
    if (select.options.length === 0) {
        select.replaceChildren(...browsers.map((name) => {
            const option = el('option', { text: name.charAt(0).toUpperCase() + name.slice(1) });
            option.value = name;
            return option;
        }));
    }

    const mode = document.querySelector(`input[name="cookieMode"][value="${settings.cookies.mode}"]`);
    if (mode) mode.checked = true;
    select.value = settings.cookies.browser;
    $('cookieProfile').value = settings.cookies.profile;
    $('cookieFile').value = settings.cookies.file;
    $('autoCheckUpdates').checked = settings.updates.autoCheck;
    $('settingsMessage').textContent = '';

    syncCookieFields();
}

/** Show only the fields that apply to the selected cookie source. */
function syncCookieFields() {
    const mode = document.querySelector('input[name="cookieMode"]:checked')?.value || 'none';
    $('cookieBrowserFields').hidden = mode !== 'browser';
    $('cookieFileFields').hidden = mode !== 'file';
}

async function saveSettings() {
    const next = {
        cookies: {
            mode: document.querySelector('input[name="cookieMode"]:checked')?.value || 'none',
            browser: $('cookieBrowser').value,
            profile: $('cookieProfile').value,
            file: $('cookieFile').value
        },
        updates: { autoCheck: $('autoCheckUpdates').checked }
    };

    const { warnings } = await api.settings.save(next);
    const message = $('settingsMessage');
    message.textContent = warnings.length ? warnings.join(' ') : 'Saved. New downloads will use these settings.';
    message.classList.toggle('error', warnings.length > 0);
}

/**
 * Reflect the self-updater's state in the Settings panel and the tab badge.
 * @param {Object} status
 */
function renderUpdateStatus(status) {
    if (!status) return;

    const text = {
        idle: 'Not checked yet.',
        checking: 'Checking GitHub for a newer version…',
        'up-to-date': `You are on the latest version${status.current ? ` (v${status.current})` : ''}.`,
        available: `Version v${status.latest} is available — you have v${status.current}.`,
        downloading: `Downloading v${status.latest}… ${status.percent}%`,
        ready: `v${status.latest} is downloaded and verified. Restart to switch over.`,
        error: `Update problem: ${status.error}`
    }[status.state] || '';

    const updateText = $('updateText');
    updateText.textContent = status.state === 'ready' && !status.canInstall
        ? `${text} (Installing only works in the packaged app.)`
        : text;
    updateText.classList.toggle('error', status.state === 'error');

    $('updateProgress').hidden = status.state !== 'downloading';
    $('updateProgressFill').style.width = `${status.percent || 0}%`;

    $('downloadUpdateBtn').hidden = status.state !== 'available';
    $('installUpdateBtn').hidden = !(status.state === 'ready' && status.canInstall);
    $('releasePageBtn').hidden = !status.releaseUrl || status.state === 'up-to-date';
    $('checkUpdateBtn').disabled = status.state === 'checking' || status.state === 'downloading';

    $('updateBadge').hidden = !['available', 'ready'].includes(status.state);
}

// ── Shared helpers ──────────────────────────────────────────────────────

/**
 * Small element builder. textContent only — never innerHTML, since this
 * renderer has Node integration.
 * @param {string} tag
 * @param {Object} [options]
 * @returns {HTMLElement}
 */
function el(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.class) node.className = options.class;
    if (options.text !== undefined) node.textContent = options.text;
    if (options.title) node.title = options.title;
    return node;
}

/**
 * @param {HTMLElement} target
 * @param {Array<[string, string]>} pairs
 */
function renderStats(target, pairs) {
    target.replaceChildren(...pairs.map(([label, value]) => {
        const box = el('div', { class: 'stat' });
        box.append(el('span', { class: 'stat-value', text: value }), el('span', { class: 'stat-label', text: label }));
        return box;
    }));
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, index);
    return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}
