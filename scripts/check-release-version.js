#!/usr/bin/env node
/**
 * Release tag guard. Fails unless the tag in RELEASE_TAG (vX.Y.Z) equals the
 * version in package.json, packages/cli/package.json and, when present,
 * packages/desktop/src-tauri/tauri.conf.json (tauri-action names the GitHub
 * release after that one).
 *
 * Run by release.yml and publish.yml before anything is built or published, so
 * a tag cut from an unbumped tree fails in seconds instead of building
 * installers for, or trying to publish, the previous version.
 *
 * Usage: RELEASE_TAG=v2.0.2 node scripts/check-release-version.js
 *        (a tag may also be passed as the first argument)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const tag = (process.argv[2] || process.env.RELEASE_TAG || '').trim();

const MANIFESTS = [
    'package.json',
    'packages/cli/package.json',
    'packages/desktop/src-tauri/tauri.conf.json',
];

function fail(msg) {
    console.error(`::error::${msg}`);
    console.error(`check-release-version: ${msg}`);
    process.exit(1);
}

if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
    fail(`tag '${tag}' is not of the form vX.Y.Z`);
}
const expected = tag.slice(1);

const mismatches = [];
for (const rel of MANIFESTS) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
        // Only the optional desktop manifest may be absent.
        if (rel.includes('tauri.conf.json')) continue;
        fail(`${rel} not found`);
    }
    const version = JSON.parse(fs.readFileSync(file, 'utf8')).version;
    if (version !== expected) mismatches.push(`${rel} is ${version}`);
}

if (mismatches.length) {
    fail(`tag ${tag} does not match the package versions (${mismatches.join('; ')}). Bump the versions and CHANGELOG before tagging.`);
}
console.log(`check-release-version: ${tag} matches ${MANIFESTS.join(', ')}`);
