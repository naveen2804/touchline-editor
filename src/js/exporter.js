'use strict';
/* Export dialog → FFmpeg in the main process. */

TS.exporter = {
  init() {
    TS.$('#btnExport').innerHTML = `${TS.icon('export')}Export`;
    TS.$('#btnExport').onclick = () => this.open();
    TS.$('#expBrowse').onclick = async () => {
      const p = await api.exportDialog(TS.$('#expPath').value);
      if (p) TS.$('#expPath').value = p;
    };
    TS.$('#expGo').onclick = () => this.run();
    TS.$('#expCancel').onclick = () => (this.running ? api.exportCancel() : TS.closeModal('expModal'));
    TS.$('#expReveal').onclick = () => api.reveal(this.lastOutput);
    ['#expRes', '#expFps', '#expQ'].forEach(s => TS.$(s).addEventListener('change', () => this.summary()));
    api.on('export-progress', p => this.progress(p));
  },

  async open() {
    const p = TS.store.project;
    if (!p.clips.length) return TS.toast('Add some clips to the timeline first.');
    const missing = p.clips.map(c => TS.store.media(c.mediaId)).filter(m => !m || m.missing);
    if (missing.length) return TS.toast('Some clips point to files that are missing — remove or re-import them first.', 'error');
    TS.player.pause();
    const prefs = TS.prefs.load('ts.export', { q: 'balanced' });
    TS.$('#expRes').value = String(p.settings.height || 1080);
    TS.$('#expFps').value = String(p.settings.fps || 30);
    TS.$('#expQ').value = prefs.q;
    TS.$('#expPath').value = await api.exportPath(p.name);
    this.setStage('form');
    this.summary();
    TS.openModal('expModal');
  },

  summary() {
    const p = TS.store.project;
    const fps = +TS.$('#expFps').value;
    const L = TSTiming.layout(p.clips, fps);
    const t = L.trans.filter(x => x.type !== 'none').length;
    TS.$('#expSummary').textContent =
      `${p.clips.length} clip${p.clips.length > 1 ? 's' : ''}, ${t} transition${t === 1 ? '' : 's'}${p.music.mediaId ? ', background music' : ''} · ${TS.fmt(L.total, false)} · H.264 MP4`;
  },

  setStage(stage) {
    TS.$('#expForm').hidden = stage !== 'form';
    TS.$('#expProgress').hidden = stage !== 'progress';
    TS.$('#expDone').hidden = stage !== 'done';
    TS.$('#expGo').hidden = stage !== 'form';
    TS.$('#expReveal').hidden = stage !== 'done';
    TS.$('#expCancel').textContent = stage === 'progress' ? 'Cancel export' : stage === 'done' ? 'Close' : 'Cancel';
  },

  progress(p) {
    TS.$('#expBar').style.width = `${(p * 100).toFixed(1)}%`;
    TS.$('#expPct').textContent = `${Math.floor(p * 100)}%`;
    const el = (performance.now() - this.t0) / 1000;
    if (p > 0.03) TS.$('#expEta').textContent = `about ${TS.fmt((el / p) * (1 - p), false)} left`;
  },

  async run() {
    const p = TS.store.project;
    const h = +TS.$('#expRes').value;
    const fps = +TS.$('#expFps').value;
    const quality = TS.$('#expQ').value;
    TS.prefs.save('ts.export', { q: quality });
    TS.store.commit(pr => { pr.settings.height = h; pr.settings.fps = fps; }, 'export-settings');
    const media = {};
    p.media.forEach(m => { media[m.id] = { path: m.path, name: m.name, hasVideo: m.hasVideo, hasAudio: m.hasAudio }; });
    const spec = {
      clips: p.clips,
      media,
      music: p.music,
      settings: { width: Math.round((h * 16) / 9 / 2) * 2, height: h, fps },
      quality,
      output: TS.$('#expPath').value
    };
    this.running = true;
    this.t0 = performance.now();
    this.progress(0);
    TS.$('#expEta').textContent = 'starting…';
    this.setStage('progress');
    const res = await api.exportStart(spec);
    this.running = false;
    if (res.ok) {
      this.lastOutput = res.output;
      TS.$('#expDonePath').textContent = `${res.output}\nTook ${TS.fmt((performance.now() - this.t0) / 1000, false)}`;
      this.setStage('done');
    } else if (res.cancelled) {
      this.setStage('form');
      TS.toast('Export cancelled');
    } else {
      this.setStage('form');
      TS.toast(`Export failed:\n${res.error}`, 'error', 10000);
    }
  }
};
