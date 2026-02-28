const { execSync } = require('child_process');
const package = require('./package.json');

// Read the current Node.js version from nvm
function getCurrentNodeVersion() {
  try {
    const currentVersion = execSync('node -v', { encoding: 'utf-8' }).trim();
    return currentVersion;
  } catch (error) {
    console.error('Error fetching current Node.js version:', error);
    process.exit(1);
  }
}

// Read the required Node.js version from package.json
function getRequiredNodeVersion() {
  try {
    return package.engines.node;
  } catch (error) {
    console.error('Error reading package.json:', error);
    process.exit(1);
  }
}

// Switch Node.js version using nvm
function switchNodeVersion(version) {
  try {
    execSync(`nvm use ${version}`, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Error switching to Node.js version ${version}:`, error);
    process.exit(1);
  }
}

const currentVersion = getCurrentNodeVersion();
const requiredVersion = getRequiredNodeVersion();

console.log('currentVersion: ', currentVersion);
console.log('requiredVersion: ', requiredVersion);

// Compare versions and switch if necessary
if (currentVersion !== `v${requiredVersion}`) {
  console.log(`Switching to Node.js version ${requiredVersion}`);
  switchNodeVersion(requiredVersion);
  console.log('Please restart the script');
} else {
  console.log(`Node.js version is already set to ${currentVersion}`);
}
