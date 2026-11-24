// Viewer world worker: regenerates terrain from the seed, applies block changes (forward and backward in time),
// computes sky and block light, and builds chunk meshes with smooth lighting and ambient occlusion.
importScripts('/shared/defs.js', '/shared/noise.js', '/shared/worldgen.js');
const { defs, worldgen } = self.BW;
const { BLOCKS, B, HEIGHT, WORLD_CHUNKS, BIOMES } = defs;
void WORLD_CHUNKS;

// ---------- per-id lookup tables ----------
const RCODE = { none: 0, cube: 1, cutout: 2, leaves: 3, cross: 4, torch: 5, liquid: 6, blend: 7 };
const OPQ = new Uint8Array(256), RND = new Uint8Array(256), LIT = new Uint8Array(256), FLT = new Uint8Array(256), HGT = new Float32Array(256).fill(1), SOL = new Uint8Array(256);
for (const b of BLOCKS) {
  OPQ[b.id] = b.opaque ? 1 : 0; RND[b.id] = RCODE[b.render]; LIT[b.id] = b.light; FLT[b.id] = b.filter || (b.render === 'leaves' ? 1 : 0);
  HGT[b.id] = b.height; SOL[b.id] = b.solid ? 1 : 0;
}
let gen = null, tileRect = {}, faceRect = [];
const chunks = new Map();       // key -> { blocks, biomes }
const changes = [];             // [t, x, y, z, id]
const undo = [];                // old ids for applied changes
let applied = 0;                // number of changes applied
const byChunk = new Map();      // key -> [change indices]
const meshed = new Set();       // keys the main thread currently shows
const dirty = new Set();
let want = [];                  // keys to mesh, nearest first
let busy = false, flip = false;

const key = (cx, cz) => defs.ckey(cx, cz);
function chunk(cx, cz) {
  if (!defs.realmOfChunk(cx, cz)) return null;
  const k = key(cx, cz);
  let c = chunks.get(k);
  if (!c) {
    c = gen.chunk(cx, cz);
    chunks.set(k, c);
    const list = byChunk.get(k);
    if (list) for (const i of list) if (i < applied) { const ch = changes[i]; const bi = idx(ch[1], ch[2], ch[3]); undo[i] = c.blocks[bi]; c.blocks[bi] = ch[4]; }
  }
  return c;
}
const idx = (x, y, z) => (y << 8) | ((z & 15) << 4) | (x & 15);
function setBlock(x, y, z, id) {
  const c = chunks.get(key(x >> 4, z >> 4));
  if (!c) return null;
  const i = idx(x, y, z), old = c.blocks[i];
  c.blocks[i] = id;
  return old;
}
function markDirty(x, y, z, a, b) {
  const cx = x >> 4, cz = z >> 4, lx = x & 15, lz = z & 15;
  const r = LIT[a] || LIT[b] || OPQ[a] !== OPQ[b] ? (LIT[a] || LIT[b] ? 14 : 2) : 1;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (dx < 0 && lx > r - 1 || dx > 0 && lx < 16 - r || dz < 0 && lz > r - 1 || dz > 0 && lz < 16 - r) continue;
    const k = key(cx + dx, cz + dz);
    if (meshed.has(k)) dirty.add(k);
  }
}
function seek(t) {
  // forward
  while (applied < changes.length && changes[applied][0] <= t) {
    const [, x, y, z, id] = changes[applied];
    const k = key(x >> 4, z >> 4);
    if (chunks.has(k)) { const old = setBlock(x, y, z, id); undo[applied] = old; if (old !== id) markDirty(x, y, z, old, id); }
    applied++;
  }
  // backward
  while (applied > 0 && changes[applied - 1][0] > t) {
    applied--;
    const [, x, y, z, id] = changes[applied];
    const k = key(x >> 4, z >> 4);
    if (chunks.has(k) && undo[applied] != null) { setBlock(x, y, z, undo[applied]); markDirty(x, y, z, id, undo[applied]); }
  }
}

