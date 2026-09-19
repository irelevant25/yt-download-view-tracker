/**
 * Remove every asset attached to a GitHub release.
 *
 * softprops/action-gh-release adds to whatever release already exists for the
 * tag, draft or not, and only overwrites an asset whose name matches exactly.
 * Anything already there stays: an exe from a re-run under a different name,
 * or — the cause of every duplicate this repo's releases ever had — the
 * unversioned exe electron-builder auto-published to a draft because GH_TOKEN
 * was set during the build. Clearing first means a tag always ends up with
 * exactly what the current build produced.
 *
 * Usage:
 *   node scripts/clean-release-assets.js v2.0.2                    # dry run, lists only
 *   node scripts/clean-release-assets.js v2.0.2 --yes              # delete every asset
 *   node scripts/clean-release-assets.js v2.0.2 --keep-versioned --yes
 *       # tidy an existing release: keep YouTube-Checker-2.0.2.exe, delete the rest
 *
 * Requires GITHUB_TOKEN (or GH_TOKEN) with contents:write on the repository.
 * The repository is taken from GITHUB_REPOSITORY, or the origin remote.
 */
const https = require('https');
const { execFileSync } = require('child_process');

const API_HOST = 'api.github.com';

function log(msg) {
    console.log(`[clean-release-assets] ${msg}`);
}

/**
 * owner/repo, from the Actions environment or the git remote.
 * @returns {string}
 */
function resolveRepository() {
    if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;

    // execFileSync, not execSync: no shell, consistent with the rest of the
    // codebase (see CLAUDE.md).
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf-8' }).trim();
    const match = /github\.com[:/]([^/]+\/[^/.]+)/.exec(url);
    if (!match) throw new Error(`Cannot work out owner/repo from remote: ${url}`);
    return match[1];
}

function token() {
    const value = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!value) throw new Error('GITHUB_TOKEN (or GH_TOKEN) is not set');
    return value;
}

/**
 * One GitHub API call. Never follows redirects, so the token stays on this host.
 * @param {string} method
 * @param {string} path
 * @returns {Promise<{status: number, body: string}>}
 */
function api(method, path) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                host: API_HOST,
                path,
                method,
                headers: {
                    'User-Agent': 'youtube-checker-app',
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${token()}`
                }
            },
            (res) => {
                let data = '';
                res.on('data', c => (data += c));
                res.on('end', () => resolve({ status: res.statusCode, body: data }));
            }
        );
        req.on('error', reject);
        req.end();
    });
}

async function main() {
    const tag = process.argv[2];
    const confirmed = process.argv.includes('--yes') || process.env.CI === 'true';
    const keepName = process.argv.includes('--keep-versioned')
        ? `YouTube-Checker-${String(tag).replace(/^v/, '')}.exe`
        : null;

    if (!tag) {
        console.error('Usage: node scripts/clean-release-assets.js <tag> [--yes]');
        process.exit(2);
    }

    const repo = resolveRepository();
    log(`Repository: ${repo}`);
    log(`Tag: ${tag}`);

    // Not GET /releases/tags/{tag}: that endpoint never returns drafts, and a
    // draft is exactly what a stray publisher (electron-builder, by default)
    // leaves behind. The list endpoint includes drafts when authenticated.
    const listing = await api('GET', `/repos/${repo}/releases?per_page=100`);
    if (listing.status !== 200) {
        throw new Error(`Could not list releases (HTTP ${listing.status}): ${listing.body.slice(0, 200)}`);
    }

    const releases = JSON.parse(listing.body).filter(r => r.tag_name === tag);

    if (releases.length === 0) {
        log('No release exists for this tag yet — nothing to clean.');
        return;
    }

    for (const release of releases) {
        log(`Release ${release.id} (${release.draft ? 'draft' : 'published'}) with ${release.assets.length} asset(s).`);
    }

    const assets = releases
        .flatMap(r => r.assets || [])
        .filter(a => a.name !== keepName);

    if (keepName) log(`Keeping ${keepName}.`);

    if (assets.length === 0) {
        log('Nothing to delete.');
        return;
    }

    log(`Found ${assets.length} asset(s):`);
    for (const asset of assets) {
        log(`   ${asset.name}  (${(asset.size / 1048576).toFixed(1)} MB)`);
    }

    if (!confirmed) {
        log('Dry run. Re-run with --yes to delete these.');
        return;
    }

    for (const asset of assets) {
        const res = await api('DELETE', `/repos/${repo}/releases/assets/${asset.id}`);
        if (res.status === 204) {
            log(`Deleted ${asset.name}`);
        } else {
            throw new Error(`Failed to delete ${asset.name} (HTTP ${res.status}): ${res.body.slice(0, 200)}`);
        }
    }

    log('Release assets cleared.');
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`[clean-release-assets] ERROR: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { main };
