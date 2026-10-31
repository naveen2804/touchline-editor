'use strict';
const {
  app, BrowserWindow, ipcMain, dialog, desktopCapturer, session, globalShortcut, shell, screen,
  Menu, systemPreferences
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { buildExport } = require('./shared/exportGraph');
const encoders = require('./shared/encoders');

// Keep the recorder drawing at full speed while you're working in another window.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.TS_SNAPSHOT) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  if (process.env.TS_SNAPSHOT_DATA) app.setPath('userData', process.env.TS_SNAPSHOT_DATA);
}

const unpacked = p => (p ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : p);
const FFMPEG = unpacked(require('ffmpeg-static'));
const FFPROBE = unpacked(require('ffprobe-static').path);
const ICON = path.join(__dirname, 'build', 'icon.png');
const IS_MAC = process.platform === 'darwin';
// macOS 15 (Darwin 24)+: use Apple's ScreenCaptureKit picker, which reliably lists every window.
const MAC_SYSTEM_PICKER = IS_MAC && parseInt(os.release(), 10) >= 24;
const PRELOAD = path.join(__dirname, 'preload.js');

let mainWin = null;
let miniWin = null;
let DIRS = null;
let capture = { id: null, loopback: false };
const recordings = new Map();
let exportProc = null;

const send = (ch, payload) => {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(ch, payload);
};
const task = (label, progress = null) => send('task', { label, progress });
const taskDone = () => send('task', null);

function ensureDirs() {
  const root = path.join(app.getPath('documents'), 'Touchline Studio');
  DIRS = {
    root,
    recordings: path.join(root, 'Recordings'),
    audio: path.join(root, 'Audio'),
    media: path.join(root, 'Imported'),
    exports: path.join(root, 'Exports'),
    projects: path.join(root, 'Projects')
  };
  Object.values(DIRS).forEach(d => fs.mkdirSync(d, { recursive: true }));
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}
const safeName = s => String(s || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80) || 'Untitled';

function uniquePath(dir, base, ext) {
  let p = path.join(dir, base + ext);
  let i = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}

/* ---------------------------------------------------------------- FFmpeg */

function runFfmpeg(args, { duration = 0, onProgress, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args], { windowsHide: true });
    if (onSpawn) onSpawn(proc);
    let errTail = '';
    let buf = '';
    proc.stdout.on('data', d => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) {
        const m = l.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m && duration > 0 && onProgress) onProgress(Math.max(0, Math.min(1, +m[1] / 1e6 / duration)));
      }
    });
    proc.stderr.on('data', d => { errTail = (errTail + d.toString()).slice(-6000); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) return resolve();
      if (proc.killedByUser) return reject(new Error('cancelled'));
      const lines = errTail.trim().split(/\r?\n/).filter(Boolean);
      reject(new Error(lines.slice(-6).join('\n') || `FFmpeg exited with code ${code}`));
    });
  });
}

