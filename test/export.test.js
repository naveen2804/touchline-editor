'use strict';
// Runs real FFmpeg exports against generated clips and checks the output lengths.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const FFMPEG = require('ffmpeg-static');
const FFPROBE = require('ffprobe-static').path;
const { buildExport, XFADE } = require('../shared/exportGraph');
const { layout } = require('../shared/timing');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-test-'));
const ff = args => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
};
const dur = file => +spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).stdout.toString().trim();
const streams = file => spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]).stdout.toString().trim().split(/\s+/);

// fixtures: different sizes/fps/audio presence, like real phone + screen recordings
const A = path.join(dir, 'face.mp4');
const B = path.join(dir, 'screen.webm');
const C = path.join(dir, 'silent.mov');
const S = path.join(dir, 'song.mp3');
ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=f=440:sample_rate=44100', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', A]);
ff(['-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25', '-f', 'lavfi', '-i', 'sine=f=660', '-t', '5', '-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libopus', '-shortest', B]);
ff(['-f', 'lavfi', '-i', 'mandelbrot=size=720x1280:rate=60', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', C]);
ff(['-f', 'lavfi', '-i', 'sine=f=220', '-t', '3', '-ac', '2', S]);

const media = {
  a: { path: A, hasVideo: true, hasAudio: true },
  b: { path: B, hasVideo: true, hasAudio: true },
  c: { path: C, hasVideo: true, hasAudio: false },
  s: { path: S, hasVideo: false, hasAudio: true }
};
const clip = (mediaId, inn, out, transition = 'none', audio) => ({
  mediaId, in: inn, out, transition: { type: transition, duration: 0.8 }, audio: audio || { mode: 'original', volume: 1 }
});

function run(name, clips, music, settings = { width: 1280, height: 720, fps: 30 }) {
  const g = buildExport({ clips, media, music, settings });
  const script = path.join(dir, name + '.txt');
  fs.writeFileSync(script, g.filter);
  const out = path.join(dir, name + '.mp4');
  ff([...g.inputs, '-filter_complex_script', script, ...g.maps, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-r', String(settings.fps), '-c:a', 'aac', out]);
  const got = dur(out);
  const want = layout(clips, settings.fps).total;
  const ok = Math.abs(got - want) < 0.12 && streams(out).includes('video') && streams(out).includes('audio');
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} expected ${want.toFixed(2)}s  got ${got.toFixed(2)}s`);
  if (!ok) process.exitCode = 1;
}

run('single-clip', [clip('a', 1, 4)]);
run('hard-cuts', [clip('a', 0, 3), clip('b', 1, 4), clip('c', 0, 2)]);
run('mixed-cut-and-fade', [clip('a', 0, 3, 'fade'), clip('b', 0, 3), clip('c', 0, 3, 'blur'), clip('a', 2, 5)]);
run('detached-audio-shifted', [
  clip('a', 1, 4, 'slideleft', { mode: 'file', mediaId: 's', offset: 0.5, volume: 0.8 }),
  clip('c', 0, 3, 'none', { mode: 'file', mediaId: 's', offset: -1, volume: 1 }),
  clip('b', 0, 2, 'none', { mode: 'none' })
]);
run('music-bed-60fps-1080', [clip('b', 0, 4, 'circleopen'), clip('a', 0, 4)], { mediaId: 's', volume: 0.3 }, { width: 1920, height: 1080, fps: 60 });
run('tiny-clips-clamped-trans', [clip('a', 0, 0.3, 'fade'), clip('b', 0, 0.4, 'zoomin'), clip('c', 0, 0.5)]);
for (const t of Object.keys(XFADE)) run('transition-' + t, [clip('a', 0, 2, t), clip('b', 0, 2)]);

fs.rmSync(dir, { recursive: true, force: true });
