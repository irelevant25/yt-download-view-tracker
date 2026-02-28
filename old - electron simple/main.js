const { app, BrowserWindow, Tray, Menu, Notification } = require('electron');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const mm = require('music-metadata');
const cors = require('cors');
const fs = require('fs');
const { exec } = require('child_process');

// ----- STATIC VALUES & PATHS -----
const PORT = 5000;
const DOWNLOADED_VIDEOS_FILE_JSON = 'downloaded_videos.json';
const APP_NAME = 'youtube-checker';
const VIDEOS_DIRECTORY = 'videos';
const LOGS_DIRECTORY = 'logs';
const MERGE_OUTPUT_FORMAT = 'mp4';

// Base directory (either __dirname or the executable's directory)
const exePath = process.env.PORTABLE_EXECUTABLE_DIR ?? __dirname;

// Full paths for assets and logs
const DOWNLOADED_VIDEOS_FILE_JSON_PATH = path.join(exePath, DOWNLOADED_VIDEOS_FILE_JSON);
const FFMPEG_PATH = path.join(exePath, 'ffmpeg.exe');
const YTDLP_PATH = path.join(exePath, 'yt-dlp.exe');
const VIDEOS_DIRECTORY_PATH = path.join(exePath, VIDEOS_DIRECTORY);

// ----- GLOBAL VARIABLES -----
let mainWindow;
let downloadedVideos = [];
let tray = null;
let downloading = []; // Videos currently being downloaded
let isQuiting = false;
let messageQueue = [];

// ----- EXPRESS SERVER & API SETUP -----
const appServer = express();
appServer.use(cors());
appServer.use(bodyParser.json({ limit: '50mb' }));
appServer.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

function loadAllDownloadedVideos() {
    fs.readdir(VIDEOS_DIRECTORY_PATH, async (err, files) => {
        if (err) {
            return console.error('Unable to scan directory:', err);
        }

        // Filter files that have the desired extension
        const filteredFiles = files.filter(file => path.extname(file) === `.${MERGE_OUTPUT_FORMAT}`);
        
        // Loop through each file and parse metadata
        for (const file of filteredFiles) {
            const filePath = path.join(VIDEOS_DIRECTORY_PATH, file);
            try {
                // music-metadata returns a promise
                const metadata = await mm.parseFile(filePath);

                // "comment" is usually an array in metadata.common.comment
                const comments = metadata.common.comment;
                if (Array.isArray(comments) && comments.length > 0) {
                    // We assume the first comment is the URL you stored
                    downloadedVideos.push(comments[0].replace(/\\=/g, '='));
                }
            } catch (parseErr) {
                console.error('Error reading metadata:', parseErr);
            }
        }
    });
}

function readDownloadedVideosData() {
    if (!fs.existsSync(DOWNLOADED_VIDEOS_FILE_JSON_PATH)) {
        return [];
    }
    try {
        const fileContent = fs.readFileSync(DOWNLOADED_VIDEOS_FILE_JSON_PATH, 'utf-8');
        return JSON.parse(fileContent);
    }
    catch (error) {
        return undefined;
    }
}

function saveDownloadedVideosData(data) {
    fs.writeFileSync(DOWNLOADED_VIDEOS_FILE_JSON_PATH, JSON.stringify(data, null, 2));
}

// Download a YouTube video using yt-dlp
function download(videoUrl, options) {
    const args = [videoUrl];

    // Build command-line arguments dynamically
    Object.keys(options).forEach((key) => {
        let option = `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
        if (options[key] === true) {
            args.push(option);
        } else if (options[key] !== false) {
            args.push(option, options[key].toString());
        }
    });

    // Log file for the download (using the URL's query part)
    const loggingPath = path.join(exePath, `${LOGS_DIRECTORY}/${videoUrl.split('=').pop()}.log`);
    const ytDlpPath = path.resolve(YTDLP_PATH);
    const command = `"${ytDlpPath}" ${args.join(' ')} --verbose >> "${loggingPath}" 2>&1`;

    logMessage(`Executing command: ${command}`, 'green');

    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                logMessage(`Error: ${error.message}`, 'red');
                reject(false);
                return;
            }
            resolve(true);
        });
    });
}

// Handle the asynchronous download
async function handleDownload(videoUrl) {
    try {
        const success = await download(videoUrl, {
            ffmpegLocation: FFMPEG_PATH,
            format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
            output: VIDEOS_DIRECTORY_PATH + '/%(title)s.%(ext)s',
            writeSub: true,
            subLang: 'en',
            subFormat: 'srt',
            mergeOutputFormat: MERGE_OUTPUT_FORMAT,
            httpChunkSize: '10M',
            forceIpv4: true,
            exec: `"ffmpeg -y -i {} -metadata comment=${videoUrl} -c copy -f mp4 {}.temp.mp4 && move /Y {}.temp.mp4 {}"`
        });

        if (success) {
            downloading = downloading.filter((x) => x !== videoUrl);
            logMessage(`Download completed: ${videoUrl}`, 'blue');
            downloadedVideos.push(videoUrl);
        } else {
            downloading = downloading.filter((x) => x !== videoUrl);
            logMessage(`Error downloading video: ${videoUrl}`, 'red');
        }
    } catch (err) {
        logMessage(`Exception during download: ${err}`, 'red');
    }
}

// API endpoint for download requests
appServer.post('/download', (req, res) => {
    const videoUrl = req.body.url;
    if (!videoUrl) {
        return res.status(400).send('No video URL provided');
    }
    console.log(downloadedVideos);
    if (downloadedVideos.includes(videoUrl) || downloading.includes(videoUrl)) {
        logMessage(`Video already downloaded: ${videoUrl}`, 'blue');
        return res.status(200).json({ message: 'Video already downloaded.' });
    }
    logMessage(`Received request to download: ${videoUrl}`, 'blue');
    downloading.push(videoUrl);
    handleDownload(videoUrl);
    return res.status(200).json({ message: 'Video download successfully started.' });
});

// API endpoint for download requests
appServer.post('/upload-db', (req, res) => {
    const data = req.body.data;
    if (!data) {
        return res.status(400).send('No data were provided');
    }
    const savedData = readDownloadedVideosData();
    logMessage(`Received request to save data: ${data.length} record/s`);
    if (savedData?.length === data.length) {        
        logMessage('Data has not changed.');
        return res.status(200).json({ message: 'Data has not changed.' });
    }
    if (savedData?.length > data.length) {
        logMessage(`Received request to save data but already saved data has: ${savedData?.length} record/s => something is wrong!`, 'red');
        logMessage(`Most likely the data were cleared. To avoid loosing data, futher investigation is required.`, 'red');
        logMessage(`Possible solution is to upload data from the file to the browser indexedDB.`, 'red');
        showNotification('Recieved data are smaller than saved data! Something went wrong!');
        return res.status(400).send({ message: 'Data were not saved.' });
    }
    else {
        saveDownloadedVideosData(data);
        logMessage('Data saved successfully.');
        return res.status(200).json({ message: 'Data saved successfully.' });
    }
});

appServer.get('', (req, res) => {
    return res.status(200).json({ message: 'API is running.' });
});

// Start the Express server
function runApi() {
    appServer.listen(PORT, () => {
        logMessage(`Server is running on http://localhost:${PORT}`);
    });
}

