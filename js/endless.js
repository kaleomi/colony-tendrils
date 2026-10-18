'use strict';
// Endless evolution: procedurally generated dishes, mutations between depths.
(function (CT) {
  const { T, K, rng, clamp, intersect, MUTATIONS, ENEMY_MUTATIONS, DEFAULT_MODS } = CT;
  const FOES = [T.RED, T.BLACK, T.PURPLE];
  const byId = Object.fromEntries(MUTATIONS.map(m => [m.id, m]));

  function newRun(seed) {
    return { seed: seed >>> 0, depth: 1, perks: {}, enemyPerks: {}, startBonus: 0, totalTime: 0, lastEnemyPerk: null };
  }
  function buildMods(perks) {
    const m = Object.assign({}, DEFAULT_MODS);
    for (const [id, n] of Object.entries(perks)) { const mu = byId[id]; if (mu && mu.mod) for (let i = 0; i < n; i++) mu.mod(m); }
    return m;
  }
  function applyPerk(run, id) {
    run.perks[id] = (run.perks[id] || 0) + 1;
    const mu = byId[id]; if (mu && mu.run) mu.run(run);
  }
  function offer(run) {
    const r = rng(run.seed ^ (run.depth * 2654435761));
    const pool = MUTATIONS.filter(m => (run.perks[m.id] || 0) < m.max);
    const out = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    return out;
  }
  // from depth 5, every 3rd depth the enemies evolve too
  function enemyEvolve(run) {
    if (run.depth < 5 || (run.depth - 5) % 3 !== 0) { run.lastEnemyPerk = null; return null; }
    const r = rng(run.seed + run.depth * 977);
    const pool = ENEMY_MUTATIONS.filter(id => (run.enemyPerks[id] || 0) < 3);
    if (!pool.length) return null;
    const id = pool[Math.floor(r() * pool.length)];
    run.enemyPerks[id] = (run.enemyPerks[id] || 0) + 1;
    run.lastEnemyPerk = id;
    return byId[id];
  }

  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
    const k = clamp(((px - x1) * dx + (py - y1) * dy) / L2, 0, 1);
    return Math.hypot(px - (x1 + dx * k), py - (y1 + dy * k));
  }

  function generate(run) {
    const d = run.depth, r = rng((run.seed * 7919 + d * 104729) >>> 0);
    const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    const pick = arr => arr[Math.floor(r() * arr.length)];
    // ---- factions
    let foes = [T.RED];
    if (d >= 4 && d < 5) foes = r() < 0.5 ? [T.RED] : [T.RED, T.BLACK];
    if (d >= 5) { const pool = FOES.slice(); foes = [pool.splice(Math.floor(r() * pool.length), 1)[0], pool.splice(Math.floor(r() * pool.length), 1)[0]]; }
    if (d >= 9 && r() < 0.5) foes = FOES.slice();
    if (d >= 6 && !foes.includes(T.PURPLE) && r() < 0.5) foes[0] = T.PURPLE;
    // ---- positions (rejection sampling)
    const nCells = clamp(6 + Math.floor(d * 0.6), 6, 17);
    const pts = [];
    let minD = 100;
    for (let tries = 0; pts.length < nCells && tries < 4000; tries++) {
      if (tries % 600 === 599) minD -= 6;
      const p = { x: ri(55, 585), y: ri(62, 412) };
      if (pts.every(q => Math.hypot(q.x - p.x, q.y - p.y) >= minD)) pts.push(p);
    }
    // player side: pick a random edge anchor, nearest points are the player's
    const anchors = [{ x: 40, y: 240 }, { x: 600, y: 240 }, { x: 320, y: 40 }, { x: 320, y: 440 }, { x: 60, y: 60 }, { x: 580, y: 420 }];
    const A = pick(anchors);
    pts.sort((p, q) => Math.hypot(p.x - A.x, p.y - A.y) - Math.hypot(q.x - A.x, q.y - A.y));
    const nPlayer = d >= 5 ? 2 : 1;
    const nFoe = clamp(1 + Math.floor(d / 2.5), 1, 8);
    const cells = [];
    const maxPower = Math.min(200, 100 + d * 6);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const fromEnd = pts.length - 1 - i;
      let type = T.GREY, power, kind = 0;
      if (i < nPlayer) { type = T.GREEN; power = (i === 0 ? 45 : 25) + run.startBonus; }
      else if (fromEnd < nFoe) { type = foes[fromEnd % foes.length]; power = Math.min(160, 8 + d * 6 + ri(0, 12)); }
      else power = 5 * ri(2, 4 + Math.min(10, Math.floor(d / 1.5)));
      if (type === T.GREY && d >= 3 && r() < Math.min(0.45, 0.18 + d * 0.025)) kind = pick([K.AMP, K.SHELL, K.TOXIN, K.LEECH]);
      if (type !== T.GREY && type !== T.GREEN && d >= 5 && r() < 0.25) kind = pick([K.SHELL, K.LEECH]);
      cells.push({ type, power: Math.min(power, maxPower), x: p.x, y: p.y, kind, mx: 0, my: 0, period: 0, phase: 0 });
    }
    // ---- drifting neutrals
    const fences = [];
    const nDrift = d >= 9 ? 2 : d >= 5 ? (r() < 0.6 ? 1 : 0) : 0;
    for (let k = 0, tries = 0; k < nDrift && tries < 40; tries++) {
      const c = pick(cells.filter(c => c.type === T.GREY && !c.period)); if (!c) break;
      const an = r() * Math.PI, amp = ri(55, 90), mx = Math.cos(an) * amp, my = Math.sin(an) * amp;
      let ok = true;
      for (let s = -1; s <= 1.001 && ok; s += 0.25) {
        const x = c.x + mx * s, y = c.y + my * s;
        if (x < 45 || x > 595 || y < 55 || y > 420) ok = false;
        for (const o of cells) if (o !== c && Math.hypot(o.x - x, o.y - y) < 78) ok = false;
      }
      if (ok) { c.mx = Math.round(mx); c.my = Math.round(my); c.period = ri(26, 40) * 10; k++; }
    }
    // ---- walls (some moving)
    const nWalls = d >= 4 ? (d >= 8 ? ri(2, 3) : ri(1, 2)) : 0;
    for (let k = 0, tries = 0; k < nWalls && tries < 300; tries++) {
      const cx = ri(110, 530), cy = ri(90, 390), an = r() * Math.PI, half = ri(45, 75);
      const w = { x1: Math.round(cx - Math.cos(an) * half), y1: Math.round(cy - Math.sin(an) * half), x2: Math.round(cx + Math.cos(an) * half), y2: Math.round(cy + Math.sin(an) * half), mx: 0, my: 0, period: 0, phase: 0 };
      const moving = d >= 6 && r() < 0.45;
      if (moving) { const ma = an + Math.PI / 2, amp = ri(50, 90); w.mx = Math.round(Math.cos(ma) * amp); w.my = Math.round(Math.sin(ma) * amp); w.period = ri(20, 32) * 10; w.phase = r() * 6; }
      let ok = true;
      for (let s = moving ? -1 : 0; s <= (moving ? 1.001 : 0) && ok; s += 0.25) {
        const x1 = w.x1 + w.mx * s, y1 = w.y1 + w.my * s, x2 = w.x2 + w.mx * s, y2 = w.y2 + w.my * s;
        if (Math.min(x1, x2) < 15 || Math.max(x1, x2) > 625 || Math.min(y1, y2) < 30 || Math.max(y1, y2) > 445) ok = false;
        for (const c of cells) {
          const reach = c.period ? Math.hypot(c.mx, c.my) : 0;
          if (distToSeg(c.x, c.y, x1, y1, x2, y2) < 48 + reach) ok = false;
        }
        for (const f of fences) if (intersect(x1, y1, x2, y2, f.x1, f.y1, f.x2, f.y2) || distToSeg((x1 + x2) / 2, (y1 + y2) / 2, f.x1, f.y1, f.x2, f.y2) < 30) ok = false;
      }
      if (ok) { fences.push(w); k++; }
    }
    // ---- difficulty knobs
    const enemyMods = buildMods(run.enemyPerks);
    enemyMods.growMul *= Math.max(0.55, 1 - d * 0.03);
    if (d >= 6) enemyMods.atkMul *= Math.max(0.65, 1 - (d - 5) * 0.03);
    const playerMods = buildMods(run.perks);
    return {
      name: `第 ${d} 层`, maxPower, cpuTurn: Math.max(25, 100 - d * 5), cpuActions: d >= 11 ? 3 : d >= 6 ? 2 : 1, hint: null, cells, fences,
      mods: { [T.GREEN]: playerMods, [T.RED]: enemyMods, [T.BLACK]: enemyMods, [T.PURPLE]: enemyMods },
    };
  }

  CT.Endless = { newRun, offer, applyPerk, enemyEvolve, generate, byId };
})(window.CT);
