/**
 * Setup script for app
 * Creates necessary directories and default configuration
 */
const fs = require('fs');
const path = require('path');

// Paths to create
const dirsToCreate = [
    'videos',
    'logs',
    'bin'
];

// Create directories
dirsToCreate.forEach(dir => {
    const dirPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(dirPath)) {
        console.log(`Creating directory: ${dir}`);
        fs.mkdirSync(dirPath, { recursive: true });
    }
});

// Create default empty JSON if it doesn't exist
const downloadedVideosFile = path.join(__dirname, '..', 'downloaded_videos.json');
if (!fs.existsSync(downloadedVideosFile)) {
    console.log('Creating empty downloaded_videos.json file');
    fs.writeFileSync(downloadedVideosFile, '[]');
}

// Instructions for binary dependencies
console.log('\nSetup complete!');
console.log('\nIMPORTANT: You need to download the following files manually:');
console.log('1. ffmpeg.exe - Place in the "bin" directory');
console.log('2. yt-dlp.exe - Place in the "bin" directory');
console.log('\nThese files are required for the application to function correctly.');