// ---------- light ----------
const P = 12;                    // padding around the chunk for lighting
const RX = 16 + P * 2;
let reg = null, sky = null, blk = null, regBiome = null, regH = 0, queue = new Int32Array(1 << 20);
function buildRegion(cx, cz) {
  let maxY = 0;
  const cs = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const c = chunk(cx + dx, cz + dz); cs.push(c); if (c) for (let i = 0; i < 256; i++) if (c.heights[i] > maxY) maxY = c.heights[i]; }
  // heights may have grown through building; scan the center chunk precisely
  const cc = chunk(cx, cz);
  for (let y = HEIGHT - 1; y > maxY; y--) { let any = false; for (let i = 0; i < 256; i++) if (cc.blocks[(y << 8) | i]) { any = true; break; } if (any) { maxY = y; break; } }
  for (const c of cs) if (c && c !== cc) for (let y = HEIGHT - 1; y > maxY + 1; y -= 1) { let any = false; for (let i = 0; i < 256; i += 17) if (c.blocks[(y << 8) | i]) { any = true; break; } if (any) { maxY = Math.max(maxY, y); break; } }
  regH = Math.min(HEIGHT, maxY + 3);
  const N = RX * RX * regH;
  if (!reg || reg.length < N) { reg = new Uint8Array(N); sky = new Uint8Array(N); blk = new Uint8Array(N); }
  regBiome = new Uint8Array(RX * RX);
  const ox = cx * 16 - P, oz = cz * 16 - P;
  for (let rz = 0; rz < RX; rz++) for (let rx = 0; rx < RX; rx++) {
    const x = ox + rx, z = oz + rz;
    const c = !defs.inWorld(x, z) ? null : cs[((x >> 4) - cx + 1) * 3 + ((z >> 4) - cz + 1)];
    regBiome[rz * RX + rx] = c ? c.biomes[((z & 15) << 4) | (x & 15)] : 0;
    for (let y = 0; y < regH; y++) reg[(y * RX + rz) * RX + rx] = c ? c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] : 0;
  }
  computeLight();
}
function computeLight() {
  const N = RX * RX * regH, SL = RX * RX;
  sky.fill(0, 0, N); blk.fill(0, 0, N);
  let qh = 0, qt = 0;
  // sky: straight down from the top until something blocks or filters
  for (let rz = 0; rz < RX; rz++) for (let rx = 0; rx < RX; rx++) {
    let l = 15;
    for (let y = regH - 1; y >= 0 && l > 0; y--) {
      const i = (y * RX + rz) * RX + rx, id = reg[i];
      if (OPQ[id]) break;
      l -= FLT[id];
      if (l <= 0) break;
      sky[i] = l;
      queue[qt++] = i;
    }
  }
  qt = spread(sky, qh, qt, SL);
  qh = qt = 0;
  for (let i = 0; i < N; i++) { const l = LIT[reg[i]]; if (l) { blk[i] = l; queue[qt++] = i; } }
  spread(blk, 0, qt, SL);
}
function spread(L, qh, qt, SL) {
  const QM = queue.length - 1;
  while (qh !== qt) {
    const i = queue[qh]; qh = (qh + 1) & QM;
    const l = L[i];
    if (l <= 1) continue;
    const rx = i % RX, rz = ((i / RX) | 0) % RX, y = (i / SL) | 0;
    for (let d = 0; d < 6; d++) {
      let j;
      if (d === 0) { if (rx === RX - 1) continue; j = i + 1; } else if (d === 1) { if (rx === 0) continue; j = i - 1; }
      else if (d === 2) { if (rz === RX - 1) continue; j = i + RX; } else if (d === 3) { if (rz === 0) continue; j = i - RX; }
      else if (d === 4) { if (y === regH - 1) continue; j = i + SL; } else { if (y === 0) continue; j = i - SL; }
      const id = reg[j];
      if (OPQ[id]) continue;
      const nl = l - 1 - FLT[id];
      if (nl > L[j]) { L[j] = nl; queue[qt] = j; qt = (qt + 1) & QM; }
    }
  }
  return qt;
}

