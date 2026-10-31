'use strict';
// macOS: sign the app so it runs on Apple Silicon without a paid Apple Developer ID.
// With TS_SIGN_IDENTITY set (a self-signed certificate imported in CI), the signature stays the
// same across versions, so macOS keeps camera / microphone / screen permissions after updates.
// Without it, the app is ad-hoc signed and macOS may ask for permissions again after each update.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const identity = process.env.TS_SIGN_IDENTITY || '-';
  const args = ['--force', '--deep', '--sign', identity];
  if (process.env.TS_SIGN_KEYCHAIN) args.push('--keychain', process.env.TS_SIGN_KEYCHAIN);
  execFileSync('codesign', [...args, app], { stdio: 'inherit' });
  execFileSync('codesign', ['--display', '--requirements', '-', app], { stdio: 'inherit' });
  console.log(`${identity === '-' ? 'ad-hoc' : 'certificate'} signed ${app}`);
};
