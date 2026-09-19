// ==UserScript==
// @name         YouTube Video Tracker
// @namespace    http://tampermonkey.net/
// @version      2026-09-19b
// @description  Monitor YouTube video interactions efficiently while complying with Trusted Types.
// @author       irelevant
// @match        *://*.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      localhost
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    ////////////////////////////////
    ////////// Trusted Types ///////
    ////////////////////////////////

    // The global is `trustedTypes`, lowercase - the capitalised spelling never
    // resolves, so the policy was silently never created.
    const isTrustedTypesSupported = () => {
        return typeof window.trustedTypes !== 'undefined' && !!window.trustedTypes.createPolicy;
    };

    let trustedTypesPolicy = null;

    if (isTrustedTypesSupported()) {
        try {
            trustedTypesPolicy = window.trustedTypes.createPolicy('ytTrackerPolicy', {
                createHTML: (input) => input
            });
        } catch (error) {
            console.warn('[YT-Tracker] Could not create Trusted Types policy:', error);
        }
    }

    ////////////////////////////////
    ////////// IndexedDB //////////
    ////////////////////////////////

    const DB_NAME = "YouTubeWatchTracker";
    const STORE_NAME = "videos";

    const dbPromise = new Promise((resolve, reject) => {
        console.log('[YT-Tracker] Opening IndexedDB...');
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = ({ target }) => {
            console.log('[YT-Tracker] IndexedDB upgrade needed');
            const db = target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                // Out-of-line keys: every call site passes the video code as a
                // separate key argument (put(value, key), get(key), cursor.key).
                // Declaring a keyPath here would make those calls throw DataError
                // on any browser profile that creates the store fresh.
                db.createObjectStore(STORE_NAME);
                console.log('[YT-Tracker] Created object store');
            }
        };

        request.onsuccess = ({ target }) => {
            console.log('[YT-Tracker] IndexedDB opened successfully');
            resolve(target.result);
        };

        request.onerror = ({ target }) => {
            console.error('[YT-Tracker] IndexedDB Error:', target.error);
            reject(`IndexedDB Error: ${target.error}`);
        };

        request.onblocked = () => {
            console.error('[YT-Tracker] IndexedDB BLOCKED - close other YouTube tabs and refresh!');
            alert('YouTube Tracker: Database is blocked. Please close other YouTube tabs and refresh this page.');
        };
    });

    const db = {
        async put(id, videoData) {
            const dbInstance = await dbPromise;
            return new Promise((resolve, reject) => {
                const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
                const dataToStore = { ...videoData };
                try {
                    const request = transaction.objectStore(STORE_NAME).put(dataToStore, id);
                    request.onerror = () => {
                        console.error(`Put Error: ${request.error}`);
                        reject(`Put Error: ${request.error}`);
                    };
                    request.onsuccess = () => resolve(request.result);
                }
                catch (error) {
                    console.error(`Put Error: ${error}`);
                    reject(`Put Error: ${error}`);
                }
            });
        },
        async get(videoCode) {
            const dbInstance = await dbPromise;
            return new Promise((resolve, reject) => {
                const transaction = dbInstance.transaction([STORE_NAME], 'readonly');
                try {
                    const request = transaction.objectStore(STORE_NAME).get(videoCode);
                    request.onsuccess = () => resolve(request.result || null);
                    request.onerror = () => {
                        console.error(`Get Error: ${request.error}`);
                        reject(`Get Error: ${request.error}`);
                    }
                }
                catch (error) {
                    console.error(`Get Error: ${error}`);
                    reject(`Get Error: ${error}`);
                }
            });
        },
        async getAll() {
            const dbInstance = await dbPromise;
            return new Promise((resolve, reject) => {
                const transaction = dbInstance.transaction([STORE_NAME], 'readonly');
                try {
                    const request = transaction.objectStore(STORE_NAME).getAll();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => {
                        console.error(`GetAll Error: ${request.error}`);
                        reject(`GetAll Error: ${request.error}`);
                    };
                }
                catch (error) {
                    console.error(`GetAll Error: ${error}`);
                    reject(`GetAll Error: ${error}`);
                }
            });
        }
    };

    ////////////////////////////////
    ////////// UI Elements /////////
    ////////////////////////////////

    function createElement(tag, options = {}) {
        const el = document.createElement(tag);

        if (options.events) {
            Object.entries(options.events).forEach(([event, handler]) => el.addEventListener(event, handler));
            delete options.events;
        }

        if (options.textContent) {
            el.textContent = options.textContent;
            delete options.textContent;
        }

        if (options.innerHTML) {
            if (trustedTypesPolicy) {
                el.innerHTML = trustedTypesPolicy.createHTML(options.innerHTML);
            } else {
                el.innerHTML = options.innerHTML;
            }
            delete options.innerHTML;
        }

        if (options.styles) {
            Object.assign(el.style, options.styles);
            delete options.styles;
        }

        Object.entries(options).forEach(([key, value]) => el.setAttribute(key, value));

        return el;
    };

    //////////////////////////////////
    ////////// NOTIFICATIONS /////////
    //////////////////////////////////

    const NotificationSystem = (() => {
        const container = createElement('div', {
            id: 'yt-tracker-notification-container',
            style: "position: fixed; bottom: 20px; left: 20px; z-index: 9999; display: grid; gap: 5px"
        });
        document.body.appendChild(container);

        const styles = `
            .yt-tracker-notification {
                padding: 10px 20px;
                border-radius: 5px;
                font-size: 16px;
                animation: fadeIn 0.5s ease;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                color: white;
                cursor: pointer;
            }
            .yt-tracker-notification.success { background-color: green; }
            .yt-tracker-notification.error { background-color: red; }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        `;
        const styleSheet = createElement('style', { textContent: styles });
        document.head.appendChild(styleSheet);

        const notify = (message, type = 'success', dismissTime = 2500) => {
            const notif = createElement('div', {
                textContent: message,
                class: `yt-tracker-notification ${type}`,
                events: { click: () => notif.remove() }
            });
            container.appendChild(notif);
            if (dismissTime > 0) setTimeout(() => notif.remove(), dismissTime);
        };

        return { success: (msg, time) => notify(msg, 'success', time), error: (msg, time) => notify(msg, 'error', time) };
    })();

    ///////////////////////////////////////
    ////////// Utility Functions //////////
    ///////////////////////////////////////

    const API_URL = 'http://localhost:5000';
    const APP_NAME = 'com.yourdomain.youtubechecker://';

    function customFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {},
                data: options.body,
                timeout: options.timeout,
                onload: (response) => {
                    resolve({
                        ok: response.status >= 200 && response.status < 300,
                        status: response.status,
                        text: () => Promise.resolve(response.responseText),
                        json: () => Promise.resolve(JSON.parse(response.responseText))
                    });
                },
                onerror: (error) => reject(error),
                ontimeout: () => reject(new Error('Request timed out'))
            });
        });
    }

    function formatTimeDifference(past) {
        const now = Date.now();
        const diff = now - past;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        return `${days > 0 ? days + 'd ' : ''}${(hours % 24) > 0 ? (hours % 24) + 'h ' : ''}${(minutes % 60) > 0 ? (minutes % 60) + 'm ' : ''}${(seconds % 60)}s ago`;
    };

    ///////////////////////////////////////
    ////////// API Health Monitor /////////
    ///////////////////////////////////////

    // The desktop app can start or die at any moment, in any tab, without this page
    // doing anything. So availability is polled continuously rather than probed once
    // at startup: fast while it is down (so a cold boot is picked up within a second
    // of the app being ready), slow while it is up (just enough to notice a crash).

    const POLL_INTERVAL_DOWN_MS = 1000;
    const POLL_INTERVAL_UP_MS = 3000;
    const PROBE_TIMEOUT_MS = 2000;
    // One dropped probe on a busy app should not flash the modal; two in a row means
    // the app dying is noticed 3-6s later.
    const FAILURES_BEFORE_DOWN = 2;

    const ApiMonitor = (() => {
        let available = null;   // null until the first probe resolves
        let failureStreak = 0;
        let timer = null;
        let ticking = false;
        let inFlight = null;
        const changeListeners = new Set();
        const resultListeners = new Set();

        // Any HTTP answer at all means something is listening on the port. Status
        // codes are deliberately ignored: a 404 on `/` is still a running API.
        function probe() {
            return new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: API_URL,
                    timeout: PROBE_TIMEOUT_MS,
                    onload: () => resolve(true),
                    onerror: () => resolve(false),
                    ontimeout: () => resolve(false)
                });
            });
        }

        function emit(set, value) {
            set.forEach((fn) => {
                try { fn(value); } catch (error) { console.error('[YT-Tracker] API listener failed:', error); }
            });
        }

        function setAvailable(next) {
            if (available === next) return;
            available = next;
            emit(changeListeners, next);
        }

        function check() {
            // Collapse overlapping checks (a visibilitychange landing on a tick).
            if (inFlight) return inFlight;

            inFlight = probe().then((up) => {
                if (up) {
                    failureStreak = 0;
                    setAvailable(true);
                } else {
                    failureStreak++;
                    if (available !== true || failureStreak >= FAILURES_BEFORE_DOWN) {
                        setAvailable(false);
                    }
                }
                inFlight = null;

                // Broadcast the settled state after EVERY probe, not just on the
                // edges. The UI reconciles itself against this, so a missed
                // transition self-heals on the next poll instead of leaving the
                // page stuck showing the wrong thing.
                emit(resultListeners, available === true);
                return available === true;
            });

            return inFlight;
        }

        async function tick() {
            // Guard against two concurrent loops (a visibilitychange arriving while
            // a tick is already awaiting its probe); the running tick reschedules.
            if (ticking) return;
            ticking = true;
            try {
                await check();
            } finally {
                ticking = false;
            }
            clearTimeout(timer);
            timer = setTimeout(tick, available === true ? POLL_INTERVAL_UP_MS : POLL_INTERVAL_DOWN_MS);
        }

        // Background tabs get their timers throttled to roughly once a minute, so a
        // tab left open on another screen can hold a stale state. Re-probe the moment
        // it comes back to the foreground.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            clearTimeout(timer);
            tick();
        });

        return {
            start: () => tick(),
            isAvailable: () => available === true,
            checkNow: check,
            // Edges only - use for side effects that must happen once per transition.
            onChange: (fn) => { changeListeners.add(fn); return () => changeListeners.delete(fn); },
            // Every probe - use for UI that should converge on the current state.
            onResult: (fn) => { resultListeners.add(fn); return () => resultListeners.delete(fn); }
        };
    })();

    ////////////////////////////////
    ////////// API UI //////////////
    ////////////////////////////////

    // How long "Starting API..." stays patient before it starts calling itself a
    // failure. The app takes 10-15s from a cold boot and the monitor closes the
    // modal by itself the instant it answers, so this only bounds the failure case.
    const STARTUP_GRACE_MS = 60000;

    // The modal and the floating badge are one unit: exactly one of them is on
    // screen whenever the API is down, and neither when it is up. Both are driven
    // by sync(), which runs after every probe - so the UI converges on the real
    // state even if a transition is somehow missed.
    const ApiUi = (() => {
        let overlay = null;
        let message = null;
        let runBtn = null;
        let badge = null;
        let ticker = null;

        // When Run was last pressed. Survives closing the modal, so reopening it
        // mid-startup still shows the running counter rather than resetting to
        // "API is not running". Cleared only when the API actually comes up.
        let startedAt = 0;
        // Cancel on our own modal. Collapses to the floating badge instead of
        // nagging; cleared when the API comes up or when the badge is clicked.
        let dismissed = false;

        function phase() {
            if (!startedAt) return 'idle';
            return (Date.now() - startedAt < STARTUP_GRACE_MS) ? 'starting' : 'failed';
        }

        // Both buttons stay in place in every phase - only the wording changes.
        // Chrome's external-protocol prompt is easy to dismiss by accident, and the
        // fix for that is pressing Run again, so Run must never disappear.
        function render() {
            if (!overlay) return;

            switch (phase()) {
                case 'starting': {
                    const waited = Math.round((Date.now() - startedAt) / 1000);
                    message.textContent = `Starting API... (${waited}s)`;
                    runBtn.textContent = 'Run again';
                    break;
                }
                case 'failed':
                    message.textContent = 'API could not be started';
                    runBtn.textContent = 'Try again';
                    break;
                default:
                    message.textContent = 'API is not running';
                    runBtn.textContent = 'Run';
            }
        }

        function startTicker() {
            if (ticker) return;
            ticker = setInterval(render, 1000);
        }

        function stopTicker() {
            clearInterval(ticker);
            ticker = null;
        }

        function buildModal() {
            overlay = createElement('div', {
                id: 'yt-tracker-api-modal',
                styles: {
                    position: 'fixed',
                    top: '0',
                    left: '0',
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    zIndex: '99999',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }
            });

            const modal = createElement('div', {
                styles: {
                    backgroundColor: '#222',
                    padding: '20px 30px',
                    borderRadius: '10px',
                    color: 'white',
                    textAlign: 'center',
                    minWidth: '250px'
                }
            });

            message = createElement('p', {
                textContent: 'API is not running',
                styles: { marginBottom: '20px', fontSize: '16px' }
            });

            const btnContainer = createElement('div', {
                styles: { display: 'flex', gap: '10px', justifyContent: 'center' }
            });

            const cancelBtn = createElement('button', {
                textContent: 'Cancel',
                styles: {
                    padding: '8px 20px',
                    cursor: 'pointer',
                    backgroundColor: '#555',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px'
                },
                events: {
                    click: () => {
                        dismissed = true;
                        closeModal();
                        showBadge();
                    }
                }
            });

            runBtn = createElement('button', {
                textContent: 'Run',
                styles: {
                    padding: '8px 20px',
                    cursor: 'pointer',
                    backgroundColor: '#2e7d32',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px'
                },
                events: {
                    click: () => {
                        // Hands off to Chrome's external-protocol prompt. Nothing is
                        // awaited here - the monitor is already polling once a second
                        // and closes this modal as soon as the app answers. Pressing
                        // it again just re-fires the prompt and restarts the counter.
                        startedAt = Date.now();
                        render();
                        startTicker();
                        window.location.href = APP_NAME;
                    }
                }
            });

            btnContainer.append(cancelBtn, runBtn);
            modal.append(message, btnContainer);
            overlay.appendChild(modal);
        }

        function openModal() {
            if (overlay) {
                render();
                return;
            }
            buildModal();
            document.body.appendChild(overlay);
            render();
            startTicker();
        }

        function closeModal() {
            stopTicker();
            overlay?.remove();
            overlay = null;
            message = null;
            runBtn = null;
        }

        function buildBadge() {
            badge = createElement('button', {
                id: 'yt-tracker-api-badge',
                textContent: '⚠ API offline',
                styles: {
                    position: 'fixed',
                    bottom: '20px',
                    right: '20px',
                    // Under the modal overlay (99999) - they are never both visible,
                    // but this keeps the stacking honest if that ever changes.
                    zIndex: '99998',
                    display: 'none',
                    padding: '10px 16px',
                    borderRadius: '999px',
                    border: 'none',
                    backgroundColor: '#c62828',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: '600',
                    fontFamily: 'Roboto, Arial, sans-serif',
                    cursor: 'pointer',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.4)'
                },
                events: {
                    click: () => {
                        dismissed = false;
                        hideBadge();
                        openModal();
                    }
                }
            });
            document.body.appendChild(badge);
        }

        function showBadge() {
            if (!badge) buildBadge();
            badge.style.display = 'block';
        }

        function hideBadge() {
            if (badge) badge.style.display = 'none';
        }

        return {
            // Called after every probe, not just on transitions.
            sync(up) {
                if (up) {
                    dismissed = false;
                    startedAt = 0;
                    closeModal();
                    hideBadge();
                    return;
                }
                if (dismissed) {
                    closeModal();
                    showBadge();
                } else {
                    hideBadge();
                    openModal();
                }
            }
        };
    })();

    ///////////////////////////////////////
    ////////// API Interactions ///////////
    ///////////////////////////////////////

    // Download requests made while the app was down, replayed once it is back.
    const pendingDownloads = new Set();

    async function uploadDBToApi() {
        download(true, async (data) => {
            try {
                const response = await customFetch(API_URL + '/upload-db', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data })
                });
                const result = await response.json();

                // Sync confirmed download status from the app back into local IndexedDB.
                // The app returns codes it has actually downloaded — update any that are
                // still marked as download:false locally.
                const codes = result.downloadedVideoCodes;
                if (Array.isArray(codes) && codes.length > 0) {
                    let syncedCount = 0;
                    for (const videoCode of codes) {
                        const video = await db.get(videoCode);
                        if (video && !video.download) {
                            await db.put(videoCode, { ...video, download: true });
                            syncedCount++;
                        }
                        pendingDownloads.delete(videoCode);
                    }
                    if (syncedCount > 0) {
                        console.log(`[YT-Tracker] Synced ${syncedCount} video(s) as downloaded`);
                        NotificationSystem.success(`Synced ${syncedCount} download(s) from app`, 0);
                    }
                }
            } catch (error) {
                console.error(error);
            }
        });
    }

    async function postDownload(videoCode) {
        const videoUrl = `https://www.youtube.com/watch?v=${videoCode}`;

        try {
            const response = await customFetch(API_URL + '/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: videoUrl })
            });
            const result = await response.json();
            // Show the API message ("started" or "already in progress").
            // Do NOT mark as downloaded here — the app will confirm on next startup sync.
            NotificationSystem.success(result.message, 0);
            pendingDownloads.delete(videoCode);
        } catch (error) {
            // Most likely the app died between the probe and this request; leave it
            // queued so the next up-transition retries it.
            pendingDownloads.add(videoCode);
            NotificationSystem.error('Failed to send download request.', 0);
            console.error(error);
        }
    }

    async function sendDownloadRequest(videoCode) {
        const video = await db.get(videoCode);
        if (!video) {
            console.log('[YT-Tracker] Download skipped: video not in DB');
            return;
        }
        if (!video.like) {
            console.log('[YT-Tracker] Download skipped: video not liked');
            return;
        }
        if (video.download) {
            console.log('[YT-Tracker] Download skipped: already downloaded');
            NotificationSystem.success('Already downloaded', 0);
            return;
        }

        if (!ApiMonitor.isAvailable()) {
            // Queue it and let the monitor drive; no blocking retry loop here.
            pendingDownloads.add(videoCode);
            console.log('[YT-Tracker] API down, download queued:', videoCode);
            return;
        }

        await postDownload(videoCode);
    }

    function flushPendingDownloads() {
        if (pendingDownloads.size === 0) return;
        const queued = Array.from(pendingDownloads);
        console.log(`[YT-Tracker] Retrying ${queued.length} queued download(s)`);
        queued.forEach((videoCode) => sendDownloadRequest(videoCode));
    }

    // Edges: the things that must happen exactly once per transition.
    ApiMonitor.onChange((up) => {
        console.log(`[YT-Tracker] API is ${up ? 'up' : 'down'}`);
        if (!up) return;
        uploadDBToApi();
        flushPendingDownloads();
    });

    // Every probe: the UI reconciles itself, so nothing can get stuck showing the
    // wrong state if a transition is missed.
    ApiMonitor.onResult((up) => ApiUi.sync(up));

    ////////////////////////////////
    ////////// Watch Time //////////
    ////////////////////////////////

    function displayWatchTime(videoCode, timestamp) {
        let attempts = 0;
        const interval = setInterval(() => {
            // Stop if the user navigated away, otherwise this interval leaks one
            // timer per visited video and can stamp the wrong title.
            const currentCode = new URLSearchParams(window.location.search).get('v');
            if (currentCode !== videoCode || ++attempts > 60) {
                clearInterval(interval);
                return;
            }

            const title = document.querySelector('#title');
            if (!title) return;

            clearInterval(interval);
            title.querySelector('.yt-tracker-watch-time')?.remove();

            const watchTime = createElement('p', {
                textContent: new Date(timestamp * 1000).toLocaleString('sk-SK').replaceAll(". ", "."),
                style: "margin-left: auto; color: orange; cursor: default; text-wrap: nowrap;font-size: 2rem;font-weight: 700;",
                class: 'yt-tracker-watch-time',
                events: {
                    mouseover: (e) => { e.target.title = formatTimeDifference(new Date(timestamp * 1000).getTime()); }
                }
            });
            title.style.width = '100%';
            title.style.display = 'flex';
            title.append(watchTime);
        }, 500);
    };

    ////////////////////////////////
    ////////// Main Logic //////////
    ////////////////////////////////

    function monitorVideoPage() {
        let lastVideo = { code: null, title: null };
        let currentLikeHandler = null;
        let currentDislikeHandler = null;
        let currentLikeBtn = null;
        let currentDislikeBtn = null;

        return setInterval(async () => {
            if (!window.location.pathname.startsWith('/watch')) return;

            const params = new URLSearchParams(window.location.search);
            const videoCode = params.get('v');
            const titleElem = document.querySelector('#title yt-formatted-string');
            const title = titleElem ? titleElem.innerText : '';

            const likeBtn = document.querySelector(`ytd-watch-metadata[video-id="${videoCode}"] like-button-view-model button[aria-pressed]`);
            const dislikeBtn = document.querySelector(`ytd-watch-metadata[video-id="${videoCode}"] dislike-button-view-model button[aria-pressed]`);
            if (!likeBtn || !dislikeBtn) return;

            if (videoCode === lastVideo.code && title === lastVideo.title) return;
            if (!title) return;

            // Cleanup old listeners
            if (currentLikeBtn && currentLikeHandler) {
                currentLikeBtn.removeEventListener('click', currentLikeHandler);
            }
            if (currentDislikeBtn && currentDislikeHandler) {
                currentDislikeBtn.removeEventListener('click', currentDislikeHandler);
            }

            lastVideo = { code: videoCode, title };

            const stored = await db.get(videoCode);
            const like = likeBtn.getAttribute('aria-pressed') === 'true';
            const dislike = dislikeBtn.getAttribute('aria-pressed') === 'true';

            let videoData = stored;
            if (!stored || stored.like !== like || stored.dislike !== dislike) {
                videoData = {
                    title,
                    // Keep the original watch time and the download flag for records
                    // that already exist. Rebuilding the record from scratch here used
                    // to reset download:false on every like toggle, which made the app
                    // re-download videos it already had.
                    datetime: stored?.datetime ?? Math.floor(Date.now() / 1000),
                    like,
                    dislike,
                    download: stored?.download ?? false
                };
                await db.put(videoCode, videoData);
            }
            if (videoData.like === true && videoData.download === false) {
                sendDownloadRequest(videoCode);
            }
            displayWatchTime(videoCode, videoData.datetime);

            // Create new handlers that capture current videoCode
            const capturedVideoCode = videoCode;

            currentLikeHandler = async () => {
                // Wait for YouTube to update the button state
                await new Promise(r => setTimeout(r, 150));

                const isNowLiked = likeBtn.getAttribute('aria-pressed') === 'true';
                const freshData = await db.get(capturedVideoCode);
                if (!freshData) return;

                const updatedData = { ...freshData, like: isNowLiked };
                await db.put(capturedVideoCode, updatedData);
                if (isNowLiked && !freshData.download) {
                    sendDownloadRequest(capturedVideoCode);
                }
            };

            currentDislikeHandler = async () => {
                await new Promise(r => setTimeout(r, 150));

                const isNowDisliked = dislikeBtn.getAttribute('aria-pressed') === 'true';
                const freshData = await db.get(capturedVideoCode);
                if (!freshData) return;

                await db.put(capturedVideoCode, { ...freshData, dislike: isNowDisliked });
            };

            likeBtn.addEventListener('click', currentLikeHandler);
            dislikeBtn.addEventListener('click', currentDislikeHandler);
            currentLikeBtn = likeBtn;
            currentDislikeBtn = dislikeBtn;

        }, 1000);
    };

    function monitorSearchResults() {
        let lastCount = 0;

        return setInterval(async () => {
            if (!window.location.pathname.startsWith('/results')) {
                lastCount = 0;
                return;
            }
            const videos = document.querySelectorAll('ytd-video-renderer');
            if (videos.length === lastCount) return;
            lastCount = videos.length;

            videos.forEach(video => {
                const link = video.querySelector('a#video-title');
                if (!link) return;
                const videoCode = new URL(link.href).searchParams.get('v');
                if (!videoCode) return;

                db.get(videoCode).then((videoData) => {
                    if (!videoData) return;
                    video.style.border = '2px solid orange';
                    video.style.borderRadius = '15px';
                    const timeElem = createElement('p', {
                        textContent: new Date(videoData.datetime * 1000).toLocaleString('sk-SK').replaceAll(". ", "."),
                        style: "margin-left: auto; color: orange; font-size: 1.8rem; line-height: 2.6rem; text-wrap: nowrap",
                        class: 'yt-tracker-watch-time',
                        events: {
                            mouseover: (e) => { e.target.title = formatTimeDifference(new Date(videoData.datetime * 1000).getTime()); }
                        }
                    });
                    const titleContainer = video.querySelector('h3.title-and-badge');
                    if (titleContainer) {
                        const existing = titleContainer.querySelector('.yt-tracker-watch-time');
                        if (existing) existing.remove();
                        titleContainer.style.display = 'flex';
                        titleContainer.appendChild(timeElem);
                    }
                });
            });
        }, 1000);
    };

    function monitorMainPage() {
        const styles = `
            .yt-tracker-border {
                border: 2px solid orange;
                border-radius: 15px;
            }
        `;
        const styleSheet = createElement('style', { textContent: styles });
        document.head.appendChild(styleSheet);

        let lastCount = 0;
        return setInterval(async () => {
            if (window.location.pathname !== '/' || document.querySelector("ytd-rich-grid-renderer > #contents")?.getClientRects().length === 0) {
                lastCount = 0;
                return;
            }
            const videos = document.querySelectorAll("ytd-rich-grid-media > #dismissible")
            if (videos.length === lastCount) return;
            lastCount = videos.length;

            videos.forEach(video => {
                const link = video.querySelector('a');
                if (!link) return;
                const videoCode = new URL(link.href).searchParams.get('v');
                if (!videoCode) return;

                db.get(videoCode).then((videoData) => {
                    video.classList.remove("yt-tracker-border")
                    video.querySelector('.yt-tracker-watch-time')?.remove();

                    if (!videoData) return;
                    video.classList.add("yt-tracker-border")
                    const timeElem = createElement('p', {
                        textContent: new Date(videoData.datetime * 1000).toLocaleString('sk-SK').replaceAll(". ", "."),
                        style: "margin-left: auto; margin-right: auto; color: orange; font-size: 1.8rem; line-height: 2.6rem; text-wrap: nowrap",
                        class: 'yt-tracker-watch-time',
                        events: {
                            mouseover: (e) => { e.target.title = formatTimeDifference(new Date(videoData.datetime * 1000).getTime()); }
                        }
                    });
                    video.appendChild(timeElem);
                });
            });
        }, 1000);
    };

    ////////////////////////////////
    ////////// Run Script //////////
    ////////////////////////////////

    monitorVideoPage();
    monitorSearchResults();
    monitorMainPage();
    ApiMonitor.start();

    // Exported functions

    async function download(translateDatetime = false, returnCallback = undefined) {
        const dbInstance = await dbPromise;
        const transaction = dbInstance.transaction(STORE_NAME, "readonly");
        const objectStore = transaction.objectStore(STORE_NAME);
        const cursorRequest = objectStore.openCursor();
        const data = [];

        cursorRequest.onsuccess = function (e) {
            const cursor = e.target.result;
            if (cursor) {
                data.push({
                    key: cursor.key,
                    ...cursor.value
                });
                cursor.continue();
            } else {
                console.log(`Finished reading store "${STORE_NAME}"`);
                data.sort((a, b) => a.datetime - b.datetime);
                if (translateDatetime) {
                    data.forEach((item) => {
                        const date = new Date(item.datetime * 1000);
                        const day = ('0' + date.getDate()).slice(-2);
                        const month = ('0' + (date.getMonth() + 1)).slice(-2);
                        const year = date.getFullYear();
                        const hours = ('0' + date.getHours()).slice(-2);
                        const minutes = ('0' + date.getMinutes()).slice(-2);
                        const seconds = ('0' + date.getSeconds()).slice(-2);
                        item.datetime = `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
                    })
                }

                if (returnCallback) {
                    returnCallback(data);
                    return;
                }

                const dataStr = JSON.stringify(data, null, 2);
                const blob = new Blob([dataStr], { type: "application/json" });
                const url = URL.createObjectURL(blob);

                const a = document.createElement("a");
                a.href = url;
                a.download = DB_NAME + '.json';
                document.body.appendChild(a);
                a.click();

                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 100);
            }
        };

        cursorRequest.onerror = function (e) {
            console.error(`Error reading store "${STORE_NAME}" with cursor:`, e);
        };
    }

    async function size() {
        const dbInstance = await dbPromise;
        const transaction = dbInstance.transaction(STORE_NAME, "readonly");
        const objectStore = transaction.objectStore(STORE_NAME);
        let totalBytes = 0;

        const cursorRequest = objectStore.openCursor();
        cursorRequest.onsuccess = function (e) {
            const cursor = e.target.result;
            if (cursor) {
                const recordString = JSON.stringify({ key: cursor.key, ...cursor.value });
                totalBytes += new Blob([recordString]).size;
                cursor.continue();
            } else {
                console.log(`Estimated storage size for store "${STORE_NAME}": ${totalBytes / 1000} kilobytes`);
            }
        };

        cursorRequest.onerror = function (e) {
            console.error(`Error reading store "${STORE_NAME}" for size calculation:`, e);
        };
    }

    /**
     * Accept either datetime representation and return unix seconds.
     * The store holds numbers; download() emits "DD.MM.YYYY HH:MM:SS".
     * @param {string|number} value
     * @returns {number} Unix seconds, or 0 if it cannot be read
     */
    function parseDatetime(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;

        if (typeof value === 'string') {
            const match = /^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
            if (match) {
                const [, d, mo, y, h, mi, s] = match.map(Number);
                return Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000);
            }
            const parsed = Date.parse(value);
            if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
        }

        return 0;
    }

    async function upload() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';

            input.addEventListener('change', async () => {
                const file = input.files[0];
                if (!file) return resolve(null);

                let data;
                try {
                    data = JSON.parse(await file.text());
                } catch (e) {
                    console.error('[YT-Tracker] Invalid JSON:', e);
                    return reject('Invalid JSON file');
                }

                if (!Array.isArray(data)) {
                    console.error('[YT-Tracker] Expected an array');
                    return reject('Expected an array');
                }

                const dbInstance = await dbPromise;
                const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);

                store.clear().onsuccess = () => {
                    for (const { key, ...videoData } of data) {
                        // download() writes datetime out as "DD.MM.YYYY HH:MM:SS"
                        // for readability. Storing that string back would leave
                        // every date as Invalid Date, so turn it back into the
                        // unix seconds the rest of the script expects.
                        store.put({ ...videoData, datetime: parseDatetime(videoData.datetime) }, key);
                    }
                };

                transaction.oncomplete = () => {
                    console.log(`[YT-Tracker] Uploaded ${data.length} record(s) to "${STORE_NAME}"`);
                    resolve(data.length);
                };
                transaction.onerror = (e) => {
                    console.error('[YT-Tracker] Upload error:', e);
                    reject(e);
                };
            });

            input.click();
        });
    }

    unsafeWindow.download = download;
    unsafeWindow.size = size;
    unsafeWindow.upload = upload;
})();
