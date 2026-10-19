// Cloudflare Pages Function — the level lobby API, backed by a D1 database bound as `DB`.
// Tables are created automatically on first use; the only setup is the binding.
//
//   GET    /api/stats                      → { count }
//   GET    /api/levels?sort=new|hot|top&offset=0&q=   → { items, more }
//   GET    /api/levels?ids=a,b,c           → { items }
//   GET    /api/levels/:id                 → { level }
//   POST   /api/levels        {code,name,author,client}  → { id, duplicate }
//   POST   /api/levels/:id/play   {won}    → { plays, wins, likes }
//   POST   /api/levels/:id/like   {client} → { counted, plays, wins, likes }
//   POST   /api/levels/:id/report {client} → { counted, ... }
//   DELETE /api/levels/:id   header x-client (the uploader) or x-admin-key (env.ADMIN_KEY)

const PREFIX = 'CT1.';
const LIMITS = { cells: 30, fences: 50, code: 2400, body: 8000 };
const PAGE = 20;
const HIDE_AT_REPORTS = 5;
const UPLOADS_PER_HOUR = 10;
const ID_RE = /^[a-z0-9]{6,12}$/;
const COLS = 'id, code, name, author, cells, fences, max_power, plays, wins, likes, created';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const fail = (status, error) => json({ error }, status);
const row = r => ({ id: r.id, code: r.code, name: r.name, author: r.author, cells: r.cells, fences: r.fences, maxPower: r.max_power, plays: r.plays, wins: r.wins, likes: r.likes, created: r.created });
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------------------------------------------------------------- level-data decoding (mirror of js/codec.js)
const unzig = n => (n >>> 1) ^ -(n & 1);
function decode(text) {
  let s = String(text || '').trim();
  if (!s.startsWith(PREFIX)) throw new Error('这不是有效的关卡数据');
  s = s.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('关卡数据里有无法识别的字符');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  let bin;
  try { bin = atob(b64 + '==='.slice((b64.length + 3) % 4)); } catch (e) { throw new Error('关卡数据里有无法识别的字符'); }
  const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let p = 0;
  const rd = () => {
    let n = 0, sh = 0, b;
    do { if (p >= bytes.length) throw new Error('关卡数据不完整'); b = bytes[p++]; n |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80 && sh < 35);
    return n >>> 0;
  };
  const maxPower = rd(), cpuTurn = rd(), nc = rd(), nf = rd();
  if (nc > LIMITS.cells || nf > LIMITS.fences) throw new Error('微生物或墙太多');
  const cells = [], fences = [];
  for (let i = 0; i < nc; i++) cells.push({ type: rd(), power: rd(), x: rd(), y: rd(), kind: rd(), mx: unzig(rd()), my: unzig(rd()), period: rd() * 10 });
  for (let i = 0; i < nf; i++) fences.push({ x1: rd(), y1: rd(), x2: rd(), y2: rd(), mx: unzig(rd()), my: unzig(rd()), period: rd() * 10 });
  const nl = rd(); if (p + nl > bytes.length) throw new Error('关卡数据不完整');
  const name = new TextDecoder().decode(bytes.slice(p, p + nl)); p += nl;
  let sum = 0; for (let i = 0; i < p; i++) sum = (sum * 31 + bytes[i]) % 65521;
  if (rd() !== sum) throw new Error('关卡数据校验失败');
  if (!(maxPower >= 10 && maxPower <= 999)) throw new Error('能量上限超出范围');
  for (const c of cells) if (!(c.type >= 1 && c.type <= 5) || c.kind > 4 || c.x > 640 || c.y > 480 || c.power > 999) throw new Error('有无效的微生物');
  for (const f of fences) if ([f.x1, f.y1, f.x2, f.y2].some(v => v > 700)) throw new Error('有无效的墙');
  if (!cells.some(c => c.type === 3) || !cells.some(c => c.type !== 3 && c.type !== 1)) throw new Error('至少需要一个绿色微生物和一个敌方微生物');
  return { name, maxPower, cpuTurn, cells, fences };
}
const layoutKey = d => `${d.maxPower}/${d.cpuTurn}/` + d.cells.map(c => [c.type, c.power, c.x, c.y, c.kind, c.mx, c.my, c.period].join(',')).join(';') + '/' + d.fences.map(f => [f.x1, f.y1, f.x2, f.y2, f.mx, f.my, f.period].join(',')).join(';');

