// Procedural 16x16 pixel-art textures for every block face, packed into one atlas, plus item icons.
const T = 16, GUT = 4, CELL = T + GUT * 2;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
const clamp = v => v < 0 ? 0 : v > 255 ? 255 : v | 0;

class Tex {
  constructor(name) { this.d = new Uint8ClampedArray(T * T * 4); this.r = rng(hashStr(name)); }
  set(x, y, c, a = 255) { x = ((x % T) + T) % T; y = ((y % T) + T) % T; const i = (y * T + x) * 4; this.d[i] = clamp(c[0]); this.d[i + 1] = clamp(c[1]); this.d[i + 2] = clamp(c[2]); this.d[i + 3] = a; }
  get(x, y) { x = ((x % T) + T) % T; y = ((y % T) + T) % T; const i = (y * T + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  shade(x, y, k) { const c = this.get(x, y); this.set(x, y, [c[0] * k, c[1] * k, c[2] * k], c[3]); }
  fill(c, v = 0, a = 255) { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const n = (this.r() - 0.5) * v; this.set(x, y, [c[0] + n, c[1] + n, c[2] + n], a); } return this; }
  // clumpy noise: values shared in 2x2 blocks plus fine noise
  noise(c, v, fine = 0.4) {
    const g = []; for (let i = 0; i < 64; i++) g.push((this.r() - 0.5) * v);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const n = g[(y >> 1) * 8 + (x >> 1)] * (1 - fine) + (this.r() - 0.5) * v * fine; this.set(x, y, [c[0] + n, c[1] + n, c[2] + n]); }
    return this;
  }
  dots(c, n, size = 1, a = 255) { for (let i = 0; i < n; i++) { const x = (this.r() * T) | 0, y = (this.r() * T) | 0; for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) this.set(x + dx, y + dy, c, a); } return this; }
  blobs(c, n, r0 = 1, r1 = 2, hi) {
    for (let i = 0; i < n; i++) {
      const cx = 2 + this.r() * 12, cy = 2 + this.r() * 12, r = r0 + this.r() * (r1 - r0);
      for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r) { const k = 0.85 + this.r() * 0.3; this.set(x, y, [c[0] * k, c[1] * k, c[2] * k]); if (hi && d < r * 0.5 && this.r() < 0.5) this.set(x, y, hi); }
      }
    }
    return this;
  }
  // voronoi stones with dark mortar
  stones(base, n, mortar, v = 30) {
    const pts = []; for (let i = 0; i < n; i++) pts.push([this.r() * T, this.r() * T, (this.r() - 0.5) * v]);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      let d1 = 99, d2 = 99, k = 0;
      for (let i = 0; i < pts.length; i++) for (let oy = -T; oy <= T; oy += T) for (let ox = -T; ox <= T; ox += T) {
        const d = Math.hypot(x + 0.5 - pts[i][0] - ox, y + 0.5 - pts[i][1] - oy);
        if (d < d1) { d2 = d1; d1 = d; k = i; } else if (d < d2) d2 = d;
      }
      const edge = d2 - d1 < 1.1, n2 = pts[k][2] + (this.r() - 0.5) * 12 - (d1 > 3 ? 8 : 0);
      this.set(x, y, edge ? mortar : [base[0] + n2, base[1] + n2, base[2] + n2]);
    }
    return this;
  }
  bricks(c, mortar, h = 4, w = 8, v = 20) {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const row = (y / h) | 0, off = row % 2 ? w / 2 : 0, bx = ((x + off) / w) | 0;
      const m = y % h === h - 1 || (x + off) % w === w - 1;
      const n = ((hashStr(row + ':' + bx) % 100) / 100 - 0.5) * v + (this.r() - 0.5) * 10;
      this.set(x, y, m ? mortar : [c[0] + n, c[1] + n, c[2] + n]);
    }
    return this;
  }
  planks(c) {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const board = (y / 4) | 0, seam = y % 4 === 3, cut = (x + board * 5) % 16 === 0;
      const grain = Math.sin((x + board * 7) * 0.9 + Math.sin(y * 2.1 + board) * 1.4) * 8 + (this.r() - 0.5) * 8;
      const k = seam || cut ? -38 : grain + (board % 2 ? 5 : -3);
      this.set(x, y, [c[0] + k, c[1] + k * 0.85, c[2] + k * 0.7]);
    }
    return this;
  }
  bark(c, dark, stripes = true) {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const s = Math.sin(x * 1.7 + Math.sin(y * 0.6 + x) * 0.8) * 14 + (this.r() - 0.5) * 14;
      this.set(x, y, stripes && (x * 7 + ((y / 5) | 0) * 3) % 5 === 0 ? dark : [c[0] + s, c[1] + s * 0.9, c[2] + s * 0.8]);
    }
    return this;
  }
  rings(bark, inner) {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.5) this.set(x, y, bark);
      else { const ring = Math.round(Math.hypot(x - 7.5, y - 7.5)) % 2 ? -14 : 6; this.set(x, y, [inner[0] + ring + (this.r() - 0.5) * 8, inner[1] + ring * 0.9, inner[2] + ring * 0.7]); }
    }
    return this;
  }
  leaves(c, holes = 0.22) {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const n = this.r(), k = (this.r() - 0.5) * 70 + ((x + y) % 3 === 0 ? -22 : 0);
      if (n < holes) this.set(x, y, c, 0); else this.set(x, y, [c[0] + k, c[1] + k, c[2] + k]);
    }
    return this;
  }
  clear() { this.d.fill(0); return this; }
  rect(x0, y0, w, h, c, a = 255) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a); return this; }
  border(c, w = 1) { for (let i = 0; i < T; i++) for (let k = 0; k < w; k++) { this.set(i, k, c); this.set(i, T - 1 - k, c); this.set(k, i, c); this.set(T - 1 - k, i, c); } return this; }
  bevel(hi, lo) { for (let i = 0; i < T; i++) { this.set(i, 0, hi); this.set(0, i, hi); this.set(i, T - 1, lo); this.set(T - 1, i, lo); } return this; }
}

const STONE = [128, 128, 130], DIRT = [134, 96, 66], SAND = [221, 208, 160];
function stoneBase(t) { t.noise(STONE, 34, 0.5).dots([100, 100, 104], 10).dots([150, 150, 152], 6); return t; }
function ore(t, color, hi, n = 5) { stoneBase(t); t.blobs(color, n, 0.8, 1.7, hi); return t; }
function plantStem(t, c, x0, h) { for (let y = T - 1; y > T - 1 - h; y--) t.set(x0 + (y % 5 === 0 ? 1 : 0), y, c); }

