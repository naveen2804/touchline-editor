'use strict';
/*
 * Video encoder selection for export.
 * Hardware (GPU) encoders are typically 5-10x faster than libx264 on the CPU.
 * Which ones work depends on the machine, so we test-encode a few frames with
 * each candidate once and use the first that succeeds; libx264 is the fallback.
 */
const { spawn } = require('child_process');

const CANDIDATES = {
  win32: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf'],
  darwin: ['h264_videotoolbox'],
  linux: ['h264_nvenc']
};

const LABELS = {
  h264_nvenc: 'NVIDIA graphics (NVENC)',
  h264_qsv: 'Intel graphics (Quick Sync)',
  h264_amf: 'AMD graphics (AMF)',
  h264_mf: 'Windows hardware encoder (Media Foundation)',
  h264_videotoolbox: 'Apple hardware encoder (VideoToolbox)',
  libx264: 'CPU (x264)'
};

/** Target bitrate (Mbps) — based on YouTube's upload recommendations, scaled by quality. */
function targetMbps({ width, height, fps }, quality) {
  const px = (width * height) / (1920 * 1080);
  const base = 8 * Math.pow(px, 0.85) * (fps > 30 ? 1.5 : 1); // ≈ YouTube SDR recommendation
  const mult = { fast: 1, balanced: 1.5, high: 2.2 }[quality] || 1.5;
  return Math.round(base * mult * 10) / 10;
}

/** FFmpeg output args for the chosen encoder. */
function encoderArgs(encoder, settings, quality) {
  if (encoder === 'libx264') {
    const q = {
      fast: ['-preset', 'veryfast', '-crf', '22'],
      balanced: ['-preset', 'veryfast', '-crf', '19'],
      high: ['-preset', 'fast', '-crf', '17']
    }[quality] || ['-preset', 'veryfast', '-crf', '19'];
    return ['-c:v', 'libx264', ...q, '-pix_fmt', 'yuv420p'];
  }
  const mbps = targetMbps(settings, quality);
  const b = `${Math.round(mbps * 1000)}k`;
  const max = `${Math.round(mbps * 1500)}k`;
  const buf = `${Math.round(mbps * 2000)}k`;
  const rate = ['-b:v', b, '-maxrate', max, '-bufsize', buf];
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', quality === 'high' ? 'p6' : quality === 'fast' ? 'p3' : 'p5',
        '-tune', 'hq', '-rc', 'vbr', ...rate, '-spatial_aq', '1', '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', quality === 'high' ? 'slow' : quality === 'fast' ? 'veryfast' : 'medium',
        ...rate, '-profile:v', 'high', '-pix_fmt', 'nv12'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', quality === 'high' ? 'quality' : quality === 'fast' ? 'speed' : 'balanced',
        '-rc', 'vbr_peak', ...rate, '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
    case 'h264_mf':
      return ['-c:v', 'h264_mf', '-hw_encoding', '1', '-rate_control', 'u_vbr', '-b:v', b, '-pix_fmt', 'nv12'];
    case 'h264_videotoolbox':
      return ['-c:v', 'h264_videotoolbox', ...rate, '-profile:v', 'high', '-allow_sw', '0', '-realtime', '0', '-pix_fmt', 'yuv420p'];
    default:
      return encoderArgs('libx264', settings, quality);
  }
}

function tryEncoder(ffmpeg, encoder) {
  return new Promise(resolve => {
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
      '-frames:v', '15', ...encoderArgs(encoder, { width: 1280, height: 720, fps: 30 }, 'balanced'), '-f', 'null', '-'];
    let done = false;
    const p = spawn(ffmpeg, args, { windowsHide: true });
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    const timer = setTimeout(() => { try { p.kill(); } catch {} finish(false); }, 15000);
    p.on('error', () => { clearTimeout(timer); finish(false); });
    p.on('close', code => { clearTimeout(timer); finish(code === 0); });
  });
}

let cache = null;
/** Resolves to the list of working hardware encoders (best first). Runs once per app launch. */
function detectHardware(ffmpeg, platform = process.platform) {
  if (!cache) {
    cache = (async () => {
      const ok = [];
      for (const enc of CANDIDATES[platform] || []) {
        if (await tryEncoder(ffmpeg, enc)) ok.push(enc);
      }
      return ok;
    })();
  }
  return cache;
}

module.exports = { detectHardware, encoderArgs, targetMbps, LABELS, CANDIDATES, tryEncoder };
