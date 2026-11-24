// Box models for Blockwild's creatures and players, with small procedural pixel skins and simple animation.
import * as THREE from 'three';

// ---------- procedural skins ----------
const skinCache = new Map();
function hashf(a, b, c) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function skin(col, style = 'plain', seed = 1) {
  const key = col + style + seed;
  if (skinCache.has(key)) return skinCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const base = new THREE.Color(col);
  const img = ctx.createImageData(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let k = 1, r = base.r, g = base.g, b = base.b;
    const n = hashf(x, y, seed);
    if (style === 'plain') k = 0.92 + n * 0.14;
    else if (style === 'fur') k = 0.84 + n * 0.22 + ((x + y * 3) % 5 === 0 ? -0.08 : 0);
    else if (style === 'wool') k = 0.86 + 0.18 * Math.abs(Math.sin(x * 1.3 + Math.sin(y * 1.1) * 2)) + n * 0.06;
    else if (style === 'stone') k = 0.78 + n * 0.3 + (hashf(x >> 1, y >> 1, seed + 3) > 0.8 ? -0.15 : 0);
    else if (style === 'moss') { k = 0.8 + n * 0.3; if (hashf(x >> 1, y >> 1, seed + 9) > 0.7) { r *= 0.8; g *= 1.15; b *= 0.7; } }
    else if (style === 'cap') { k = 0.9 + n * 0.12; const dx = (x % 8) - 4, dy = (y % 8) - 4; if (dx * dx + dy * dy < 4 && ((x >> 3) + (y >> 3)) % 2 === 0) { r = 0.95; g = 0.93; b = 0.86; } }
    else if (style === 'scale') k = 0.85 + n * 0.12 + ((x + (y % 2) * 2) % 4 === 0 ? 0.15 : 0);
    else if (style === 'shadow') { k = 0.7 + n * 0.5; }
    else if (style === 'leaf') { k = 0.8 + n * 0.3; if ((x + y) % 6 === 0) k *= 0.75; }
    else if (style === 'cloth') k = 0.9 + n * 0.1 + (y % 4 === 0 ? -0.07 : 0);
    else if (style === 'metal') k = 0.85 + n * 0.1 + (y < 2 ? 0.25 : 0) + (x === 0 ? 0.15 : 0);
    const i = (y * 16 + x) * 4;
    img.data[i] = Math.min(255, r * k * 255); img.data[i + 1] = Math.min(255, g * k * 255); img.data[i + 2] = Math.min(255, b * k * 255); img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  skinCache.set(key, t);
  return t;
}

// ---------- builder ----------
class Builder {
  constructor() { this.root = new THREE.Group(); this.mats = []; this.parts = {}; this.legs = []; this.glow = []; }
  mat(col, style, o = {}) {
    const m = new THREE.MeshLambertMaterial({ map: style === 'none' ? null : skin(col, style || 'plain', o.seed || 1), color: 0xffffff, transparent: !!o.opacity, opacity: o.opacity || 1, depthWrite: !o.opacity });
    if (style === 'none') m.color.set(col);
    m.userData.base = m.color.clone();
    if (o.glow) { m.emissive = new THREE.Color(o.glow); m.userData.glow = true; this.glow.push(m); }
    this.mats.push(m);
    return m;
  }
  // a box of size w,h,d (in 1/16 block pixels) whose pivot sits at (px,py,pz) relative to `parent`; the box is offset by (ox,oy,oz) from the pivot
  box(name, parent, w, h, d, px, py, pz, ox, oy, oz, mat) {
    const S = 1 / 16;
    const g = new THREE.BoxGeometry(w * S, h * S, d * S);
    g.translate(ox * S, oy * S, oz * S);
    const mesh = new THREE.Mesh(g, mat);
    const pivot = new THREE.Group();
    pivot.position.set(px * S, py * S, pz * S);
    pivot.add(mesh);
    (parent || this.root).add(pivot);
    if (name) this.parts[name] = pivot;
    return pivot;
  }
}

// ---------- players: "Wanderers" ----------
const SKIN_TONES = ['#f1c9a5', '#e0ac85', '#c68863', '#9c6644', '#7a4a2e', '#f6d8bd'];
const ARMOR_COL = { hide: '#8a5a34', copper: '#d77a46', iron: '#d8dade', sapphire: '#3f7ef0' };
function nameHash(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
export function playerModel(name, color) {
  const b = new Builder();
  const h = nameHash(name || 'x');
  const skinC = SKIN_TONES[h % SKIN_TONES.length];
  const shirt = b.mat(color, 'cloth', { seed: 3 });
  const pants = b.mat(new THREE.Color(color).multiplyScalar(0.45).getStyle(), 'cloth', { seed: 5 });
  const skinM = b.mat(skinC, 'plain', { seed: 7 });
  const boots = b.mat('#3a2a1e', 'plain', { seed: 9 });
  const visor = b.mat('#0d1620', 'none', { glow: new THREE.Color(color).multiplyScalar(0.55) });
  const pack = b.mat('#7a5634', 'cloth', { seed: 11 });
  const hair = b.mat(['#2a1b10', '#5a3a1a', '#c9a35a', '#1a1a1a', '#8a3a1a', '#d8d0c8'][(h >> 3) % 6], 'fur', { seed: 13 });
  b.box('legL', null, 4, 12, 4, -2, 12, 0, 0, -6, 0, pants);
  b.box('legR', null, 4, 12, 4, 2, 12, 0, 0, -6, 0, pants);
  b.box(null, b.parts.legL, 4.2, 3, 4.6, 0, -10.6, 0, 0, 0, 0.2, boots);
  b.box(null, b.parts.legR, 4.2, 3, 4.6, 0, -10.6, 0, 0, 0, 0.2, boots);
  b.box('body', null, 8, 12, 4, 0, 12, 0, 0, 6, 0, shirt);
  b.box('pack', b.parts.body, 6, 8, 3, 0, 7, -3.4, 0, 0, 0, pack);
  b.box(null, b.parts.pack, 6.4, 2, 3.4, 0, 3.2, 0, 0, 0, 0, b.mat('#5c3f24', 'cloth'));
  b.box('armL', b.parts.body, 3, 12, 4, -5.5, 11, 0, 0, -5, 0, shirt);
  b.box('armR', b.parts.body, 3, 12, 4, 5.5, 11, 0, 0, -5, 0, shirt);
  b.box(null, b.parts.armL, 3.1, 3, 4.1, 0, -9.5, 0, 0, 0, 0, skinM);
  b.box(null, b.parts.armR, 3.1, 3, 4.1, 0, -9.5, 0, 0, 0, 0, skinM);
  b.box('head', b.parts.body, 8, 8, 8, 0, 12, 0, 0, 4, 0, skinM);
  b.box(null, b.parts.head, 8.4, 2.4, 8.4, 0, 7.4, 0, 0, 0, 0, hair);
  b.box(null, b.parts.head, 8.4, 4, 3, 0, 5, -3, 0, 0, 0, hair);
  b.box('visor', b.parts.head, 7, 2.2, 1, 0, 4.4, 4.1, 0, 0, 0, visor);
  b.box('hand', b.parts.armR, 1, 1, 1, 0, -11, 1, 0, 0, 0, skinM);
  b.parts.hand.children[0].visible = false;
  // armor layers (hidden until worn)
  const armor = [];
  const slotBoxes = [
    [[b.parts.head, 9, 3, 9, 0, 7.2, 0], [b.parts.head, 9, 6, 2, 0, 3.5, -3.6], [b.parts.head, 1, 6, 8, -4.3, 3.5, 0.4], [b.parts.head, 1, 6, 8, 4.3, 3.5, 0.4]],
    [[b.parts.body, 9, 12.6, 5, 0, 6, 0], [b.parts.armL, 3.8, 5, 4.8, 0, -2, 0], [b.parts.armR, 3.8, 5, 4.8, 0, -2, 0]],
    [[b.parts.legL, 4.6, 8, 4.6, 0, -3.5, 0], [b.parts.legR, 4.6, 8, 4.6, 0, -3.5, 0]],
    [[b.parts.legL, 4.8, 3.6, 5.2, 0, -10.4, 0.2], [b.parts.legR, 4.8, 3.6, 5.2, 0, -10.4, 0.2]],
  ];
  slotBoxes.forEach((list, slot) => {
    const m = b.mat('#888888', 'metal', { seed: 20 + slot });
    const meshes = list.map(([parent, w, hh, d, ox, oy, oz]) => { const p = b.box(null, parent, w, hh, d, 0, 0, 0, ox, oy, oz, m); p.visible = false; return p; });
    armor.push({ m, meshes, cur: null });
  });
  b.legs = [[b.parts.legL, 1], [b.parts.legR, -1], [b.parts.armL, -1], [b.parts.armR, 1]];
  const M = finish(b, 'player', 1.8);
  M.setArmor = list => {
    (list || []).forEach((id, slot) => {
      const a = armor[slot];
      if (!a || a.cur === id) return;
      a.cur = id;
      const mat = id ? id.split('_')[0] : null;
      for (const p of a.meshes) p.visible = !!mat;
      if (mat) { a.m.map = skin(ARMOR_COL[mat] || '#999', mat === 'hide' ? 'fur' : 'metal', 20 + slot); a.m.needsUpdate = true; }
    });
  };
  return M;
}

// ---------- creatures ----------
const MOB_BUILDERS = {
  bramblebuck(b) {
    const fur = b.mat('#a57a4a', 'fur', { seed: 2 }), belly = b.mat('#e0c9a0', 'fur', { seed: 3 }), dark = b.mat('#4a3420', 'plain'), bramble = b.mat('#3c5a2a', 'leaf'), berry = b.mat('#c0283a', 'none');
    b.box('body', null, 10, 9, 16, 0, 15, 0, 0, 0, 0, fur);
    b.box(null, b.parts.body, 9, 2, 14, 0, -4.6, 0, 0, 0, 0, belly);
    b.box(null, b.parts.body, 3, 3, 2, 0, 3, -8.5, 0, 0, 0, belly);
    for (const [n, x, z, s] of [['l1', -3, 6, 1], ['l2', 3, 6, -1], ['l3', -3, -6, -1], ['l4', 3, -6, 1]]) { b.box(n, null, 3, 11, 3, x, 11, z, 0, -5.5, 0, fur); b.box(null, b.parts[n], 3.2, 2, 3.2, 0, -10.5, 0, 0, 0, 0, dark); b.legs.push([b.parts[n], s]); }
    b.box('neck', b.parts.body, 4, 9, 4, 0, 3, 6, 0, 4, 1, fur);
    b.box('head', b.parts.neck, 6, 6, 8, 0, 9, 2, 0, 0, 2, fur);
    b.box(null, b.parts.head, 4, 3, 3, 0, -1.5, 7, 0, 0, 0, belly);
    b.box(null, b.parts.head, 1.5, 1.5, 1, 0, -0.5, 8.6, 0, 0, 0, dark);
    for (const sx of [-1, 1]) {
      b.box(null, b.parts.head, 1, 1, 1, sx * 3.1, 1, 3, 0, 0, 0, dark);
      b.box(null, b.parts.head, 3, 1.5, 1, sx * 4, 2, 0, sx * 1.2, 0, 0, fur);
      const a = b.box(null, b.parts.head, 1.4, 7, 1.4, sx * 2, 3, -1, 0, 3.5, 0, bramble); a.rotation.z = -sx * 0.4;
      const a2 = b.box(null, a, 1.2, 4, 1.2, 0, 5, 0, 0, 2, 0, bramble); a2.rotation.z = sx * 0.9;
      const a3 = b.box(null, a, 1.2, 3.5, 1.2, 0, 7, 0, 0, 1.8, 0, bramble); a3.rotation.x = -0.6;
      b.box(null, a2, 1.4, 1.4, 1.4, 0, 3.6, 0, 0, 0, 0, berry); b.box(null, a3, 1.3, 1.3, 1.3, 0, 3.4, 0, 0, 0, 0, berry);
    }
    b.box('tail', b.parts.body, 2.5, 4, 2, 0, 3, -8, 0, -1.5, -1, belly);
  },
  puffhen(b) {
    const fl = b.mat('#f4ead8', 'wool', { seed: 4 }), beak = b.mat('#f0a030', 'plain'), leg = b.mat('#e09030', 'plain'), comb = b.mat('#d83a3a', 'plain'), eye = b.mat('#151515', 'none');
    b.box('body', null, 8, 8, 9, 0, 3, 0, 0, 4, 0, fl);
    b.box('head', b.parts.body, 6, 6, 6, 0, 7, 4, 0, 2, 0, fl);
    b.box(null, b.parts.head, 2, 2, 3, 0, 1.5, 4, 0, 0, 0, beak);
    b.box(null, b.parts.head, 2, 3, 3, 0, 5.5, 0, 0, 0, 0, comb);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 0.6, 1.2, 1.2, sx * 3.1, 3, 1.5, 0, 0, 0, eye); b.box('w' + sx, b.parts.body, 1.5, 5, 6, sx * 4.6, 6, 0, 0, -2, 0, fl); }
    b.box(null, b.parts.body, 4, 4, 3, 0, 6, -5, 0, 0, 0, fl).rotation.x = -0.5;
    for (const [n, x, s] of [['l1', -2, 1], ['l2', 2, -1]]) { b.box(n, null, 1, 3, 1, x, 3, 0, 0, -1.5, 0, leg); b.legs.push([b.parts[n], s]); }
  },
  mossback(b) {
    const hide = b.mat('#6b4a32', 'fur', { seed: 6 }), moss = b.mat('#4f7a2a', 'moss', { seed: 6 }), snout = b.mat('#d49488', 'plain'), tusk = b.mat('#f2ead8', 'plain'), eye = b.mat('#141414', 'none');
    b.box('body', null, 11, 9, 15, 0, 9, 0, 0, 1, 0, hide);
    b.box(null, b.parts.body, 10, 3, 13, 0, 6, -0.5, 0, 0, 0, moss);
    for (let i = 0; i < 5; i++) b.box(null, b.parts.body, 2, 2 + (i % 2) * 2, 2, -3 + i * 1.6, 8 + (i % 2), -4 + i * 2, 0, 0, 0, moss);
    b.box('head', b.parts.body, 8, 7, 6, 0, 0, 8, 0, 0, 2, hide);
    b.box(null, b.parts.head, 5, 4, 2, 0, -1, 6, 0, 0, 0, snout);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 1, 3, 1, sx * 2.7, 0.5, 6.4, 0, 0, 0, tusk); b.box(null, b.parts.head, 1, 1, 1, sx * 3.5, 1.5, 3, 0, 0, 0, eye); b.box(null, b.parts.head, 2, 3, 1, sx * 3, 4, 1, 0, 0, 0, hide); }
    for (const [n, x, z, s] of [['l1', -3.5, 5, 1], ['l2', 3.5, 5, -1], ['l3', -3.5, -5, -1], ['l4', 3.5, -5, 1]]) { b.box(n, null, 3.5, 6, 3.5, x, 6, z, 0, -3, 0, hide); b.legs.push([b.parts[n], s]); }
  },
  fluffalo(b) {
    const wool = b.mat('#d8cfc0', 'wool', { seed: 8 }), dark = b.mat('#3a2c22', 'fur', { seed: 8 }), horn = b.mat('#e8dcc0', 'plain'), eye = b.mat('#101010', 'none');
    b.box('body', null, 18, 15, 22, 0, 17, 0, 0, 0, 0, wool);
    b.box(null, b.parts.body, 19, 10, 10, 0, 4, 6, 0, 0, 0, wool);
    b.box('head', b.parts.body, 9, 9, 7, 0, -1, 12, 0, 0, 2, dark);
    b.box(null, b.parts.head, 11, 6, 5, 0, 4, 0, 0, 0, 0, wool);
    for (const sx of [-1, 1]) {
      const hh = b.box(null, b.parts.head, 5, 2, 2, sx * 6, 3, 1, sx * 2, 0, 0, horn);
      b.box(null, hh, 2, 4, 2, sx * 4.5, 0, 0, 0, 2, 0, horn);
      b.box(null, b.parts.head, 1, 1.4, 1, sx * 3, 1, 5.6, 0, 0, 0, eye);
    }
    b.box(null, b.parts.head, 7, 3, 2, 0, -3, 5.5, 0, 0, 0, b.mat('#2a1f18', 'plain'));
    for (const [n, x, z, s] of [['l1', -5.5, 7, 1], ['l2', 5.5, 7, -1], ['l3', -5.5, -7, -1], ['l4', 5.5, -7, 1]]) { b.box(n, null, 5, 10, 5, x, 10, z, 0, -5, 0, dark); b.legs.push([b.parts[n], s]); }
    b.box('tail', b.parts.body, 2, 7, 2, 0, 4, -11, 0, -3, 0, dark);
  },
  glimmerfin(b) {
    const sc = b.mat('#2a9aa8', 'scale', { seed: 10, glow: '#0a3a40' }), fin = b.mat('#7af0e0', 'none', { glow: '#2ad0c0', opacity: 0.85 }), eye = b.mat('#f8f8f8', 'none');
    b.box('body', null, 3, 6, 9, 0, 3, 0, 0, 0, 0, sc);
    b.box('tail', b.parts.body, 1, 6, 4, 0, 0, -4.5, 0, 0, -2, fin);
    b.box(null, b.parts.body, 1, 3, 4, 0, 4, -0.5, 0, 0, 0, fin);
    for (const sx of [-1, 1]) { b.box(null, b.parts.body, 0.6, 1.2, 1.2, sx * 1.6, 1, 3, 0, 0, 0, eye); b.box(null, b.parts.body, 2, 0.6, 2, sx * 2, -1, 1, sx, 0, 0, fin); }
  },
  ashfox(b) {
    const fur = b.mat('#8a8e94', 'fur', { seed: 12 }), white = b.mat('#eeeae4', 'fur', { seed: 12 }), dark = b.mat('#2c2c30', 'plain'), eye = b.mat('#f0c040', 'none', { glow: '#604010' });
    b.box('body', null, 6, 6, 12, 0, 8, 0, 0, 0, 0, fur);
    b.box(null, b.parts.body, 5, 1.5, 10, 0, -3, 0, 0, 0, 0, white);
    b.box('head', b.parts.body, 7, 6, 6, 0, 1, 7, 0, 0, 1, fur);
    b.box(null, b.parts.head, 3, 2.5, 3, 0, -1.5, 5.5, 0, 0, 0, white);
    b.box(null, b.parts.head, 1.2, 1, 1, 0, -0.5, 7.2, 0, 0, 0, dark);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 2, 3, 1, sx * 2.2, 4.4, 0.5, 0, 0, 0, fur); b.box(null, b.parts.head, 1, 1, 0.6, sx * 1.8, 1, 4.1, 0, 0, 0, eye); }
    for (const [n, x, z, s] of [['l1', -2, 4, 1], ['l2', 2, 4, -1], ['l3', -2, -4, -1], ['l4', 2, -4, 1]]) { b.box(n, null, 2, 5, 2, x, 5, z, 0, -2.5, 0, dark); b.legs.push([b.parts[n], s]); }
    b.box('tail', b.parts.body, 4, 4, 9, 0, 1, -6, 0, 0, -4, fur);
    b.box(null, b.parts.tail, 4.2, 4.2, 3, 0, 0, -8, 0, 0, 0, white);
    b.parts.tail.rotation.x = 0.35;
  },
  gloomling(b) {
    const sh = b.mat('#262038', 'shadow', { seed: 14 }), sh2 = b.mat('#14101e', 'shadow', { seed: 15 }), eye = b.mat('#a8f0ff', 'none', { glow: '#70d8ff' });
    b.box('legL', null, 3, 14, 3, -2, 14, 0, 0, -7, 0, sh2);
    b.box('legR', null, 3, 14, 3, 2, 14, 0, 0, -7, 0, sh2);
    b.box('body', null, 8, 12, 4, 0, 14, 0, 0, 6, 0, sh);
    b.box('armL', b.parts.body, 3, 14, 3, -5.5, 11, 0, 0, -6, 0, sh2);
    b.box('armR', b.parts.body, 3, 14, 3, 5.5, 11, 0, 0, -6, 0, sh2);
    b.box('head', b.parts.body, 8, 8, 8, 0, 12, 0, 0, 4, 0, sh);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 2, 1.2, 0.6, sx * 2, 3.8, 4.1, 0, 0, 0, eye);
    for (let i = 0; i < 4; i++) b.box(null, b.parts.body, 2, 3, 2, -3 + i * 2, 13 + (i % 2), -2, 0, 0, 0, sh2);
    b.parts.armL.rotation.x = b.parts.armR.rotation.x = -1.35;
    b.legs = [[b.parts.legL, 1], [b.parts.legR, -1]];
    b.zombieArms = true;
  },
  thornspitter(b) {
    const stem = b.mat('#3f7a30', 'leaf', { seed: 16 }), dark = b.mat('#2a4a20', 'leaf', { seed: 17 }), petal = b.mat('#e0508a', 'plain', { seed: 18 }), mouth = b.mat('#3a0a18', 'none'), thorn = b.mat('#d8d0a0', 'plain');
    b.box('legL', null, 3, 8, 3, -2, 8, 0, 0, -4, 0, dark);
    b.box('legR', null, 3, 8, 3, 2, 8, 0, 0, -4, 0, dark);
    b.box('body', null, 6, 14, 5, 0, 8, 0, 0, 7, 0, stem);
    for (let i = 0; i < 5; i++) b.box(null, b.parts.body, 1, 1, 2, (i % 2 ? 1 : -1) * 3.2, 3 + i * 2.2, 0, 0, 0, 0, thorn);
    for (const sx of [-1, 1]) { const l = b.box(sx < 0 ? 'armL' : 'armR', b.parts.body, 2, 10, 5, sx * 4, 12, 0, 0, -4, 0, dark); l.rotation.z = sx * 0.4; }
    b.box('head', b.parts.body, 8, 6, 8, 0, 14, 0, 0, 3, 0, stem);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const p = b.box(null, b.parts.head, 5, 1.5, 5, Math.cos(a) * 5, 3, Math.sin(a) * 5, 0, 0, 0, petal); p.rotation.y = -a; p.rotation.z = 0.5; }
    b.box(null, b.parts.head, 4, 3, 1, 0, 3, 4.1, 0, 0, 0, mouth);
    b.legs = [[b.parts.legL, 1], [b.parts.legR, -1]];
  },
  burrower(b) {
    const fur = b.mat('#6a5a50', 'fur', { seed: 19 }), claw = b.mat('#e8dcc8', 'plain'), nose = b.mat('#e890a0', 'plain'), eye = b.mat('#101010', 'none');
    b.box('body', null, 12, 8, 14, 0, 6, 0, 0, 0, 0, fur);
    b.box('head', b.parts.body, 8, 6, 6, 0, -0.5, 8, 0, 0, 1, fur);
    b.box(null, b.parts.head, 3, 2.5, 2, 0, -0.5, 5, 0, 0, 0, nose);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 1, 0.8, 0.6, sx * 2.5, 1.5, 4.1, 0, 0, 0, eye);
    for (const [n, x, z, s] of [['l1', -6, 5, 1], ['l2', 6, 5, -1], ['l3', -5, -5, -1], ['l4', 5, -5, 1]]) {
      b.box(n, null, 4, 4, 4, x, 4, z, 0, -2, 0, fur); b.legs.push([b.parts[n], s]);
      if (z > 0) for (let i = 0; i < 3; i++) b.box(null, b.parts[n], 1, 1, 3, -1.2 + i * 1.2, -4, 2, 0, 0, 0, claw);
    }
  },
  blastcap(b) {
    const stemM = b.mat('#e8e0c8', 'plain', { seed: 21 }), cap = b.mat('#c82a2a', 'cap', { seed: 21 }), eye = b.mat('#151515', 'none'), gill = b.mat('#b8a888', 'plain');
    b.box('legL', null, 3, 6, 3, -2, 6, 0, 0, -3, 0, stemM);
    b.box('legR', null, 3, 6, 3, 2, 6, 0, 0, -3, 0, stemM);
    b.box('body', null, 7, 10, 7, 0, 6, 0, 0, 5, 0, stemM);
    for (const sx of [-1, 1]) b.box(null, b.parts.body, 1.5, 2, 0.6, sx * 1.8, 6, 3.6, 0, 0, 0, eye);
    b.box('head', b.parts.body, 16, 7, 16, 0, 10, 0, 0, 3.5, 0, cap);
    b.box(null, b.parts.head, 14, 1, 14, 0, -0.3, 0, 0, 0, 0, gill);
    b.box(null, b.parts.head, 10, 3, 10, 0, 8, 0, 0, 0, 0, cap);
    b.legs = [[b.parts.legL, 1], [b.parts.legR, -1]];
  },
  gelatoad(b) {
    const jelly = b.mat('#6ad25a', 'plain', { seed: 23, opacity: 0.72 }), core = b.mat('#2e7a28', 'plain', { seed: 24 }), eyeW = b.mat('#f4f4e0', 'none'), eye = b.mat('#101010', 'none');
    b.box('body', null, 20, 16, 20, 0, 0, 0, 0, 8, 0, jelly);
    b.box(null, b.parts.body, 10, 8, 10, 0, 6, -1, 0, 0, 0, core);
    for (const sx of [-1, 1]) { b.box(null, b.parts.body, 5, 5, 5, sx * 6, 17, 6, 0, 0, 0, eyeW); b.box(null, b.parts.body, 2.5, 2.5, 1, sx * 6, 17, 8.8, 0, 0, 0, eye); }
    b.box(null, b.parts.body, 12, 1.5, 1, 0, 8, 10.2, 0, 0, 0, core);
    b.squash = true;
  },
  cragjaw(b) {
    const rock = b.mat('#6e6a66', 'stone', { seed: 25 }), rock2 = b.mat('#4e4a48', 'stone', { seed: 26 }), ore = b.mat('#ff9a30', 'none', { glow: '#d06010' }), teeth = b.mat('#e8e0cc', 'plain'), eye = b.mat('#ffd040', 'none', { glow: '#ffa000' });
    b.box('legL', null, 7, 12, 7, -5, 12, 0, 0, -6, 0, rock2);
    b.box('legR', null, 7, 12, 7, 5, 12, 0, 0, -6, 0, rock2);
    b.box('body', null, 20, 16, 12, 0, 12, 0, 0, 8, 0, rock);
    for (const [x, y, z] of [[-6, 12, -6.2], [4, 6, -6.2], [7, 13, 6.2], [-8, 4, 6.2], [0, 15.5, -2]]) b.box(null, b.parts.body, 3, 2, 1, x, y, z, 0, 0, 0, ore);
    b.box('armL', b.parts.body, 7, 18, 7, -13, 14, 0, 0, -8, 0, rock2);
    b.box('armR', b.parts.body, 7, 18, 7, 13, 14, 0, 0, -8, 0, rock2);
    b.box('head', b.parts.body, 14, 9, 11, 0, 14, 3, 0, 2, 3, rock);
    b.box('jaw', b.parts.head, 13, 4, 10, 0, -2, 1, 0, -2, 3, rock2);
    for (let i = 0; i < 5; i++) { b.box(null, b.parts.head, 1.5, 2, 1.5, -5 + i * 2.5, -2.5, 8, 0, 0, 0, teeth); b.box(null, b.parts.jaw, 1.5, 2, 1.5, -5 + i * 2.5, 0.6, 7.5, 0, 0, 0, teeth); }
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 2.5, 1.5, 1, sx * 4, 4, 8.6, 0, 0, 0, eye);
    b.legs = [[b.parts.legL, 1], [b.parts.legR, -1], [b.parts.armL, -0.5], [b.parts.armR, 0.5]];
  },
};