const DRAW = {
  bedrock: t => t.noise([70, 70, 72], 70, 0.7).dots([30, 30, 32], 20, 2).dots([120, 120, 120], 8),
  stone: t => stoneBase(t),
  darkstone: t => { t.noise([72, 74, 84], 22, 0.5); for (let y = 0; y < T; y += 4) for (let x = 0; x < T; x++) if (t.r() < 0.6) t.shade(x, y, 0.8); },
  granite: t => t.noise([164, 116, 96], 30, 0.7).dots([196, 150, 130], 14).dots([120, 80, 70], 10),
  cobblestone: t => t.stones([124, 124, 126], 9, [70, 70, 72], 40),
  mossy_cobblestone: t => { t.stones([118, 122, 116], 9, [66, 70, 64], 40); t.blobs([82, 120, 50], 5, 1, 2.6); },
  dirt: t => t.noise(DIRT, 34, 0.6).dots([104, 72, 48], 14).dots([160, 122, 90], 6),
  grass_top: t => t.noise([190, 190, 190], 48, 0.6).dots([150, 150, 150], 20).dots([225, 225, 225], 10),
  grass_side: t => DRAW.dirt(t),
  grass_side_overlay: t => { t.clear(); for (let x = 0; x < T; x++) { const h = 3 + ((t.r() * 3) | 0) + (x % 4 === 1 ? 1 : 0); for (let y = 0; y < h; y++) { const k = (t.r() - 0.5) * 40; t.set(x, y, [190 + k, 190 + k, 190 + k]); } } },
  snow: t => t.noise([242, 246, 252], 12, 0.5).dots([220, 230, 245], 10),
  snowy_grass_side: t => { DRAW.dirt(t); for (let x = 0; x < T; x++) { const h = 3 + ((t.r() * 3) | 0); for (let y = 0; y < h; y++) t.set(x, y, [240 - t.r() * 14, 244 - t.r() * 10, 252]); } },
  sand: t => t.noise(SAND, 18, 0.7).dots([196, 182, 136], 14).dots([236, 226, 186], 8),
  gravel: t => t.stones([134, 128, 124], 14, [92, 88, 86], 60),
  clay: t => t.noise([160, 166, 180], 14, 0.5).dots([140, 146, 160], 8),
  sandstone: t => { t.noise([216, 200, 150], 12, 0.6); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (y % 5 === 4 || y < 2) t.shade(x, y, 0.9); },
  sandstone_top: t => t.noise([222, 208, 160], 10, 0.5),
  ice: t => { t.noise([150, 196, 252], 20, 0.6); for (let i = 0; i < 4; i++) { const x0 = (t.r() * T) | 0, y0 = (t.r() * T) | 0; for (let k = 0; k < 6; k++) t.set(x0 + k, y0 + k, [230, 245, 255]); } for (let i = 0; i < T * T; i++) t.d[i * 4 + 3] = 190; },
  water: t => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const w = Math.sin(x * 0.8 + y * 0.4) * 10 + Math.sin(y * 1.3 - x * 0.3) * 8 + (t.r() - 0.5) * 10; t.set(x, y, [200 + w, 210 + w, 225 + w], 200); } },
  lava: t => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const w = Math.sin(x * 0.9 + Math.sin(y * 0.7) * 2) + Math.cos(y * 0.8 + x * 0.3); t.set(x, y, w > 0.9 ? [255, 236, 120] : w > -0.4 ? [244, 120 + w * 40, 24] : [170, 46, 10]); } },
  oak_log: t => t.bark([104, 80, 50], [70, 52, 32]),
  oak_log_top: t => t.rings([92, 70, 44], [176, 140, 88]),
  birch_log: t => { t.noise([222, 220, 210], 16, 0.6); for (let i = 0; i < 9; i++) { const x = (t.r() * 13) | 0, y = (t.r() * T) | 0, w = 2 + ((t.r() * 3) | 0); t.rect(x, y, w, 1, [44, 42, 40]); } },
  birch_log_top: t => t.rings([220, 218, 206], [200, 176, 120]),
  pine_log: t => t.bark([74, 52, 36], [48, 32, 22]),
  pine_log_top: t => t.rings([66, 46, 30], [150, 112, 70]),
  oak_leaves: t => t.leaves([176, 176, 176]),
  birch_leaves: t => t.leaves([180, 180, 172], 0.25),
  pine_leaves: t => { t.leaves([150, 158, 150], 0.18); for (let x = 0; x < T; x += 3) for (let y = x % 2; y < T; y += 4) t.set(x, y, [120, 130, 120]); },
  oak_planks: t => t.planks([170, 132, 82]),
  birch_planks: t => t.planks([212, 192, 140]),
  pine_planks: t => t.planks([116, 84, 54]),
  coal_ore: t => ore(t, [36, 36, 38], [70, 70, 74], 6),
  copper_ore: t => ore(t, [208, 112, 62], [96, 196, 160], 5),
  iron_ore: t => ore(t, [220, 172, 136], [246, 214, 190], 5),
  gold_ore: t => ore(t, [250, 210, 50], [255, 250, 170], 5),
  sapphire_ore: t => ore(t, [40, 90, 230], [150, 210, 255], 5),
  glow_crystal: t => { t.noise([60, 58, 70], 18, 0.5); for (let i = 0; i < 7; i++) { const x = 1 + ((t.r() * 13) | 0), y = 1 + ((t.r() * 13) | 0); t.rect(x, y, 2, 3, [120, 250, 230]); t.set(x, y, [240, 255, 250]); t.set(x + 1, y + 2, [60, 200, 190]); } },
  obsidian: t => { t.noise([26, 18, 40], 16, 0.6).dots([70, 50, 110], 8).dots([12, 8, 20], 12, 2); },
  glass: t => { t.clear(); t.border([224, 240, 248], 1); for (let k = 0; k < 4; k++) t.set(3 + k, 3 + k, [250, 255, 255], 200); t.set(10, 3, [250, 255, 255], 160); t.set(11, 4, [250, 255, 255], 160); },
  bricks: t => t.bricks([156, 74, 58], [196, 186, 170], 4, 8, 34),
  stone_bricks: t => { t.bricks([124, 124, 126], [80, 80, 82], 8, 16, 18); t.dots([108, 108, 110], 10); },
  mossy_stone_bricks: t => { DRAW.stone_bricks(t); t.blobs([86, 122, 54], 5, 1, 2.4); },
  workbench_top: t => { t.planks([176, 136, 86]); t.border([110, 80, 46], 1); t.rect(3, 3, 10, 1, [90, 64, 36]); t.rect(3, 12, 10, 1, [90, 64, 36]); t.rect(3, 3, 1, 10, [90, 64, 36]); t.rect(12, 3, 1, 10, [90, 64, 36]); },
  workbench_side: t => { t.planks([158, 120, 74]); t.rect(0, 0, T, 3, [110, 80, 46]); t.rect(3, 6, 2, 7, [140, 140, 146]); t.rect(2, 6, 4, 2, [140, 140, 146]); t.rect(10, 7, 1, 6, [100, 70, 40]); t.rect(9, 5, 4, 3, [120, 120, 126]); },
  workbench_front: t => { t.planks([158, 120, 74]); t.rect(0, 0, T, 3, [110, 80, 46]); t.rect(3, 6, 10, 1, [170, 170, 176]); for (let x = 3; x < 13; x += 2) t.set(x, 7, [170, 170, 176]); t.rect(10, 9, 3, 4, [110, 80, 46]); },
  furnace_side: t => { stoneBase(t); t.bevel([150, 150, 150], [90, 90, 92]); },
  furnace_top: t => { t.noise([120, 120, 122], 16, 0.5); t.bevel([150, 150, 150], [90, 90, 92]); },
  furnace_front: t => { DRAW.furnace_side(t); t.rect(4, 8, 8, 5, [30, 28, 28]); t.rect(4, 5, 8, 1, [80, 80, 82]); t.rect(3, 7, 10, 1, [96, 96, 98]); },
  furnace_front_lit: t => { DRAW.furnace_side(t); t.rect(4, 8, 8, 5, [60, 24, 10]); for (let x = 4; x < 12; x++) { const h = 2 + ((t.r() * 3) | 0); for (let y = 12; y > 12 - h; y--) t.set(x, y, y > 11 ? [255, 210, 80] : [255, 120, 30]); } t.rect(4, 5, 8, 1, [80, 80, 82]); t.rect(3, 7, 10, 1, [96, 96, 98]); },
  chest_side: t => { t.planks([164, 112, 50]); t.border([84, 58, 24], 1); t.rect(0, 6, T, 1, [84, 58, 24]); },
  chest_front: t => { DRAW.chest_side(t); t.rect(7, 5, 2, 4, [200, 200, 210]); t.set(7, 8, [60, 60, 70]); },
  chest_top: t => { t.planks([170, 118, 54]); t.border([84, 58, 24], 1); },
  torch: t => { t.clear(); t.rect(7, 6, 2, 10, [124, 92, 52]); t.set(7, 6, [255, 236, 140]); t.set(8, 6, [255, 200, 80]); t.rect(7, 4, 2, 2, [255, 250, 200]); t.set(8, 7, [255, 150, 50]); },
  tall_grass: t => { t.clear(); for (let i = 0; i < 9; i++) { const x = 1 + ((t.r() * 14) | 0), h = 5 + ((t.r() * 10) | 0); for (let y = T - 1; y > T - 1 - h; y--) t.set(x + (y < T - h / 2 && i % 2 ? 1 : 0), y, [150 + t.r() * 60, 150 + t.r() * 60, 150 + t.r() * 60]); } },
  emberbloom: t => { t.clear(); plantStem(t, [70, 140, 40], 7, 9); t.rect(6, 4, 4, 3, [220, 40, 40]); t.set(7, 5, [250, 200, 60]); t.set(5, 5, [190, 30, 30]); t.set(10, 5, [190, 30, 30]); t.rect(5, 10, 2, 1, [80, 150, 50]); },
  sunpetal: t => { t.clear(); plantStem(t, [80, 150, 50], 7, 9); for (const [x, y] of [[7, 3], [6, 4], [8, 4], [7, 5], [5, 4], [9, 4], [7, 2], [7, 6]]) t.set(x, y, [250, 220, 50]); t.set(7, 4, [190, 110, 30]); t.rect(8, 11, 2, 1, [80, 150, 50]); },
  frostbell: t => { t.clear(); plantStem(t, [70, 140, 90], 7, 10); for (const [x, y] of [[5, 5], [9, 5], [7, 3]]) { t.rect(x - 1, y, 3, 2, [90, 140, 240]); t.set(x, y + 2, [170, 210, 255]); } },
  brown_mushroom: t => { t.clear(); t.rect(7, 10, 2, 6, [220, 210, 190]); t.rect(4, 7, 8, 3, [150, 104, 70]); t.rect(5, 6, 6, 1, [170, 120, 84]); },
  glowcap: t => { t.clear(); t.rect(7, 10, 2, 6, [200, 230, 220]); t.rect(4, 7, 8, 3, [60, 220, 200]); t.rect(5, 6, 6, 1, [150, 255, 240]); t.set(6, 8, [220, 255, 250]); t.set(9, 8, [220, 255, 250]); },
  dead_bush: t => { t.clear(); for (const [x0, dx] of [[7, -1], [8, 1], [7, 0]]) { let x = x0; for (let y = 15; y > 5; y--) { t.set(x, y, [120, 84, 46]); if (y % 3 === 0) x += dx; } } },
  cactus_side: t => { t.noise([70, 140, 50], 16, 0.5); for (let x = 0; x < T; x += 4) for (let y = 0; y < T; y++) t.shade(x, y, 0.8); for (let i = 0; i < 8; i++) t.set((t.r() * T) | 0, (t.r() * T) | 0, [230, 230, 190]); t.border([50, 100, 36], 1); },
  cactus_top: t => { t.noise([90, 160, 66], 14, 0.5); t.border([50, 100, 36], 1); t.rect(6, 6, 4, 4, [120, 180, 90]); },
  reeds: t => { t.clear(); for (const x of [3, 8, 12]) for (let y = 0; y < T; y++) t.set(x, y, y % 5 === 0 ? [120, 170, 80] : [150, 200, 100]); for (const x of [4, 9]) t.rect(x, 4, 2, 1, [110, 170, 70]); },
  pumpkin_side: t => { t.noise([226, 128, 30], 14, 0.5); for (let x = 0; x < T; x += 4) for (let y = 0; y < T; y++) t.shade(x, y, 0.82); },
  pumpkin_top: t => { t.noise([216, 120, 28], 12, 0.5); t.rect(6, 6, 4, 4, [110, 90, 40]); t.rect(7, 7, 2, 2, [80, 120, 40]); },
  wool: t => t.noise([234, 234, 230], 18, 0.8).dots([214, 214, 210], 14),
  red_carpet: t => { t.noise([178,52,48], 12, 0.7); t.border([138,12,8], 1); },
  blue_carpet: t => { t.noise([52,84,170], 12, 0.7); t.border([12,44,130], 1); },
  green_carpet: t => { t.noise([70,130,60], 12, 0.7); t.border([30,90,20], 1); },
  cream_carpet: t => { t.noise([230,220,196], 12, 0.7); t.border([190,180,156], 1); },
  brown_carpet: t => { t.noise([120,84,52], 12, 0.7); t.border([80,44,12], 1); },
  purple_carpet: t => { t.noise([120,70,150], 12, 0.7); t.border([80,30,110], 1); },
  oak_door: t => { t.noise([150, 112, 66], 12, 0.6); t.border([96, 68, 38], 1); t.rect(7, 0, 2, T, [110, 80, 46]); t.rect(2, 2, 4, 4, [200, 225, 235]); t.rect(10, 2, 4, 4, [200, 225, 235]); t.rect(11, 8, 2, 2, [220, 190, 60]); },
  bed_top: t => { t.noise([60, 90, 170], 12, 0.6); t.rect(0, 0, T, 6, [240, 238, 230]); t.rect(2, 1, 12, 4, [250, 250, 248]); },
  bed_side: t => { t.noise([60, 90, 170], 10, 0.6); t.rect(0, 0, T, 3, [240, 238, 230]); t.rect(0, 10, T, 6, [140, 100, 60]); },
  bedroll_top: t => { t.noise([190, 50, 50], 14, 0.6); t.rect(0, 0, T, 5, [236, 236, 230]); for (let x = 0; x < T; x += 4) t.rect(x, 5, 2, 11, [170, 40, 40]); },
  bedroll_side: t => { t.noise([180, 46, 46], 10, 0.6); t.rect(0, 12, T, 4, [120, 90, 60]); },
  farmland: t => { t.noise([96, 64, 40], 20, 0.6); for (let y = 0; y < T; y += 4) for (let x = 0; x < T; x++) t.set(x, y, [70, 46, 28]); },
  wheat_0: t => { t.clear(); for (const x of [2, 6, 10, 13]) for (let y = 12; y < T; y++) t.set(x, y, [90, 170, 60]); },
  wheat_1: t => { t.clear(); for (const x of [2, 6, 10, 13]) for (let y = 8; y < T; y++) t.set(x + (y < 10 ? 1 : 0), y, [100, 170, 60]); },
  wheat_2: t => { t.clear(); for (const x of [1, 5, 9, 13]) for (let y = 4; y < T; y++) t.set(x + (y < 7 ? 1 : 0), y, y < 7 ? [170, 180, 70] : [110, 160, 60]); },
  wheat_3: t => { t.clear(); for (const x of [1, 5, 9, 13]) { for (let y = 5; y < T; y++) t.set(x, y, [180, 150, 70]); for (let y = 1; y < 6; y++) { t.set(x, y, [230, 196, 90]); t.set(x + 1, y, [210, 170, 70]); } } },
  oak_sapling: t => { t.clear(); t.rect(7, 9, 2, 7, [104, 80, 50]); t.blobs([70, 150, 40], 3, 2, 3); for (let i = 0; i < T * T; i++) if (t.d[i * 4 + 3] && (i >> 4) > 11 && (i & 15) !== 7 && (i & 15) !== 8) t.d[i * 4 + 3] = 0; },
  birch_sapling: t => { t.clear(); t.rect(7, 9, 2, 7, [220, 218, 208]); t.blobs([120, 170, 70], 3, 2, 3); for (let i = 0; i < T * T; i++) if (t.d[i * 4 + 3] && (i >> 4) > 11 && (i & 15) !== 7 && (i & 15) !== 8) t.d[i * 4 + 3] = 0; },
  pine_sapling: t => { t.clear(); t.rect(7, 11, 2, 5, [74, 52, 36]); for (let y = 2; y < 12; y++) { const w = Math.min(6, (y - 1) >> 1); t.rect(8 - w, y, w * 2, 1, [50, 100, 60]); } },
  hay_top: t => { t.noise([214, 184, 70], 26, 0.8); t.border([150, 110, 40], 1); },
  hay_side: t => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) t.set(x, y, [210 + (t.r() - 0.5) * 40, 180 + (t.r() - 0.5) * 40, 66]); t.rect(0, 3, T, 2, [140, 90, 40]); t.rect(0, 11, T, 2, [140, 90, 40]); },
  bookshelf: t => { t.planks([164, 128, 78]); for (const y0 of [1, 9]) { let x = 1; while (x < 15) { const w = 1 + ((t.r() * 2) | 0), c = [[160, 40, 40], [40, 90, 160], [50, 130, 60], [200, 170, 60], [120, 60, 140]][(t.r() * 5) | 0]; t.rect(x, y0, w, 6, c); t.rect(x, y0, w, 1, [c[0] * 1.2, c[1] * 1.2, c[2] * 1.2]); x += w; } } },
  glow_lamp: t => { t.noise([255, 214, 120], 30, 0.6); t.border([140, 100, 50], 2); t.rect(6, 6, 4, 4, [255, 250, 220]); },
  blast_barrel_side: t => { t.noise([180, 40, 34], 16, 0.5); t.rect(0, 2, T, 2, [60, 60, 64]); t.rect(0, 12, T, 2, [60, 60, 64]); for (let x = 0; x < T; x++) t.set(x, 7, x % 4 < 2 ? [250, 220, 60] : [30, 30, 30]); t.set(x0(), 8, [250, 220, 60]); },
  blast_barrel_top: t => { t.noise([160, 36, 30], 12, 0.5); t.border([60, 60, 64], 1); t.rect(7, 6, 2, 4, [120, 110, 90]); t.set(7, 5, [250, 200, 80]); },
  coal_block: t => { t.noise([34, 34, 36], 14, 0.6); t.bevel([60, 60, 62], [20, 20, 22]); },
  copper_block: t => { t.noise([200, 112, 70], 14, 0.6); t.bevel([240, 160, 110], [150, 80, 50]); t.dots([90, 180, 150], 6); },
  iron_block: t => { t.noise([214, 214, 218], 10, 0.6); t.bevel([245, 245, 250], [160, 160, 166]); t.rect(2, 7, 12, 1, [190, 190, 196]); },
  gold_block: t => { t.noise([248, 206, 60], 12, 0.6); t.bevel([255, 248, 160], [200, 150, 30]); },
  sapphire_block: t => { t.noise([60, 110, 230], 14, 0.6); t.bevel([160, 210, 255], [30, 60, 160]); t.dots([200, 230, 255], 5); },
  goo_block: t => { t.noise([110, 200, 90], 14, 0.6); t.border([80, 170, 70], 1); t.rect(4, 4, 8, 8, [140, 220, 120]); for (let i = 0; i < T * T; i++) t.d[i * 4 + 3] = 190; },
  // building blocks
  lantern: t => { t.noise([60, 58, 62], 10, 0.5); t.border([40, 38, 42], 1); t.rect(3, 3, 10, 10, [255, 214, 120]); t.rect(5, 5, 6, 6, [255, 248, 210]); for (let x = 3; x < 13; x += 3) t.rect(x, 3, 1, 10, [70, 66, 70]); },
  polished_granite: t => { t.noise([176, 122, 100], 12, 0.4); t.bevel([200, 148, 126], [130, 86, 70]); },
  terracotta: t => t.noise([168, 96, 70], 10, 0.6).dots([150, 84, 60], 8),
  glass_tile: t => { t.clear(); t.border([210, 230, 240], 1); t.rect(7, 0, 2, T, [210, 230, 240]); t.rect(0, 7, T, 2, [210, 230, 240]); t.set(3, 3, [250, 255, 255], 180); t.set(11, 11, [250, 255, 255], 180); },
  thatch: t => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) t.set(x, y, [200 + (t.r() - 0.5) * 50, 168 + (t.r() - 0.5) * 40, 70]); for (let y = 3; y < T; y += 4) for (let x = 0; x < T; x++) t.shade(x, y, 0.75); },
  marble: t => { t.noise([232, 230, 226], 10, 0.6); for (let i = 0; i < 3; i++) { let x = (t.r() * T) | 0; for (let y = 0; y < T; y++) { t.set(x, y, [180, 182, 190]); if (t.r() < 0.4) x += t.r() < 0.5 ? 1 : -1; } } },
  marble_bricks: t => t.bricks([230, 228, 224], [178, 176, 172], 8, 16, 10),
  // the Emberdeep
  cinderstone: t => t.noise([112, 46, 42], 30, 0.6).dots([80, 28, 28], 16).dots([150, 70, 56], 8),
  ashsand: t => t.noise([92, 80, 74], 20, 0.7).dots([60, 52, 50], 14).dots([130, 118, 110], 6),
  magma_rock: t => { t.noise([90, 30, 20], 20, 0.5); for (let i = 0; i < 10; i++) { const x = (t.r() * 14) | 0, y = (t.r() * 14) | 0; t.rect(x, y, 2, 1, [255, 150, 40]); t.set(x, y + 1, [255, 90, 20]); } },
  emberite_ore: t => { DRAW.cinderstone(t); t.blobs([255, 120, 30], 5, 0.8, 1.6, [255, 230, 120]); },
  cinder_bricks: t => t.bricks([96, 34, 34], [48, 18, 20], 4, 8, 20),
  emberite_block: t => { t.noise([220, 96, 30], 14, 0.6); t.bevel([255, 190, 90], [150, 50, 20]); },
  ember_portal: t => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const w = Math.sin(x * 0.7 + y * 0.5) + Math.cos(y * 0.9 - x * 0.4); t.set(x, y, w > 0.6 ? [255, 210, 90] : w > -0.5 ? [240, 90, 30] : [150, 30, 70], 200); } },
  // the Skyreach
  skystone: t => t.noise([206, 214, 226], 16, 0.6).dots([180, 190, 206], 12).dots([236, 240, 248], 8),
  cloud_turf_top: t => t.noise([236, 244, 252], 14, 0.7).dots([200, 230, 214], 14).dots([255, 255, 255], 10),
  cloud_turf_side: t => { DRAW.skystone(t); for (let x = 0; x < T; x++) { const h = 3 + ((t.r() * 3) | 0); for (let y = 0; y < h; y++) t.set(x, y, [240 - t.r() * 14, 248 - t.r() * 10, 252]); } },
  skycrystal_ore: t => { DRAW.skystone(t); t.blobs([120, 220, 255], 5, 0.8, 1.6, [230, 255, 255]); },
  skystone_bricks: t => t.bricks([196, 206, 222], [140, 150, 170], 8, 16, 12),
  skysteel_block: t => { t.noise([170, 210, 236], 12, 0.6); t.bevel([230, 250, 255], [100, 140, 180]); t.rect(2, 7, 12, 1, [140, 190, 220]); },
  sky_portal: t => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const w = Math.sin(x * 0.6 - y * 0.6) + Math.cos(y * 0.8 + x * 0.5); t.set(x, y, w > 0.6 ? [250, 255, 255] : w > -0.5 ? [120, 200, 255] : [90, 110, 230], 190); } },
  gale_bloom: t => { t.clear(); plantStem(t, [120, 200, 170], 7, 9); for (const [x, y] of [[7, 3], [6, 4], [8, 4], [7, 5], [5, 3], [9, 3]]) t.set(x, y, [170, 230, 255]); t.set(7, 4, [255, 255, 255]); },
};
function x0() { return 3; }