function probe(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => {
      if (code !== 0) return reject(new Error(err.trim() || 'Could not read this file'));
      try {
        const j = JSON.parse(out);
        const streams = j.streams || [];
        const v = streams.find(s => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
        const a = streams.find(s => s.codec_type === 'audio');
        let duration = parseFloat(j.format && j.format.duration);
        if (!isFinite(duration)) {
          const ds = streams.map(s => parseFloat(s.duration)).filter(isFinite);
          duration = ds.length ? Math.max(...ds) : NaN;
        }
        resolve({
          duration,
          hasVideo: !!v,
          hasAudio: !!a,
          width: v ? v.width : 0,
          height: v ? v.height : 0,
          vcodec: v ? v.codec_name : null,
          pixfmt: v ? v.pix_fmt : null,
          fps: v && v.avg_frame_rate && /^\d+\/\d+$/.test(v.avg_frame_rate) && +v.avg_frame_rate.split('/')[1]
            ? +v.avg_frame_rate.split('/')[0] / +v.avg_frame_rate.split('/')[1] : null,
          acodec: a ? a.codec_name : null,
          format: (j.format && j.format.format_name) || ''
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

const OK_V = ['h264', 'vp8', 'vp9', 'av1'];
const OK_PIX = ['yuv420p', 'yuvj420p', null];
const OK_A = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_u8'];
const OK_VEXT = ['.mp4', '.m4v', '.mov', '.webm'];
const OK_AEXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.webm'];

function describe(info, file, extra = {}) {
  return {
    ...info,
    path: file,
    name: path.basename(file),
    type: info.hasVideo ? 'video' : 'audio',
    ...extra
  };
}

/** Probe a file and, if the built-in player can't play it smoothly, convert it once. */
async function importOne(file, label) {
  const info = await probe(file);
  if (!info.hasVideo && !info.hasAudio) throw new Error('No audio or video found in this file');
  const ext = path.extname(file).toLowerCase();
  let needs = !isFinite(info.duration) || info.duration <= 0;
  if (info.hasVideo) {
    needs = needs || !OK_VEXT.includes(ext) || !OK_V.includes(info.vcodec) || !OK_PIX.includes(info.pixfmt) ||
      (info.hasAudio && !OK_A.includes(info.acodec));
  } else {
    needs = needs || !OK_AEXT.includes(ext) || !OK_A.includes(info.acodec);
  }
  if (!needs) return describe(info, file, { original: file });

  const base = path.parse(file).name;
  let out;
  let args;
  if (info.hasVideo) {
    out = uniquePath(DIRS.media, base, '.mp4');
    args = ['-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', out];
  } else {
    out = uniquePath(DIRS.audio, base, '.wav');
    args = ['-y', '-i', file, '-map', '0:a:0', '-ar', '48000', '-ac', '2', out];
  }
  task(`Converting ${label}…`, 0);
  await runFfmpeg(args, { duration: info.duration || 0, onProgress: p => task(`Converting ${label}…`, p) });
  const info2 = await probe(out);
  return describe(info2, out, { name: path.basename(file), converted: true, original: file });
}

/* --------------------------------------------------------------- windows */

function createMain() {
  mainWin = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#0b0e13',
    title: 'Touchline Studio',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  if (!IS_MAC) mainWin.removeMenu();
  mainWin.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWin.once('ready-to-show', () => {
    if (process.env.TS_SNAPSHOT) return;
    mainWin.maximize();
    mainWin.show();
  });
  mainWin.webContents.on('will-navigate', e => e.preventDefault());
  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWin.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') mainWin.webContents.toggleDevTools();
  });
  mainWin.on('closed', () => {
    mainWin = null;
    if (miniWin && !miniWin.isDestroyed()) miniWin.destroy();
  });
}

function showMini(show) {
  if (!show) {
    if (miniWin && !miniWin.isDestroyed()) miniWin.hide();
    return;
  }
  if (miniWin && !miniWin.isDestroyed()) {
    miniWin.showInactive();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const w = 470;
  const h = 58;
  miniWin = new BrowserWindow({
    width: w,
    height: h,
    x: workArea.x + Math.round((workArea.width - w) / 2),
    y: workArea.y + 14,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false }
  });
  miniWin.setAlwaysOnTop(true, 'screen-saver');
  miniWin.setContentProtection(true); // keep the control bar out of your screen recording
  miniWin.loadFile(path.join(__dirname, 'src', 'mini.html'));
  miniWin.once('ready-to-show', () => miniWin.showInactive());
}

/* ------------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('paths', () => DIRS);

  // macOS privacy permissions (camera / mic prompt; screen recording must be granted in System Settings)
  ipcMain.handle('media-access', async () => {
    if (!IS_MAC) return { camera: 'granted', microphone: 'granted', screen: 'granted' };
    for (const kind of ['camera', 'microphone']) {
      if (systemPreferences.getMediaAccessStatus(kind) === 'not-determined') {
        try { await systemPreferences.askForMediaAccess(kind); } catch {}
      }
    }
    return {
      camera: systemPreferences.getMediaAccessStatus('camera'),
      microphone: systemPreferences.getMediaAccessStatus('microphone'),
      screen: systemPreferences.getMediaAccessStatus('screen')
    };
  });
  ipcMain.handle('open-privacy', (e, pane) => {
    if (!IS_MAC) return;
    const anchors = { screen: 'Privacy_ScreenCapture', camera: 'Privacy_Camera', microphone: 'Privacy_Microphone' };
    shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchors[pane] || 'Privacy'}`);
  });

  ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 400, height: 225 },
      fetchWindowIcons: true
    });
    return sources
      .filter(s => !/^Touchline Studio( Mini)?$/.test(s.name))
      .map(s => ({
        id: s.id,
        name: s.name,
        isScreen: s.id.startsWith('screen:'),
        thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
      }));
  });

  ipcMain.handle('set-capture-source', (e, id, loopback) => {
    capture = { id, loopback: !!loopback };
    return true;
  });

  // --- recording: chunks streamed straight to disk, remuxed to MP4 on stop
  ipcMain.handle('rec-start', () => {
    const id = stamp();
    const tmp = path.join(DIRS.recordings, `.recording ${id}.webm`);
    recordings.set(id, { tmp, stream: fs.createWriteStream(tmp) });
    return id;
  });
  ipcMain.on('rec-chunk', (e, id, data) => {
    const r = recordings.get(id);
    if (r) r.stream.write(Buffer.from(data));
  });
  ipcMain.handle('rec-cancel', async (e, id) => {
    const r = recordings.get(id);
    if (!r) return;
    recordings.delete(id);
    await new Promise(res => r.stream.end(res));
    fs.unlink(r.tmp, () => {});
  });
  ipcMain.handle('rec-finish', async (e, id, fps) => {
    const r = recordings.get(id);
    if (!r) throw new Error('Recording not found');
    recordings.delete(id);
    await new Promise(res => r.stream.end(res));
    const out = uniquePath(DIRS.recordings, `Recording ${id}`, '.mp4');
    task('Saving recording…', null);
    try {
      try {
        await runFfmpeg(['-y', '-fflags', '+genpts', '-i', r.tmp, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
          '-movflags', '+faststart', out]);
      } catch (err) {
        const info = await probe(r.tmp).catch(() => ({ duration: 0 }));
        await runFfmpeg(['-y', '-i', r.tmp, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
          '-r', String(fps === 60 ? 60 : 30), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', out],
          { duration: info.duration || 0, onProgress: p => task('Saving recording…', p) });
      }
      const info = await probe(out);
      fs.unlink(r.tmp, () => {});
      return describe(info, out, { recorded: true });
    } finally {
      taskDone();
    }
  });

  // --- voiceover / any recorded audio → WAV
  ipcMain.handle('save-audio', async (e, data, name) => {
    const tmp = path.join(os.tmpdir(), `ts_audio_${Date.now()}.webm`);
    fs.writeFileSync(tmp, Buffer.from(data));
    const out = uniquePath(DIRS.audio, safeName(name || `Voiceover ${stamp()}`), '.wav');
    try {
      await runFfmpeg(['-y', '-i', tmp, '-ar', '48000', '-ac', '2', out]);
      return describe(await probe(out), out, { voiceover: true });
    } finally {
      fs.unlink(tmp, () => {});
    }
  });

  ipcMain.handle('extract-audio', async (e, file) => {
    const base = path.parse(file).name;
    const out = uniquePath(DIRS.audio, `${base} - audio`, '.wav');
    const info = await probe(file);
    task('Detaching audio…', 0);
    try {
      await runFfmpeg(['-y', '-i', file, '-vn', '-map', '0:a:0', '-ar', '48000', '-ac', '2', out],
        { duration: info.duration || 0, onProgress: p => task('Detaching audio…', p) });
      return describe(await probe(out), out, { detached: true });
    } finally {
      taskDone();
    }
  });

  ipcMain.handle('open-files', async () => {
    const r = await dialog.showOpenDialog(mainWin, {
      title: 'Import clips or audio',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video & audio', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mts', 'm2ts', 'ts', '3gp', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wma'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('import-media', async (e, files) => {
    const items = [];
    const errors = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const label = files.length > 1 ? `${path.basename(f)} (${i + 1}/${files.length})` : path.basename(f);
      try {
        task(`Importing ${label}…`, null);
        items.push(await importOne(f, label));
      } catch (err) {
        errors.push({ name: path.basename(f), error: err.message.split('\n').pop() });
      }
    }
    taskDone();
    return { items, errors };
  });

  ipcMain.handle('exists', (e, files) => files.map(f => !!f && fs.existsSync(f)));
  ipcMain.handle('probe', async (e, file) => probe(file).catch(() => null));

  // --- export
  ipcMain.handle('export-path', (e, name) => uniquePath(DIRS.exports, safeName(name), '.mp4'));
  ipcMain.handle('export-dialog', async (e, current) => {
    const r = await dialog.showSaveDialog(mainWin, {
      title: 'Export video',
      defaultPath: current,
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('encoders', async () => {
    const hardware = await encoders.detectHardware(FFMPEG);
    return { hardware, labels: encoders.LABELS };
  });

  ipcMain.handle('export-start', async (e, spec) => {
    let script = null;
    try {
      const g = buildExport(spec);
      script = path.join(os.tmpdir(), `ts_filter_${Date.now()}.txt`);
      fs.writeFileSync(script, g.filter);
      fs.mkdirSync(path.dirname(spec.output), { recursive: true });

      const hw = spec.encoder === 'cpu' ? [] : await encoders.detectHardware(FFMPEG);
      const order = [...hw.slice(0, 1), 'libx264'];
      let lastErr = null;
      for (const enc of order) {
        send('export-encoder', { encoder: enc, label: encoders.LABELS[enc] });
        const args = ['-y', ...g.inputs,
          '-filter_complex_threads', String(Math.max(2, os.cpus().length)),
          '-filter_complex_script', script, ...g.maps,
          ...encoders.encoderArgs(enc, spec.settings, spec.quality),
          '-r', String(spec.settings.fps || 30),
          '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', spec.output];
        try {
          send('export-progress', 0);
          await runFfmpeg(args, {
            duration: g.duration,
            onProgress: p => send('export-progress', p),
            onSpawn: p => (exportProc = p)
          });
          return { ok: true, output: spec.output, encoder: enc, encoderLabel: encoders.LABELS[enc], fellBack: enc !== order[0] };
        } catch (err) {
          if (err.message === 'cancelled') throw err;
          lastErr = err; // hardware encoder failed mid-way → retry on the CPU
        }
      }
      throw lastErr;
    } catch (err) {
      const cancelled = err.message === 'cancelled';
      if (cancelled) fs.unlink(spec.output, () => {});
      return { ok: false, cancelled, error: err.message };
    } finally {
      exportProc = null;
      if (script) fs.unlink(script, () => {});
    }
  });
  ipcMain.handle('export-cancel', () => {
    if (exportProc) {
      exportProc.killedByUser = true;
      exportProc.kill();
    }
  });

  // --- projects
  const autosaveFile = () => path.join(app.getPath('userData'), 'autosave.json');
  ipcMain.handle('autosave', (e, json) => { fs.writeFileSync(autosaveFile(), json); return true; });
  ipcMain.handle('load-autosave', () => (fs.existsSync(autosaveFile()) ? fs.readFileSync(autosaveFile(), 'utf8') : null));
  ipcMain.handle('save-project', async (e, { json, filePath, name, saveAs }) => {
    let target = filePath;
    if (!target || saveAs) {
      const r = await dialog.showSaveDialog(mainWin, {
        title: 'Save project',
        defaultPath: path.join(DIRS.projects, `${safeName(name)}.tsproj`),
        filters: [{ name: 'Touchline Studio project', extensions: ['tsproj'] }]
      });
      if (r.canceled) return null;
      target = r.filePath;
    }
    fs.writeFileSync(target, json);
    return target;
  });
  ipcMain.handle('open-project', async () => {
    const r = await dialog.showOpenDialog(mainWin, {
      title: 'Open project',
      defaultPath: DIRS.projects,
      properties: ['openFile'],
      filters: [{ name: 'Touchline Studio project', extensions: ['tsproj', 'json'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return { json: fs.readFileSync(r.filePaths[0], 'utf8'), filePath: r.filePaths[0] };
  });

  ipcMain.handle('reveal', (e, p) => shell.showItemInFolder(p));
  ipcMain.handle('open-path', (e, p) => shell.openPath(p));

  // --- global hotkeys + floating control bar
  const HOTKEYS = {
    'CommandOrControl+Alt+1': 'layout-cam',
    'CommandOrControl+Alt+2': 'layout-split',
    'CommandOrControl+Alt+3': 'layout-screen',
    'CommandOrControl+Alt+R': 'toggle-rec',
    'CommandOrControl+Alt+P': 'pause'
  };
  ipcMain.handle('hotkeys', (e, on) => {
    globalShortcut.unregisterAll();
    const failed = [];
    if (on) {
      for (const [key, action] of Object.entries(HOTKEYS)) {
        try {
          if (!globalShortcut.register(key, () => send('hotkey', action))) failed.push(key);
        } catch {
          failed.push(key);
        }
      }
    }
    return failed;
  });
  ipcMain.handle('mini', (e, show) => showMini(show));
  ipcMain.on('mini-cmd', (e, cmd) => send('hotkey', cmd));
  ipcMain.on('rec-status', (e, status) => {
    if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send('rec-status', status);
  });
}

/* ------------------------------------------------------------- lifecycle */

app.whenReady().then(() => {
  ensureDirs();
  app.setAppUserModelId('com.naveen.touchlinestudio');

  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const src = sources.find(s => s.id === capture.id) || sources.find(s => s.id.startsWith('screen:')) || sources[0];
      if (capture.loopback && process.platform === 'win32') callback({ video: src, audio: 'loopback' });
      else callback({ video: src });
    } catch (err) {
      callback({});
    }
  }, { useSystemPicker: MAC_SYSTEM_PICKER }); // set once: toggling this option can hang on macOS

  if (IS_MAC) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' }
    ]));
  }
  registerIpc();
  createMain();
  // find a working GPU encoder in the background so Export is ready to use it
  setTimeout(() => encoders.detectHardware(FFMPEG).catch(() => {}), 4000);

  if (process.env.TS_SNAPSHOT) require('./test/snapshot')(mainWin);
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!mainWin && app.isReady()) createMain(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