Object.assign(MOB_BUILDERS, {
  brindlehound(b) {
    const fur = b.mat('#8a6a48', 'fur', { seed: 31 }), stripe = b.mat('#4a3626', 'fur', { seed: 32 }), pale = b.mat('#d8c4a4', 'fur', { seed: 33 }), dark = b.mat('#201812', 'plain'), eye = b.mat('#f0d070', 'none', { glow: '#604010' });
    b.box('body', null, 7, 7, 14, 0, 10, 0, 0, 0, 0, fur);
    for (let i = 0; i < 4; i++) b.box(null, b.parts.body, 7.2, 1.2, 1.4, 0, 3.2, -4.5 + i * 3, 0, 0, 0, stripe);
    b.box(null, b.parts.body, 6, 1.5, 12, 0, -3.4, 0, 0, 0, 0, pale);
    b.box(null, b.parts.body, 8, 8, 5, 0, 1, 6, 0, 0, 0, fur); // shaggy ruff
    b.box('head', b.parts.body, 6, 6, 6, 0, 3, 9, 0, 0, 2, fur);
    b.box(null, b.parts.head, 3, 3, 4, 0, -1.5, 5, 0, 0, 0, pale);
    b.box(null, b.parts.head, 1.4, 1.2, 1, 0, -0.5, 7, 0, 0, 0, dark);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 1.8, 3, 1.2, sx * 2.2, 3.8, 0, 0, 0, 0, stripe); b.box(null, b.parts.head, 1, 1, 0.6, sx * 1.7, 1, 3.1, 0, 0, 0, eye); }
    for (const [n, x, z, s] of [['l1', -2.2, 5, 1], ['l2', 2.2, 5, -1], ['l3', -2.2, -5, -1], ['l4', 2.2, -5, 1]]) { b.box(n, null, 2.4, 7, 2.4, x, 7, z, 0, -3.5, 0, fur); b.box(null, b.parts[n], 2.6, 1.5, 2.6, 0, -6.6, 0, 0, 0, 0, dark); b.legs.push([b.parts[n], s]); }
    b.box('tail', b.parts.body, 2.5, 2.5, 8, 0, 2, -7, 0, 0, -4, stripe);
    b.parts.tail.rotation.x = 0.6;
  },
  scorchling(b) {
    const ember = b.mat('#ff7a20', 'none', { glow: '#d04000' }), core = b.mat('#ffe080', 'none', { glow: '#ffb020' }), ash = b.mat('#3a2420', 'plain'), eye = b.mat('#ffffff', 'none', { glow: '#ffffa0' });
    b.box('body', null, 8, 12, 6, 0, 16, 0, 0, 6, 0, ash);
    b.box(null, b.parts.body, 5, 7, 6.4, 0, 6, 0, 0, 0, 0, core);
    b.box('head', b.parts.body, 8, 8, 8, 0, 12, 0, 0, 4, 0, ember);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 2, 2, 0.6, sx * 2, 4.5, 4.1, 0, 0, 0, eye);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; b.box(null, b.parts.body, 2, 8, 2, Math.cos(a) * 7, 2 + (i % 2) * 3, Math.sin(a) * 7, 0, 0, 0, i % 2 ? ember : core); }
    b.box('armL', b.parts.body, 3, 10, 3, -6, 10, 0, 0, -5, 0, ember);
    b.box('armR', b.parts.body, 3, 10, 3, 6, 10, 0, 0, -5, 0, ember);
    b.legs = [[b.parts.armL, 0.4], [b.parts.armR, -0.4]];
  },
  magmite(b) {
    const crust = b.mat('#3a1a14', 'stone', { seed: 34 }), lava = b.mat('#ff8a20', 'none', { glow: '#e04000' }), eye = b.mat('#ffe060', 'none', { glow: '#ffa000' });
    b.box('body', null, 12, 10, 12, 0, 5, 0, 0, 5, 0, crust);
    for (const [x, y, z] of [[-6.2, 4, 2], [6.2, 6, -3], [2, 10.2, 1], [-3, 2, -6.2], [3, 7, 6.2]]) b.box(null, b.parts.body, 3, 2, 3, x, y, z, 0, 0, 0, lava);
    for (const sx of [-1, 1]) b.box(null, b.parts.body, 2, 2, 0.6, sx * 3, 7, 6.2, 0, 0, 0, eye);
    b.squash = true;
  },
  cinderhog(b) {
    const hide = b.mat('#5a3226', 'fur', { seed: 35 }), glow = b.mat('#ff9030', 'none', { glow: '#c05010' }), tusk = b.mat('#f0e6d0', 'plain'), dark = b.mat('#20120e', 'plain');
    b.box('body', null, 10, 9, 15, 0, 10, 0, 0, 0, 0, hide);
    for (let i = 0; i < 4; i++) b.box(null, b.parts.body, 2, 2, 2, 0, 5, -5 + i * 3.4, 0, 0, 0, glow);
    b.box('head', b.parts.body, 8, 7, 6, 0, 0, 9, 0, 0, 2, hide);
    b.box(null, b.parts.head, 4, 3, 2, 0, -1.5, 5, 0, 0, 0, dark);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 1, 3, 1, sx * 2.6, -0.5, 5.6, 0, 0, 0, tusk);
    for (const [n, x, z, s] of [['l1', -3, 5, 1], ['l2', 3, 5, -1], ['l3', -3, -5, -1], ['l4', 3, -5, 1]]) { b.box(n, null, 3, 6, 3, x, 6, z, 0, -3, 0, dark); b.legs.push([b.parts[n], s]); }
  },
  galewing(b) {
    const feather = b.mat('#d8e4f4', 'fur', { seed: 36 }), tip = b.mat('#5a7ab0', 'plain'), beak = b.mat('#f0c040', 'plain'), eye = b.mat('#40e0ff', 'none', { glow: '#20a0d0' });
    b.box('body', null, 6, 6, 10, 0, 9, 0, 0, 0, 0, feather);
    b.box('head', b.parts.body, 5, 5, 5, 0, 3, 6, 0, 0, 2, feather);
    b.box(null, b.parts.head, 2, 1.5, 3, 0, -0.5, 4, 0, 0, 0, beak);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 1, 1, 0.6, sx * 1.8, 1, 2.6, 0, 0, 0, eye);
    b.box('armL', b.parts.body, 14, 1, 7, -9, 2, 0, -6, 0, 0, feather);
    b.box('armR', b.parts.body, 14, 1, 7, 9, 2, 0, 6, 0, 0, feather);
    b.box(null, b.parts.armL, 4, 1.2, 7.2, -6, 0, 0, 0, 0, 0, tip);
    b.box(null, b.parts.armR, 4, 1.2, 7.2, 6, 0, 0, 0, 0, 0, tip);
    b.box('tail', b.parts.body, 5, 1, 6, 0, 1, -7, 0, 0, -3, tip);
    b.legs = [[b.parts.armL, 0.5], [b.parts.armR, -0.5]];
  },
  puffcloud(b) {
    const cloud = b.mat('#f4f8ff', 'fur', { seed: 37 }), face = b.mat('#c8d4e8', 'plain'), eye = b.mat('#303848', 'plain');
    b.box('body', null, 12, 9, 13, 0, 10, 0, 0, 0, 0, cloud);
    for (const [x, y, z] of [[-6, 2, 3], [6, 1, -3], [0, 5, 0], [-4, 4, -5], [4, 4, 5]]) b.box(null, b.parts.body, 6, 5, 6, x, y, z, 0, 0, 0, cloud);
    b.box('head', b.parts.body, 6, 6, 4, 0, 1, 8, 0, 0, 1, face);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 1, 1, 0.6, sx * 1.6, 1, 2.1, 0, 0, 0, eye);
    for (const [n, x, z, s] of [['l1', -3, 4, 1], ['l2', 3, 4, -1], ['l3', -3, -4, -1], ['l4', 3, -4, 1]]) { b.box(n, null, 2, 5, 2, x, 5, z, 0, -2.5, 0, face); b.legs.push([b.parts[n], s]); }
  },
  stormwarden(b) {
    const plate = b.mat('#7a8aa8', 'stone', { seed: 38 }), dark = b.mat('#3a4458', 'stone', { seed: 39 }), core = b.mat('#a0f0ff', 'none', { glow: '#40c0ff' }), eye = b.mat('#ffffff', 'none', { glow: '#80e0ff' });
    b.box('legL', null, 9, 18, 9, -6, 18, 0, 0, -9, 0, dark);
    b.box('legR', null, 9, 18, 9, 6, 18, 0, 0, -9, 0, dark);
    b.box('body', null, 24, 20, 14, 0, 18, 0, 0, 10, 0, plate);
    b.box(null, b.parts.body, 8, 8, 1, 0, 11, 7.2, 0, 0, 0, core);
    for (const sx of [-1, 1]) b.box(null, b.parts.body, 8, 6, 12, sx * 14, 19, 0, 0, 0, 0, dark); // shoulders
    b.box('armL', b.parts.body, 8, 24, 8, -16, 16, 0, 0, -11, 0, plate);
    b.box('armR', b.parts.body, 8, 24, 8, 16, 16, 0, 0, -11, 0, plate);
    b.box(null, b.parts.armL, 9, 6, 9, 0, -22, 0, 0, 0, 0, core);
    b.box(null, b.parts.armR, 9, 6, 9, 0, -22, 0, 0, 0, 0, core);
    b.box('head', b.parts.body, 12, 10, 10, 0, 20, 1, 0, 4, 0, plate);
    b.box(null, b.parts.head, 10, 2, 1, 0, 5, 5.2, 0, 0, 0, eye);
    for (let i = 0; i < 5; i++) b.box(null, b.parts.head, 2, 5 + (i % 2) * 3, 2, -4 + i * 2, 11, -1, 0, 0, 0, core); // crown of lightning
    b.legs = [[b.parts.legL, 1], [b.parts.legR, -1], [b.parts.armL, -0.4], [b.parts.armR, 0.4]];
  },
});


