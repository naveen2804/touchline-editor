'use strict';
/* Media bin: imported files, recordings, detached audio and voiceovers. */

TS.library = {
  init() {
    this.list = TS.$('#binList');
    TS.$('#btnImport').onclick = async () => {
      const paths = await api.openFiles();
      if (paths.length) this.importPaths(paths);
    };
    TS.store.on(r => (r === 'change' || r === 'media') && this.render());
    this.render();
  },

  async importPaths(paths) {
    if (!paths || !paths.length) return [];
    const res = await api.importMedia(paths);
    const added = res.items.map(it => ({ ...it, id: TS.uid() }));
    if (added.length) {
      TS.store.commit(p => p.media.push(...added));
      added.forEach(m => this.makeThumb(m.id));
      TS.toast(`Imported ${added.length} file${added.length > 1 ? 's' : ''}`, 'ok');
    }
    res.errors.forEach(e => TS.toast(`${e.name}: ${e.error}`, 'error', 7000));
    return added;
  },

  /** Grab a frame for the bin/timeline thumbnail (stored in the project, not in undo history). */
  makeThumb(id) {
    const m = TS.store.media(id);
    if (!m || m.type !== 'video') return;
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = api.fileUrl(m.path);
    v.addEventListener('loadeddata', () => { v.currentTime = Math.min(1.5, (m.duration || 2) / 3); }, { once: true });
    v.addEventListener('seeked', () => {
      const c = document.createElement('canvas');
      c.width = 192;
      c.height = 108;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      TS.drawContain(ctx, v, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.72);
      const cur = TS.store.media(id);
      if (cur) cur.thumb = url;
      v.removeAttribute('src');
      v.load();
      TS.store.emit('media');
      TS.store.scheduleSave();
    }, { once: true });
  },

  usage(id) {
    const p = TS.store.project;
    return {
      clips: p.clips.filter(c => c.mediaId === id).length,
      audio: p.clips.filter(c => c.audio && c.audio.mediaId === id).length,
      music: p.music.mediaId === id
    };
  },

  remove(id) {
    const m = TS.store.media(id);
    const u = this.usage(id);
    if ((u.clips || u.audio || u.music) &&
        !confirm(`"${m.name}" is used on the timeline. Remove it from the project anyway?\n(The file on disk is not deleted.)`)) return;
    TS.store.commit(p => {
      p.media = p.media.filter(x => x.id !== id);
      p.clips = p.clips.filter(c => c.mediaId !== id);
      p.clips.forEach(c => {
        if (c.audio && c.audio.mediaId === id) c.audio = { ...c.audio, mode: 'none', mediaId: null };
      });
      if (p.music.mediaId === id) p.music.mediaId = null;
    });
  },

  addToTimeline(id) {
    const m = TS.store.media(id);
    if (!m) return;
    if (m.type !== 'video') return this.useAsMusic(id);
    const c = TS.makeClip(m);
    TS.store.commit(p => p.clips.push(c));
    TS.store.select(c.id);
  },

  useAsMusic(id) {
    TS.store.commit(p => { p.music.mediaId = id; });
    TS.toast('Set as background music — adjust its volume in the Project panel');
  },

  render() {
    const items = TS.store.project.media;
    if (!items.length) {
      this.list.innerHTML = `<div class="bin-empty">No media yet.<br>Import clips from your PC,<br>or record in the <b>Record</b> tab.</div>`;
      return;
    }
    this.list.innerHTML = items.map(m => {
      const tags = [];
      if (m.missing) tags.push('<span class="tag miss">Missing</span>');
      if (m.recorded) tags.push('<span class="tag rec">Recording</span>');
      if (m.voiceover) tags.push('<span class="tag vo">Voiceover</span>');
      if (m.detached) tags.push('<span class="tag det">Detached audio</span>');
      if (m.type === 'video' && !m.hasAudio) tags.push('<span class="tag">No sound</span>');
      if (m.type === 'audio' && !m.voiceover && !m.detached) tags.push('<span class="tag">Audio</span>');
      if (m.width) tags.push(`<span class="tag">${m.height}p</span>`);
      const u = this.usage(m.id);
      if (u.clips) tags.push(`<span class="tag">×${u.clips}</span>`);
      return `
        <div class="bin-item" draggable="true" data-id="${m.id}" title="${TS.esc(m.original || m.path)}">
          <div class="bin-thumb ${m.type === 'audio' ? 'audio' : ''}" style="${m.thumb ? `background-image:url('${m.thumb}')` : ''}">
            ${m.type === 'audio' ? TS.icon(m.voiceover ? 'mic' : 'music') : ''}
            <span class="dur">${TS.fmt(m.duration, false)}</span>
          </div>
          <div class="bin-meta">
            <div class="bin-name">${TS.esc(m.name)}</div>
            <div class="bin-tags">${tags.join('')}</div>
          </div>
          <div class="bin-actions">
            ${m.type === 'video'
              ? `<button data-act="add" title="Add to end of timeline">${TS.icon('plus')}</button>`
              : `<button data-act="music" title="Use as background music">${TS.icon('music')}</button>`}
            <button data-act="reveal" title="Show in folder">${TS.icon('folder')}</button>
            <button data-act="remove" title="Remove from project">${TS.icon('close')}</button>
          </div>
        </div>`;
    }).join('');

    TS.$$('.bin-item', this.list).forEach(el => {
      const id = el.dataset.id;
      el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('application/x-ts-media', id);
        e.dataTransfer.effectAllowed = 'copy';
      });
      el.addEventListener('dblclick', () => this.addToTimeline(id));
      TS.$$('button', el).forEach(b => {
        b.onclick = e => {
          e.stopPropagation();
          const a = b.dataset.act;
          if (a === 'add') this.addToTimeline(id);
          else if (a === 'music') this.useAsMusic(id);
          else if (a === 'reveal') api.reveal(TS.store.media(id).original || TS.store.media(id).path);
          else if (a === 'remove') this.remove(id);
        };
      });
    });
  }
};
