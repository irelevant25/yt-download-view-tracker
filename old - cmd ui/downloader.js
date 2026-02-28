const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

// static values
const PORT = 5000; // port to listen on
const DOWNLOADED_VIDEOS_FILE = 'downloaded_videos.txt'; // Path to the JSON file that stores downloaded URLs
const APP_NAME = 'youtube-checker'; // App name for register
const VIDEOS_DIRECTORY = 'videos';

// ANSI escape codes for colors
const reset = '\x1b[0m';
const red = '\x1b[31m';
const green = '\x1b[32m';
const blue = '\x1b[34m';
const yellowBold = '\x1b[1m\x1b[33m';
const bgCyan = '\x1b[46m';

// Function to determine if the app is running as a packaged executable
const isPackaged = () => {
  return typeof process.pkg !== 'undefined';
};

console.log(`${blue}isPackaged: ${isPackaged()}${reset}`);
// console.log(`isPackaged: ${isPackaged()}`);

// Get the base path based on the environment
const exePath = isPackaged() ? path.dirname(process.execPath) : __dirname;
// const exePath = path.dirname(process.execPath);

// Construct the full path to the files in the same directory as the executable
const DOWNLOADED_VIDEOS_FILE_PATH = path.join(exePath, DOWNLOADED_VIDEOS_FILE);
const FFMPEG_PATH = path.join(exePath, 'ffmpeg.exe');
const YTDLP_PATH = path.join(exePath, 'yt-dlp.exe');
const VIDEOS_DIRECTORY_PATH = path.join(exePath, VIDEOS_DIRECTORY);

// global variables
let downloading = []; // Array to store currently downloading videos
const app = express(); // Initialize Express app
app.use(cors()); // Enable CORS for all origins
app.use(bodyParser.json()); // Middleware to parse incoming requests as JSON

// Helper function to read downloaded URLs from the text file
function readDownloadedVideos() {
  if (!fs.existsSync(DOWNLOADED_VIDEOS_FILE_PATH)) {
    return [];
  }
  const fileContent = fs.readFileSync(DOWNLOADED_VIDEOS_FILE_PATH, 'utf-8');
  return fileContent.split('\n').filter((line) => line.trim() !== '');
}

// Helper function to save new downloaded URLs to the text file
function saveDownloadedVideo(videoUrl) {
  fs.appendFileSync(DOWNLOADED_VIDEOS_FILE_PATH, videoUrl + '\n');
}

