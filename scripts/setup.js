/**
 * Setup script for app
 * Creates necessary directories, default data files, and downloads required binaries.
 *
 * Usage: node scripts/setup.js
 */
const fs = require('fs');
const path = require('path');
const { main: installBinaries } = require('./install-binaries');

// Directories to create
const dirsToCreate = ['videos', 'logs', 'bin'];

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

console.log('\nSetup: directories ready. Downloading binaries...\n');

installBinaries().then(ok => {
    if (ok) {
        console.log('\nSetup complete! You can now run: npm run dev');
    } else {
        console.error('\nSetup finished with errors. Check messages above.');
        process.exit(1);
    }
});