async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function newId() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(8));
  return [...r].map(x => abc[x % abc.length]).join('');
}
async function readJson(request) {
  const text = await request.text();
  if (text.length > LIMITS.body) throw Object.assign(new Error('请求太大'), { status: 413 });
  try { return text ? JSON.parse(text) : {}; } catch (e) { throw Object.assign(new Error('请求格式不对'), { status: 400 }); }
}

// ---------------------------------------------------------------- schema
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS levels (
      id TEXT PRIMARY KEY, code TEXT NOT NULL, layout TEXT NOT NULL UNIQUE, name TEXT NOT NULL, author TEXT NOT NULL,
      cells INTEGER NOT NULL, fences INTEGER NOT NULL, max_power INTEGER NOT NULL,
      plays INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL, owner TEXT, ip TEXT)`),
    db.prepare('CREATE INDEX IF NOT EXISTS levels_created ON levels (created)'),
    db.prepare('CREATE INDEX IF NOT EXISTS levels_plays ON levels (plays)'),
    db.prepare('CREATE INDEX IF NOT EXISTS levels_likes ON levels (likes)'),
    db.prepare('CREATE TABLE IF NOT EXISTS votes (level_id TEXT NOT NULL, client TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (level_id, client, kind))'),
    db.prepare('CREATE TABLE IF NOT EXISTS uploads (ip TEXT NOT NULL, t INTEGER NOT NULL)'),
  ]);
  schemaReady = true;
}

// ---------------------------------------------------------------- handlers
async function list(request, db) {
  const url = new URL(request.url);
  const ids = url.searchParams.get('ids');
  if (ids != null) {
    const arr = ids.split(',').filter(x => ID_RE.test(x)).slice(0, 50);
    if (!arr.length) return json({ items: [], more: false });
    const r = await db.prepare(`SELECT ${COLS} FROM levels WHERE id IN (${arr.map(() => '?').join(',')}) ORDER BY created DESC`).bind(...arr).all();
    return json({ items: (r.results || []).map(row), more: false });
  }
  const sort = url.searchParams.get('sort');
  const offset = Math.max(0, Math.min(5000, parseInt(url.searchParams.get('offset'), 10) || 0));
  const order = sort === 'hot' ? 'plays DESC, created DESC' : sort === 'top' ? 'likes DESC, plays DESC, created DESC' : 'created DESC';
  let where = 'reports < ?';
  const binds = [HIDE_AT_REPORTS];
  const q = clean(url.searchParams.get('q'), 24);
  if (q) {
    const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
    where += " AND (name LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\')";
    binds.push(like, like);
  }
  const r = await db.prepare(`SELECT ${COLS} FROM levels WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, PAGE + 1, offset).all();
  const items = (r.results || []).map(row);
  return json({ items: items.slice(0, PAGE), more: items.length > PAGE });
}