// download the youtube video using yt-dlp
function download(videoUrl, ytDlpPath, options) {
  const args = [videoUrl];

  // Dynamic argument construction
  Object.keys(options).forEach((key) => {
    let option = `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    if (options[key] === true) {
      // If the option is boolean true, just push the option itself
      args.push(option);
    } else if (options[key] !== false) {
      // For other non-false values, push both the option and its value
      args.push(option, options[key].toString());
    }
  });

  // console.log(ytDlpPath);

  // add logging
  const loggingPath = path.join(exePath, `logs/${videoUrl.split('=').pop()}.log`);
  // args.push(`--verbose >> ${loggingPath} 2>&1`);

  // print whole command
  // console.log(args.join(' '));

  // Adjust paths if not using absolute paths
  ytDlpPath = path.resolve(ytDlpPath);

  // Append verbose logging with shell redirection
  const command = `"${ytDlpPath}" ${args.join(' ')} --verbose >> "${loggingPath}" 2>&1`;

  console.log(`Executing command: ${green}${command}${reset}`);

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
        reject(false);
        return;
      }
      // Optionally, you can log stdout or stderr if needed
      // console.log(`stdout: ${stdout}`);
      // console.error(`stderr: ${stderr}`);
      resolve(true);
    });
  });

  // const process = spawn(ytDlpPath, args);
  // return new Promise((resolve, reject) => {
  //   // let output = '';
  //   // process.stdout.on('data', (data) => {
  //   //   output += data.toString();
  //   // });

  //   // process.stderr.on('data', (data) => {
  //   //   console.error('stderr:', data.toString());
  //   // });

  //   process.on('close', (code) => {
  //     if (code === 0) {
  //       resolve(true);
  //     } else {
  //       console.log(new Error(`Process exited with code ${code}`));
  //       reject(false);
  //     }
  //   });
  // });
}

// Helper function to handle asynchronous downloads
async function handleDownload(videoUrl) {
  try {
    const success = await download(videoUrl, YTDLP_PATH, {
      ffmpegLocation: FFMPEG_PATH,
      format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
      output: VIDEOS_DIRECTORY_PATH + '/%(title)s.%(ext)s',
      writeSub: true,
      subLang: 'en',
      subFormat: 'srt',
      mergeOutputFormat: 'mp4',
      httpChunkSize: '10M',
      forceIpv4: true,
    });

    if (success) {
      downloading = downloading.filter((x) => x !== videoUrl);
      console.log(`${blue}Download completed: ${videoUrl}${reset}`);
      // console.log('Download completed');
      // Save the downloaded video URL
      saveDownloadedVideo(videoUrl);
    } else {
      downloading = downloading.filter((x) => x !== videoUrl);
      console.error('Error downloading video');
    }
  } catch {
    console.log('Press Enter to exit the program');
    process.stdin.once('data', () => process.exit(0));
  }
}

/////////
// API //
/////////

// Endpoint to handle download requests
app.post('/download', (req, res) => {
  const videoUrl = req.body.url;

  if (!videoUrl) {
    return res.status(400).send('No video URL provided');
  }

  // Check if the video was already downloaded
  const downloadedVideos = readDownloadedVideos();
  if (downloadedVideos.includes(videoUrl) || downloading.includes(videoUrl)) {
    console.log(`${blue}Video already downloaded: ${videoUrl}${reset}`);
    // console.log('Video already downloaded:', videoUrl);
    return res.status(200).json({ message: 'Video already downloaded.' });
  }

  console.log(`${blue}VReceived request to download: ${videoUrl}${reset}`);
  // console.log('Received request to download:', videoUrl);
  downloading.push(videoUrl);

  // Run the download asynchronously
  handleDownload(videoUrl);

  return res.status(200).json({ message: 'Video download successfully started.' });
});

function runApi() {
  // Start the server
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

//////////////
// REGISTER //
//////////////

// Helper function to check if the registry key exists and if not then create it
// for capability to run it from browser
function register() {
  // Get the current directory and executable file name
  const exePath = path.resolve(process.argv[0]);

  // Escape backslashes for Windows registry
  // const escapedExePath = exePath.replace(/\\/g, '\\\\');

  // Commands to add registry keys (sequentially)
  const commands = [
    `reg add "HKEY_CLASSES_ROOT\\${APP_NAME}" /ve /d "URL:${APP_NAME} Protocol" /f`,
    `reg add "HKEY_CLASSES_ROOT\\${APP_NAME}" /v "URL Protocol" /f`,
    `reg add "HKEY_CLASSES_ROOT\\${APP_NAME}\\shell" /f`,
    `reg add "HKEY_CLASSES_ROOT\\${APP_NAME}\\shell\\open" /f`,
    `reg add "HKEY_CLASSES_ROOT\\${APP_NAME}\\shell\\open\\command" /ve /d "\\"${exePath}\\" \\"%1\\"" /f`,
  ];

  // Command to check if the registry key exists
  const checkProtocolCmd = `reg query "HKEY_CLASSES_ROOT\\${APP_NAME}"`;

  // Function to run commands sequentially
  const runCommandsSequentially = (commands, index = 0) => {
    if (index >= commands.length) {
      console.log('Protocol added successfully.');
      return;
    }

    exec(commands[index], (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${commands[index]}\nError: ${error.message}`);
        return;
      }
      console.log(`Command executed successfully: ${commands[index]}`);
      if (index === commands.length - 1) {
        runApi();
      }
      runCommandsSequentially(commands, index + 1);
    });
  };

  // Check if the protocol exists
  exec(checkProtocolCmd, (error, stdout, stderr) => {
    if (error) {
      // Key does not exist, so we create it step by step
      console.log("Registry key doesn't exist. Adding now...");
      runCommandsSequentially(commands);
    } else {
      // Key exists, no need to add it again
      console.log('Registry key already exists. No action needed.');
      runApi();
    }
  });
}

try {
  register();
} catch {
  console.log('Press Enter to exit the program');
  process.stdin.once('data', () => process.exit(0));
}

// [`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`].forEach((eventType) => {
//   process.on(eventType, function (e) {
//     console.log(eventType);
//     if (eventType === 'uncaughtException') {
//       console.log(e.stack);
//     } else if (eventType === 'SIGINT') {
//       console.log('Press Enter to exit the program');
//       process.stdin.once('data', () => process.exit(0));
//     } else {
//       console.log(e.stack);
//     }
//   });
// });
