/* 2D 竞技场舞台与招式特效层。 */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const MAX_PARTS = reduced ? 260 : 680;
  const STYLE = {
    charge: ['#c4f582', 'charge'],
    guard: ['#94c5ff', 'hex'],
    hammer: ['#ffb78d', 'impact'],
    shieldHammer: ['#ffd6a3', 'hex'],
    gun: ['#ff8f86', 'muzzle'],
    fireball: ['#ffab5e', 'ember'],
    angel: ['#ffabc6', 'angel'],
    quake: ['#e7c37a', 'dust'],
    darkAngel: ['#c091ff', 'darkAngel'],
    holy: ['#8fd9ff', 'dome'],
    gold: ['#ffd76a', 'mirror'],
    wave: ['#87d9d2', 'ripple'],
    meteor: ['#d2b6ff', 'flail'],
    avalanche: ['#c7ecff', 'frost'],
  };
  const TARGETED = new Set(['hammer', 'shieldHammer', 'gun', 'fireball', 'darkAngel']);

  let arena = null;
  let canvas = null;
  let ctx = null;
  let baseCanvas = null;
  let baseKey = '';
  let W = 0;
  let H = 0;
  let dpr = 1;
  let stage = { cx: 0, cy: 0, rx: 0, ry: 0 };
  let layout = [];
  let positions = {};
  let seatSig = '';
  let dust = [];

  const parts = [];
  const rings = [];
  const beams = [];
  const flails = [];
  const chains = [];
  const links = [];
  const auras = [];
  const flashes = [];
  const frosts = [];
  const cracks = [];
  const explosions = [];
  const smokes = [];
  const scorches = [];
  const waves = [];
  const cues = [];
  const PROJECTILES = new Set(['gun', 'fireball', 'darkAngel']);

  let raf = 0;
  let lastFrame = 0;
  let acc = 0;
  let time = 0;
  let shake = 0;
  let roomId = null;
  let lastPhase = '';
  let lastReveal = '';
  let lastInterrupt = '';
  let lastPreview = '';
  let lastInterruptPreview = '';

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function rgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  function moveStyle(move) {
    return STYLE[move] || STYLE.charge;
  }
  function partCount(n) {
    return Math.max(2, Math.round(n * (reduced ? .4 : 1)));
  }

  /* ---------- canvas lifecycle ---------- */

  function attachIfNeeded() {
    if (!arena || !arena.isConnected) return;
    if (canvas && canvas.isConnected && canvas.parentElement === arena) return;
    canvas = document.createElement('canvas');
    canvas.className = 'arena-fx';
    canvas.setAttribute('aria-hidden', 'true');
    arena.insertBefore(canvas, arena.firstChild);
    ctx = canvas.getContext('2d');
    W = 0;
    H = 0;
    seatSig = '';
    baseCanvas = null;
    baseKey = '';
  }

  function resetDust() {
    dust = reduced ? [] : Array.from({ length: 26 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: rand(.6, 1.7),
      v: rand(4, 12),
      ph: rand(0, TAU),
      a: rand(.05, .16),
    }));
  }

  function seatSignature() {
    return [...arena.querySelectorAll('.seat[data-seat]')]
      .map(el => `${el.dataset.seat}:${el.style.left}:${el.style.top}:${el.dataset.id || ''}`)
      .join('|');
  }

  function measure() {
    const rect = canvas.getBoundingClientRect();
    const next = {};
    const nodes = [...arena.querySelectorAll('.seat[data-id]')];
    const sig = [];
    for (const el of nodes) {
      const avatar = el.querySelector('.avatar-shell');
      if (!avatar) continue;
      const r = avatar.getBoundingClientRect();
      const id = el.dataset.id;
      next[id] = {
        x: r.left - rect.left + r.width / 2,
        y: r.top - rect.top + r.height / 2,
        r: Math.max(9, r.width / 2),
        color: (el.style.getPropertyValue('--player-color') || '').trim() || '#c4f582',
      };
      sig.push(`${el.dataset.seat}:${el.style.left}:${el.style.top}:${id}`);
    }
    positions = next;
    seatSig = sig.join('|');
    layout = nodes
      .map(el => ({ id: el.dataset.id, seat: Number(el.dataset.seat), ...(next[el.dataset.id] || {}) }))
      .filter(p => Number.isFinite(p.x))
      .sort((a, b) => a.seat - b.seat);
    for (const a of auras) {
      const p = positions[a.id];
      if (p) { a.x = p.x; a.y = p.y; a.r = p.r; }
    }
    for (const l of links) {
      const a = positions[l.from];
      const b = positions[l.to];
      if (a && b) { l.ax = a.x; l.ay = a.y; l.bx = b.x; l.by = b.y; }
    }
  }

  function syncLayout(force) {
    if (!arena || !canvas) return;
    const w = arena.clientWidth;
    const h = arena.clientHeight;
    if (w < 2 || h < 2) return;
    if (w !== W || h !== H) {
      W = w;
      H = h;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      resetDust();
      measure();
      buildBase();
      return;
    }
    const sig = seatSignature();
    if (force || sig !== seatSig || !baseCanvas) {
      measure();
      buildBase();
    }
  }

  function clearList(list) {
    list.length = 0;
  }
  function clearTag(tag) {
    for (const list of [parts, rings, beams, flails, chains, links, auras, flashes, frosts, cracks, explosions, smokes, scorches, waves]) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].tag === tag) list.splice(i, 1);
    }
  }
  function clearScene() {
    clearList(cues);
    for (const list of [parts, rings, beams, flails, chains, links, auras, flashes, frosts, cracks, explosions, smokes, scorches, waves]) clearList(list);
    shake = 0;
    lastPreview = '';
    lastInterruptPreview = '';
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    arena = null;
    canvas = null;
    ctx = null;
    baseCanvas = null;
    baseKey = '';
    W = 0;
    H = 0;
    seatSig = '';
    positions = {};
    layout = [];
    clearScene();
    lastFrame = 0;
    roomId = null;
    lastPhase = '';
    lastReveal = '';
    lastInterrupt = '';
  }

  function start() {
    if (raf) return;
    lastFrame = 0;
    raf = requestAnimationFrame(loop);
  }

  /* ---------- base stage ---------- */

  function buildBase() {
    if (!W || !H) return;
    baseKey = `${W}x${H}|${seatSig}`;
    baseCanvas = document.createElement('canvas');
    baseCanvas.width = Math.max(1, Math.round(W * dpr));
    baseCanvas.height = Math.max(1, Math.round(H * dpr));
    const g = baseCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = W / 2;
    const cy = H / 2;
    const rx = Math.max(70, W * .452);
    const ry = Math.max(56, H * .432);
    stage = { cx, cy, rx, ry };

    g.save();
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    const glow = g.createRadialGradient(0, 0, rx * .15, 0, 0, rx * 1.38);
    glow.addColorStop(0, 'rgba(126,173,96,.17)');
    glow.addColorStop(.55, 'rgba(88,130,70,.07)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(0, 0, rx * 1.38, 0, TAU);
    g.fill();
    g.restore();

    g.save();
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    const floor = g.createRadialGradient(cx, cy - ry * .2, ry * .08, cx, cy, Math.max(rx, ry) * 1.02);
    floor.addColorStop(0, 'rgba(46,66,38,.46)');
    floor.addColorStop(.62, 'rgba(31,45,26,.34)');
    floor.addColorStop(1, 'rgba(13,19,12,.10)');
    g.fillStyle = floor;
    g.fill();
    g.clip();
    g.lineWidth = 1;
    for (let i = 1; i <= 5; i++) {
      g.strokeStyle = `rgba(150,184,118,${i === 5 ? .13 : .085})`;
      g.beginPath();
      g.ellipse(cx, cy, rx * i / 6, ry * i / 6, 0, 0, TAU);
      g.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU;
      g.strokeStyle = 'rgba(150,184,118,.055)';
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      g.stroke();
    }
    g.strokeStyle = 'rgba(196,245,130,.10)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.ellipse(cx, cy, rx * .30, ry * .30, .5, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(148,197,255,.09)';
    g.beginPath();
    g.ellipse(cx, cy, rx * .30, ry * .30, .5, Math.PI / 4, Math.PI / 4 + 2.2);
    g.stroke();
    g.restore();

    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(196,245,130,.22)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(148,197,255,.10)';
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, Math.PI * .18, Math.PI * .82);
    g.stroke();
    g.setLineDash([5, 9]);
    g.strokeStyle = 'rgba(196,245,130,.12)';
    g.beginPath();
    g.ellipse(cx, cy, rx * 1.055, ry * 1.055, 0, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.restore();

    if (layout.length > 1) {
      g.beginPath();
      layout.forEach((p, i) => {
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      });
      g.closePath();
      g.strokeStyle = 'rgba(196,245,130,.075)';
      g.lineWidth = 1;
      g.stroke();
      for (const p of layout) {
        g.fillStyle = rgba(p.color || '#c4f582', .35);
        g.beginPath();
        g.arc(p.x, p.y, 1.6, 0, TAU);
        g.fill();
      }
    }

    for (const p of layout) {
      const r = p.r || 26;
      const sh = g.createRadialGradient(p.x, p.y + r * .92, 0, p.x, p.y + r * .92, r * 1.35);
      sh.addColorStop(0, 'rgba(0,0,0,.42)');
      sh.addColorStop(.6, 'rgba(0,0,0,.18)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh;
      g.beginPath();
      g.ellipse(p.x, p.y + r * .92, r * 1.35, r * .46, 0, 0, TAU);
      g.fill();
    }

    const vg = g.createRadialGradient(cx, cy, Math.min(W, H) * .22, cx, cy, Math.max(W, H) * .72);
    vg.addColorStop(0, 'rgba(6,10,7,0)');
    vg.addColorStop(.72, 'rgba(6,10,7,.12)');
    vg.addColorStop(1, 'rgba(6,10,7,.46)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }

  /* ---------- effects api ---------- */

  function spark(x, y, color, count, power = 1, gravity = 120) {
    const n = Math.min(partCount(count), MAX_PARTS - parts.length);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const s = rand(35, 175) * power;
      const ttl = rand(.32, .78);
      parts.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 30,
        ttl, life: ttl,
        size: rand(1.1, 2.8) * (reduced ? .8 : 1),
        color, gravity, drag: .93,
      });
    }
  }

  function motes(x, y, color, count, opts = {}) {
    const n = Math.min(partCount(count), MAX_PARTS - parts.length);
    for (let i = 0; i < n; i++) {
      const ttl = rand(.7, 1.5);
      parts.push({
        x: x + rand(-(opts.spread || 24), opts.spread || 24),
        y: y + rand(-6, (opts.spread || 24) * .6),
        vx: rand(-10, 10),
        vy: rand(-(opts.rise || 45), -(opts.rise || 45) * .35),
        ttl, life: ttl,
        size: rand(1.2, 3),
        color, gravity: -(opts.lift || 18), drag: .985,
        kind: opts.kind || 'dot',
      });
    }
  }

  function ring(x, y, opts = {}) {
    rings.push({
      x, y,
      r0: opts.r0 ?? 4,
      r1: opts.r1 ?? 60,
      ttl: opts.ttl ?? .5,
      life: opts.ttl ?? .5,
      delay: opts.delay || 0,
      color: opts.color || '#c4f582',
      width: opts.width || 1.6,
      alpha: opts.alpha ?? .6,
      squash: opts.squash ?? 1,
      offsetY: opts.offsetY || 0,
      dash: opts.dash || null,
      tag: opts.tag,
    });
  }

  function flash(x, y, color, opts = {}) {
    flashes.push({
      x, y,
      r: opts.r ?? 40,
      ttl: opts.ttl ?? .3,
      life: opts.ttl ?? .3,
      delay: opts.delay || 0,
      alpha: opts.alpha ?? .75,
      color,
      tag: opts.tag,
    });
  }

  function scorch(x, y, rx, ry, color, delay, ttl) {
    scorches.push({
      x, y, rx, ry, color,
      ttl, life: ttl,
      delay: delay || 0,
      tag: undefined,
    });
  }

  // Jagged fissures that stay on the floor for a few seconds.
  function crackNetwork(x, y, color, delay, ttl, scale = 1) {
    const lines = [];
    const baseLen = Math.min(W, H) * .1 * scale;
    const arms = scale < .5 ? 5 : 8;
    const steps = scale < .5 ? 3 : 7;
    const inside = (px, py) => {
      if (!stage.rx) return true;
      const nx = (px - stage.cx) / (stage.rx * .93);
      const ny = (py - stage.cy) / (stage.ry * .93);
      return nx * nx + ny * ny <= 1;
    };
    for (let i = 0; i < arms; i++) {
      const angle = i / arms * TAU + rand(-.24, .24);
      const points = [{ x, y }];
      let px = x;
      let py = y;
      for (let s = 0; s < steps; s++) {
        const a = angle + rand(-.26, .26);
        px += Math.cos(a) * baseLen * rand(.65, 1.3);
        py += Math.sin(a) * baseLen * rand(.35, .8);
        if (!inside(px, py)) break;
        points.push({ x: px, y: py });
        if (s > 1 && Math.random() < .34) {
          const ba = a + (Math.random() < .5 ? -1 : 1) * rand(.55, 1.25);
          let bx = px;
          let by = py;
          const branch = [{ x: px, y: py }];
          const branchSteps = 2 + Math.floor(Math.random() * 2);
          for (let k = 0; k < branchSteps; k++) {
            bx += Math.cos(ba + rand(-.2, .2)) * baseLen * .58;
            by += Math.sin(ba + rand(-.2, .2)) * baseLen * .34;
            if (!inside(bx, by)) break;
            branch.push({ x: bx, y: by });
          }
          if (branch.length > 1) lines.push({ points: branch, width: 1.1 });
        }
      }
      if (points.length > 1) lines.push({ points, width: 2.4 });
    }
    cracks.push({ x, y, lines, color, ttl, life: ttl, delay: delay || 0 });
  }

  function addSmoke(x, y, size, delay, count) {
    const n = reduced ? Math.max(3, Math.round(count * .55)) : count;
    for (let i = 0; i < n; i++) {
      const ttl = rand(1.8, 2.9);
      smokes.push({
        x: x + rand(-size * .55, size * .55),
        y: y + rand(-size * .4, size * .2),
        r: size * rand(.55, .95),
        ttl, life: ttl,
        delay: (delay || 0) + rand(0, .08),
        vx: rand(-18, 18),
        vy: rand(-26, -8),
        alpha: rand(.2, .34),
      });
    }
  }

  function spawnExplosion(x, y, size, delay, scale = 1) {
    const ttl = rand(.6, .76);
    explosions.push({
      x, y,
      size: size * scale,
      ttl, life: ttl,
      delay: delay || 0,
      seed: rand(0, TAU),
    });
  }

  function explodeAt(p, delay) {
    const color = '#ffab5e';
    const ox = p.x;
    const oy = p.y - p.r * .25;
    const size = Math.max(36, p.r * 2.8);
    spawnExplosion(ox, oy, size, delay);
    spawnExplosion(p.x + rand(-p.r, p.r) * .7, p.y + rand(-p.r, p.r) * .25, size * .55, delay + .1);
    scorch(p.x, p.y + p.r * .35, p.r * 2.1, p.r * .9, '#ff9a55', delay, 2.4);
    addSmoke(ox, oy - p.r * .2, p.r * 2.2, delay, 11);
    flash(ox, oy, '#ffe0a8', { r: p.r * 3.8, ttl: .4, delay, alpha: .9 });
    flash(stage.cx || ox, stage.cy || oy, '#ff9a55', { r: Math.max(W, H) * .42, ttl: .22, delay, alpha: .1 });
    ring(p.x, p.y + p.r * .3, { r0: p.r * .35, r1: p.r * 3, color, ttl: .58, width: 3.2, alpha: .72, squash: .82, delay });
    ring(p.x, p.y + p.r * .3, { r0: p.r * .4, r1: p.r * 4.2, color: '#ffd9a0', ttl: .52, width: 1.6, alpha: .55, delay: delay + .04 });
    ring(p.x, p.y + p.r * .45, { r0: p.r * .5, r1: p.r * 3.4, color: '#ff8a3d', ttl: .66, width: 2, alpha: .42, squash: .35, delay: delay + .07 });
    spark(ox, oy, '#ffcf8a', 24, 1.4, 130);
    for (let i = 0; i < partCount(14); i++) {
      const a = rand(0, TAU);
      const ttl = rand(.45, 1.05);
      parts.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * rand(40, 170),
        vy: Math.sin(a) * rand(40, 130) - 60,
        ttl, life: ttl,
        delay: (delay || 0) + rand(0, .06),
        size: rand(1.2, 3), color: i % 2 ? '#ffd06a' : '#ff7a3c',
        gravity: 150, drag: .955,
      });
    }
    // 弹坑上摇曳的残余火苗。
    for (let i = 0; i < partCount(9); i++) {
      const ttl = rand(.9, 1.7);
      parts.push({
        x: p.x + rand(-p.r * 1.15, p.r * 1.15),
        y: p.y + rand(-p.r * .2, p.r * .5),
        vx: rand(-14, 14), vy: rand(-58, -22),
        ttl, life: ttl, delay: (delay || 0) + rand(.06, .32),
        size: rand(2.6, 5.6), color: i % 2 ? '#ff9a45' : '#ffd06a',
        gravity: -46, drag: .965, kind: 'flame',
      });
    }
    // 带火星尾迹的炽热碎块。
    for (let i = 0; i < partCount(7); i++) {
      const a = rand(-Math.PI * .92, -Math.PI * .08);
      const ttl = rand(.5, .95);
      parts.push({
        x: p.x, y: p.y - p.r * .4,
        vx: Math.cos(a) * rand(60, 210), vy: Math.sin(a) * rand(70, 190),
        ttl, life: ttl, delay: (delay || 0) + rand(0, .05),
        size: rand(1.6, 3.4), color: '#ffa14a',
        gravity: 330, drag: .985, kind: 'debris',
        spin: rand(-9, 9), rot: rand(0, TAU),
      });
    }
    shakeIt(2.4);
  }

  function beam(ax, ay, bx, by, opts = {}) {
    const curve = opts.curve || 0;
    let cx = 0;
    let cy = 0;
    if (curve) {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      cx = mx - dy / len * curve * len;
      cy = my + dx / len * curve * len;
    }
    const ttl = opts.dur ?? .3;
    beams.push({
      ax, ay, bx, by, cx, cy, curve,
      ttl, life: ttl,
      delay: opts.delay || 0,
      trail: opts.trail ?? .6,
      color: opts.color || '#c4f582',
      width: opts.width || 3,
      kind: opts.kind || 'orb',
      impact: opts.impact,
      spin: opts.spin || 0,
      tag: opts.tag,
    });
  }

  function flail(ax, ay, bx, by, opts = {}) {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ttl = opts.dur ?? .55;
    flails.push({
      ax, ay, bx, by,
      cx: mx - dy / len * len * (opts.bend ?? .32),
      cy: my + dx / len * len * (opts.bend ?? .32),
      ttl, life: ttl,
      delay: opts.delay || 0,
      color: opts.color || '#d2b6ff',
      impact: opts.impact,
      tag: opts.tag,
    });
  }

  function chain(ax, ay, bx, by, opts = {}) {
    chains.push({
      ax, ay, bx, by,
      ttl: opts.ttl ?? .7,
      life: opts.ttl ?? .7,
      delay: opts.delay || 0,
      color: opts.color || '#d2b6ff',
      width: opts.width || 1.5,
      jitter: opts.jitter ?? 10,
      tag: opts.tag,
    });
  }

  function aura(id, kind, color, opts = {}) {
    const p = positions[id];
    if (!p) return;
    const ttl = opts.persist ? Infinity : (opts.ttl ?? 1);
    auras.push({
      id, kind, color,
      x: p.x, y: p.y, r: p.r,
      ttl, life: ttl,
      delay: opts.delay || 0,
      scale: opts.scale ?? 1,
      alpha: opts.alpha ?? .9,
      persist: !!opts.persist,
      age: 0,
      rot: rand(0, TAU),
      tag: opts.tag,
    });
  }

  /* ---------- selection preview ---------- */

  function spawnPreview(move, target, selfId) {
    const [color, kind] = moveStyle(move);
    aura(selfId, kind, color, { persist: true, scale: .72, alpha: .5, tag: 'preview' });
    if (TARGETED.has(move) && target && target !== selfId && positions[selfId] && positions[target]) {
      aura(target, 'mark', color, { persist: true, alpha: .55, tag: 'preview' });
      links.push({
        from: selfId, to: target,
        ax: positions[selfId].x, ay: positions[selfId].y,
        bx: positions[target].x, by: positions[target].y,
        color, ttl: Infinity, life: Infinity, persist: true, tag: 'preview',
      });
    }
  }

  /* ---------- per-move effects ---------- */

  function converge(p, color, delay) {
    const n = partCount(11);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const d = p.r * rand(2, 3.1);
      const ttl = rand(.4, .62);
      parts.push({
        x: p.x + Math.cos(a) * d,
        y: p.y + Math.sin(a) * d,
        vx: -Math.cos(a) * d / ttl,
        vy: -Math.sin(a) * d / ttl,
        ttl, life: ttl, delay: delay || 0,
        size: rand(1.3, 2.6), color, gravity: 0, drag: .99,
      });
    }
  }

  function embers(p, color, delay) {
    const n = partCount(7);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const ttl = rand(.5, .9);
      parts.push({
        x: p.x + Math.cos(a) * p.r * 1.3,
        y: p.y + Math.sin(a) * p.r * 1.3,
        vx: Math.cos(a + Math.PI / 2) * 30,
        vy: Math.sin(a + Math.PI / 2) * 30 - 16,
        ttl, life: ttl, delay: (delay || 0) + rand(0, .15),
        size: rand(1.4, 3), color, gravity: -20, drag: .96,
      });
    }
  }

  function healColumn(p, color, delay) {
    ring(p.x, p.y, { r0: p.r * .4, r1: p.r * 2, color, ttl: .7, delay, width: 2, alpha: .5 });
    motes(p.x, p.y + p.r * .4, color, 14, { spread: p.r * .9, rise: 90, kind: 'feather' });
  }

  function impact(p, color, power = 1) {
    flash(p.x, p.y, color, { r: p.r * (1.5 + power * .35), ttl: .3 });
    spark(p.x, p.y, color, Math.round(7 + power * 6), power);
    ring(p.x, p.y, { r0: p.r * .35, r1: p.r * (1.5 + power * .5), color, ttl: .45, width: 2, alpha: .55 });
  }

  function groundHit(p, color, delay, amount = 1, blocked = false, showShield = true) {
    ring(p.x, p.y, {
      r0: p.r * .5, r1: p.r * (1.7 + amount * .35), color,
      ttl: .55, delay, width: 2.4, squash: .4, alpha: .6,
    });
    if (blocked) {
      if (showShield) shieldBlock(p, color, delay + .05);
      return;
    }
    spark(p.x, p.y + p.r * .6, color, Math.round(4 + amount * 4), .8, 160);
  }

  function waveBand(x, y, opts = {}) {
    const ttl = opts.ttl ?? .9;
    waves.push({
      x, y,
      r0: opts.r0 ?? 8,
      r1: opts.r1 ?? 160,
      ttl, life: ttl,
      delay: opts.delay || 0,
      color: opts.color || '#87d9d2',
      alpha: opts.alpha ?? .65,
      band: opts.band ?? 14,
      squash: opts.squash ?? .46,
      seed: rand(0, TAU),
    });
  }

  function splash(p, color, delay, blocked, showShield = true) {
    // 被防住时水面照样拍上去，只是不产生伤害反馈。
    waveBand(p.x, p.y, { r0: p.r * .3, r1: p.r * (blocked ? 1.7 : 2.1), ttl: .55, delay, band: blocked ? 5 : 7, squash: .5, alpha: blocked ? .6 : .8 });
    if (!blocked) waveBand(p.x, p.y, { r0: p.r * .2, r1: p.r * 3, ttl: .72, delay: delay + .08, band: 4.5, squash: .5, alpha: .5 });
    flash(p.x, p.y, '#bff5ee', { r: p.r * 2, ttl: .3, delay, alpha: blocked ? .3 : .45 });
    const n = partCount(blocked ? 6 : 12);
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * .9, -Math.PI * .1);
      const sp = rand(80, blocked ? 140 : 210);
      const ttl = rand(.4, .75);
      parts.push({
        x: p.x + rand(-p.r * .5, p.r * .5),
        y: p.y + p.r * .25,
        vx: Math.cos(a) * sp * .55,
        vy: Math.sin(a) * sp,
        ttl, life: ttl, delay: delay + rand(0, .05),
        size: rand(1.3, 2.8), color: i % 2 ? '#e8fffb' : color,
        gravity: 220, drag: .97, kind: 'drop',
      });
    }
    if (blocked) {
      if (showShield) shieldBlock(p, color, delay + .04);
      return;
    }
    motes(p.x, p.y, '#dffbf7', 6, { spread: p.r, rise: 30 });
  }

  function shieldBlock(p, color, delay) {
    ring(p.x, p.y, { r0: p.r * 1.25, r1: p.r * 1.65, color, ttl: .32, delay, width: 2.4, alpha: .7 });
    flash(p.x, p.y, color, { r: p.r * 1.6, ttl: .3, delay });
    const n = partCount(7);
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * .8, -Math.PI * .2);
      const ttl = rand(.25, .45);
      parts.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * rand(40, 130),
        vy: Math.sin(a) * rand(40, 130),
        ttl, life: ttl, delay,
        size: rand(1, 2.2), color, gravity: 180, drag: .95, kind: 'spark',
      });
    }
  }

  function defenseImpact(id, move, delay) {
    const p = positions[id];
    if (!p) return;
    shieldBlock(p, moveStyle(move || 'guard')[0], delay);
    if (move === 'holy') {
      aura(id, 'holyImpact', '#e5fbff', { delay, ttl: .65, alpha: 1 });
      ring(p.x, p.y, { r0: p.r * 1.4, r1: p.r * 2.5, color: '#fff5ce', ttl: .6, delay, width: 3 });
    }
  }

  function bullet(a, b, delay, onImpact = () => impact(b, moveStyle('gun')[0], .9), duration = .26) {
    const color = moveStyle('gun')[0];
    beam(a.x, a.y, b.x, b.y, {
      color, width: 2.4, dur: duration, trail: .92, delay, kind: 'bullet',
      impact: onImpact,
    });
    flash(a.x, a.y, color, { r: a.r * 1.5, ttl: .22, delay });
  }

  function fireball(a, b, delay, onImpact = () => { explodeAt(b, 0); fireballSplash(b, .02); }, duration = .46, curve = .18) {
    const color = moveStyle('fireball')[0];
    beam(a.x, a.y, b.x, b.y, {
      color, width: 9, dur: duration, trail: .22, curve, delay, kind: 'comet', spin: 1,
      impact: onImpact,
    });
  }

  // 命中点周围的火焰溅射：环形火浪、四散火舌与小爆点。
  function fireballSplash(p, delay) {
    const color = moveStyle('fireball')[0];
    ring(p.x, p.y + p.r * .3, { r0: p.r * .5, r1: p.r * 3.7, color, ttl: .7, delay, width: 2.8, alpha: .52, squash: .45 });
    ring(p.x, p.y + p.r * .3, { r0: p.r * .4, r1: p.r * 2.7, color: '#ffd06a', ttl: .55, delay: delay + .04, width: 1.4, alpha: .45, squash: .5 });
    const n = partCount(22);
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + rand(-.16, .16);
      const sp = rand(90, 240);
      const ttl = rand(.35, .8);
      parts.push({
        x: p.x + Math.cos(a) * p.r * .5,
        y: p.y + Math.sin(a) * p.r * .35,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * .7 - 60,
        ttl, life: ttl, delay: delay + rand(0, .06),
        size: rand(1.4, 3.2),
        color: i % 3 === 0 ? '#ffd06a' : i % 3 === 1 ? '#ff8a3d' : '#ffab5e',
        gravity: 200, drag: .96, kind: i % 4 === 0 ? 'flame' : 'dot',
      });
    }
    const bursts = partCount(5);
    for (let i = 0; i < bursts; i++) {
      const a = rand(0, TAU);
      const d = p.r * rand(1.1, 2.3);
      spawnExplosion(
        p.x + Math.cos(a) * d,
        p.y + Math.sin(a) * d * .55,
        Math.max(10, p.r * .55),
        delay + rand(.04, .18),
      );
    }
  }

  // 被火球波及的邻居：较小的火团与焦痕，不重复整颗火球的演出。
  function fireballBurn(p, delay) {
    const color = moveStyle('fireball')[0];
    spawnExplosion(p.x, p.y - p.r * .2, Math.max(12, p.r * .9), delay);
    ring(p.x, p.y + p.r * .3, { r0: p.r * .2, r1: p.r * 1.8, color, ttl: .5, delay, width: 2.2, alpha: .55, squash: .42 });
    const n = partCount(8);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const ttl = rand(.35, .75);
      parts.push({
        x: p.x + Math.cos(a) * p.r * .3,
        y: p.y + Math.sin(a) * p.r * .2,
        vx: Math.cos(a) * rand(50, 130),
        vy: Math.sin(a) * rand(40, 110) - 50,
        ttl, life: ttl, delay: delay + rand(0, .05),
        size: rand(1.2, 2.6), color: i % 2 ? '#ffd06a' : '#ff8a3d',
        gravity: 200, drag: .96, kind: i % 3 === 0 ? 'flame' : 'dot',
      });
    }
  }

  function voidOrb(a, b, delay, onImpact, duration = .32) {
    const color = moveStyle('darkAngel')[0];
    chain(a.x, a.y, b.x, b.y, { color, ttl: .5, delay: delay + .04, width: 1.4, jitter: 13 });
    beam(a.x, a.y, b.x, b.y, {
      color, width: 6, dur: duration, trail: .42, delay, kind: 'void',
      impact: onImpact || (() => {
        flash(b.x, b.y, color, { r: b.r * 2.4, ttl: .45 });
        ring(b.x, b.y, { r0: b.r * .5, r1: b.r * 2.2, color, ttl: .5, width: 2, alpha: .6 });
        spark(b.x, b.y, color, 10, 1);
      }),
    });
  }

  function hammerHit(a, b, color, delay, drain) {
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const start = { x: b.x + (a.x - b.x) * .28, y: b.y - Math.max(76, dist * .3) };
    beam(start.x, start.y, b.x, b.y, {
      color, width: 11, dur: .2, trail: .55, delay, kind: 'hammer',
      impact: () => {
        impact(b, color, 1.15);
        ring(b.x, b.y, { r0: b.r * .4, r1: b.r * 2.3, color, ttl: .5, width: 3, squash: .4, alpha: .65 });
        shakeIt(2.2);
        if (drain) {
          // The resource is destroyed, not transferred to the hammer user.
          spark(b.x, b.y - 4, moveStyle('charge')[0], 10, .8, 90);
        }
      },
    });
  }

  function meteorStrike(a, b, delay) {
    const color = moveStyle('meteor')[0];
    flail(a.x, a.y, b.x, b.y, {
      color, delay, dur: .46, bend: .34,
      impact: () => {
        impact(b, color, 1.5);
        ring(b.x, b.y, { r0: b.r * .5, r1: b.r * 2.8, color, ttl: .6, width: 3, squash: .42, alpha: .7 });
        chain(b.x, b.y, b.x + rand(-30, 30), b.y + rand(-30, 30), { color, ttl: .35, width: 1.2, jitter: 8 });
        shakeIt(3.4);
      },
    });
  }

  function reflectFlash(p, delay, color = moveStyle('gold')[0]) {
    flash(p.x, p.y, color, { r: p.r * 2.6, ttl: .4, delay });
    ring(p.x, p.y, { r0: p.r * 1.1, r1: p.r * 2.5, color, ttl: .45, delay, width: 2.4, alpha: .7 });
    for (let i = 0; i < partCount(8); i++) {
      const a = rand(0, TAU);
      const ttl = rand(.3, .55);
      parts.push({
        x: p.x + Math.cos(a) * p.r * 1.2,
        y: p.y + Math.sin(a) * p.r * 1.2,
        vx: Math.cos(a) * rand(40, 110),
        vy: Math.sin(a) * rand(40, 110),
        ttl, life: ttl, delay, size: rand(1.2, 2.4), color: '#fff0b8', gravity: 0, drag: .95, kind: 'spark',
      });
    }
  }

  function reflectionImpact(id, move, delay) {
    const p = positions[id];
    if (!p) return;
    const wave = move === 'wave';
    reflectFlash(p, delay, moveStyle(wave ? 'wave' : 'gold')[0]);
    aura(id, wave ? 'waveReflect' : 'goldReflect', moveStyle(wave ? 'wave' : 'gold')[0], { delay, ttl: .85, alpha: 1 });
    if (wave) {
      // The returning fireball is separate from the wave's own area damage.
      ring(p.x, p.y, { r0: p.r * 1.3, r1: p.r * 2.6, color: moveStyle('fireball')[0], ttl: .55, delay: delay + .08, width: 3 });
      embers(p, moveStyle('fireball')[0], delay);
    }
  }

  function reflectedHit(a, b, delay, originMove, reflectorMove) {
    const color = reflectorMove === 'wave' ? moveStyle('wave')[0] : moveStyle('gold')[0];
    const tint = moveStyle(originMove)[0];
    beam(a.x, a.y, b.x, b.y, {
      color, width: 5, dur: .3, trail: .55, delay, kind: 'reflect',
      impact: () => {
        impact(b, tint, 1.1);
        flash(b.x, b.y, color, { r: b.r * 2, ttl: .4 });
      },
    });
  }

  function clashPoint(a, b, delay) {
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    flash(x, y, '#ffeec9', { r: 54, ttl: .4, delay, alpha: .8 });
    ring(x, y, { r0: 6, r1: 60, color: '#ffeec9', ttl: .4, delay, width: 2, alpha: .7 });
    for (let i = 0; i < partCount(10); i++) {
      const ang = rand(0, TAU);
      const ttl = rand(.25, .5);
      parts.push({
        x, y, vx: Math.cos(ang) * rand(60, 180), vy: Math.sin(ang) * rand(60, 180),
        ttl, life: ttl, delay, size: rand(1.2, 2.6), color: '#fff4cf', gravity: 0, drag: .94, kind: 'spark',
      });
    }
  }

  function deathEffect(p, delay) {
    ring(p.x, p.y, { r0: p.r * 1.6, r1: p.r * .5, color: '#c9d3dd', ttl: .6, delay, width: 2, alpha: .5 });
    for (let i = 0; i < partCount(16); i++) {
      const a = rand(0, TAU);
      const ttl = rand(.5, 1);
      parts.push({
        x: p.x, y: p.y, vx: Math.cos(a) * rand(20, 90), vy: Math.sin(a) * rand(20, 90) - 20,
        ttl, life: ttl, delay, size: rand(1.2, 2.8), color: '#aab4be', gravity: 110, drag: .94,
      });
    }
    flash(p.x, p.y, '#9aa6b0', { r: p.r * 2, ttl: .5, delay });
  }

  function quakeBurst(p, delay) {
    const color = moveStyle('quake')[0];
    const cx = stage.cx || p.x;
    const cy = stage.cy || p.y;
    const core = Math.min(W, H) * .16;

    // The arena floor splits from the centre outward.
    crackNetwork(cx, cy, color, delay + .04, 3.4, 1);
    crackNetwork(cx + rand(-12, 12), cy + rand(-8, 8), '#d8ab6a', delay + .5, 2.4, .55);
    scorch(cx, cy, Math.min(W, H) * .32, Math.min(W, H) * .21, color, delay, 3);
    flash(cx, cy, '#ffe6b4', { r: core * 2.1, ttl: .5, delay, alpha: .62 });
    addSmoke(cx, cy, Math.min(W, H) * .16, delay, 5);

    for (let i = 0; i < 4; i++) {
      ring(cx, cy, {
        r0: core * (.2 + i * .25), r1: Math.max(W, H) * (.58 + i * .1),
        color, ttl: .95 + i * .12, delay: delay + i * .1, width: 3 - i * .6, squash: .42, alpha: .42 - i * .08,
      });
    }
    ring(cx, cy, { r0: core * .15, r1: core * 1.5, color: '#ffe9b5', ttl: .62, delay, width: 3, squash: .55, alpha: .6 });

    for (let i = 0; i < partCount(26); i++) {
      const a = rand(0, TAU);
      const d = rand(4, core * 1.2);
      const ttl = rand(.55, 1.15);
      parts.push({
        x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * .6,
        vx: Math.cos(a) * rand(20, 110), vy: rand(-150, -55),
        ttl, life: ttl, delay: delay + rand(0, .12),
        size: rand(1.4, 3.2), color: i % 3 ? '#cbb083' : '#ffe0a0', gravity: 280, drag: .98,
      });
    }

    for (const seat of layout) {
      crackNetwork(seat.x, seat.y + seat.r * .72, color, delay + .12, 1.8, .28);
    }
    for (let i = 0; i < partCount(22); i++) {
      const ttl = rand(.6, 1.2);
      parts.push({
        x: rand(0, W), y: rand(H * .35, H * .95),
        vx: rand(-10, 10), vy: rand(-90, -30),
        ttl, life: ttl, delay: delay + rand(0, .18),
        size: rand(1, 2.4), color: '#cbb083', gravity: 60, drag: .98,
      });
    }
    shakeIt(reduced ? 0 : 6);
  }

  function waveSweep(p, delay) {
    const color = moveStyle('wave')[0];
    for (let i = 0; i < 4; i++) {
      waveBand(p.x, p.y, {
        r0: p.r * (.9 + i * .5),
        r1: Math.max(W, H) * (.52 + i * .13),
        ttl: .9 + i * .12,
        delay: delay + i * .09,
        band: 16 - i * 2.2,
        squash: .46,
        alpha: .62 - i * .07,
      });
    }
    for (let i = 0; i < partCount(24); i++) {
      const a = rand(0, TAU);
      const ttl = rand(.5, .95);
      parts.push({
        x: p.x + Math.cos(a) * p.r * 1.5,
        y: p.y + Math.sin(a) * p.r * .7,
        vx: Math.cos(a) * rand(70, 200),
        vy: Math.sin(a) * rand(10, 60) - 50,
        ttl, life: ttl, delay: delay + rand(0, .18),
        size: rand(1.1, 2.6),
        color: i % 3 === 0 ? '#e8fffb' : color,
        gravity: 130, drag: .965, kind: 'drop',
      });
    }
    flash(stage.cx || p.x, stage.cy || p.y, '#87d9d2', { r: Math.max(W, H) * .42, ttl: .28, delay, alpha: .07 });
  }

  function avalanche(room, delay) {
    const bans = room.result?.avalanche?.bans || {};
    frosts.push({
      ttl: 1.8, life: 1.8, delay,
      alpha: reduced ? .18 : .3,
    });
    const n = reduced ? 26 : 62;
    for (let i = 0; i < n; i++) {
      const ttl = rand(1, 1.9);
      parts.push({
        x: rand(0, W), y: rand(-40, H * .8),
        vx: rand(8, 34), vy: rand(50, 120),
        ttl, life: ttl, delay: delay + rand(0, .5),
        size: rand(1, 2.6), color: '#dff4ff', gravity: 18, drag: .995, kind: 'snow',
      });
    }
    for (const [id, ban] of Object.entries(bans)) {
      if (ban && positions[id]) aura(id, 'frost', moveStyle('avalanche')[0], { delay: delay + .55, ttl: 1.1, alpha: .8 });
    }
    for (const seat of layout) {
      ring(seat.x, seat.y + seat.r * .8, {
        r0: seat.r * .5, r1: seat.r * 1.6, color: '#c7ecff', ttl: .6, delay: delay + .3, width: 1.4, squash: .4, alpha: .32,
      });
    }
  }

  function victory(id) {
    const p = positions[id];
    if (!p) return;
    aura(id, 'mirror', moveStyle('gold')[0], { ttl: 2.2, scale: 1.1, alpha: .8 });
    for (let i = 0; i < (reduced ? 16 : 44); i++) {
      const ttl = rand(1.3, 2.4);
      parts.push({
        x: p.x + rand(-p.r, p.r), y: p.y + rand(-p.r * .4, p.r * .6),
        vx: rand(-60, 60), vy: rand(-220, -90),
        ttl, life: ttl, delay: rand(0, .4), size: rand(1.4, 3.2),
        color: i % 3 === 0 ? '#c4f582' : i % 3 === 1 ? '#ffd76a' : '#94c5ff',
        gravity: 190, drag: .985,
      });
    }
    ring(p.x, p.y, { r0: p.r, r1: p.r * 4.2, color: '#ffd76a', ttl: 1, width: 2.2, alpha: .55 });
  }

  function spawnCaster(move, id, delay) {
    const p = positions[id];
    if (!p) return;
    const [color, kind] = moveStyle(move);
    aura(id, kind, color, { delay, ttl: move === 'meteor' ? 1.6 : 1.1, scale: move === 'angel' || move === 'darkAngel' ? 1.1 : 1 });
    ring(p.x, p.y, { r0: p.r * .3, r1: p.r * 1.9, color, ttl: .55, delay, width: 1.6, alpha: .4 });
    if (move === 'charge') converge(p, color, delay + .05);
    if (move === 'gun') flash(p.x, p.y, color, { r: p.r * 1.4, ttl: .25, delay });
    if (move === 'fireball') embers(p, color, delay);
    if (move === 'angel' || move === 'darkAngel') healColumn(p, color, delay + .1);
    if (move === 'avalanche') {
      ring(p.x, p.y, { r0: p.r, r1: p.r * 3, color, ttl: .7, delay, width: 2, alpha: .45, squash: .55 });
    }
  }

  // Read per-target outcomes so cancellation never hides valid splash hits.
  function spawnProjectiles(room) {
    const actions = room.actions || {}, logs = room.result?.logs || [];
    const muted = new Set(room.result?.muted || []);
    const key = (from, to) => JSON.stringify([from, to]);
    const handled = new Set(), clashes = new Set();
    const flight = (move, from, to, delay, done, duration) => {
      if (move === 'gun') bullet(from, to, delay, done, duration);
      else if (move === 'fireball') fireball(from, to, delay, done, duration, 0);
      else if (move === 'darkAngel') voidOrb(from, to, delay, done, duration);
    };
    const feedback = (from, to, move, reflected) => logs.filter(l =>
      ['damage', 'block'].includes(l.type) && l.source === from && l.target === to &&
      !!l.reflected === reflected && (l.move || actions[from]?.move) === move);
    const reflection = (from, to, move) => logs.find(l =>
      l.type === 'reflect' && l.source === to && l.target === from && (!l.move || l.move === move));
    const contact = (from, to) => {
      const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const offset = Math.min(to.r * 1.35, distance * .45);
      return { x: to.x - (to.x - from.x) / distance * offset, y: to.y - (to.y - from.y) / distance * offset, r: to.r * .65 };
    };
    const land = (fromId, toId, move, point, direct, reflected) => {
      const from = positions[fromId], to = positions[toId];
      if (!from || !to) return;
      const entries = feedback(fromId, toId, move, reflected);
      const bounced = !reflected && reflection(fromId, toId, move);
      const damaged = entries.some(l => l.type === 'damage');
      if (move === 'fireball') {
        if (direct) { explodeAt(point, 0); fireballSplash(point, .02); }
        else fireballBurn(point, 0);
      } else if (damaged) impact(point, moveStyle(move)[0], 1);
      else spark(point.x, point.y, moveStyle(move)[0], 8, .8);
      if (entries.some(l => l.type === 'block')) defenseImpact(toId, actions[toId]?.move, 0);
      if (bounced) {
        reflectionImpact(toId, actions[toId]?.move, 0);
        launch(toId, fromId, move, .08, point, .3, true, true);
      }
    };
    const launch = (fromId, toId, move, delay, start, duration, direct = true, reflected = false) => {
      const from = start || positions[fromId], to = positions[toId];
      if (!from || !to) return;
      const entries = feedback(fromId, toId, move, reflected);
      const bounced = !reflected && reflection(fromId, toId, move);
      if (!entries.length && !bounced) return;
      const point = entries.some(l => l.type === 'damage') ? to : contact(from, to);
      flight(move, from, point, delay, () => land(fromId, toId, move, point, direct, reflected), duration);
    };

    for (const log of logs.filter(l => l.type === 'clash')) {
      const pair = JSON.stringify([log.source, log.target].sort());
      if (clashes.has(pair)) continue;
      clashes.add(pair);
      const a = positions[log.source], b = positions[log.target];
      if (!a || !b) continue;
      const reverse = logs.find(l => l.type === 'clash' && l.source === log.target && l.target === log.source);
      const cancelled = log.outcome ? log.outcome === 'cancel' : !!reverse;
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: Math.min(a.r, b.r) * .65 };
      for (const [id, other, point] of [[log.source, log.target, a], [log.target, log.source, b]]) {
        const move = actions[id]?.move;
        if (!PROJECTILES.has(move) || muted.has(id)) continue;
        handled.add(key(id, other));
        flight(move, point, middle, .25, () => {}, .36);
      }
      cues.push({ delay: .61, run: () => {
        clashPoint(a, b, 0);
        const stopped = cancelled ? [log.source, log.target] : [log.source];
        if (stopped.some(id => actions[id]?.move === 'fireball')) {
          explodeAt(middle, 0);
          fireballSplash(middle, .02);
        }
      } });
      if (!cancelled && PROJECTILES.has(actions[log.target]?.move)) {
        launch(log.target, log.source, actions[log.target].move, .61, middle, .28);
      }
    }

    for (const [id, action] of Object.entries(actions)) {
      if (!PROJECTILES.has(action.move) || muted.has(id) || !positions[id]) continue;
      const targets = new Set([action.target]);
      if (action.move === 'fireball') {
        for (const log of logs) {
          if (['damage', 'block'].includes(log.type) && log.source === id && !log.reflected) targets.add(log.target);
          if (log.type === 'reflect' && log.target === id) targets.add(log.source);
        }
      }
      for (const target of targets) {
        if (!positions[target] || handled.has(key(id, target))) continue;
        if (target === action.target) launch(id, target, action.move, .25);
        else {
          const to = positions[target], entries = feedback(id, target, action.move, false);
          const point = entries.some(l => l.type === 'damage') ? to : contact(positions[id], to);
          cues.push({ delay: .78, run: () => land(id, target, action.move, point, false, false) });
        }
      }
    }
  }

  function spawnRound(room) {
    const actions = room.actions || {};
    const result = room.result || {};
    const players = room.players || [];
    const actors = players.filter(p => actions[p.id]).sort((a, b) => a.seat - b.seat);
    const muted = new Set(result.muted || []);
    actors.forEach((p, i) => { if (!muted.has(p.id)) spawnCaster(actions[p.id].move, p.id, .08 + i * .09); });
    // 地震与海浪的全场效果只取决于是否成功施放，与是否造成伤害无关。
    const logs = result.logs || [];
    actors.forEach((p, i) => {
      if (muted.has(p.id) || !positions[p.id]) return;
      const move = actions[p.id].move;
      if (move === 'quake') quakeBurst(positions[p.id], .5 + i * .1);
      else if (move === 'wave') waveSweep(positions[p.id], .5 + i * .1);
    });
    spawnProjectiles(room);

    let hitClock = 0;
    for (const log of logs) {
      if (!log || !log.type) continue;
      const t = .4 + hitClock * .055;
      const source = log.source ? positions[log.source] : null;
      const target = log.target ? positions[log.target] : null;
      const sourceMove = log.source ? actions[log.source]?.move : null;
      if (log.type === 'damage') {
        if (!source || !target) { hitClock++; continue; }
        if (PROJECTILES.has(log.move || sourceMove)) { hitClock++; continue; }
        if (log.reflected) {
          reflectedHit(source, target, t, actions[log.target]?.move || sourceMove, sourceMove);
          hitClock++;
          continue;
        }
        switch (sourceMove) {
          case 'gun': bullet(source, target, t); break;
          case 'fireball': break;
          case 'darkAngel': voidOrb(source, target, t); break;
          case 'hammer':
          case 'shieldHammer': hammerHit(source, target, moveStyle(sourceMove)[0], t, false); break;
          case 'meteor': meteorStrike(source, target, t); break;
          case 'quake':
            groundHit(target, moveStyle('quake')[0], t + .12, log.amount || 2);
            break;
          case 'wave':
            splash(target, moveStyle('wave')[0], t + .14);
            break;
          default: impact(target, moveStyle(sourceMove || 'gun')[0], 1);
        }
        hitClock++;
      } else if (log.type === 'block') {
        if (!target) continue;
        if (PROJECTILES.has(log.move || sourceMove)) { hitClock++; continue; }
        if (sourceMove === 'quake') groundHit(target, moveStyle('quake')[0], t, 2, true, false);
        else if (sourceMove === 'wave') splash(target, moveStyle('wave')[0], t, true, false);
        else if (sourceMove === 'fireball') { /* 火球命中与格挡由飞行演出统一处理 */ }
        defenseImpact(log.target, actions[log.target]?.move, t);
        hitClock++;
      } else if (log.type === 'reflect') {
        if (PROJECTILES.has(actions[log.target]?.move)) { hitClock++; continue; }
        if (source) reflectionImpact(log.source, actions[log.source]?.move, t);
        hitClock++;
      } else if (log.type === 'drain') {
        if (source && target) hammerHit(source, target, moveStyle(sourceMove || 'hammer')[0], t, true);
        hitClock++;
      } else if (log.type === 'clash') {
        // One collision per pair is scheduled by spawnProjectiles.
      } else if (log.type === 'death') {
        if (target) deathEffect(target, t + .1);
      } else if (log.type === 'heal') {
        if (target) healBurst(target, t, actions[log.target]?.move);
      } else if (log.type === 'mute') {
        if (source && target) {
          chain(source.x, source.y, target.x, target.y, { color: moveStyle('meteor')[0], ttl: .9, delay: t, width: 1.8, jitter: 15 });
          aura(log.target, 'mute', moveStyle('meteor')[0], { delay: t, ttl: 1.2 });
        }
      } else if (log.type === 'avalanche') {
        avalanche(room, t);
      }
    }

    if (result.finished && result.winnerId) victory(result.winnerId);
  }

  function healBurst(p, delay, move) {
    const color = moveStyle(move === 'darkAngel' ? 'darkAngel' : 'angel')[0];
    motes(p.x, p.y + p.r * .5, color, 10, { spread: p.r * .8, rise: 70, kind: 'feather' });
    ring(p.x, p.y, { r0: p.r * .5, r1: p.r * 1.8, color, ttl: .5, delay, width: 1.6, alpha: .4 });
  }

  function spawnInterrupt(room) {
    const actions = room.actions || {};
    let i = 0;
    for (const [id, action] of Object.entries(actions)) {
      if (action?.move !== 'meteor' || !positions[id]) continue;
      aura(id, 'flail', moveStyle('meteor')[0], { delay: i * .12, persist: true, scale: 1.05, alpha: 1 });
      ring(positions[id].x, positions[id].y, { r0: positions[id].r, r1: positions[id].r * 2.2, color: moveStyle('meteor')[0], ttl: .7, delay: i * .12, width: 2, alpha: .5 });
      i++;
    }
  }

  /* ---------- sync ---------- */

  function sync(payload = {}) {
    const { room, self, previewMove, previewTarget, interruptTarget } = payload;
    if (!room || !self) { stop(); return; }
    const el = document.querySelector('.game-room .arena');
    if (!el) { stop(); return; }
    if (el !== arena) {
      arena = el;
      canvas = null;
      ctx = null;
      W = 0;
      H = 0;
      seatSig = '';
      baseCanvas = null;
      baseKey = '';
    }
    attachIfNeeded();
    if (!raf) start();
    if (!canvas) return;
    syncLayout(false);

    if (room.id !== roomId) {
      roomId = room.id;
      clearScene();
      lastPhase = '';
      lastReveal = '';
      lastInterrupt = '';
    }

    const phase = room.phase;
    const phaseKey = `${room.id}:${room.gameNumber || 0}:${room.round}:${phase}`;
    if (phase !== lastPhase) {
      if (phase === 'reveal' && room.result) {
        lastReveal = phaseKey;
        clearScene();
        syncLayout(true);
        spawnRound(room);
      } else if (phase === 'interrupt') {
        lastInterrupt = phaseKey;
        clearScene();
        syncLayout(true);
        spawnInterrupt(room);
      } else if (phase === 'selecting' || phase === 'waiting') {
        clearScene();
      }
      lastPhase = phase;
    } else if (phase === 'reveal' && room.result && lastReveal !== phaseKey) {
      lastReveal = phaseKey;
      clearScene();
      syncLayout(true);
      spawnRound(room);
    }

    const me = room.players?.find(p => p.id === self.id);
    const selecting = phase === 'selecting' && me && me.hp > 0 && !room.ownAction;
    const previewKey = selecting ? `${self.id}|${previewMove || ''}|${previewTarget || ''}` : '';
    if (previewKey !== lastPreview) {
      lastPreview = previewKey;
      clearTag('preview');
      if (selecting && previewMove) spawnPreview(previewMove, previewTarget, self.id);
    }

    const interrupting = phase === 'interrupt' && room.ownAction?.move === 'meteor' && !(room.interruptSubmitted || []).includes(self.id);
    const interruptKey = interrupting && interruptTarget ? `${self.id}|${interruptTarget}` : '';
    if (interruptKey !== lastInterruptPreview) {
      lastInterruptPreview = interruptKey;
      clearTag('interrupt');
      if (interrupting && interruptTarget && positions[self.id] && positions[interruptTarget]) {
        const a = positions[self.id];
        const b = positions[interruptTarget];
        chain(a.x, a.y, b.x, b.y, { color: moveStyle('meteor')[0], ttl: Infinity, life: Infinity, delay: 0, width: 2, jitter: 13, tag: 'interrupt' });
        aura(interruptTarget, 'mark', moveStyle('meteor')[0], { persist: true, alpha: .6, tag: 'interrupt' });
      }
    }
  }

  /* ---------- update ---------- */

  function shakeIt(v) {
    if (reduced) return;
    shake = Math.min(9, Math.max(shake, v));
  }

  function update(dt) {
    for (let i = cues.length - 1; i >= 0; i--) {
      cues[i].delay -= dt;
      if (cues[i].delay <= 0) cues.splice(i, 1)[0].run();
    }
    if (shake > 0) shake = Math.max(0, shake - dt * 26);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.gravity || 0) * dt;
      if (p.spin) p.rot = (p.rot || 0) + p.spin * dt;
      const drag = Math.pow(p.drag ?? .96, dt * 60);
      p.vx *= drag;
      p.vy *= drag;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.life -= dt;
      if (r.life <= 0) rings.splice(i, 1);
    }
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      if (b.delay > 0) { b.delay -= dt; continue; }
      b.life -= dt;
      if (b.life <= 0) {
        beams.splice(i, 1);
        if (b.impact) b.impact();
      }
    }
    for (let i = flails.length - 1; i >= 0; i--) {
      const f = flails[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.life -= dt;
      if (f.life <= 0) {
        flails.splice(i, 1);
        if (f.impact) f.impact();
      }
    }
    for (let i = chains.length - 1; i >= 0; i--) {
      const c = chains[i];
      if (c.delay > 0) { c.delay -= dt; continue; }
      if (c.life === Infinity) continue;
      c.life -= dt;
      if (c.life <= 0) chains.splice(i, 1);
    }
    for (const l of links) {
      if (!l.persist) { l.life -= dt; }
    }
    for (let i = links.length - 1; i >= 0; i--) if (links[i].life <= 0) links.splice(i, 1);
    for (let i = auras.length - 1; i >= 0; i--) {
      const a = auras[i];
      if (a.delay > 0) { a.delay -= dt; continue; }
      a.age += dt;
      if (a.persist) continue;
      a.life -= dt;
      if (a.life <= 0) auras.splice(i, 1);
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.life -= dt;
      if (f.life <= 0) flashes.splice(i, 1);
    }
    for (let i = frosts.length - 1; i >= 0; i--) {
      const f = frosts[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.life -= dt;
      if (f.life <= 0) frosts.splice(i, 1);
    }
    for (let i = cracks.length - 1; i >= 0; i--) {
      const c = cracks[i];
      if (c.delay > 0) { c.delay -= dt; continue; }
      c.life -= dt;
      if (c.life <= 0) cracks.splice(i, 1);
    }
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i];
      if (w.delay > 0) { w.delay -= dt; continue; }
      w.life -= dt;
      if (w.life <= 0) waves.splice(i, 1);
    }
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i];
      if (e.delay > 0) { e.delay -= dt; continue; }
      e.life -= dt;
      if (e.life <= 0) explosions.splice(i, 1);
    }
    for (let i = smokes.length - 1; i >= 0; i--) {
      const s = smokes[i];
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.life -= dt;
      if (s.life <= 0) { smokes.splice(i, 1); continue; }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy *= Math.pow(.985, dt * 60);
    }
    for (let i = scorches.length - 1; i >= 0; i--) {
      const s = scorches[i];
      if (s.delay > 0) { s.delay -= dt; continue; }
      s.life -= dt;
      if (s.life <= 0) scorches.splice(i, 1);
    }
    for (const d of dust) {
      d.y -= d.v * dt;
      d.x += Math.sin(time * .4 + d.ph) * 3 * dt;
      if (d.y < -8) { d.y = H + 8; d.x = Math.random() * W; }
    }
  }

  /* ---------- paint ---------- */

  function pointOnPath(b, t) {
    if (!b.curve) return { x: b.ax + (b.bx - b.ax) * t, y: b.ay + (b.by - b.ay) * t };
    const mt = 1 - t;
    return {
      x: mt * mt * b.ax + 2 * mt * t * b.cx + t * t * b.bx,
      y: mt * mt * b.ay + 2 * mt * t * b.cy + t * t * b.by,
    };
  }

  function glow(x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(.4, rgba(color, alpha * .45));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(.1, r), 0, TAU);
    ctx.fill();
  }

  function drawAmbient() {
    if (reduced) return;
    const { cx, cy, rx, ry } = stage;
    ctx.save();
    const pulse = (time % 6) / 6;
    ctx.strokeStyle = rgba('#c4f582', .10 * (1 - pulse));
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * (.35 + .65 * pulse), ry * (.35 + .65 * pulse), 0, 0, TAU);
    ctx.stroke();
    const a0 = time * .32;
    ctx.strokeStyle = rgba('#94c5ff', .18);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, a0, a0 + .5);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, a0 + Math.PI, a0 + Math.PI + .5);
    ctx.stroke();
    for (const d of dust) {
      ctx.fillStyle = rgba('#c4f582', d.a * (.6 + .4 * Math.sin(time + d.ph)));
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawScorches() {
    ctx.save();
    for (const s of scorches) {
      if (s.delay > 0) continue;
      const fade = Math.min(1, (s.ttl - s.life) / .12) * Math.min(1, s.life / .9);
      if (fade <= .01) continue;
      // 红热边缘随时间冷却。
      const hot = clamp(s.life / (s.ttl * .5), 0, 1);
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, Math.max(1, Math.max(s.rx, s.ry)));
      g.addColorStop(0, `rgba(8,7,5,${.66 * fade})`);
      g.addColorStop(.55, `rgba(20,14,9,${.38 * fade})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, Math.max(1, s.rx), Math.max(1, s.ry), 0, 0, TAU);
      ctx.fill();
      if (hot > .01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const ig = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, Math.max(1, s.rx * .68));
        ig.addColorStop(0, `rgba(255,110,45,${.4 * hot * fade})`);
        ig.addColorStop(.6, `rgba(255,80,25,${.22 * hot * fade})`);
        ig.addColorStop(1, 'rgba(255,60,20,0)');
        ctx.fillStyle = ig;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, Math.max(1, s.rx * .68), Math.max(1, s.ry * .68), 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,96,40,${.55 * hot * fade})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, s.rx * .95, s.ry * .95, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = rgba(s.color, .16 * fade);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.rx * .9, s.ry * .9, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCracks() {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const c of cracks) {
      if (c.delay > 0) continue;
      const fadeIn = clamp((c.ttl - c.life) / .1, 0, 1);
      const fadeOut = clamp(c.life / 1.4, 0, 1);
      const alpha = Math.min(fadeIn, fadeOut);
      if (alpha <= .01) continue;
      const pulse = .85 + .15 * Math.sin(time * 5 + c.x * .02);
      for (const line of c.lines) {
        ctx.beginPath();
        line.points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.strokeStyle = `rgba(3,5,3,${.5 * alpha})`;
        ctx.lineWidth = line.width * 2.8;
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const c of cracks) {
      if (c.delay > 0) continue;
      const fadeIn = clamp((c.ttl - c.life) / .1, 0, 1);
      const fadeOut = clamp(c.life / 1.4, 0, 1);
      const alpha = Math.min(fadeIn, fadeOut);
      if (alpha <= .01) continue;
      const pulse = .85 + .15 * Math.sin(time * 5 + c.x * .02);
      for (const line of c.lines) {
        ctx.beginPath();
        line.points.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.strokeStyle = rgba(c.color, .2 * alpha * pulse);
        ctx.lineWidth = line.width * 4.2;
        ctx.stroke();
      }
      for (const line of c.lines) {
        const pts = line.points;
        for (let i = 1; i < pts.length; i++) {
          const t = i / (pts.length - 1);
          const w = Math.max(.6, line.width * (1 - t * .55));
          const a = alpha * (1 - t * .35) * pulse;
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.strokeStyle = rgba('#ffc98a', .58 * a);
          ctx.lineWidth = w;
          ctx.stroke();
          ctx.strokeStyle = rgba('#ffe9c4', .3 * a);
          ctx.lineWidth = Math.max(.5, w * .45);
          ctx.stroke();
        }
      }
      glow(c.x, c.y, Math.min(W, H) * .09, c.color, .14 * alpha);
    }
    ctx.restore();
  }

  function drawRings() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of rings) {
      if (r.delay > 0) continue;
      const e = clamp(1 - r.life / r.ttl, 0, 1);
      const rad = r.r0 + (r.r1 - r.r0) * easeOut(e);
      const alpha = Math.pow(1 - e, 1.5) * r.alpha;
      if (alpha <= .003) continue;
      ctx.strokeStyle = rgba(r.color, alpha);
      ctx.lineWidth = r.width;
      if (r.dash) ctx.setLineDash(r.dash);
      ctx.beginPath();
      ctx.ellipse(r.x, r.y + r.offsetY, Math.max(1, rad), Math.max(1, rad * r.squash), 0, 0, TAU);
      ctx.stroke();
      if (r.dash) ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawWaves() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    for (const w of waves) {
      if (w.delay > 0) continue;
      const e = clamp(1 - w.life / w.ttl, 0, 1);
      const rad = w.r0 + (w.r1 - w.r0) * easeOut(e);
      const alpha = Math.min(1, e * 6) * Math.pow(1 - e, .75) * w.alpha;
      if (alpha <= .01) continue;
      const band = Math.max(1.5, w.band * (1 - e * .45));
      const n = 56;
      const outer = [];
      const inner = [];
      for (let i = 0; i <= n; i++) {
        const a = i / n * TAU;
        const wob = 1 + Math.sin(a * 5 + time * 2.4 + w.seed) * .02 + Math.sin(a * 9 - time * 1.6 + w.seed * 2) * .012;
        const rr = rad * wob;
        outer.push([w.x + Math.cos(a) * rr, w.y + Math.sin(a) * rr * w.squash]);
        const ri = Math.max(.5, rr - band);
        inner.push([w.x + Math.cos(a) * ri, w.y + Math.sin(a) * ri * w.squash]);
      }
      ctx.beginPath();
      outer.forEach(([px, py], i) => { if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
      ctx.closePath();
      ctx.fillStyle = rgba(w.color, alpha * .18);
      ctx.fill();
      ctx.strokeStyle = `rgba(230,255,251,${alpha * .7})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      outer.forEach(([px, py], i) => { if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.stroke();
      if (!reduced) {
        for (let k = 0; k < 12; k++) {
          const a = w.seed + k * 2.39 + time * .7;
          const rr = rad * (1 + Math.sin(a * 5 + time * 2.4 + w.seed) * .02);
          const fx = w.x + Math.cos(a) * rr;
          const fy = w.y + Math.sin(a) * rr * w.squash;
          ctx.fillStyle = `rgba(240,255,252,${alpha * .55})`;
          ctx.beginPath();
          ctx.arc(fx, fy, 1 + Math.abs(Math.sin(k * 1.7 + time * 3)) * 1.2, 0, TAU);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  function drawChains() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const c of chains) {
      if (c.delay > 0) continue;
      const e = c.life === Infinity ? 0 : clamp(1 - c.life / c.ttl, 0, 1);
      const alpha = c.life === Infinity ? .55 : Math.sin(Math.PI * e) * .8;
      if (alpha <= .01) continue;
      ctx.strokeStyle = rgba(c.color, alpha);
      ctx.lineWidth = c.width;
      ctx.beginPath();
      const n = 9;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        let x = c.ax + (c.bx - c.ax) * t;
        let y = c.ay + (c.by - c.ay) * t;
        if (i > 0 && i < n - 1) {
          x += Math.sin(time * 22 + i * 2.3) * c.jitter * .5 + rand(-c.jitter, c.jitter) * .35;
          y += Math.cos(time * 19 + i * 1.7) * c.jitter * .5 + rand(-c.jitter, c.jitter) * .35;
        }
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLinks() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.4;
    for (const l of links) {
      if (!l.persist) continue;
      ctx.strokeStyle = rgba(l.color, .42);
      ctx.setLineDash([5, 7]);
      ctx.lineDashOffset = -time * 26;
      ctx.beginPath();
      ctx.moveTo(l.ax, l.ay);
      ctx.lineTo(l.bx, l.by);
      ctx.stroke();
      ctx.setLineDash([]);
      const ang = Math.atan2(l.by - l.ay, l.bx - l.ax);
      const tipX = l.bx - Math.cos(ang) * 14;
      const tipY = l.by - Math.sin(ang) * 14;
      ctx.fillStyle = rgba(l.color, .5);
      ctx.beginPath();
      ctx.moveTo(l.bx - Math.cos(ang) * 6, l.by - Math.sin(ang) * 6);
      ctx.lineTo(tipX + Math.cos(ang + 2.4) * 7, tipY + Math.sin(ang + 2.4) * 7);
      ctx.lineTo(tipX + Math.cos(ang - 2.4) * 7, tipY + Math.sin(ang - 2.4) * 7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBeams() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of beams) {
      if (b.delay > 0) continue;
      const p = clamp(1 - b.life / b.ttl, 0, 1);
      const start = Math.max(0, p - b.trail);
      const head = pointOnPath(b, p);
      const steps = b.curve ? 12 : 3;
      ctx.strokeStyle = rgba(b.color, .8);
      ctx.lineWidth = b.width;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = start + (p - start) * (i / steps);
        const q = pointOnPath(b, clamp(t, 0, 1));
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', .45);
      ctx.lineWidth = Math.max(.7, b.width * .28);
      ctx.stroke();
      if (b.kind === 'comet') {
        glow(head.x, head.y, b.width * 3.1, '#ff8a3d', .5);
        const hg = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, b.width * 1.35);
        hg.addColorStop(0, 'rgba(255,252,226,.98)');
        hg.addColorStop(.38, 'rgba(255,206,110,.9)');
        hg.addColorStop(.75, 'rgba(255,120,60,.5)');
        hg.addColorStop(1, 'rgba(255,90,40,0)');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(head.x, head.y, b.width * 1.35, 0, TAU);
        ctx.fill();
        for (let k = 0; k < 3; k++) {
          const back = pointOnPath(b, Math.max(0, p - .07 - k * .05));
          const nx = -(head.y - back.y);
          const ny = head.x - back.x;
          const len = Math.hypot(nx, ny) || 1;
          const wobble = Math.sin(time * 18 + k * 2) * b.width * .35;
          ctx.strokeStyle = rgba(k === 1 ? '#ffd06a' : '#ff7a3c', .42 - k * .09);
          ctx.lineWidth = Math.max(1.4, b.width * (.75 - k * .18));
          ctx.beginPath();
          ctx.moveTo(back.x + nx / len * wobble, back.y + ny / len * wobble);
          ctx.lineTo(head.x, head.y);
          ctx.stroke();
        }
        if (!reduced && Math.random() < .9) {
          const ttl = rand(.2, .42);
          parts.push({
            x: head.x, y: head.y,
            vx: rand(-24, 24), vy: rand(-24, 24),
            ttl, life: ttl, size: rand(1.2, 2.9), color: Math.random() < .5 ? '#ffd29a' : '#ff8a3d', gravity: -20, drag: .94,
          });
        }
      } else if (b.kind === 'hammer') {
        ctx.save();
        ctx.translate(head.x, head.y);
        ctx.rotate(time * 16);
        ctx.fillStyle = rgba(b.color, .95);
        ctx.fillRect(-b.width * .9, -b.width * .5, b.width * 1.8, b.width);
        ctx.restore();
        glow(head.x, head.y, b.width * 2.2, b.color, .5);
      } else if (b.kind === 'void') {
        glow(head.x, head.y, b.width * 2.4, '#7a4bb8', .6);
        glow(head.x, head.y, b.width * 1.2, b.color, .8);
      } else if (b.kind === 'shard' || b.kind === 'reflect') {
        glow(head.x, head.y, b.width * 2.4, b.color, .6);
      } else {
        glow(head.x, head.y, b.width * 1.9, b.color, .55);
      }
    }
    ctx.restore();
  }

  function drawFlails() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flails) {
      if (f.delay > 0) continue;
      const p = clamp(1 - f.life / f.ttl, 0, 1);
      const t = easeInOut(p);
      const mt = 1 - t;
      const x = mt * mt * f.ax + 2 * mt * t * f.cx + t * t * f.bx;
      const y = mt * mt * f.ay + 2 * mt * t * f.cy + t * t * f.by;
      ctx.strokeStyle = rgba(f.color, .55);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const n = 10;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const lx = f.ax + (x - f.ax) * k;
        const ly = f.ay + (y - f.ay) * k + Math.sin(k * Math.PI) * 10;
        if (i === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      }
      ctx.stroke();
      glow(x, y, 26, f.color, .55);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time * 12);
      ctx.fillStyle = rgba(f.color, .95);
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba(f.color, .75);
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
        ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      if (p.delay > 0) continue;
      const alpha = clamp(p.life / p.ttl, 0, 1);
      if (alpha <= .01) continue;
      ctx.globalAlpha = alpha * .95;
      if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * .018, p.y - p.vy * .018);
        ctx.stroke();
      } else if (p.kind === 'snow') {
        ctx.fillStyle = rgba(p.color, .9);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba('#ffffff', .5);
        ctx.lineWidth = .7;
        ctx.beginPath();
        ctx.moveTo(p.x - p.size * 2, p.y);
        ctx.lineTo(p.x + p.size * 2, p.y);
        ctx.moveTo(p.x, p.y - p.size * 2);
        ctx.lineTo(p.x, p.y + p.size * 2);
        ctx.stroke();
      } else if (p.kind === 'feather') {
        ctx.fillStyle = rgba(p.color, .8);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size * .7, p.size * 1.7, time * 2 + p.x * .01, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'flame') {
        const lf = alpha;
        const flick = .78 + .22 * Math.sin(time * 26 + p.x * .05 + p.y * .03);
        const s = Math.max(1, p.size * (0.3 + .7 * lf) * flick);
        const fg = ctx.createRadialGradient(p.x, p.y - s * .9, 0, p.x, p.y, s * 2.8);
        fg.addColorStop(0, `rgba(255,243,196,${.95 * lf})`);
        fg.addColorStop(.35, rgba(p.color, .85 * lf));
        fg.addColorStop(.72, `rgba(255,90,30,${.4 * lf})`);
        fg.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - s * .9, s * .95, s * 1.9, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = `rgba(255,250,220,${.75 * lf * flick})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - s * .5, s * .38, s * .8, 0, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'debris') {
        const lf = alpha;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = rgba(p.color, .92 * lf);
        ctx.fillRect(-p.size, -p.size * .6, p.size * 2, p.size * 1.2);
        ctx.fillStyle = `rgba(255,217,160,${.55 * lf})`;
        ctx.fillRect(-p.size, -p.size * .6, p.size * 2, p.size * .4);
        ctx.restore();
        ctx.strokeStyle = rgba('#ffcf8a', .5 * lf);
        ctx.lineWidth = Math.max(.8, p.size * .35);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * .028, p.y - p.vy * .028);
        ctx.stroke();
      } else if (p.kind === 'drop') {
        const ang = Math.atan2(p.vy, p.vx);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ang);
        ctx.fillStyle = rgba(p.color, .85 * alpha);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 1.8, p.size * .8, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba('#ffffff', .45 * alpha);
        ctx.beginPath();
        ctx.ellipse(-p.size * .4, -p.size * .18, p.size * .7, p.size * .3, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = alpha * .25;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.6, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawExplosions() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const ex of explosions) {
      if (ex.delay > 0) continue;
      const e = clamp(1 - ex.life / ex.ttl, 0, 1);
      const fade = Math.pow(1 - e, .72);
      if (fade <= .01) continue;
      const R = Math.max(4, ex.size * (.9 + easeOut(e) * 1.35));
      const g = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, R);
      g.addColorStop(0, `rgba(255,253,238,${fade})`);
      g.addColorStop(.16, `rgba(255,222,130,${.95 * fade})`);
      g.addColorStop(.42, `rgba(255,138,64,${.7 * fade})`);
      g.addColorStop(.74, `rgba(196,58,28,${.32 * fade})`);
      g.addColorStop(1, 'rgba(110,18,8,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, R, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255,254,240,${.95 * fade})`;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, R * .15, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 7; i++) {
        const ang = ex.seed + i / 7 * TAU + e * .85;
        const len = R * (.72 + .5 * Math.sin(ex.seed * 2 + i * 1.7));
        ctx.strokeStyle = rgba(i % 2 ? '#ff8a3d' : '#ffd06a', .6 * fade);
        ctx.lineWidth = 7 * (1 - e) + 1;
        ctx.beginPath();
        ctx.moveTo(ex.x + Math.cos(ang) * R * .22, ex.y + Math.sin(ang) * R * .22);
        ctx.lineTo(ex.x + Math.cos(ang) * len, ex.y + Math.sin(ang) * len);
        ctx.stroke();
      }
      for (let k = 0; k < 3; k++) {
        const off = (k - 1) * R * .26;
        const h = R * (1.15 + .3 * Math.sin(ex.seed + k * 1.9));
        const jg = ctx.createLinearGradient(ex.x, ex.y, ex.x, ex.y - h);
        jg.addColorStop(0, `rgba(255,214,120,${.55 * fade})`);
        jg.addColorStop(.55, `rgba(255,138,61,${.34 * fade})`);
        jg.addColorStop(1, 'rgba(255,90,40,0)');
        ctx.strokeStyle = jg;
        ctx.lineWidth = Math.max(2, 9 * (1 - e));
        ctx.beginPath();
        ctx.moveTo(ex.x + off, ex.y + R * .1);
        ctx.quadraticCurveTo(ex.x + off * 1.8, ex.y - h * .55, ex.x + off * 2.2, ex.y - h);
        ctx.stroke();
      }
      glow(ex.x, ex.y, R * .38, '#fff7d6', .7 * fade);
    }
    ctx.restore();
  }

  function drawSmokes() {
    ctx.save();
    for (const s of smokes) {
      if (s.delay > 0) continue;
      const e = clamp(1 - s.life / s.ttl, 0, 1);
      const a = Math.pow(1 - e, 1.2) * s.alpha;
      if (a <= .005) continue;
      const r = Math.max(1, s.r * (.7 + e * 1.5));
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, `rgba(188,172,150,${a})`);
      g.addColorStop(.55, `rgba(140,120,100,${a * .55})`);
      g.addColorStop(1, 'rgba(90,80,70,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function hexPath(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = rot + i / 6 * TAU;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawAngel(a, x, y, r) {
    const dark = a.kind === 'darkAngel';
    const lift = reduced || a.persist ? 0 : Math.min(easeOut(clamp(a.age / .7, 0, 1)) * r * .9, Math.max(0, y - r * 1.5 - 8));
    ctx.save();
    ctx.translate(x, y - lift);
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = dark ? '#ab8ddb' : '#fff3d8';
    ctx.shadowBlur = reduced ? 5 : 14;
    // Both variants share the same winged silhouette; the dark one has black feathers.
    ctx.fillStyle = dark ? '#100e19' : '#fff0e5';
    ctx.strokeStyle = dark ? '#a78bc5' : '#ffe3b3';
    ctx.lineWidth = 1.4;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.beginPath();
      ctx.moveTo(r * .3, r * .35);
      ctx.bezierCurveTo(r * .8, -r * .4, r * 1.5, -r * 1.2, r * 2.3, -r * 1.45);
      ctx.bezierCurveTo(r * 2.2, -r * .3, r * 1.6, r * .7, r * .3, r * .55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(r * .5, r * .35);
        ctx.quadraticCurveTo(r * (1.3 + i * .15), r * (.1 - i * .18), r * (1.1 + i * .25), r * (.45 - i * .37));
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, -r * .65, r * .22, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -r * .35);
    ctx.lineTo(-r * .4, r * .65);
    ctx.lineTo(r * .4, r * .65);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -r * 1.2, r * .45, r * .12, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawGoldShield(x, y, r, color, active) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = rgba(color, active ? .19 : .06);
    ctx.lineWidth = active ? 3.5 : 1.8;
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? 20 : 4;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.7);
    ctx.lineTo(x + r * 1.5, y - r * 1.1);
    ctx.lineTo(x + r * 1.25, y + r * .8);
    ctx.lineTo(x, y + r * 1.8);
    ctx.lineTo(x - r * 1.25, y + r * .8);
    ctx.lineTo(x - r * 1.5, y - r * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = active ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(x - r * 1.3, y - r * 1.25);
    ctx.lineTo(x + r * 1.3, y + r * 1.25);
    ctx.moveTo(x + r * 1.3, y - r * 1.25);
    ctx.lineTo(x - r * 1.3, y + r * 1.25);
    ctx.stroke();
    ctx.restore();
  }

  function drawAuras() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const a of auras) {
      if (a.delay > 0) continue;
      const x = a.x;
      const y = a.y;
      const r = Math.max(8, a.r * a.scale);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      let alpha;
      if (a.persist) alpha = a.alpha * (.72 + .22 * Math.sin(time * 2.6));
      else {
        const inA = clamp(a.age / .12, 0, 1);
        const outA = clamp(a.life / .28, 0, 1);
        alpha = a.alpha * Math.min(inA, outA);
      }
      if (alpha <= .01) continue;
      ctx.globalAlpha = alpha;
      const color = a.color;
      if (a.kind === 'angel' || a.kind === 'darkAngel') {
        drawAngel(a, x, y, r);
      } else if (a.kind === 'holyImpact') {
        const grad = ctx.createLinearGradient(0, y - r * 4, 0, y + r * 1.5);
        grad.addColorStop(0, rgba('#fff5ce', 0));
        grad.addColorStop(.6, rgba(color, .45));
        grad.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(x - r * 1.7, y - r * 4, r * 3.4, r * 5.5);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.5, 0, TAU);
        ctx.stroke();
        for (let i = 0; i < 8; i++) {
          const angle = i / 8 * TAU;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(angle) * r * 1.7, y + Math.sin(angle) * r * 1.7);
          ctx.lineTo(x + Math.cos(angle) * r * 2.3, y + Math.sin(angle) * r * 2.3);
          ctx.stroke();
        }
      } else if (a.kind === 'waveReflect' || a.kind === 'goldReflect') {
        if (a.kind === 'goldReflect') drawGoldShield(x, y, r * 1.1, color, true);
        // A returning arc and arrow show that an attack was sent back.
        ctx.strokeStyle = a.kind === 'waveReflect' ? '#ffbc78' : '#fff0b8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, r * 2, Math.PI * .2, Math.PI * 1.65);
        ctx.stroke();
        const end = Math.PI * 1.65, ex = x + Math.cos(end) * r * 2, ey = y + Math.sin(end) * r * 2;
        ctx.beginPath();
        ctx.moveTo(ex - r * .55, ey - r * .12);
        ctx.lineTo(ex, ey);
        ctx.lineTo(ex - r * .12, ey + r * .55);
        ctx.stroke();
      } else if (a.kind === 'hex' || a.kind === 'dome') {
        const rot = a.rot + time * .5;
        ctx.strokeStyle = rgba(color, .7);
        ctx.lineWidth = 1.6;
        hexPath(x, y, r * 1.5, rot);
        ctx.stroke();
        ctx.strokeStyle = rgba(color, .35);
        hexPath(x, y, r * 1.76, rot + .5);
        ctx.stroke();
        if (a.kind === 'dome') {
          ctx.strokeStyle = rgba(color, .5);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, r * 1.35, Math.PI, TAU);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, r * 1.15, Math.PI, TAU);
          ctx.stroke();
        }
        ctx.fillStyle = rgba(color, .06);
        hexPath(x, y, r * 1.5, rot);
        ctx.fill();
      } else if (a.kind === 'charge') {
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 3; i++) {
          const ph = (time * .9 + i / 3) % 1;
          const rad = r * (2.1 - ph * 1.4);
          ctx.strokeStyle = rgba(color, .16 + .45 * ph);
          ctx.beginPath();
          ctx.arc(x, y, rad, -1 + i, .4 + i);
          ctx.stroke();
        }
      } else if (a.kind === 'impact') {
        ctx.strokeStyle = rgba(color, .75);
        ctx.lineWidth = 2.2;
        for (let i = 0; i < 4; i++) {
          const ang = a.rot + i / 4 * TAU + time * .6;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(ang) * r * 1.15, y + Math.sin(ang) * r * 1.15);
          ctx.lineTo(x + Math.cos(ang) * r * 1.65, y + Math.sin(ang) * r * 1.65);
          ctx.stroke();
        }
      } else if (a.kind === 'muzzle') {
        glow(x, y, r * 1.7, color, .35);
        ctx.strokeStyle = rgba(color, .7);
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const ang = time * 5 + i / 3 * TAU;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(ang) * r * .8, y + Math.sin(ang) * r * .8);
          ctx.lineTo(x + Math.cos(ang) * r * 1.4, y + Math.sin(ang) * r * 1.4);
          ctx.stroke();
        }
      } else if (a.kind === 'ember') {
        for (let i = 0; i < 3; i++) {
          const ang = time * 2.2 + i / 3 * TAU;
          const ex = x + Math.cos(ang) * r * 1.25;
          const ey = y + Math.sin(ang) * r * 1.25;
          glow(ex, ey, 10, color, .5);
          ctx.fillStyle = rgba('#ffe1b8', .9);
          ctx.beginPath();
          ctx.arc(ex, ey, 2, 0, TAU);
          ctx.fill();
        }
      } else if (a.kind === 'heal') {
        const grad = ctx.createLinearGradient(0, y - r * 2.4, 0, y + r * .6);
        grad.addColorStop(0, rgba(color, 0));
        grad.addColorStop(.55, rgba(color, .22));
        grad.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(x - r * .75, y - r * 2.4, r * 1.5, r * 3);
        ctx.strokeStyle = rgba(color, .5);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(x, y + r * .75, r * 1.15, r * .34, 0, 0, TAU);
        ctx.stroke();
      } else if (a.kind === 'dust') {
        ctx.strokeStyle = rgba(color, .45);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(x, y + r * .85, r * 1.15, r * .32, 0, 0, TAU);
        ctx.stroke();
        for (let i = 0; i < 5; i++) {
          const ang = time * 1.6 + i / 5 * TAU;
          ctx.fillStyle = rgba(color, .35);
          ctx.beginPath();
          ctx.arc(x + Math.cos(ang) * r * 1.2, y + r * .85 + Math.sin(ang) * r * .3, 1.6, 0, TAU);
          ctx.fill();
        }
      } else if (a.kind === 'void') {
        glow(x, y, r * 1.9, color, .28);
        ctx.strokeStyle = rgba(color, .55);
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 3; i++) {
          const start = time * 1.4 + i / 3 * TAU;
          ctx.beginPath();
          ctx.arc(x, y, r * (1.2 + i * .18), start, start + 1.1);
          ctx.stroke();
        }
      } else if (a.kind === 'mirror') {
        drawGoldShield(x, y, r, color, false);
      } else if (a.kind === 'ripple') {
        ctx.strokeStyle = rgba(color, .45);
        ctx.lineWidth = 1.4;
        for (let i = 0; i < 3; i++) {
          const ph = (time * .8 + i / 3) % 1;
          ctx.globalAlpha = alpha * (1 - ph) * .8;
          ctx.beginPath();
          ctx.ellipse(x, y + r * .9, r * (.5 + ph * 1.3), r * (.16 + ph * .42), 0, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = alpha;
      } else if (a.kind === 'flail') {
        const ang = reduced ? -Math.PI / 4 : time * 3.2;
        const orbit = r * 1.85;
        const ex = x + Math.cos(ang) * orbit;
        const ey = y + Math.sin(ang) * orbit;
        ctx.strokeStyle = rgba(color, .65);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, orbit, ang - 1.7, ang);
        ctx.stroke();
        // Visible interlocking links lead to a spiked metal head, not an orb.
        for (let i = 0; i < 6; i++) {
          const t = .42 + i * .1;
          ctx.beginPath();
          ctx.ellipse(x + (ex - x) * t, y + (ey - y) * t, r * .13, r * .075, ang + (i % 2 ? .4 : -.4), 0, TAU);
          ctx.stroke();
        }
        glow(ex, ey, r * .9, color, .65);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(ang);
        const head = Math.max(6, r * .27);
        ctx.fillStyle = '#30263e';
        ctx.strokeStyle = '#ecdfff';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const angle = i / 16 * TAU, radius = head * (i % 2 ? 1 : 1.65);
          if (i === 0) ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
          else ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(-head * .2, -head * .25, head * .35, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else if (a.kind === 'frost') {
        ctx.strokeStyle = rgba(color, .55);
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 6; i++) {
          const ang = a.rot + time * .7 + i / 6 * TAU;
          const cx2 = x + Math.cos(ang) * r * 1.25;
          const cy2 = y + Math.sin(ang) * r * 1.25;
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const ca = ang + k / 3 * TAU;
            ctx.moveTo(cx2, cy2);
            ctx.lineTo(cx2 + Math.cos(ca) * 6, cy2 + Math.sin(ca) * 6);
          }
          ctx.stroke();
        }
      } else if (a.kind === 'mark') {
        const rot = -time * .8;
        ctx.strokeStyle = rgba(color, .7);
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const ang = rot + i / 4 * TAU + Math.PI / 4;
          const rr = r * 1.55;
          ctx.beginPath();
          ctx.arc(x, y, rr, ang, ang + .34);
          ctx.stroke();
        }
        ctx.strokeStyle = rgba(color, .35);
        ctx.beginPath();
        ctx.arc(x, y, r * 1.9, 0, TAU);
        ctx.stroke();
      } else if (a.kind === 'mute') {
        ctx.strokeStyle = rgba(color, .7);
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(x, y, r * 1.45, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x - r * .5, y - r * .5);
        ctx.lineTo(x + r * .5, y + r * .5);
        ctx.moveTo(x + r * .5, y - r * .5);
        ctx.lineTo(x - r * .5, y + r * .5);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawFlashes() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flashes) {
      if (f.delay > 0) continue;
      const e = clamp(1 - f.life / f.ttl, 0, 1);
      const a = Math.pow(1 - e, 2) * f.alpha;
      const r = f.r * (.6 + e * .9);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, Math.max(1, r));
      g.addColorStop(0, rgba(f.color, a));
      g.addColorStop(.42, rgba(f.color, a * .4));
      g.addColorStop(1, rgba(f.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, Math.max(1, r), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFrosts() {
    for (const f of frosts) {
      if (f.delay > 0) continue;
      const e = clamp(1 - f.life / f.ttl, 0, 1);
      const a = Math.pow(1 - e, 1.2) * f.alpha;
      const g = ctx.createRadialGradient(stage.cx, stage.cy, Math.min(W, H) * .08, stage.cx, stage.cy, Math.max(W, H) * .74);
      g.addColorStop(0, rgba('#c7ecff', 0));
      g.addColorStop(.62, rgba('#c7ecff', a * .12));
      g.addColorStop(1, rgba('#e8f8ff', a * .6));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = rgba('#e8f8ff', a * .5);
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 7; i++) {
        const x = (i * 137 + time * 18) % W;
        const y = (i * 83 + time * 26) % H;
        const r = 10 + (i % 3) * 7;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const ang = k / 3 * TAU + i;
          ctx.moveTo(x - Math.cos(ang) * r, y - Math.sin(ang) * r);
          ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
        }
        ctx.stroke();
      }
    }
  }

  function paint() {
    if (!ctx || !W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const sx = shake > .15 ? rand(-shake, shake) : 0;
    const sy = shake > .15 ? rand(-shake, shake) : 0;
    ctx.save();
    ctx.translate(sx, sy);
    if (baseCanvas) ctx.drawImage(baseCanvas, 0, 0, W, H);
    drawAmbient();
    drawScorches();
    drawRings();
    drawWaves();
    drawCracks();
    drawChains();
    drawLinks();
    drawBeams();
    drawFlails();
    drawParticles();
    drawSmokes();
    drawExplosions();
    drawAuras();
    drawFlashes();
    drawFrosts();
    ctx.restore();
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!arena || !canvas) return;
    const dt = clamp((now - (lastFrame || now)) / 1000, 0, .05);
    lastFrame = now;
    acc += dt;
    if (acc < 1 / 40) return;
    const step = acc;
    acc = 0;
    time += step;
    attachIfNeeded();
    if (!canvas) return;
    if (arena.clientWidth !== W || arena.clientHeight !== H) syncLayout(false);
    update(step);
    paint();
  }

  window.ZaizaiFX = { sync, stop };
})();
