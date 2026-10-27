'use strict';
// Checks that every encoder option we pass exists in this platform's bundled FFmpeg,
// then reports which hardware encoders actually work on this machine.
const { spawnSync } = require('child_process');
const FFMPEG = require('ffmpeg-static');
const enc = require('../shared/encoders');

const GENERIC = new Set(['c:v', 'b:v', 'maxrate', 'bufsize', 'pix_fmt']);
const compiled = spawnSync(FFMPEG, ['-hide_banner', '-encoders']).stdout.toString();
let failed = false;

for (const name of [...(enc.CANDIDATES[process.platform] || []), 'libx264']) {
  if (!new RegExp(`\\s${name}\\s`).test(compiled)) {
    console.log(`SKIP  ${name} (not in this FFmpeg build)`);
    continue;
  }
  const help = spawnSync(FFMPEG, ['-hide_banner', '-h', `encoder=${name}`]).stdout.toString();
  for (const q of ['fast', 'balanced', 'high']) {
    const args = enc.encoderArgs(name, { width: 1920, height: 1080, fps: 60 }, q);
    for (let i = 0; i < args.length; i += 2) {
      const opt = args[i].replace(/^-/, '').replace(/:v$/, '');
      if (GENERIC.has(args[i].replace(/^-/, '')) || opt === 'c') continue;
      if (!new RegExp(`^\\s+-${opt}\\s`, 'm').test(help)) {
        console.log(`FAIL  ${name}: option -${opt} not supported`);
        failed = true;
      }
      // enum values (e.g. -preset p5) must be one of the listed choices
      const val = args[i + 1];
      const after = (help.split(new RegExp(`^\\s+-${opt}\\s.*$`, 'm'))[1] || '').split('\n').slice(1);
      const choices = [];
      for (const l of after) {
        if (/^\s{1,4}-/.test(l) || !l.trim()) break; // next option
        const mm = l.match(/^\s{5,}(\S+)/);
        if (mm) choices.push(mm[1]);
      }
      if (choices.length && /^[a-z_][a-z0-9_]*$/i.test(val) && !choices.includes(val)) {
        console.log(`FAIL  ${name}: -${opt} ${val} not one of ${choices.join('/')}`);
        failed = true;
      }
    }
  }
  if (!failed) console.log(`PASS  ${name} options`);
}

enc.detectHardware(FFMPEG).then(hw => {
  console.log(`Working hardware encoders on this machine: ${hw.length ? hw.join(', ') : 'none (CPU export will be used)'}`);
  process.exit(failed ? 1 : 0);
});