// ---------- v4 art: more woods, building pieces, ores, plants ----------
const WOOD_COL = { // bark, dark bark, ring inside, planks
  oak: [[104, 80, 50], [70, 52, 32], [176, 140, 88], [170, 132, 82]], birch: [[220, 216, 206], [60, 56, 50], [200, 180, 130], [200, 180, 124]],
  pine: [[74, 54, 36], [50, 36, 24], [150, 112, 70], [120, 88, 56]], jungle: [[88, 68, 36], [60, 46, 24], [176, 132, 92], [160, 114, 78]],
  acacia: [[104, 98, 90], [72, 68, 62], [190, 104, 60], [170, 92, 52]], dark_oak: [[62, 48, 32], [40, 30, 20], [96, 70, 44], [76, 52, 30]],
  mangrove: [[86, 64, 44], [60, 40, 30], [130, 60, 52], [118, 54, 48]], cherry: [[56, 36, 44], [36, 22, 30], [226, 176, 166], [222, 170, 160]],
  bamboo: [[150, 170, 60], [110, 130, 40], [200, 190, 100], [196, 176, 90]],
};
const dk = (c, k) => c.map(v => v * k);
const V4 = {};
for (const [w, [bark, dark, ring, pl]] of Object.entries(WOOD_COL)) {
  if (!['oak', 'birch', 'pine', 'bamboo'].includes(w)) {
    V4[w + '_log'] = t => t.bark(bark, dark);
    V4[w + '_log_top'] = t => t.rings(bark, ring);
    V4[w + '_planks'] = t => t.planks(pl);
    V4[w + '_leaves'] = w === 'cherry' ? (t => { t.leaves([236, 168, 196], 0.2); t.dots([250, 210, 226], 10); }) : (t => t.leaves([176, 176, 176], w === 'jungle' ? 0.12 : 0.22));
    V4[w + '_sapling'] = t => { t.clear(); t.rect(7, 9, 2, 7, bark); t.blobs(w === 'cherry' ? [236, 160, 190] : [70, 150, 40], 3, 2, 3); for (let y = 12; y < 16; y++) for (let x = 0; x < 16; x++) if (x !== 7 && x !== 8) t.set(x, y, [0, 0, 0], 0); };
  }
  if (w === 'bamboo') V4.bamboo_planks = t => { t.noise(pl, 10, 0.5); for (let x = 0; x < 16; x += 4) t.rect(x, 0, 1, 16, dk(pl, 0.75)); };
  V4[w + '_fence'] = t => { t.clear(); t.rect(6, 0, 4, 16, pl); t.rect(6, 0, 1, 16, dk(pl, 1.15)); t.rect(9, 0, 1, 16, dk(pl, 0.7)); t.rect(0, 3, 16, 2, dk(pl, 0.92)); t.rect(0, 9, 16, 2, dk(pl, 0.92)); };
  V4[w + '_fence_gate'] = t => { t.clear(); t.rect(0, 1, 2, 14, dk(pl, 0.85)); t.rect(14, 1, 2, 14, dk(pl, 0.85)); t.rect(2, 3, 12, 2, pl); t.rect(2, 10, 12, 2, pl); t.rect(7, 3, 2, 9, dk(pl, 0.9)); };
  V4[w + '_door'] = t => { t.noise(pl, 12, 0.6); t.border(dk(pl, 0.62), 1); t.rect(7, 0, 2, 16, dk(pl, 0.72)); t.rect(2, 2, 4, 4, [200, 225, 235]); t.rect(10, 2, 4, 4, [200, 225, 235]); t.rect(11, 8, 2, 2, [200, 200, 206]); };
  V4[w + '_trapdoor'] = t => { t.noise(pl, 12, 0.6); t.border(dk(pl, 0.62), 1); for (const x of [4, 10]) for (const y of [4, 10]) t.rect(x, y, 2, 2, [0, 0, 0], 0); };
}
// ---------- v6 doors: each wood its own design (lower half <wood>_door, upper half <wood>_door_top) ----------
{
  const GL = [178, 212, 228], GH = [226, 242, 250], MET = [64, 64, 70], MH = [150, 150, 158];
  const sides = (t, c) => { t.rect(0, 0, 1, 16, c); t.rect(15, 0, 1, 16, c); };
  const win = (t, x, y, w, h, f) => { t.rect(x - 1, y - 1, w + 2, h + 2, f); t.rect(x, y, w, h, GL); t.set(x, y, GH); if (w > 2 && h > 2) t.set(x + 1, y + 1, GH); };
  const inset = (t, x, y, w, h, pl) => { t.rect(x, y, w, h, dk(pl, 0.84)); t.rect(x, y, w, 1, dk(pl, 0.7)); t.rect(x, y, 1, h, dk(pl, 0.7)); t.rect(x, y + h - 1, w, 1, dk(pl, 1.12)); t.rect(x + w - 1, y, 1, h, dk(pl, 1.12)); };
  const handle = t => { t.rect(12, 1, 2, 3, MET); t.set(12, 1, MH); };
  const D = {
    oak: [t => { inset(t, 3, 2, 4, 11, t.pl); inset(t, 9, 2, 4, 11, t.pl); handle(t); },
      t => { for (const x of [3, 9]) for (const y of [3, 9]) win(t, x, y, 4, 4, dk(t.pl, 0.7)); }],
    birch: [t => { inset(t, 3, 1, 10, 5, t.pl); inset(t, 3, 8, 10, 6, t.pl); handle(t); },
      t => { win(t, 3, 3, 10, 11, dk(t.pl, 0.75)); t.rect(7, 3, 2, 11, dk(t.pl, 0.75)); t.rect(3, 8, 10, 1, dk(t.pl, 0.75)); }],
    pine: [t => { for (const x of [4, 8, 12]) t.rect(x, 0, 1, 16, dk(t.pl, 0.72)); t.rect(1, 10, 14, 2, MET); for (const x of [3, 8, 13]) t.set(x, 10, MH); handle(t); },
      t => { for (const x of [4, 8, 12]) t.rect(x, 0, 1, 16, dk(t.pl, 0.72)); t.rect(1, 4, 14, 2, MET); for (const x of [3, 8, 13]) t.set(x, 4, MH); win(t, 6, 8, 4, 3, dk(t.pl, 0.6)); }],
    jungle: [t => { for (let i = 0; i < 12; i++) { t.set(2 + i, 2 + i, dk(t.pl, 0.7)); t.set(13 - i, 2 + i, dk(t.pl, 0.7)); } handle(t); },
      t => { for (const x of [3, 7, 11]) for (const y of [3, 7, 11]) win(t, x, y, 2, 2, dk(t.pl, 0.7)); }],
    acacia: [t => { for (let y = 0; y < 5; y++) { t.rect(8 - y, 3 + y, 2 * y, 1, dk(t.pl, 0.8)); t.rect(8 - y, 12 - y, 2 * y, 1, dk(t.pl, 0.8)); } handle(t); },
      t => { win(t, 4, 5, 8, 9, dk(t.pl, 0.7)); t.rect(4, 4, 8, 1, dk(t.pl, 0.7)); for (const [x, y] of [[4, 5], [11, 5], [4, 6], [11, 6], [5, 5], [10, 5]]) t.set(x, y, dk(t.pl, 0.7)); t.rect(7, 5, 2, 9, dk(t.pl, 0.7)); }],
    dark_oak: [t => { t.rect(2, 1, 12, 2, dk(t.pl, 0.7)); t.rect(2, 12, 12, 2, dk(t.pl, 0.7)); for (let i = 0; i < 10; i++) t.rect(12 - i, 3 + i, 2, 1, dk(t.pl, 0.7)); handle(t); },
      t => { t.rect(2, 13, 12, 2, dk(t.pl, 0.7)); win(t, 4, 3, 2, 7, dk(t.pl, 0.6)); win(t, 10, 3, 2, 7, dk(t.pl, 0.6)); }],
    mangrove: [t => { for (let y = 1; y < 16; y += 3) t.rect(1, y, 14, 1, dk(t.pl, 0.74)); handle(t); },
      t => { for (let y = 13; y < 16; y += 3) t.rect(1, y, 14, 1, dk(t.pl, 0.74)); for (const x of [3, 6, 9, 12]) win(t, x, 3, 1, 8, dk(t.pl, 0.7)); }],
    cherry: [t => { inset(t, 3, 2, 10, 11, t.pl); t.rect(7, 6, 2, 3, dk(t.pl, 0.9)); handle(t); },
      t => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 5.2) t.set(x, y, d > 4.2 ? dk(t.pl, 0.72) : GL); } t.rect(7, 3, 2, 10, dk(t.pl, 0.72)); t.rect(3, 7, 10, 2, dk(t.pl, 0.72)); t.set(5, 5, GH); }],
    bamboo: [t => { for (const x of [1, 5, 9, 13]) { t.rect(x, 0, 2, 16, dk(t.pl, 1.05)); t.rect(x + 2, 0, 1, 16, dk(t.pl, 0.7)); for (let y = 3; y < 16; y += 6) t.rect(x, y, 3, 1, dk(t.pl, 0.72)); } handle(t); },
      t => { for (const x of [1, 5, 9, 13]) { t.rect(x, 0, 2, 16, dk(t.pl, 1.05)); t.rect(x + 2, 0, 1, 16, dk(t.pl, 0.7)); for (let y = 2; y < 16; y += 6) t.rect(x, y, 3, 1, dk(t.pl, 0.72)); } win(t, 3, 5, 10, 3, dk(t.pl, 0.6)); }],
  };
  for (const [w, [lo, hi]] of Object.entries(D)) {
    const pl = WOOD_COL[w][3];
    const base = (t, top) => { t.pl = pl; t.noise(pl, 12, 0.6); sides(t, dk(pl, 0.62)); t.rect(0, top ? 0 : 15, 16, 1, dk(pl, 0.62)); };
    V4[w + '_door'] = t => { base(t, false); lo(t); };
    V4[w + '_door_top'] = t => { base(t, true); hi(t); };
  }
}
V4.bamboo = t => { t.clear(); for (const x of [4, 10]) { t.rect(x, 0, 2, 16, [130, 170, 50]); for (let y = 2; y < 16; y += 5) t.rect(x, y, 2, 1, [90, 120, 30]); } t.rect(6, 3, 3, 1, [100, 170, 60]); t.rect(11, 8, 3, 1, [100, 170, 60]); };
V4.ladder = t => { t.clear(); const c = [150, 112, 66]; t.rect(2, 0, 2, 16, c); t.rect(12, 0, 2, 16, c); for (let y = 1; y < 16; y += 4) t.rect(2, y, 12, 2, dk(c, 0.9)); };
V4.diamond_ore = t => ore(t, [90, 230, 220], [220, 255, 250], 5);
V4.emerald_ore = t => ore(t, [40, 200, 90], [170, 255, 190], 3);
V4.lapis_ore = t => ore(t, [40, 70, 190], [110, 150, 250], 6);
V4.redstone_ore = t => ore(t, [200, 30, 30], [255, 120, 110], 6);
V4.quartz_ore = t => ore(t, [236, 230, 222], [255, 255, 255], 6);
V4.amethyst_block = t => { t.noise([150, 100, 200], 26, 0.5); t.blobs([190, 140, 235], 5, 1, 2, [230, 200, 255]); };
const metal = (c) => t => { t.noise(c, 14, 0.5); t.bevel(dk(c, 1.25), dk(c, 0.7)); t.rect(3, 3, 10, 10, dk(c, 1.05)); };
Object.assign(V4, { diamond_block: metal([90, 220, 210]), emerald_block: metal([40, 190, 90]), lapis_block: metal([40, 70, 180]),
  redstone_block: metal([190, 30, 30]), quartz_block: t => { t.noise([234, 228, 220], 8, 0.5); t.bevel([250, 248, 244], [200, 194, 186]); } });