// ---------- v6 creatures ----------
// four legs: body [w,h,d], legs [width,height], head [w,h,d]; +z is the front
function quad(b, o) {
  const [bw, bh, bd] = o.body, [lw, lh] = o.leg, [hw, hh, hd] = o.head;
  const by = lh + bh / 2 - 1;
  b.box('body', null, bw, bh, bd, 0, by, 0, 0, 0, 0, o.fur);
  const lx = bw / 2 - lw / 2 - (o.legIn || 0), lz = bd / 2 - lw / 2 - 0.5;
  for (const [n, x, z, sg] of [['l1', -lx, lz, 1], ['l2', lx, lz, -1], ['l3', -lx, -lz, -1], ['l4', lx, -lz, 1]]) {
    b.box(n, null, lw, lh, lw, x, lh, z, 0, -lh / 2, 0, o.legMat || o.fur); b.legs.push([b.parts[n], sg]);
    if (o.hoof) b.box(null, b.parts[n], lw + 0.2, 1.5, lw + 0.2, 0, -lh + 0.75, 0, 0, 0, 0, o.hoof);
  }
  let hp = b.parts.body, hy = o.headY != null ? o.headY : bh / 2 - hh / 2 + 1, hz = bd / 2;
  if (o.neck) { b.box('neck', b.parts.body, o.neck[0], o.neck[1], o.neck[2] || o.neck[0], 0, bh / 2 - 2, bd / 2 - (o.neck[2] || o.neck[0]) / 2, 0, o.neck[1] / 2, 0, o.neckMat || o.fur); hp = b.parts.neck; hy = o.neck[1] - hh / 2; hz = 0; }
  b.box('head', hp, hw, hh, hd, 0, hy, hz, 0, 0, hd / 2 - (o.neck ? 1.5 : 1), o.headMat || o.fur);
  const eye = b.mat(o.eye || '#151515', 'none', o.eyeGlow ? { glow: o.eyeGlow } : {});
  const ez = hd - (o.neck ? 1.5 : 1);
  for (const sx of [-1, 1]) b.box(null, b.parts.head, 1, 1, 0.6, sx * (hw / 2 - 1.2), hh * 0.15, ez, 0, 0, 0, eye);
  if (o.tail) { b.box('tail', b.parts.body, o.tail[0], o.tail[1], o.tail[2], 0, bh / 2 - 1, -bd / 2, 0, -o.tail[1] / 2 + 0.5, -o.tail[2] / 2 + 0.5, o.tailMat || o.fur); b.parts.tail.rotation.x = o.tailTilt != null ? o.tailTilt : 0.3; }
  return { bw, bh, bd, hw, hh, hd, ez };
}
// two legs and two arms, 2 blocks tall; reach: arms held out in front
function biped(b, o) {
  const w = o.slim ? 2 : 4, bd = o.slim ? 2.5 : 4;
  b.box('legL', null, w, 12, w, -2, 12, 0, 0, -6, 0, o.pants);
  b.box('legR', null, w, 12, w, 2, 12, 0, 0, -6, 0, o.pants);
  b.box('body', null, 8, 12, bd, 0, 12, 0, 0, 6, 0, o.shirt);
  b.box('armL', b.parts.body, w, 12, w, -4 - w / 2, 11, 0, 0, -5, 0, o.arm || o.shirt);
  b.box('armR', b.parts.body, w, 12, w, 4 + w / 2, 11, 0, 0, -5, 0, o.arm || o.shirt);
  b.box('head', b.parts.body, 8, 8, 8, 0, 12, 0, 0, 4, 0, o.head);
  const eye = b.mat(o.eye || '#151515', 'none', o.eyeGlow ? { glow: o.eyeGlow } : {});
  for (const sx of [-1, 1]) b.box(null, b.parts.head, 1.6, 1.2, 0.6, sx * 2, 3.6, 4.1, 0, 0, 0, eye);
  if (o.reach) { b.parts.armL.rotation.x = b.parts.armR.rotation.x = -1.35; b.zombieArms = true; b.legs = [[b.parts.legL, 1], [b.parts.legR, -1]]; }
  else b.legs = [[b.parts.legL, 1], [b.parts.legR, -1], [b.parts.armL, -0.8], [b.parts.armR, 0.8]];
}
// a fish: body [w,h,d] centred a little off the floor, with a tail fin that wags
function fish(b, o) {
  const [w, h, d] = o.body;
  b.box('body', null, w, h, d, 0, h / 2 + 1, 0, 0, 0, 0, o.skin);
  b.box('tail', b.parts.body, 1, h * 1.1, 4, 0, 0, -d / 2, 0, 0, -2, o.fin || o.skin);
  if (o.top !== false) b.box(null, b.parts.body, 1, h * 0.5, d * 0.45, 0, h / 2 + h * 0.2, 0, 0, 0, 0, o.fin || o.skin);
  const eye = b.mat('#101010', 'none');
  for (const sx of [-1, 1]) { b.box(null, b.parts.body, 0.6, 1, 1, sx * (w / 2 + 0.1), h * 0.15, d / 2 - 1.5, 0, 0, 0, eye); b.box(null, b.parts.body, 2, 0.6, 2, sx * (w / 2 + 0.5), -h * 0.2, d * 0.1, sx * 0.5, 0, 0, o.fin || o.skin); }
}
// wings that flap all the time (bats, bees, parrots)
function wings(b, parent, w, d, x, y, z, mat) {
  b.box('wingL', parent, w, 0.6, d, -x, y, z, -w / 2, 0, 0, mat);
  b.box('wingR', parent, w, 0.6, d, x, y, z, w / 2, 0, 0, mat);
  b.flap = [b.parts.wingL, b.parts.wingR];
}

