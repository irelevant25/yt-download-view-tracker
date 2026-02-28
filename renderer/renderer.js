/**
 * App - Renderer Process
 * Handles the UI for log display and user interaction
 */
const { ipcRenderer } = require('electron');
const logContainer = document.getElementById('logContainer');
const clearBtn = document.getElementById('clearBtn');
const scrollLockBtn = document.getElementById('scrollLockBtn');
const downloadCount = document.getElementById('downloadCount');

// Application State
let isScrollLocked = false;
let downloadedVideos = new Set();

// Register event listeners
document.addEventListener('DOMContentLoaded', initializeUI);
clearBtn.addEventListener('click', clearLogs);
scrollLockBtn.addEventListener('click', toggleScrollLock);

/**
 * Initialize the UI components
 */
function initializeUI() {
    // Listen for log messages from the main process
    ipcRenderer.on('log', handleLogMessage);

    // Listen for download status updates
    ipcRenderer.on('download-completed', handleDownloadCompleted);

    // Add initial welcome message
    addLogMessage(
        new Date().toLocaleString(),
        'App started. Logs will appear here.',
        'green'
    );

    ipcRenderer.send('ui-initialized');
}

/**
 * Handle incoming log messages from the main process
 * @param {Event} event - IPC event
 * @param {string} datetime - Timestamp
 * @param {string} message - Log message
 * @param {string} type - Message type/color
 */
function handleLogMessage(event, datetime, message, type) {
    addLogMessage(datetime, message, type);

    // Count downloads (basic parsing of log messages)
    if (message.startsWith('Download completed:')) {
        const url = message.replace('Download completed:', '').trim();
        downloadedVideos.add(url);
        updateDownloadCount();
    }
}

/**
 * Add a new log message to the UI
 * @param {string} datetime - Timestamp
 * @param {string} message - Log message
 * @param {string} type - Message type/color
 */
function addLogMessage(datetime, message, type) {
    // Create message wrapper
    const messageWrapper = document.createElement('div');
    messageWrapper.classList.add('message-wrapper');

    // Create timestamp element
    const timestampElement = document.createElement('div');
    timestampElement.classList.add('timestamp');
    timestampElement.textContent = datetime;

    // Create message element
    const messageElement = document.createElement('div');
    messageElement.textContent = message;
    if (type) {
        messageElement.classList.add(type);
    }

    // Assemble and add to container
    messageWrapper.appendChild(timestampElement);
    messageWrapper.appendChild(messageElement);
    logContainer.appendChild(messageWrapper);

    // Auto-scroll to bottom if not locked
    if (!isScrollLocked) {
        scrollToBottom();
    }
}

/**
 * Handle completed download notification
 * @param {Event} event - IPC event
 * @param {string} url - Video URL
 */
function handleDownloadCompleted(event, url) {
    downloadedVideos.add(url);
    updateDownloadCount();
}

/**
 * Update the download counter display
 */
function updateDownloadCount() {
    downloadCount.textContent = downloadedVideos.size;
}

/**
 * Clear all log messages
 */
function clearLogs() {
    logContainer.innerHTML = '';
    addLogMessage(
        new Date().toLocaleString(),
        'Logs cleared',
        'blue'
    );
}

/**
 * Toggle scroll lock state
 */
function toggleScrollLock() {
    isScrollLocked = !isScrollLocked;
    scrollLockBtn.classList.toggle('locked', isScrollLocked);

    if (!isScrollLocked) {
        scrollToBottom();
    }
}

/**
 * Scroll to the bottom of the log container
 */
function scrollToBottom() {
    logContainer.scrollTop = logContainer.scrollHeight;
}