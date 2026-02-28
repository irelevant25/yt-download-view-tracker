// ==UserScript==
// @name         YouTube Video Tracker
// @namespace    http://tampermonkey.net/
// @version      2024-11-28
// @description  Monitor YouTube video interactions efficiently while complying with Trusted Types.
// @author       irelevant
// @match        *://*.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    ////////////////////////////////
    ////////// Trusted Types ///////
    ////////////////////////////////

    const isTrustedTypesSupported = () => {
        return window.TrustedTypes && window.TrustedTypes.createPolicy;
    };

    let trustedTypesPolicy = null;

    if (isTrustedTypesSupported()) {
        trustedTypesPolicy = window.TrustedTypes.createPolicy('ytTrackerPolicy', {
            createHTML: (input) => {
                return input;
            }
        });
    }

    ////////////////////////////////
    ////////// IndexedDB //////////
    ////////////////////////////////

    const DB_NAME = "YouTubeWatchTracker";
    const STORE_NAME = "videos";

    // Use exact same pattern as original
    const dbPromise = new Promise((resolve, reject) => {
        console.log('[YT-Tracker] Opening IndexedDB...');
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = ({ target }) => {
            console.log('[YT-Tracker] IndexedDB upgrade needed');
            const db = target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "videoCode" });
                console.log('[YT-Tracker] Created object store');
            }
        };

        request.onsuccess = ({ target }) => {
            console.log('[YT-Tracker] IndexedDB opened successfully');
            resolve(target.result);
        };

        request.onerror = ({ target }) => {
            console.error('[YT-Tracker] IndexedDB Error:', target.error);
            reject(`IndexedDB Error: ${target.errorCode}`);
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
            if (isTrustedTypesSupported() && trustedTypesPolicy) {
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

        if (options) {
            Object.entries(options).forEach(([key, value]) => el.setAttribute(key, value));
        }

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

    let apiAvailable = false;

    function customFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {},
                data: options.body,
                onload: (response) => {
                    resolve({
                        ok: response.status >= 200 && response.status < 300,
                        status: response.status,
                        text: () => Promise.resolve(response.responseText),
                        json: () => Promise.resolve(JSON.parse(response.responseText))
                    });
                },
                onerror: (error) => reject(error)
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

    async function isUrlLive(url, tries = 3, interval = 1000) {
        for (let i = 0; i < tries; i++) {
            try {
                const response = await customFetch(url);
                return response.ok;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, interval));
            }
        }
    };

    ////////////////////////////////
    ////////// API Modal ///////////
    ////////////////////////////////

    function showApiModal() {
        return new Promise((resolve) => {
            const overlay = createElement('div', {
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

            const message = createElement('p', {
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
                }
            });

            const runBtn = createElement('button', {
                textContent: 'Run',
                styles: {
                    padding: '8px 20px',
                    cursor: 'pointer',
                    backgroundColor: '#2e7d32',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px'
                }
            });

            let isStartingState = false;

            cancelBtn.addEventListener('click', () => {
                overlay.remove();
                resolve(false);
            });

            runBtn.addEventListener('click', async () => {
                window.location.href = APP_NAME;
                if (!isStartingState) {
                    isStartingState = true;
                    message.textContent = 'Starting API...';
                    runBtn.textContent = 'Try Again';
                    runBtn.style.display = 'none';
                    if (await isUrlLive(API_URL)) {
                        overlay.remove();
                        resolve(true);
                    }
                    else {
                        isStartingState = false;
                        runBtn.style.display = '';
                        runBtn.textContent = 'Try Again';
                        message.textContent = 'API could not be started';
                    }
                }
            });

            btnContainer.append(cancelBtn, runBtn);
            modal.append(message, btnContainer);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        });
    }

    async function uploadDBToApi() {
        download(true, async (data) => {
            try {
                await customFetch(API_URL + '/upload-db', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data })
                });
            } catch (error) {
                console.error(error);
            }
            return true;
        });
    }

    async function startApi() {
        if (await isUrlLive(API_URL, 1)) {
            apiAvailable = true;
            return await uploadDBToApi();
        }

        const result = await showApiModal();
        if (result) {
            apiAvailable = true;
            return await uploadDBToApi()
        }

        return false;
    }

    async function sendDownloadRequest(videoCode) {
        // Check conditions first
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
            NotificationSystem.success('Already downloaded', 2000);
            return;
        }

        // Check API availability
        if (!apiAvailable) {
            apiAvailable = await isUrlLive(API_URL);
        }

        if (!apiAvailable) {
            NotificationSystem.error('API is not running', 2000);
            return;
        }

        const videoUrl = `https://www.youtube.com/watch?v=${videoCode}`;

        try {
            const response = await customFetch(API_URL + '/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: videoUrl })
            });
            const result = await response.json();
            NotificationSystem.success(result.message, 0);

            // Mark as downloaded
            await db.put(videoCode, { ...video, download: true });
        } catch (error) {
            NotificationSystem.error('Failed to send download request.', 0);
            console.error(error);
        }
    };

    function displayWatchTime(videoCode, timestamp) {
        const interval = setInterval(() => {
            const title = document.querySelector('#title > h1');
            if (title) {
                clearInterval(interval);
                const existing = title.querySelector('.yt-tracker-watch-time');
                if (existing) existing.remove();

                const watchTime = createElement('p', {
                    textContent: new Date(timestamp * 1000).toLocaleString('sk-SK').replaceAll(". ", "."),
                    style: "margin-left: auto; color: orange; cursor: default; text-wrap: nowrap",
                    class: 'yt-tracker-watch-time',
                    events: {
                        mouseover: (e) => { e.target.title = formatTimeDifference(new Date(timestamp * 1000).getTime()); }
                    }
                });
                title.style.display = 'flex';
                title.append(watchTime);
            }
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

            let videoData = await db.get(videoCode);
            const like = likeBtn.getAttribute('aria-pressed') === 'true';
            const dislike = dislikeBtn.getAttribute('aria-pressed') === 'true';
            if (!videoData || videoData.like !== like || videoData.dislike !== dislike) {
                videoData = {
                    title,
                    datetime: Math.floor(Date.now() / 1000),
                    like,
                    dislike,
                    download: false
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

    const run = async () => {
        monitorVideoPage();
        monitorSearchResults();
        monitorMainPage();
        await startApi();
    };

    run();

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
                console.log(data);
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

    window.download = download;
    window.size = size;
})();