Object.assign(MOB_BUILDERS, {
  cow(b) {
    const hide = b.mat('#f2efe8', 'fur', { seed: 41 }), spot = b.mat('#2a2420', 'fur', { seed: 42 }), nose = b.mat('#e0a8a0', 'plain'), horn = b.mat('#e8e0c8', 'plain');
    const q = quad(b, { body: [12, 10, 18], leg: [4, 10], head: [8, 8, 6], headY: 4, fur: hide, hoof: spot });
    for (const [x, y, z, w, h, d] of [[6.1, 1, 3, 0.4, 5, 6], [-6.1, -1, -4, 0.4, 4, 5], [2, 5.1, -2, 5, 0.4, 6], [-3, 5.1, 5, 4, 0.4, 4]]) b.box(null, b.parts.body, w, h, d, x, y, z, 0, 0, 0, spot);
    b.box(null, b.parts.head, 6, 3, 1, 0, -2, q.hd - 0.6, 0, 0, 0, nose);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 1, 3, 1, sx * 4, 4.5, 1, 0, 0, 0, horn); b.box(null, b.parts.head, 2, 1, 1, sx * 4.8, 2, 1, 0, 0, 0, spot); }
    b.box('tail', b.parts.body, 1, 8, 1, 0, 4, -9, 0, -4, 0, spot);
  },
  pig(b) {
    const pink = b.mat('#f0a8a8', 'plain', { seed: 43 }), snout = b.mat('#e08a8a', 'plain'), dark = b.mat('#7a3a3a', 'none');
    const q = quad(b, { body: [10, 8, 16], leg: [4, 6], head: [8, 8, 8], headY: 2, fur: pink });
    b.box(null, b.parts.head, 4, 3, 1, 0, -1, q.hd - 0.5, 0, 0, 0, snout);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 0.8, 1, 0.3, sx * 1, -1, q.hd, 0, 0, 0, dark); b.box(null, b.parts.head, 2.5, 2, 1, sx * 3, 4.5, 2, 0, 0, 0, pink).rotation.x = 0.6; }
    b.box('tail', b.parts.body, 1, 1, 2, 0, 3, -8.5, 0, 0, 0, snout);
  },
  sheep(b) {
    const wool = b.mat('#eeeae2', 'wool', { seed: 44 }), face = b.mat('#3a3430', 'plain'), eyeW = b.mat('#f0f0f0', 'none');
    quad(b, { body: [12, 10, 16], leg: [3, 10], head: [6, 6, 7], headY: 4, fur: wool, legMat: face, headMat: face, eye: '#f2f2f2' });
    b.box(null, b.parts.head, 7, 3, 4, 0, 3.5, 1.5, 0, 0, 0, wool);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 2.5, 1, 1.5, sx * 4, 1.5, 2, 0, 0, 0, face);
    for (const [leg] of b.legs) b.box(null, leg, 3.6, 4, 3.6, 0, -2, 0, 0, 0, 0, wool);
    void eyeW;
  },
  chicken(b) {
    const fe = b.mat('#f6f4ee', 'fur', { seed: 45 }), beak = b.mat('#f0b030', 'plain'), wat = b.mat('#d83030', 'plain'), leg = b.mat('#e8a030', 'plain'), eye = b.mat('#151515', 'none');
    b.box('body', null, 6, 6, 8, 0, 6, 0, 0, 0, 0, fe);
    b.box('head', b.parts.body, 4, 6, 3, 0, 3, 3, 0, 2, 0.5, fe);
    b.box(null, b.parts.head, 4, 2, 2, 0, 2.5, 2.5, 0, 0, 0, beak);
    b.box(null, b.parts.head, 2, 2, 1, 0, 0.8, 2.4, 0, 0, 0, wat);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 0.6, 1, 1, sx * 2.1, 3.6, 1.2, 0, 0, 0, eye);
    wings(b, b.parts.body, 1, 6, 3.2, 1.5, 0, fe); b.flapRate = 0;
    for (const [n, x, sg] of [['l1', -1.5, 1], ['l2', 1.5, -1]]) { b.box(n, null, 1, 5, 1, x, 4, 0.5, 0, -2.5, 0, leg); b.legs.push([b.parts[n], sg]); }
  },
  rabbit(b) {
    const fur = b.mat('#a88a68', 'fur', { seed: 46 }), white = b.mat('#f0ece4', 'fur', { seed: 47 }), pink = b.mat('#e8a0a0', 'plain');
    quad(b, { body: [5, 5, 8], leg: [2, 3], head: [5, 5, 5], headY: 3, fur, tail: [3, 3, 2], tailMat: white, tailTilt: 0 });
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 1.5, 6, 1, sx * 1.3, 2.5, 1, 0, 3, 0, fur); b.box(null, b.parts.head, 0.8, 4.5, 0.3, sx * 1.3, 3, 1.6, 0, 2.5, 0, pink); }
    b.box(null, b.parts.head, 1, 0.8, 0.4, 0, 0, 4.2, 0, 0, 0, pink);
  },
  horse(b) { horseLike(b, '#8a5a32', '#2a1a10', 3, 'fur', 46); },
  donkey(b) { horseLike(b, '#8a847c', '#3a3430', 6, 'fur', 48, 0.85); },
  mule(b) { horseLike(b, '#5a3a24', '#22160e', 5, 'fur', 49, 0.92); },
  goat(b) {
    const fur = b.mat('#e8e2d6', 'fur', { seed: 50 }), horn = b.mat('#8a8070', 'plain'), dark = b.mat('#4a4038', 'plain');
    const q = quad(b, { body: [8, 9, 14], leg: [3, 9], head: [5, 6, 7], headY: 6, fur, hoof: dark, tail: [2, 3, 1] });
    b.parts.head.rotation.x = 0.3;
    for (const sx of [-1, 1]) { const h = b.box(null, b.parts.head, 1.5, 5, 1.5, sx * 1.6, 3, 1, 0, 2.5, 0, horn); h.rotation.x = -0.7; b.box(null, b.parts.head, 3, 1, 1, sx * 3.2, 1.5, 1.5, sx * 1, 0, 0, fur); }
    b.box(null, b.parts.head, 2, 3, 1, 0, -3.5, q.hd - 2, 0, 0, 0, fur);
  },
  llama(b) {
    const wool = b.mat('#e6d8bc', 'wool', { seed: 51 }), face = b.mat('#d8c8a8', 'fur', { seed: 52 }), dark = b.mat('#3a3028', 'plain');
    const q = quad(b, { body: [10, 10, 16], leg: [4, 12], head: [6, 6, 8], neck: [6, 12, 6], fur: wool, headMat: face, hoof: dark, tail: [3, 5, 2] });
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 1.5, 4, 1.5, sx * 2, 3, 1, 0, 2, 0, face);
    b.box(null, b.parts.head, 4, 3, 2, 0, -1, q.hd - 1.5, 0, 0, 0, face);
  },
  camel(b) {
    const fur = b.mat('#c8a068', 'fur', { seed: 53 }), dark = b.mat('#6a5030', 'plain');
    const q = quad(b, { body: [12, 10, 22], leg: [4, 20], head: [6, 6, 9], neck: [5, 12, 6], fur, hoof: dark, tail: [1.5, 7, 1.5] });
    for (const z of [5, -4]) b.box(null, b.parts.body, 8, 6, 7, 0, 7, z, 0, 0, 0, fur);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 1.5, 2, 1, sx * 2.5, 3.5, 0, 0, 0, 0, fur);
    b.box(null, b.parts.head, 4, 2, 2, 0, -2, q.hd - 2, 0, 0, 0, dark);
    b.parts.neck.rotation.x = 0.25; b.parts.head.rotation.x = -0.25;
  },
  armadillo(b) {
    const shell = b.mat('#a87060', 'stone', { seed: 54 }), skinM = b.mat('#d8a890', 'plain'), band = b.mat('#7a4a3a', 'plain');
    quad(b, { body: [8, 6, 12], leg: [2, 3], head: [3, 3, 5], headY: -1, fur: shell, legMat: skinM, headMat: skinM, tail: [1.5, 1.5, 6], tailMat: band, tailTilt: -0.3 });
    for (let i = -2; i <= 2; i++) b.box(null, b.parts.body, 8.4, 6.4, 1, 0, 0, i * 2.4, 0, 0, 0, band);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 1, 2.5, 1, sx * 1, 2.5, 0.5, 0, 0, 0, skinM);
  },
  panda(b) {
    const white = b.mat('#f2f0ea', 'fur', { seed: 55 }), black = b.mat('#1e1e22', 'fur', { seed: 56 });
    const q = quad(b, { body: [14, 12, 20], leg: [6, 8], head: [10, 9, 8], headY: 3, fur: white, legMat: black, eye: '#f2f2f2' });
    b.box(null, b.parts.body, 14.4, 5, 6, 0, 2, 6, 0, 0, 0, black);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 3, 3, 0.4, sx * 2.6, 1, q.ez + 0.2, 0, 0, 0, black); b.box(null, b.parts.head, 3, 3, 2, sx * 4, 5, 2, 0, 0, 0, black); }
    b.box(null, b.parts.head, 4, 3, 2, 0, -2.5, q.hd - 0.5, 0, 0, 0, white);
    b.box(null, b.parts.head, 2, 1, 0.6, 0, -1.5, q.hd + 0.6, 0, 0, 0, black);
  },
  turtle(b) {
    const shell = b.mat('#3e6a34', 'stone', { seed: 57 }), skinM = b.mat('#78a868', 'scale', { seed: 58 }), rim = b.mat('#7a6a40', 'plain');
    b.box('body', null, 16, 5, 18, 0, 4, 0, 0, 0, 0, shell);
    b.box(null, b.parts.body, 17, 1.5, 19, 0, -2, 0, 0, 0, 0, rim);
    b.box('head', b.parts.body, 5, 4, 6, 0, -0.5, 9, 0, 0, 2, skinM);
    const eye = b.mat('#101010', 'none');
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 0.5, 1, 1, sx * 2.6, 0.5, 3.5, 0, 0, 0, eye);
    for (const [n, x, z, sg] of [['l1', -7, 6, 1], ['l2', 7, 6, -1], ['l3', -6, -6, -1], ['l4', 6, -6, 1]]) { b.box(n, null, 6, 2, 4, x, 2.5, z, x > 0 ? 2 : -2, -0.5, 0, skinM); b.legs.push([b.parts[n], sg]); }
  },
  frog(b) {
    const skinM = b.mat('#6a9a3a', 'scale', { seed: 59 }), belly = b.mat('#d8d0a0', 'plain'), eyeW = b.mat('#f0e8c0', 'plain'), pup = b.mat('#151515', 'none');
    b.box('body', null, 7, 4, 8, 0, 3, 0, 0, 0, 0, skinM);
    b.box(null, b.parts.body, 6, 1, 6, 0, -2, 0.5, 0, 0, 0, belly);
    b.box('head', b.parts.body, 7, 2.5, 4, 0, 1, 4, 0, 0, 1, skinM);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 2.2, 2.2, 2.2, sx * 2.4, 2.2, 0.5, 0, 0, 0, eyeW); b.box(null, b.parts.head, 1, 1, 0.4, sx * 2.4, 2.2, 1.7, 0, 0, 0, pup); }
    for (const [n, x, z, sg] of [['l1', -3, 3, 1], ['l2', 3, 3, -1], ['l3', -4, -3, -1], ['l4', 4, -3, 1]]) { b.box(n, null, 2, 2, z > 0 ? 2 : 5, x, 1.5, z, 0, -0.5, 0, skinM); b.legs.push([b.parts[n], sg * 0.5]); }
  },
  cat(b) { catLike(b, '#d89a50', '#a86a30', '#78c040', 60); },
  ocelot(b) { catLike(b, '#e0c070', '#5a4020', '#50c060', 61); },
  polar_bear(b) {
    const fur = b.mat('#f4f2ec', 'fur', { seed: 62 }), dark = b.mat('#2a2a2a', 'plain');
    const q = quad(b, { body: [14, 12, 22], leg: [5, 10], head: [8, 7, 7], headY: 3, fur });
    b.box(null, b.parts.head, 4, 3, 3, 0, -1.5, q.hd, 0, 0, 0, fur);
    b.box(null, b.parts.head, 2, 1, 0.6, 0, -0.5, q.hd + 1.6, 0, 0, 0, dark);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 2, 2, 1, sx * 3, 4, 1, 0, 0, 0, fur);
  },
  wolf(b) {
    const fur = b.mat('#a8a8a4', 'fur', { seed: 63 }), light = b.mat('#dcd8d0', 'fur', { seed: 64 }), dark = b.mat('#2a2a2a', 'plain');
    const q = quad(b, { body: [6, 6, 12], leg: [2, 7], head: [6, 6, 5], headY: 2, fur, tail: [2, 2, 8], tailTilt: 0.6 });
    b.box(null, b.parts.body, 8, 7, 5, 0, 0.5, 3.5, 0, 0, 0, light);
    b.box(null, b.parts.head, 3, 3, 3, 0, -1.5, q.hd, 0, 0, 0, light);
    b.box(null, b.parts.head, 1.2, 1, 0.6, 0, -0.5, q.hd + 1.6, 0, 0, 0, dark);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 2, 2.5, 1, sx * 1.8, 4, 1, 0, 0, 0, fur);
  },
  fox(b) {
    const fur = b.mat('#e07a30', 'fur', { seed: 65 }), white = b.mat('#f4ece0', 'fur', { seed: 66 }), dark = b.mat('#2a2018', 'plain');
    const q = quad(b, { body: [6, 6, 11], leg: [2, 5], head: [7, 5, 5], headY: 2, fur, legMat: dark, tail: [4, 4, 9], tailTilt: 0.35 });
    b.box(null, b.parts.head, 3, 2, 3, 0, -1.5, q.hd, 0, 0, 0, white);
    b.box(null, b.parts.head, 1, 1, 0.6, 0, -1, q.hd + 1.6, 0, 0, 0, dark);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 2, 3, 1, sx * 2.2, 4, 1, 0, 0, 0, fur);
    b.box(null, b.parts.tail, 4.2, 4.2, 3, 0, -1.5, -8, 0, 0, 0, white);
  },
  bat(b) {
    const fur = b.mat('#4a3a30', 'fur', { seed: 67 }), wing = b.mat('#2a2220', 'plain'), eye = b.mat('#202020', 'none');
    b.box('body', null, 4, 6, 3, 0, 8, 0, 0, 0, 0, fur);
    b.box('head', b.parts.body, 4, 4, 4, 0, 3, 0, 0, 2, 0, fur);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 1, 2, 1, sx * 1.5, 4.5, 0, 0, 0, 0, fur); b.box(null, b.parts.head, 0.8, 0.8, 0.4, sx * 1, 2.4, 2.1, 0, 0, 0, eye); }
    wings(b, b.parts.body, 8, 6, 2, 1.5, -0.5, wing); b.flapRate = 40;
  },
  bee(b) {
    const yel = b.mat('#f0c030', 'fur', { seed: 68 }), blk = b.mat('#2a2018', 'plain'), wing = b.mat('#e8f4ff', 'none', { opacity: 0.6 }), eye = b.mat('#101010', 'none');
    b.box('body', null, 6, 6, 9, 0, 6, 0, 0, 0, 0, yel);
    for (const z of [-1.5, 1.5]) b.box(null, b.parts.body, 6.3, 6.3, 1.2, 0, 0, z, 0, 0, 0, blk);
    b.box('head', b.parts.body, 6.2, 6.2, 1, 0, 0, 4.4, 0, 0, 0, yel);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 1.5, 2, 0.4, sx * 1.6, 0.5, 0.6, 0, 0, 0, eye); b.box(null, b.parts.head, 0.5, 3, 0.5, sx * 1.2, 3, 0.5, 0, 1.5, 0, blk).rotation.x = 0.6; }
    b.box(null, b.parts.body, 1, 1, 2, 0, -0.5, -5, 0, 0, 0, blk);
    wings(b, b.parts.body, 6, 4, 1, 3.3, 0, wing); b.flapRate = 18;
    for (const [n, x, z, sg] of [['l1', -1.5, 2, 1], ['l2', 1.5, -1, -1]]) { b.box(n, b.parts.body, 1, 2, 1, x, -3, z, 0, -1, 0, blk); b.legs.push([b.parts[n], sg]); }
  },
  parrot(b) {
    const red = b.mat('#d83030', 'fur', { seed: 69 }), blue = b.mat('#2a60d0', 'plain'), yel = b.mat('#f0c030', 'plain'), beak = b.mat('#3a3a3a', 'plain'), eye = b.mat('#101010', 'none');
    b.box('body', null, 4, 7, 4, 0, 6, 0, 0, 0, 0, red);
    b.parts.body.rotation.x = -0.25;
    b.box('head', b.parts.body, 4, 4, 4, 0, 4, 0.5, 0, 2, 0, red);
    b.box(null, b.parts.head, 1.5, 2.5, 2, 0, 1, 2.6, 0, 0, 0, beak);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 0.4, 1, 1, sx * 2.1, 2.5, 1, 0, 0, 0, eye);
    b.box(null, b.parts.head, 1, 2, 3, 0, 4.5, -0.5, 0, 0, 0, red);
    b.box('tail', b.parts.body, 3, 7, 1, 0, -3, -2, 0, -3, 0, blue);
    wings(b, b.parts.body, 1, 5, 2.3, 1, 0, blue);
    b.parts.wingL.rotation.x = b.parts.wingR.rotation.x = 0;
    b.box(null, b.parts.wingL, 1.1, 2, 5.2, -0.5, -2, 0, 0, 0, 0, yel); b.box(null, b.parts.wingR, 1.1, 2, 5.2, 0.5, -2, 0, 0, 0, 0, yel);
    b.flapRate = 30;
    for (const [n, x, sg] of [['l1', -1, 1], ['l2', 1, -1]]) { b.box(n, null, 1, 3, 1, x, 3, 0, 0, -1.5, 0, beak); b.legs.push([b.parts[n], sg]); }
  },
  cod(b) { fish(b, { body: [3, 4, 10], skin: b.mat('#b0a078', 'scale', { seed: 70 }), fin: b.mat('#8a7a58', 'plain') }); },
  salmon(b) { fish(b, { body: [3, 5, 13], skin: b.mat('#b04a3a', 'scale', { seed: 71 }), fin: b.mat('#5a6a5a', 'plain') }); },
  tropical_fish(b) {
    fish(b, { body: [2, 5, 6], skin: b.mat('#f08a20', 'scale', { seed: 72 }), fin: b.mat('#f4f0e8', 'plain') });
    const st = b.mat('#f4f0e8', 'plain'); b.box(null, b.parts.body, 2.3, 5.2, 1, 0, 0, 0.5, 0, 0, 0, st);
  },
  pufferfish(b) {
    const y = b.mat('#e8c040', 'scale', { seed: 73 }), sp = b.mat('#f4f0d0', 'plain'), eye = b.mat('#101010', 'none');
    b.box('body', null, 8, 8, 8, 0, 5, 0, 0, 0, 0, y);
    for (const [x, yy, z] of [[4.4, 0, 0], [-4.4, 0, 0], [0, 4.4, 0], [0, -4.4, 0], [0, 0, -4.4], [3, 3, 3], [-3, 3, 3], [3, -3, -3], [-3, -3, -3]]) b.box(null, b.parts.body, 1, 1, 1, x, yy, z, 0, 0, 0, sp);
    for (const sx of [-1, 1]) b.box(null, b.parts.body, 1.5, 1.5, 0.4, sx * 2, 1.5, 4.1, 0, 0, 0, eye);
    b.box('tail', b.parts.body, 1, 3, 2, 0, 0, -4, 0, 0, -1, sp);
  },
  squid(b) {
    const ink = b.mat('#2a3a5a', 'scale', { seed: 74 }), eye = b.mat('#e8e8e8', 'plain'), pup = b.mat('#101010', 'none');
    b.box('body', null, 10, 14, 10, 0, 14, 0, 0, 0, 0, ink);
    for (const sx of [-1, 1]) { b.box(null, b.parts.body, 2, 2, 0.4, sx * 3, -3, 5.1, 0, 0, 0, eye); b.box(null, b.parts.body, 1, 1, 0.4, sx * 3, -3, 5.3, 0, 0, 0, pup); }
    for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283, n = 't' + i; b.box(n, null, 2, 12, 2, Math.cos(a) * 3.5, 7, Math.sin(a) * 3.5, 0, -6, 0, ink); b.parts[n].rotation.x = Math.sin(a) * 0.3; b.parts[n].rotation.z = -Math.cos(a) * 0.3; b.legs.push([b.parts[n], i % 2 ? 0.4 : -0.4]); }
  },
  dolphin(b) {
    const g = b.mat('#7a8aa0', 'scale', { seed: 75 }), belly = b.mat('#d8dce4', 'plain'), eye = b.mat('#101010', 'none');
    b.box('body', null, 7, 7, 16, 0, 5, 0, 0, 0, 0, g);
    b.box(null, b.parts.body, 6, 2, 14, 0, -2.6, 0, 0, 0, 0, belly);
    b.box('head', b.parts.body, 6, 6, 5, 0, 0, 8, 0, 0, 2, g);
    b.box(null, b.parts.head, 3, 2, 4, 0, -1.5, 6, 0, 0, 0, belly);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 0.4, 1, 1, sx * 3.1, 0.5, 2.5, 0, 0, 0, eye); b.box(null, b.parts.body, 4, 1, 3, sx * 4, -2, 4, sx * 1.5, 0, 0, g); }
    b.box(null, b.parts.body, 1, 5, 4, 0, 5, -1, 0, 0, 0, g);
    b.box('tail', b.parts.body, 2, 2, 8, 0, 1, -8, 0, 0, -4, g);
    b.box(null, b.parts.tail, 9, 1, 3, 0, 0, -8, 0, 0, 0, g);
  },
  axolotl(b) {
    const pink = b.mat('#f0a8c0', 'plain', { seed: 76 }), frill = b.mat('#d0507a', 'plain'), eye = b.mat('#202020', 'none');
    b.box('body', null, 5, 3, 10, 0, 2.5, 0, 0, 0, 0, pink);
    b.box('head', b.parts.body, 7, 4, 5, 0, 0.5, 5, 0, 0, 2, pink);
    for (const sx of [-1, 1]) { b.box(null, b.parts.head, 0.5, 1, 1, sx * 3.6, 0.5, 4, 0, 0, 0, eye); for (let k = 0; k < 3; k++) b.box(null, b.parts.head, 3, 1, 1, sx * 4.5, 2 - k * 1.4, 1, sx * 1, 0, 0, frill); }
    b.box('tail', b.parts.body, 1, 4, 8, 0, 0, -5, 0, 0, -4, pink);
    for (const [n, x, z, sg] of [['l1', -3, 3, 1], ['l2', 3, 3, -1], ['l3', -3, -3, -1], ['l4', 3, -3, 1]]) { b.box(n, null, 1.5, 2, 1.5, x, 1.5, z, 0, -0.5, 0, pink); b.legs.push([b.parts[n], sg]); }
  },
  tadpole(b) {
    const d = b.mat('#3a3020', 'plain'), eye = b.mat('#101010', 'none');
    b.box('body', null, 3, 2, 3, 0, 1.5, 0, 0, 0, 0, d);
    b.box('tail', b.parts.body, 0.6, 2, 4, 0, 0, -1.5, 0, 0, -2, d);
    for (const sx of [-1, 1]) b.box(null, b.parts.body, 0.4, 0.6, 0.6, sx * 1.6, 0.3, 0.8, 0, 0, 0, eye);
  },
  zombie(b) {
    const skinM = b.mat('#5a8a4a', 'plain', { seed: 77 }), shirt = b.mat('#3a8a9a', 'cloth', { seed: 78 }), pants = b.mat('#3a3a8a', 'cloth', { seed: 79 }), dark = b.mat('#2a3a22', 'plain');
    biped(b, { head: skinM, shirt, pants, arm: skinM, reach: true, eye: '#101810' });
    b.box(null, b.parts.head, 4, 1, 0.4, 0, 1.2, 4.1, 0, 0, 0, dark);
    b.box(null, b.parts.body, 8.2, 3, 4.2, 0, 2, 0, 0, 0, 0, pants);
  },
  skeleton(b) {
    const bone = b.mat('#d8d4c8', 'stone', { seed: 80 }), dark = b.mat('#4a4844', 'plain'), bow = b.mat('#7a5a34', 'plain');
    biped(b, { head: bone, shirt: bone, pants: bone, slim: true, eye: '#202020' });
    b.box(null, b.parts.head, 4, 1, 0.4, 0, 1.2, 4.1, 0, 0, 0, dark);
    for (let i = 0; i < 4; i++) b.box(null, b.parts.body, 8.4, 0.8, 0.4, 0, 3 + i * 2.2, 1.4, 0, 0, 0, dark);
    const bw = b.box(null, b.parts.armL, 1, 12, 1, 0, -10, 1.5, 0, 0, 0, bow); bw.rotation.x = 0.2;
  },
  spider(b) { spiderLike(b, '#3a302a', '#d02020', 1, 81); },
  cave_spider(b) { spiderLike(b, '#1e4a52', '#d02020', 0.55, 82); },
  slime(b) {
    const outer = b.mat('#70d060', 'none', { opacity: 0.55 }), inner = b.mat('#3a9a30', 'plain'), eye = b.mat('#1a3a14', 'none');
    b.box('body', null, 14, 14, 14, 0, 7, 0, 0, 0, 0, outer);
    b.box(null, b.parts.body, 7, 7, 7, 0, -1, 0, 0, 0, 0, inner);
    for (const sx of [-1, 1]) b.box(null, b.parts.body, 2, 2, 0.6, sx * 3, 2, 7.1, 0, 0, 0, eye);
    b.box(null, b.parts.body, 2, 1, 0.6, 0, -2, 7.1, 0, 0, 0, eye);
  },
  witch(b) {
    const skinM = b.mat('#c8a888', 'plain', { seed: 83 }), robe = b.mat('#4a2a5a', 'cloth', { seed: 84 }), hat = b.mat('#2a1a32', 'cloth', { seed: 85 }), band = b.mat('#60c040', 'plain'), wart = b.mat('#7a9a50', 'plain');
    biped(b, { head: skinM, shirt: robe, pants: robe, arm: robe, eye: '#40a040' });
    b.box(null, b.parts.head, 2, 4, 2, 0, -0.5, 4.5, 0, 0, 1, skinM);
    b.box(null, b.parts.head, 1, 1, 1, 0.8, -2, 6, 0, 0, 0, wart);
    b.box(null, b.parts.head, 10, 1, 10, 0, 8.5, 0, 0, 0, 0, hat);
    b.box(null, b.parts.head, 7, 4, 7, 0, 11, 0, 0, 0, 0, hat);
    b.box(null, b.parts.head, 7.4, 1, 7.4, 0, 9.5, 0, 0, 0, 0, band);
    const tip = b.box(null, b.parts.head, 4, 4, 4, 0, 14.5, -1, 0, 0, 0, hat); tip.rotation.x = -0.35;
    b.box(null, b.parts.body, 9, 10, 5, 0, -6, 0, 0, 0, 0, robe);
  },
  villager(b, prof) {
    const PC = { farmer: '#c8a040', librarian: '#e8e4d8', smith: '#33333a', butcher: '#e8e8e8', mason: '#7a5a40', shepherd: '#e0c8a0', fisher: '#3a6a8a', cleric: '#7a3a9a' };
    const skinM = b.mat('#b8865e', 'plain', { seed: 90 }), robe = b.mat('#6a4a30', 'cloth', { seed: 91 }), apron = b.mat(PC[prof] || '#7a6a50', 'cloth', { seed: 92 }), brow = b.mat('#3a2a1a', 'plain');
    biped(b, { head: skinM, shirt: robe, pants: robe, arm: robe, eye: '#2a6a2a' });
    b.box(null, b.parts.body, 8.6, 8, 4.6, 0, -4, 0, 0, 0, 0, robe);
    b.box(null, b.parts.body, 6, 12, 0.6, 0, 4, 2.4, 0, 0, 0, apron);
    b.box(null, b.parts.head, 2, 4, 2, 0, 1.5, 4, 0, 0, 1, skinM);
    b.box(null, b.parts.head, 6, 1, 0.4, 0, 5, 4.1, 0, 0, 0, brow);
    b.box(null, b.parts.head, 8.4, 1, 8.4, 0, 7.5, 0, 0, 0, 0, apron);
    if (prof === 'farmer') b.box(null, b.parts.head, 12, 1, 12, 0, 8.5, 0, 0, 0, 0, b.mat('#e0c070', 'cloth', { seed: 95 }));
    b.parts.armL.rotation.x = b.parts.armR.rotation.x = -0.75;
    b.box(null, b.parts.body, 10, 3, 3, 0, 7, 4, 0, 0, 0, robe);
    b.legs = [[b.parts.legL, 1], [b.parts.legR, -1]];
  },
  bulwark(b) {
    const st = b.mat('#a8a49a', 'stone', { seed: 93 }), moss = b.mat('#5a7a3a', 'moss', { seed: 94 }), eye = b.mat('#d04020', 'none', { glow: '#702000' }), iron = b.mat('#d0d2d8', 'metal', { seed: 96 });
    b.box('legL', null, 6, 12, 5, -4, 12, 0, 0, -6, 0, st);
    b.box('legR', null, 6, 12, 5, 4, 12, 0, 0, -6, 0, st);
    b.box('body', null, 18, 13, 10, 0, 12, 0, 0, 6.5, 0, iron);
    b.box(null, b.parts.body, 10, 6, 10.4, -3, 9, 0, 0, 0, 0, moss);
    b.box(null, b.parts.body, 12, 4, 8, 0, -1, 0, 0, 0, 0, st);
    b.box('armL', b.parts.body, 5, 28, 6, -11.5, 11, 0, 0, -12, 0, st);
    b.box('armR', b.parts.body, 5, 28, 6, 11.5, 11, 0, 0, -12, 0, st);
    b.box(null, b.parts.armL, 5.4, 6, 6.4, 0, -6, 0, 0, 0, 0, moss);
    b.box('head', b.parts.body, 8, 10, 8, 0, 13, -1, 0, 4, 1, iron);
    b.box(null, b.parts.head, 2, 4, 2, 0, 2, 5, 0, 0, 0, st);
    for (const sx of [-1, 1]) b.box(null, b.parts.head, 2, 1.2, 0.6, sx * 2, 5, 5.1, 0, 0, 0, eye);
    b.legs = [[b.parts.legL, 1], [b.parts.legR, -1], [b.parts.armL, -0.6], [b.parts.armR, 0.6]];
  },
  silverfish(b) {
    const g = b.mat('#8a8e94', 'stone', { seed: 86 }), dark = b.mat('#5a5e64', 'plain');
    b.box('body', null, 4, 3, 4, 0, 1.5, 1, 0, 0, 0, g);
    b.box('head', b.parts.body, 3, 2, 2, 0, -0.5, 3, 0, 0, 0, dark);
    let prev = b.parts.body;
    for (let i = 0; i < 4; i++) { const seg = b.box(i === 3 ? 'tail' : null, prev, 4 - i * 0.7, 2.6 - i * 0.4, 2, 0, -0.2, -3, 0, 0, 0, i % 2 ? dark : g); prev = seg; }
  },
});

