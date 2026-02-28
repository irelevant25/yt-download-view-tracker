/**
 * Enhanced build script with process killing
 */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { rimraf } = require('rimraf');

// Define paths
const distPath = path.join(__dirname, 'dist');

console.log('Preparing for build...');

// 1. Kill any running electron processes (Windows-specific)
function killProcesses() {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            console.log('Attempting to kill any running Electron processes...');
            exec('taskkill /F /IM electron.exe /T', (error) => {
                if (error) {
                    console.log('No Electron processes found or could not kill them');
                } else {
                    console.log('Successfully killed Electron processes');
                }

                // Also try to kill any YouTube Checker processes
                exec('taskkill /F /IM "YouTube Checker.exe" /T', (error) => {
                    if (error) {
                        console.log('No YouTube Checker processes found or could not kill them');
                    } else {
                        console.log('Successfully killed YouTube Checker processes');
                    }
                    resolve();
                });
            });
        } else {
            resolve();
        }
    });
}

// 2. Clean the dist folder with extra checks
function cleanDist() {
    console.log('Cleaning dist folder...');

    // Check if dist exists
    if (!fs.existsSync(distPath)) {
        console.log('Dist folder does not exist. Nothing to clean.');
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        // Use rimraf with a force option
        rimraf(distPath, { maxRetries: 5, retryDelay: 1000 }, (err) => {
            if (err) {
                console.error('Failed to clean dist folder:', err);

                // If rimraf fails, try Windows command directly as a last resort
                if (process.platform === 'win32') {
                    console.log('Attempting stronger cleanup with Windows commands...');
                    exec('rd /s /q "' + distPath + '"', (cmdErr) => {
                        if (cmdErr) {
                            console.error('Command line cleanup also failed:', cmdErr);
                            reject(cmdErr);
                        } else {
                            console.log('Dist folder cleaned via command line.');
                            resolve();
                        }
                    });
                } else {
                    reject(err);
                }
            } else {
                console.log('Dist folder cleaned successfully.');
                resolve();
            }
        });
    });
}

// Run the sequence
async function buildWithCleanup() {
    try {
        await killProcesses();
        await cleanDist();
        console.log('✅ Clean completed!');
    } catch (error) {
        console.error('Clean process failed:', error);
        process.exit(1);
    }
}

// Run the build process
buildWithCleanup();