V4.redstone_lamp = t => { t.noise([120, 60, 30], 14, 0.5); for (let i = 0; i < 16; i += 5) { t.rect(i, 0, 2, 16, [255, 200, 120]); t.rect(0, i, 16, 2, [255, 200, 120]); } t.border([70, 40, 24], 1); };
V4.candle = t => { t.clear(); t.rect(7, 7, 3, 9, [240, 230, 200]); t.rect(8, 5, 1, 2, [60, 50, 40]); t.set(8, 3, [255, 240, 160]); t.set(8, 4, [255, 180, 60]); };
V4.rail = t => { t.clear(); for (let y = 1; y < 16; y += 4) t.rect(1, y, 14, 2, [110, 82, 50]); t.rect(3, 0, 2, 16, [190, 190, 196]); t.rect(11, 0, 2, 16, [190, 190, 196]); };
V4.melon = t => { t.noise([90, 160, 40], 14, 0.5); for (let x = 0; x < 16; x += 4) t.rect(x, 0, 2, 16, [50, 110, 30]); };
V4.melon_top = t => { t.noise([90, 160, 40], 14, 0.5); t.rect(6, 6, 4, 4, [70, 120, 30]); };
const bush = (berry) => t => { t.clear(); t.blobs([60, 130, 50], 7, 2, 3); for (let y = 12; y < 16; y++) t.rect(7, y, 2, 1, [90, 70, 40]); if (berry) t.dots(berry, 9); };
V4.sweet_berry_bush = bush([200, 30, 40]);
const crop = (root) => t => { t.clear(); for (const x of [3, 7, 11]) { plantStem(t, [70, 150, 40], x, 9); t.rect(x - 1, 6, 3, 2, [80, 170, 50]); t.rect(x, 13, 2, 3, root); } };
V4.carrots = crop([240, 140, 40]); V4.potatoes = crop([210, 170, 100]); V4.beetroots = crop([160, 30, 50]);
const flower = (petal, center, tall) => t => { t.clear(); plantStem(t, [70, 150, 40], 7, tall ? 12 : 9); const y0 = tall ? 2 : 4;
  for (const [x, y] of [[7, y0], [6, y0 + 1], [8, y0 + 1], [7, y0 + 2], [5, y0 + 1], [9, y0 + 1], [7, y0 - 1]]) t.set(x, y, petal); t.set(7, y0 + 1, center); t.rect(8, 12, 2, 1, [70, 150, 40]); };