// ---------- meshing ----------
class Buf {
  constructor() { this.cap = 4096; this.n = 0; this.pos = new Float32Array(this.cap * 3); this.uv = new Float32Array(this.cap * 2); this.tint = new Float32Array(this.cap * 3); this.lit = new Float32Array(this.cap * 4); this.idx = []; }
  grow() {
    this.cap *= 2;
    const g = (a, k) => { const b = new Float32Array(this.cap * k); b.set(a); return b; };
    this.pos = g(this.pos, 3); this.uv = g(this.uv, 2); this.tint = g(this.tint, 3); this.lit = g(this.lit, 4);
  }
  v(x, y, z, u, v, t, s, b, a, f) {
    if (this.n >= this.cap) this.grow();
    const n = this.n++;
    this.pos[n * 3] = x; this.pos[n * 3 + 1] = y; this.pos[n * 3 + 2] = z;
    this.uv[n * 2] = u; this.uv[n * 2 + 1] = v;
    this.tint[n * 3] = t[0]; this.tint[n * 3 + 1] = t[1]; this.tint[n * 3 + 2] = t[2];
    this.lit[n * 4] = s; this.lit[n * 4 + 1] = b; this.lit[n * 4 + 2] = a; this.lit[n * 4 + 3] = f;
    return n;
  }
  out(ox = 0, oz = 0) {
    const n = this.n;
    if (ox || oz) for (let i = 0; i < n; i++) { this.pos[i * 3] -= ox; this.pos[i * 3 + 2] -= oz; }
    return { pos: this.pos.slice(0, n * 3), uv: this.uv.slice(0, n * 2), tint: this.tint.slice(0, n * 3), lit: this.lit.slice(0, n * 4), idx: new Uint32Array(this.idx) };
  }
}
const FACES = [
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.68 },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.68 },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.84 },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.84 },
];
const UVC = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AOK = [0.42, 0.6, 0.8, 1.0];
const WHITE = [1, 1, 1];
const TINTS = { birch: [0.55, 0.72, 0.38], pine: [0.34, 0.5, 0.36] };

function rget(rx, y, rz) { if (y < 0) return 1; if (y >= regH) return 0; return reg[(y * RX + rz) * RX + rx]; }
function lget(L, rx, y, rz) { if (y >= regH) return 15; if (y < 0) return 0; return L[(y * RX + rz) * RX + rx]; }
function biomeTint(kind, rx, rz) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const x = Math.min(RX - 1, Math.max(0, rx + dx)), z = Math.min(RX - 1, Math.max(0, rz + dz));
    const c = BIOMES[regBiome[z * RX + x]][kind]; r += c[0]; g += c[1]; b += c[2]; n++;
  }
  return [r / n, g / n, b / n];
}

