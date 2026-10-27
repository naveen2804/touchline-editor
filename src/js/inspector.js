'use strict';
/* Right-hand panel: clip settings (trim, audio, transition) or project settings. */

TS.inspector = {
  lock: false,

  init() {
    this.root = TS.$('#inspector');
    TS.store.on(r => (r === 'change' || r === 'select') && this.render());
    this.root.addEventListener('click', e => this.onClick(e));
    this.root.addEventListener('change', e => this.onChange(e));
    this.root.addEventListener('input', e => this.onInput(e));
    this.render();
  },

  focusTransition() {
    const el = TS.$('#inspTrans', this.root);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  render() {
    if (this.lock) return;
    const s = TS.store;
    const c = s.selectedClip();
    if (!c) return this.renderProject();
    const p = s.project;
    const i = s.clipIndex(c.id);
    const m = s.media(c.mediaId);
    const a = c.audio || { mode: 'original', volume: 1 };
    const isLast = i === p.clips.length - 1;
    const dur = c.out - c.in;
    const am = s.media(a.mediaId);
    const audioMedia = p.media.filter(x => x.hasAudio && x.type === 'audio');
    const vol = a.volume == null ? 1 : a.volume;
    const tr = c.transition || { type: 'none', duration: 0.6 };

    let audioCard;
    if (a.mode === 'original') {
      audioCard = m && m.hasAudio
        ? `<div class="audio-card"><div class="swatch" style="background:var(--ok)"></div><div class="grow"><div class="t">Original sound</div><div class="muted">Recorded with this clip</div></div></div>`
        : `<div class="audio-card"><div class="swatch" style="background:var(--dim)"></div><div class="grow"><div class="t">This clip has no sound</div><div class="muted">Record a voiceover to add some</div></div></div>`;
    } else if (a.mode === 'file') {
      audioCard = `<div class="audio-card"><div class="swatch" style="background:${am && am.voiceover ? 'var(--orange)' : 'var(--purple)'}"></div>
        <div class="grow"><div class="t">${am ? TS.esc(am.name) : 'No audio picked'}</div><div class="muted">${am ? (am.voiceover ? 'Voiceover' : 'Separate audio track') : ''}</div></div></div>`;
    } else {
      audioCard = `<div class="audio-card"><div class="swatch" style="background:var(--dim)"></div><div class="grow"><div class="t">Muted</div><div class="muted">No sound plays for this clip</div></div></div>`;
    }

    this.root.innerHTML = `
      <div class="insp-head">
        <div class="insp-title" title="${TS.esc(m ? m.path : '')}">${TS.esc(m ? m.name : 'Missing file')}</div>
        <div class="insp-sub">Clip ${i + 1} of ${p.clips.length} · ${TS.fmt(dur)} long${m ? ` · from ${TS.fmt(m.duration, false)} source` : ''}</div>
      </div>

      <div class="insp-sec">
        <h3>Trim</h3>
        <div class="row2">
          <label>Start (s)<input type="number" step="0.01" min="0" data-f="in" value="${c.in.toFixed(2)}"></label>
          <label>End (s)<input type="number" step="0.01" min="0" data-f="out" value="${c.out.toFixed(2)}"></label>
        </div>
        <div class="btn-row">
          <button data-act="setIn" title="I">Start at playhead</button>
          <button data-act="setOut" title="O">End at playhead</button>
        </div>
        <div class="btn-row">
          <button data-act="split">${TS.icon('scissors')}Split</button>
          <button data-act="resetTrim">${TS.icon('reset')}Reset</button>
        </div>
      </div>

      <div class="insp-sec">
        <h3>Audio</h3>
        ${audioCard}
        <div class="seg full" style="margin-bottom:10px">
          <button data-mode="original" class="${a.mode === 'original' ? 'on' : ''}" ${m && m.hasAudio ? '' : 'disabled'}>Original</button>
          <button data-mode="file" class="${a.mode === 'file' ? 'on' : ''}">Separate</button>
          <button data-mode="none" class="${a.mode === 'none' ? 'on' : ''}">Mute</button>
        </div>
        ${a.mode === 'file' ? `
          <label>Audio source
            <select data-f="amedia">
              ${am ? '' : '<option value="">— choose —</option>'}
              ${audioMedia.map(x => `<option value="${x.id}" ${x.id === a.mediaId ? 'selected' : ''}>${TS.esc(x.name)}</option>`).join('')}
            </select>
          </label>
          <div class="mini-label">Sync — where in the audio file this clip starts</div>
          <div class="nudge">
            <button data-nudge="-0.1">−0.1s</button>
            <button data-nudge="-0.0333">−1f</button>
            <input type="number" step="0.01" data-f="offset" value="${(+a.offset || 0).toFixed(2)}">
            <button data-nudge="0.0333">+1f</button>
            <button data-nudge="0.1">+0.1s</button>
          </div>` : ''}
        ${a.mode !== 'none' ? `
          <div class="slider-row"><span>Volume</span>
            <input type="range" min="0" max="2" step="0.01" data-f="volume" value="${vol}">
            <span class="val" id="volVal">${Math.round(vol * 100)}%</span>
          </div>` : ''}
        <div class="btn-row">
          <button data-act="detach" ${m && m.hasAudio && a.mode === 'original' ? '' : 'disabled'} title="Split the sound into its own track">${TS.icon('unlink')}Detach audio</button>
          <button data-act="voiceover">${TS.icon('mic')}Re-record voice</button>
        </div>
        <p class="help">Detach pulls this clip's sound out as a separate track you can shift, swap or delete. Re-record lets you speak over the clip while it plays.</p>
      </div>

      <div class="insp-sec" id="inspTrans">
        <h3>Transition into next clip</h3>
        ${isLast ? '<p class="help">This is the last clip — add another clip after it to use a transition.</p>' : `
          <div class="trans-grid">
            ${TS.TRANSITIONS.map(t => `<button data-trans="${t.id}" class="${tr.type === t.id ? 'on' : ''}">${TS.transGlyph(t.id)}<span>${t.label}</span></button>`).join('')}
          </div>
          ${tr.type !== 'none' ? `
            <div class="slider-row"><span>Duration</span>
              <input type="range" min="0.2" max="2.5" step="0.05" data-f="tdur" value="${tr.duration}">
              <span class="val" id="tdurVal">${(+tr.duration).toFixed(2)}s</span>
            </div>` : ''}`}
      </div>

      <div class="insp-sec">
        <div class="btn-row">
          <button data-act="dup">${TS.icon('copy')}Duplicate</button>
          <button data-act="del" class="danger">${TS.icon('trash')}Delete</button>
        </div>
      </div>`;
  },

  renderProject() {
    const p = TS.store.project;
    const L = TSTiming.layout(p.clips);
    const audioMedia = p.media.filter(x => x.hasAudio && x.type === 'audio');
    const mv = p.music.volume;
    this.root.innerHTML = `
      <div class="insp-head">
        <div class="insp-title">Project</div>
        <div class="insp-sub">Select a clip on the timeline to trim it, change its audio or add a transition.</div>
      </div>
      <div class="insp-sec">
        <h3>Overview</h3>
        <div class="stats">
          <div class="stat"><b>${p.clips.length}</b><span>clips</span></div>
          <div class="stat"><b>${TS.fmt(L.total, false)}</b><span>final length</span></div>
        </div>
      </div>
      <div class="insp-sec">
        <h3>Background music</h3>
        <label>Track
          <select data-f="music">
            <option value="">None</option>
            ${audioMedia.map(x => `<option value="${x.id}" ${x.id === p.music.mediaId ? 'selected' : ''}>${TS.esc(x.name)}</option>`).join('')}
          </select>
        </label>
        ${p.music.mediaId ? `
          <div class="slider-row"><span>Volume</span>
            <input type="range" min="0" max="1" step="0.01" data-f="mvol" value="${mv}">
            <span class="val" id="mvolVal">${Math.round(mv * 100)}%</span>
          </div>
          <p class="help">Loops under the whole video and fades out at the end. Keep it around 15–25% so your voice stays on top.</p>` :
          '<p class="help">Import an MP3/WAV and pick it here.</p>'}
        <div class="btn-row"><button data-act="importMusic">${TS.icon('import')}Import music…</button></div>
      </div>
      <div class="insp-sec">
        <h3>Transitions</h3>
        <label>Style for every cut
          <select data-f="alltype">${TS.TRANSITIONS.map(t => `<option value="${t.id}" ${t.id === (this.allType || 'fade') ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
        </label>
        <div class="slider-row"><span>Duration</span>
          <input type="range" min="0.2" max="2.5" step="0.05" data-f="alldur" value="${this.allDur || 0.6}">
          <span class="val" id="alldurVal">${(this.allDur || 0.6).toFixed(2)}s</span>
        </div>
        <div class="btn-row"><button data-act="applyAll" ${p.clips.length > 1 ? '' : 'disabled'}>Apply to all cuts</button></div>
      </div>
      <div class="insp-sec">
        <h3>Shortcuts</h3>
        <p class="help" style="line-height:1.9">
          <kbd>Space</kbd> play/pause · <kbd>S</kbd> split · <kbd>I</kbd>/<kbd>O</kbd> set start/end<br>
          <kbd>←</kbd>/<kbd>→</kbd> frame step (<kbd>Shift</kbd> = 1s) · <kbd>Del</kbd> delete clip<br>
          <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Y</kbd> redo · <kbd>Ctrl</kbd>+<kbd>scroll</kbd> zoom
        </p>
      </div>`;
  },

  mutate(fn, key) {
    const c = TS.store.selectedClip();
    TS.store.commit(() => fn(c), key);
  },

  async onClick(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const c = TS.store.selectedClip();
    const ed = TS.editor;

    if (b.dataset.mode && c) return ed.setAudioMode(c.id, b.dataset.mode);
    if (b.dataset.trans && c) {
      return this.mutate(cl => { cl.transition = { type: b.dataset.trans, duration: (cl.transition && cl.transition.duration) || 0.6 }; });
    }
    if (b.dataset.nudge && c) {
      return this.mutate(cl => { cl.audio.offset = Math.round(((+cl.audio.offset || 0) + +b.dataset.nudge) * 1000) / 1000; }, 'nudge-' + c.id);
    }
    switch (b.dataset.act) {
      case 'setIn': return ed.setInOut('in');
      case 'setOut': return ed.setInOut('out');
      case 'split': return ed.split();
      case 'resetTrim': {
        const m = TS.store.media(c.mediaId);
        return this.mutate(cl => { cl.in = 0; cl.out = m ? m.duration : cl.out; });
      }
      case 'detach': return ed.detach(c.id);
      case 'voiceover': return TS.voiceover.open(c.id);
      case 'dup': return ed.duplicate(c.id);
      case 'del': return ed.deleteSelected();
      case 'importMusic': {
        const paths = await api.openFiles();
        const added = await TS.library.importPaths(paths);
        const au = added.find(m => m.type === 'audio');
        if (au) TS.library.useAsMusic(au.id);
        return;
      }
      case 'applyAll': {
        const type = this.allType || 'fade';
        const dur = this.allDur || 0.6;
        TS.store.commit(p => p.clips.forEach(cl => { cl.transition = { type, duration: dur }; }));
        return TS.toast(`${TS.transLabel(type)} applied to every cut`);
      }
    }
  },

  onChange(e) {
    const f = e.target.dataset.f;
    if (!f) return;
    const v = e.target.value;
    const c = TS.store.selectedClip();
    if (f === 'in' || f === 'out') {
      const m = TS.store.media(c.mediaId);
      const max = m ? m.duration : Infinity;
      return this.mutate(cl => {
        if (f === 'in') cl.in = TS.clamp(+v || 0, 0, cl.out - 0.1);
        else cl.out = TS.clamp(+v || 0, cl.in + 0.1, max);
      });
    }
    if (f === 'offset') return this.mutate(cl => { cl.audio.offset = +v || 0; });
    if (f === 'amedia') return this.mutate(cl => { cl.audio.mediaId = v || null; cl.audio.offset = 0; });
    if (f === 'music') return TS.store.commit(p => { p.music.mediaId = v || null; });
    if (f === 'alltype') { this.allType = v; return; }
  },

  onInput(e) {
    const f = e.target.dataset.f;
    if (!f || e.target.type !== 'range') return;
    const v = +e.target.value;
    this.lock = true;
    try {
      if (f === 'volume') {
        this.mutate(cl => { cl.audio.volume = v; }, 'vol-' + TS.store.sel);
        TS.$('#volVal').textContent = `${Math.round(v * 100)}%`;
      } else if (f === 'tdur') {
        this.mutate(cl => { cl.transition.duration = v; }, 'tdur-' + TS.store.sel);
        TS.$('#tdurVal').textContent = `${v.toFixed(2)}s`;
      } else if (f === 'mvol') {
        TS.store.commit(p => { p.music.volume = v; }, 'mvol');
        TS.$('#mvolVal').textContent = `${Math.round(v * 100)}%`;
      } else if (f === 'alldur') {
        this.allDur = v;
        TS.$('#alldurVal').textContent = `${v.toFixed(2)}s`;
      }
    } finally {
      this.lock = false;
    }
  }
};
