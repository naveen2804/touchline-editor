'use strict';
window.TS = window.TS || {};

TS.$ = (s, r = document) => r.querySelector(s);
TS.$$ = (s, r = document) => [...r.querySelectorAll(s)];
TS.uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
TS.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
TS.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

TS.fmt = (s, frac = true) => {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  const whole = Math.floor(sec);
  const cs = Math.min(99, Math.floor((sec - whole) * 100));
  const mm = h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`;
  return `${mm}:${String(whole).padStart(2, '0')}${frac ? '.' + String(cs).padStart(2, '0') : ''}`;
};

/* -------------------------------------------------------------- icons */
const P = {
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M5.5 5v14M19 5v14L8.5 12z" fill="currentColor"/>',
  next: '<path d="M18.5 5v14M5 5v14l10.5-7z" fill="currentColor"/>',
  stepBack: '<path d="M15 6l-6 6 6 6"/>',
  stepFwd: '<path d="M9 6l6 6-6 6"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  folder: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  camera: '<rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="M16 10.5l6-3.5v10l-6-3.5"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  pip: '<rect x="2" y="4" width="20" height="15" rx="2"/><rect x="12.5" y="11" width="6.5" height="5" rx="1" fill="currentColor"/>',
  unlink: '<path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 4.2 7.7"/><path d="M3 3l18 18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  volume: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12"/>',
  mute: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'
};
TS.icon = (name, cls = '') =>
  `<svg viewBox="0 0 24 24" class="ic ${cls}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
TS.hydrateIcons = (root = document) => {
  TS.$$('i[data-icon]', root).forEach(i => {
    i.outerHTML = TS.icon(i.dataset.icon, i.className);
  });
};

/* ----------------------------------------------------------- drawing */
TS.srcSize = src => [
  src.videoWidth || src.displayWidth || src.width || 0,
  src.videoHeight || src.displayHeight || src.height || 0
];
TS.drawContain = (ctx, src, x, y, w, h) => {
  const [sw, sh] = TS.srcSize(src);
  if (!sw || !sh) return;
  const s = Math.min(w / sw, h / sh);
  const dw = sw * s;
  const dh = sh * s;
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
};
TS.drawCover = (ctx, src, x, y, w, h, mirror) => {
  const [sw, sh] = TS.srcSize(src);
  if (!sw || !sh) return;
  const s = Math.max(w / sw, h / sh);
  const cw = w / s;
  const ch = h / s;
  const sx = (sw - cw) / 2;
  const sy = (sh - ch) / 2;
  if (mirror) {
    ctx.save();
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(src, sx, sy, cw, ch, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(src, sx, sy, cw, ch, x, y, w, h);
  }
};

/* ---------------------------------------------------- toasts & tasks */
TS.toast = (msg, kind = 'info', ms = 3400) => {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  TS.$('#toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 260);
  }, ms);
};

TS.showTask = t => {
  const bar = TS.$('#taskBar');
  if (!t) { bar.hidden = true; return; }
  bar.hidden = false;
  TS.$('#taskLabel').textContent = t.label;
  const prog = TS.$('.task-prog', bar);
  prog.style.display = t.progress == null ? 'none' : '';
  TS.$('#taskProg').style.width = `${Math.round((t.progress || 0) * 100)}%`;
};

/* ------------------------------------------------------------ modals */
TS.openModal = id => TS.$('#' + id).classList.add('open');
TS.closeModal = id => TS.$('#' + id).classList.remove('open');

/* ----------------------------------------------------------- settings */
TS.prefs = {
  load(key, defaults) {
    try {
      return Object.assign({}, defaults, JSON.parse(localStorage.getItem(key) || '{}'));
    } catch {
      return Object.assign({}, defaults);
    }
  },
  save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
};

/* ---------------------------------------------------------- mic meter */
TS.levelOf = analyser => {
  const buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
  return Math.min(1, peak / 100);
};

TS.TRANSITIONS = [
  { id: 'none', label: 'Cut' },
  { id: 'fade', label: 'Fade' },
  { id: 'blur', label: 'Blur' },
  { id: 'slideleft', label: 'Swipe ←' },
  { id: 'slideright', label: 'Swipe →' },
  { id: 'wipeleft', label: 'Wipe' },
  { id: 'fadeblack', label: 'Dip black' },
  { id: 'fadewhite', label: 'Dip white' },
  { id: 'zoomin', label: 'Zoom' },
  { id: 'circleopen', label: 'Circle' },
  { id: 'pixelize', label: 'Pixelate' },
  { id: 'dissolve', label: 'Dissolve' }
];
TS.transLabel = id => (TS.TRANSITIONS.find(t => t.id === id) || { label: id }).label;

/* ---------------------------------------------------- platform labels */
TS.isMac = window.api && window.api.platform === 'darwin';
/** On macOS show ⌘ / ⌥ instead of Ctrl / Alt in shortcut hints. */
TS.platformKeys = (root = document) => {
  if (!TS.isMac) return;
  TS.$$('kbd', root).forEach(k => {
    if (k.textContent === 'Ctrl') k.textContent = '⌘';
    else if (k.textContent === 'Alt') k.textContent = '⌥';
  });
};