Object.assign(V4, { poppy: flower([220, 30, 30], [40, 30, 20]), dandelion: flower([250, 220, 40], [230, 180, 20]), blue_orchid: flower([60, 170, 240], [200, 230, 255]),
  allium: flower([190, 110, 230], [220, 160, 250]), azure_bluet: flower([235, 240, 250], [240, 220, 90]), red_tulip: flower([230, 50, 40], [190, 30, 30]),
  orange_tulip: flower([250, 140, 40], [220, 110, 30]), white_tulip: flower([240, 240, 236], [220, 220, 210]), pink_tulip: flower([250, 170, 200], [230, 140, 180]),
  oxeye_daisy: flower([250, 250, 246], [240, 200, 40]), sunflower: flower([250, 210, 30], [120, 80, 30], true), lilac: flower([200, 150, 220], [230, 190, 240], true),
  rose_bush: flower([200, 20, 40], [150, 10, 30], true), peony: flower([240, 170, 210], [250, 200, 230], true) });
V4.flower_pot = t => { t.clear(); t.rect(4, 6, 8, 10, [170, 90, 60]); t.rect(4, 6, 8, 1, [200, 120, 80]); t.rect(5, 7, 6, 1, [70, 50, 30]); };
V4.flower_pot_top = t => { t.clear(); t.rect(4, 4, 8, 8, [170, 90, 60]); t.rect(5, 5, 6, 6, [70, 50, 30]); };
Object.assign(DRAW, V4);

