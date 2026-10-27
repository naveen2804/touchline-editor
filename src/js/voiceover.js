'use strict';
/* Re-record the voice for a clip: plays the clip and records the mic for exactly its length. */

TS.voiceover = {
  init() {
    this.video = TS.$('#voVideo');
    TS.$('#voClose').onclick = () => this.close();
    TS.$('#voRec').onclick = () => (this.mr ? this.stop() : this.start());
    TS.$('#voMic').onchange = e => {
      TS.recorder.opts.micId = e.target.value;
      TS.prefs.save('ts.recorder', TS.recorder.opts);
      this.openMic();
    };
    this.video.addEventListener('timeupdate', () => {
      if (this.mr && this.clip && this.video.currentTime >= this.clip.out - 0.02) this.stop();
    });
  },

  async open(clipId) {
    const c = TS.store.clip(clipId);
    const m = c && TS.store.media(c.mediaId);
    if (!m) return;
    TS.player.pause();
    this.clipId = clipId;
    this.clip = { in: c.in, out: c.out };
    TS.$('#voInfo').textContent = `${m.name} · ${TS.fmt(c.out - c.in)}. The clip plays from its start point; recording stops automatically at its end.`;
    TS.$('#voStatus').textContent = '';
    this.video.src = api.fileUrl(m.path);
    this.video.currentTime = c.in;
    TS.$('#voBadge').classList.remove('on');
    this.setButton(false);
    TS.openModal('voModal');

    const devs = await navigator.mediaDevices.enumerateDevices();
    const mics = devs.filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications');
    const sel = TS.$('#voMic');
    sel.innerHTML = mics.map((d, i) => `<option value="${TS.esc(d.deviceId)}">${TS.esc(d.label || `Microphone ${i + 1}`)}</option>`).join('');
    const want = TS.recorder.opts.micId;
    sel.value = mics.some(d => d.deviceId === want) ? want : (mics[0] && mics[0].deviceId) || '';
    this.openMic();
  },

  async openMic() {
    this.closeMic();
    const id = TS.$('#voMic').value;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: false, noiseSuppression: !!TS.recorder.opts.noise, autoGainControl: false, channelCount: 1 }
      });
      this.ac = new AudioContext();
      this.analyser = this.ac.createAnalyser();
      this.analyser.fftSize = 1024;
      this.ac.createMediaStreamSource(this.stream).connect(this.analyser);
      const meter = () => {
        if (!this.analyser) return;
        this.lvl = Math.max(TS.levelOf(this.analyser), (this.lvl || 0) * 0.85);
        TS.$('#voMeter').style.width = `${Math.round(this.lvl * 100)}%`;
        this.raf = requestAnimationFrame(meter);
      };
      meter();
    } catch (e) {
      TS.$('#voStatus').textContent = `Couldn't open the microphone: ${e.message}`;
    }
  },

  closeMic() {
    cancelAnimationFrame(this.raf);
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.ac) this.ac.close().catch(() => {});
    this.stream = this.ac = this.analyser = null;
  },

  setButton(rec) {
    TS.$('#voRec').classList.toggle('stop', rec);
    TS.$('#voRecLabel').textContent = rec ? 'Stop' : this.hasTake ? 'Record again' : 'Record';
  },

  countdown() {
    const el = TS.$('#voCount');
    return new Promise(res => {
      const step = k => {
        if (!k) { el.classList.remove('on'); return res(); }
        el.textContent = k;
        el.classList.remove('on');
        void el.offsetWidth;
        el.classList.add('on');
        setTimeout(() => step(k - 1), 1000);
      };
      step(3);
    });
  },

  async start() {
    if (!this.stream) return TS.toast('No microphone available.', 'error');
    TS.$('#voRec').disabled = true;
    this.video.currentTime = this.clip.in;
    await this.countdown();
    TS.$('#voRec').disabled = false;
    this.video.muted = !TS.$('#voGuide').checked;
    this.chunks = [];
    const mime = ['audio/webm;codecs=opus', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
    this.mr = new MediaRecorder(this.stream, { mimeType: mime, audioBitsPerSecond: 192000 });
    this.mr.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.mr.onstop = () => this.save();
    await this.video.play().catch(() => {});
    this.mr.start(250);
    this.t0 = performance.now();
    TS.$('#voBadge').classList.add('on');
    this.tick = setInterval(() => { TS.$('#voTime').textContent = TS.fmt((performance.now() - this.t0) / 1000, false); }, 200);
    TS.$('#voStatus').textContent = 'Recording… speak over the clip.';
    this.setButton(true);
  },

  stop() {
    if (!this.mr) return;
    const mr = this.mr;
    this.mr = null;
    this.video.pause();
    clearInterval(this.tick);
    TS.$('#voBadge').classList.remove('on');
    try { mr.stop(); } catch {}
    this.setButton(false);
  },

  async save() {
    TS.$('#voStatus').textContent = 'Saving…';
    try {
      const blob = new Blob(this.chunks, { type: 'audio/webm' });
      const c = TS.store.clip(this.clipId);
      const m = TS.store.media(c.mediaId);
      const base = `Voiceover – ${(m ? m.name : 'clip').replace(/\.[^.]+$/, '')}`;
      const info = await api.saveAudio(new Uint8Array(await blob.arrayBuffer()), base);
      const vm = { ...info, id: TS.uid(), name: info.name.replace(/\.wav$/i, '') };
      TS.store.commit(p => {
        p.media.push(vm);
        const cl = p.clips.find(x => x.id === this.clipId);
        if (cl) cl.audio = { mode: 'file', mediaId: vm.id, offset: 0, volume: 1 };
      });
      this.hasTake = true;
      this.setButton(false);
      TS.$('#voStatus').textContent = `Saved (${TS.fmt(vm.duration, false)}) and attached to the clip. Record again to retake, or close.`;
    } catch (e) {
      TS.$('#voStatus').textContent = `Saving failed: ${e.message}`;
    }
  },

  close() {
    if (this.mr) this.stop();
    this.closeMic();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.hasTake = false;
    TS.closeModal('voModal');
  }
};
