'use strict';
/* Timeline: ruler, video lane (clips + transitions), audio lane, music lane. */

TS.timeline = {
  pps: 40, // pixels per second

  init() {
    this.scroll = TS.$('#tlScroll');
    this.canvas = TS.$('#tlCanvas');
    this.ruler = TS.$('#tlRuler');
    this.lv = TS.$('#laneVideo');
    this.la = TS.$('#laneAudio');
    this.lm = TS.$('#laneMusic');
    this.ph = TS.$('#tlPlayhead');
    this.ins = TS.$('#tlInsert');
    this.zoom = TS.$('#tlZoom');

    this.zoom.oninput = () => this.setZoom(+this.zoom.value);
    TS.$('#tlFit').onclick = () => this.fit();
    TS.$('#tlUndo').onclick = () => TS.store.undo();
    TS.$('#tlRedo').onclick = () => TS.store.redo();
    TS.$('#tlSplit').onclick = () => TS.editor.split();
    TS.$('#tlDelete').onclick = () => TS.editor.deleteSelected();
    TS.$('#pvSplit').onclick = () => TS.editor.split();

    TS.store.on(r => r !== 'time' && this.render());

    // scrub on the ruler
    this.ruler.addEventListener('pointerdown', e => {
      const seek = ev => TS.player.setTime(this.xToT(ev.clientX));
      seek(e);
      const up = () => {
        window.removeEventListener('pointermove', seek);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', seek);
      window.addEventListener('pointerup', up);
    });
    // click on empty lane space: seek + clear selection
    [this.lv, this.la, this.lm].forEach(l => l.addEventListener('pointerdown', e => {
      if (e.target !== l) return;
      TS.player.setTime(this.xToT(e.clientX));
      TS.store.select(null);
    }));

    this.canvas.addEventListener('dragover', e => this.onDragOver(e));
    this.canvas.addEventListener('dragleave', e => {
      if (!this.canvas.contains(e.relatedTarget)) this.ins.style.display = 'none';
    });
    this.canvas.addEventListener('drop', e => this.onDrop(e));
    this.scroll.addEventListener('wheel', e => {
      if (e.ctrlKey) {
        e.preventDefault();
        this.setZoom(this.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX);
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        this.scroll.scrollLeft += e.deltaY;
      }
    }, { passive: false });
    window.addEventListener('resize', () => this.render());
    this.render();
  },

  setZoom(pps, anchorX) {
    const r = this.scroll.getBoundingClientRect();
    const ax = anchorX == null ? r.left + r.width / 2 : anchorX;
    const tAt = this.xToT(ax);
    this.pps = TS.clamp(pps, 4, 240);
    this.zoom.value = this.pps;
    this.render();
    this.scroll.scrollLeft = tAt * this.pps - (ax - r.left);
  },

  fit() {
    const total = this.L ? this.L.total : 0;
    if (!total) return;
    this.setZoom((this.scroll.clientWidth - 40) / total);
    this.scroll.scrollLeft = 0;
  },

  xToT(clientX) {
    const r = this.canvas.getBoundingClientRect();
    return Math.max(0, (clientX - r.left) / this.pps);
  },

  setPlayhead(t, follow) {
    if (!this.ph) return;
    const x = t * this.pps;
    this.ph.style.left = `${x}px`;
    if (follow) {
      const sl = this.scroll.scrollLeft;
      const w = this.scroll.clientWidth;
      if (x > sl + w - 60 || x < sl) this.scroll.scrollLeft = x - 80;
    }
  },

  render() {
    const p = TS.store.project;
    const clips = p.clips;
    const L = (this.L = TSTiming.layout(clips));
    const pps = this.pps;
    const width = Math.max(this.scroll.clientWidth, (L.total + 15) * pps);
    this.canvas.style.width = `${width}px`;
    TS.$('#tlTotal').textContent = TS.fmt(L.total, false);

    // ruler
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
    const step = steps.find(s => s * pps >= 90) || 1200;
    const minor = step / 5;
    let rh = '';
    for (let t = 0; t * pps < width; t += minor) {
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      rh += major
        ? `<div class="tick" style="left:${t * pps}px">${TS.fmt(t, step < 1)}</div>`
        : `<div class="tick minor" style="left:${t * pps}px"></div>`;
    }
    this.ruler.innerHTML = rh;

    // video lane
    const sel = TS.store.sel;
    let vh = '';
    let ah = '';
    clips.forEach((c, i) => {
      const m = TS.store.media(c.mediaId);
      const left = L.starts[i] * pps;
      const w = Math.max(6, L.durs[i] * pps);
      const thumb = m && m.thumb ? `background-image:url('${m.thumb}');background-size:${Math.max(48, 78 * 16 / 9)}px 100%` : '';
      vh += `
        <div class="clip ${c.id === sel ? 'sel' : ''} ${!m || m.missing ? 'missing' : ''}" draggable="true" data-id="${c.id}"
             style="left:${left}px;width:${w}px">
          <div class="clip-thumbs" style="${thumb}"></div>
          ${w > 34 ? `<div class="clip-num">${i + 1}</div>` : ''}
          ${w > 60 ? `<div class="clip-label"><span>${TS.esc(m ? m.name : 'Missing file')}</span><em>${TS.fmt(L.durs[i], false)}</em></div>` : ''}
          <div class="trim-h l" data-h="l" title="Drag to trim start"></div>
          <div class="trim-h r" data-h="r" title="Drag to trim end"></div>
        </div>`;

      // audio lane
      const a = c.audio || { mode: 'original' };
      let cls = 'a-none';
      let label = 'Muted';
      if (a.mode === 'original') {
        if (m && m.hasAudio) { cls = 'a-orig'; label = 'Original sound'; } else label = 'No sound';
      } else if (a.mode === 'file') {
        const am = TS.store.media(a.mediaId);
        if (am) {
          cls = am.voiceover ? 'a-vo' : 'a-det';
          label = `${am.voiceover ? 'Voice' : 'Detached'} · ${am.name}`;
        } else label = 'Pick an audio source';
      }
      if (a.mode !== 'none' && TSAudioFx.isActive(a.fx)) label += ' · ✦ enhanced';
      if (a.mode !== 'none' && a.volume != null && Math.abs(a.volume - 1) > 0.01) label += ` · ${Math.round(a.volume * 100)}%`;
      ah += `<div class="aud ${cls} ${c.id === sel ? 'sel' : ''}" data-id="${c.id}" style="left:${left}px;width:${w}px" title="${TS.esc(label)}"><span>${TS.esc(label)}</span></div>`;
    });

    // transitions sit over the overlap between clips
    for (let i = 0; i < clips.length - 1; i++) {
      const b = L.trans[i];
      const x = L.starts[i + 1] * pps;
      if (b.type !== 'none') {
        const w = Math.max(22, b.d * pps);
        vh += `<div class="trans" data-i="${i}" style="left:${x + (b.d * pps - w) / 2}px;width:${w}px" title="${TS.transLabel(b.type)} · ${b.d.toFixed(2)}s — click to edit">${w > 44 ? TS.esc(TS.transLabel(b.type)) : '◆'}</div>`;
      } else {
        vh += `<div class="trans add" data-i="${i}" style="left:${x - 10}px" title="Add a transition">+</div>`;
      }
    }
    if (!clips.length) vh = '<div class="tl-empty">Drag clips here from the Media panel, or double-click them.</div>';
    this.lv.innerHTML = vh;
    this.la.innerHTML = ah;

    // music lane
    const mm = TS.store.media(p.music.mediaId);
    this.lm.innerHTML = mm && clips.length
      ? `<div class="aud music-block ${sel === 'music' ? 'sel' : ''}" data-music="1" style="left:0;width:${Math.max(6, L.total * pps)}px"><span>♫ ${TS.esc(mm.name)} · ${Math.round(p.music.volume * 100)}%</span></div>`
      : `<div class="music-empty">${mm ? '' : 'No background music — use ♫ on an audio file in Media'}</div>`;

    this.bind();
    this.setPlayhead(TS.player.t);
  },

  bind() {
    TS.$$('.clip', this.lv).forEach(el => {
      const id = el.dataset.id;
      el.addEventListener('pointerdown', e => {
        if (e.target.classList.contains('trim-h')) return;
        TS.store.select(id);
      });
      el.addEventListener('dblclick', () => {
        const i = TS.store.clipIndex(id);
        TS.player.setTime(this.L.starts[i]);
      });
      el.addEventListener('dragstart', e => {
        if (this.trimming) return e.preventDefault();
        e.dataTransfer.setData('application/x-ts-clip', id);
        e.dataTransfer.effectAllowed = 'move';
      });
      TS.$$('.trim-h', el).forEach(h => h.addEventListener('pointerdown', e => this.startTrim(e, id, h.dataset.h)));
    });
    TS.$$('.trans', this.lv).forEach(el => {
      el.addEventListener('pointerdown', e => e.stopPropagation());
      el.onclick = e => {
        e.stopPropagation();
        const i = +el.dataset.i;
        const c = TS.store.project.clips[i];
        if (el.classList.contains('add')) {
          TS.store.commit(() => { c.transition = { type: 'fade', duration: c.transition.duration || 0.6 }; });
          TS.toast('Added a fade — pick another style in the clip panel');
        }
        TS.store.select(c.id);
        TS.inspector.focusTransition();
      };
    });
    TS.$$('.aud[data-id]', this.la).forEach(el => {
      el.addEventListener('pointerdown', () => TS.store.select(el.dataset.id));
    });
    const mb = TS.$('[data-music]', this.lm);
    if (mb) mb.addEventListener('pointerdown', () => TS.store.select('music'));
  },

  startTrim(e, id, side) {
    e.preventDefault();
    e.stopPropagation();
    const c0 = TS.store.clip(id);
    const m = TS.store.media(c0.mediaId);
    const orig = { in: c0.in, out: c0.out };
    const x0 = e.clientX;
    const maxOut = m && m.duration ? m.duration : orig.out;
    this.trimming = true;
    TS.store.checkpoint();
    TS.store.select(id);
    const i = TS.store.clipIndex(id);
    const mv = ev => {
      const dt = (ev.clientX - x0) / this.pps;
      const c = TS.store.clip(id);
      if (!c) return;
      if (side === 'l') c.in = TS.clamp(orig.in + dt, 0, c.out - 0.1);
      else c.out = TS.clamp(orig.out + dt, c.in + 0.1, maxOut);
      TS.store.emit('change');
      // show the frame you're trimming to
      const L = TSTiming.layout(TS.store.project.clips);
      TS.player.setTime(side === 'l' ? L.starts[i] : L.starts[i] + L.durs[i] - 0.001);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      this.trimming = false;
      TS.store.scheduleSave();
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  },

  dropIndex(clientX) {
    const t = this.xToT(clientX);
    const L = this.L;
    let idx = 0;
    for (let i = 0; i < L.starts.length; i++) if (t > L.starts[i] + L.durs[i] / 2) idx = i + 1;
    return idx;
  },

  onDragOver(e) {
    const types = [...e.dataTransfer.types];
    const ours = types.includes('application/x-ts-clip') || types.includes('application/x-ts-media') || types.includes('Files');
    if (!ours) return;
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('dropping');
    e.dataTransfer.dropEffect = types.includes('application/x-ts-clip') ? 'move' : 'copy';
    const idx = (this.dropIdx = this.dropIndex(e.clientX));
    const L = this.L;
    const x = idx < L.starts.length ? L.starts[idx] * this.pps : L.total * this.pps;
    this.ins.style.display = 'block';
    this.ins.style.left = `${x}px`;
  },

  async onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('dropping');
    this.ins.style.display = 'none';
    const idx = this.dropIdx != null ? this.dropIdx : this.dropIndex(e.clientX);
    this.dropIdx = null;
    const clipId = e.dataTransfer.getData('application/x-ts-clip');
    const mediaId = e.dataTransfer.getData('application/x-ts-media');
    if (clipId) {
      TS.store.commit(p => {
        const from = p.clips.findIndex(c => c.id === clipId);
        if (from < 0) return;
        const [c] = p.clips.splice(from, 1);
        p.clips.splice(from < idx ? idx - 1 : idx, 0, c);
      });
    } else if (mediaId) {
      const m = TS.store.media(mediaId);
      if (!m) return;
      if (m.type !== 'video') return TS.library.useAsMusic(mediaId);
      const c = TS.makeClip(m);
      TS.store.commit(p => p.clips.splice(idx, 0, c));
      TS.store.select(c.id);
    } else if (e.dataTransfer.files.length) {
      const paths = [...e.dataTransfer.files].map(f => api.pathForFile(f)).filter(Boolean);
      const added = await TS.library.importPaths(paths);
      const vids = added.filter(m => m.type === 'video');
      if (vids.length) TS.store.commit(p => p.clips.splice(idx, 0, ...vids.map(TS.makeClip)));
    }
  }
};