export function buildAtlas(tileNames) {
  const names = tileNames.slice();
  if (!names.includes('grass_side_overlay')) names.push('grass_side_overlay');
  const cols = 16, rows = Math.ceil(names.length / cols);
  const W = cols * CELL, H = rows * CELL;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const rects = {}, avg = {};
  names.forEach((name, i) => {
    const t = new Tex(name);
    (DRAW[name] || (q => q.noise([200, 0, 200], 40)))(t);
    const col = i % cols, row = (i / cols) | 0, ox = col * CELL, oy = row * CELL;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = -GUT; y < T + GUT; y++) for (let x = -GUT; x < T + GUT; x++) {
      const sx = Math.min(T - 1, Math.max(0, x)), sy = Math.min(T - 1, Math.max(0, y));
      const si = (sy * T + sx) * 4, di = ((oy + GUT + y) * W + ox + GUT + x) * 4;
      for (let k = 0; k < 4; k++) img.data[di + k] = t.d[si + k];
      if (x === sx && y === sy && t.d[si + 3] > 100) { sr += t.d[si]; sg += t.d[si + 1]; sb += t.d[si + 2]; n++; }
    }
    rects[name] = [(ox + GUT) / W, 1 - (oy + GUT + T) / H, (ox + GUT + T) / W, 1 - (oy + GUT) / H];
    avg[name] = n ? [sr / n / 255, sg / n / 255, sb / n / 255] : [1, 1, 1];
    TILE_PIX[name] = t.d;
  });
  ctx.putImageData(img, 0, 0);
  return { canvas, rects, avg };
}
export const TILE_PIX = {};

