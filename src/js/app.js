'use strict';
/* App shell: tabs, project files, keyboard shortcuts, drag-and-drop, background tasks. */

(function () {
  let tab = 'record';

  async function setTab(next) {
    if (next === tab) return;
    if (next === 'edit') {
      if (!TS.recorder.deactivate()) return TS.toast('Stop the recording before switching to Edit.');
      TS.player.setVisible(true);
    } else {
      TS.player.setVisible(false);
      TS.recorder.activate();
    }
    tab = next;
    TS.$$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    TS.$$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${tab}`));
    if (tab === 'edit') TS.timeline.render();
  }
  TS.setTab = setTab;

  async function checkMissing() {
    const media = TS.store.project.media;
    if (!media.length) return;
    const ok = await api.exists(media.map(m => m.path));
    let changed = false;
    media.forEach((m, i) => {
      if (!!m.missing !== !ok[i]) { m.missing = !ok[i]; changed = true; }
    });
    if (changed) TS.store.emit('change');
    const n = ok.filter(x => !x).length;
    if (n) TS.toast(`${n} file${n > 1 ? 's' : ''} in this project can't be found (moved or deleted).`, 'error', 6000);
    media.filter(m => m.type === 'video' && !m.thumb && !m.missing).forEach(m => TS.library.makeThumb(m.id));
  }

  async function saveProject(saveAs) {
    const p = TS.store.project;
    const path = await api.saveProject({ json: TS.store.snapshot(), filePath: p.filePath, name: p.name, saveAs });
    if (path) {
      p.filePath = path;
      TS.store.scheduleSave();
      TS.toast('Project saved', 'ok');
    }
  }

  async function openProject() {
    const r = await api.openProject();
    if (!r) return;
    try {
      const p = JSON.parse(r.json);
      p.filePath = r.filePath;
      TS.store.load(p);
      syncName();
      await checkMissing();
      setTab('edit');
    } catch (e) {
      TS.toast(`Couldn't open that project: ${e.message}`, 'error');
    }
  }

  function newProject() {
    if (TS.store.project.clips.length && !confirm('Start a new project? Unsaved changes to the current one will be lost (your recordings stay on disk).')) return;
    TS.player.pause();
    TS.store.load(TS.newProject());
    syncName();
  }

  function syncName() {
    TS.$('#projectName').value = TS.store.project.name;
  }

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' && !['range', 'checkbox', 'color'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }

  function onKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      TS.$$('.modal.open').forEach(m => {
        if (m.id === 'voModal') TS.voiceover.close();
        else if (m.id === 'expModal' && TS.exporter.running) return;
        else m.classList.remove('open');
      });
      return;
    }
    if (TS.$('.modal.open')) return;
    if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); return saveProject(e.shiftKey); }
    if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); return openProject(); }
    if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); return TS.exporter.open(); }
    if (isTyping(e)) return;

    if (tab === 'record') {
      if (e.key === '1') TS.recorder.setLayout('cam');
      else if (e.key === '2') TS.recorder.setLayout('split');
      else if (e.key === '3') TS.recorder.setLayout('screen');
      return;
    }

    const k = e.key;
    if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? TS.store.redo() : TS.store.undo(); }
    if (ctrl && k.toLowerCase() === 'y') { e.preventDefault(); return TS.store.redo(); }
    if (ctrl && k.toLowerCase() === 'd' && TS.store.selectedClip()) { e.preventDefault(); return TS.editor.duplicate(TS.store.sel); }
    if (ctrl) return;
    switch (k) {
      case ' ': e.preventDefault(); TS.player.toggle(); break;
      case 's': case 'S': TS.editor.split(); break;
      case 'i': case 'I': TS.editor.setInOut('in'); break;
      case 'o': case 'O': TS.editor.setInOut('out'); break;
      case 'Delete': case 'Backspace': TS.editor.deleteSelected(); break;
      case 'ArrowLeft': e.preventDefault(); e.shiftKey ? TS.player.setTime(TS.player.t - 1) : TS.player.step(-1); break;
      case 'ArrowRight': e.preventDefault(); e.shiftKey ? TS.player.setTime(TS.player.t + 1) : TS.player.step(1); break;
      case 'Home': TS.player.setTime(0); break;
      case 'End': TS.player.setTime(TS.player.L.total); break;
      case '=': case '+': TS.timeline.setZoom(TS.timeline.pps * 1.25); break;
      case '-': TS.timeline.setZoom(TS.timeline.pps / 1.25); break;
    }
  }

  function setupDrop() {
    let depth = 0;
    const hasFiles = e => [...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files');
    window.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; document.body.classList.add('dropping'); } });
    window.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; document.body.classList.remove('dropping'); } });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', async e => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dropping');
      if (!hasFiles(e)) return;
      const paths = [...e.dataTransfer.files].map(f => api.pathForFile(f)).filter(Boolean);
      if (!paths.length) return;
      if (tab !== 'edit') await setTab('edit');
      TS.library.importPaths(paths);
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    TS.hydrateIcons();
    TS.library.init();
    TS.timeline.init();
    TS.player.init();
    TS.inspector.init();
    TS.recorder.init();
    TS.voiceover.init();
    TS.exporter.init();

    TS.$$('.tab').forEach(b => (b.onclick = () => setTab(b.dataset.tab)));
    TS.$('#btnNew').onclick = newProject;
    TS.$('#btnOpen').onclick = openProject;
    TS.$('#btnSave').onclick = () => saveProject(false);
    const name = TS.$('#projectName');
    name.onchange = () => TS.store.commit(p => { p.name = name.value.trim() || 'Untitled project'; });
    name.onkeydown = e => { if (e.key === 'Enter') name.blur(); };
    TS.$$('[data-close]').forEach(b => (b.onclick = () => b.closest('.modal').classList.remove('open')));
    TS.store.on(r => r === 'media' && TS.recorder.renderSessionList());

    api.on('task', TS.showTask);
    document.addEventListener('keydown', onKey);
    setupDrop();

    const saved = await api.loadAutosave();
    if (saved) {
      try { TS.store.load(JSON.parse(saved)); } catch { /* start fresh */ }
    }
    syncName();
    await checkMissing();

    if (TS.store.project.clips.length) {
      tab = 'record';
      await setTab('edit');
    } else {
      TS.recorder.activate();
    }
  });
})();