async function upload(request, db) {
  const body = await readJson(request);
  const code = String(body.code || '').trim();
  if (code.length > LIMITS.code) return fail(413, '关卡太大了');
  let def;
  try { def = decode(code); } catch (e) { return fail(400, e.message); }
  const name = clean(body.name, 24) || clean(def.name, 24) || '无名关卡';
  const author = clean(body.author, 16) || '匿名';
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const iph = (await sha('ip:' + ip)).slice(0, 20);
  const now = Date.now();
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM uploads WHERE ip = ? AND t > ?').bind(iph, now - 3600e3).first();
  if (recent && recent.n >= UPLOADS_PER_HOUR) return fail(429, '上传太频繁了，过一小时再来');
  const layout = await sha(layoutKey(def));
  const dup = await db.prepare('SELECT id, name FROM levels WHERE layout = ?').bind(layout).first();
  if (dup) return json({ id: dup.id, duplicate: true, name: dup.name });
  const id = newId();
  await db.batch([
    db.prepare('INSERT INTO levels (id, code, layout, name, author, cells, fences, max_power, created, owner, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, code, layout, name, author, def.cells.length, def.fences.length, def.maxPower, now, clean(body.client, 40), iph),
    db.prepare('INSERT INTO uploads (ip, t) VALUES (?, ?)').bind(iph, now),
    db.prepare('DELETE FROM uploads WHERE t < ?').bind(now - 86400e3),
  ]);
  return json({ id, duplicate: false }, 201);
}

async function counts(db, id) {
  const r = await db.prepare('SELECT plays, wins, likes FROM levels WHERE id = ?').bind(id).first();
  return r ? { plays: r.plays, wins: r.wins, likes: r.likes } : null;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const db = env.DB;
  if (!db) return fail(503, '大厅数据库还没配置：请在 Cloudflare Pages 项目设置里绑定名为 DB 的 D1 数据库');
  try { await ensureSchema(db); } catch (e) { return fail(500, '数据库初始化失败：' + (e && e.message || e)); }
  const route = Array.isArray(params.route) ? params.route : (params.route ? [params.route] : []);
  const method = request.method;
  try {
    if (route[0] === 'stats' && method === 'GET') {
      const r = await db.prepare('SELECT COUNT(*) AS n FROM levels WHERE reports < ?').bind(HIDE_AT_REPORTS).first();
      return json({ count: r ? r.n : 0 });
    }
    if (route[0] !== 'levels') return fail(404, '没有这个接口');
    if (route.length === 1) {
      if (method === 'GET') return await list(request, db);
      if (method === 'POST') return await upload(request, db);
      return fail(405, '不支持的请求方式');
    }
    const id = route[1];
    if (!ID_RE.test(id)) return fail(400, '关卡 ID 不对');
    if (route.length === 2) {
      if (method === 'GET') {
        const r = await db.prepare(`SELECT ${COLS} FROM levels WHERE id = ?`).bind(id).first();
        return r ? json({ level: row(r) }) : fail(404, '关卡不存在或已被删除');
      }
      if (method === 'DELETE') {
        const r = await db.prepare('SELECT owner FROM levels WHERE id = ?').bind(id).first();
        if (!r) return fail(404, '关卡不存在或已被删除');
        const admin = env.ADMIN_KEY && request.headers.get('x-admin-key') === env.ADMIN_KEY;
        const client = clean(request.headers.get('x-client'), 40);
        if (!admin && !(client && r.owner && client === r.owner)) return fail(403, '只有上传者本人可以删除');
        await db.batch([db.prepare('DELETE FROM levels WHERE id = ?').bind(id), db.prepare('DELETE FROM votes WHERE level_id = ?').bind(id)]);
        return json({ ok: true });
      }
      return fail(405, '不支持的请求方式');
    }
    const action = route[2];
    if (method !== 'POST' || route.length !== 3) return fail(404, '没有这个接口');
    const body = await readJson(request);
    if (action === 'play') {
      const res = await db.prepare('UPDATE levels SET plays = plays + 1, wins = wins + ? WHERE id = ?').bind(body.won ? 1 : 0, id).run();
      if (!res.meta || !res.meta.changes) return fail(404, '关卡不存在或已被删除');
      return json(await counts(db, id));
    }
    if (action === 'like' || action === 'report') {
      const client = clean(body.client, 40);
      if (!client) return fail(400, '缺少客户端标识');
      if (!(await counts(db, id))) return fail(404, '关卡不存在或已被删除');
      const ins = await db.prepare('INSERT OR IGNORE INTO votes (level_id, client, kind) VALUES (?, ?, ?)').bind(id, client, action).run();
      const counted = !!(ins.meta && ins.meta.changes);
      if (counted) await db.prepare(`UPDATE levels SET ${action === 'like' ? 'likes = likes + 1' : 'reports = reports + 1'} WHERE id = ?`).bind(id).run();
      return json(Object.assign({ counted }, await counts(db, id)));
    }
    return fail(404, '没有这个接口');
  } catch (e) {
    return fail(e && e.status || 500, e && e.status ? e.message : '服务器出错了：' + (e && e.message || e));
  }
}
