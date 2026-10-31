'use strict';
/*
 * Recorder: composites camera + captured window onto a 1920x1080 canvas,
 * animates between layouts, and records canvas + mixed audio to disk.
 */

/** Pulls frames from a MediaStream video track (keeps working when the window is in the background). */
class FrameSource {
  constructor(stream) {
    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    this.frame = null;
    if ('MediaStreamTrackProcessor' in window) {
      try {
        const proc = new MediaStreamTrackProcessor({ track: this.track });
        this.reader = proc.readable.getReader();
        this.pump();
        return;
      } catch (e) { /* fall back to <video> */ }
    }
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
    this.video.play().catch(() => {});
  }
  async pump() {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (this.stopped) { value.close(); break; }
        if (this.frame) this.frame.close();
        this.frame = value;
      }
    } catch (e) { /* track ended */ }
  }
  get image() {
    if (this.frame) return this.frame;
    if (this.video && this.video.readyState >= 2) return this.video;
    return null;
  }
  get live() { return this.track && this.track.readyState === 'live'; }
  stop() {
    this.stopped = true;
    try { this.reader && this.reader.cancel(); } catch {}
    try { this.frame && this.frame.close(); } catch {}
    this.frame = null;
    this.stream.getTracks().forEach(t => t.stop());
    if (this.video) this.video.srcObject = null;
  }
}