function horseLike(b, col, mane, ear, style, seed, k = 1) {
  const fur = b.mat(col, style, { seed }), dark = b.mat(mane, 'fur', { seed: seed + 100 }), hoofM = b.mat('#2a2420', 'plain');
  const q = quad(b, { body: [10 * k, 10 * k, 22 * k], leg: [4, 14 * k], head: [6, 6, 10], neck: [5, 12 * k, 7], fur, hoof: hoofM, tail: [3, 11 * k, 3], tailMat: dark, tailTilt: 0.4 });
  b.parts.neck.rotation.x = 0.45; b.parts.head.rotation.x = -0.1;
  b.box(null, b.parts.neck, 2, 12 * k, 2, 0, 0, -3, 0, 6 * k, 0, dark);
  for (const sx of [-1, 1]) b.box(null, b.parts.head, 1.5, ear, 1, sx * 1.8, 3, 0, 0, ear / 2, 0, fur);
  b.box(null, b.parts.head, 5, 4, 4, 0, -1, q.hd - 3, 0, 0, 0, fur);
}
function catLike(b, col, stripe, eyeCol, seed) {
  const fur = b.mat(col, 'fur', { seed }), st = b.mat(stripe, 'plain'), pink = b.mat('#e8a0a0', 'plain');
  const q = quad(b, { body: [4, 4, 12], leg: [2, 6], head: [5, 4, 5], headY: 2, fur, tail: [1, 1, 9], tailTilt: -0.6, eye: eyeCol, eyeGlow: '#203010' });
  for (let i = -1; i <= 1; i++) b.box(null, b.parts.body, 4.3, 0.8, 1, 0, 2, i * 3, 0, 0, 0, st);
  for (const sx of [-1, 1]) b.box(null, b.parts.head, 1.2, 1.5, 1, sx * 1.5, 2.6, 1, 0, 0, 0, fur);
  b.box(null, b.parts.head, 2, 1.5, 1, 0, -1, q.hd - 0.5, 0, 0, 0, fur);
  b.box(null, b.parts.head, 0.8, 0.6, 0.4, 0, -0.6, q.hd + 0.1, 0, 0, 0, pink);
}
function spiderLike(b, col, eyeCol, k, seed) {
  const fur = b.mat(col, 'fur', { seed }), eye = b.mat(eyeCol, 'none', { glow: '#600000' });
  b.box('body', null, 10 * k, 8 * k, 12 * k, 0, 9 * k, -5 * k, 0, 0, 0, fur);
  b.box('head', null, 8 * k, 8 * k, 8 * k, 0, 9 * k, 3 * k, 0, 0, 0, fur);
  for (const sx of [-1, 1]) for (const [x, y] of [[1.5, 1.5], [3, 1], [1, 0], [2.6, -0.5]]) b.box(null, b.parts.head, 1, 1, 0.5, sx * x * k, y * k, 4.1 * k, 0, 0, 0, eye);
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
    const n = 'sl' + i + sx, z = (2 - i * 1.6) * k;
    b.box(n, null, 16 * k, 2 * k, 2 * k, sx * 3 * k, 9 * k, z, sx * 8 * k, 0, 0, fur);
    b.parts[n].rotation.z = sx * -0.6; b.parts[n].rotation.y = sx * (i - 1.5) * 0.35;
    b.legs.push([b.parts[n], (i % 2 ? 1 : -1) * sx * 0.25]);
  }
}

