'use strict';
// Headless end-to-end run (Linux/Xvfb): records, imports, edits, exports and screenshots the UI.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = function (win) {
  const out = process.env.TS_SNAPSHOT;
  const clips = (process.env.TS_CLIPS || '').split('|').filter(Boolean);
  const log = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code, true);
  const shot = async name => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name), img.toPNG());
    log.push(`shot ${name}`);
  };
  win.webContents.on('console-message', (e, level, message, line, source) => {
    if (level >= 2) log.push(`console[${level}] ${message} (${path.basename(source || '')}:${line})`);
  });
  win.webContents.on('render-process-gone', (e, d) => log.push(`RENDERER GONE ${JSON.stringify(d)}`));

  win.setSize(1600, 960);
  win.show();

  win.webContents.once('did-finish-load', async () => {
    try {
      await sleep(3000);
      log.push('toasts at start: ' + (await js(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' | ')`)));
      await shot('1-record.png');

      // mic test through the real recording audio chain (fake mic = tone)
      await js(`TS.recorder.opts.fx = { preset: 'broadcast', noise: 2, rumble: true, level: true }; TS.recorder.opts.recVolume = 1.5; TS.recorder.micTest()`);
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        if (await js(`!document.getElementById('micTestPlay').hidden`)) break;
      }
      log.push('mic test: ' + (await js(`document.getElementById('micTestBody').textContent`)));
      await js(`TS.recorder.playTest('enhanced')`);
      await sleep(600);
      log.push('mic test playing: ' + (await js(`TS.recorder.testPlaying + ' ' + document.getElementById('btnPlayFx').textContent`)));
      await js(`TS.recorder.stopTestAudio(); document.getElementById('micTestBody').closest('.mic-test').scrollIntoView({block:'start'})`);
      await sleep(300);
      await shot('1b-mic-test.png');
      await js(`document.querySelector('#page-record .side').scrollTop = 0`);

      // real recording through MediaRecorder -> IPC -> ffmpeg
      const [qr, qf, qb] = (process.env.TS_REC_Q || '1440,60,max').split(',');
      await js(`TS.recorder.setQuality('res','${qr}'); TS.recorder.setQuality('fps','${qf}'); TS.recorder.setQuality('bitrate','${qb}')`);
      await sleep(1500);
      log.push('quality: ' + (await js(`JSON.stringify(TS.recorder.quality()) + ' canvas=' + TS.recorder.canvas.width + 'x' + TS.recorder.canvas.height + ' | ' + document.getElementById('qualityEst').textContent`)));
      await js(`TS.recorder.opts.countdown=false; TS.recorder.opts.mini=false; TS.recorder.setLayout('cam'); TS.recorder.start()`);
      await sleep(1500);
      await js(`TS.recorder.setLayout('split')`);
      await sleep(1800);
      await shot('2-recording.png');
      await js(`TS.recorder.stop()`);
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        if (await js(`TS.store.project.media.some(m=>m.recorded)`)) break;
      }
      log.push('toasts after rec: ' + (await js(`[...document.querySelectorAll('.toast')].map(t=>t.textContent).join(' | ')`)));
      log.push('recorded media: ' + (await js(`JSON.stringify(TS.store.project.media.filter(m=>m.recorded).map(m=>({d:m.duration,v:m.vcodec,a:m.acodec,w:m.width,h:m.height,path:m.path}))) + ' settings=' + JSON.stringify(TS.store.project.settings)`)));

      // import + edit
      await js(`TS.setTab('edit')`);
      await js(`TS.library.importPaths(${JSON.stringify(clips)})`);
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        if ((await js(`TS.store.project.media.length`)) >= clips.length + 1) break;
      }
      log.push('media: ' + (await js(`JSON.stringify(TS.store.project.media.map(m=>[m.name,m.type,+m.duration.toFixed(2),!!m.converted]))`)));
      await js(`
        TS.store.commit(p => {
          p.name = 'City vs Arsenal – pressing traps';
          const vids = p.media.filter(m => m.type === 'video' && !m.recorded);
          vids.forEach(m => p.clips.push(TS.makeClip(m)));
          p.clips[0].transition = { type: 'blur', duration: 0.8 };
          p.clips[1].transition = { type: 'slideleft', duration: 0.7 };
          p.clips[2] && (p.clips[2].transition = { type: 'fade', duration: 0.6 });
          p.clips[1].out = Math.min(p.clips[1].out, 4.5);
          const au = p.media.find(m => m.type === 'audio');
          if (au) { p.music.mediaId = au.id; p.music.volume = 0.2; }
        });
        document.getElementById('projectName').value = TS.store.project.name;
      `);
      await sleep(1500);
      await js(`TS.editor.detach(TS.store.project.clips[1].id)`);
      await sleep(2500);
      await js(`TS.store.commit(p => { p.clips[1].audio.fx = { preset: 'clear', noise: 2, compress: true }; p.clips[1].audio.volume = 2.5; })`);
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        if (await js(`Object.values(TS.fxCache).some(c => c.path)`)) break;
      }
      log.push('fx cache: ' + (await js(`JSON.stringify(Object.values(TS.fxCache).map(c => ({ ready: !!c.path, err: c.error || null })))`)));
      log.push('recorded clip fx default: ' + (await js(`JSON.stringify(TS.store.project.clips[0].audio)`)));
      await js(`TS.timeline.fit(); TS.store.select(TS.store.project.clips[1].id);
        const L = TSTiming.layout(TS.store.project.clips); TS.player.setTime(L.starts[1] + 0.3);`);
      await sleep(2000);
      await shot('3-edit-transition.png');
      await js(`document.getElementById('inspFx').scrollIntoView({block:'start'})`);
      await sleep(500);
      await shot('3b-inspector-fx.png');
      await js(`TS.store.select(null)`);
      await sleep(600);
      await shot('4-edit-project.png');

      // play a bit to exercise preview sync
      // play the boosted + enhanced clip and measure that sound really comes out of Web Audio
      await js(`(() => { const P = TS.player; P.ensureCtx(); const an = P.ac.createAnalyser(); an.fftSize = 2048; P.limiter.connect(an); window.__an = an; })();
        TS.player.setTime(TSTiming.layout(TS.store.project.clips).starts[1] + 0.9); TS.player.play()`);
      await sleep(1500);
      log.push('preview audio level (boosted fx clip): ' + (await js(`(() => { const b = new Float32Array(2048); __an.getFloatTimeDomainData(b); let m = 0; for (const x of b) m = Math.max(m, Math.abs(x)); const e = TS.player.auds.get(TS.store.project.clips[1].id); return m.toFixed(3) + ' src=' + (e ? decodeURIComponent(e.src).split('/').slice(-2).join('/') : 'none') + ' gain=' + (e && e._gain ? e._gain.gain.value.toFixed(2) : '-'); })()`)));
      await js(`TS.player.pause()`);
      await js(`TS.player.setTime(0); TS.player.play()`);
      await sleep(2500);
      log.push('playing t=' + (await js(`TS.player.t.toFixed(2)+' active='+JSON.stringify(TS.player.active)`)));
      await js(`TS.player.pause(); TS.editor.split()`);
      await sleep(400);
      log.push('clips after split: ' + (await js(`TS.store.project.clips.length`)));
      await js(`TS.store.undo()`);
      log.push('clips after undo: ' + (await js(`TS.store.project.clips.length`)));

      // export
      await js(`TS.exporter.open()`);
      await sleep(800);
      await sleep(1500);
      log.push('export dialog: ' + (await js(`document.getElementById('expEncNote').textContent + ' | warn: ' + (document.getElementById('expWarn').hidden ? '-' : document.getElementById('expWarn').textContent)`)));
      await shot('5a-export-dialog.png');
      await js(`document.getElementById('expRes').value='720'; TS.exporter.run()`);
      await sleep(1500);
      await shot('5-exporting.png');
      for (let i = 0; i < 240; i++) {
        await sleep(500);
        if (!(await js(`!!TS.exporter.running`))) break;
      }
      log.push('export: ' + (await js(`TS.exporter.lastOutput || document.querySelector('.toast.error')?.textContent || 'unknown'`)));
      log.push('export info: ' + (await js(`document.getElementById('expDonePath').textContent.replace(/\\n/g,' | ')`)));
      await shot('6-export-done.png');
      await js(`TS.closeModal('expModal')`);

      // voiceover modal (fake mic)
      await js(`TS.voiceover.open(TS.store.project.clips[0].id)`);
      await sleep(1500);
      await shot('7-voiceover.png');
      await js(`TS.voiceover.close()`);

      // source picker
      await js(`TS.setTab('record')`);
      await sleep(1500);
      await js(`TS.recorder.pickSource()`);
      await sleep(2000);
      await shot('8-source-picker.png');
    } catch (e) {
      log.push('HARNESS ERROR ' + e.stack);
    }
    fs.writeFileSync(path.join(out, 'log.txt'), log.join('\n'));
    app.exit(0);
  });
};