function meshChunk(cx, cz) {
  buildRegion(cx, cz);
  const solid = new Buf(), trans = new Buf();
  const emit = [];
  const heights = new Uint8Array(256);
  const ox = cx * 16, oz = cz * 16;
  for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const rx = lx + P, rz = lz + P;
    let top = 0;
    for (let y = regH - 1; y >= 0; y--) if (SOL[rget(rx, y, rz)] || RND[rget(rx, y, rz)] === 6) { top = y; break; }
    heights[lz * 16 + lx] = top;
    let tintG = null, tintF = null, tintW = null;
    for (let y = 0; y < regH; y++) {
      const id = rget(rx, y, rz);
      if (!id) continue;
      const r = RND[id];
      if (!r) continue;
      const b = BLOCKS[id];
      const wx = ox + lx, wz = oz + lz;
      if (r === 4) { // cross plant
        const t = b.tint === 'grass' ? (tintG = tintG || biomeTint('grass', rx, rz)) : WHITE;
        cross(solid, wx, y, wz, faceRect[id][4], t, lget(sky, rx, y, rz) / 15, lget(blk, rx, y, rz) / 15, b.sway ? 2 : 0, LIT[id] ? 5 : 0);
        continue;
      }
      if (r === 5) { torch(solid, wx, y, wz, faceRect[id][4], lget(sky, rx, y, rz) / 15); emit.push(wx + 0.5, y + 0.7, wz + 0.5, 1); continue; }
      if (b.door) { // a thin panel across the doorway: lower half, or upper half when a door is below
        const sl = Math.max(lget(sky, rx, y, rz), lget(sky, rx, y + 1, rz)) / 15, bl = Math.max(lget(blk, rx, y, rz), lget(blk, rx, y + 1, rz)) / 15;
        const up = BLOCKS[rget(rx, y - 1, rz)].door, rect = faceRect[id][up ? 2 : 4];
        const wallX = (n => n && n.solid && n.opaque)(BLOCKS[rget(rx + 1, y, rz)]) || (n => n && n.solid && n.opaque)(BLOCKS[rget(rx - 1, y, rz)]);
        const wallZ = (n => n && n.solid && n.opaque)(BLOCKS[rget(rx, y, rz + 1)]) || (n => n && n.solid && n.opaque)(BLOCKS[rget(rx, y, rz - 1)]);
        const t0 = 6.5 / 16, t1 = 9.5 / 16;
        const box = wallX || !wallZ ? [0, 0, t0, 1, 1, t1] : [t0, 0, 0, t1, 1, 1];
        boxMesh(solid, wx, y, wz, box, [rect, rect, rect, rect, rect, rect], sl, bl);
        continue;
      }
      if (b.stairs || b.climb) { // shaped blocks
        const sl = Math.max(lget(sky, rx, y, rz), lget(sky, rx, y + 1, rz)) / 15, bl = Math.max(lget(blk, rx, y, rz), lget(blk, rx, y + 1, rz)) / 15;
        if (b.stairs) for (const bx of defs.stairBoxes(defs.stairFacing(rget, rx, y, rz))) boxMesh(solid, wx, y, wz, bx, faceRect[id], sl, bl);
        else ladderMesh(solid, wx, y, wz, defs.wallSide(rget, rx, y, rz), faceRect[id][4], sl, bl);
        continue;
      }
      const h = HGT[id];
      const liquid = r === 6;
      const water = liquid && b.liquid === 'water';
      const buf = water || r === 7 ? trans : solid;
      let tint = WHITE;
      if (b.tint === 'grass') tint = null; // per face below
      else if (b.tint === 'foliage') tint = tintF = tintF || biomeTint('foliage', rx, rz);
      else if (b.tint === 'water') tint = tintW = tintW || biomeTint('water', rx, rz);
      else if (TINTS[b.tint]) tint = TINTS[b.tint];
      const above = rget(rx, y + 1, rz);
      const wTop = liquid && RND[above] !== 6 ? 0.875 : 1;
      const flag = water ? 3 : b.liquid === 'lava' ? 4 : r === 3 ? 1 : LIT[id] >= 13 ? 5 : 0;
      if (b.liquid === 'lava' && RND[above] !== 6 && ((wx * 7 + wz * 13 + y) % 9 === 0)) emit.push(wx + 0.5, y + 1, wz + 0.5, 2);
      if (LIT[id] >= 13 && b.render === 'cube' && ((wx * 5 + wz * 3 + y) % 3 === 0)) emit.push(wx + 0.5, y + 0.5, wz + 0.5, 3);
      for (let f = 0; f < 6; f++) {
        const F = FACES[f], nx = rx + F.d[0], ny = y + F.d[1], nz = rz + F.d[2];
        const n = rget(nx, ny, nz);
        // visibility
        if (OPQ[n] && !(f === 2 && h < 1)) continue;
        if (liquid) { if (RND[n] === 6 || (f !== 2 && SOL[n] && OPQ[n])) continue; if (f === 3 && SOL[n]) continue; }
        else if (r === 7 && n === id) continue;
        else if (b.cullSame && n === id) continue;
        else if (r === 3 && n === id && (f === 3 || f === 1 || f === 5)) { /* fancy leaves: draw both sides except bottom/west/north duplicates */ }
        if (f === 3 && h < 1 && false) continue;
        const t = tint || (f === 2 ? (tintG = tintG || biomeTint('grass', rx, rz)) : WHITE);
        const rect = faceRect[id][f];
        quad(buf, F, wx, y, wz, rx, y, rz, rect, t, f === 2 ? (liquid ? wTop : h) : h, flag, liquid && f !== 2 ? wTop : 1, liquid);
        if (id === B.grass && f !== 2 && f !== 3) quad(buf, F, wx, y, wz, rx, y, rz, faceRect.overlay, tintG = tintG || biomeTint('grass', rx, rz), h, 0, 1, false, 0.003);
      }
    }
  }
  return { solid: solid.out(cx * 16, cz * 16), trans: trans.out(cx * 16, cz * 16), emit: new Float32Array(emit), heights, blocks: chunk(cx, cz).blocks.slice() };
}

