'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { pathToFileURL } = require('url');

const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const CHANNELS = ['hotkey', 'task', 'export-progress', 'export-encoder', 'rec-status'];

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  paths: () => inv('paths'),
  mediaAccess: () => inv('media-access'),
  openPrivacy: pane => inv('open-privacy', pane),
  fileUrl: p => (p ? pathToFileURL(p).href : ''),
  pathForFile: f => {
    try { return webUtils.getPathForFile(f); } catch { return null; }
  },

  getSources: () => inv('get-sources'),
  setCaptureSource: (id, loopback) => inv('set-capture-source', id, loopback),

  recStart: () => inv('rec-start'),
  recChunk: (id, bytes) => ipcRenderer.send('rec-chunk', id, bytes),
  recFinish: (id, fps) => inv('rec-finish', id, fps),
  recCancel: id => inv('rec-cancel', id),
  saveAudio: (bytes, name) => inv('save-audio', bytes, name),

  openFiles: () => inv('open-files'),
  importMedia: paths => inv('import-media', paths),
  extractAudio: p => inv('extract-audio', p),
  exists: paths => inv('exists', paths),
  probe: p => inv('probe', p),

  exportPath: name => inv('export-path', name),
  exportDialog: current => inv('export-dialog', current),
  exportStart: spec => inv('export-start', spec),
  encoders: () => inv('encoders'),
  exportCancel: () => inv('export-cancel'),

  autosave: json => inv('autosave', json),
  loadAutosave: () => inv('load-autosave'),
  saveProject: opts => inv('save-project', opts),
  openProject: () => inv('open-project'),

  reveal: p => inv('reveal', p),
  openPath: p => inv('open-path', p),

  hotkeys: on => inv('hotkeys', on),
  mini: show => inv('mini', show),
  miniCmd: cmd => ipcRenderer.send('mini-cmd', cmd),
  recStatus: s => ipcRenderer.send('rec-status', s),

  on: (channel, fn) => {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (e, payload) => fn(payload));
  }
});
