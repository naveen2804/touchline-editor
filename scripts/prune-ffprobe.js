'use strict';
// Keep only the ffprobe binary for the platform/arch being packaged (saves ~200 MB per installer).
// Usage: node scripts/prune-ffprobe.js <win32|darwin|linux> <x64|arm64>
const fs = require('fs');
const path = require('path');

const [platform = process.platform, arch = process.arch] = process.argv.slice(2);
const bin = path.join(__dirname, '..', 'node_modules', 'ffprobe-static', 'bin');
if (!fs.existsSync(path.join(bin, platform, arch))) {
  console.error(`No ffprobe binary for ${platform}/${arch} — run npm install first.`);
  process.exit(1);
}
for (const p of fs.readdirSync(bin)) {
  for (const a of fs.readdirSync(path.join(bin, p))) {
    if (p !== platform || a !== arch) {
      fs.rmSync(path.join(bin, p, a), { recursive: true, force: true });
      console.log(`removed ffprobe ${p}/${a}`);
    }
  }
}