function quad(buf, F, wx, wy, wz, rx, ry, rz, rect, tint, h, flag, sideTop, liquid, push = 0) {
  const nx = rx + F.d[0], ny = ry + F.d[1], nz = rz + F.d[2];
  const axis = F.d[0] ? 0 : F.d[1] ? 1 : 2;
  const t1 = axis === 0 ? 1 : 0, t2 = axis === 2 ? 1 : 2;
  const ao = [0, 0, 0, 0], ss = [0, 0, 0, 0], bs = [0, 0, 0, 0];
  const base = buf.n;
  for (let k = 0; k < 4; k++) {
    const c = F.c[k];
    const o1 = [0, 0, 0], o2 = [0, 0, 0];
    o1[t1] = c[t1] * 2 - 1; o2[t2] = c[t2] * 2 - 1;
    const s1x = nx + o1[0], s1y = ny + o1[1], s1z = nz + o1[2], s2x = nx + o2[0], s2y = ny + o2[1], s2z = nz + o2[2];
    const cxx = nx + o1[0] + o2[0], cyy = ny + o1[1] + o2[1], czz = nz + o1[2] + o2[2];
    const inR = (x, z) => x >= 0 && z >= 0 && x < RX && z < RX;
    const a1 = inR(s1x, s1z) ? OPQ[rget(s1x, s1y, s1z)] : 0, a2 = inR(s2x, s2z) ? OPQ[rget(s2x, s2y, s2z)] : 0;
    const a3 = inR(cxx, czz) ? OPQ[rget(cxx, cyy, czz)] : 0;
    let v = a1 && a2 ? 0 : 3 - a1 - a2 - a3;
    if (liquid) v = 3;
    ao[k] = v;
    // smooth light: average the open cells around this corner
    let s = 0, bl = 0, cnt = 0;
    const add = (x, y, z) => { if (!inR(x, z)) return; const i = (Math.min(regH - 1, Math.max(0, y)) * RX + z) * RX + x; if (y >= regH) { s += 15; cnt++; return; } if (OPQ[reg[i]] && !(x === nx && y === ny && z === nz)) return; s += sky[i]; bl += blk[i]; cnt++; };
    add(nx, ny, nz);
    if (!a1) add(s1x, s1y, s1z);
    if (!a2) add(s2x, s2y, s2z);
    if (!a3 && !(a1 && a2)) add(cxx, cyy, czz);
    if (OPQ[rget(nx, ny, nz)]) { s = Math.max(s, lget(sky, rx, ry, rz) * cnt); bl = Math.max(bl, lget(blk, rx, ry, rz) * cnt); }
    ss[k] = cnt ? s / cnt / 15 : 0; bs[k] = cnt ? bl / cnt / 15 : 0;
    let px = c[0], py = c[1], pz = c[2];
    if (axis !== 1 && py === 1) py = sideTop < 1 ? sideTop : h;
    if (axis === 1 && F.d[1] > 0) py = h;
    px += F.d[0] * push; py += F.d[1] * push; pz += F.d[2] * push;
    const u = rect[0] + (rect[2] - rect[0]) * UVC[k][0];
    let vv = UVC[k][1];
    if (axis !== 1 && vv === 1) vv = py;
    const v2 = rect[1] + (rect[3] - rect[1]) * vv;
    buf.v(wx + px, wy + py, wz + pz, u, v2, tint, ss[k], bs[k], AOK[ao[k]] * F.shade, flag);
  }
  if (ao[0] + ao[2] < ao[1] + ao[3]) buf.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
  else buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
// an axis-aligned box inside a block cell (unit coords), textured with the matching part of each face tile
function boxMesh(buf, wx, wy, wz, bx, rects, s, bl) {
  const [x0, y0, z0, x1, y1, z1] = bx;
  for (let f = 0; f < 6; f++) {
    const Fc = FACES[f], rect = rects[f], base = buf.n;
    for (let k = 0; k < 4; k++) {
      const c = Fc.c[k], px = c[0] ? x1 : x0, py = c[1] ? y1 : y0, pz = c[2] ? z1 : z0;
      const U = Fc.d[0] ? pz : px, V = Fc.d[1] ? pz : py;
      buf.v(wx + px, wy + py, wz + pz, rect[0] + (rect[2] - rect[0]) * U, rect[1] + (rect[3] - rect[1]) * V, WHITE, s, bl, Fc.shade, 0);
    }
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
// a ladder: one flat panel just off the wall it hangs on (side 0 N, 1 E, 2 S, 3 W), visible from both sides
function ladderMesh(buf, x, y, z, side, rect, s, bl) {
  const e = 0.06, base = buf.n;
  const pts = side === 0 ? [[0, e], [1, e]] : side === 2 ? [[1, 1 - e], [0, 1 - e]] : side === 1 ? [[1 - e, 0], [1 - e, 1]] : [[e, 1], [e, 0]];
  const [[ax, az], [bx2, bz2]] = pts;
  buf.v(x + ax, y, z + az, rect[0], rect[1], WHITE, s, bl, 0.9, 0);
  buf.v(x + bx2, y, z + bz2, rect[2], rect[1], WHITE, s, bl, 0.9, 0);
  buf.v(x + bx2, y + 1, z + bz2, rect[2], rect[3], WHITE, s, bl, 1, 0);
  buf.v(x + ax, y + 1, z + az, rect[0], rect[3], WHITE, s, bl, 1, 0);
  buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
}
function cross(buf, x, y, z, rect, tint, s, b, sway, flag) {
  const lo = 0.15, hi = 0.85, f = flag || 0;
  for (const [ax, az, bx, bz] of [[lo, lo, hi, hi], [lo, hi, hi, lo]]) {
    const base = buf.n;
    buf.v(x + ax, y, z + az, rect[0], rect[1], tint, s, b, 0.9, f);
    buf.v(x + bx, y, z + bz, rect[2], rect[1], tint, s, b, 0.9, f);
    buf.v(x + bx, y + 0.95, z + bz, rect[2], rect[3], tint, s, b, 1, sway || f);
    buf.v(x + ax, y + 0.95, z + az, rect[0], rect[3], tint, s, b, 1, sway || f);
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
  }
}
function torch(buf, x, y, z, rect, s) {
  const w = 1 / 16, x0 = x + 0.5 - w, x1 = x + 0.5 + w, z0 = z + 0.5 - w, z1 = z + 0.5 + w, y1 = y + 0.625;
  const du = rect[2] - rect[0], dv = rect[3] - rect[1];
  const u0 = rect[0] + du * 7 / 16, u1 = rect[0] + du * 9 / 16, v0 = rect[1], v1 = rect[1] + dv * 10 / 16, vt = rect[1] + dv * 8 / 16;
  const sides = [[x1, z1, x1, z0], [x0, z0, x0, z1], [x0, z1, x1, z1], [x1, z0, x0, z0]];
  for (const [ax, az, bx, bz] of sides) {
    const base = buf.n;
    buf.v(ax, y, az, u0, v0, WHITE, s, 1, 0.9, 5); buf.v(bx, y, bz, u1, v0, WHITE, s, 1, 0.9, 5);
    buf.v(bx, y1, bz, u1, v1, WHITE, s, 1, 1, 5); buf.v(ax, y1, az, u0, v1, WHITE, s, 1, 1, 5);
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const base = buf.n;
  buf.v(x0, y1, z1, u0, vt, WHITE, s, 1, 1, 5); buf.v(x1, y1, z1, u1, vt, WHITE, s, 1, 1, 5); buf.v(x1, y1, z0, u1, v1, WHITE, s, 1, 1, 5); buf.v(x0, y1, z0, u0, v1, WHITE, s, 1, 1, 5);
  buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// ---------- scheduling ----------
function pump() {
  if (busy) return;
  busy = true;
  setTimeout(() => {
    busy = false;
    let k = null;
    flip = !flip;
    if (flip || !dirty.size) while (want.length) { const w = want.shift(); if (!meshed.has(w)) { k = w; break; } }
    if (k == null) for (const d of dirty) { k = d; dirty.delete(d); break; }
    if (k == null) return;
    const cx = defs.ckx(k), cz = defs.ckz(k);
    const t0 = performance.now();
    const m = meshChunk(cx, cz);
    meshed.add(k);
    const tr = [m.solid.pos.buffer, m.solid.uv.buffer, m.solid.tint.buffer, m.solid.lit.buffer, m.solid.idx.buffer, m.trans.pos.buffer, m.trans.uv.buffer, m.trans.tint.buffer, m.trans.lit.buffer, m.trans.idx.buffer, m.emit.buffer, m.heights.buffer, m.blocks.buffer];
    postMessage({ type: 'mesh', cx, cz, k, solid: m.solid, trans: m.trans, emit: m.emit, heights: m.heights, blocks: m.blocks, ms: performance.now() - t0, left: want.length + dirty.size }, tr);
    pump();
  }, 0);
}

onmessage = e => {
  const m = e.data;
  if (m.type === 'init') {
    gen = new worldgen.Generator(m.seed);
    tileRect = m.rects;
    faceRect = BLOCKS.map(b => [0, 1, 2, 3, 4, 5].map(f => tileRect[defs.faceTile(b, f)] || [0, 0, 0.01, 0.01]));
    faceRect.overlay = tileRect.grass_side_overlay;
    chunks.clear(); changes.length = 0; undo.length = 0; applied = 0; byChunk.clear(); meshed.clear(); dirty.clear(); want = [];
  } else if (m.type === 'changes') {
    for (const c of m.list) {
      const i = changes.length;
      changes.push(c);
      const k = key(c[1] >> 4, c[3] >> 4);
      let l = byChunk.get(k);
      if (!l) byChunk.set(k, l = []);
      l.push(i);
    }
  } else if (m.type === 'time') {
    seek(m.t);
    pump();
  } else if (m.type === 'want') {
    want = m.list;
    for (const k of m.drop || []) { meshed.delete(k); chunks.delete(k); }
    pump();
  }
};
