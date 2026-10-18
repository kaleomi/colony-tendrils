'use strict';
// Rendering: procedural backgrounds, microbes, tentacles, walls.
(function (CT) {
  const { W, H, T, K, EVO, SEG_SIZE, SEG_STEP, WAVE_FREQ, WAVE_SIZE, WAVE_FADING, WAVE_SPEED, MIN_ATTACK_POWER, lerp, clamp, rng } = CT;
  const TAU = Math.PI * 2;
  const TEAM = {
    1: { name: '中立', rgb: [136, 136, 136], label: '#eeeeaa' },
    2: { name: '红色', rgb: [170, 51, 51], label: '#ff5555' },
    3: { name: '绿色', rgb: [51, 170, 51], label: '#55ff55' },
    4: { name: '黑色', rgb: [17, 17, 17], label: '#ffffff' },
    5: { name: '紫色', rgb: [170, 51, 170], label: '#e070e0' },
  };
  const KIND_RGB = { [K.AMP]: [255, 200, 80], [K.SHELL]: [232, 220, 192], [K.TOXIN]: [184, 224, 74], [K.LEECH]: [255, 110, 140] };
  const WHITE = [255, 255, 255], BLACKC = [0, 0, 0];
  const FONT_DATA = '"Chakra Petch","DIN Alternate","Bahnschrift","Segoe UI",system-ui,sans-serif';
  const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const mix = (c1, c2, t) => [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
  const teamRgb = type => TEAM[type].rgb;

  let cv, ctx, scale = 1, dpr = 1;
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // Field background: an out-of-focus colony seen through a microscope
  function paintFieldBg(seed, tint) {
    const S = 2, c = makeCanvas(W * S, H * S), g = c.getContext('2d'), r = rng(seed);
    g.scale(S, S);
    const base = g.createRadialGradient(W * 0.5, H * 0.45, 40, W * 0.5, H * 0.5, W * 0.75);
    base.addColorStop(0, tint ? tint[0] : '#16302a'); base.addColorStop(1, tint ? tint[1] : '#07130f');
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let layer = 0; layer < 3; layer++) {
      const n = [70, 55, 26][layer];
      for (let i = 0; i < n; i++) {
        const x = r() * W, y = r() * H, rad = [26, 20, 34][layer] + r() * [22, 16, 26][layer];
        const hue = r();
        const col = hue < 0.6 ? [70, 120, 80] : hue < 0.85 ? [90, 110, 70] : [60, 110, 115];
        const a = [0.035, 0.05, 0.03][layer];
        const gr = g.createRadialGradient(x, y, rad * 0.55, x, y, rad);
        gr.addColorStop(0, rgba(col, a * 0.3)); gr.addColorStop(0.84, rgba(mix(col, WHITE, 0.15), a * 1.35)); gr.addColorStop(1, rgba(col, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
      }
    }
    const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    g.setTransform(S, 0, 0, S, 0, 0);
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.62)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    return c;
  }
  // Menu background: tangled filaments
  function paintMenuBg(seed) {
    const S = 2, c = makeCanvas(W * S, H * S), g = c.getContext('2d'), r = rng(seed || 7);
    g.scale(S, S);
    const base = g.createRadialGradient(W / 2, H * 0.55, 30, W / 2, H / 2, W * 0.8);
    base.addColorStop(0, '#1b2d31'); base.addColorStop(1, '#070d0f');
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    g.lineCap = 'round';
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < 70; i++) {
        let x = r() * W, y = r() * H, a = r() * TAU;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 6; k++) { a += (r() - 0.5) * 1.4; const L = 20 + r() * 40; const nx = x + Math.cos(a) * L, ny = y + Math.sin(a) * L; g.quadraticCurveTo(x + Math.cos(a + 0.6) * L * 0.5, y + Math.sin(a + 0.6) * L * 0.5, nx, ny); x = nx; y = ny; }
        const w = [9, 5, 2][pass];
        g.strokeStyle = `rgba(${120 + pass * 20},${160 + pass * 15},170,${[0.035, 0.05, 0.08][pass]})`;
        g.lineWidth = w; g.stroke();
        g.lineWidth = w * 0.35; g.strokeStyle = `rgba(190,220,225,${[0.02, 0.04, 0.07][pass]})`; g.stroke();
      }
    }
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    return c;
  }

  // ---------------------------------------------------------------- walls
  function drawFence(f, a) {
    const x1 = lerp(f.px1, f.x1, a), y1 = lerp(f.py1, f.y1, a), x2 = lerp(f.px2, f.x2, a), y2 = lerp(f.py2, f.y2, a);
    const dx = x2 - x1, dy = y2 - y1, ang = Math.atan2(dy, dx), R = 5, hp = Math.PI / 2;
    const s1 = Math.sin(f.phase) * 5 + 2, s2 = Math.sin(f.phase + Math.PI) + 2;
    const cx = (an, r) => Math.cos(an) * r, cy = (an, r) => Math.sin(an) * r;
    if (f.motion) {           // travel guide
      const m = f.motion, mx = (m.bx1 + m.bx2) / 2, my = (m.by1 + m.by2) / 2;
      ctx.save(); ctx.setLineDash([3, 5]); ctx.strokeStyle = 'rgba(255,170,90,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(mx - m.mx, my - m.my); ctx.lineTo(mx + m.mx, my + m.my); ctx.stroke(); ctx.restore();
    }
    ctx.beginPath();
    ctx.moveTo(cx(ang + hp, R) + x1, cy(ang + hp, R) + y1);
    ctx.quadraticCurveTo(cx(ang + Math.PI, R) * s2 + x1, cy(ang + Math.PI, R) * s2 + y1, cx(ang - hp, R) + x1, cy(ang - hp, R) + y1);
    ctx.quadraticCurveTo(cx(ang - hp, s1) + dx / 2 + x1, cy(ang - hp, s1) + dy / 2 + y1, cx(ang - hp, R) + x2, cy(ang - hp, R) + y2);
    ctx.quadraticCurveTo(cx(ang, R) * s2 + x2, cy(ang, R) * s2 + y2, cx(ang + hp, R) + x2, cy(ang + hp, R) + y2);
    ctx.quadraticCurveTo(cx(ang + hp, s1) + dx / 2 + x1, cy(ang + hp, s1) + dy / 2 + y1, cx(ang + hp, R) + x1, cy(ang + hp, R) + y1);
    ctx.closePath();
    const gr = ctx.createLinearGradient(x1 + cx(ang + hp, 8), y1 + cy(ang + hp, 8), x1 + cx(ang - hp, 8), y1 + cy(ang - hp, 8));
    if (f.motion) { gr.addColorStop(0, '#9a6a3a'); gr.addColorStop(0.5, '#6e4524'); gr.addColorStop(1, '#3e2414'); }
    else { gr.addColorStop(0, '#6c6c3e'); gr.addColorStop(0.5, '#4a4a2a'); gr.addColorStop(1, '#2c2c18'); }
    ctx.fillStyle = gr; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = f.motion ? 'rgba(255,220,180,0.9)' : 'rgba(238,238,238,0.85)'; ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(238,238,210,0.35)';
    const n = Math.max(2, Math.floor(Math.hypot(dx, dy) / 14));
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      const k = i / n, bx = x1 + dx * k, by = y1 + dy * k, w = Math.sin(f.phase * 0.7 + i) * 1.5;
      ctx.moveTo(bx + cx(ang + hp, 2), by + cy(ang + hp, 2)); ctx.lineTo(bx + cx(ang + hp, 6 + w), by + cy(ang + hp, 6 + w));
      ctx.moveTo(bx + cx(ang - hp, 2), by + cy(ang - hp, 2)); ctx.lineTo(bx + cx(ang - hp, 6 - w), by + cy(ang - hp, 6 - w));
    }
    ctx.stroke();
  }

  // ---------------------------------------------------------------- tentacles
  function linkGeometry(l, a) {
    const x1 = l.a1.rx(a), y1 = l.a1.ry(a), x2 = l.a2.rx(a), y2 = l.a2.ry(a);
    const dx = x2 - x1, dy = y2 - y1, dir = Math.atan2(dy, dx), dist = Math.hypot(dx, dy);
    const off = l.growing ? Math.min(SEG_STEP - 0.01, l.segInitOffset + 4 * a) : l.segInitOffset;
    const step = l.attached && l.maxPos > 0 ? (dist - off) / l.maxPos : SEG_STEP;
    const phase = l.wavePhase + WAVE_SPEED * a;
    const perp = dir + Math.PI / 2, cd = Math.cos(dir), sd = Math.sin(dir), cp = Math.cos(perp), sp = Math.sin(perp);
    const n = l.segs.length, pts = new Array(n);
    const place = (i, rev) => {
      const loc7 = i >= l.maxPos / 2 ? l.maxPos - i : i;
      const fade = Math.min(1, loc7 * WAVE_FADING);
      let base = off, sgn = 1;
      if (rev) { base += dist; sgn = -1; }
      const wv = Math.sin(phase + i * WAVE_FREQ) * WAVE_SIZE * fade;
      const along = sgn * i * step + base;
      return { x: x1 + cd * along + cp * wv, y: y1 + sd * along + sp * wv, f: fade };
    };
    if (!l.isCut) for (let i = 0; i < n; i++) pts[i] = place(i, false);
    else {
      for (let i = 0; i <= l.cutPos && i < n; i++) pts[i] = place(i, false);
      for (let i = Math.max(0, l.cutPos + 1); i < n; i++) pts[i] = place(n - i - 1, true);
    }
    return { x1, y1, x2, y2, dir, dist, off, pts, phase };
  }
  function drawBead(x, y, rot, r, fade, rgb, ph, isBlack) {
    const fill = isBlack ? [24, 24, 24] : rgb;
    const rim = isBlack ? [150, 150, 150] : mix(rgb, WHITE, 0.45);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    const cl = 1.5 + fade * 4.2;
    ctx.strokeStyle = rgba(rim, 0.55); ctx.lineWidth = 0.9;
    ctx.beginPath();
    const w = Math.sin(ph) * 0.5;
    ctx.moveTo(0, -r * 0.8); ctx.quadraticCurveTo(-cl * 0.2, -r - cl * 0.6, -cl * (0.5 + w * 0.4), -r - cl);
    ctx.moveTo(0, r * 0.8); ctx.quadraticCurveTo(-cl * 0.2, r + cl * 0.6, -cl * (0.5 - w * 0.4), r + cl);
    ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.82, 0, 0, TAU);
    ctx.fillStyle = rgba(fill, 0.95); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(rim, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-r * 0.25, -r * 0.25, r * 0.45, r * 0.25, 0, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
    ctx.restore();
  }
  function drawLink(l, t, a) {
    if (l.segs.length === 0 && !l.growing) return;
    const g = linkGeometry(l, a), pts = g.pts, n = pts.length;
    const rgb = teamRgb(l.orig.type);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(l.orig.type === T.BLACK ? [70, 70, 70] : rgb, 0.45); ctx.lineWidth = 3;
    if (!l.isCut) {
      if (n) {
        ctx.beginPath(); ctx.moveTo(g.x1, g.y1); for (let i = 0; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (l.attached) ctx.lineTo(g.x2, g.y2);
        ctx.stroke();
      }
    } else {
      const k = Math.min(l.cutPos, n - 1);
      if (k >= 0) { ctx.beginPath(); ctx.moveTo(g.x1, g.y1); for (let i = 0; i <= k; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); }
      if (k + 1 < n) { ctx.beginPath(); for (let i = k + 1; i < n; i++) i === k + 1 ? ctx.moveTo(pts[i].x, pts[i].y) : ctx.lineTo(pts[i].x, pts[i].y); ctx.lineTo(g.x2, g.y2); ctx.stroke(); }
    }
    let px = g.x1, py = g.y1;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const rot = Math.atan2(p.y - py, p.x - px) || g.dir;
      px = p.x; py = p.y;
      drawBead(p.x, p.y, rot, SEG_SIZE / 2, p.f, teamRgb(l.segs[i].col), g.phase + i * 0.9, l.segs[i].col === T.BLACK);
    }
    if (l.growing) {
      const s = (g.off * SEG_SIZE / SEG_STEP) / 2;
      if (s > 0.3) drawBead(g.x1, g.y1, g.dir, s, 0.2, rgb, g.phase, l.orig.type === T.BLACK);
    }
    const tt = (l.loadShiftCnt + a) / (l.shiftPeriod + 1);
    for (let i = 0; i < n; i++) {
      const s = l.segs[i]; if (!s.load) continue;
      const p = pts[i], q = i < n - 1 ? pts[i + 1] : { x: g.x2, y: g.y2 };
      const x = lerp(p.x, q.x, tt), y = lerp(p.y, q.y, tt);
      const prgb = teamRgb(s.col), big = s.load > 1, rr = big ? 9.5 : 7;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, rr);
      glow.addColorStop(0, big ? 'rgba(255,240,170,1)' : 'rgba(255,255,230,0.95)');
      glow.addColorStop(0.35, big ? 'rgba(255,200,80,0.85)' : rgba(mix(prgb, WHITE, 0.55), 0.8));
      glow.addColorStop(1, rgba(prgb, 0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
    }
    if (l.toxFx > 0 && n) {
      const p = pts[n - 1], k = l.toxFx / 10;
      ctx.fillStyle = `rgba(184,224,74,${0.8 * k})`;
      for (let j = 0; j < 4; j++) { const an = j * 1.7 + t * 3; ctx.beginPath(); ctx.arc(p.x + Math.cos(an) * (6 - 4 * k), p.y + Math.sin(an) * (6 - 4 * k), 1.6, 0, TAU); ctx.fill(); }
    }
    if (l.cutMark) {
      const m = l.cutMark, k = m.t / 12;
      ctx.strokeStyle = `rgba(255,255,170,${1 - k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(m.x, m.y, 4 + k * 14, 0, TAU); ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- microbes
  function membranePath(x, y, R, t, seed, spiky) {
    ctx.beginPath();
    const N = spiky ? 48 : 40;
    for (let i = 0; i <= N; i++) {
      const a = i / N * TAU;
      let rr = R + Math.sin(a * 3 + t * 1.3 + seed) * 0.7 + Math.sin(a * 5 - t * 0.9 + seed * 2) * 0.45;
      if (spiky) rr += (i % 2 ? 2.2 : -0.6) + Math.sin(t * 4 + i) * 0.5;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function drawOrnaments(c, x, y, R, t) {
    const evo = c.evo; if (evo === 0) return;
    const rgb = teamRgb(c.type);
    const orn = c.type === T.BLACK ? [90, 90, 90] : mix(rgb, WHITE, 0.25);
    const rim = c.type === T.BLACK ? [200, 200, 200] : mix(rgb, WHITE, 0.6);
    const spin = t * (0.15 + evo * 0.05) + c.seed;
    const pul = Math.sin(t * 3 + c.seed);
    ctx.save(); ctx.translate(x, y);
    for (let k = 0; k < 8; k++) {
      const an = k / 8 * TAU + (evo >= 4 ? spin : spin * 0.3);
      ctx.save(); ctx.rotate(an);
      const inner = 15.5, room = Math.max(3, R - inner);
      if (evo === 1) {
        const rr = 2 + 0.4 * Math.sin(t * 2.5 + k);
        ctx.beginPath(); ctx.arc(inner + room * 0.55, 0, rr, 0, TAU);
        ctx.fillStyle = rgba(orn, 0.9); ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = rgba(rim, 0.7); ctx.stroke();
      } else if (evo === 2 || evo === 3) {
        const len = room * (evo === 2 ? 0.55 : 0.75) * (0.8 + 0.2 * Math.sin(t * 4 + k * (evo === 2 ? 0 : 1.5)));
        ctx.beginPath(); ctx.moveTo(inner - 1, 0); ctx.lineTo(inner + len, 0);
        ctx.lineWidth = evo === 2 ? 2 : 2.4; ctx.strokeStyle = rgba(orn, 0.95); ctx.lineCap = 'round'; ctx.stroke();
        if (evo === 3) { ctx.beginPath(); ctx.arc(inner + len + 1.5, 0, 2.1, 0, TAU); ctx.fillStyle = rgba(rim, 0.85); ctx.fill(); }
      } else if (evo === 4) {
        const bend = 0.5 + 0.25 * Math.sin(t * 5 + k * 1.3);
        const L1 = room * 0.6 + 2, L2 = room * 0.5 + 4;
        ctx.beginPath(); ctx.moveTo(inner - 1, 0);
        const jx = inner + L1;
        ctx.lineTo(jx, 0); ctx.lineTo(jx + Math.cos(bend) * L2, Math.sin(bend) * L2);
        ctx.lineWidth = 1.8; ctx.strokeStyle = rgba(orn, 0.95); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.beginPath(); ctx.arc(jx, 0, 1.4, 0, TAU); ctx.fillStyle = rgba(rim, 0.9); ctx.fill();
      } else {
        const reach = R + 5 + 1.5 * pul;
        ctx.beginPath(); ctx.moveTo(inner, -2.2);
        ctx.quadraticCurveTo(R * 0.85, -4.5, reach, -1);
        ctx.quadraticCurveTo(R * 0.9, 0.5, inner, 2.2); ctx.closePath();
        ctx.fillStyle = rgba(orn, 0.95); ctx.fill(); ctx.lineWidth = 0.9; ctx.strokeStyle = rgba(rim, 0.9); ctx.stroke();
      }
      ctx.restore();
    }
    if (evo === 5) { ctx.beginPath(); ctx.arc(0, 0, 17.5, 0, TAU); ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.strokeStyle = rgba(rim, 0.6); ctx.stroke(); ctx.setLineDash([]); }
    ctx.restore();
  }
  function drawKindOuter(c, x, y, R, t) {
    const kc = KIND_RGB[c.kind];
    if (c.kind === K.AMP) {              // broadcast arcs outside the membrane
      for (let k = 0; k < 3; k++) {
        const ph = ((t * 0.9 + k / 3) % 1), rr = R + 3 + ph * 9;
        for (let s = 0; s < 3; s++) {
          const a0 = s * TAU / 3 + t * 0.4;
          ctx.beginPath(); ctx.arc(x, y, rr, a0 - 0.45, a0 + 0.45);
          ctx.lineWidth = 2; ctx.strokeStyle = rgba(kc, 0.75 * (1 - ph)); ctx.lineCap = 'round'; ctx.stroke();
        }
      }
    } else if (c.kind === K.SHELL) {     // bone plates on the membrane
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.12 + c.seed);
      for (let k = 0; k < 6; k++) {
        ctx.rotate(TAU / 6);
        ctx.beginPath();
        ctx.moveTo(R - 4, -6); ctx.lineTo(R + 3, -8.5); ctx.lineTo(R + 3, 8.5); ctx.lineTo(R - 4, 6); ctx.closePath();
        ctx.fillStyle = rgba(kc, 0.92); ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(40,34,24,0.9)'; ctx.stroke();
      }
      ctx.restore();
    } else if (c.kind === K.TOXIN) {     // rising bubbles
      for (let k = 0; k < 5; k++) {
        const ph = (t * 0.5 + k * 0.21 + c.seed) % 1, an = k * 1.3 + c.seed;
        const bx = x + Math.cos(an) * (R * 0.55), by = y + R * 0.6 - ph * R * 1.3;
        ctx.beginPath(); ctx.arc(bx, by, 1.6 + k % 2, 0, TAU);
        ctx.strokeStyle = rgba(kc, 0.75 * (1 - ph)); ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
  function drawKindCore(c, x, y, t) {
    const kc = KIND_RGB[c.kind];
    if (c.kind === K.AMP) {
      ctx.beginPath(); ctx.arc(x, y, 11.5, 0, TAU); ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(kc, 0.85); ctx.stroke();
    } else if (c.kind === K.LEECH) {     // inward teeth
      ctx.save(); ctx.translate(x, y); ctx.rotate(-t * 0.5);
      for (let k = 0; k < 6; k++) {
        ctx.rotate(TAU / 6);
        ctx.beginPath(); ctx.moveTo(15, -2.6); ctx.lineTo(10.5, 0); ctx.lineTo(15, 2.6); ctx.closePath();
        ctx.fillStyle = 'rgba(255,235,240,0.95)'; ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = rgba(kc, 0.95); ctx.stroke();
      }
      ctx.restore();
    }
  }
  function drawCell(c, t, a, hover, selected) {
    const x = lerp(c.px, c.x, a), y = lerp(c.py, c.y, a), R = c.radius();
    const rgb = teamRgb(c.type), isGrey = c.type === T.GREY, isBlack = c.type === T.BLACK;
    if (hover || selected) {
      const gl = ctx.createRadialGradient(x, y, R * 0.9, x, y, R + 12);
      gl.addColorStop(0, 'rgba(255,255,0,0.45)'); gl.addColorStop(1, 'rgba(255,255,0,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, R + 12, 0, TAU); ctx.fill();
    }
    if (c.flash > 0) {
      ctx.fillStyle = rgba(mix(rgb, WHITE, 0.6), c.flash * 0.5); ctx.beginPath(); ctx.arc(x, y, R + 8 * (1 - c.flash) + 4, 0, TAU); ctx.fill();
    }
    const toxin = c.kind === K.TOXIN;
    membranePath(x, y, R, t, c.seed, toxin);
    const mg = ctx.createRadialGradient(x, y, 12, x, y, R);
    const memTint = toxin ? mix(rgb, KIND_RGB[K.TOXIN], 0.6) : mix([136, 136, 136], rgb, 0.35);
    mg.addColorStop(0, 'rgba(136,136,136,0.10)');
    mg.addColorStop(0.75, rgba(memTint, toxin ? 0.32 : 0.24));
    mg.addColorStop(1, rgba(toxin ? memTint : mix([180, 190, 185], rgb, 0.3), 0.42));
    ctx.fillStyle = mg; ctx.fill();
    ctx.lineWidth = c.kind === K.SHELL ? 3 : 2; ctx.strokeStyle = toxin ? 'rgba(214,240,150,0.92)' : 'rgba(238,238,238,0.92)'; ctx.stroke();
    drawOrnaments(c, x, y, R, t);
    if (c.kind) drawKindOuter(c, x, y, R, t);
    const al = c.power >= MIN_ATTACK_POWER ? 1 : Math.max(0.3, c.power / MIN_ATTACK_POWER);
    ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU);
    const cg = ctx.createRadialGradient(x - 5, y - 6, 1, x, y, 15);
    cg.addColorStop(0, rgba(mix(rgb, WHITE, isBlack ? 0.22 : 0.42), al));
    cg.addColorStop(0.6, rgba(rgb, al)); cg.addColorStop(1, rgba(mix(rgb, BLACKC, 0.35), al));
    ctx.fillStyle = cg; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(238,238,238,0.95)'; ctx.stroke();
    if (c.kind) drawKindCore(c, x, y, t);
    if (isGrey && c.occPower > 0) {
      const need = Math.max(1, Math.trunc(c.power / c.lv.mod(c.occType).greyDiv));
      const k = clamp(c.occPower / need, 0, 1), orgb = teamRgb(c.occType);
      ctx.beginPath(); ctx.arc(x, y, R + 4, -Math.PI / 2, -Math.PI / 2 + k * TAU);
      ctx.lineWidth = 3; ctx.strokeStyle = rgba(mix(orgb, WHITE, 0.25), 0.95); ctx.lineCap = 'round'; ctx.stroke();
      const pr = 3 + k * 8 + Math.sin(t * 6) * 0.8;
      const pg = ctx.createRadialGradient(x, y, 0, x, y, pr);
      pg.addColorStop(0, rgba(mix(orgb, WHITE, 0.4), 0.9)); pg.addColorStop(1, rgba(orgb, 0.1));
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU); ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${c.power >= 100 ? 13 : 14}px ${FONT_DATA}`;
    if (isGrey) {
      ctx.fillStyle = 'rgba(30,30,30,0.85)'; ctx.fillText(String(c.power), x + 0.5, y - 1.5);
      ctx.fillStyle = 'rgba(245,245,225,0.75)'; ctx.fillText(String(c.power), x, y - 2);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(String(c.power), x + 0.6, y - 2.4);
      ctx.fillStyle = '#ffffff'; ctx.fillText(String(c.power), x, y - 3);
      const ml = c.maxLinks, st = 5, x0 = x - (ml * st) / 2 + st / 2;
      for (let i = 0; i < ml; i++) {
        ctx.beginPath(); ctx.arc(x0 + i * st, y + 7, 2.3, 0, TAU);
        ctx.fillStyle = i < c.linkCount ? '#000000' : '#aaaaaa'; ctx.fill();
        ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(238,238,238,0.9)'; ctx.stroke();
      }
    }
    for (const f of c.fx) {
      const k = (f.t + a) / 14; if (k >= 1) continue;
      ctx.beginPath(); ctx.arc(x, y, R + k * 16, 0, TAU);
      ctx.lineWidth = 2 * (1 - k) + 0.5; ctx.strokeStyle = rgba(mix(rgb, WHITE, 0.5), 0.7 * (1 - k)); ctx.stroke();
    }
  }
  function drawCellPath(c) {
    const m = c.motion; if (!m) return;
    ctx.save(); ctx.setLineDash([3, 6]); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(200,230,255,0.28)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(m.bx - m.mx, m.by - m.my); ctx.lineTo(m.bx + m.mx, m.by + m.my); ctx.stroke();
    ctx.setLineDash([]);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(m.bx + m.mx * s, m.by + m.my * s, 2.5, 0, TAU); ctx.fillStyle = 'rgba(200,230,255,0.35)'; ctx.fill(); }
    ctx.restore();
  }

  function arrowLine(x0, y0, x1, y1, col, width, head) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy); if (L < 2) return;
    ctx.lineCap = 'round'; ctx.strokeStyle = col; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    if (head) {
      const an = Math.atan2(dy, dx), h = Math.min(12, L * 0.4);
      ctx.moveTo(x1, y1); ctx.lineTo(x1 - Math.cos(an - 0.45) * h, y1 - Math.sin(an - 0.45) * h);
      ctx.moveTo(x1, y1); ctx.lineTo(x1 - Math.cos(an + 0.45) * h, y1 - Math.sin(an + 0.45) * h);
    }
    ctx.stroke();
  }
  function dashedArrow(x0, y0, x1, y1, t) {
    ctx.save();
    ctx.setLineDash([7, 6]); ctx.lineDashOffset = -t * 18;
    arrowLine(x0, y0, x1, y1, 'rgba(200,200,200,0.85)', 2.5, false);
    ctx.setLineDash([]);
    const an = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - Math.cos(an - 0.5) * 10, y1 - Math.sin(an - 0.5) * 10);
    ctx.moveTo(x1, y1); ctx.lineTo(x1 - Math.cos(an + 0.5) * 10, y1 - Math.sin(an + 0.5) * 10); ctx.stroke();
    ctx.restore();
  }
  function pill(x, y, text, fg, bg) {
    ctx.font = `600 11px ${FONT_DATA}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width + 12;
    ctx.fillStyle = bg || 'rgba(8,20,17,0.85)'; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - tw / 2, y - 9, tw, 18, 9); else ctx.rect(x - tw / 2, y - 9, tw, 18);
    ctx.fill(); ctx.fillStyle = fg; ctx.fillText(text, x, y + 0.5);
  }

  // whole level: links under walls under cells
  function drawLevel(lv, t, a, opts = {}) {
    for (const c of lv.cells) if (c.motion) drawCellPath(c);
    for (const l of lv.links) drawLink(l, t, a);
    for (const f of lv.fences) drawFence(f, a);
    for (const c of lv.cells) drawCell(c, t, a, opts.hover === c, opts.selected === c);
  }

  function init(canvas) { cv = canvas; ctx = cv.getContext('2d'); }
  function resize(stage) {
    const vw = window.innerWidth, vh = window.innerHeight;
    scale = Math.min(vw / W, vh / H);
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    stage.style.transform = `translate(${Math.round((vw - W * scale) / 2)}px,${Math.round((vh - H * scale) / 2)}px) scale(${scale})`;
    const pw = Math.round(W * scale * dpr), ph = Math.round(H * scale * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
  }
  function begin() { ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0); ctx.imageSmoothingEnabled = true; }

  CT.R = {
    TEAM, KIND_RGB, FONT_DATA, TAU, rgba, mix, teamRgb,
    init, resize, begin, get ctx() { return ctx; }, get scale() { return scale; },
    paintFieldBg, paintMenuBg, drawFence, drawLink, drawCell, drawCellPath, drawLevel, arrowLine, dashedArrow, pill,
  };
})(window.CT);