function showNotification(title, body) {
    new Notification({ title, body }).show();
}

// ----- REGISTRY PROTOCOL REGISTRATION (Windows only) -----
// This block registers a custom protocol (youtube-checker://) so the app can be launched from a browser.
function register() {
    const exePathForRegistry = path.resolve(process.execPath);
    const commands = [
        `reg add "HKEY_CLASSES_ROOT\\${APP_NAME}" /ve /d "URL:${APP_NAME} Protocol" /f`,
        `reg add "HKEY_CLASSES_ROOT\\${APP_NAME}" /v "URL Protocol" /f`,
        `reg add "HKEY_CLASSES_ROOT\\${APP_NAME}\\shell" /f`,
        `reg add "HKEY_CLASSES_ROOT\\${APP_NAME}\\shell\\open" /f`,
        `reg add "HKEY_CLASSES_ROOT\\${APP_NAME}\\shell\\open\\command" /ve /d "\\"${exePathForRegistry}\\" \\"%1\\"" /f`
    ];
    const checkProtocolCmd = `reg query "HKEY_CLASSES_ROOT\\${APP_NAME}"`;

    const runCommandsSequentially = (commands, index = 0) => {
        if (index >= commands.length) {
            logMessage('Protocol added successfully.');
            return;
        }
        exec(commands[index], (error, stdout, stderr) => {
            if (error) {
                logMessage(`Error executing command: ${commands[index]}\nError: ${error.message}`, 'red');
                return;
            }
            logMessage(`Command executed successfully: ${commands[index]}`);
            if (index === commands.length - 1) {
                runApi();
            }
            runCommandsSequentially(commands, index + 1);
        });
    };

    exec(checkProtocolCmd, (error, stdout, stderr) => {
        if (error) {
            logMessage("Registry key doesn't exist. Adding now...");
            runCommandsSequentially(commands);
        } else {
            logMessage('Registry key already exists. No action needed.');
            runApi();
        }
    });
}

// ----- ELECTRON WINDOW & TRAY SETUP -----
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false, // start hidden
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    mainWindow.loadFile('index.html');
    mainWindow.on('close', (event) => {
        if (!isQuiting) {
            event.preventDefault(); // Prevents the window from closing
            mainWindow.hide();      // Hides the window, keeping it running in the tray
        }
    });
}

// Custom logging function that writes to console and sends messages to the renderer
function logMessage(message, type) {
    const datetime = new Date().toLocaleString();
    if (mainWindow && mainWindow.webContents) {
        if (messageQueue.length > 0) {
            messageQueue.forEach((item) => {
                mainWindow.webContents.send('log', item.datetime, item.message, item.type);
            });
            messageQueue = [];
        }
        mainWindow.webContents.send('log', datetime, message, type);
    }
    else {
        messageQueue.push({ message, type, datetime });
    }
}

// ----- APP LIFECYCLE -----
app.on('ready', () => {
    createWindow();

    // Create tray icon (make sure icon.png exists in your project directory)
    tray = new Tray(path.join(__dirname, 'icon.png'));
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show/Hide',
            click: () => {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.show();
                }
            }
        },
        {
            label: 'Open devtools',
            click: () => {
                mainWindow.webContents.openDevTools();
            }
        },
        {
            label: 'Exit',
            click: () => {
                isQuiting = true;
                app.quit();
            }
        }
    ]);
    tray.setToolTip('youtube-checker');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
        }
    });

    // Start the API. On Windows, register the protocol first.
    if (process.platform === 'win32') {
        register();
    } else {
        runApi();
    }
    loadAllDownloadedVideos();
    showNotification("Youtube downloader is running", "Hidden by default. Display it in tray");
});

// Prevent quitting when all windows are closed (app stays in the tray)
app.on('window-all-closed', () => {
    // Do nothing here so that the process stays alive in the tray
});