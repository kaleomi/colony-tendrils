'use strict';
// App controller: screens, modes, HUD, input, main loop.
(function (CT) {
  const { W, H, T, K, USER, EVO, SEG_STEP, TICK_MS, Level, Audio, R, Codec, Endless, CH1, CH2, KINDS, MUTATIONS } = CT;
  const $ = id => document.getElementById(id);
  const stage = $('stage'), cv = $('cv');
  R.init(cv);

  const Store = {
    key: 'colony-tendrils:v1',
    defaults() { return { open: 1, score: 0, best: {}, open2: 1, best2: {}, endlessBest: 0, endlessRuns: 0, run: null, editor: null, sound: true, music: true }; },
    load() { let v = null; try { v = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch (e) { } return Object.assign(this.defaults(), v && typeof v === 'object' ? v : {}); },
    save(v) { try { localStorage.setItem(this.key, JSON.stringify(v)); } catch (e) { } },
  };
  const ICON = {
    pause: '<svg viewBox="0 0 12 12"><path d="M4 2.5v7M8 2.5v7"/></svg>暂停',
    play: '<svg viewBox="0 0 12 12"><path d="M4 2.5l5 3.5-5 3.5z"/></svg>继续',
    sound: on => '<svg viewBox="0 0 12 12"><path d="M2 4.5h2l3-2.5v8L4 7.5H2z"/>' + (on ? '<path d="M8.8 4.2a2.6 2.6 0 0 1 0 3.6"/>' : '<path d="M8.5 4.5l2 3M10.5 4.5l-2 3"/>') + '</svg>音效',
    music: '<svg viewBox="0 0 12 12"><path d="M4.5 9V2.5l5-1V8"/><circle cx="3.3" cy="9" r="1.3"/><circle cx="8.3" cy="8" r="1.3"/></svg>音乐',
  };
  const RING = { cx: 320, cy: 284, r: 80 };
  const CHAPTERS = { 1: { levels: CH1, openKey: 'open', bestKey: 'best', title: '经典战役', label: i => `区域 <b>${i + 1}</b>` },
                     2: { levels: CH2, openKey: 'open2', bestKey: 'best2', title: '第二章 · 异变', label: i => `异变 <b>${i + 1}</b> · ${CH2[i].name}` } };

  const game = {
    screen: 'home', save: Store.load(), lv: null, ctx: null, paused: false, speed: 1,
    hover: null, selected: null, drag: null, pointer: { x: 0, y: 0, touch: false },
    tutorial: -1, lastAlpha: 1, chapter: 1, run: null, endTimer: null, pendingShared: null,

    init() {
      Audio.setSound(this.save.sound !== false); Audio.setMusic(this.save.music !== false);
      this.fieldBg = R.paintFieldBg(11); this.menuBg = R.paintMenuBg(7);
      this.showcase = new Level({ maxPower: 200, cpuTurn: 0, cells: [
        { type: T.GREEN, power: 60, x: 90, y: 157 }, { type: T.GREY, power: 40, x: 373, y: 157, kind: K.AMP },
        { type: T.PURPLE, power: 90, x: 90, y: 273, kind: K.LEECH }, { type: T.RED, power: 50, x: 373, y: 273, kind: K.SHELL },
        { type: T.BLACK, power: 30, x: 90, y: 364 }].map(c => Object.assign({ kind: 0 }, c)), fences: [] });
      for (const c of this.showcase.cells) c.suspended = true;
      // home
      $('mCh1').onclick = () => { this.unlock(); this.openCampaign(1); };
      $('mCh2').onclick = () => { this.unlock(); this.openCampaign(2); };
      $('mEndless').onclick = () => { this.unlock(); this.openEndless(); };
      $('mEditor').onclick = () => { this.unlock(); this.openEditor(); };
      $('mLobby').onclick = () => { this.unlock(); this.openLobby(); };
      $('mImport').onclick = () => { this.unlock(); this.showImport('home'); };
      $('mHelp').onclick = () => { this.unlock(); this.showHelp(false); };
      // campaign
      $('cBack').onclick = () => this.toHome();
      $('tab1').onclick = () => this.openCampaign(1);
      $('tab2').onclick = () => this.openCampaign(2);
      $('btnContinue').onclick = () => { const ch = CHAPTERS[this.chapter]; this.startCampaign(this.chapter, Math.min(this.save[ch.openKey], ch.levels.length) - 1); };
      // hud
      $('bHelp').onclick = () => { this.setPaused(true, true); this.showHelp(true); };
      $('bMenu').onclick = () => this.leaveLevel();
      $('bRestart').onclick = () => this.restart();
      $('bPause').onclick = () => this.setPaused(!this.paused);
      $('bSpeed').onclick = () => { this.speed = this.speed === 1 ? 2 : 1; $('bSpeed').textContent = this.speed + '×'; $('bSpeed').classList.toggle('on', this.speed === 2); };
      for (const b of document.querySelectorAll('[data-toggle]')) b.onclick = () => {
        this.unlock();
        if (b.dataset.toggle === 'sound') { Audio.setSound(!Audio.soundOn); this.save.sound = Audio.soundOn; }
        else { Audio.setMusic(!Audio.musicOn); this.save.music = Audio.musicOn; }
        Store.save(this.save); this.refreshToggles();
      };
      window.addEventListener('keydown', e => this.onKey(e));
      stage.addEventListener('pointerdown', e => this.onDown(e));
      window.addEventListener('pointermove', e => this.onMove(e));
      window.addEventListener('pointerup', e => this.onUp(e));
      window.addEventListener('pointercancel', () => { this.selected = null; this.drag = null; CT.Editor.cancel(); });
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.screen === 'play' && !this.paused) this.setPaused(true); });
      window.addEventListener('hashchange', () => this.checkHash());
      CT.Editor.init(this); CT.Lobby.init(this);
      this.refreshToggles(); this.toHome(); this.checkHash();
    },
    unlock() { Audio.ensure(); },
    persist() { Store.save(this.save); },
    refreshToggles() {
      for (const b of document.querySelectorAll('[data-toggle]')) {
        const s = b.dataset.toggle === 'sound';
        b.innerHTML = s ? ICON.sound(Audio.soundOn) : ICON.music;
        b.classList.toggle('off', !(s ? Audio.soundOn : Audio.musicOn));
      }
    },
    show(layer) {
      for (const id of ['home', 'campaign', 'hud', 'editor', 'lobby']) $(id).classList.toggle('hidden', id !== layer);
      stage.classList.toggle('lock', layer === 'hud' || layer === 'editor');
    },
    canLink() { let framed = true; try { framed = window.top !== window; } catch (e) { } return !framed && /^https?:/.test(location.protocol); },
    copyText(text, btn, label) {
      const done = () => { btn.textContent = '已复制'; setTimeout(() => { btn.textContent = label; }, 1600); };
      const fail = () => { btn.textContent = '复制失败，请手动复制'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail); else fail();
    },

    // ------------------------------------------------------------ home
    toHome() {
      clearTimeout(this.endTimer);
      this.screen = 'home'; this.lv = null; this.paused = false; this.selected = this.drag = null;
      this.show('home'); this.hideOverlay();
      $('pCh1').textContent = `已占领 ${Math.min(this.save.open - 1, 20)} / 20`;
      $('pCh2').textContent = `已占领 ${Math.min(this.save.open2 - 1, 10)} / 10`;
      const r = this.save.run;
      $('pEndless').textContent = r ? `进行中：第 ${r.depth} 层` + (this.save.endlessBest ? ` · 最高通过 ${this.save.endlessBest} 层` : '')
        : this.save.endlessBest ? `最高通过 ${this.save.endlessBest} 层` : '还没有记录';
      const ed = this.save.editor;
      $('pEditor').textContent = ed && ed.cells && ed.cells.length ? `草稿：${ed.name || '未命名'} · ${ed.cells.length} 个微生物` : '从示例关卡开始';
      CT.Lobby.homeCount($('pLobby'));
    },
    checkHash() {
      const h = decodeURIComponent(location.hash || '');
      const m = /^#L\.([a-z0-9]{6,12})$/.exec(h);
      if (m) return this.showLobbyLevel(m[1]);
      if (h === '#admin') return this.showAdmin();
      if (!h.startsWith('#' + Codec.PREFIX)) return;
      try { const def = Codec.decode(h); this.showShared(def); } catch (e) { this.showImport('home', h.slice(1), e.message); }
    },

    // ------------------------------------------------------------ campaign
    openCampaign(ch) {
      this.chapter = ch; this.screen = 'campaign'; this.lv = null;
      this.show('campaign'); this.hideOverlay();
      $('tab1').classList.toggle('on', ch === 1); $('tab2').classList.toggle('on', ch === 2);
      $('cTitle').textContent = CHAPTERS[ch].title;
      this.buildZones();
    },
    zoneCount() { return CHAPTERS[this.chapter].levels.length; },
    zonePos(i) {
      const n = this.zoneCount(), ang = i * Math.PI * 2 / n - Math.PI / 2, open = i < this.save[CHAPTERS[this.chapter].openKey];
      const r2 = open ? RING.r + 50 : RING.r + 25;
      return { ang, open, r2, x: Math.cos(ang) * (r2 + 15) + RING.cx, y: Math.sin(ang) * (r2 + 15) + RING.cy };
    },
    buildZones() {
      const ch = CHAPTERS[this.chapter], box = $('zones'), n = ch.levels.length, open = this.save[ch.openKey];
      box.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const p = this.zonePos(i), b = document.createElement('button');
        const done = i < open - 1, next = i === open - 1, lock = !done && !next;
        b.type = 'button'; b.className = 'zone hit ' + (done ? 'done' : next ? 'next' : 'lock') + (this.chapter === 2 ? ' ch2' : '');
        b.textContent = String(i + 1); b.style.left = p.x + 'px'; b.style.top = p.y + 'px';
        const best = this.save[ch.bestKey][i + 1], nm = ch.levels[i].name;
        b.title = (lock ? `第 ${i + 1} 关（未解锁）` : `第 ${i + 1} 关`) + (nm ? ` · ${nm}` : '') + (best ? ` · 最快 ${best} 秒` : '');
        b.setAttribute('aria-label', b.title);
        b.onmouseenter = () => { $('zoneName').textContent = lock ? '未解锁' : (nm || `区域 ${i + 1}`) + (best ? ` · 最快 ${best}s` : ''); };
        b.onmouseleave = () => { $('zoneName').textContent = ''; };
        b.onclick = () => { if (!lock) { this.unlock(); Audio.S.click(); this.startCampaign(this.chapter, i); } };
        box.appendChild(b);
      }
      $('scoreVal').textContent = String(this.save.score);
      const nxt = Math.min(open, n);
      $('btnContinue').textContent = open > n ? '全部通关 · 重玩第 1 关' : open > 1 ? `继续 · 第 ${nxt} 关` : '开始';
      if (open > n) $('btnContinue').onclick = () => this.startCampaign(this.chapter, 0);
      else $('btnContinue').onclick = () => this.startCampaign(this.chapter, nxt - 1);
      $('zoneName').textContent = this.chapter === 2 && open === 1 ? '建议先玩经典战役' : '';
    },
    startCampaign(ch, i) {
      const def = CHAPTERS[ch].levels[i];
      this.startLevel({ mode: ch === 1 ? 'ch1' : 'ch2', chapter: ch, index: i, def, label: CHAPTERS[ch].label(i) });
    },

    // ------------------------------------------------------------ endless
    openEndless() {
      const r = this.save.run;
      if (!r) return this.newRun();
      this.showOverlay(`<div class="veil"><div class="card">
        <h2>无尽进化</h2>
        <div class="sub">上一局停在 <em>第 ${r.depth} 层</em>，已获得 <em>${Object.values(r.perks).reduce((a, b) => a + b, 0)}</em> 个突变</div>
        <div class="row"><button class="btn primary" id="oCont" type="button">继续这一局</button><button class="btn" id="oNew" type="button">重新开始</button></div>
        <button class="btn small" id="oBack" type="button">返回</button></div></div>`);
      $('oCont').onclick = () => { this.run = Object.assign(Endless.newRun(r.seed), r); this.nextDepth(true); };
      $('oNew').onclick = () => this.newRun();
      $('oBack').onclick = () => this.hideOverlay();
      $('oCont').focus({ preventScroll: true });
    },
    newRun() {
      this.run = Endless.newRun((Math.random() * 4294967295) >>> 0);
      this.save.endlessRuns++;
      this.nextDepth(false);
    },
    nextDepth(resumed) {
      const run = this.run;
      const evolved = resumed ? null : Endless.enemyEvolve(run);
      this.save.run = { seed: run.seed, depth: run.depth, perks: run.perks, enemyPerks: run.enemyPerks, startBonus: run.startBonus, totalTime: run.totalTime };
      this.persist();
      const def = Endless.generate(run);
      this.startLevel({ mode: 'endless', index: run.depth, def, label: `无尽 · 第 <b>${run.depth}</b> 层` });
      if (evolved) this.setStatus(`警告：敌方突变「${evolved.name}」——${evolved.desc}`, '#ff9a9a');
      else if (run.depth === 1) this.setStatus('占领所有外来微生物，每过一层可以选择一个突变');
    },
    renderChips() {
      const box = $('chips'), run = this.run;
      if (!this.ctx || this.ctx.mode !== 'endless' || !run) { box.innerHTML = ''; return; }
      const chip = (id, n, foe) => { const m = Endless.byId[id]; return `<span class="chip${foe ? ' foe' : ''}" title="${m.desc}">${foe ? '敌·' : ''}${m.name}${n > 1 ? ' ×' + n : ''}</span>`; };
      box.innerHTML = Object.entries(run.perks).map(([id, n]) => chip(id, n)).join('') + Object.entries(run.enemyPerks).map(([id, n]) => chip(id, n, true)).join('');
    },
    showMutations() {
      const picks = Endless.offer(this.run);
      if (!picks.length) { this.run.depth++; return this.nextDepth(false); }
      this.showOverlay(`<div class="veil"><div class="card mutate">
        <h2>第 ${this.run.depth} 层已占领</h2>
        <div class="sub">选择一个突变，带进第 <em>${this.run.depth + 1}</em> 层</div>
        <div class="picks">${picks.map((m, i) => `<button class="pick" type="button" data-i="${i}"><b>${m.name}</b><i>${m.desc}</i><em>${(this.run.perks[m.id] || 0) ? `已有 ×${this.run.perks[m.id]}` : '新突变'}</em></button>`).join('')}</div>
        <div class="note">用时 ${this.lv ? this.lv.time : 0} 秒 · 本局累计 ${this.run.totalTime} 秒</div></div></div>`);
      for (const b of document.querySelectorAll('.pick')) b.onclick = () => {
        Audio.S.mutate();
        Endless.applyPerk(this.run, picks[+b.dataset.i].id);
        this.run.depth++; this.nextDepth(false);
      };
      document.querySelector('.pick').focus({ preventScroll: true });
    },
    showRunOver() {
      const run = this.run, cleared = run.depth - 1, best = this.save.endlessBest;
      const perks = Object.entries(run.perks).map(([id, n]) => Endless.byId[id].name + (n > 1 ? '×' + n : '')).join('、') || '无';
      this.showOverlay(`<div class="veil"><div class="card" style="width:340px">
        <h2 style="color:var(--alert)">进化中断</h2>
        <div class="sub">倒在第 <em>${run.depth}</em> 层 · 通过 <em>${cleared}</em> 层${cleared >= best && cleared > 0 ? ' · <em>新纪录</em>' : ` · 最高 <em>${best}</em>`}</div>
        <div class="note">突变：${perks}<br>累计用时 ${run.totalTime + (this.lv ? this.lv.time : 0)} 秒</div>
        <div class="row"><button class="btn primary" id="oNew" type="button">再来一局</button><button class="btn" id="oHome" type="button">返回首页</button></div></div></div>`);
      $('oNew').onclick = () => this.newRun();
      $('oHome').onclick = () => this.toHome();
      $('oNew').focus({ preventScroll: true });
    },

    // ------------------------------------------------------------ lobby
    openLobby(sort) {
      clearTimeout(this.endTimer); this.lv = null; this.screen = 'lobby';
      this.hideOverlay(); this.show('lobby'); CT.Lobby.open(sort);
    },
    async showLobbyLevel(id) {
      this.showOverlay(`<div class="veil"><div class="card"><div class="spin"></div><div class="note">正在载入大厅关卡…</div></div></div>`);
      try {
        const { level: it } = await CT.LobbyAPI.get(id);
        const def = Codec.decode(it.code);
        const rate = it.plays ? Math.round(it.wins / it.plays * 100) + '%' : '—';
        this.showOverlay(`<div class="veil"><div class="card" style="width:400px">
          <h2>大厅关卡</h2>
          <div class="lvhead"><canvas id="oThumb"></canvas><div class="sub"><b>${CT.esc(it.name)}</b><span>作者 ${CT.esc(it.author)}</span><span>${it.cells} 个微生物 · 上限 ${it.maxPower}</span><span>挑战 ${it.plays} 次 · 胜率 ${rate} · 点赞 ${it.likes}</span></div></div>
          <div class="row"><button class="btn primary" id="oPlay" type="button">立即挑战</button><button class="btn" id="oLobby" type="button">逛逛大厅</button></div></div></div>`);
        CT.drawThumb($('oThumb'), def);
        $('oPlay').onclick = () => { this.unlock(); CT.Lobby.play(it); };
        $('oLobby').onclick = () => this.openLobby('new');
        $('oPlay').focus({ preventScroll: true });
      } catch (e) {
        this.showOverlay(`<div class="veil"><div class="card"><h2>打不开这个关卡</h2><div class="note">${CT.esc(e.message)}</div>
          <div class="row"><button class="btn primary" id="oLobby" type="button">去大厅看看</button><button class="btn" id="oBack" type="button">关闭</button></div></div></div>`);
        $('oLobby').onclick = () => this.openLobby('new');
        $('oBack').onclick = () => this.hideOverlay();
      }
    },
    showAdmin() {
      this.showOverlay(`<div class="veil"><div class="card">
        <h2>管理员</h2>
        <div class="note">填入部署时设置的 ADMIN_KEY，大厅里每个关卡都会出现删除按钮。只保存在这台设备上。</div>
        <div class="field"><input id="oKey" type="password" autocomplete="off" placeholder="ADMIN_KEY"></div>
        <div class="row"><button class="btn primary" id="oSave" type="button">保存</button><button class="btn" id="oClear" type="button">清除</button><button class="btn" id="oBack" type="button">关闭</button></div></div></div>`);
      $('oKey').value = this.save.adminKey || '';
      $('oSave').onclick = () => { this.save.adminKey = $('oKey').value.trim() || null; this.persist(); this.openLobby('new'); };
      $('oClear').onclick = () => { this.save.adminKey = null; this.persist(); this.hideOverlay(); };
      $('oBack').onclick = () => this.hideOverlay();
    },

    // ------------------------------------------------------------ editor / custom levels
    openEditor(def) { clearTimeout(this.endTimer); this.lv = null; this.screen = 'editor'; this.hideOverlay(); this.show('editor'); CT.Editor.open(def); },
    startCustom(def, from, lobby) {
      const name = def.name ? `「${CT.esc(def.name)}」` : '自定义关卡';
      const label = lobby ? `大厅 · ${name}<span style="color:#8ea79c"> by ${CT.esc(lobby.author)}</span>` : name;
      this.startLevel({ mode: 'custom', from, lobby: lobby || null, index: 0, def: Object.assign({}, def, { hint: null }), label });
    },
    showShared(def) {
      this.pendingShared = def;
      const n = def.cells.length, w = def.fences.length;
      const nm = (def.name || '').replace(/[<>&]/g, '');
      this.showOverlay(`<div class="veil"><div class="card">
        <h2>朋友分享的关卡</h2>
        <div class="sub">${nm ? `「<em>${nm}</em>」 · ` : ''}${n} 个微生物 · ${w} 面墙 · 上限 <em>${def.maxPower}</em></div>
        <div class="row"><button class="btn primary" id="oPlay" type="button">立即挑战</button><button class="btn" id="oEdit" type="button">在编辑器中打开</button></div>
        <button class="btn small" id="oBack" type="button">取消</button></div></div>`);
      $('oPlay').onclick = () => { this.unlock(); this.startCustom(def, 'shared'); };
      $('oEdit').onclick = () => { this.unlock(); this.openEditor(def); };
      $('oBack').onclick = () => { this.hideOverlay(); if (this.screen !== 'editor') this.toHome(); };
      $('oPlay').focus({ preventScroll: true });
    },
    showImport(from, value, err) {
      this.showOverlay(`<div class="veil"><div class="card" style="width:360px">
        <h2>输入分享码</h2>
        <div class="note">把朋友发来的分享码（CT1. 开头）或分享链接粘贴到下面</div>
        <textarea id="oCode" spellcheck="false" placeholder="CT1.xxxxxxxx"></textarea>
        <div class="err" id="oErr"></div>
        <div class="row"><button class="btn primary" id="oPlay" type="button">载入</button><button class="btn" id="oBack" type="button">取消</button></div></div></div>`);
      const ta = $('oCode'); if (value) ta.value = value; if (err) $('oErr').textContent = err;
      ta.focus({ preventScroll: true });
      $('oPlay').onclick = () => {
        try { const def = Codec.decode(ta.value); this.showShared(def); }
        catch (e) { $('oErr').textContent = e.message; }
      };
      $('oBack').onclick = () => { this.hideOverlay(); if (from === 'editor') CT.Editor.refresh(); };
    },

    // ------------------------------------------------------------ playing a level
    startLevel(ctx) {
      clearTimeout(this.endTimer);
      this.unlock(); Audio.S.begin();
      this.ctx = ctx;
      const self = this;
      this.lv = new Level(ctx.def, {
        grow(l) { Audio.S.grow(l.orig.type === USER); },
        cut(l, by) { if (by === 'player') Audio.S.cut(); else if (by === 'wall') Audio.S.wallCut(); },
        captured(cell, was, now) { if (now === USER) Audio.S.occupied(true); else if (was === USER || !self.lv.suspended) Audio.S.occupied(false); },
        attached() { if (ctx.mode === 'ch1' && ctx.index === 0 && self.screen === 'play') self.showTutorial(1); },
        second() { $('hTime').textContent = String(self.lv.time); self.updateOcc(); },
        end(win) { self.onLevelEnd(win); },
      });
      this.screen = 'play'; this.paused = false;
      this.selected = this.drag = this.hover = null; this.tutorial = -1;
      const seed = ctx.mode === 'endless' ? 31 + ctx.index * 13 : ctx.mode === 'ch2' ? 501 + ctx.index * 7 : 11 + ctx.index * 7;
      this.fieldBg = R.paintFieldBg(seed, ctx.mode === 'ch2' ? ['#1d2a30', '#080f13'] : ctx.mode === 'endless' ? ['#2a1f30', '#0d0911'] : null);
      this.show('hud'); this.hideOverlay();
      $('hLabel').innerHTML = ctx.label; $('hMax').textContent = String(this.lv.maxPower); $('hTime').textContent = '0';
      $('bPause').innerHTML = ICON.pause;
      $('bMenuTxt').textContent = ctx.mode === 'custom' ? (ctx.from === 'editor' ? '编辑' : ctx.from === 'lobby' ? '大厅' : '返回') : '菜单';
      $('bRestart').classList.toggle('hidden', ctx.mode === 'endless');
      $('tutors').innerHTML = ''; $('tip').classList.add('hidden');
      this.renderChips();
      this.setStatus(this.lv.hint || '');
      if (ctx.mode === 'ch1' && ctx.index === 0) this.showTutorial(0);
      this.updateOcc();
    },
    restart() {
      if (!this.ctx || this.ctx.mode === 'endless') return;
      this.startLevel(this.ctx);
    },
    leaveLevel() {
      const c = this.ctx; clearTimeout(this.endTimer);
      if (!c) return this.toHome();
      if (c.mode === 'ch1' || c.mode === 'ch2') this.openCampaign(c.chapter);
      else if (c.mode === 'custom' && c.from === 'editor') this.openEditor();
      else if (c.mode === 'custom' && c.from === 'lobby') this.openLobby();
      else this.toHome();
    },
    setStatus(text, color) {
      const el = $('status'); clearInterval(this.typeTimer); clearTimeout(this.statusTimer);
      el.style.opacity = '1'; el.textContent = ''; el.style.color = color || '';
      if (!text) return;
      let k = 0; this.typeTimer = setInterval(() => { k++; el.textContent = text.slice(0, k); if (k >= text.length) clearInterval(this.typeTimer); }, 50);
      this.statusTimer = setTimeout(() => { el.style.opacity = '0'; }, 9000);
    },
    showTutorial(n) {
      this.tutorial = n;
      const box = $('tutors'); box.innerHTML = '';
      const d = document.createElement('div'); d.className = 'tutor';
      if (n === 0) { d.textContent = '拖动以进攻'; d.style.left = '420px'; d.style.top = '210px'; }
      else { d.textContent = '划过触手以切断'; d.style.left = '400px'; d.style.top = '298px'; }
      box.appendChild(d);
    },
    clearTutorial() { this.tutorial = -1; $('tutors').innerHTML = ''; },
    updateOcc() {
      const lv = this.lv; if (!lv) return;
      const parts = [[T.GREEN, '#33aa33'], [T.RED, '#aa3333'], [T.BLACK, '#111111'], [T.PURPLE, '#aa33aa']].map(([t, c]) => [lv.totalPower(t), c]);
      const sum = parts.reduce((s, p) => s + p[0], 0) || 1;
      $('occ').innerHTML = parts.filter(p => p[0] > 0).map(p => `<i style="width:${(p[0] / sum * 100).toFixed(2)}%;background:${p[1]}"></i>`).join('');
    },
    onLevelEnd(win) {
      const lv = this.lv, c = this.ctx; if (lv.suspended) return;
      lv.suspend(); this.selected = this.drag = null; this.clearTutorial();
      this.screen = 'ending';
      const time = lv.time;
      let gained = 0, first = false;
      if (c.mode === 'ch1' || c.mode === 'ch2') {
        const ch = CHAPTERS[c.chapter];
        if (win) {
          if (c.index + 2 > this.save[ch.openKey]) { gained = Math.max(5, 100 - time); this.save.score += gained; this.save[ch.openKey] = c.index + 2; first = true; }
          const prev = this.save[ch.bestKey][c.index + 1]; if (!prev || time < prev) this.save[ch.bestKey][c.index + 1] = time;
        }
      } else if (c.mode === 'endless') {
        if (win) { this.run.totalTime += time; this.save.endlessBest = Math.max(this.save.endlessBest, this.run.depth); }
        else this.save.run = null;
      } else if (c.mode === 'custom') {
        if (win && c.from === 'editor') this.save.verified = CT.Editor.layoutKey(c.def);
        if (c.from === 'lobby' && c.lobby) this.lobbyResult = CT.Lobby.recordPlay(c.lobby.id, win);
      }
      this.persist();
      if (win) Audio.S.passed(); else Audio.S.failed();
      this.endTimer = setTimeout(() => {
        if (this.lv !== lv) return;
        this.screen = 'end';
        if (c.mode === 'endless') return win ? this.showMutations() : this.showRunOver();
        if (win && (c.mode === 'ch1' || c.mode === 'ch2') && c.index === CHAPTERS[c.chapter].levels.length - 1) return this.showFinal(c.chapter);
        this.showEnd(win, time, gained, first);
      }, 1100);
    },

    // ------------------------------------------------------------ overlays
    showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); },
    hideOverlay() { $('overlay').classList.add('hidden'); $('overlay').innerHTML = ''; },
    showEnd(win, time, gained, first) {
      const c = this.ctx, campaign = c.mode === 'ch1' || c.mode === 'ch2';
      const best = campaign ? this.save[CHAPTERS[c.chapter].bestKey][c.index + 1] : null;
      const where = campaign ? `第 <em>${c.index + 1}</em> 关${c.def.name ? ' · ' + c.def.name : ''}` : c.label.replace(/<[^>]+>/g, '');
      const next = campaign && win ? `<button class="btn primary" id="oNext" type="button">下一关</button>` : '';
      const back = c.mode === 'custom' ? (c.from === 'editor' ? '返回编辑器' : c.from === 'lobby' ? '返回大厅' : '返回首页') : '关卡选择';
      const lobby = c.mode === 'custom' && c.from === 'lobby' && c.lobby;
      const liked = lobby && (this.save.liked || []).includes(lobby.id);
      const verifyNote = c.mode === 'custom' && c.from === 'editor' && win ? '<div class="note" style="color:var(--ok)">已通关验证，现在可以在编辑器里点「上传」放进大厅了</div>' : '';
      const lobbyRow = lobby ? `<div class="row"><button class="ibtn like${liked ? ' on' : ''}" id="oLike" type="button"><svg viewBox="0 0 12 12"><path d="M6 10.2 2.2 6.5a2.3 2.3 0 0 1 3.3-3.2L6 3.8l.5-.5a2.3 2.3 0 0 1 3.3 3.2z"/></svg>${liked ? '已点赞' : '点赞这个关卡'}</button>${this.canLink() ? '<button class="ibtn" id="oLink" type="button">复制关卡链接</button>' : ''}<button class="ibtn" id="oReport" type="button">举报</button></div><div class="note" id="oStats"></div>` : '';
      this.showOverlay(`<div class="veil"><div class="card">
        <h2 style="color:${win ? 'var(--ok)' : 'var(--alert)'}">${win ? '区域已占领' : '全军覆没'}</h2>
        <div class="sub">${where} &nbsp;·&nbsp; 时间 <em>${time}</em> 秒${win && best ? ` &nbsp;·&nbsp; 最快 <em>${best}</em>` : ''}</div>
        ${campaign ? `<div class="sub">${first ? `首次占领 +<em>${gained}</em> 分 &nbsp;·&nbsp; ` : ''}总积分 <em>${this.save.score}</em></div>` : ''}
        <div class="row">${next}<button class="btn ${next ? '' : 'primary'}" id="oRetry" type="button">${win ? '重玩' : '再来一次'}</button><button class="btn" id="oMenu" type="button">${back}</button></div>
        ${c.mode === 'custom' && c.from === 'shared' ? '<button class="btn small" id="oEdit" type="button">在编辑器中打开</button>' : ''}${verifyNote}${lobbyRow}</div></div>`);
      if (lobby) {
        const stats = $('oStats');
        Promise.resolve(this.lobbyResult).then(r => { if (r && stats.isConnected) stats.textContent = `这一关已被挑战 ${r.plays} 次，胜率 ${Math.round(r.wins / Math.max(1, r.plays) * 100)}%`; });
        $('oLike').onclick = async () => {
          const b = $('oLike'); if (b.classList.contains('on')) return;
          try { const r = await CT.Lobby.like({ id: lobby.id, likes: lobby.likes }, null); b.classList.add('on'); b.lastChild.textContent = `已点赞 · ${r.likes}`; }
          catch (e) { b.lastChild.textContent = '点赞失败'; }
        };
        if ($('oLink')) $('oLink').onclick = () => this.copyText(`${location.origin}${location.pathname}#L.${lobby.id}`, $('oLink'), '复制关卡链接');
        $('oReport').onclick = async () => {
          const b = $('oReport'); if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = '确认举报？'; return; }
          try { await CT.Lobby.report(lobby.id); b.textContent = '已举报'; b.disabled = true; } catch (e) { b.textContent = '举报失败'; }
        };
      }
      if ($('oNext')) $('oNext').onclick = () => this.startCampaign(c.chapter, c.index + 1);
      $('oRetry').onclick = () => this.startLevel(c);
      $('oMenu').onclick = () => this.leaveLevel();
      if ($('oEdit')) $('oEdit').onclick = () => this.openEditor(c.def);
      ($('oNext') || $('oRetry')).focus({ preventScroll: true });
    },
    showFinal(ch) {
      this.showOverlay(`<div class="veil"><div class="card" style="width:350px">
        <h2 style="color:var(--ok)">${ch === 1 ? '培养皿已全部占领' : '异变已被平息'}</h2>
        <div class="sub">${ch === 1 ? '20' : '10'} 个区域全部拿下 &nbsp;·&nbsp; 总积分 <em>${this.save.score}</em></div>
        <div class="note">${ch === 1 ? '原作：Lumarama《Tentacle Wars: The Purple Menace》(2011)<br>接下来试试第二章、无尽进化，或者自己做关卡' : '还没过瘾的话，去无尽进化里看看能走多深'}</div>
        <div class="row"><button class="btn primary" id="oMenu" type="button">${ch === 1 ? '去第二章' : '无尽进化'}</button><button class="btn" id="oHome" type="button">返回首页</button></div></div></div>`);
      $('oMenu').onclick = () => ch === 1 ? this.openCampaign(2) : this.openEndless();
      $('oHome').onclick = () => this.toHome();
    },
    showHelp(fromGame) {
      const evo = EVO.map(e => `<span style="white-space:nowrap">${e.name}·${e.links}触手</span>`).join(' → ');
      const kinds = Object.values(KINDS).map(k => `<span><b>${k.name}</b>${k.desc}</span>`).join('') + '<span><b>游走</b>沿虚线轨迹来回移动</span><span><b>移动之墙</b>会切断它扫过的触手</span>';
      this.showOverlay(`<div class="veil"><div class="card help">
        <h2>玩法说明</h2>
        <ul>
          <li><b>伸出</b><span>按住你的<span style="color:var(--ok)">绿色</span>微生物拖到目标上松开，伸出触手。每长一节消耗 1 点能量，能量不够时触手会缩回来。</span></li>
          <li><b>输送</b><span>触手接上后持续输送能量：削弱敌人（归零即占领）、灌入中立、或支援自己人。连出去的触手越多，自身增长越慢。</span></li>
          <li><b>切断</b><span>在空白处划过自己的触手。切口到你这边的部分收回，到目标那边的部分一口气灌进目标。靠近自己切 = 猛攻，靠近敌人切 = 回收能量。</span></li>
          <li><b>中立</b><span>灰色微生物不增长，灌入其能量的 1/3 即可占领，占领后保留原有能量。</span></li>
          <li><b>进化</b><span class="evo">${evo}</span></li>
          <li><b>异变</b><span class="kinds">${kinds}</span></li>
          <li><b>其他</b><span>相向的触手在中点交锋；墙挡住触手。占领所有非中立的外来微生物即过关。快捷键：P 暂停、R 重来、Esc 返回。</span></li>
        </ul>
        <div class="row"><button class="btn primary" id="oClose" type="button">${fromGame ? '继续游戏' : '知道了'}</button></div>
      </div></div>`);
      $('oClose').onclick = () => { this.hideOverlay(); if (fromGame) this.setPaused(false); };
      $('oClose').focus({ preventScroll: true });
    },
    setPaused(p, silent) {
      if (this.screen !== 'play') return;
      this.paused = p;
      $('bPause').innerHTML = p ? ICON.play : ICON.pause;
      if (p && !silent) {
        this.showOverlay(`<div class="veil" id="pauseVeil"><div class="card"><h2>已暂停</h2><div class="sub">点击任意处继续</div></div></div>`);
        $('pauseVeil').onclick = () => this.setPaused(false);
      } else if (!p) this.hideOverlay();
      this.selected = this.drag = null;
    },
    onKey(e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (this.screen === 'editor') return CT.Editor.onKey(e);
      if (e.key === 'Escape') {
        if (!$('overlay').classList.contains('hidden') && this.screen !== 'play' && this.screen !== 'end') { this.hideOverlay(); return; }
        if (this.screen === 'play' || this.screen === 'end') this.leaveLevel();
        else if (this.screen === 'campaign' || this.screen === 'lobby') this.toHome();
      }
      if (this.screen === 'play') {
        if (e.key === 'p' || e.key === 'P' || e.key === ' ') { e.preventDefault(); this.setPaused(!this.paused); }
        if (e.key === 'r' || e.key === 'R') this.restart();
      }
    },

    // ------------------------------------------------------------ input
    toLocal(e) { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / R.scale, y: (e.clientY - r.top) / R.scale }; },
    cellAt(x, y, touch) {
      if (!this.lv) return null;
      let best = null, bd = 1e9;
      for (const c of this.lv.cells) {
        const d = Math.hypot(c.x - x, c.y - y), r = c.radius() + (touch ? 10 : 2);
        if (d <= r && d < bd) { bd = d; best = c; }
      }
      return best;
    },
    onDown(e) {
      if (e.target.closest && e.target.closest('button,input,textarea,#edPanel')) return;
      const p = this.toLocal(e), touch = e.pointerType !== 'mouse';
      this.pointer = { x: p.x, y: p.y, touch };
      if (this.screen === 'editor') { try { stage.setPointerCapture(e.pointerId); } catch (_) { } CT.Editor.onDown(p, e); e.preventDefault(); return; }
      if (this.screen !== 'play' || this.paused) return;
      this.unlock();
      try { stage.setPointerCapture(e.pointerId); } catch (_) { }
      const c = this.cellAt(p.x, p.y, touch);
      this.selected = null; this.drag = null;
      if (c) {
        if (c.type === USER && c.linkCount < c.maxLinks) { this.selected = c; this.drag = { x0: c.x, y0: c.y, mode: 'link' }; }
        this.hover = c; this.tipUntil = performance.now() + 2200;
      } else this.drag = { x0: p.x, y0: p.y, mode: 'cut' };
      e.preventDefault();
    },
    onMove(e) {
      const p = this.toLocal(e), touch = e.pointerType !== 'mouse';
      this.pointer.x = p.x; this.pointer.y = p.y; this.pointer.touch = touch;
      if (this.screen === 'editor') { CT.Editor.onMove(p, e); return; }
      if (this.screen !== 'play') return;
      if (!touch || this.drag) this.hover = this.cellAt(p.x, p.y, touch);
    },
    onUp(e) {
      const p = this.toLocal(e), touch = e.pointerType !== 'mouse';
      if (this.screen === 'editor') { CT.Editor.onUp(p, e); return; }
      if (this.screen !== 'play' || !this.drag) { this.drag = null; this.selected = null; return; }
      const d = this.drag; this.drag = null;
      if (d.mode === 'link' && this.selected) {
        const tgt = this.cellAt(p.x, p.y, touch);
        if (tgt && tgt !== this.selected) {
          const ok = this.lv.createLink(this.selected, tgt);
          if (!ok && this.lv.blocked(this.selected, tgt)) this.flashMsg = { text: '被墙挡住了', x: p.x, y: p.y, t: performance.now() };
        }
      } else if (d.mode === 'cut' && Math.hypot(p.x - d.x0, p.y - d.y0) > 4) {
        const any = this.lv.cut(d.x0, d.y0, p.x, p.y);
        if (any) this.clearTutorial();
        this.slash = { x0: d.x0, y0: d.y0, x1: p.x, y1: p.y, t: performance.now() };
      }
      this.selected = null;
      if (touch) this.tipUntil = performance.now() + 1800;
    },
    hoverVisible(now) { return !!this.hover && (!this.pointer.touch || !!this.drag || now < (this.tipUntil || 0)); },
    updateTip(now) {
      const tip = $('tip'), c = this.hover;
      const show = c && this.screen === 'play' && !this.drag && this.hoverVisible(now);
      if (!show) { tip.classList.add('hidden'); return; }
      const team = R.TEAM[c.type], col = team.label;
      let html = `<div><span class="k">阵营</span><span style="color:${col}">${team.name}</span> &nbsp;<span class="k">等级</span><span style="color:${col}">${EVO[c.evo].name}</span></div>`;
      if (c.kind) html += `<div><span class="kd">${KINDS[c.kind].name}</span> <span class="k">${KINDS[c.kind].desc}</span></div>`;
      if (c.motion) html += `<div><span class="kd">游走</span> <span class="k">沿虚线来回移动</span></div>`;
      html += `<div><span class="k">能量</span><span class="v">${c.power}</span><span class="k" style="margin-left:2px">/ ${c.maxPower}</span></div>`;
      if (c.type === T.GREY) {
        const need = Math.trunc(c.power / this.lv.mod(USER).greyDiv);
        html += `<div><span class="k">你的占领进度</span><span class="v">${c.occType === USER ? c.occPower : 0}</span><span class="k" style="margin-left:2px">/ ${need}</span></div>`;
      } else html += `<div><span class="k">触手</span><span class="v">${c.linkCount}</span><span class="k" style="margin-left:2px">/ ${c.maxLinks}</span></div>`;
      tip.innerHTML = html; tip.classList.remove('hidden');
      const above = c.y > H / 2; let x = c.x; x = Math.max(110, Math.min(W - 110, x));
      const r = c.radius();
      tip.style.left = x + 'px';
      tip.style.top = (above ? c.y - r - 12 - tip.offsetHeight : c.y + r + 12) + 'px';
    },
  };

  // ------------------------------------------------------------ main loop
  let lastT = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(250, now - lastT); lastT = now;
    const lv = game.lv;
    if (lv && (game.screen === 'play' || game.screen === 'ending' || game.screen === 'end') && !game.paused) {
      acc += dt * (game.screen === 'play' ? game.speed : 1);
      let n = 0;
      while (acc >= TICK_MS && n < 12) { lv.tick(); acc -= TICK_MS; n++; }
      if (n >= 12) acc = 0;
      game.lastAlpha = acc / TICK_MS;
    }
    render(now / 1000, game.lastAlpha);
    game.updateTip(now);
    requestAnimationFrame(frame);
  }

  function render(t, a) {
    R.begin();
    const ctx = R.ctx;
    if (game.screen === 'home') return renderHome(t);
    if (game.screen === 'lobby') { R.ctx.drawImage(game.menuBg, 0, 0, W, H); return; }
    if (game.screen === 'campaign') return renderCampaign(t);
    if (game.screen === 'editor') return CT.Editor.render(t);
    ctx.drawImage(game.fieldBg, 0, 0, W, H);
    const lv = game.lv; if (!lv) return;
    const hv = game.screen === 'play' && game.hoverVisible(performance.now());
    for (const c of lv.cells) if (c.motion) R.drawCellPath(c);
    for (const l of lv.links) R.drawLink(l, t, a);
    for (const f of lv.fences) R.drawFence(f, a);
    if (game.tutorial === 0) R.dashedArrow(362, 222, 485, 162, t);
    if (game.tutorial === 1) R.dashedArrow(346, 158, 405, 281, t);
    for (const c of lv.cells) R.drawCell(c, t, a, hv && c === game.hover, c === game.selected);
    const d = game.drag, p = game.pointer;
    if (d && game.screen === 'play') {
      if (d.mode === 'link' && game.selected) {
        const s = game.selected, tgt = game.hover && game.hover !== s ? game.hover : null;
        const ex = tgt ? tgt.x : p.x, ey = tgt ? tgt.y : p.y;
        const blocked = tgt && lv.blocked(s, tgt);
        ctx.save(); ctx.shadowColor = blocked ? '#000' : 'rgba(255,255,85,0.6)'; ctx.shadowBlur = 8;
        R.arrowLine(s.x, s.y, ex, ey, blocked ? 'rgba(170,170,170,0.8)' : '#ffff55', 3, true);
        ctx.restore();
        if (tgt) {
          const dist = Math.hypot(tgt.x - s.x, tgt.y - s.y) - s.radius() - tgt.radius();
          let cost = Math.trunc(Math.max(0, dist) / SEG_STEP); if (cost < 5) cost += 1; cost += 1;
          const rev = lv.getLink(tgt, s);
          if (rev && tgt.type !== s.type) cost = Math.ceil(cost / 2);
          cost = Math.ceil(cost * lv.mod(USER).segCost);
          R.pill((s.x + ex) / 2, (s.y + ey) / 2 - 12, blocked ? '有墙阻挡' : `需 ${cost} 能量`, blocked ? '#cccccc' : (cost > s.power ? '#ff7777' : '#ffff88'));
        }
      } else if (d.mode === 'cut' && Math.hypot(p.x - d.x0, p.y - d.y0) > 3) {
        ctx.save(); ctx.shadowColor = 'rgba(255,85,85,0.7)'; ctx.shadowBlur = 8;
        R.arrowLine(d.x0, d.y0, p.x, p.y, '#ff5555', 3, false); ctx.restore();
      }
    }
    const sl = game.slash;
    if (sl) {
      const k = (performance.now() - sl.t) / 260;
      if (k >= 1) game.slash = null;
      else { ctx.save(); ctx.globalAlpha = 1 - k; R.arrowLine(sl.x0, sl.y0, sl.x1, sl.y1, 'rgba(255,200,200,0.9)', 2 * (1 - k) + 0.5, false); ctx.restore(); }
    }
    const fm = game.flashMsg;
    if (fm) {
      const k = (performance.now() - fm.t) / 1200;
      if (k >= 1) game.flashMsg = null;
      else R.pill(fm.x, fm.y - 24 - k * 10, fm.text, '#ffdddd', `rgba(40,10,10,${0.85 * (1 - k)})`);
    }
  }

  function renderHome(t) {
    const ctx = R.ctx;
    ctx.drawImage(game.menuBg, 0, 0, W, H);
    for (const c of game.showcase.cells) R.drawCell(c, t, 1, false, false);
  }
  const menuTendrils = Array.from({ length: 20 }, (_, i) => ({ dark: (i * 7) % 3 === 0, len: 10 + ((i * 37) % 12), spot: i % 3 !== 1, ph: i * 1.3 }));
  function renderCampaign(t) {
    const ctx = R.ctx, { cx, cy, r } = RING, TAU = Math.PI * 2, n = game.zoneCount();
    ctx.drawImage(game.menuBg, 0, 0, W, H);
    const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, r + 70);
    const tint = game.chapter === 2 ? '255,200,80' : '51,170,51';
    g.addColorStop(0, `rgba(${tint},0.10)`); g.addColorStop(0.55, `rgba(${tint},0.04)`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r + 70, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = 'rgba(10,26,22,0.72)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(238,238,238,0.9)'; ctx.stroke();
    for (let i = 0; i < n; i++) {
      const p = game.zonePos(i);
      ctx.beginPath(); ctx.moveTo(Math.cos(p.ang) * r + cx, Math.sin(p.ang) * r + cy); ctx.lineTo(Math.cos(p.ang) * p.r2 + cx, Math.sin(p.ang) * p.r2 + cy);
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(238,238,238,0.8)'; ctx.stroke();
      const tt = menuTendrils[i], a0 = p.ang + Math.PI / n;
      ctx.beginPath();
      const bx = Math.cos(a0) * r + cx, by = Math.sin(a0) * r + cy; ctx.moveTo(bx, by);
      let px = bx, py = by;
      for (let k = 1; k <= 6; k++) {
        const s = k / 6, w = Math.sin(t * 1.6 + tt.ph + k * 0.9) * 3 * s, along = r + tt.len * s;
        px = Math.cos(a0) * along + cx + Math.cos(a0 + Math.PI / 2) * w; py = Math.sin(a0) * along + cy + Math.sin(a0 + Math.PI / 2) * w;
        ctx.lineTo(px, py);
      }
      ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = tt.dark ? 'rgba(10,10,10,0.95)' : 'rgba(136,136,136,0.95)'; ctx.stroke();
      if (tt.spot) { ctx.beginPath(); ctx.arc(px, py, 2.2, 0, TAU); ctx.fillStyle = tt.dark ? '#888' : '#ddd'; ctx.fill(); }
    }
    for (let k = 0; k < 5; k++) {
      const a = t * (0.1 + k * 0.03) + k * 1.7, rr = 28 + (k % 3) * 14;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a * 1.3) * rr * 0.6;
      const rgb = [[51, 170, 51], [170, 51, 51], [170, 51, 170], [17, 17, 17], [255, 200, 80]][k];
      ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fillStyle = R.rgba(rgb, 0.35); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(238,238,238,0.25)'; ctx.stroke();
    }
  }

  window.addEventListener('resize', () => R.resize(stage));
  R.resize(stage);
  game.init();
  requestAnimationFrame(frame);
  CT.game = game; window.__game = game;
})(window.CT);
