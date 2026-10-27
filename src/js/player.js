'use strict';
/*
 * Timeline preview. Each clip gets its own hidden <video> (and <audio> for a
 * separate track); the playhead drives them and the canvas composes the frame,
 * including transitions.
 */
TS.player = {
  t: 0,
  playing: false,
  visible: false,
  els: new Map(),
  auds: new Map(),
  music: null,
  L: { starts: [], durs: [], trans: [], total: 0 },
  clips: [],
  active: [],
  needSync: true,

  init() {
    this.canvas = TS.$('#pvCanvas');
    this.ctx = this.canvas.getContext('2d');
    TS.$('#pvPlay').onclick = () => this.toggle();
    TS.$('#pvStart').onclick = () => this.setTime(0);
    TS.$('#pvEnd').onclick = () => this.setTime(this.L.total);
    TS.$('#pvBack').onclick = () => this.step(-1);
    TS.$('#pvFwd').onclick = () => this.step(1);
    TS.store.on(r => r === 'change' && this.refresh());
    this.refresh();
    const loop = () => {
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  refresh() {
    const p = TS.store.project;
    this.clips = p.clips;
    this.L = TSTiming.layout(p.clips);
    if (this.t > this.L.total) this.t = this.L.total;
    const ids = new Set(p.clips.map(c => c.id));
    for (const [id, e] of this.els) if (!ids.has(id)) { this.kill(e); this.els.delete(id); }
    for (const [id, e] of this.auds) if (!ids.has(id)) { this.kill(e); this.auds.delete(id); }
    this.needSync = true;
    TS.$('#pvEmpty').classList.toggle('on', !p.clips.length);
    TS.$('#pvTotal').textContent = TS.fmt(this.L.total);
    this.emitTime();
  },

  kill(e) {
    e.pause();
    e.removeAttribute('src');
    e.load();
  },

  mediaEl(map, key, path, tag) {
    let e = map.get(key);
    const url = api.fileUrl(path);
    if (!e) {
      e = document.createElement(tag);
      e.preload = 'auto';
      if (tag === 'video') e.playsInline = true;
      map.set(key, e);
    }
    if (e.dataset.src !== url) {
      e.dataset.src = url;
      e.src = url;
    }
    return e;
  },

  setTime(t) {
    this.t = TS.clamp(t, 0, this.L.total);
    if (this.playing) {
      this.playT0 = this.t;
      this.playStart = performance.now();
    }
    this.sync(true);
    this.emitTime();
  },

  step(frames) {
    if (this.playing) this.pause();
    this.setTime(this.t + frames / 30);
  },

  play() {
    if (!this.clips.length) return;
    if (this.t >= this.L.total - 0.02) this.t = 0;
    this.playing = true;
    this.playT0 = this.t;
    this.playStart = performance.now();
    this.sync(true);
    this.updateButton();
  },

  pause() {
    this.playing = false;
    for (const e of this.els.values()) e.pause();
    for (const e of this.auds.values()) e.pause();
    if (this.music) this.music.pause();
    this.sync(true);
    this.updateButton();
  },

  toggle() { this.playing ? this.pause() : this.play(); },

  updateButton() {
    TS.$('#pvPlay').innerHTML = TS.icon(this.playing ? 'pause' : 'play');
  },

  syncMedia(e, local, force) {
    if (this.playing) {
      const drift = Math.abs(e.currentTime - local);
      if (drift > 0.3 || (force && drift > 0.05)) e.currentTime = local;
      if (e.paused) e.play().catch(() => {});
    } else {
      if (!e.paused) e.pause();
      if (Math.abs(e.currentTime - local) > 0.015) e.currentTime = local;
    }
  },

  sync(force) {
    const { L, clips } = this;
    const t = this.t;
    let active = TSTiming.activeAt(L, t);
    if (!active.length && clips.length && t >= L.total - 0.001) active = [clips.length - 1];
    this.active = active;
    const used = new Set();

    active.forEach((i, k) => {
      const c = clips[i];
      const m = TS.store.media(c.mediaId);
      if (!m || m.missing) return;
      const v = this.mediaEl(this.els, c.id, m.path, 'video');
      used.add(v);
      const into = Math.min(t - L.starts[i], L.durs[i] - 0.001);
      this.syncMedia(v, c.in + into, force);

      let g = 1;
      if (active.length === 2) {
        const b = L.trans[active[0]];
        const p = TS.clamp((t - L.starts[active[1]]) / (b.d || 1), 0, 1);
        g = k === 0 ? 1 - p : p;
      }
      const a = c.audio || { mode: 'original' };
      const vol = TS.clamp((a.volume == null ? 1 : a.volume) * g, 0, 1);
      v.muted = a.mode !== 'original';
      v.volume = vol;

      if (a.mode === 'file' && a.mediaId) {
        const am = TS.store.media(a.mediaId);
        if (am && !am.missing) {
          const ae = this.mediaEl(this.auds, c.id, am.path, 'audio');
          used.add(ae);
          const al = (a.offset || 0) + into;
          if (al < 0 || (am.duration && al >= am.duration)) { if (!ae.paused) ae.pause(); }
          else { ae.volume = vol; this.syncMedia(ae, al, force); }
        }
      }
    });
    for (const e of this.els.values()) if (!used.has(e) && !e.paused) e.pause();
    for (const e of this.auds.values()) if (!used.has(e) && !e.paused) e.pause();

    // background music (loops)
    const mu = TS.store.project.music;
    const mm = mu && mu.mediaId && TS.store.media(mu.mediaId);
    if (mm && !mm.missing && clips.length) {
      if (!this.music || this.music.dataset.src !== api.fileUrl(mm.path)) {
        if (this.music) this.kill(this.music);
        this.music = document.createElement('audio');
        this.music.dataset.src = api.fileUrl(mm.path);
        this.music.src = this.music.dataset.src;
      }
      this.music.volume = TS.clamp(mu.volume, 0, 1);
      const ml = mm.duration ? t % mm.duration : t;
      this.syncMedia(this.music, ml, force);
    } else if (this.music) {
      this.kill(this.music);
      this.music = null;
    }
    this.needSync = false;
  },

  frame() {
    if (!this.visible) return;
    if (this.playing) {
      this.t = this.playT0 + (performance.now() - this.playStart) / 1000;
      if (this.t >= this.L.total) {
        this.t = this.L.total;
        this.pause();
      } else {
        this.sync(false);
      }
      this.emitTime(true);
    } else if (this.needSync) {
      this.sync(true);
    }
    this.draw();
  },

  draw() {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const act = this.active;
    if (!act.length) return;
    const el = i => this.els.get(this.clips[i] && this.clips[i].id);
    if (act.length === 1) {
      const v = el(act[0]);
      if (v && v.readyState >= 2) TS.drawContain(ctx, v, 0, 0, W, H);
    } else {
      const b = this.L.trans[act[0]];
      const p = TS.clamp((this.t - this.L.starts[act[1]]) / (b.d || 1), 0, 1);
      TS.drawTransition(ctx, b.type, el(act[0]), el(act[1]), p, W, H);
    }
  },

  emitTime(playing) {
    TS.$('#pvTime').textContent = TS.fmt(this.t);
    if (TS.timeline) TS.timeline.setPlayhead(this.t, playing);
  },

  setVisible(v) {
    this.visible = v;
    if (!v && this.playing) this.pause();
    if (v) this.needSync = true;
  }
};