(function () {
  const W = 1920;
  const H = 1080;
  const DEFAULTS = {
    camId: '', micId: '', sysAudio: false, noise: true, corner: 'br', size: 'M', shape: 'rounded',
    mirror: true, border: '#6cabdd', countdown: true, mini: true, autoAdd: true, layout: 'split',
    sourceId: null, sourceName: '', sourceThumb: null,
    res: '1080', fps: 30, bitrate: 'high',
    fx: null, recVolume: 1
  };

  // Logical drawing space stays 1920x1080; the canvas is scaled to the chosen resolution.
  const RES = { '1080': [1920, 1080], '1440': [2560, 1440] };
  const MBPS_1080P30 = { standard: 10, high: 16, max: 25 };
  const QUALITY_LABEL = { standard: 'Standard', high: 'High', max: 'Max' };

  const R = (TS.recorder = {
    opts: TS.prefs.load('ts.recorder', DEFAULTS),
    cam: null, screen: null, micNode: null, sysNode: null, ac: null, dest: null, analyser: null,
    active: false, recording: false, paused: false, starting: false,
    mr: null, recId: null, queue: Promise.resolve(), elapsedBefore: 0, segStart: 0,
    anim: null, cur: null, timer: null, permsAsked: false, sessionItems: []
  });

  const save = () => TS.prefs.save('ts.recorder', R.opts);

  /** Current recording quality: output size, frame rate and video bitrate. */
  R.quality = function () {
    const [w, h] = RES[this.opts.res] || RES['1080'];
    const fps = +this.opts.fps === 60 ? 60 : 30;
    const base = MBPS_1080P30[this.opts.bitrate] || MBPS_1080P30.high;
    const mbps = Math.min(80, base * ((w * h) / (1920 * 1080)) * (fps === 60 ? 1.5 : 1));
    return { w, h, fps, mbps, bps: Math.round(mbps * 1e6) };
  };

  /** Resize the canvas / restart the draw loop and live sources after a quality change. */
  R.applyQuality = function (changed) {
    const q = this.quality();
    if (this.canvas.width !== q.w || this.canvas.height !== q.h) {
      this.canvas.width = q.w;
      this.canvas.height = q.h;
    }
    if (this.loop) { this.stopLoop(); this.startLoop(); }
    if (changed === 'fps' && this.active) {
      this.startCam();
      if (this.screen && this.opts.sourceId) this.startScreen(this.opts.sourceId, this.opts.sourceName, this.opts.sourceThumb, true);
    }
    const mbPerMin = Math.round((q.mbps + 0.192) * 60 / 8);
    TS.$('#qualityEst').textContent =
      `${q.h}p · ${q.fps} fps · ${q.mbps.toFixed(q.mbps < 20 ? 1 : 0)} Mbps — about ${mbPerMin >= 1000 ? (mbPerMin / 1000).toFixed(1) + ' GB' : mbPerMin + ' MB'} per minute`;
  };

  R.setQuality = function (key, value) {
    if (this.recording || this.starting) return TS.toast('Quality can\'t change during a recording.');
    if (String(this.opts[key]) === String(value)) return;
    this.opts[key] = key === 'fps' ? +value : value;
    save();
    this.applyQuality(key);
    this.syncUI();
  };

  /* ------------------------------------------------------------ init */
  R.init = function () {
    this.canvas = TS.$('#recCanvas');
    this.ctx = this.canvas.getContext('2d');

    TS.$$('#layoutSeg button').forEach(b => (b.onclick = () => this.setLayout(b.dataset.layout)));
    TS.$$('#cornerGrid button').forEach(b => (b.onclick = () => this.setOpt('corner', b.dataset.corner)));
    TS.$$('#sizeSeg button').forEach(b => (b.onclick = () => this.setOpt('size', b.dataset.size)));
    TS.$$('#shapeSeg button').forEach(b => (b.onclick = () => this.setOpt('shape', b.dataset.shape)));
    TS.$$('#resSeg button').forEach(b => (b.onclick = () => this.setQuality('res', b.dataset.res)));
    TS.$$('#fpsSeg button').forEach(b => (b.onclick = () => this.setQuality('fps', b.dataset.fps)));
    TS.$$('#bitSeg button').forEach(b => (b.onclick = () => this.setQuality('bitrate', b.dataset.bit)));
    this.applyQuality();

    const bindCheck = (id, key, after) => {
      const el = TS.$(id);
      el.checked = !!this.opts[key];
      el.onchange = () => { this.opts[key] = el.checked; save(); after && after(); };
    };
    bindCheck('#optMirror', 'mirror');
    bindCheck('#optCountdown', 'countdown');
    bindCheck('#optMini', 'mini');
    bindCheck('#optAutoAdd', 'autoAdd');
    bindCheck('#optNoise', 'noise', () => this.startMic());
    if (!TS.isMac && api.platform !== 'win32') this.opts.sysAudio = false;
    if (TS.isMac) {
      this.opts.sysAudio = false;
      TS.$('#optSysAudio').closest('label').hidden = true;
    }
    bindCheck('#optSysAudio', 'sysAudio', () => {
      if (this.opts.sourceId) this.startScreen(this.opts.sourceId, this.opts.sourceName, this.opts.sourceThumb);
    });
    const border = TS.$('#optBorder');
    border.value = this.opts.border;
    border.oninput = () => { this.opts.border = border.value; save(); };

    TS.$('#camSelect').onchange = e => { this.opts.camId = e.target.value; save(); this.startCam(); };
    TS.$('#micSelect').onchange = e => { this.opts.micId = e.target.value; save(); this.startMic(); };
    TS.$('#btnPickSource').onclick = () => this.pickSource();
    TS.$('#btnClearSource').onclick = () => this.clearSource();
    TS.$('#srcRefresh').onclick = () => this.pickSource(true);
    TS.$('#btnRec').onclick = () => this.toggleRecord();

    // voice enhancement defaults for new recordings
    const fxBox = TS.$('#recFx');
    fxBox.innerHTML = TS.fxControlsHTML({ fx: this.opts.fx, volume: this.opts.recVolume }, { volLabel: 'Volume' });
    TS.bindFx(TS.$('.fx', fxBox), () => ({ fx: this.opts.fx, volume: this.opts.recVolume }), patch => {
      if (patch.fx) this.opts.fx = patch.fx;
      if (patch.volume != null) this.opts.recVolume = patch.volume;
      save();
      this.micTestStale();
    });
    TS.$('#btnMicTest').onclick = () => this.micTest();
    TS.$('#btnPlayOrig').onclick = () => this.playTest('original');
    TS.$('#btnPlayFx').onclick = () => this.playTest('enhanced');
    TS.$('#btnPause').onclick = () => this.togglePause();

    api.on('hotkey', a => this.onHotkey(a));
    navigator.mediaDevices.addEventListener('devicechange', () => this.active && this.refreshDevices(false));

    this.syncUI();
    this.renderSessionList();
  };

  R.setOpt = function (k, v) {
    this.opts[k] = v;
    save();
    this.syncUI();
  };

  R.syncUI = function () {
    TS.$$('#layoutSeg button').forEach(b => b.classList.toggle('on', b.dataset.layout === this.opts.layout));
    TS.$$('#cornerGrid button').forEach(b => b.classList.toggle('on', b.dataset.corner === this.opts.corner));
    TS.$$('#sizeSeg button').forEach(b => b.classList.toggle('on', b.dataset.size === this.opts.size));
    TS.$$('#shapeSeg button').forEach(b => b.classList.toggle('on', b.dataset.shape === this.opts.shape));
    const busy = this.recording || this.starting;
    TS.$$('#resSeg button').forEach(b => { b.classList.toggle('on', b.dataset.res === String(this.opts.res)); b.disabled = busy; });
    TS.$$('#fpsSeg button').forEach(b => { b.classList.toggle('on', +b.dataset.fps === +this.opts.fps); b.disabled = busy; });
    TS.$$('#bitSeg button').forEach(b => { b.classList.toggle('on', b.dataset.bit === this.opts.bitrate); b.disabled = busy; });
    TS.$('#srcName').textContent = this.screen ? this.opts.sourceName : 'No screen or window';
    const th = TS.$('#srcThumb');
    th.style.backgroundImage = this.screen && this.opts.sourceThumb ? `url("${this.opts.sourceThumb}")` : '';
    th.classList.toggle('has', !!(this.screen && this.opts.sourceThumb));
    TS.$('#btnClearSource').disabled = !this.screen;

    const rec = this.recording;
    document.body.classList.toggle('recording', rec);
    const btn = TS.$('#btnRec');
    btn.classList.toggle('stop', rec);
    TS.$('#btnRecLabel').textContent = rec ? 'Stop recording' : 'Start recording';
    TS.$('#btnPause').disabled = !rec;
    TS.$('#btnPause').innerHTML = `${TS.icon(this.paused ? 'play' : 'pause')}<span>${this.paused ? 'Resume' : 'Pause'}</span>`;
    TS.$('#recBadge').classList.toggle('on', rec);
    TS.$('#recBadge').classList.toggle('paused', this.paused);
  };

  /* ----------------------------------------------------- activation */
  R.activate = async function () {
    if (this.active) return;
    this.active = true;
    this.startLoop();
    if (TS.isMac && !this.permsAsked) {
      const acc = await api.mediaAccess();
      const denied = ['camera', 'microphone'].filter(k => acc[k] === 'denied' || acc[k] === 'restricted');
      if (denied.length) {
        TS.toast(`macOS is blocking the ${denied.join(' and ')}. Allow Touchline Studio in System Settings → Privacy & Security.`, 'error', 9000);
        api.openPrivacy(denied[0]);
      }
    }
    await this.refreshDevices(!this.permsAsked);
    this.permsAsked = true;
    await Promise.all([this.startCam(), this.startMic()]);
    if (api.macSystemPicker && this.opts.sourceId) { this.opts.sourceId = null; save(); }
    if (this.opts.sourceId && !this.screen) {
      await this.startScreen(this.opts.sourceId, this.opts.sourceName, this.opts.sourceThumb, true);
    }
    const failed = await api.hotkeys(true);
    if (failed && failed.length) TS.toast(`Some global hotkeys are taken by another app: ${failed.join(', ')}`, 'error', 6000);
  };

  /** Returns false if we can't leave (recording in progress). */
  R.deactivate = function () {
    if (this.recording || this.starting) return false;
    this.active = false;
    this.stopLoop();
    if (this.cam) { this.cam.stop(); this.cam = null; }
    if (this.screen) { this.screen.stop(); this.screen = null; }
    this.stopMic();
    api.hotkeys(false);
    return true;
  };

  R.refreshDevices = async function (askPermission) {
    if (askPermission) {
      for (const c of [{ audio: true, video: true }, { audio: true }, { video: true }]) {
        try {
          const s = await navigator.mediaDevices.getUserMedia(c);
          s.getTracks().forEach(t => t.stop());
          break;
        } catch (e) { /* try the next combination */ }
      }
    }
    const devs = await navigator.mediaDevices.enumerateDevices();
    const fill = (sel, kind, current, noneLabel) => {
      const list = devs.filter(d => d.kind === kind && d.deviceId !== 'communications');
      sel.innerHTML =
        `<option value="none">${noneLabel}</option>` +
        list.map((d, i) => `<option value="${TS.esc(d.deviceId)}">${TS.esc(d.label || `${kind === 'videoinput' ? 'Camera' : 'Microphone'} ${i + 1}`)}</option>`).join('');
      const ids = list.map(d => d.deviceId);
      sel.value = current === 'none' ? 'none' : ids.includes(current) ? current : ids.includes('default') ? 'default' : ids[0] || 'none';
      return sel.value;
    };
    this.opts.camId = fill(TS.$('#camSelect'), 'videoinput', this.opts.camId, 'No camera');
    this.opts.micId = fill(TS.$('#micSelect'), 'audioinput', this.opts.micId, 'No microphone');
    save();
  };

  /* --------------------------------------------------------- sources */
  R.startCam = async function () {
    if (this.cam) { this.cam.stop(); this.cam = null; }
    if (!this.opts.camId || this.opts.camId === 'none') return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: this.opts.camId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: this.quality().fps } }
      });
      this.cam = new FrameSource(s);
    } catch (e) {
      TS.toast(`Couldn't start the camera: ${e.message}`, 'error');
    }
  };

  R.ensureAudio = function () {
    if (!this.ac) {
      this.ac = new AudioContext({ sampleRate: 48000 });
      this.dest = this.ac.createMediaStreamDestination();
      this.analyser = this.ac.createAnalyser();
      this.analyser.fftSize = 1024;
    }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
  };

  R.stopMic = function () {
    if (this.micNode) {
      try { this.micNode.disconnect(); } catch {}
      this.micNode.mediaStream.getTracks().forEach(t => t.stop());
      this.micNode = null;
    }
  };

  R.startMic = async function () {
    this.stopMic();
    if (!this.active || !this.opts.micId || this.opts.micId === 'none') return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: this.opts.micId },
          echoCancellation: false,
          noiseSuppression: !!this.opts.noise,
          autoGainControl: false,
          channelCount: 1
        }
      });
      this.ensureAudio();
      this.micNode = this.ac.createMediaStreamSource(s);
      this.micNode.connect(this.dest);
      this.micNode.connect(this.analyser);
    } catch (e) {
      TS.toast(`Couldn't open the microphone: ${e.message}`, 'error');
    }
  };

  R.pickSource = async function (refreshOnly) {
    const grid = TS.$('#srcGrid');
    if (!refreshOnly) {
      grid.innerHTML = '<div class="muted">Loading…</div>';
      TS.openModal('srcModal');
    }
    if (TS.isMac) {
      const acc = await api.mediaAccess();
      if (acc.screen !== 'granted') {
        grid.innerHTML = `<div class="mac-perm">
          <b>Allow screen recording</b>
          <p>macOS needs your permission before Touchline Studio can capture a window.</p>
          <ol><li>Click <b>Open System Settings</b> below.</li>
          <li>Under <b>Screen &amp; System Audio Recording</b>, turn on <b>Touchline Studio</b>.</li>
          <li>Quit and reopen Touchline Studio when macOS asks.</li></ol>
          <button class="primary" id="openScreenPerm">Open System Settings</button></div>`;
        TS.$('#openScreenPerm').onclick = () => api.openPrivacy('screen');
        // Triggers the system prompt and adds the app to the list in System Settings.
        api.getSources().catch(() => {});
        return;
      }
      if (api.macSystemPicker) {
        // Apple's own picker (shows every window and screen) opens from getDisplayMedia
        if (!refreshOnly) TS.closeModal('srcModal');
        return this.startScreen('system', '', null);
      }
    }
    const sources = await api.getSources();
    const card = s => `
      <button class="src-item ${s.id === this.opts.sourceId && this.screen ? 'on' : ''}" data-id="${TS.esc(s.id)}">
        <div class="thumb" style="background-image:url('${s.thumb || ''}')"></div>
        <div class="label">${s.icon ? `<img src="${s.icon}">` : ''}<span>${TS.esc(s.name)}</span></div>
      </button>`;
    const screens = sources.filter(s => s.isScreen);
    const wins = sources.filter(s => !s.isScreen);
    grid.innerHTML =
      `<div class="src-section">Windows</div>${wins.map(card).join('') || (TS.isMac
        ? `<div class="mac-perm"><b>No windows listed</b><p>macOS is only sharing the screen with Touchline Studio. This usually means the Screen Recording permission belongs to an older copy of the app.</p>
            <ol><li>Open <b>System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording</b>.</li>
            <li>Select <b>Touchline Studio</b> and remove it with the <b>−</b> button.</li>
            <li>Quit Touchline Studio (⌘Q), reopen it, click <b>Choose…</b> and allow access again.</li></ol>
            <button id="openScreenPerm2">Open System Settings</button></div>`
        : '<div class="muted">No windows found</div>')}` +
      `<div class="src-section">Entire screen</div>${screens.map(card).join('')}`;
    const op = TS.$('#openScreenPerm2');
    if (op) op.onclick = () => api.openPrivacy('screen');
    TS.$$('.src-item', grid).forEach(b => {
      b.onclick = () => {
        const s = sources.find(x => x.id === b.dataset.id);
        TS.closeModal('srcModal');
        this.startScreen(s.id, s.name, s.thumb);
      };
    });
  };

  R.startScreen = async function (id, name, thumb, quiet) {
    if (this.screen) { this.screen.stop(); this.screen = null; }
    if (this.sysNode) { try { this.sysNode.disconnect(); } catch {} this.sysNode = null; }
    try {
      await api.setCaptureSource(id, this.opts.sysAudio);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: this.quality().fps, max: 60 } },
        audio: !!this.opts.sysAudio
      });
      this.screen = new FrameSource(stream);
      this.screen.track.addEventListener('ended', () => {
        if (this.screen && this.screen.stream === stream) {
          this.screen = null;
          this.syncUI();
          TS.toast('The captured window was closed.', 'error');
        }
      });
      const at = stream.getAudioTracks()[0];
      if (at) {
        this.ensureAudio();
        this.sysNode = this.ac.createMediaStreamSource(new MediaStream([at]));
        this.sysNode.connect(this.dest);
      }
      if (id === 'system') {
        const vt = stream.getVideoTracks()[0];
        const surf = (vt.getSettings && vt.getSettings().displaySurface) || '';
        name = vt.label && !/^(screen|window|web-contents-media-stream):/.test(vt.label) ? vt.label
          : surf === 'monitor' ? 'Entire screen' : 'Selected window';
        thumb = await this.grabThumb();
      }
      Object.assign(this.opts, { sourceId: id, sourceName: name, sourceThumb: thumb });
      save();
      if (!quiet && this.opts.layout === 'cam') this.setLayout('split');
    } catch (e) {
      const cancelled = e && (e.name === 'NotAllowedError' || e.name === 'AbortError') && id === 'system';
      if (!quiet && !cancelled) TS.toast(`Couldn't capture${name ? ` "${name}"` : ''}: ${e.message}`, 'error');
      this.opts.sourceId = null;
      save();
    }
    this.syncUI();
  };

  /** Small preview image of the captured window for the Sources panel. */
  R.grabThumb = async function () {
    for (let i = 0; i < 20 && this.screen && !this.screen.image; i++) await new Promise(res => setTimeout(res, 100));
    const img = this.screen && this.screen.image;
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    TS.drawContain(ctx, img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  };

  R.clearSource = function () {
    if (this.screen) { this.screen.stop(); this.screen = null; }
    if (this.sysNode) { try { this.sysNode.disconnect(); } catch {} this.sysNode = null; }
    this.opts.sourceId = null;
    save();
    this.syncUI();
  };

  /* ------------------------------------------------------- compositor */
  R.setLayout = function (layout) {
    this.opts.layout = layout;
    save();
    this.syncUI();
    this.pushStatus();
  };

  R.target = function () {
    const hasCam = !!(this.cam && this.cam.live);
    const hasScr = !!(this.screen && this.screen.live);
    const L = this.opts.layout;
    const m = 40;
    let w;
    let h;
    let r;
    if (this.opts.shape === 'circle') {
      w = h = { S: 250, M: 330, L: 430 }[this.opts.size] || 330;
      r = w / 2;
    } else {
      w = { S: 400, M: 520, L: 680 }[this.opts.size] || 520;
      h = Math.round((w * 9) / 16);
      r = 22;
    }
    const c = this.opts.corner;
    const pip = {
      x: c.includes('l') ? m : W - w - m,
      y: c.includes('t') ? m : H - h - m,
      w, h, r
    };
    if (L === 'cam' && (hasCam || !hasScr)) return { x: 0, y: 0, w: W, h: H, r: 0, camA: hasCam ? 1 : 0, scrA: 0 };
    if (L === 'split' || L === 'cam') return { ...pip, camA: hasCam ? 1 : 0, scrA: 1 };
    return { ...pip, camA: 0, scrA: 1 };
  };

  R.state = function () {
    const T = this.target();
    const key = JSON.stringify(T);
    const now = performance.now();
    if (!this.cur) this.cur = T;
    if (!this.anim || this.anim.key !== key) this.anim = { from: { ...this.cur }, to: T, key, t0: now };
    const p = Math.min(1, (now - this.anim.t0) / 480);
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const out = {};
    for (const k of Object.keys(T)) out[k] = this.anim.from[k] + (T[k] - this.anim.from[k]) * e;
    this.cur = out;
    return out;
  };

  R.tick = function () {
    const ctx = this.ctx;
    const s = this.state();
    ctx.setTransform(this.canvas.width / W, 0, 0, this.canvas.height / H, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, W, H);

    const scr = this.screen && this.screen.image;
    const cam = this.cam && this.cam.image;

    if (s.scrA > 0.01) {
      if (scr) {
        ctx.save();
        ctx.globalAlpha = s.scrA;
        TS.drawContain(ctx, scr, 0, 0, W, H);
        ctx.restore();
      } else if (!this.recording && !this.starting) {
        this.placeholder('Choose a screen or window to capture', 'Sources → Choose…', s.scrA);
      }
    }
    if (!scr && !cam && s.scrA <= 0.01 && !this.recording && !this.starting) {
      this.placeholder('No camera', 'Pick a camera in Sources', 1);
    }

    if (s.camA > 0.01 && cam) {
      const full = Math.min(1, s.w / W);
      ctx.save();
      ctx.globalAlpha = s.camA;
      if (full < 0.97) {
        ctx.shadowColor = 'rgba(0,0,0,.55)';
        ctx.shadowBlur = 40;
        ctx.shadowOffsetY = 10;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.roundRect(s.x, s.y, s.w, s.h, s.r);
        ctx.fill();
        ctx.shadowColor = 'transparent';
      }
      ctx.beginPath();
      ctx.roundRect(s.x, s.y, s.w, s.h, s.r);
      ctx.clip();
      TS.drawCover(ctx, cam, s.x, s.y, s.w, s.h, this.opts.mirror);
      ctx.restore();
      if (full < 0.97) {
        ctx.save();
        ctx.globalAlpha = s.camA * Math.min(1, (1 - full) * 1.6);
        ctx.lineWidth = 5;
        ctx.strokeStyle = this.opts.border;
        ctx.beginPath();
        ctx.roundRect(s.x, s.y, s.w, s.h, s.r);
        ctx.stroke();
        ctx.restore();
      }
    }

    // mic meter
    if (this.analyser && this.micNode) {
      const lvl = TS.levelOf(this.analyser);
      this._lvl = Math.max(lvl, (this._lvl || 0) * 0.85);
      TS.$('#micMeter').style.width = `${Math.round(this._lvl * 100)}%`;
    } else {
      TS.$('#micMeter').style.width = '0';
    }
  };

  R.placeholder = function (title, sub, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#5b6779';
    ctx.textAlign = 'center';
    ctx.font = '600 44px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(title, W / 2, H / 2 - 6);
    ctx.font = '30px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#3d4757';
    ctx.fillText(sub, W / 2, H / 2 + 46);
    ctx.restore();
  };

  // setInterval (not rAF) so drawing continues while you're in another app
  R.startLoop = function () {
    if (this.loop) return;
    this.loop = setInterval(() => this.tick(), 1000 / this.quality().fps);
  };
  R.stopLoop = function () {
    clearInterval(this.loop);
    this.loop = null;
  };

  /* -------------------------------------------------------- recording */
  R.elapsed = function () {
    return this.elapsedBefore + (this.recording && !this.paused ? (performance.now() - this.segStart) / 1000 : 0);
  };

  R.toggleRecord = function () {
    return this.recording ? this.stop() : this.start();
  };

  R.countdown = function (n) {
    const el = TS.$('#recCountdown');
    return new Promise(res => {
      const step = k => {
        if (k === 0) { el.classList.remove('on'); return res(); }
        el.textContent = k;
        el.classList.remove('on');
        void el.offsetWidth;
        el.classList.add('on');
        setTimeout(() => step(k - 1), 1000);
      };
      step(n);
    });
  };

  R.start = async function () {
    if (this.recording || this.starting) return;
    if (!this.active) return TS.toast('Open the Record tab first.');
    if (!this.cam && !this.screen) return TS.toast('Turn on a camera or choose a screen first.', 'error');
    this.starting = true;
    try {
      this.ensureAudio();
      if (this.opts.mini) api.mini(true);
      if (this.opts.countdown) await this.countdown(3);
      this.tick(); // make sure the first captured frame is clean
      const q = (this.recQuality = this.quality());
      const video = this.canvas.captureStream(q.fps);
      const stream = new MediaStream([...video.getVideoTracks(), ...this.dest.stream.getAudioTracks()]);
      const mime = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find(m => MediaRecorder.isTypeSupported(m)) || '';
      this.recId = await api.recStart();
      this.queue = Promise.resolve();
      const id = this.recId;
      const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: q.bps, audioBitsPerSecond: 192_000 });
      mr.ondataavailable = e => {
        if (!e.data || !e.data.size) return;
        this.queue = this.queue.then(async () => api.recChunk(id, new Uint8Array(await e.data.arrayBuffer())));
      };
      mr.onstop = () => this.finish(id, video);
      mr.onerror = e => TS.toast(`Recorder error: ${e.error && e.error.message}`, 'error');
      mr.start(1000);
      this.mr = mr;
      this.recording = true;
      this.paused = false;
      this.elapsedBefore = 0;
      this.segStart = performance.now();
      this.timer = setInterval(() => this.updateTimer(), 250);
      this.updateTimer();
    } catch (e) {
      TS.toast(`Couldn't start recording: ${e.message}`, 'error');
      api.mini(false);
    } finally {
      this.starting = false;
      this.syncUI();
    }
  };

  R.togglePause = function () {
    if (!this.recording || !this.mr) return;
    if (this.paused) {
      this.mr.resume();
      this.paused = false;
      this.segStart = performance.now();
    } else {
      this.mr.pause();
      this.elapsedBefore = this.elapsed();
      this.paused = true;
    }
    this.syncUI();
    this.updateTimer();
  };

  R.stop = function () {
    if (!this.recording || !this.mr) return;
    this.elapsedBefore = this.elapsed();
    this.recording = false;
    this.paused = false;
    clearInterval(this.timer);
    try { this.mr.stop(); } catch {}
    this.mr = null;
    api.mini(false);
    this.syncUI();
    this.pushStatus();
  };

  R.finish = async function (id, videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    try {
      await this.queue;
      const q = this.recQuality || this.quality();
      const info = await api.recFinish(id, q.fps);
      const m = {
        ...info, id: TS.uid(), name: info.name.replace(/\.mp4$/i, ''),
        defaultFx: TSAudioFx.isActive(this.opts.fx) ? TSAudioFx.norm(this.opts.fx) : null,
        defaultVolume: this.opts.recVolume == null ? 1 : this.opts.recVolume
      };
      TS.store.commit(p => {
        p.media.push(m);
        if (this.opts.autoAdd) p.clips.push(TS.makeClip(m));
        // export defaults follow the best recording quality used in this project
        if (q.fps > (p.settings.fps || 30)) p.settings.fps = q.fps;
        if (q.h > (p.settings.height || 1080)) p.settings.height = q.h;
      });
      TS.library.makeThumb(m.id);
      this.sessionItems.unshift(m.id);
      this.renderSessionList();
      if (m.fps && m.duration > 2 && m.fps < q.fps * 0.8) {
        TS.toast(`Heads up: your PC only managed about ${Math.round(m.fps)} fps of the ${q.fps} fps you chose, so motion may look choppy. ` +
          `Try ${q.fps === 60 ? '30 fps' : q.h > 1080 ? '1080p' : 'a lower bitrate'} in Recording quality.`, 'error', 10000);
      }
      TS.toast(`Saved ${TS.fmt(m.duration, false)} recording (${q.h}p${q.fps})${this.opts.autoAdd ? ' — added to the timeline' : ''}`, 'ok');
    } catch (e) {
      TS.toast(`Saving the recording failed: ${e.message}`, 'error', 8000);
    }
  };

  /* ---------------------------------------------------------- mic test */
  R.micTest = async function () {
    if (this.testing) return;
    if (this.recording || this.starting) return TS.toast('Finish the recording first.');
    if (!this.micNode && !this.sysNode) return TS.toast('Pick a microphone first.', 'error');
    this.ensureAudio();
    this.stopTestAudio();
    this.testing = true;
    const btn = TS.$('#btnMicTest');
    const label = TS.$('#micTestLabel');
    const body = TS.$('#micTestBody');
    btn.classList.add('recording');
    TS.$('#micTestPlay').hidden = true;
    body.innerHTML = '<b>Recording…</b> talk like you would in a video.';
    try {
      const mime = ['audio/webm;codecs=opus', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(new MediaStream(this.dest.stream.getAudioTracks()), { mimeType: mime, audioBitsPerSecond: 192000 });
      const chunks = [];
      mr.ondataavailable = e => e.data.size && chunks.push(e.data);
      const stopped = new Promise(res => (mr.onstop = res));
      mr.start(250);
      for (let k = 5; k > 0; k--) {
        label.textContent = `Recording… ${k}`;
        await new Promise(res => setTimeout(res, 1000));
      }
      mr.stop();
      await stopped;
      label.textContent = 'Checking…';
      this.testBytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      await this.analyseTest();
    } catch (e) {
      body.textContent = `Mic test failed: ${e.message}`;
    } finally {
      this.testing = false;
      btn.classList.remove('recording');
      label.textContent = 'Record again';
    }
  };

  R.analyseTest = async function () {
    const r = (this.testResult = await api.fxTest(this.testBytes, TSAudioFx.norm(this.opts.fx), this.opts.recVolume));
    const verdict = ({ mean, max }, limited) => {
      if (mean == null || mean < -60) return ['bad', 'No sound picked up — check the microphone selection'];
      if (limited && mean > -12) return ['meh', 'Very loud — lower the Volume a little'];
      if (!limited && max >= -0.3) return ['bad', 'Clipping — too loud. Lower your mic input level or move back a little'];
      if (mean < -38) return ['bad', 'Very quiet — move closer or raise the Volume'];
      if (mean < -28) return ['meh', 'A bit quiet — try raising the Volume or Auto level'];
      return ['good', 'Good level'];
    };
    const [c1, t1] = verdict(r.original);
    const [c2, t2] = verdict(r.enhanced, true); // limiter output: peaks near 0 dB are expected
    const db = x => (x == null || !isFinite(x) ? '–' : `${x.toFixed(0)} dB`);
    TS.$('#micTestBody').innerHTML =
      `As recorded: <span class="${c1}">${t1}</span> <span class="muted">(avg ${db(r.original.mean)}, peak ${db(r.original.max)})</span><br>` +
      `With enhancement: <span class="${c2}">${t2}</span> <span class="muted">(avg ${db(r.enhanced.mean)}, peak ${db(r.enhanced.max)})</span>`;
    TS.$('#micTestPlay').hidden = false;
  };

  /** enhancement settings changed → re-process the existing test take */
  R.micTestStale = function () {
    if (!this.testBytes || this.testing) return;
    clearTimeout(this._fxT);
    this._fxT = setTimeout(() => { this.stopTestAudio(); this.analyseTest().catch(() => {}); }, 400);
  };

  R.playTest = function (which) {
    if (!this.testResult) return;
    const was = this.testPlaying;
    this.stopTestAudio();
    if (was === which) return;
    const a = (this.testAudio = new Audio(api.fileUrl(this.testResult[which].path)));
    this.testPlaying = which;
    const btn = TS.$(which === 'original' ? '#btnPlayOrig' : '#btnPlayFx');
    btn.textContent = '■ Stop';
    a.onended = () => this.stopTestAudio();
    a.play().catch(() => this.stopTestAudio());
  };

  R.stopTestAudio = function () {
    if (this.testAudio) { this.testAudio.pause(); this.testAudio = null; }
    this.testPlaying = null;
    TS.$('#btnPlayOrig').textContent = '▶ As recorded';
    TS.$('#btnPlayFx').textContent = '▶ With enhancement';
  };

  R.updateTimer = function () {
    const t = TS.fmt(this.elapsed(), false);
    TS.$('#recTime').textContent = t;
    TS.$('#recTimer').textContent = t;
    this.pushStatus();
  };

  R.pushStatus = function () {
    api.recStatus({ recording: this.recording, paused: this.paused, elapsed: this.elapsed(), layout: this.opts.layout });
  };

  R.onHotkey = function (a) {
    if (!this.active && !this.recording) return;
    if (a === 'layout-cam') this.setLayout('cam');
    else if (a === 'layout-split') this.setLayout('split');
    else if (a === 'layout-screen') this.setLayout('screen');
    else if (a === 'toggle-rec') this.toggleRecord();
    else if (a === 'pause') this.togglePause();
  };

  R.renderSessionList = function () {
    const list = TS.$('#recList');
    const items = this.sessionItems.map(id => TS.store.media(id)).filter(Boolean);
    if (!items.length) {
      list.innerHTML = '<div class="empty-note">Recordings you make appear here and in the Edit tab.</div>';
      return;
    }
    list.innerHTML = items.map(m => `
      <div class="rec-item">
        <img src="${m.thumb || ''}">
        <div class="grow"><div class="name">${TS.esc(m.name)}</div><div class="muted">${TS.fmt(m.duration, false)}</div></div>
        <button class="icon ghost" data-reveal="${TS.esc(m.id)}" title="Show in folder">${TS.icon('folder')}</button>
      </div>`).join('');
    TS.$$('[data-reveal]', list).forEach(b => (b.onclick = () => api.reveal(TS.store.media(b.dataset.reveal).path)));
  };
})();
