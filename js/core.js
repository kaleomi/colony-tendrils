'use strict';
// =====================================================================
//  Simulation core — a line-by-line port of the 2011 original
//  (Cell / Link / Level / Main), extended with per-team modifiers,
//  special microbe kinds, drifting cells and moving walls.
//  With default modifiers and no special kinds, behaviour is identical
//  to the original game.
// =====================================================================
window.CT = window.CT || {};
(function (CT) {
  const W = 640, H = 480;
  const TICK_MS = 50;                       // original ran at 20 fps; every timer counts frames
  const T = { GREY: 1, RED: 2, GREEN: 3, BLACK: 4, PURPLE: 5 };
  const USER = T.GREEN;
  const K = { NORMAL: 0, AMP: 1, SHELL: 2, TOXIN: 3, LEECH: 4 };
  // EvoInfo(upgradePower, upgradeType, downgradePower, downgradeType, growPeriod, attackPeriod, name, maxLinks)
  const EVO = [
    { up: 15,  upT: 1, down: -1,  downT: 0, grow: 40,  atk: 30, name: '孢子',     links: 1 },
    { up: 40,  upT: 2, down: 5,   downT: 0, grow: 45,  atk: 20, name: '胚胎',     links: 2 },
    { up: 80,  upT: 3, down: 30,  downT: 1, grow: 50,  atk: 15, name: '脉冲星-A', links: 2 },
    { up: 120, upT: 4, down: 60,  downT: 2, grow: 60,  atk: 10, name: '脉冲星-B', links: 2 },
    { up: 160, upT: 5, down: 100, downT: 3, grow: 80,  atk: 5,  name: '蚁',       links: 3 },
    { up: 210, upT: 5, down: 140, downT: 4, grow: 100, atk: 2,  name: '掠食者',   links: 3 },
  ];
  const SEG_SIZE = 7, SEG_INTERVAL = 4, SEG_STEP = SEG_SIZE + SEG_INTERVAL;
  const MIN_RADIUS = 18, MIN_ATTACK_POWER = 5, MIN_PANIC_POWER = 5, GREY_GIVE_UP_DIV = 3, MAX_POWER_CREDIT = 0;
  const WAVE_FREQ = 0.5, WAVE_SIZE = 5, WAVE_FADING = 0.4, WAVE_SPEED = 0.2;
  const GAMEOVER_CHECK_PERIOD = 20;
  const TOXIN_PERIOD = 20;                  // a toxin dissolves one hostile segment every 21 ticks
  const DEFAULT_MODS = Object.freeze({
    growMul: 1, atkMul: 1, segCost: 1, cutMul: 1, armor: 1, greyDiv: GREY_GIVE_UP_DIV,
    captureBonus: 0, linkBonus: 0, feedMul: 1, leech: 0, fastPackets: false, maxMul: 1,
  });

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // Segment intersection exactly as in Level.getIntersection (open interval on both segments)
  function intersect(p1, p2, p3, p4, p5, p6, p7, p8) {
    const d = (p4 - p2) * (p5 - p7) - (p6 - p8) * (p3 - p1);
    if (d === 0) return null;
    const ua = ((p4 - p2) * (p5 - p1) - (p6 - p2) * (p3 - p1)) / d;
    const ub = ((p6 - p2) * (p5 - p7) - (p6 - p8) * (p5 - p1)) / d;
    if (!(ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1)) return null;
    if (ua === 0 || ua === 1 || ub === 0 || ub === 1) return null;
    return { x: p1 + (p3 - p1) * ub, y: p2 + (p4 - p2) * ub };
  }

  // ---------------------------------------------------------------- anchors
  class Anchor {           // a fixed point on a cell's membrane, 36 buckets of 10°
    constructor(cell, idx) { this.cell = cell; this.idx = idx; this.ang = idx * 10 * Math.PI / 180; }
    get x() { return this.cell.x + Math.cos(this.ang) * this.cell.radius(); }
    get y() { return this.cell.y + Math.sin(this.ang) * this.cell.radius(); }
    rx(a) { return lerp(this.cell.px, this.cell.x, a) + Math.cos(this.ang) * this.cell.radius(); }
    ry(a) { return lerp(this.cell.py, this.cell.y, a) + Math.sin(this.ang) * this.cell.radius(); }
  }
  class FreeAnchor {       // the meeting point of two opposing tentacles
    constructor(x, y) { this.x = this.px = x; this.y = this.py = y; }
    rx(a) { return lerp(this.px, this.x, a); }
    ry(a) { return lerp(this.py, this.y, a); }
  }

  // ---------------------------------------------------------------- cell
  class Cell {
    constructor(lv, spec, maxPower) {
      this.lv = lv; this.type = spec.type; this.kind = spec.kind || K.NORMAL;
      this.baseMax = maxPower; this.power = Math.min(spec.power, this.maxPower);
      this.x = this.px = spec.x; this.y = this.py = spec.y; this.dx = 0; this.dy = 0;
      this.motion = spec.period > 0 ? { bx: spec.x, by: spec.y, mx: spec.mx || 0, my: spec.my || 0, period: spec.period, phase: spec.phase || 0 } : null;
      this.evo = 0; this.growPeriod = 20; this.attackPeriod = 20;
      this.cellGrowCnt = 0; this.linkGrowCnt = 0; this.sendAttackCnt = 0; this.cellGrowSlower = 0; this.powerCredit = 0;
      this.occType = T.GREY; this.occPower = 0;
      this.costAcc = 0; this.dmgAcc = 0; this.leechAcc = 0;
      this.links = []; this.anchors = [];
      this.suspended = false;
      this.seed = (spec.x * 7.13 + spec.y * 3.71) % 100; this.fx = []; this.flash = 0;
      while (this.updateEvolution());
      this.fx.length = 0;
    }
    get mod() { return this.lv.mod(this.type); }
    get maxPower() { const m = this.mod.maxMul; return m === 1 ? this.baseMax : Math.round(this.baseMax * m); }
    radius() { return MIN_RADIUS + this.power / 10; }
    get maxLinks() { return EVO[this.evo].links + this.mod.linkBonus; }
    get linkCount() { return this.links.length; }
    defense() { return this.type !== T.GREY ? this.power : Math.trunc(this.power / GREY_GIVE_UP_DIV - this.occPower); }
    burst() { this.fx.push({ t: 0 }); }
    angleTo(c) { return Math.atan2(c.y - this.y, c.x - this.x) * 180 / Math.PI; }
    push(deg, amt = 1) { if (this.motion) return; const a = deg * Math.PI / 180; this.dx += Math.cos(a) * amt; this.dy += Math.sin(a) * amt; }
    getAnchor(target) {
      let ang = Math.atan2(target.y - this.y, target.x - this.x) * 180 / Math.PI;
      if (ang < 0) ang = 360 + ang;
      const idx = Math.trunc(ang / 10) % 36;
      return this.anchors[idx] || (this.anchors[idx] = new Anchor(this, idx));
    }
    updateEvolution() {
      const prev = this.evo; let info = EVO[this.evo];
      if (this.power >= info.up) this.evo = info.upT;
      else if (this.power <= info.down) this.evo = info.downT;
      info = EVO[this.evo];
      const m = this.mod;
      this.growPeriod = m.growMul === 1 ? info.grow : Math.max(1, Math.round(info.grow * m.growMul));
      this.attackPeriod = m.atkMul === 1 ? info.atk : Math.max(1, Math.round(info.atk * m.atkMul));
      if (prev !== this.evo) { this.burst(); return true; }
      return false;
    }
    updateView() { this.updateEvolution(); }
    addLink(l) { this.links.push(l); this.burst(); this.updateView(); }
    removeLink(l) { const i = this.links.indexOf(l); if (i >= 0) this.links.splice(i, 1); this.updateView(); }
    growPower(n = 1) {
      if (this.powerCredit > 0) {
        this.powerCredit -= n;
        if (this.powerCredit < 0) { this.power -= this.powerCredit; this.powerCredit = 0; }
      } else this.power += n;            // the original always received n = 1 here
      if (this.power > this.maxPower) this.power = this.maxPower;
      this.updateView();
    }
    armorFactor() { return this.mod.armor * (this.kind === K.SHELL ? 0.5 : 1); }
    receive(att, amt) {          // Cell._-l : a packet / segment arrives
      if (amt <= 0) return;
      let captured = false;
      if (att === this.type) this.growPower(amt);
      else {
        const f = this.armorFactor();
        if (f !== 1) {
          this.dmgAcc += amt * f; amt = Math.floor(this.dmgAcc + 1e-9); this.dmgAcc -= amt;
          if (amt <= 0) { this.flash = Math.max(this.flash, 0.25); return; }
        }
        if (this.type !== T.GREY) {
          this.power -= amt;
          if (this.power <= 0) { this.power = 10; captured = true; }
        } else {
          this.occPower += (this.occType !== att ? -amt : amt);
          if (this.occPower < 0) { this.occType = att; this.occPower = -this.occPower; }
          const need = Math.trunc(this.power / this.lv.mod(att).greyDiv);
          if (this.occPower >= need) { if (this.power < 10) this.power = 10; captured = true; }
        }
      }
      if (captured) {
        const was = this.type;
        this.type = att; this.evo = 0; this.dmgAcc = 0; this.costAcc = 0;
        const bonus = this.lv.mod(att).captureBonus;
        if (bonus) this.power = Math.min(this.maxPower, this.power + bonus);
        while (this.updateEvolution());
        this.cutAllLinks(); this.burst(); this.flash = 1;
        this.lv.onCaptured(this, was, att);
      }
      this.updateView();
    }
    cutAllLinks() { const a = this.links.slice(); while (a.length) a.pop().cutFrac(1); }
    sendAttack() {
      let cnt = 0;
      for (let i = 0; i < this.links.length; i++) {
        if (this.power < MIN_ATTACK_POWER) break;
        const l = this.links[i];
        if (l.attached && l.sendAttack(1)) cnt++;
      }
      if (this.power < 0) this.power = 0;
      this.cellGrowSlower = cnt * 2;
    }
    growLinks() {
      let changed = false;
      const segCost = this.mod.segCost;
      for (let i = 0; i < this.links.length; i++) {
        const l = this.links[i];
        if (l.growing) continue;
        if (l.tryAddSeg()) {
          let pay = 1;
          if (segCost !== 1) { this.costAcc += segCost; pay = Math.floor(this.costAcc + 1e-9); this.costAcc -= pay; }
          for (let k = 0; k < pay; k++) { if (this.power > 0) this.power--; else this.powerCredit++; }
          l.pendingPaid = pay; changed = true;
        }
        if (!l.attached && this.powerCredit > MAX_POWER_CREDIT) { l.cutFrac(1); this.burst(); }
      }
      if (changed) this.updateView();
    }
    suspend() { if (this.suspended) return; this.suspended = true; this.cutAllLinks(); }
    tick() {
      this.px = this.x; this.py = this.y;
      if (this.motion) {
        const m = this.motion, s = Math.sin(this.lv.tickN / m.period * Math.PI * 2 + m.phase);
        this.x = m.bx + m.mx * s; this.y = m.by + m.my * s; this.dx = this.dy = 0;
      } else { this.dx *= 0.6; this.dy *= 0.6; this.x += this.dx; this.y += this.dy; }
      for (const f of this.fx) f.t += 1;
      if (this.fx.length && this.fx[0].t > 14) this.fx.shift();
      if (this.flash > 0) this.flash = Math.max(0, this.flash - 0.05);
      if (this.suspended) return;
      if (this.type !== T.GREY && this.kind !== K.AMP) this.cellGrowCnt++;
      const period = this.cellGrowSlower > 0 ? this.growPeriod * this.cellGrowSlower : this.growPeriod;
      if (this.cellGrowCnt > period) { this.cellGrowCnt = 0; this.growPower(); }
      if (++this.linkGrowCnt > 2) { this.linkGrowCnt = 0; this.growLinks(); }
      if (++this.sendAttackCnt > this.attackPeriod) { this.sendAttackCnt = 0; this.sendAttack(); }
    }
  }

  // ---------------------------------------------------------------- link (tentacle)
  class Link {
    constructor(lv, orig, dest) {
      this.lv = lv; this.orig = orig; this.dest = dest;
      this.segInitOffset = 0; this.growing = false; this.wavePhase = 0; this.segs = [];
      this.loadShiftCnt = 0; this.allowGrow = true; this.attached = false; this.isCut = false; this.cutPos = -1;
      this.maxPos = 0; this.newMaxPos = 0; this.dead = false; this.pendingPaid = 1; this.cutAcc = 0;
      this.toxCnt = 0; this.toxFx = 0;
      this.splitLink = null; this.splitAnchor = null; this.splitDest = null; this.splitDestDir = 0; this.splitDestDist = 0;
      this.a1 = orig.getAnchor(dest); this.a2 = dest.getAnchor(orig);
      this.onAnchorUpdate();
      orig.addLink(this);
      lv.emit('grow', this);
    }
    get shiftPeriod() { return this.lv.mod(this.orig.type).fastPackets ? 0 : 1; }
    updateAnchors() {
      this.x1 = this.a1.x; this.y1 = this.a1.y; this.x2 = this.a2.x; this.y2 = this.a2.y;
      const dx = this.x2 - this.x1, dy = this.y2 - this.y1;
      this.dir = Math.atan2(dy, dx); this.dist = Math.sqrt(dx * dx + dy * dy);
      this.newMaxPos = Math.trunc(this.dist / SEG_STEP);
      if (this.newMaxPos < 5) this.newMaxPos += 1;
      this.updateView();
    }
    onAnchorUpdate() {
      this.updateAnchors();
      if (this.splitAnchor) {
        const dx = this.splitDest.x - this.a1.x, dy = this.splitDest.y - this.a1.y;
        this.splitDestDir = Math.atan2(dy, dx); this.splitDestDist = Math.sqrt(dx * dx + dy * dy);
      }
    }
    updateView() { this.segStep = this.attached ? (this.dist - this.segInitOffset) / this.maxPos : SEG_STEP; }
    get power() { return this.segs.length; }
    tipLength() { return this.segs.length * this.segStep + this.segInitOffset; }
    tryAddSeg() {
      if (this.allowGrow && !this.isCut && !this.growing) { this.growing = true; this.segInitOffset = 0; return true; }
      return false;
    }
    doSegGrowing() {
      this.segInitOffset += 4;
      if (this.segInitOffset >= SEG_STEP) {
        this.segs.unshift({ load: 0, col: this.orig.type, paid: this.pendingPaid });
        this.growing = false; this.segInitOffset = 0; this.maxPos = this.newMaxPos;
      }
    }
    deliver(load) {               // the last segment hands a packet to the destination
      const o = this.orig, d = this.dest, m = this.lv.mod(o.type);
      if (d.type === o.type) { d.receive(o.type, load * m.feedMul); return; }
      d.receive(o.type, load);
      const lr = (o.kind === K.LEECH ? 0.5 : 0) + m.leech;
      if (lr > 0 && o.type !== T.GREY) {
        o.leechAcc += lr; const g = Math.floor(o.leechAcc + 1e-9);
        if (g > 0) { o.leechAcc -= g; o.growPower(g); }
      }
    }
    doAttackLoadShift() {
      for (let i = this.segs.length - 1; i >= 0; i--) {
        const s = this.segs[i]; if (!s) continue;
        const load = s.load, col = s.col;
        if (load > 0) {
          s.load = 0;
          if (i < this.segs.length - 1) { const n = this.segs[i + 1]; n.load = load; n.col = col; }
          else this.deliver(load);
        }
      }
    }
    sendAttack(n) {
      const s = this.segs[0]; if (!s) return false;
      s.col = this.orig.type;
      if (this.dest && this.attached) { s.load = n * (this.orig.kind === K.AMP ? 2 : 1); return true; }
      return false;
    }
    beginCut() { this.orig.removeLink(this); this.isCut = true; }
    endCut() {
      this.attached = false;
      if (this.splitLink) { this.splitLink.setSplit(null); this.setSplit(null); }
    }
    cutFrac(f) {                 // Link._-0K
      if (this.isCut) return;
      this.beginCut();
      f = clamp(f, 0, 1);
      if (this.attached && !this.splitLink) this.cutPos = Math.round(this.dist * f / this.segStep);
      else this.cutPos = this.maxPos;
      this.endCut();
    }
    cutAt(px, py, by) {          // Link._-0z : swipe (or a moving wall)
      if (this.isCut) return;
      this.beginCut();
      if (this.attached && !this.splitLink) this.cutPos = Math.round(Math.hypot(px - this.x1, py - this.y1) / this.segStep);
      else this.cutPos = this.maxPos;
      this.endCut();
      this.cutMark = { x: px, y: py, t: 0 };
      this.lv.emit('cut', this, by);
    }
    doCutTick() {
      if (this.isCut && this.segs.length > 0) {
        if (this.cutPos >= 0) { const s = this.segs.shift(); this.orig.receive(this.orig.type, s.paid); this.cutPos--; }
        if (this.cutPos + 1 < this.segs.length) {
          this.segs.pop();
          const cm = this.lv.mod(this.orig.type).cutMul;
          if (cm !== 1 && this.dest.type !== this.orig.type) {
            this.cutAcc += cm; const d = Math.floor(this.cutAcc + 1e-9); this.cutAcc -= d;
            if (d > 0) this.dest.receive(this.orig.type, d);
          } else this.dest.receive(this.orig.type, 1);
        }
      }
      if (this.segs.length === 0) this.destruct();
    }
    destruct() {
      this.dead = true;
      const i = this.lv.links.indexOf(this); if (i >= 0) this.lv.links.splice(i, 1);
      const j = this.lv.freeAnchors.indexOf(this.splitAnchor); if (j >= 0) this.lv.freeAnchors.splice(j, 1);
      this.segs.length = 0;
    }
    setSplit(other) {            // Link.if()
      this.splitLink = other;
      if (other) { other.splitLink = this; this.setSplitAnchor(other.createSplitAnchor()); }
      else {
        this.attached = false;
        if (this.splitDest) this.a2 = this.splitDest;
        const j = this.lv.freeAnchors.indexOf(this.splitAnchor); if (j >= 0) this.lv.freeAnchors.splice(j, 1);
        this.splitAnchor = null;
        this.onAnchorUpdate();
      }
    }
    createSplitAnchor() {
      this.splitAnchor = new FreeAnchor(this.a1.x, this.a1.y); this.lv.freeAnchors.push(this.splitAnchor);
      this.splitDest = this.a2; this.a2 = this.splitAnchor;
      this.onAnchorUpdate();
      return this.splitAnchor;
    }
    setSplitAnchor(a) { this.splitDest = this.a2; this.a2 = a; this.onAnchorUpdate(); }
    updateSplitAnchor() {
      const dx = this.splitDest.x - this.a1.x, dy = this.splitDest.y - this.a1.y;
      let x, y;
      if (!this.attached) {
        const len = this.segs.length * this.segStep + this.segInitOffset;
        x = this.x1 + Math.cos(this.splitDestDir) * len; y = this.y1 + Math.sin(this.splitDestDir) * len;
        if (len >= this.splitDestDist / 2 && !this.isCut) this.attached = true;
      } else { x = this.x1 + dx / 2; y = this.y1 + dy / 2; }
      this.splitAnchor.x = x; this.splitAnchor.y = y;
      this.onAnchorUpdate(); if (this.splitLink) this.splitLink.onAnchorUpdate();
    }
    tick() {
      this.onAnchorUpdate();
      if (this.cutMark) { this.cutMark.t++; if (this.cutMark.t > 12) this.cutMark = null; }
      if (this.toxFx > 0) this.toxFx--;
      this.wavePhase += WAVE_SPEED;
      if (++this.loadShiftCnt > this.shiftPeriod) { this.loadShiftCnt = 0; this.doAttackLoadShift(); if (this.dead) return; }
      if (this.growing) this.doSegGrowing();
      if (this.splitAnchor) this.updateSplitAnchor();
      if (!this.splitAnchor || this.attached) this.allowGrow = this.segs.length <= this.newMaxPos;
      if (this.isCut) { this.doCutTick(); if (this.dead) return; }
      while (this.segs.length > this.newMaxPos + 1) {
        const s = this.segs.pop(); this.orig.receive(this.orig.type, s.paid); this.maxPos = this.newMaxPos;
      }
      this.updateView();
      if (!this.attached && !this.isCut && this.segs.length >= this.newMaxPos + 1 && this.splitAnchor == null) {
        this.attached = true;
        this.lv.emit('attached', this);
      }
    }
  }

  // ---------------------------------------------------------------- wall
  class Fence {
    constructor(spec) {
      this.x1 = this.px1 = spec.x1; this.y1 = this.py1 = spec.y1; this.x2 = this.px2 = spec.x2; this.y2 = this.py2 = spec.y2;
      this.phase = (spec.x1 + spec.y2) % 6;
      this.motion = spec.period > 0 ? { bx1: spec.x1, by1: spec.y1, bx2: spec.x2, by2: spec.y2, mx: spec.mx || 0, my: spec.my || 0, period: spec.period, ph: spec.phase || 0 } : null;
    }
    move(tickN) {
      this.px1 = this.x1; this.py1 = this.y1; this.px2 = this.x2; this.py2 = this.y2;
      const m = this.motion; if (!m) return;
      const s = Math.sin(tickN / m.period * Math.PI * 2 + m.ph);
      this.x1 = m.bx1 + m.mx * s; this.y1 = m.by1 + m.my * s; this.x2 = m.bx2 + m.mx * s; this.y2 = m.by2 + m.my * s;
    }
  }

  // ---------------------------------------------------------------- level definitions
  // spec: { maxPower, cpuTurn, hint, cells:[{type,power,x,y,kind,mx,my,period,phase}], fences:[{x1,y1,x2,y2,mx,my,period,phase}], mods:{[type]:partial} }
  function cellSpec(a) { return { type: a[0], power: a[1], x: a[2], y: a[3], kind: a[4] || 0, mx: a[5] || 0, my: a[6] || 0, period: a[7] || 0, phase: a[8] || 0 }; }
  function fenceSpec(a) { return { x1: a[0], y1: a[1], x2: a[2], y2: a[3], mx: a[4] || 0, my: a[5] || 0, period: a[6] || 0, phase: a[7] || 0 }; }
  function defFromArray(arr, hintText) {
    return { maxPower: arr[0], cpuTurn: arr[1], hint: hintText || null, cells: arr[3].map(cellSpec), fences: arr[4].map(fenceSpec) };
  }

  // ---------------------------------------------------------------- level
  class Level {
    constructor(def, listener) {
      this.def = def; this.listener = listener || null;
      this.maxPower = def.maxPower; this.cpuTurnPeriod = def.cpuTurn; this.hint = def.hint || null;
      this.mods = {};
      for (const t of [1, 2, 3, 4, 5]) this.mods[t] = Object.assign({}, DEFAULT_MODS, (def.mods && def.mods[t]) || {});
      this.cells = []; this.links = []; this.fences = []; this.freeAnchors = [];
      this.tickN = 0;
      for (const c of def.cells) this.cells.push(new Cell(this, c, this.maxPower));
      for (const f of def.fences) this.fences.push(new Fence(f));
      this.hasMovingFences = this.fences.some(f => f.motion);
      this.hasToxins = this.cells.some(c => c.kind === K.TOXIN);
      this.cpuTurnCnt = 0; this.gameOverCheckCnt = 0; this.correctCnt = 0; this.time = 0;
      this.suspended = false; this.stats = { cuts: 0, captured: 0, lost: 0 };
    }
    mod(type) { return this.mods[type] || DEFAULT_MODS; }
    emit(ev, a, b, c) { if (this.listener && this.listener[ev]) this.listener[ev](a, b, c, this); }
    onCaptured(cell, was, now) {
      if (now === USER) this.stats.captured++;
      if (was === USER) this.stats.lost++;
      this.emit('captured', cell, was, now);
    }
    // ---- queries
    getLink(a, b) { for (const l of this.links) if (l.orig === a && l.dest === b && !l.isCut) return l; return null; }
    blocked(a, b) {
      const R = 10;
      for (const f of this.fences) {
        const ang = Math.atan2(f.y2 - f.y1, f.x2 - f.x1);
        const x1 = f.x1 - Math.cos(ang) * R, y1 = f.y1 - Math.sin(ang) * R, x2 = f.x2 + Math.cos(ang) * R, y2 = f.y2 + Math.sin(ang) * R;
        if (intersect(a.x, a.y, b.x, b.y, x1, y1, x2, y2)) return true;
      }
      return false;
    }
    totalPower(type) { let s = 0; for (const c of this.cells) if (c.type === type) s += c.power; return s; }
    phase() {                    // 0 in progress, 1 passed, 2 failed
      let other = -1, hasUser = false, mixed = false;
      for (const c of this.cells) {
        if (c.type === USER) hasUser = true;
        if (c.type !== other && c.type !== T.GREY) { if (other !== -1) mixed = true; else other = c.type; }
      }
      if (!hasUser) return 2;
      return mixed ? 0 : 1;
    }
    // ---- actions
    createLink(a, b) {           // Level.in
      if (this.getLink(a, b)) return false;
      if (this.blocked(a, b)) return false;
      const rev = this.getLink(b, a);
      const l = new Link(this, a, b);
      this.links.push(l);
      if (rev) {
        if (a.type === b.type) rev.cutFrac(1);
        if (!rev.isCut) rev.setSplit(l);
      }
      return true;
    }
    cut(x1, y1, x2, y2) {        // Level.switch
      let any = null;
      for (const l of this.links.slice()) {
        const p = intersect(x1, y1, x2, y2, l.a1.x, l.a1.y, l.a2.x, l.a2.y);
        if (p && l.orig.type === USER) { any = l; l.cutAt(p.x, p.y, 'player'); }
      }
      if (any) this.stats.cuts++;
      return any;
    }
    // ---- CPU (Level._-m). Special kinds only nudge target preference.
    kindWeight(t) { return t.kind === K.TOXIN ? 1.8 : t.kind === K.AMP ? 0.8 : t.kind === K.SHELL ? 1.25 : 1; }
    doCpuAttack(type) {
      let best = 10000, src = null, dst = null;
      for (const c of this.cells) {
        if (!(c.type === type && c.linkCount < c.maxLinks)) continue;
        for (const t of this.cells) {
          if (!(t.type !== c.type && !this.getLink(c, t) && !this.blocked(c, t))) continue;
          let d = Math.hypot(t.x - c.x, t.y - c.y);
          if (this.getLink(t, c)) d = d / 2;
          if (t.kind) d *= this.kindWeight(t);
          if (d < best && (c.power - 10) > Math.trunc(d / SEG_STEP)) { best = d; src = c; dst = t; }
        }
      }
      if (src && dst) this.createLink(src, dst);
    }
    doCpuSupport(type) {
      let best = 10000, src = null, dst = null;
      for (const c of this.cells) {
        if (!(c.type === type && c.linkCount < c.maxLinks)) continue;
        for (const t of this.cells) {
          if (!(t.type === c.type && !this.getLink(t, c) && !this.getLink(c, t) && !this.blocked(c, t))) continue;
          const d = Math.hypot(t.x - c.x, t.y - c.y);
          if (d < best && (c.power - Math.trunc(d / SEG_STEP) - 10) > t.power) { best = d; src = c; dst = t; }
        }
      }
      if (src && dst) this.createLink(src, dst);
    }
    doCpuLinksCut() {
      for (let i = 0; i < this.links.length; i++) {
        const l = this.links[i], s = l.orig, t = l.dest;
        if (s.type === USER) continue;
        if (s.power < MIN_PANIC_POWER) l.cutFrac(1);
        if (s.type === t.type && l.attached) {
          const should = s.type === T.PURPLE ? (t.power / 2 > s.power) : (t.power > 10);
          if (should) { if (t.power + l.power > s.power) l.cutFrac(0.5); else l.cutFrac(0); }
        }
        if (s.type === T.PURPLE && l.attached) {
          if (t.defense() < l.power && this.getLink(t, s) == null) l.cutFrac(0);
        }
      }
    }
    cpuTurn() {
      const n = this.def.cpuActions || 1;
      for (let k = 0; k < n; k++) { this.doCpuAttack(T.RED); this.doCpuAttack(T.BLACK); this.doCpuAttack(T.PURPLE); }
      this.doCpuSupport(T.PURPLE); this.doCpuLinksCut();
    }
    correctCellsPos() {
      const P = 5;
      for (let i = 0; i < this.cells.length; i++) {
        const c = this.cells[i], r = c.radius();
        if (c.x - r < 0) c.push(0, P);
        if (c.x + r > W) c.push(180, P);
        if (c.y - r < 20) c.push(90, P);
        if (c.y + r > H - 30) c.push(-90, P);
        for (let j = i + 1; j < this.cells.length; j++) {
          const c2 = this.cells[j], d = Math.hypot(c2.x - c.x, c2.y - c.y);
          if (r + c2.radius() + 40 > d) { const ang = c2.angleTo(c); c.push(ang, 20); c2.push(ang + 180, 20); }
        }
      }
    }
    sweepWalls() {               // moving walls sever any tentacle they pass through
      for (const f of this.fences) {
        if (!f.motion) continue;
        for (const l of this.links.slice()) {
          if (l.isCut || l.dead) continue;
          let ex, ey;
          if (l.attached) { ex = l.x2; ey = l.y2; }
          else { const len = Math.min(l.dist, l.tipLength()); if (len < 2) continue; ex = l.x1 + Math.cos(l.dir) * len; ey = l.y1 + Math.sin(l.dir) * len; }
          const p = intersect(l.x1, l.y1, ex, ey, f.x1, f.y1, f.x2, f.y2);
          if (p) l.cutAt(p.x, p.y, 'wall');
        }
      }
    }
    corrode() {                  // toxins dissolve hostile tentacles plugged into them
      for (const l of this.links) {
        if (l.isCut || !l.attached || l.dest.kind !== K.TOXIN || l.dest.type === l.orig.type) continue;
        if (++l.toxCnt > TOXIN_PERIOD) { l.toxCnt = 0; if (l.segs.length > 1) { l.segs.pop(); l.toxFx = 10; } }
      }
    }
    suspend() { this.suspended = true; for (const c of this.cells) c.suspend(); }
    tick() {
      this.tickN++;
      for (const fa of this.freeAnchors) { fa.px = fa.x; fa.py = fa.y; }
      for (const f of this.fences) f.move(this.tickN);
      for (const c of this.cells) c.tick();
      if (!this.suspended) {
        if (this.cpuTurnPeriod > 0 && ++this.cpuTurnCnt > this.cpuTurnPeriod) { this.cpuTurnCnt = 0; this.cpuTurn(); }
        if (++this.gameOverCheckCnt > GAMEOVER_CHECK_PERIOD) {
          this.gameOverCheckCnt = 0; this.time++;
          this.emit('second');
          const ph = this.phase();
          if (ph !== 0) this.emit('end', ph === 1);
        }
      }
      for (const l of this.links.slice()) if (!l.dead) l.tick();
      if (this.hasMovingFences) this.sweepWalls();
      if (this.hasToxins) this.corrode();
      for (const f of this.fences) f.phase += 0.2;
      if (++this.correctCnt >= 20) { this.correctCnt = 0; this.correctCellsPos(); }
    }
  }

  Object.assign(CT, {
    W, H, TICK_MS, T, USER, K, EVO, SEG_SIZE, SEG_INTERVAL, SEG_STEP, MIN_RADIUS, MIN_ATTACK_POWER, GREY_GIVE_UP_DIV,
    WAVE_FREQ, WAVE_SIZE, WAVE_FADING, WAVE_SPEED, DEFAULT_MODS,
    lerp, clamp, rng, intersect, Anchor, FreeAnchor, Cell, Link, Fence, Level, cellSpec, fenceSpec, defFromArray,
  });
})(window.CT);
