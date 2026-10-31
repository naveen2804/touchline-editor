/*
 * Voice enhancement: one definition shared by the export (FFmpeg filter graph),
 * the preview renderer (FFmpeg, cached) and the UI.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TSAudioFx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT = { preset: 'none', noise: 0, rumble: false, compress: false, level: false };

  const PRESETS = [
    { id: 'none', label: 'Natural' },
    { id: 'clear', label: 'Clear voice' },
    { id: 'warm', label: 'Warm' },
    { id: 'broadcast', label: 'Broadcast' }
  ];
  const NOISE = ['Off', 'Light', 'Medium', 'Strong'];

  const eq = (f, g, w = 1) => `equalizer=f=${f}:t=q:w=${w}:g=${g}`;
  const PRESET_CHAIN = {
    none: [],
    clear: ['highpass=f=80', eq(250, -2), eq(3500, 3, 1.2), 'treble=g=1.5:f=9000'],
    warm: ['highpass=f=60', 'bass=g=3:f=140', eq(4000, 1), 'treble=g=-2:f=9000'],
    broadcast: ['highpass=f=90', eq(180, 2), eq(400, -3), eq(3000, 4, 1.2), 'treble=g=-1:f=10000',
      'acompressor=threshold=0.125:ratio=4:attack=5:release=150:makeup=2']
  };
  const NOISE_CHAIN = [null, 'afftdn=nr=8:nf=-45:tn=1', 'afftdn=nr=14:nf=-40:tn=1', 'afftdn=nr=22:nf=-35:tn=1'];

  function norm(fx) {
    const f = Object.assign({}, DEFAULT, fx || {});
    if (!PRESET_CHAIN[f.preset]) f.preset = 'none';
    f.noise = Math.max(0, Math.min(3, Math.round(+f.noise || 0)));
    f.rumble = !!f.rumble;
    f.compress = !!f.compress;
    f.level = !!f.level;
    return f;
  }

  function isActive(fx) {
    const f = norm(fx);
    return f.preset !== 'none' || f.noise > 0 || f.rumble || f.compress || f.level;
  }

  /** FFmpeg filters for the enhancement itself (volume/limiter are added separately). */
  function chain(fx) {
    const f = norm(fx);
    const out = [];
    if (f.rumble) out.push('highpass=f=80');
    if (f.noise) out.push(NOISE_CHAIN[f.noise]);
    out.push(...PRESET_CHAIN[f.preset]);
    if (f.compress) out.push('acompressor=threshold=0.1:ratio=3:attack=10:release=200:makeup=2');
    if (f.level) out.push('dynaudnorm=f=200:g=11:p=0.9:m=8');
    return out;
  }

  /** Volume + a limiter whenever the signal could clip. */
  function gainChain(volume, fx) {
    const v = volume == null ? 1 : +volume;
    const out = [`volume=${v.toFixed(3)}`];
    if (v > 1.001 || isActive(fx)) out.push('alimiter=limit=0.97:level=0');
    return out;
  }

  function key(fx) {
    return JSON.stringify(norm(fx));
  }

  function describe(fx) {
    const f = norm(fx);
    const parts = [];
    if (f.preset !== 'none') parts.push(PRESETS.find(p => p.id === f.preset).label);
    if (f.noise) parts.push(`${NOISE[f.noise]} noise reduction`);
    if (f.rumble) parts.push('rumble removed');
    if (f.compress) parts.push('evened out');
    if (f.level) parts.push('auto level');
    return parts.join(' · ');
  }

  const toDb = v => (v <= 0 ? -Infinity : 20 * Math.log10(v));

  return { DEFAULT, PRESETS, NOISE, norm, isActive, chain, gainChain, key, describe, toDb };
});
