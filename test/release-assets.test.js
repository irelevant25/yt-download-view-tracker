/**
 * scripts/clean-release-assets.js against a fake GitHub API.
 *
 * The case that matters: electron-builder leaves a *draft* release with an
 * asset on it. GET /releases/tags/{tag} never returns drafts, so an earlier
 * version of the script reported "nothing to clean" and the duplicate shipped.
 */
const https = require('https');
const { PassThrough } = require('stream');

process.env.GITHUB_REPOSITORY = 'owner/repo';
process.env.GITHUB_TOKEN = 'test-token';
delete process.env.CI;

const deleted = [];
let authSeen = true;

const releases = [
    // left by electron-builder: a draft for the tag, with its unversioned exe
    { id: 1, tag_name: 'v9.9.9', draft: true, assets: [{ id: 11, name: 'YouTube-Checker.exe', size: 10 }] },
    // a different tag entirely — must not be touched
    { id: 2, tag_name: 'v1.0.0', draft: false, assets: [{ id: 21, name: 'YouTube-Checker-1.0.0.exe', size: 10 }] },
    // a published release for the same tag from an earlier run
    { id: 3, tag_name: 'v9.9.9', draft: false, assets: [{ id: 31, name: 'YouTube-Checker-9.9.9.exe', size: 10 }] }
];

https.request = (options, cb) => {
    if (options.headers?.Authorization !== 'Bearer test-token') authSeen = false;

    const res = new PassThrough();
    let status = 404;
    let body = '';

    if (options.method === 'GET' && options.path.startsWith('/repos/owner/repo/releases?')) {
        status = 200;
        body = JSON.stringify(releases);
    } else if (options.method === 'GET' && options.path.startsWith('/repos/owner/repo/releases/tags/')) {
        // mirror the real API: drafts are invisible here
        const tag = decodeURIComponent(options.path.split('/').pop());
        const found = releases.find(r => r.tag_name === tag && !r.draft);
        status = found ? 200 : 404;
        body = found ? JSON.stringify(found) : '{"message":"Not Found"}';
    } else if (options.method === 'DELETE') {
        deleted.push(Number(options.path.split('/').pop()));
        status = 204;
    }

    res.statusCode = status;
    setImmediate(() => { cb(res); res.end(body); });
    return { on() { return this; }, end() {} };
};

const results = [];
const check = (name, got, want) => results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

(async () => {
    const script = require('../scripts/clean-release-assets');
    const origLog = console.log;
    console.log = () => {};

    // dry run deletes nothing
    process.argv = ['node', 'clean', 'v9.9.9'];
    await script.main();
    check('dry run deletes nothing', deleted.length, 0);

    process.argv = ['node', 'clean', 'v9.9.9', '--yes'];
    await script.main();
    console.log = origLog;

    check("draft's asset deleted (the bug)", deleted.includes(11), true);
    check('published release asset deleted', deleted.includes(31), true);
    check('other tag untouched', deleted.includes(21), false);
    check('exactly two deletions', deleted.length, 2);
    check('token sent on every call', authSeen, true);

    // --keep-versioned: tidy an existing release without losing the real exe
    deleted.length = 0;
    console.log = () => {};
    process.argv = ['node', 'clean', 'v9.9.9', '--keep-versioned', '--yes'];
    await script.main();
    console.log = origLog;
    check('--keep-versioned removes the stray', deleted.includes(11), true);
    check('--keep-versioned keeps the versioned exe', deleted.includes(31), false);

    console.log('');
    for (const r of results) {
        console.log(`${r.pass ? '  ok  ' : '  FAIL'} | ${r.name.padEnd(36)} got=${JSON.stringify(r.got)}`);
    }
    const failed = results.filter(r => !r.pass).length;
    console.log('\n' + (failed ? `${failed} FAILURES` : `all ${results.length} checks pass`));
    process.exit(failed ? 1 : 0);
})();
