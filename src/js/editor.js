'use strict';
/* Editing operations shared by the timeline, inspector and keyboard shortcuts. */

TS.editor = {
  /** clip under the playhead (prefers the selected one during a transition) */
  clipAtPlayhead() {
    const clips = TS.store.project.clips;
    const L = TSTiming.layout(clips);
    const act = TSTiming.activeAt(L, TS.player.t);
    if (!act.length) return null;
    const selIdx = act.find(i => clips[i].id === TS.store.sel);
    const i = selIdx != null ? selIdx : act[act.length - 1];
    return { clip: clips[i], index: i, local: clips[i].in + (TS.player.t - L.starts[i]) };
  },

  split() {
    const hit = this.clipAtPlayhead();
    if (!hit) return TS.toast('Move the playhead over a clip to split it.');
    const { clip, index, local } = hit;
    if (local - clip.in < 0.1 || clip.out - local < 0.1) return TS.toast('Too close to the edge of the clip to split.');
    const right = JSON.parse(JSON.stringify(clip));
    right.id = TS.uid();
    right.in = local;
    if (right.audio && right.audio.mode === 'file') right.audio.offset = (+right.audio.offset || 0) + (local - clip.in);
    TS.store.commit(p => {
      const c = p.clips[index];
      c.out = local;
      c.transition = { type: 'none', duration: c.transition ? c.transition.duration : 0.6 };
      p.clips.splice(index + 1, 0, right);
    });
    TS.store.select(right.id);
  },

  setInOut(which) {
    const hit = this.clipAtPlayhead();
    const sel = TS.store.selectedClip();
    const target = sel && hit && hit.clip.id === sel.id ? hit : hit;
    if (!target) return TS.toast('Move the playhead over the clip first.');
    const { clip, local } = target;
    TS.store.commit(() => {
      if (which === 'in') {
        if (local < clip.out - 0.1) {
          const shift = local - clip.in;
          clip.in = local;
          if (clip.audio && clip.audio.mode === 'file') clip.audio.offset = (+clip.audio.offset || 0) + shift;
        }
      } else if (local > clip.in + 0.1) {
        clip.out = local;
      }
    });
    TS.store.select(clip.id);
  },

  deleteSelected() {
    const id = TS.store.sel;
    if (id === 'music') {
      TS.store.commit(p => { p.music.mediaId = null; });
      TS.store.select(null);
      return;
    }
    const i = TS.store.clipIndex(id);
    if (i < 0) return TS.toast('Select a clip to delete.');
    TS.store.commit(p => p.clips.splice(i, 1));
    const next = TS.store.project.clips[Math.min(i, TS.store.project.clips.length - 1)];
    TS.store.select(next ? next.id : null);
  },

  duplicate(id) {
    const i = TS.store.clipIndex(id);
    if (i < 0) return;
    const copy = JSON.parse(JSON.stringify(TS.store.project.clips[i]));
    copy.id = TS.uid();
    TS.store.commit(p => p.clips.splice(i + 1, 0, copy));
    TS.store.select(copy.id);
  },

  /** Extract the clip's sound to a WAV and attach it as a separate, shiftable track. */
  async detach(id) {
    const c = TS.store.clip(id);
    const m = c && TS.store.media(c.mediaId);
    if (!m || !m.hasAudio) return;
    try {
      let am = TS.store.project.media.find(x => x.extractedFrom === m.id);
      if (!am) {
        const info = await api.extractAudio(m.path);
        am = { ...info, id: TS.uid(), name: `${m.name.replace(/\.[^.]+$/, '')} – audio`, extractedFrom: m.id };
      }
      const isNew = !TS.store.media(am.id);
      TS.store.commit(p => {
        if (isNew) p.media.push(am);
        const cl = p.clips.find(x => x.id === id);
        cl.audio = { mode: 'file', mediaId: am.id, offset: cl.in, volume: cl.audio ? cl.audio.volume : 1, fx: cl.audio ? cl.audio.fx : null };
      });
      TS.toast('Audio detached — it now sits on its own track (purple). Shift, replace or mute it in the clip panel.', 'ok', 5000);
    } catch (e) {
      TS.toast(`Couldn't detach audio: ${e.message}`, 'error');
    }
  },

  setAudioMode(id, mode) {
    const c = TS.store.clip(id);
    const m = TS.store.media(c.mediaId);
    if (mode === 'file' && !c.audio.mediaId) {
      if (m && m.hasAudio) return this.detach(id);
      const first = TS.store.project.media.find(x => x.type === 'audio');
      if (!first) return TS.toast('Import an audio file or use "Re-record voice" to give this clip a separate track.');
      return TS.store.commit(() => { c.audio = { ...c.audio, mode, mediaId: first.id, offset: 0 }; });
    }
    TS.store.commit(() => { c.audio = { ...c.audio, mode }; });
  }
};
