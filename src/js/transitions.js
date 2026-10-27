'use strict';
/* Canvas previews of the transitions — they mirror what FFmpeg's xfade renders on export. */

TS.drawTransition = (ctx, type, a, b, p, W, H) => {
  const ready = s => s && (s.readyState === undefined || s.readyState >= 2);
  const black = () => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); };
  const fit = (src, alpha = 1) => {
    if (!ready(src) || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    TS.drawContain(ctx, src, 0, 0, W, H);
    ctx.restore();
  };
  const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  black();

  switch (type) {
    case 'fade':
    case 'dissolve':
      fit(a);
      fit(b, p);
      break;
    case 'fadeblack':
      if (p < 0.5) fit(a, 1 - 2 * p); else fit(b, 2 * p - 1);
      break;
    case 'fadewhite': {
      fit(p < 0.5 ? a : b);
      ctx.fillStyle = `rgba(255,255,255,${p < 0.5 ? 2 * p : 2 - 2 * p})`;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'blur': {
      const k = Math.sin(Math.PI * p) * (W / 60);
      ctx.save();
      ctx.filter = `blur(${k.toFixed(1)}px)`;
      fit(a);
      fit(b, p);
      ctx.restore();
      break;
    }
    case 'slideleft':
    case 'slideright': {
      const dir = type === 'slideleft' ? -1 : 1;
      const x = ease(p) * W * dir;
      ctx.save();
      ctx.translate(x, 0);
      fit(a);
      ctx.translate(-dir * W, 0);
      black();
      fit(b);
      ctx.restore();
      break;
    }
    case 'wipeleft': {
      fit(a);
      ctx.save();
      ctx.beginPath();
      ctx.rect((1 - p) * W, 0, p * W + 1, H);
      ctx.clip();
      black();
      fit(b);
      ctx.restore();
      break;
    }
    case 'circleopen': {
      fit(a);
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, (p * Math.hypot(W, H)) / 2, 0, Math.PI * 2);
      ctx.clip();
      black();
      fit(b);
      ctx.restore();
      break;
    }
    case 'zoomin': {
      fit(b);
      ctx.save();
      const s = 1 + p * 0.7;
      ctx.translate(W / 2, H / 2);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -H / 2);
      fit(a, 1 - p);
      ctx.restore();
      break;
    }
    case 'pixelize': {
      const k = Math.sin(Math.PI * p);
      const src = p < 0.5 ? a : b;
      if (!ready(src)) break;
      const f = Math.max(1, k * 50);
      const off = TS._pix || (TS._pix = document.createElement('canvas'));
      off.width = Math.max(2, Math.round(W / f));
      off.height = Math.max(2, Math.round(H / f));
      const o = off.getContext('2d');
      o.fillStyle = '#000';
      o.fillRect(0, 0, off.width, off.height);
      TS.drawContain(o, src, 0, 0, off.width, off.height);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, W, H);
      ctx.restore();
      break;
    }
    default:
      fit(p < 0.5 ? a : b);
  }
};

/* tiny looping glyphs for the transition picker */
TS.transGlyph = id => {
  const A = '#3d7fb8';
  const B = '#e7a23b';
  const base = `<div class="trans-glyph" style="background:${A}">`;
  const map = {
    none: `<div style="position:absolute;inset:0 0 0 50%;background:${B}"></div>`,
    fade: `<div style="position:absolute;inset:0;background:linear-gradient(90deg,${A},${B})"></div>`,
    dissolve: `<div style="position:absolute;inset:0;background:radial-gradient(${B} 30%,transparent 31%) 0 0/5px 5px"></div>`,
    blur: `<div style="position:absolute;inset:0;background:linear-gradient(90deg,${A},${B});filter:blur(2px)"></div>`,
    slideleft: `<div style="position:absolute;inset:0 0 0 45%;background:${B};box-shadow:-3px 0 4px rgba(0,0,0,.4)"></div>`,
    slideright: `<div style="position:absolute;inset:0 45% 0 0;background:${B};box-shadow:3px 0 4px rgba(0,0,0,.4)"></div>`,
    wipeleft: `<div style="position:absolute;inset:0 0 0 55%;background:${B}"></div><div style="position:absolute;top:0;bottom:0;left:55%;width:1px;background:#fff"></div>`,
    fadeblack: `<div style="position:absolute;inset:0;background:linear-gradient(90deg,${A},#000 50%,${B})"></div>`,
    fadewhite: `<div style="position:absolute;inset:0;background:linear-gradient(90deg,${A},#fff 50%,${B})"></div>`,
    zoomin: `<div style="position:absolute;inset:4px 9px;background:${B};border-radius:2px"></div>`,
    circleopen: `<div style="position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px;border-radius:50%;background:${B}"></div>`,
    pixelize: `<div style="position:absolute;inset:0;background:conic-gradient(${B} 25%,${A} 0 50%,${B} 0 75%,${A} 0) 0 0/8px 8px"></div>`
  };
  return base + (map[id] || '') + '</div>';
};