export function mobModel(type, size) {
  const b = new Builder();
  (MOB_BUILDERS[type] || MOB_BUILDERS.gloomling)(b, size);
  const H = { bramblebuck: 1.6, puffhen: 0.8, mossback: 1.0, fluffalo: 1.7, glimmerfin: 0.5, ashfox: 0.8, gloomling: 2.0, thornspitter: 1.8, burrower: 0.8, blastcap: 1.6, gelatoad: 1.3, cragjaw: 2.6, brindlehound: 1.0, scorchling: 2.0, magmite: 0.9, cinderhog: 1.1, galewing: 1.0, puffcloud: 1.1, stormwarden: 3.6 }[type] || 1.5;
  const H2 = { cow: 1.5, pig: 1.0, sheep: 1.4, chicken: 0.8, rabbit: 0.6, horse: 1.9, donkey: 1.6, mule: 1.8, goat: 1.3, llama: 1.9, camel: 2.4, armadillo: 0.6, panda: 1.4,
    turtle: 0.5, frog: 0.5, cat: 0.8, ocelot: 0.8, polar_bear: 1.5, wolf: 0.9, fox: 0.8, bat: 0.9, bee: 0.8, parrot: 1.0, cod: 0.4, salmon: 0.5, tropical_fish: 0.5,
    pufferfish: 0.7, squid: 1.3, dolphin: 0.7, axolotl: 0.5, tadpole: 0.3, villager: 2.0, bulwark: 2.8, zombie: 2.0, skeleton: 2.0, spider: 1.0, cave_spider: 0.6, slime: 1.0, witch: 2.4, silverfish: 0.3 }[type];
  const M = finish(b, type, H2 || H);
  if (type === 'gelatoad' || type === 'slime') { const s = (size || 3) / 3; M.scale = s; M.root.scale.setScalar(s); M.height = (H2 || H) * s; }
  return M;
}

