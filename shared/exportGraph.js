'use strict';
/*
 * Builds the FFmpeg input list + filter_complex graph for an export.
 * Every clip is normalised (size, fps, pixel format, stereo 48k audio) and then
 * chained with either concat (hard cut) or xfade/acrossfade (transition).
 */
const { layout } = require('./timing');

const XFADE = {
  fade: 'fade',
  dissolve: 'dissolve',
  fadeblack: 'fadeblack',
  fadewhite: 'fadewhite',
  blur: 'hblur',
  slideleft: 'slideleft',
  slideright: 'slideright',
  wipeleft: 'wipeleft',
  circleopen: 'circleopen',
  zoomin: 'zoomin',
  pixelize: 'pixelize'
};

const f3 = x => (Math.round(x * 1000) / 1000).toFixed(3);
const even = n => Math.max(2, Math.round(n / 2) * 2);
const AFMT = 'aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

/**
 * @param {object} spec
 *   clips:    timeline clips
 *   media:    { [mediaId]: { path, hasVideo, hasAudio } }
 *   music:    { mediaId, volume } | null
 *   settings: { width, height, fps }
 * @returns {{inputs:string[], filter:string, maps:string[], duration:number}}
 */
function buildExport({ clips, media, music, settings }) {
  if (!clips || !clips.length) throw new Error('The timeline is empty — add some clips first.');
  const W = even((settings && settings.width) || 1920);
  const H = even((settings && settings.height) || 1080);
  const F = (settings && settings.fps) || 30;
  const L = layout(clips, F);

  const inputs = [];
  const lines = [];
  let idx = 0;

  clips.forEach((c, i) => {
    const m = media[c.mediaId];
    if (!m) throw new Error(`Clip ${i + 1}: its source file is missing.`);
    if (!m.hasVideo) throw new Error(`Clip ${i + 1}: "${m.name || m.path}" has no video.`);
    const d = L.durs[i];

    inputs.push('-ss', f3(+c.in || 0), '-t', f3(d + 0.25), '-i', m.path);
    const vi = idx++;
    lines.push(
      `[${vi}:v]setpts=PTS-STARTPTS,` +
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,` +
        `fps=${F},format=yuv420p,tpad=stop_mode=clone:stop_duration=2,` +
        `trim=duration=${f3(d)},setpts=PTS-STARTPTS,fps=${F}[v${i}]`
    );

    const a = c.audio || { mode: 'original' };
    const vol = a.volume == null ? 1 : +a.volume;
    let src = null;
    let delay = 0;
    if (a.mode === 'original' && m.hasAudio) {
      src = `[${vi}:a]`;
    } else if (a.mode === 'file' && a.mediaId && media[a.mediaId] && media[a.mediaId].hasAudio) {
      const am = media[a.mediaId];
      const off = +a.offset || 0;
      if (off >= 0) {
        inputs.push('-ss', f3(off), '-t', f3(d + 0.25), '-i', am.path);
        src = `[${idx++}:a]`;
      } else if (d + off > 0.05) {
        // negative offset: the audio starts later than the clip → pad with silence
        inputs.push('-t', f3(d + off + 0.25), '-i', am.path);
        src = `[${idx++}:a]`;
        delay = -off;
      }
    }
    if (src) {
      lines.push(
        `${src}asetpts=PTS-STARTPTS,${AFMT}` +
          (delay > 0 ? `,adelay=delays=${Math.round(delay * 1000)}:all=1` : '') +
          `,volume=${f3(vol)},apad,atrim=duration=${f3(d)},asetpts=PTS-STARTPTS[a${i}]`
      );
    } else {
      lines.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f3(d)},${AFMT}[a${i}]`);
    }
  });

  // chain clips together
  let cv = 'v0';
  let ca = 'a0';
  for (let i = 1; i < clips.length; i++) {
    const t = L.trans[i - 1];
    if (t.type === 'none' || !(t.d > 0)) {
      lines.push(`[${cv}][v${i}]concat=n=2:v=1:a=0,fps=${F}[vc${i}]`);
      lines.push(`[${ca}][a${i}]concat=n=2:v=0:a=1[ac${i}]`);
    } else {
      const x = XFADE[t.type] || 'fade';
      lines.push(`[${cv}][v${i}]xfade=transition=${x}:duration=${f3(t.d)}:offset=${f3(L.starts[i])}[vc${i}]`);
      lines.push(`[${ca}][a${i}]acrossfade=d=${f3(t.d)}:c1=tri:c2=tri[ac${i}]`);
    }
    cv = `vc${i}`;
    ca = `ac${i}`;
  }

  let aout = ca;
  if (music && music.mediaId && media[music.mediaId] && media[music.mediaId].hasAudio) {
    const mm = media[music.mediaId];
    inputs.push('-stream_loop', '-1', '-i', mm.path);
    const mi = idx++;
    const mv = music.volume == null ? 0.25 : +music.volume;
    const fadeLen = Math.min(2, L.total / 4);
    lines.push(
      `[${mi}:a]${AFMT},volume=${f3(mv)},atrim=duration=${f3(L.total)},asetpts=PTS-STARTPTS,` +
        `afade=t=out:st=${f3(Math.max(0, L.total - fadeLen))}:d=${f3(fadeLen)}[mus]`
    );
    lines.push(`[${ca}][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amix]`);
    aout = 'amix';
  }

  return {
    inputs,
    filter: lines.join(';\n'),
    maps: ['-map', `[${cv}]`, '-map', `[${aout}]`],
    duration: L.total
  };
}

module.exports = { buildExport, XFADE };
