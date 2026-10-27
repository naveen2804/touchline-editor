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
    ['#expRes', '#expFps', '#expQ', '#expEnc'].forEach(s => TS.$(s).addEventListener('change', () => this.summary()));
    api.on('export-progress', p => this.progress(p));
    api.on('export-encoder', e => {
      TS.$('#expUsing').textContent = `Encoding with ${e.label}`;
      this.t0 = performance.now();
    });
  },

  async open() {
    const p = TS.store.project;
    if (!p.clips.length) return TS.toast('Add some clips to the timeline first.');
    const missing = p.clips.map(c => TS.store.media(c.mediaId)).filter(m => !m || m.missing);
    if (missing.length) return TS.toast('Some clips point to files that are missing — remove or re-import them first.', 'error');
    TS.player.pause();
    const prefs = TS.prefs.load('ts.export', { q: 'balanced', enc: 'auto' });
    TS.$('#expEnc').value = prefs.enc;
    this.hw = null;
    TS.$('#expEncNote').textContent = 'Checking your graphics card…';
    api.encoders().then(r => { this.hw = r; this.summary(); });
    TS.$('#expRes').value = String(p.settings.height || 1080);
    TS.$('#expFps').value = String(p.settings.fps || 30);
    TS.$('#expQ').value = prefs.q;
    TS.$('#expPath').value = await api.exportPath(p.name);
    // older projects didn't store each clip's frame rate — read it so the dialog can advise
    const unknown = [...new Set(p.clips.map(c => TS.store.media(c.mediaId)).filter(m => m && !m.fps))];
    await Promise.all(unknown.map(async m => {
      const info = await api.probe(m.path);
      if (info && info.fps) m.fps = info.fps;
    }));
    this.setStage('form');
    this.summary();
    TS.openModal('expModal');
  },

  summary() {
    const p = TS.store.project;
    const fps = +TS.$('#expFps').value;
    const L = TSTiming.layout(p.clips, fps);
    const t = L.trans.filter(x => x.type !== 'none').length;
    const enc = TS.$('#expEnc').value;
    const note = TS.$('#expEncNote');
    if (this.hw) {
      const best = this.hw.hardware[0];
      if (enc === 'cpu') { note.textContent = 'Uses the processor only. Pick this if a GPU export looks wrong.'; note.className = 'enc-note cpu'; }
      else if (best) { note.textContent = `✓ Will use ${this.hw.labels[best]}`; note.className = 'enc-note'; }
      else { note.textContent = 'No supported graphics encoder found — the CPU will be used.'; note.className = 'enc-note cpu'; }
    }

    // warn when the export asks for more than the footage has (costs time, adds nothing)
    const h = +TS.$('#expRes').value;
    const srcs = p.clips.map(c => TS.store.media(c.mediaId)).filter(Boolean);
    const fpsKnown = srcs.filter(m => m.fps);
    const maxFps = fpsKnown.length === srcs.length && srcs.length ? Math.max(...fpsKnown.map(m => m.fps)) : null;
    const maxH = srcs.length ? Math.max(...srcs.map(m => m.height || 0)) : 0;
    const warns = [];
    if (fps === 60 && maxFps && maxFps < 40) warns.push(`Your clips are ${Math.round(maxFps)} fps — exporting at 60 fps roughly doubles the export time without making motion smoother. 30 fps is recommended.`);
    if (maxH && h > maxH * 1.05 && !(h === 1440 && maxH >= 1080)) warns.push(`Your clips are at most ${maxH}p — ${h}p upscales them, which takes much longer without adding detail.`);
    TS.$('#expWarn').hidden = !warns.length;
    TS.$('#expWarn').textContent = warns.join(' ');

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
    TS.prefs.save('ts.export', { q: quality, enc: TS.$('#expEnc').value });
    TS.store.commit(pr => { pr.settings.height = h; pr.settings.fps = fps; }, 'export-settings');
    const media = {};
    p.media.forEach(m => { media[m.id] = { path: m.path, name: m.name, hasVideo: m.hasVideo, hasAudio: m.hasAudio }; });
    const spec = {
      clips: p.clips,
      media,
      music: p.music,
      settings: { width: Math.round((h * 16) / 9 / 2) * 2, height: h, fps },
      quality,
      encoder: TS.$('#expEnc').value,
      output: TS.$('#expPath').value
    };
    this.running = true;
    this.t0 = this.tStart = performance.now();
    this.progress(0);
    TS.$('#expEta').textContent = 'starting…';
    TS.$('#expUsing').textContent = '';
    this.setStage('progress');
    const res = await api.exportStart(spec);
    this.running = false;
    if (res.ok) {
      this.lastOutput = res.output;
      TS.$('#expDonePath').textContent = `${res.output}\nTook ${TS.fmt((performance.now() - this.tStart) / 1000, false)} · ${res.encoderLabel}`;
      if (res.fellBack) TS.toast('The graphics card encoder failed, so this export fell back to the CPU. If it keeps happening, choose "CPU only".', 'error', 9000);
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