// ---------- shared animation ----------
function finish(b, kind, height) {
  const M = { root: b.root, mats: b.mats, parts: b.parts, kind, height, phase: Math.random() * 10, speed: 0, scale: 1, flash: 0, swing: 0, bright: 1, sneakK: 0, climbK: 0,
    bodyY: b.parts.body ? b.parts.body.position.y : 0 };
  b.root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.matrixAutoUpdate = true; } });
  M.update = (dt, st) => animate(M, b, dt, st);
  return M;
}
function animate(M, b, dt, st) {
  const P = M.parts;
  const moving = st.flags & 1, swinging = st.flags & 2, hurt = st.flags & 4, sleeping = st.flags & 16, water = st.flags & 32, fuse = st.flags & 64, eating = st.flags & 256, dead = st.flags & 512;
  M.speed += ((moving ? 1 : 0) - M.speed) * Math.min(1, dt * 8);
  M.phase += dt * (M.kind === 'player' ? 9 : 10) * (0.3 + M.speed);
  const s = Math.sin(M.phase) * M.speed;
  const pl = M.kind === 'player';
  M.sneakK += ((pl && st.flags & 2048 ? 1 : 0) - M.sneakK) * Math.min(1, dt * 10);
  M.climbK += ((pl && st.flags & 4096 ? 1 : 0) - M.climbK) * Math.min(1, dt * 10);
  const sk = M.sneakK;
  // walk cycle: legs swing wide, arms swing opposite and a bit less; sneaking shortens the stride
  for (const [leg, sign] of b.legs) {
    const arm = leg === P.armL || leg === P.armR;
    const amp = pl ? (arm ? 0.7 : 1.0) * (1 - 0.45 * sk) : 0.8;
    leg.rotation.x = s * amp * sign + (b.zombieArms && arm ? -1.35 : 0);
  }
  if (b.flap && b.flapRate !== 0) { const f = Math.sin(performance.now() / (b.flapRate || 60)) * 0.9; b.flap[0].rotation.z = f; b.flap[1].rotation.z = -f; }
  if (pl && P.body) {
    // sneak: lean forward from the hips, drop a little, keep the head looking ahead
    P.body.rotation.x = 0.45 * sk;
    P.body.position.y = M.bodyY - (1.6 / 16) * sk - Math.abs(Math.sin(M.phase)) * M.speed * (0.35 / 16);
  }
  if (P.head) P.head.rotation.x = Math.sin(M.phase * 0.5) * 0.05 + (st.pitch || 0) * (M.kind === 'player' ? 0.8 : 0.3) - (pl ? 0.45 * sk : 0);
  if (P.tail) P.tail.rotation.y = Math.sin(M.phase * 0.7 + 1) * 0.25;
  if (P.jaw) P.jaw.rotation.x = 0.15 + Math.max(0, Math.sin(M.phase * 0.6)) * 0.3 + (swinging ? 0.5 : 0);
  if (M.kind === 'glimmerfin' && P.tail) P.tail.rotation.y = Math.sin(performance.now() / 120) * 0.5;
  if (b.squash && P.body) { const k = Math.abs(Math.sin(M.phase * 0.5)) * M.speed; P.body.scale.set(1 + k * 0.12, 1 - k * 0.18, 1 + k * 0.12); }
  // swing the right arm (attack / mine / place)
  if (swinging) M.swing = Math.min(1, M.swing + dt * 6); else M.swing = Math.max(0, M.swing - dt * 4);
  if (P.armR && !b.zombieArms) {
    let r = s * 0.8 * (b.legs.find(l => l[0] === P.armR) || [0, 1])[1];
    if (M.swing > 0) r = -1.2 - Math.sin(performance.now() / 70) * 0.9 * M.swing;
    if (eating) r = -1.4 + Math.sin(performance.now() / 90) * 0.2;
    P.armR.rotation.x = r;
  } else if (P.armR && swinging) P.armR.rotation.x = -1.35 - Math.sin(performance.now() / 70) * 0.6;
  if (P.armL && water && M.kind === 'player') { P.armL.rotation.z = -0.4 - Math.sin(M.phase) * 0.3; P.armR.rotation.z = 0.4 + Math.sin(M.phase) * 0.3; }
  else if (P.armL && M.kind === 'player') { const br = Math.sin(performance.now() / 1300) * 0.035; P.armL.rotation.z = -0.05 - br; P.armR.rotation.z = 0.05 + br; }
  // climbing a ladder: hands reach up and pull in turn, feet push
  if (pl && M.climbK > 0.02 && P.armL) {
    const t = performance.now() / 160, k = M.climbK;
    P.armL.rotation.x += (-2.6 + Math.sin(t) * 0.35 - P.armL.rotation.x) * k;
    if (!M.swing) P.armR.rotation.x += (-2.6 - Math.sin(t) * 0.35 - P.armR.rotation.x) * k;
    P.legL.rotation.x += (Math.sin(t) * 0.45 - P.legL.rotation.x) * k;
    P.legR.rotation.x += (-Math.sin(t) * 0.45 - P.legR.rotation.x) * k;
  }
  // whole-body poses
  const r = M.root;
  if (dead) { r.rotation.z += (Math.PI / 2 - r.rotation.z) * Math.min(1, dt * 6); }
  else if (sleeping) { r.rotation.z = 0; r.rotation.x = -Math.PI / 2; }
  else { r.rotation.z *= 0.8; r.rotation.x = 0; }
  // fuse: swell and flash
  let flash = hurt ? 1 : 0;
  if (fuse) { const f = 0.5 + 0.5 * Math.sin(performance.now() / 60); flash = Math.max(flash, f); r.scale.setScalar(M.scale * (1 + f * 0.12)); }
  else r.scale.setScalar(M.scale);
  M.flash += (flash - M.flash) * Math.min(1, dt * 20);
  for (const m of M.mats) {
    m.color.copy(m.userData.base).multiplyScalar(M.bright);
    if (fuse) m.color.lerp(new THREE.Color(1, 1, 1), M.flash * 0.7);
    else if (M.flash > 0.02) m.color.lerp(new THREE.Color(1, 0.25, 0.2), M.flash * 0.6);
  }
}

// ---------- held item ----------
export function setHeld(M, item, makeItemMesh) {
  if (!M.parts.hand || M.heldId === item) return;
  M.heldId = item;
  if (M.heldMesh) { M.parts.hand.remove(M.heldMesh); M.heldMesh = null; }
  if (!item) return;
  const m = makeItemMesh(item, true);
  if (!m) return;
  M.heldMesh = m;
  M.parts.hand.add(m);
}