// ---------- item icons (32x32) ----------
const TIER_COL = { wooden: [150, 112, 64], stone: [130, 130, 132], copper: [214, 120, 70], iron: [222, 222, 228], golden: [250, 210, 60], sapphire: [70, 130, 240], emberite: [240, 110, 40], skysteel: [150, 210, 245], flint: [120, 120, 126], fishing: [150, 112, 64], shears: [222, 222, 228] };
const ARMOR_COL = { hide: [150, 100, 60], copper: [214, 120, 70], iron: [222, 222, 228], sapphire: [70, 130, 240], golden: [250, 210, 60], emberite: [240, 110, 40], skysteel: [150, 210, 245] };
const TOOL_PIX = {
  pickaxe: ['.HHHHHH.', 'H.....SH', '.....S..', '....S...', '...S....', '..S.....', '.S......', 'S.......'],
  axe: ['....HH..', '...HHHH.', '...HHS..', '....S...', '...S....', '..S.....', '.S......', 'S.......'],
  shovel: ['......HH', '.....HHH', '.....HH.', '....S...', '...S....', '..S.....', '.S......', 'S.......'],
  sword: ['.......H', '......HH', '.....HH.', '....HH..', '.S.HH...', '..SH....', '.S.S....', 'S.......'],
  hoe: ['...HHHH.', '......SH', '.....S..', '....S...', '...S....', '..S.....', '.S......', 'S.......'],
  igniter: ['........', '.HH.....', 'H..H....', 'H..H....', '.HHCC...', '....CC..', '.....CC.', '......C.'],
  rod: ['.......S', '......SF', '.....S.F', '....S..F', '...S...F', '..S....F', '.S....HH', 'S.......'],
  shears: ['H.....H.', '.H...H..', '..H.H...', '...H....', '..C.C...', '.C...C..', 'C.....C.', 'CC...CC.'],
  bow: ['....SSF.', '...S...F', '..S....F', '.S.....F', 'S......F', '.S.....F', '..S...F.', '...SSF..'],
};
const ITEM_SHAPES = {
  ingot: ['........', '........', '..HHHH..', '.HCCCCH.', 'HCCCCCCH', 'DDDDDDDD', '........', '........'],
  raw: ['........', '...CC...', '..CCHC..', '.CCCCCD.', '.CHCCCD.', '..CCDD..', '...D....', '........'],
  gem: ['........', '..HHHH..', '.HCCCCD.', 'HCCCCCCD', '.CCCCCD.', '..CCDD..', '...DD...', '........'],
  lump: ['........', '..CCC...', '.CCHCC..', 'CCCCCCD.', '.CCCCDD.', '..CDDD..', '........', '........'],
  stick: ['.......C', '......C.', '.....C..', '....C...', '...C....', '..C.....', '.C......', 'C.......'],
  meat: ['........', '...CCC..', '..CHCCC.', '.CCCCCC.', '.CCCCCD.', '..CCDD..', '.WW.....', 'WW......'],
  dust: ['........', '.C..H...', '...C..C.', '.H..C...', '..C...H.', 'C...C...', '..H...C.', '........'],
  ball: ['........', '..CCCC..', '.CHCCCC.', '.CCCCCC.', '.CCCCCD.', '.CCCCDD.', '..DDDD..', '........'],
  bucket: ['........', '.H....H.', '.CCCCCC.', '.CWWWWC.', '.CCCCCC.', '..CCCC..', '..DDDD..', '........'],
  sheet: ['........', '.CCCCCC.', '.CHHHHC.', '.CCCCCC.', '.CHHHHC.', '.CCCCCC.', '.CCCCCC.', '........'],
  feather: ['......CC', '.....CHC', '....CHC.', '...CHC..', '..CHC...', '.CC.....', 'D.......', '........'],
  bowl: ['........', '........', 'CCCCCCCC', 'CWWWWWWC', '.CCCCCC.', '..CCCC..', '........', '........'],
  arrow: ['.....HHH', '......HH', '.....S.H', '....S...', '...S....', 'F.S.....', '.F......', 'FF......'],
  egg: ['........', '...CC...', '..CCHC..', '..CCCC..', '.CCCCCC.', '.CCCCCD.', '..CDDD..', '........'],
  armor: ['........', '.CC..CC.', '.CCCCCC.', '..CHCC..', '..CCCC..', '..CCCC..', '..DDDD..', '........'],
};
const ICON_DEF = {
  ember_shard: ['gem', [250, 120, 40]], ember_rod: ['stick', [255, 150, 40]], storm_eye: ['ball', [90, 160, 250], [255, 255, 255]], sky_crystal: ['gem', [130, 220, 255]],
  skysteel_ingot: ['ingot', [160, 214, 245]], storm_heart: ['ball', [180, 230, 255]], string: ['dust', [240, 240, 240]], golden_apple: ['ball', [250, 210, 60]],
  cloudberry: ['ball', [200, 220, 255]], ember_pepper: ['raw', [230, 60, 30]], shield: ['armor', [150, 112, 64]],
  stick: ['stick', [124, 92, 52]], coal: ['lump', [40, 40, 44]], charcoal: ['lump', [60, 48, 40]], raw_copper: ['raw', [210, 120, 70]], raw_iron: ['raw', [210, 170, 140]], raw_gold: ['raw', [240, 200, 60]],
  copper_ingot: ['ingot', [220, 124, 76]], iron_ingot: ['ingot', [220, 220, 226]], gold_ingot: ['ingot', [250, 210, 60]], sapphire: ['gem', [60, 120, 240]], flint: ['lump', [60, 60, 66]],
  fiber: ['dust', [200, 220, 160]], bone: ['stick', [236, 232, 214]], bone_meal: ['dust', [236, 236, 230]], spore_dust: ['dust', [140, 160, 110]], goo: ['ball', [110, 210, 90]],
  feather: ['feather', [240, 240, 240]], hide: ['sheet', [150, 100, 60]], clay_ball: ['ball', [160, 166, 180]], brick: ['ingot', [170, 80, 60]], glow_dust: ['dust', [120, 250, 230]],
  wheat: ['stick', [220, 190, 90]], paper: ['sheet', [240, 240, 232]], book: ['sheet', [130, 60, 50]], bowl: ['bowl', [150, 112, 64]], arrow: ['arrow', [124, 92, 52]], egg: ['egg', [240, 230, 210]],
  seeds: ['dust', [110, 170, 60]], bucket: ['bucket', [200, 200, 206]], water_bucket: ['bucket', [200, 200, 206], [60, 120, 230]], lava_bucket: ['bucket', [200, 200, 206], [250, 120, 30]],
  apple: ['ball', [220, 40, 40]], bread: ['raw', [200, 150, 80]], mushroom_stew: ['bowl', [150, 112, 64], [180, 130, 90]], pumpkin_pie: ['raw', [220, 140, 60]],
  raw_venison: ['meat', [200, 70, 70]], cooked_venison: ['meat', [140, 80, 50]], raw_poultry: ['meat', [240, 180, 170]], cooked_poultry: ['meat', [210, 150, 80]],
  raw_boar: ['meat', [230, 130, 130]], cooked_boar: ['meat', [170, 100, 60]], raw_fish: ['raw', [120, 170, 210]], cooked_fish: ['raw', [200, 150, 100]],
  raw_beef: ['meat', [210, 60, 60]], steak: ['meat', [130, 70, 40]], raw_pork: ['meat', [245, 160, 160]], cooked_pork: ['meat', [200, 130, 80]],
  raw_mutton: ['meat', [220, 90, 90]], cooked_mutton: ['meat', [160, 90, 60]], raw_rabbit: ['meat', [235, 170, 150]], cooked_rabbit: ['meat', [190, 120, 70]],
  rabbit_stew: ['bowl', [150, 112, 64], [190, 120, 60]], rabbit_hide: ['sheet', [190, 150, 110]], rabbit_foot: ['stick', [210, 180, 140]],
  honeycomb: ['gem', [240, 180, 40]], turtle_scute: ['sheet', [80, 160, 70]], armadillo_scute: ['sheet', [170, 110, 90]],
};


