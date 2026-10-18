'use strict';
// Level lobby: API client, thumbnails and the lobby screen.
(function (CT) {
  const { W, H, T, K, Codec, R, Audio } = CT;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TEAM_HEX = { 1: '#888888', 2: '#aa3333', 3: '#33aa33', 4: '#141414', 5: '#aa33aa' };
  const KIND_HEX = { [K.AMP]: '#ffc850', [K.SHELL]: '#e8dcc0', [K.TOXIN]: '#b8e04a', [K.LEECH]: '#ff6e8c' };
  const ICON = {
    play: '<svg viewBox="0 0 12 12"><path d="M4 2.5l5 3.5-5 3.5z"/></svg>',
    heart: '<svg viewBox="0 0 12 12"><path d="M6 10.2 2.2 6.5a2.3 2.3 0 0 1 3.3-3.2L6 3.8l.5-.5a2.3 2.3 0 0 1 3.3 3.2z"/></svg>',
    trash: '<svg viewBox="0 0 12 12"><path d="M2.5 3.5h7M5 3.5V2.3h2v1.2M3.5 3.5l.5 6.5h4l.5-6.5"/></svg>',
  };

  // ---------------------------------------------------------------- API
  const API = {
    base: 'api',
    async req(path, opts = {}) {
      let r;
      const headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
      try { r = await fetch(this.base + path, Object.assign({}, opts, { headers })); }
      catch (e) { throw new Error('连不上大厅服务器，请检查网络'); }
      let data = null;
      try { data = await r.json(); } catch (e) { }
      if (!r.ok || !data) {
        if (data && data.error) throw new Error(data.error);
        throw new Error(r.status === 404 || r.status === 405 ? '大厅服务还没有部署到这个网址' : `大厅服务器出错（${r.status}）`);
      }
      return data;
    },
    post(path, body, headers) { return this.req(path, { method: 'POST', body: JSON.stringify(body || {}), headers }); },
    stats() { return this.req('/stats'); },
    list(sort, offset, q) { return this.req(`/levels?sort=${encodeURIComponent(sort)}&offset=${offset | 0}${q ? '&q=' + encodeURIComponent(q) : ''}`); },
    byIds(ids) { return this.req(`/levels?ids=${ids.map(encodeURIComponent).join(',')}`); },
    get(id) { return this.req(`/levels/${encodeURIComponent(id)}`); },
    upload(code, name, author, client) { return this.post('/levels', { code, name, author, client }); },
    play(id, won) { return this.post(`/levels/${encodeURIComponent(id)}/play`, { won: !!won }); },
    vote(id, kind, client) { return this.post(`/levels/${encodeURIComponent(id)}/${kind}`, { client }); },
    remove(id, client, adminKey) {
      const headers = { 'x-client': client || '' }; if (adminKey) headers['x-admin-key'] = adminKey;
      return this.req(`/levels/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
    },
  };

  // ---------------------------------------------------------------- thumbnails
  function drawThumb(canvas, def) {
    const cw = canvas.clientWidth || 96, ch = canvas.clientHeight || 72, dpr = Math.min(window.devicePixelRatio || 1, 2) * (R.scale || 1);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    const bg = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.7);
    bg.addColorStop(0, '#183630'); bg.addColorStop(1, '#08130f');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.lineCap = 'round';
    for (const f of def.fences) {
      g.strokeStyle = f.period ? '#c08a50' : '#8a8a58'; g.lineWidth = 16;
      g.beginPath(); g.moveTo(f.x1, f.y1); g.lineTo(f.x2, f.y2); g.stroke();
    }
    for (const c of def.cells) {
      const r = (18 + Math.min(c.power, def.maxPower) / 10) * 1.8;
      if (c.period) { g.strokeStyle = 'rgba(200,230,255,0.35)'; g.lineWidth = 5; g.beginPath(); g.moveTo(c.x - c.mx, c.y - c.my); g.lineTo(c.x + c.mx, c.y + c.my); g.stroke(); }
      g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2);
      g.fillStyle = TEAM_HEX[c.type] || '#888'; g.fill();
      g.lineWidth = c.kind ? 12 : 7; g.strokeStyle = c.kind ? KIND_HEX[c.kind] : '#e8e8e8'; g.stroke();
    }
  }

  function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
    const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------- screen
  const L = {
    game: null, sort: 'new', q: '', items: [], offset: 0, more: false, busy: false, seq: 0,
    init(game) {
      this.game = game;
      $('lBack').onclick = () => game.toHome();
      $('lCreate').onclick = () => game.openEditor();
      for (const b of $('lTabs').children) b.onclick = () => this.open(b.dataset.s);
      let tq = null;
      $('lQ').oninput = e => { clearTimeout(tq); tq = setTimeout(() => { this.q = e.target.value.trim(); if (this.sort === 'mine') this.sort = 'new'; this.reload(); }, 350); };
      $('lList').addEventListener('click', e => this.onClick(e));
    },
    get save() { return this.game.save; },
    client() {
      if (!this.save.client) { const a = crypto.getRandomValues(new Uint8Array(12)); this.save.client = [...a].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 20); this.game.persist(); }
      return this.save.client;
    },
    open(sort) {
      if (sort) this.sort = sort;
      for (const b of $('lTabs').children) b.classList.toggle('on', b.dataset.s === this.sort);
      $('lQ').classList.toggle('hidden', this.sort === 'mine');
      this.reload();
    },
    state(html) { const s = $('lState'); s.innerHTML = html || ''; s.classList.toggle('hidden', !html); },
    async reload() {
      const seq = ++this.seq;
      this.items = []; this.offset = 0; this.more = false;
      $('lList').innerHTML = ''; this.state('<div class="spin"></div>正在载入…');
      try {
        let data;
        if (this.sort === 'mine') {
          const mine = this.save.myLevels || [];
          if (!mine.length) { this.state('你还没有上传过关卡<br><span class="sub">在编辑器里设计一关，试玩通关后点「上传」</span>'); return; }
          data = await API.byIds(mine.map(m => m.id));
          const alive = new Set(data.items.map(i => i.id));
          if (alive.size !== mine.length) { this.save.myLevels = mine.filter(m => alive.has(m.id)); this.game.persist(); }
        } else data = await API.list(this.sort, 0, this.q);
        if (seq !== this.seq) return;
        this.items = data.items; this.more = data.more; this.offset = data.items.length;
        this.render();
      } catch (e) {
        if (seq !== this.seq) return;
        this.state(`大厅暂时用不了：${esc(e.message)}<br><span class="sub">游戏部署到 Cloudflare Pages 并绑定名为 DB 的 D1 数据库后，大厅就能用了（步骤见仓库 README）</span>`);
      }
    },
    async loadMore(btn) {
      if (this.busy) return; this.busy = true; btn.disabled = true; btn.textContent = '载入中…';
      try {
        const data = await API.list(this.sort, this.offset, this.q);
        this.items = this.items.concat(data.items); this.more = data.more; this.offset += data.items.length;
        this.render();
      } catch (e) { btn.disabled = false; btn.textContent = '载入失败，点击重试'; }
      this.busy = false;
    },
    render() {
      const list = $('lList');
      if (!this.items.length) {
        list.innerHTML = '';
        this.state(this.sort === 'mine' ? '你还没有上传过关卡<br><span class="sub">在编辑器里设计一关，试玩通关后点「上传」</span>'
          : this.q ? `没有找到和「${esc(this.q)}」有关的关卡` : '大厅里还没有关卡<br><span class="sub">去编辑器做第一个吧</span>');
        return;
      }
      this.state('');
      const liked = new Set(this.save.liked || []), mine = new Set((this.save.myLevels || []).map(m => m.id)), admin = !!this.save.adminKey;
      list.innerHTML = this.items.map((it, i) => {
        const rate = it.plays ? Math.round(it.wins / it.plays * 100) + '%' : '—';
        const del = mine.has(it.id) || admin;
        return `<div class="lvItem" data-i="${i}">
          <canvas class="thumb" aria-hidden="true"></canvas>
          <div class="meta">
            <b title="${esc(it.name)}">${esc(it.name)}</b>
            <span class="by">${esc(it.author)} · ${ago(it.created)}</span>
            <span class="st">${it.cells} 个微生物${it.fences ? ` · ${it.fences} 面墙` : ''} · 上限 ${it.maxPower}</span>
            <span class="st">挑战 ${it.plays} 次 · 胜率 ${rate}</span>
          </div>
          <div class="acts">
            <button class="ibtn primary" type="button" data-act="play">${ICON.play}挑战</button>
            <button class="ibtn like${liked.has(it.id) ? ' on' : ''}" type="button" data-act="like" title="点赞">${ICON.heart}${it.likes}</button>
            ${del ? `<button class="ibtn" type="button" data-act="del" title="删除这个关卡">${ICON.trash}</button>` : ''}
          </div></div>`;
      }).join('') + (this.more ? '<div class="lMore"><button class="btn small" type="button" data-act="more">加载更多</button></div>' : '');
      const thumbs = list.querySelectorAll('.thumb');
      this.items.forEach((it, i) => { try { drawThumb(thumbs[i], Codec.decode(it.code)); } catch (e) { } });
    },
    async onClick(e) {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'more') return this.loadMore(b);
      const card = b.closest('.lvItem'), it = this.items[+card.dataset.i]; if (!it) return;
      if (act === 'play') { Audio.S.click(); return this.play(it); }
      if (act === 'like') return this.like(it, b);
      if (act === 'del') {
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.classList.add('on'); b.innerHTML = '确认删除？'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.classList.remove('on'); b.innerHTML = ICON.trash; } }, 2500); return; }
        try {
          await API.remove(it.id, this.client(), this.save.adminKey);
          this.save.myLevels = (this.save.myLevels || []).filter(m => m.id !== it.id); this.game.persist();
          this.items.splice(+card.dataset.i, 1); this.render(); Audio.S.remove();
        } catch (err) { b.innerHTML = '删除失败'; b.title = err.message; }
      }
    },
    play(it) {
      let def;
      try { def = Codec.decode(it.code); } catch (e) { return this.state('这个关卡的数据坏了，换一个试试'); }
      def.name = it.name;
      this.game.startCustom(def, 'lobby', { id: it.id, name: it.name, author: it.author, likes: it.likes });
    },
    async like(it, btn) {
      const liked = new Set(this.save.liked || []);
      if (liked.has(it.id)) return;
      try {
        const r = await API.vote(it.id, 'like', this.client());
        it.likes = r.likes; liked.add(it.id); this.save.liked = [...liked].slice(-500); this.game.persist();
        if (btn) { btn.classList.add('on'); btn.innerHTML = ICON.heart + r.likes; }
        Audio.S.place();
        return r;
      } catch (e) { if (btn) btn.title = e.message; throw e; }
    },
    async report(id) { return API.vote(id, 'report', this.client()); },
    async recordPlay(id, won) { try { return await API.play(id, won); } catch (e) { return null; } },
    async upload(def, name, author) {
      const code = Codec.encode(Object.assign({}, def, { name }));
      const r = await API.upload(code, name, author, this.client());
      if (!r.duplicate) {
        this.save.myLevels = [{ id: r.id, name }].concat((this.save.myLevels || []).filter(m => m.id !== r.id)).slice(0, 50);
        this.game.persist();
      }
      return r;
    },
    async homeCount(el) {
      try { const r = await API.stats(); el.textContent = r.count ? `已有 ${r.count} 个玩家关卡` : '还没有关卡，来做第一个'; }
      catch (e) { el.textContent = '部署到 Cloudflare 后开放'; }
    },
  };

  CT.Lobby = L; CT.LobbyAPI = API; CT.drawThumb = drawThumb; CT.esc = esc;
})(window.CT);
