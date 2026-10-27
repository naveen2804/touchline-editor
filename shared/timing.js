/*
 * Timeline maths shared by the editor (preview) and the exporter (FFmpeg graph).
 * A transition between clip i and i+1 overlaps the end of clip i with the start
 * of clip i+1, so the next clip starts `td` seconds before the previous one ends.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TSTiming = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN_CLIP = 0.1;

  function clipDur(c) {
    return Math.max(MIN_CLIP, (+c.out || 0) - (+c.in || 0));
  }

  /**
   * @param {Array} clips  timeline clips ({in,out,transition:{type,duration}})
   * @param {number} [fps] when given, durations are snapped to whole frames (export)
   */
  function layout(clips, fps) {
    const q = v => (fps ? Math.max(1, Math.round(v * fps)) / fps : v);
    const durs = clips.map(c => q(clipDur(c)));
    const trans = clips.slice(0, -1).map((c, i) => {
      const t = c.transition || {};
      const type = t.type || 'none';
      if (type === 'none') return { type: 'none', d: 0 };
      // each side of a clip can give at most half its length to a transition
      let maxD = Math.min(durs[i], durs[i + 1]) / 2;
      if (fps) maxD = Math.floor(maxD * fps) / fps;
      let d = Math.min(Math.max(0.1, +t.duration || 0.6), maxD);
      if (fps) d = Math.round(d * fps) / fps;
      if (!(d >= 0.05)) return { type: 'none', d: 0 };
      return { type, d };
    });
    const starts = [];
    let t = 0;
    durs.forEach((d, i) => {
      starts.push(t);
      t += d - (i < trans.length ? trans[i].d : 0);
    });
    return { starts, durs, trans, total: clips.length ? t : 0 };
  }

  /** indices of clips visible at time t (2 during a transition) */
  function activeAt(L, t) {
    const out = [];
    for (let i = 0; i < L.starts.length; i++) {
      if (t >= L.starts[i] && t < L.starts[i] + L.durs[i]) out.push(i);
    }
    return out;
  }

  return { layout, activeAt, clipDur, MIN_CLIP };
});
