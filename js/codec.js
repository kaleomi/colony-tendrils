'use strict';
// Level data format used by the lobby: a level packed into varints, base64url, prefixed "CT1.".
(function (CT) {
  const PREFIX = 'CT1.';
  const LIMITS = { cells: 30, fences: 50 };
  const zig = n => (n << 1) ^ (n >> 31);
  const unzig = n => (n >>> 1) ^ -(n & 1);

  function pushVar(out, n) {
    n = n >>> 0;
    while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n >>>= 7; }
    out.push(n);
  }
  function toB64(bytes) {
    let s = ''; for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function encode(def) {
    const nums = [];
    const cells = def.cells.slice(0, LIMITS.cells), fences = def.fences.slice(0, LIMITS.fences);
    nums.push(def.maxPower | 0, def.cpuTurn | 0, cells.length, fences.length);
    for (const c of cells) nums.push(c.type, c.power | 0, Math.round(c.x), Math.round(c.y), c.kind | 0, zig(Math.round(c.mx || 0)), zig(Math.round(c.my || 0)), Math.round((c.period || 0) / 10));
    for (const f of fences) nums.push(Math.round(f.x1), Math.round(f.y1), Math.round(f.x2), Math.round(f.y2), zig(Math.round(f.mx || 0)), zig(Math.round(f.my || 0)), Math.round((f.period || 0) / 10));
    const name = new TextEncoder().encode((def.name || '').slice(0, 24));
    const bytes = [];
    for (const n of nums) pushVar(bytes, n);
    pushVar(bytes, name.length); for (const b of name) bytes.push(b);
    let sum = 0; for (const b of bytes) sum = (sum * 31 + b) % 65521;
    pushVar(bytes, sum);
    return PREFIX + toB64(bytes);
  }

  function decode(text) {
    let s = String(text || '').trim();
    const at = s.indexOf(PREFIX);
    if (at < 0) throw new Error('这不是有效的关卡数据');
    s = s.slice(at + PREFIX.length).match(/^[A-Za-z0-9_-]+/);
    if (!s) throw new Error('关卡数据内容为空');
    let bytes;
    try { bytes = fromB64(s[0]); } catch (e) { throw new Error('关卡数据里有无法识别的字符'); }
    let p = 0;
    const rd = () => {
      let n = 0, sh = 0, b;
      do { if (p >= bytes.length) throw new Error('关卡数据不完整，可能复制时少了一截'); b = bytes[p++]; n |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80 && sh < 35);
      return n >>> 0;
    };
    const maxPower = rd(), cpuTurn = rd(), nc = rd(), nf = rd();
    if (nc > LIMITS.cells || nf > LIMITS.fences) throw new Error('关卡数据里的微生物或墙太多');
    const cells = [], fences = [];
    for (let i = 0; i < nc; i++) {
      const type = rd(), power = rd(), x = rd(), y = rd(), kind = rd(), mx = unzig(rd()), my = unzig(rd()), period = rd() * 10;
      cells.push({ type, power, x, y, kind, mx, my, period, phase: 0 });
    }
    for (let i = 0; i < nf; i++) {
      const x1 = rd(), y1 = rd(), x2 = rd(), y2 = rd(), mx = unzig(rd()), my = unzig(rd()), period = rd() * 10;
      fences.push({ x1, y1, x2, y2, mx, my, period, phase: 0 });
    }
    const nl = rd(); if (p + nl > bytes.length) throw new Error('关卡数据不完整，可能复制时少了一截');
    const name = new TextDecoder().decode(bytes.slice(p, p + nl)); p += nl;
    let sum = 0; for (let i = 0; i < p; i++) sum = (sum * 31 + bytes[i]) % 65521;
    if (rd() !== sum) throw new Error('关卡数据校验失败，可能被改动或复制不完整');
    const def = { name, maxPower, cpuTurn, hint: null, cells, fences };
    validate(def, true);
    return def;
  }

  // returns null when playable, else a message
  function validate(def, strict) {
    const bad = m => { if (strict) throw new Error(m); return m; };
    if (!(def.maxPower >= 10 && def.maxPower <= 999)) return bad('能量上限超出范围');
    for (const c of def.cells) {
      if (!(c.type >= 1 && c.type <= 5) || !(c.kind >= 0 && c.kind <= 4) || c.x > 640 || c.y > 480 || c.power > 999) return bad('关卡数据里有无效的微生物');
    }
    for (const f of def.fences) if ([f.x1, f.y1, f.x2, f.y2].some(v => v > 700)) return bad('关卡数据里有无效的墙');
    const hasGreen = def.cells.some(c => c.type === CT.T.GREEN);
    const hasFoe = def.cells.some(c => c.type !== CT.T.GREEN && c.type !== CT.T.GREY);
    if (!hasGreen || !hasFoe) return bad('至少需要一个绿色微生物和一个敌方（红/黑/紫）微生物');
    return null;
  }

  CT.Codec = { PREFIX, LIMITS, encode, decode, validate };
})(window.CT);
