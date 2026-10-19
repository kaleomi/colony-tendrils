'use strict';
// Level editor: place microbes and walls, tune them, test-play, export share codes.
(function (CT) {
  const { W, H, T, K, Level, R, Codec, Audio } = CT;
  const $ = id => document.getElementById(id);
  const TEAMS = [T.GREEN, T.RED, T.BLACK, T.PURPLE, T.GREY];
  const TEAM_COL = { 3: '#33aa33', 2: '#aa3333', 4: '#111111', 5: '#aa33aa', 1: '#888888' };
  const TEAM_NAME = { 3: '绿色（你）', 2: '红色', 4: '黑色', 5: '紫色', 1: '中立' };
  const KIND_LIST = [[0, '普通'], [K.AMP, '增幅'], [K.SHELL, '甲壳'], [K.TOXIN, '毒囊'], [K.LEECH, '汲取']];
  const MAX_OPTS = [50, 60, 80, 100, 120, 150, 200];
  const AI_OPTS = [[100, 'AI 普通'], [50, 'AI 快速'], [20, 'AI 极快'], [0, 'AI 关闭']];
  const CELL_MOVES = [null, { mx: 80, my: 0, period: 300 }, { mx: 0, my: 80, period: 300 }];
  const WALL_MOVES = [null, { mx: 80, my: 0, period: 240 }, { mx: 0, my: 80, period: 240 }];
  const BOUNDS = { x0: 24, x1: 616, y0: 44, y1: 440 };

  const clone = o => JSON.parse(JSON.stringify(o));
  const normCell = c => ({ type: c.type, power: c.power | 0, x: Math.round(c.x), y: Math.round(c.y), kind: c.kind | 0, mx: c.mx || 0, my: c.my || 0, period: c.period || 0, phase: 0 });
  const normWall = f => ({ x1: Math.round(f.x1), y1: Math.round(f.y1), x2: Math.round(f.x2), y2: Math.round(f.y2), mx: f.mx || 0, my: f.my || 0, period: f.period || 0, phase: 0 });
  function sample() {
    return { name: '', maxPower: 100, cpuTurn: 100, hint: null,
      cells: [{ type: T.GREEN, power: 40, x: 110, y: 240 }, { type: T.GREY, power: 20, x: 300, y: 130 }, { type: T.GREY, power: 20, x: 300, y: 350, kind: K.AMP }, { type: T.RED, power: 40, x: 520, y: 240 }].map(normCell),
      fences: [] };
  }
  const moveIndex = o => !o.period ? 0 : (o.mx ? 1 : 2);
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2));
    return Math.hypot(px - (x1 + dx * k), py - (y1 + dy * k));
  }
  const clampX = x => Math.max(BOUNDS.x0, Math.min(BOUNDS.x1, x));
  const clampY = y => Math.max(BOUNDS.y0, Math.min(BOUNDS.y1, y));

  const E = {
    game: null, def: null, tool: 'cell', sel: null, drag: null, hover: null, preview: null, dirty: true,
    brush: { type: T.GREY, kind: 0, power: 30, move: 0, wallMove: 0 },
    init(game) {
      this.game = game;
      this.bg = null;
      $('edTeam').innerHTML = TEAMS.map(t => `<button type="button" data-v="${t}" title="${TEAM_NAME[t]}" style="background:${TEAM_COL[t]}"></button>`).join('');
      $('edKind').innerHTML = KIND_LIST.map(([k, n]) => `<button type="button" data-v="${k}">${n}</button>`).join('');
      $('edTool').onclick = e => { const b = e.target.closest('button'); if (!b) return; this.tool = b.dataset.v; this.sel = null; this.refresh(); };
      $('edTeam').onclick = e => { const b = e.target.closest('button'); if (b) this.setProp('type', +b.dataset.v); };
      $('edKind').onclick = e => { const b = e.target.closest('button'); if (b) this.setProp('kind', +b.dataset.v); };
      $('edPowBtns').onclick = e => { const b = e.target.closest('button'); if (b) this.bumpPower(+b.dataset.v); };
      $('edCMove').onclick = e => { const b = e.target.closest('button'); if (b) this.setProp('move', +b.dataset.v); };
      $('edWMove').onclick = e => { const b = e.target.closest('button'); if (b) this.setWallMove(+b.dataset.v); };
      $('edDelete').onclick = () => this.deleteSel();
      $('edCollapse').onclick = () => { const p = $('edPanel'); p.classList.toggle('min'); $('edCollapse').textContent = p.classList.contains('min') ? '展开' : '收起'; };
      $('edName').oninput = e => { this.def.name = e.target.value.slice(0, 24); this.persist(); };
      $('edMax').onclick = () => { const i = MAX_OPTS.indexOf(this.def.maxPower); this.def.maxPower = MAX_OPTS[(i + 1) % MAX_OPTS.length]; this.changed(); };
      $('edAI').onclick = () => { const i = AI_OPTS.findIndex(o => o[0] === this.def.cpuTurn); this.def.cpuTurn = AI_OPTS[(i + 1) % AI_OPTS.length][0]; this.changed(); };
      $('edClear').onclick = () => {
        const b = $('edClear');
        if (b.dataset.armed) { this.def.cells = []; this.def.fences = []; this.sel = null; delete b.dataset.armed; b.textContent = '清空'; this.changed(); Audio.S.remove(); return; }
        b.dataset.armed = '1'; b.textContent = '确认清空？';
        setTimeout(() => { delete b.dataset.armed; b.textContent = '清空'; }, 2500);
      };
      $('edTest').onclick = () => {
        const msg = Codec.validate(this.def, false);
        if (msg) return this.msg(msg);
        this.persist(); this.game.startCustom(clone(this.def), 'editor');
      };
      $('edBack').onclick = () => { this.persist(); this.game.toHome(); };
      $('edUpload').onclick = () => this.uploadDialog();
    },
    open(def) {
      const src = def || this.game.save.editor || sample();
      this.def = { name: src.name || '', maxPower: src.maxPower || 100, cpuTurn: src.cpuTurn == null ? 100 : src.cpuTurn, hint: null, cells: (src.cells || []).map(normCell), fences: (src.fences || []).map(normWall) };
      if (!this.bg) this.bg = R.paintFieldBg(77);
      this.sel = null; this.drag = null; this.dirty = true;
      $('edName').value = this.def.name;
      this.persist(); this.refresh();
    },
    persist() { this.game.save.editor = this.def; this.game.persist(); },
    changed() { this.dirty = true; this.persist(); this.refresh(); },
    msg(text) {
      const el = $('edMsg'); el.textContent = text; el.style.opacity = '1';
      clearTimeout(this.msgT); this.msgT = setTimeout(() => { el.style.opacity = '0'; }, 2600);
    },
    target() {                // the selected cell, or the brush
      if (this.sel && this.sel.t === 'cell') return this.def.cells[this.sel.i];
      return null;
    },
    setProp(key, v) {
      const c = this.target();
      if (key === 'move') {
        if (c) { const m = CELL_MOVES[v]; c.mx = m ? m.mx : 0; c.my = m ? m.my : 0; c.period = m ? m.period : 0; }
        else this.brush.move = v;
      } else if (c) c[key] = v; else this.brush[key] = v;
      if (c && key === 'type' && c.type !== T.GREY && c.power > this.def.maxPower) c.power = this.def.maxPower;
      Audio.S.click(); this.changed();
    },
    bumpPower(d) {
      const c = this.target(), o = c || this.brush;
      o.power = Math.max(1, Math.min(this.def.maxPower, o.power + d));
      this.changed();
    },
    setWallMove(v) {
      const m = WALL_MOVES[v];
      if (this.sel && this.sel.t === 'wall') { const f = this.def.fences[this.sel.i]; f.mx = m ? m.mx : 0; f.my = m ? m.my : 0; f.period = m ? m.period : 0; }
      else this.brush.wallMove = v;
      Audio.S.click(); this.changed();
    },
    deleteSel() {
      if (!this.sel) return;
      (this.sel.t === 'cell' ? this.def.cells : this.def.fences).splice(this.sel.i, 1);
      this.sel = null; Audio.S.remove(); this.changed();
    },
    refresh() {
      if (!this.def) return;
      const d = this.def, s = this.sel;
      $('edCount').textContent = `微生物 ${d.cells.length}/${Codec.LIMITS.cells} · 墙 ${d.fences.length}/${Codec.LIMITS.fences}`;
      $('edMax').textContent = `上限 ${d.maxPower}`;
      $('edAI').textContent = (AI_OPTS.find(o => o[0] === d.cpuTurn) || AI_OPTS[0])[1];
      for (const b of $('edTool').children) b.classList.toggle('on', b.dataset.v === this.tool && !s);
      const showCell = s ? s.t === 'cell' : this.tool === 'cell';
      $('secCell').classList.toggle('hidden', !showCell);
      $('secWall').classList.toggle('hidden', showCell);
      $('edDelete').classList.toggle('hidden', !s);
      $('edPanelTitle').textContent = s ? (s.t === 'cell' ? '选中的微生物' : '选中的墙') : (this.tool === 'cell' ? '画笔 · 微生物' : '画笔 · 墙');
      const c = this.target(), o = c || this.brush;
      for (const b of $('edTeam').children) b.classList.toggle('on', +b.dataset.v === o.type);
      for (const b of $('edKind').children) b.classList.toggle('on', +b.dataset.v === o.kind);
      $('edPow').textContent = String(o.power);
      const mv = c ? moveIndex(c) : this.brush.move;
      for (const b of $('edCMove').children) b.classList.toggle('on', +b.dataset.v === mv);
      const wv = s && s.t === 'wall' ? moveIndex(d.fences[s.i]) : this.brush.wallMove;
      for (const b of $('edWMove').children) b.classList.toggle('on', +b.dataset.v === wv);
      let sx = -1;
      if (s && s.t === 'cell' && d.cells[s.i]) sx = d.cells[s.i].x;
      if (s && s.t === 'wall' && d.fences[s.i]) sx = Math.max(d.fences[s.i].x1, d.fences[s.i].x2);
      const p = $('edPanel');
      if (sx > 440) p.style.right = 'auto', p.style.left = '6px';
      else if (sx >= 0 && sx < 200) p.style.left = 'auto', p.style.right = '6px';
      $('edHint').textContent = s ? '拖动可移动；Delete 键删除；点空白处取消选中'
        : this.tool === 'cell' ? '点空白处放一个微生物；拖动已有的微生物可以挪位置' : '在空白处拖出一面墙；拖墙身或端点可以调整';
    },
    // ---------------------------------------------------------------- pointer
    radiusOf(c) { return 18 + Math.min(c.power, this.def.maxPower) / 10; },
    hitCell(p) {
      let best = -1, bd = 1e9;
      this.def.cells.forEach((c, i) => { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d <= this.radiusOf(c) + 6 && d < bd) { bd = d; best = i; } });
      return best;
    },
    hitWall(p) {
      let best = -1, bd = 10;
      this.def.fences.forEach((f, i) => { const d = distToSeg(p.x, p.y, f.x1, f.y1, f.x2, f.y2); if (d < bd) { bd = d; best = i; } });
      return best;
    },
    onDown(p) {
      if (!this.def) return;
      const ci = this.hitCell(p);
      if (ci >= 0) {
        const c = this.def.cells[ci];
        this.sel = { t: 'cell', i: ci }; this.drag = { t: 'cell', i: ci, ox: p.x - c.x, oy: p.y - c.y };
        this.refresh(); return;
      }
      const wi = this.hitWall(p);
      if (wi >= 0) {
        const f = this.def.fences[wi];
        this.sel = { t: 'wall', i: wi };
        const e1 = Math.hypot(p.x - f.x1, p.y - f.y1) < 11, e2 = Math.hypot(p.x - f.x2, p.y - f.y2) < 11;
        this.drag = e1 ? { t: 'end', i: wi, end: 1 } : e2 ? { t: 'end', i: wi, end: 2 } : { t: 'wall', i: wi, px: p.x, py: p.y, f0: Object.assign({}, f) };
        this.refresh(); return;
      }
      if (this.sel) { this.sel = null; this.refresh(); return; }
      if (this.tool === 'cell') {
        if (this.def.cells.length >= Codec.LIMITS.cells) return this.msg(`最多放 ${Codec.LIMITS.cells} 个微生物`);
        if (p.y < BOUNDS.y0 - 10 || p.y > BOUNDS.y1 + 10) return this.msg('太靠边了，往中间一点');
        if (this.def.cells.some(c => Math.hypot(c.x - p.x, c.y - p.y) < 46)) return this.msg('离别的微生物太近了');
        const b = this.brush, m = CELL_MOVES[b.move];
        this.def.cells.push(normCell({ type: b.type, power: Math.min(b.power, this.def.maxPower), x: clampX(p.x), y: clampY(p.y), kind: b.kind, mx: m ? m.mx : 0, my: m ? m.my : 0, period: m ? m.period : 0 }));
        const i = this.def.cells.length - 1;
        this.sel = { t: 'cell', i }; this.drag = { t: 'cell', i, ox: 0, oy: 0 };
        Audio.S.place(); this.changed();
      } else {
        if (this.def.fences.length >= Codec.LIMITS.fences) return this.msg(`最多画 ${Codec.LIMITS.fences} 面墙`);
        this.drag = { t: 'new', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      }
    },
    onMove(p) {
      if (!this.def) return;
      this.hover = p;
      const d = this.drag; if (!d) return;
      if (d.t === 'cell') { const c = this.def.cells[d.i]; c.x = Math.round(clampX(p.x - d.ox)); c.y = Math.round(clampY(p.y - d.oy)); this.dirty = true; }
      else if (d.t === 'end') { const f = this.def.fences[d.i]; f['x' + d.end] = Math.round(Math.max(0, Math.min(W, p.x))); f['y' + d.end] = Math.round(Math.max(20, Math.min(H - 20, p.y))); this.dirty = true; }
      else if (d.t === 'wall') {
        const f = this.def.fences[d.i], dx = p.x - d.px, dy = p.y - d.py;
        f.x1 = Math.round(d.f0.x1 + dx); f.y1 = Math.round(d.f0.y1 + dy); f.x2 = Math.round(d.f0.x2 + dx); f.y2 = Math.round(d.f0.y2 + dy); this.dirty = true;
      } else if (d.t === 'new') { d.x1 = Math.max(0, Math.min(W, p.x)); d.y1 = Math.max(20, Math.min(H - 20, p.y)); }
    },
    onUp() {
      const d = this.drag; this.drag = null;
      if (!d || !this.def) return;
      if (d.t === 'new') {
        if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 20) return this.msg('拖得长一点才能画出墙');
        const m = WALL_MOVES[this.brush.wallMove];
        this.def.fences.push(normWall({ x1: d.x0, y1: d.y0, x2: d.x1, y2: d.y1, mx: m ? m.mx : 0, my: m ? m.my : 0, period: m ? m.period : 0 }));
        this.sel = { t: 'wall', i: this.def.fences.length - 1 };
        Audio.S.place();
      }
      this.changed();
    },
    cancel() { this.drag = null; },
    underPanel(p) {
      const el = $('edPanel'); if (el.classList.contains('min')) return false;
      const left = el.style.left === '6px', w = el.offsetWidth + 8, h = el.offsetHeight + 30;
      return p.y < h && (left ? p.x < w : p.x > W - w);
    },
    onKey(e) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSel(); }
      else if (e.key === 'Escape') { if (!$('overlay').classList.contains('hidden')) this.game.hideOverlay(); else { this.sel = null; this.refresh(); } }
    },
    // ---------------------------------------------------------------- lobby upload
    layoutKey(def) { return Codec.encode(Object.assign({}, def, { name: '' })); },
    uploaded() { const u = this.lastUpload; return u && this.def && u.key === this.layoutKey(this.def) ? u : null; },
    uploadDialog(onClose) {
      const msg = Codec.validate(this.def, false);
      if (msg) return this.msg(msg);
      if (this.game.save.verified !== this.layoutKey(this.def)) return this.msg('上传前先点「试玩」并打赢一次，确保这一关能通关');
      const g = this.game, close = onClose || (() => g.hideOverlay());
      g.showOverlay(`<div class="veil"><div class="card" style="width:360px">
        <h2>上传到大厅</h2>
        <div class="note">上传后所有人都能在关卡大厅里看到并挑战这一关</div>
        <label class="field">关卡名<input id="oName" type="text" maxlength="24" autocomplete="off"></label>
        <label class="field">作者（显示给其他玩家）<input id="oAuthor" type="text" maxlength="16" autocomplete="off" placeholder="匿名"></label>
        <div class="err" id="oErr"></div>
        <div class="row"><button class="btn primary" id="oUp" type="button">上传</button><button class="btn" id="oBack" type="button">取消</button></div></div></div>`);
      $('oName').value = this.def.name || ''; $('oAuthor').value = g.save.author || '';
      $('oName').focus({ preventScroll: true });
      $('oBack').onclick = close;
      $('oUp').onclick = async () => {
        const name = $('oName').value.trim(), author = $('oAuthor').value.trim();
        if (!name) { $('oErr').textContent = '给关卡起个名字吧'; return; }
        const btn = $('oUp'); btn.disabled = true; btn.textContent = '上传中…'; $('oErr').textContent = '';
        try {
          const r = await CT.Lobby.upload(this.def, name, author);
          this.def.name = name; $('edName').value = name; g.save.author = author; this.persist();
          this.lastUpload = { key: this.layoutKey(this.def), id: r.id };
          const link = `${location.origin}${location.pathname}#L.${r.id}`;
          g.showOverlay(`<div class="veil"><div class="card" style="width:360px">
            <h2 style="color:var(--ok)">${r.duplicate ? '大厅里已经有了' : '已上传到大厅'}</h2>
            <div class="note">${r.duplicate ? `一模一样的关卡已经在大厅里了（「${CT.esc(r.name)}」）` : `「${CT.esc(name)}」现在所有人都能玩了`}<br>关卡 ID：<span style="font-family:var(--font-data);color:var(--signal)">${r.id}</span></div>
            <div class="row"><button class="btn primary" id="oGo" type="button">去大厅看看</button>${g.canLink() ? '<button class="btn" id="oLink" type="button">复制关卡链接</button>' : ''}<button class="btn" id="oBack" type="button">关闭</button></div></div></div>`);
          $('oGo').onclick = () => g.openLobby(r.duplicate ? 'new' : 'mine');
          if ($('oLink')) $('oLink').onclick = () => g.copyText(link, $('oLink'), '复制关卡链接');
          $('oBack').onclick = close;
        } catch (e) { btn.disabled = false; btn.textContent = '上传'; $('oErr').textContent = e.message; }
      };
    },
    // ---------------------------------------------------------------- render
    render(t) {
      const ctx = R.ctx;
      ctx.drawImage(this.bg, 0, 0, W, H);
      if (!this.def) return;
      // grid + play bounds
      ctx.strokeStyle = 'rgba(200,230,220,0.05)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 40; x < W; x += 40) { ctx.moveTo(x, 24); ctx.lineTo(x, H - 30); }
      for (let y = 40; y < H - 30; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,90,90,0.05)'; ctx.fillRect(0, 0, W, 20); ctx.fillRect(0, H - 30, W, 30);
      if (this.dirty) { this.preview = new Level(clone(this.def)); for (const c of this.preview.cells) c.suspended = true; this.dirty = false; }
      const lv = this.preview;
      for (const c of lv.cells) R.drawCellPath(c);
      for (const f of lv.fences) { f.phase = t * 4 + f.x1; R.drawFence(f, 1); }
      const s = this.sel;
      if (s && s.t === 'wall' && this.def.fences[s.i]) {
        const f = this.def.fences[s.i];
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,85,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke(); ctx.setLineDash([]);
        for (const [x, y] of [[f.x1, f.y1], [f.x2, f.y2]]) { ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,85,0.9)'; ctx.fill(); }
        ctx.restore();
      }
      lv.cells.forEach((c, i) => R.drawCell(c, t, 1, false, s && s.t === 'cell' && s.i === i));
      if (s && s.t === 'cell' && this.def.cells[s.i]) {
        const c = this.def.cells[s.i];
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,85,0.95)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -t * 12;
        ctx.beginPath(); ctx.arc(c.x, c.y, this.radiusOf(c) + 7, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      const d = this.drag;
      if (d && d.t === 'new') {
        ctx.save(); ctx.strokeStyle = 'rgba(255,220,160,0.9)'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(d.x0, d.y0); ctx.lineTo(d.x1, d.y1); ctx.stroke(); ctx.restore();
      }
      // ghost of the brush under the pointer
      const h = this.hover;
      if (!d && h && !s && this.tool === 'cell' && h.y > 24 && h.y < H - 30 && this.hitCell(h) < 0 && this.hitWall(h) < 0 && !this.underPanel(h)) {
        ctx.save(); ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.arc(h.x, h.y, 18 + this.brush.power / 10, 0, Math.PI * 2);
        ctx.fillStyle = TEAM_COL[this.brush.type]; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#eee'; ctx.stroke();
        ctx.restore();
      }
    },
  };
  CT.Editor = E;
})(window.CT);
