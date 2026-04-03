#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const childProcess = require('child_process');

const GITHUB_REPO = 'xqoma/slack-mcp-server';

const BINARY_MAP = {
    darwin_x64:   { name: 'slack-mcp-server-darwin-amd64',    suffix: '' },
    darwin_arm64: { name: 'slack-mcp-server-darwin-arm64',    suffix: '' },
    linux_x64:    { name: 'slack-mcp-server-linux-amd64',     suffix: '' },
    linux_arm64:  { name: 'slack-mcp-server-linux-arm64',     suffix: '' },
    win32_x64:    { name: 'slack-mcp-server-windows-amd64',   suffix: '.exe' },
    win32_arm64:  { name: 'slack-mcp-server-windows-arm64',   suffix: '.exe' },
};

function getBinaryInfo() {
    const key = `${process.platform}_${process.arch}`;
    const binary = BINARY_MAP[key];
    if (!binary) {
        throw new Error(`Unsupported platform/arch: ${process.platform}/${process.arch}`);
    }
    return binary;
}

function getCacheDir() {
    const cacheDir = path.join(os.homedir(), '.cache', 'slack-mcp-server');
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
}

function getLatestRelease() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_REPO}/releases/latest`,
            headers: { 'User-Agent': 'slack-mcp-server-installer' },
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const follow = (url) => {
            https.get(url, { headers: { 'User-Agent': 'slack-mcp-server-installer' } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return follow(res.headers.location);
                }
                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
                file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
            }).on('error', reject);
        };
        follow(url);
    });
}

async function resolveBinaryPath() {
    const binary = getBinaryInfo();
    const binaryFileName = `${binary.name}${binary.suffix}`;
    const cacheDir = getCacheDir();
    const cachedBinary = path.join(cacheDir, binaryFileName);

    if (fs.existsSync(cachedBinary)) {
        return cachedBinary;
    }

    process.stderr.write(`Downloading ${binaryFileName} from GitHub Releases...\n`);

    const release = await getLatestRelease();
    const asset = release.assets && release.assets.find(a => a.name === binaryFileName);
    if (!asset) {
        throw new Error(`Binary ${binaryFileName} not found in latest release ${release.tag_name}`);
    }

    await downloadFile(asset.browser_download_url, cachedBinary);
    fs.chmodSync(cachedBinary, 0o755);

    process.stderr.write(`Downloaded to ${cachedBinary}\n`);
    return cachedBinary;
}

resolveBinaryPath().then(binPath => {
    childProcess.execFileSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
}).catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
});

