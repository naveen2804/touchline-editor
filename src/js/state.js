'use strict';
/* Project store with undo/redo and autosave. */

TS.newProject = () => ({
  version: 1,
  name: 'Untitled project',
  filePath: null,
  media: [],
  clips: [],
  music: { mediaId: null, volume: 0.25 },
  settings: { height: 1080, fps: 30 }
});

TS.makeClip = m => ({
  id: TS.uid(),
  mediaId: m.id,
  in: 0,
  out: m.duration,
  audio: {
    mode: m.hasAudio ? 'original' : 'none', mediaId: null, offset: 0,
    volume: m.defaultVolume == null ? 1 : m.defaultVolume,
    fx: m.defaultFx ? { ...m.defaultFx } : null
  },
  transition: { type: 'none', duration: 0.6 }
});

TS.store = {
  project: TS.newProject(),
  sel: null,
  listeners: new Set(),
  history: [],
  future: [],
  lastKey: null,
  lastTime: 0,

  on(fn) { this.listeners.add(fn); },
  emit(reason) { this.listeners.forEach(fn => fn(reason)); },

  snapshot() { return JSON.stringify(this.project); },

  /** Mutate the project; `key` coalesces rapid edits (sliders) into one undo step. */
  commit(fn, key) {
    const now = Date.now();
    if (!(key && key === this.lastKey && now - this.lastTime < 1200)) this.pushHistory();
    this.lastKey = key || null;
    this.lastTime = now;
    fn(this.project);
    this.changed();
  },
  /** Record an undo point before a live edit (e.g. dragging a trim handle). */
  checkpoint() {
    this.pushHistory();
    this.lastKey = null;
  },
  pushHistory() {
    this.history.push(this.snapshot());
    if (this.history.length > 80) this.history.shift();
    this.future = [];
  },
  undo() {
    if (!this.history.length) return TS.toast('Nothing to undo');
    this.future.push(this.snapshot());
    this.restore(this.history.pop());
  },
  redo() {
    if (!this.future.length) return TS.toast('Nothing to redo');
    this.history.push(this.snapshot());
    this.restore(this.future.pop());
  },
  restore(json) {
    const keepPath = this.project.filePath;
    this.project = JSON.parse(json);
    this.project.filePath = keepPath;
    this.lastKey = null;
    if (this.sel && this.sel !== 'music' && !this.clip(this.sel)) this.sel = null;
    this.changed();
  },
  load(p) {
    this.project = Object.assign(TS.newProject(), p);
    this.history = [];
    this.future = [];
    this.sel = null;
    this.changed();
  },
  changed() {
    this.emit('change');
    this.scheduleSave();
  },
  select(id) {
    if (this.sel === id) return;
    this.sel = id;
    this.emit('select');
  },
  scheduleSave() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => window.api.autosave(this.snapshot()), 700);
  },

  media(id) { return id ? this.project.media.find(m => m.id === id) : null; },
  clip(id) { return id ? this.project.clips.find(c => c.id === id) : null; },
  clipIndex(id) { return this.project.clips.findIndex(c => c.id === id); },
  selectedClip() { return this.clip(this.sel); }
};