// v4 item icons
Object.assign(TIER_COL, { diamond: [90, 230, 220], trident: [120, 200, 200] });
Object.assign(ARMOR_COL, { leather: [150, 100, 60], chainmail: [170, 170, 176], diamond: [90, 230, 220] });
const DYE_COL = { white: [240, 240, 240], orange: [250, 140, 40], magenta: [200, 80, 200], light_blue: [110, 180, 240], yellow: [250, 220, 50], lime: [130, 210, 50],
  pink: [245, 160, 190], gray: [90, 90, 96], light_gray: [160, 160, 164], cyan: [30, 150, 160], purple: [130, 50, 180], blue: [50, 70, 190], brown: [120, 80, 50],
  green: [70, 110, 30], red: [190, 40, 40], black: [30, 30, 34] };
for (const [c, col] of Object.entries(DYE_COL)) ICON_DEF[c + '_dye'] = ['dust', col];
Object.assign(ICON_DEF, {
  diamond: ['gem', [90, 230, 220]], emerald: ['gem', [40, 200, 90]], lapis_lazuli: ['lump', [40, 70, 190]], redstone_dust: ['dust', [220, 30, 30]],
  amethyst_shard: ['gem', [170, 110, 220]], quartz: ['gem', [236, 230, 222]], leather: ['sheet', [140, 90, 50]], sugar: ['dust', [250, 250, 250]],
  glass_bottle: ['bucket', [200, 230, 240]], snowball: ['ball', [245, 250, 255]], fire_charge: ['ball', [230, 100, 30], [255, 220, 100]],
  compass: ['ball', [200, 200, 206]], clock: ['ball', [250, 210, 60]], spyglass: ['stick', [214, 120, 70]], name_tag: ['sheet', [210, 180, 120]],
  lead: ['stick', [180, 150, 100]], saddle: ['sheet', [120, 70, 40]], gunpowder: ['dust', [90, 90, 90]], slimeball: ['ball', [110, 210, 90]],
  ink_sac: ['ball', [40, 40, 50]], rotten_flesh: ['meat', [140, 110, 70]], spider_eye: ['ball', [150, 30, 50]], iron_nugget: ['dust', [220, 220, 226]],
  gold_nugget: ['dust', [250, 210, 60]], carrot: ['raw', [240, 140, 40]], golden_carrot: ['raw', [250, 210, 60]], potato: ['raw', [210, 170, 100]],
  baked_potato: ['raw', [200, 140, 70]], poisonous_potato: ['raw', [170, 190, 90]], beetroot: ['ball', [160, 30, 50]], beetroot_soup: ['bowl', [150, 112, 64], [160, 30, 50]],
  cookie: ['ball', [190, 120, 60]], cake: ['sheet', [240, 230, 220]], sweet_berries: ['ball', [200, 30, 40]], melon_slice: ['raw', [230, 70, 70]],
  raw_cod: ['raw', [190, 170, 140]], cooked_cod: ['raw', [200, 150, 100]], raw_salmon: ['raw', [220, 110, 90]], cooked_salmon: ['raw', [190, 110, 70]],
  tropical_fish: ['raw', [250, 140, 40]], pufferfish: ['ball', [230, 200, 60]], dried_kelp: ['lump', [50, 70, 40]], honey_bottle: ['bucket', [200, 230, 240], [240, 170, 40]],
});

export function makeIconFactory(defs, atlas) {
  const cache = {};
  function paint(ctx, shape, col, extra, s = 4) {
    const shadeOf = (c, k) => `rgb(${clamp(c[0] * k)},${clamp(c[1] * k)},${clamp(c[2] * k)})`;
    shape.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return;
      let c = col, k = 1;
      if (ch === 'H') k = 1.3; else if (ch === 'D') k = 0.65; else if (ch === 'S') c = [124, 92, 52]; else if (ch === 'W') c = extra || [250, 250, 250]; else if (ch === 'F') c = [230, 230, 230];
      ctx.fillStyle = shadeOf(c, k);
      ctx.fillRect(x * s, y * s, s, s);
    }));
  }
  function blockIcon(ctx, b) {
    const tile = n => TILE_PIX[n];
    const top = tile(defs.faceTile(b, 2)), side = tile(defs.faceTile(b, 4)), side2 = tile(defs.faceTile(b, 0));
    const tint = b.tint === 'grass' || b.tint === 'foliage' ? [0.5, 0.75, 0.3] : b.tint === 'birch' ? [0.55, 0.72, 0.38] : b.tint === 'pine' ? [0.32, 0.5, 0.34] : b.tint === 'water' ? [0.3, 0.5, 0.9] : [1, 1, 1];
    if (b.render === 'cross' || b.render === 'torch') {
      const d = tile(defs.faceTile(b, 4));
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; if (d[i + 3] < 100) continue; const tt = b.tint ? tint : [1, 1, 1]; ctx.fillStyle = `rgb(${d[i] * tt[0] | 0},${d[i + 1] * tt[1] | 0},${d[i + 2] * tt[2] | 0})`; ctx.fillRect(x * 2, y * 2, 2, 2); }
      return;
    }
    const put = (pix, k, tt, map) => { for (let v = 0; v < 16; v++) for (let u = 0; u < 16; u++) { const i = (v * 16 + u) * 4; if (pix[i + 3] < 60) continue; const [x, y] = map(u, v); ctx.fillStyle = `rgb(${pix[i] * k * tt[0] | 0},${pix[i + 1] * k * tt[1] | 0},${pix[i + 2] * k * tt[2] | 0})`; ctx.fillRect(x, y, 1.6, 1.6); } };
    put(side, 0.82, [1, 1, 1], (u, v) => [1 + u * 0.94, 8.5 + u * 0.47 + v * 0.94]);
    put(side2, 0.62, [1, 1, 1], (u, v) => [16 + u * 0.94, 16 - u * 0.47 + v * 0.94]);
    put(top, 1, b.tint ? tint : [1, 1, 1], (u, v) => [16 + (u - v) * 0.94, 1 + (u + v) * 0.47]);
  }
  // doors show as a flat two-block door in the hotbar
  function doorIcon(ctx, b) {
    for (const [pix, oy] of [[TILE_PIX[defs.faceTile(b, 2)], 0], [TILE_PIX[defs.faceTile(b, 4)], 16]]) {
      if (!pix) continue;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = (y * 16 + x) * 4; if (pix[i + 3] < 60) continue; ctx.fillStyle = `rgb(${pix[i]},${pix[i + 1]},${pix[i + 2]})`; ctx.fillRect(8 + x, oy + y, 1, 1); }
    }
  }
  return function icon(name) {
    if (cache[name]) return cache[name];
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const ctx = c.getContext('2d');
    const it = defs.ITEMS[name];
    if (it && it.block != null && defs.BLOCKS[it.block].door) doorIcon(ctx, defs.BLOCKS[it.block]);
    else if (it && it.block != null) blockIcon(ctx, defs.BLOCKS[it.block]);
    else if (it && it.tool) { const tier = name.split('_')[0]; paint(ctx, TOOL_PIX[it.tool.type] || TOOL_PIX.pickaxe, TIER_COL[tier] || [200, 200, 200]); }
    else if (it && it.armor) { const m = name.split('_')[0]; paint(ctx, ITEM_SHAPES.armor, ARMOR_COL[m] || [70, 130, 240]); }
    else if (ICON_DEF[name]) { const [s, col, extra] = ICON_DEF[name]; paint(ctx, ITEM_SHAPES[s], col, extra); }
    else { ctx.fillStyle = '#888'; ctx.fillRect(6, 6, 20, 20); ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.fillText((name[0] || '?').toUpperCase(), 11, 21); }
    cache[name] = c;
    return c;
  };
}
