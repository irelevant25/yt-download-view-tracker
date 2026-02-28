const { ipcRenderer } = require('electron');
const logContainer = document.getElementById('logContainer');

ipcRenderer.on('log', (event, datetime, message, type) => {
    const messageWrapper = document.createElement('div');
    messageWrapper.classList.add('message-wrapper');
    logContainer.appendChild(messageWrapper);

    const logTimestamp = document.createElement('div');
    logTimestamp.classList.add('timestamp');
    logTimestamp.textContent = datetime;
    messageWrapper.appendChild(logTimestamp);

    const logMessage = document.createElement('div');
    logMessage.textContent = message;
    if (type) {
        logMessage.classList.add(type);
    }
    messageWrapper.appendChild(logMessage);
    
    // Auto-scroll to the bottom
    logContainer.scrollTop = logContainer.scrollHeight;
});