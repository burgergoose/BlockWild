/* Deterministic world generator. Same seed = same world on the server, the viewer and in replays. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./defs'), require('./noise'));
  else { root.BW = root.BW || {}; root.BW.worldgen = factory(root.BW.defs, root.BW.noise); }
})(typeof self !== 'undefined' ? self : globalThis, function (defs, noise) {
  'use strict';
  const { B, BIOME, HEIGHT, SEA, WORLD_CHUNKS } = defs;
  const { mulberry32, hash, Perlin, fbm2 } = noise;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const idx = (x, y, z) => (y << 8) | (z << 4) | x;

  const ORES = [ // id, veins per chunk, vein size, minY, maxY, replaces
    [B.coal_ore, 18, 9, 5, 110], [B.copper_ore, 10, 8, 14, 80], [B.iron_ore, 11, 6, 3, 64],
    [B.gold_ore, 3, 6, 3, 32], [B.sapphire_ore, 2, 5, 3, 16],
    [B.dirt, 6, 18, 20, 110], [B.gravel, 5, 14, 5, 110], [B.granite, 6, 22, 5, 100],
    [B.obsidian, 2, 6, 3, 12], [B.marble, 3, 18, 20, 90],
    [B.diamond_ore, 1, 4, 3, 14], [B.redstone_ore, 5, 6, 3, 20], [B.lapis_ore, 2, 5, 8, 34],
    [B.emerald_ore, 1, 2, 10, 90], [B.quartz_ore, 2, 5, 3, 40], [B.amethyst_block, 1, 7, 6, 30],
  ];

  class Generator {
    constructor(seed) {
      this.seed = seed >>> 0;
      const P = k => new Perlin(hash(this.seed, k));
      this.nCont = P(1); this.nHill = P(2); this.nMount = P(3); this.nMask = P(4); this.nTemp = P(5); this.nHum = P(6);
      this.nRiver = P(7); this.nCave1 = P(8); this.nCave2 = P(9); this.nCave3 = P(10); this.nDetail = P(11);
      this.size = WORLD_CHUNKS * 16;
    }

    column(x, z) {
      const realm = defs.realmAt(x, z);
      if (realm && realm.name === 'emberdeep') return this.emberColumn(x, z);
      if (realm && realm.name === 'skyreach') return this.skyColumn(x, z);
      const c = fbm2(this.nCont, x / 280, z / 280, 4) * 1.3 + 0.42;
      const land = clamp(c * 5, 0, 1);
      const hills = fbm2(this.nHill, x / 64, z / 64, 4) * 9;
      const mm = smooth(0.02, 0.32, fbm2(this.nMask, x / 240, z / 240, 3));
      const r = 1 - Math.abs(fbm2(this.nMount, x / 90, z / 90, 4) * 1.6);
      let h = SEA + c * 20 + hills * (0.35 + land * 0.65) + mm * land * r * r * 62;
      const temp = fbm2(this.nTemp, x / 340, z / 340, 3) * 1.6 - Math.max(0, h - 70) * 0.012;
      const hum = fbm2(this.nHum, x / 300, z / 300, 3) * 1.6;
      let river = false;
      const rv = Math.abs(fbm2(this.nRiver, x / 210, z / 210, 3));
      if (h > SEA - 3 && rv < 0.03 && mm < 0.7) {
        const t = smooth(0.008, 0.03, rv);
        h = lerp(SEA - 4, h, t);
        river = t < 0.5;
      }
      const sw = smooth(0.18, 0.4, hum) * smooth(-0.15, 0.05, temp) * (1 - mm) * land;
      if (sw > 0 && h > SEA - 3) h = lerp(h, SEA + 0.6 + (h - SEA) * 0.15, sw);
      h = Math.round(clamp(h, 6, 118));
      let b;
      if (river && h < SEA) b = BIOME.river;
      else if (h < SEA - 1) b = BIOME.ocean;
      else if (h <= SEA + 1 && sw < 0.5 && temp > -0.3) b = BIOME.beach;
      else if (h > 84 || (mm * land > 0.5 && h > 70)) b = BIOME.mountains;
      else if (temp < -0.3) b = BIOME.snowy;
      else if (sw > 0.5) b = BIOME.swamp;
      else if (temp > 0.2 && hum < 0.15) b = BIOME.desert;
      else if (hum > -0.05) b = BIOME.forest;
      else b = BIOME.plains;
      return { h, b, temp, hum };
    }

    surface(col, x, z) {
      const dn = this.nDetail.noise2(x / 7, z / 7);
      const h = col.h;
      let top = B.grass, fill = B.dirt, depth = 3 + (dn > 0.2 ? 1 : 0), deep = 0;
      switch (col.b) {
        case BIOME.ocean: case BIOME.river:
          top = fill = dn > 0.35 ? B.gravel : dn < -0.4 && h > SEA - 8 ? B.clay : B.sand; break;
        case BIOME.beach: top = fill = B.sand; deep = B.sandstone; break;
        case BIOME.desert: top = fill = B.sand; depth = 4; deep = B.sandstone; break;
        case BIOME.snowy: top = B.snowy_grass; break;
        case BIOME.mountains:
          if (h >= 100) { top = B.snow_block; fill = B.stone; }
          else if (h > 82 + dn * 10) { top = fill = B.stone; }
          else if (col.temp < -0.2 || h > 90) top = B.snowy_grass;
          break;
      }
      if (h < SEA && top === B.grass) top = B.dirt;
      return { top, fill, depth, deep };
    }

    // ---------- the Emberdeep: a sealed cavern world over a lava sea ----------
    emberColumn(x, z) {
      const [ax, az] = defs.REALM.emberdeep.arrive;
      const pad = Math.max(Math.abs(x - ax), Math.abs(z - az));
      let h = 31 + fbm2(this.nHill, x / 40, z / 40, 4) * 16 + Math.max(0, fbm2(this.nMount, x / 70, z / 70, 3)) * 30;
      if (pad <= 9) h = 50; else if (pad < 16) h = lerp(50, h, (pad - 9) / 7);
      h = Math.round(clamp(h, 22, 90));
      const ceil = Math.round(clamp(104 + fbm2(this.nMask, x / 30, z / 30, 3) * 14, Math.max(h + 6, 92), 125));
      return { h, b: BIOME.emberdeep, temp: 2, hum: -1, ceil };
    }
    emberChunk(cx, cz) {
      const blocks = new Uint8Array(16 * 16 * HEIGHT), biomes = new Uint8Array(256), heights = new Uint8Array(256), chests = [];
      const ox = cx * 16, oz = cz * 16, rng = mulberry32(hash(this.seed, cx, cz, 199)), LAVA = 33;
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const x = ox + lx, z = oz + lz, col = this.emberColumn(x, z), ci = lz * 16 + lx;
        biomes[ci] = col.b; heights[ci] = col.h;
        const dn = this.nDetail.noise2(x / 9, z / 9);
        for (let y = 0; y < HEIGHT; y++) {
          let id = 0;
          if (y === 0 || y === HEIGHT - 1 || (y < 3 && rng() < 0.5)) id = B.bedrock;
          else if (y <= col.h) id = y === col.h && dn > 0.35 ? B.ashsand : y === col.h && dn < -0.45 ? B.magma_rock : B.cinderstone;
          else if (y <= LAVA) id = B.lava;
          else if (y >= col.ceil) id = B.cinderstone;
          blocks[idx(lx, y, lz)] = id;
        }
        // glowing crystals hang from the ceiling
        if (rng() < 0.02) for (let k = 1; k <= 1 + Math.floor(rng() * 3); k++) blocks[idx(lx, col.ceil - k, lz)] = B.glow_crystal;
        // cinder pillars join floor and ceiling
        if (this.nCave3.noise2(x / 11, z / 11) > 0.62) for (let y = col.h + 1; y < col.ceil; y++) blocks[idx(lx, y, lz)] = B.cinderstone;
      }
      for (let v = 0; v < 14; v++) { // emberite veins and magma pockets
        let x = rng() * 16, y = 10 + rng() * 90, z = rng() * 16;
        const id = v < 9 ? B.emberite_ore : B.magma_rock, n = 3 + Math.floor(rng() * 5);
        for (let k = 0; k < n; k++) {
          const bx = x | 0, by = y | 0, bz = z | 0;
          if (bx >= 0 && bx < 16 && bz >= 0 && bz < 16 && by > 0 && by < HEIGHT - 1 && blocks[idx(bx, by, bz)] === B.cinderstone) blocks[idx(bx, by, bz)] = id;
          x += rng() * 2 - 1; y += rng() * 1.6 - 0.8; z += rng() * 2 - 1;
        }
      }
      this.emberStructures(blocks, cx, cz, heights, chests, rng);
      return { cx, cz, blocks, biomes, heights, chests };
    }
    emberStructures(blocks, cx, cz, heights, chests, rng) {
      const [ax, az] = defs.REALM.emberdeep.arrive, ox = cx * 16, oz = cz * 16;
      const put = (x, y, z, id) => { const lx = x - ox, lz = z - oz; if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16 && y > 0 && y < HEIGHT - 1) blocks[idx(lx, y, lz)] = id; };
      // arrival platform with a return gate
      if (Math.abs(ox + 8 - ax) < 24 && Math.abs(oz + 8 - az) < 24) {
        for (let x = ax - 6; x <= ax + 6; x++) for (let z = az - 6; z <= az + 6; z++) { put(x, 50, z, B.cinder_bricks); for (let y = 51; y < 56; y++) put(x, y, z, 0); }
        for (const [x, z] of [[ax - 6, az - 6], [ax + 6, az - 6], [ax - 6, az + 6], [ax + 6, az + 6]]) put(x, 51, z, B.lantern);
        portalFrame(put, ax, 51, az - 4, B.obsidian, B.ember_portal);
      }
      // ember keeps: walled courtyards with a loot chest
      const r = mulberry32(hash(this.seed, cx, cz, 231));
      if (r() < 0.07 && Math.abs(ox + 8 - ax) > 30) {
        const h = heights[8 * 16 + 8];
        if (h > 34) {
          for (let lx = 3; lx <= 13; lx++) for (let lz = 3; lz <= 13; lz++) {
            const edge = lx === 3 || lx === 13 || lz === 3 || lz === 13;
            blocks[idx(lx, h, lz)] = B.cinder_bricks;
            for (let y = h + 1; y <= h + 5; y++) blocks[idx(lx, y, lz)] = edge && !(lx === 8 && y <= h + 2) && y <= h + 4 ? B.cinder_bricks : 0;
          }
          blocks[idx(8, h + 1, 8)] = B.chest; blocks[idx(5, h + 1, 5)] = B.lantern; blocks[idx(11, h + 1, 11)] = B.lantern;
          chests.push({ x: ox + 8, y: h + 1, z: oz + 8, seed: hash(this.seed, cx, cz, 232), kind: 'ember' });
        }
      }
    }

    // ---------- the Skyreach: floating islands above an endless drop ----------
    skyColumn(x, z) {
      const [ax, az] = defs.REALM.skyreach.arena, [px, pz] = defs.REALM.skyreach.arrive;
      const dc = Math.hypot(x - ax, z - az), dp = Math.hypot(x - px, z - pz);
      let m = fbm2(this.nMask, x / 46, z / 46, 4) * 1.4 - 0.15;
      m = Math.max(m, 1 - dc / 44, 1 - dp / 12, dc < 70 && Math.abs(x - ax) < 3 ? 0.4 : -1); // central isle, arrival isle, a bridge between them
      if (m <= 0) return { h: 0, b: BIOME.skyreach, temp: 0, hum: 0, bottom: 0, island: false };
      let h = 72 + fbm2(this.nHill, x / 30, z / 30, 3) * 6 + Math.min(m, 0.5) * 10;
      if (dc < 20) h = 80; if (dp < 7) h = 78;
      h = Math.round(clamp(h, 60, 110));
      const bottom = Math.round(h - 2 - m * 26 - Math.abs(fbm2(this.nDetail, x / 12, z / 12, 2)) * 8);
      return { h, b: BIOME.skyreach, temp: 0, hum: 0, bottom, island: true };
    }
    skyChunk(cx, cz) {
      const blocks = new Uint8Array(16 * 16 * HEIGHT), biomes = new Uint8Array(256), heights = new Uint8Array(256), chests = [];
      const ox = cx * 16, oz = cz * 16, rng = mulberry32(hash(this.seed, cx, cz, 299));
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const x = ox + lx, z = oz + lz, col = this.skyColumn(x, z), ci = lz * 16 + lx;
        biomes[ci] = col.b; heights[ci] = col.h;
        if (!col.island) continue;
        for (let y = Math.max(1, col.bottom); y <= col.h; y++) blocks[idx(lx, y, lz)] = y === col.h ? B.cloud_turf : (y < col.h - 6 && rng() < 0.012) ? B.skycrystal_ore : B.skystone;
        const a = rng();
        if (a < 0.03) blocks[idx(lx, col.h + 1, lz)] = B.gale_bloom;
        else if (a < 0.12) blocks[idx(lx, col.h + 1, lz)] = B.tall_grass;
      }
      // a few birch groves
      const tr = mulberry32(hash(this.seed, cx, cz, 307));
      for (let t = 0; t < 3; t++) {
        const lx = 3 + Math.floor(tr() * 10), lz = 3 + Math.floor(tr() * 10), col = this.skyColumn(ox + lx, oz + lz);
        if (col.island && tr() < 0.5 && Math.hypot(ox + lx - defs.REALM.skyreach.arena[0], oz + lz - defs.REALM.skyreach.arena[1]) > 24) this.tree(blocks, ox, oz, ox + lx, col.h + 1, oz + lz, 'birch', tr());
      }
      const [ax, az] = defs.REALM.skyreach.arena, [px, pz] = defs.REALM.skyreach.arrive;
      const put = (x, y, z, id) => { const lx = x - ox, lz = z - oz; if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16 && y > 0 && y < HEIGHT) blocks[idx(lx, y, lz)] = id; };
      // the storm arena: a ring of skystone brick pillars
      if (Math.abs(ox + 8 - ax) < 40 && Math.abs(oz + 8 - az) < 40) {
        for (let x = ax - 18; x <= ax + 18; x++) for (let z = az - 18; z <= az + 18; z++) { if (Math.hypot(x - ax, z - az) <= 18) { put(x, 80, z, B.skystone_bricks); for (let y = 81; y < 90; y++) put(x, y, z, 0); } }
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, x = Math.round(ax + Math.cos(a) * 16), z = Math.round(az + Math.sin(a) * 16); for (let y = 81; y <= 86; y++) put(x, y, z, B.skystone_bricks); put(x, 87, z, B.lantern); }
      }
      // arrival isle with the gate home
      if (Math.abs(ox + 8 - px) < 24 && Math.abs(oz + 8 - pz) < 24) {
        for (let x = px - 4; x <= px + 4; x++) for (let z = pz - 4; z <= pz + 4; z++) { put(x, 78, z, B.skystone_bricks); for (let y = 79; y < 85; y++) put(x, y, z, 0); }
        portalFrame(put, px, 79, pz + 3, B.skystone_bricks, B.sky_portal);
      }
      return { cx, cz, blocks, biomes, heights, chests };
    }

    chunk(cx, cz) {
      const realm = defs.realmOfChunk(cx, cz);
      if (realm && realm.name === 'emberdeep') return this.emberChunk(cx, cz);
      if (realm && realm.name === 'skyreach') return this.skyChunk(cx, cz);
      const blocks = new Uint8Array(16 * 16 * HEIGHT), biomes = new Uint8Array(256), heights = new Uint8Array(256);
      const ox = cx * 16, oz = cz * 16, cols = new Array(256), chests = [];
      const rng = mulberry32(hash(this.seed, cx, cz, 99));
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const x = ox + lx, z = oz + lz, col = this.column(x, z), ci = lz * 16 + lx;
        cols[ci] = col; biomes[ci] = col.b; heights[ci] = col.h;
        const h = col.h, s = this.surface(col, x, z);
        const darkY = 14 + Math.round(this.nDetail.noise2(x / 13 + 50, z / 13) * 4);
        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0 || (y < 3 && rng() < (y === 1 ? 0.6 : 0.3))) id = B.bedrock;
          else if (y === h) id = s.top;
          else if (y > h - s.depth) id = s.fill;
          else if (s.deep && y > h - s.depth - 3) id = s.deep;
          else id = y < darkY ? B.darkstone : B.stone;
          blocks[idx(lx, y, lz)] = id;
        }
        if (h < SEA) for (let y = h + 1; y <= SEA; y++) blocks[idx(lx, y, lz)] = (y === SEA && col.temp < -0.3) ? B.ice : B.water;
      }
      this.caves(blocks, ox, oz, heights, rng);
      this.ores(blocks, rng);
      this.plants(blocks, cols, ox, oz);
      this.trees(blocks, cx, cz);
      this.ruins(blocks, cols, cx, cz, chests);
      const villagers = this.villages(blocks, cx, cz, chests);
      return { cx, cz, blocks, biomes, heights, chests, villagers };
    }

    caves(blocks, ox, oz, heights, rng) {
      const GY = HEIGHT / 4 + 1, gv = new Float32Array(5 * GY * 5 * 2);
      let maxH = 0;
      for (let i = 0; i < 256; i++) if (heights[i] > maxH) maxH = heights[i];
      const gyMax = Math.min(GY - 1, (maxH >> 2) + 1);
      for (let gx = 0; gx < 5; gx++) for (let gz = 0; gz < 5; gz++) for (let gy = 0; gy <= gyMax; gy++) {
        const x = ox + gx * 4, y = gy * 4, z = oz + gz * 4, k = ((gx * 5 + gz) * GY + gy) * 2;
        const a = this.nCave1.noise3(x / 38, y / 22, z / 38), b = this.nCave2.noise3(x / 38, y / 22, z / 38);
        gv[k] = a * a + b * b;
        gv[k + 1] = this.nCave3.noise3(x / 56, y / 26, z / 56) - Math.abs(y - 22) / 90;
      }
      const sample = (lx, y, lz, o) => {
        const fx = lx / 4, fy = y / 4, fz = lz / 4;
        const x0 = fx | 0, y0 = fy | 0, z0 = fz | 0, tx = fx - x0, ty = fy - y0, tz = fz - z0;
        const g = (a, b, c) => gv[((a * 5 + c) * GY + b) * 2 + o];
        const c00 = lerp(g(x0, y0, z0), g(x0 + 1, y0, z0), tx), c10 = lerp(g(x0, y0 + 1, z0), g(x0 + 1, y0 + 1, z0), tx);
        const c01 = lerp(g(x0, y0, z0 + 1), g(x0 + 1, y0, z0 + 1), tx), c11 = lerp(g(x0, y0 + 1, z0 + 1), g(x0 + 1, y0 + 1, z0 + 1), tx);
        return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
      };
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const h = heights[lz * 16 + lx], top = h < SEA + 2 ? h - 7 : h - 4;
        for (let y = 4; y <= top; y++) {
          const i = idx(lx, y, lz), id = blocks[i];
          if (id === B.bedrock || id === B.water) continue;
          if (sample(lx, y, lz, 0) < 0.0045 || sample(lx, y, lz, 1) > 0.36) blocks[i] = y <= 10 ? B.lava : 0;
        }
      }
      // cave decoration: glow crystals on ceilings, glowcaps on floors
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const h = heights[lz * 16 + lx];
        for (let y = 11; y < h - 5; y++) {
          const i = idx(lx, y, lz);
          if (blocks[i] !== 0) continue;
          const up = blocks[i + 256], dn = blocks[i - 256];
          if ((up === B.stone || up === B.darkstone) && y < 44 && rng() < 0.006) blocks[i + 256] = B.glow_crystal;
          else if ((dn === B.stone || dn === B.darkstone) && rng() < 0.004) blocks[i] = rng() < 0.5 ? B.glowcap : B.brown_mushroom;
        }
      }
    }

    ores(blocks, rng) {
      for (const [id, veins, size, minY, maxY] of ORES) {
        for (let v = 0; v < veins; v++) {
          let x = rng() * 16, y = minY + rng() * (maxY - minY), z = rng() * 16;
          const n = Math.max(1, Math.round(size * (0.5 + rng() * 0.6)));
          for (let k = 0; k < n; k++) {
            const bx = x | 0, by = y | 0, bz = z | 0;
            if (bx >= 0 && bx < 16 && bz >= 0 && bz < 16 && by > 0 && by < HEIGHT) {
              const i = idx(bx, by, bz), cur = blocks[i];
              if (cur === B.stone || cur === B.darkstone || (id === B.coal_ore && cur === B.granite)) blocks[i] = id;
            }
            x += rng() * 2 - 1; y += rng() * 1.6 - 0.8; z += rng() * 2 - 1;
          }
        }
      }
    }

    plants(blocks, cols, ox, oz) {
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const col = cols[lz * 16 + lx], h = col.h, x = ox + lx, z = oz + lz;
        if (h >= HEIGHT - 4 || h < SEA) continue;
        const r = mulberry32(hash(this.seed, x, z, 3)), a = r(), kind = r(), tall = r();
        const ground = blocks[idx(lx, h, lz)], up = idx(lx, h + 1, lz);
        if (blocks[up] !== 0) continue;
        if (ground === B.grass) {
          const b = col.b;
          const grassP = b === BIOME.plains ? 0.22 : b === BIOME.forest ? 0.12 : b === BIOME.swamp ? 0.14 : 0.08;
          if (a < grassP) blocks[up] = B.tall_grass;
          else if (a < grassP + 0.025) {
            const FL = b === BIOME.forest ? ['sunpetal', 'frostbell', 'poppy', 'dandelion', 'allium', 'lilac', 'peony', 'rose_bush']
              : b === BIOME.swamp ? ['blue_orchid', 'emberbloom', 'sunpetal'] : ['emberbloom', 'sunpetal', 'poppy', 'dandelion', 'azure_bluet', 'oxeye_daisy',
                'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'sunflower'];
            blocks[up] = B[FL[Math.floor(kind * FL.length)]];
          }
          else if (a < grassP + 0.035 && (b === BIOME.forest || b === BIOME.swamp)) blocks[up] = kind < 0.75 ? B.brown_mushroom : B.glowcap;
          else if (a < grassP + 0.0365 && b === BIOME.plains) blocks[up] = B.pumpkin;
          else if (a < grassP + 0.0385 && b === BIOME.plains) blocks[up] = kind < 0.33 ? B.carrots : kind < 0.66 ? B.potatoes : B.beetroots;
          else if (a < grassP + 0.04 && b === BIOME.plains) blocks[up] = B.melon;
          else if (a < grassP + 0.042 && b === BIOME.forest) blocks[up] = B.sweet_berry_bush;
          else if (a < grassP + 0.05 && b === BIOME.swamp) blocks[up] = B.bamboo;
          else if (h === SEA && a > 0.9) this.reeds(blocks, lx, h, lz, tall, x, z);
        } else if (ground === B.sand) {
          if (col.b === BIOME.desert) {
            if (a < 0.006) for (let k = 1; k <= 1 + Math.floor(tall * 3); k++) blocks[idx(lx, h + k, lz)] = B.cactus;
            else if (a < 0.016) blocks[up] = B.dead_bush;
          } else if (h === SEA && a > 0.88) this.reeds(blocks, lx, h, lz, tall, x, z);
        } else if (ground === B.snowy_grass && a < 0.006) blocks[up] = B.frostbell;
      }
    }
    reeds(blocks, lx, h, lz, tall, x, z) {
      if (this.column(x + 1, z).h < SEA || this.column(x - 1, z).h < SEA || this.column(x, z + 1).h < SEA || this.column(x, z - 1).h < SEA)
        for (let k = 1; k <= 1 + Math.floor(tall * 3); k++) blocks[idx(lx, h + k, lz)] = B.reeds;
    }

    trees(blocks, cx, cz) {
      const DENS = { [BIOME.forest]: 0.6, [BIOME.plains]: 0.04, [BIOME.snowy]: 0.22, [BIOME.mountains]: 0.1, [BIOME.swamp]: 0.22 };
      for (let ncx = cx - 1; ncx <= cx + 1; ncx++) for (let ncz = cz - 1; ncz <= cz + 1; ncz++) {
        const r = mulberry32(hash(this.seed, ncx, ncz, 7));
        for (let t = 0; t < 14; t++) {
          const lx = Math.floor(r() * 16), lz = Math.floor(r() * 16), roll = r(), kind = r(), hr = r();
          const x = ncx * 16 + lx, z = ncz * 16 + lz;
          if (!defs.inWorld(x, z)) continue;
          const col = this.column(x, z);
          if (!(roll < (DENS[col.b] || 0)) || col.h <= SEA || col.h > 96) continue;
          const top = this.surface(col, x, z).top;
          if (top !== B.grass && top !== B.snowy_grass) continue;
          let sp;
          if (col.b === BIOME.forest) sp = kind < 0.5 ? 'oak' : kind < 0.68 ? 'birch' : kind < 0.82 ? 'dark_oak' : kind < 0.93 ? 'jungle' : 'cherry';
          else if (col.b === BIOME.plains) sp = kind < 0.7 ? 'oak' : 'acacia';
          else if (col.b === BIOME.swamp) sp = 'swamp';
          else if (col.b === BIOME.mountains) sp = kind < 0.75 ? 'pine' : 'cherry';
          else sp = 'pine';
          this.tree(blocks, cx * 16, cz * 16, x, col.h + 1, z, sp, hr);
        }
      }
    }

    tree(blocks, ox, oz, x, y, z, sp, hr) {
      const set = (bx, by, bz, id, force) => {
        const lx = bx - ox, lz = bz - oz;
        if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || by < 1 || by >= HEIGHT) return;
        const i = idx(lx, by, lz), cur = blocks[i];
        if (force || cur === 0 || defs.BLOCKS[cur].replaceable && !defs.BLOCKS[cur].liquid) blocks[i] = id;
      };
      const rnd = (a, b, c) => (hash(this.seed, a, b, c) & 1023) / 1024;
      const wood = sp === 'swamp' ? 'mangrove' : sp;
      const log = B[wood + '_log'], leaf = B[wood + '_leaves'];
      if (sp === 'pine') {
        const th = 7 + Math.floor(hr * 4);
        for (let k = 0; k < th; k++) set(x, y + k, z, log, true);
        let rad = 0;
        for (let k = th + 1; k >= 3; k--) {
          const yy = y + k, rr = k >= th ? (k === th + 1 ? 0 : 1) : rad;
          for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
            if (Math.abs(dx) + Math.abs(dz) > rr + (rr > 1 ? 0 : 1) && rr > 0) continue;
            if (dx || dz || k >= th) set(x + dx, yy, z + dz, leaf);
          }
          if (k < th) rad = rad >= 3 || (rad === 2 && k < th - 2 && (k & 1)) ? 1 : rad + 1;
        }
        return;
      }
      const th = (sp === 'birch' ? 5 : 4) + Math.floor(hr * 3);
      const big = sp === 'swamp' || sp === 'dark_oak' || sp === 'jungle';
      for (let k = 0; k < th; k++) set(x, y + k, z, log, true);
      const topY = y + th;
      for (let yy = topY - 3; yy <= topY; yy++) {
        const rr = big ? (yy >= topY - 1 ? 2 : 3) : (yy >= topY - 1 ? 1 : 2);
        for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
          const corner = Math.abs(dx) === rr && Math.abs(dz) === rr;
          if (corner && (yy === topY || rnd(x + dx, yy, z + dz) < 0.5)) continue;
          if (yy === topY && rr === 1 && (dx && dz)) continue;
          set(x + dx, yy, z + dz, leaf);
        }
      }
      if (big) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        if ((Math.abs(dx) === 3 || Math.abs(dz) === 3) && rnd(x + dx, 9, z + dz) < 0.35) {
          const len = 1 + Math.floor(rnd(x + dx, 10, z + dz) * 3);
          for (let k = 1; k <= len; k++) set(x + dx, topY - 3 - k, z + dz, leaf);
        }
      }
    }

    // ---------- villages: at most one per 384x384 region, on flat plains, forest, desert or snow, never near spawn ----------
    villagePlan(gx, gz) {
      const key = gx + ',' + gz;
      if (!this.vcache) this.vcache = new Map();
      if (this.vcache.has(key)) return this.vcache.get(key);
      if (this.vcache.size > 4000) this.vcache.clear();
      const plan = this.makeVillage(gx, gz);
      this.vcache.set(key, plan);
      return plan;
    }
    makeVillage(gx, gz) {
      const VC = 384, r = mulberry32(hash(this.seed, gx, gz, 501));
      if (r() > 0.6) return null;
      const vx = gx * VC + 70 + Math.floor(r() * (VC - 140)), vz = gz * VC + 70 + Math.floor(r() * (VC - 140));
      if (Math.hypot(vx - defs.SPAWN_C, vz - defs.SPAWN_C) < 220) return null;
      const realm = defs.realmAt(vx, vz);
      if (!realm || realm.name !== 'overworld' || !defs.inWorld(vx - 60, vz - 60) || !defs.inWorld(vx + 60, vz + 60)) return null;
      const col = this.column(vx, vz);
      const style = { [BIOME.plains]: 'oak', [BIOME.forest]: 'birch', [BIOME.desert]: 'sand', [BIOME.snowy]: 'pine' }[col.b];
      if (!style || col.h <= SEA + 1 || col.h > 95) return null;
      let lo = col.h, hi = col.h;
      for (let a = 0; a < 12; a++) { const h = this.column(vx + Math.round(Math.cos(a * 0.52) * 22), vz + Math.round(Math.sin(a * 0.52) * 22)).h; lo = Math.min(lo, h); hi = Math.max(hi, h); }
      if (hi - lo > 14 || lo < SEA) return null;
      const v = { id: gx + ',' + gz, x: vx, z: vz, y: col.h, style, pieces: [], paths: [], lamps: [], people: [], x0: vx - 6, x1: vx + 6, z0: vz - 6, z1: vz + 6 };
      const rects = [[vx - 3, vz - 3, vx + 2, vz + 2]];
      const hits = (a) => rects.some(b => a[0] <= b[2] + 1 && a[2] >= b[0] - 1 && a[1] <= b[3] + 1 && a[3] >= b[1] - 1);
      const KINDS = ['house', 'farm', 'smith', 'library', 'butcher', 'house', 'farm', 'mason', 'shepherd', 'fisher', 'house', 'cleric'];
      let arms = 0;
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        if (arms >= 2 && r() < 0.25) continue;
        arms++;
        const L = 16 + Math.floor(r() * 16);
        v.paths.push([dx, dz, L]);
        const ex = vx + dx * L, ez = vz + dz * L;
        rects.push([Math.min(vx, ex) - 1, Math.min(vz, ez) - 1, Math.max(vx, ex) + 1, Math.max(vz, ez) + 1]);
        for (let s = 6; s <= L - 3; s += 10) v.lamps.push([vx + dx * s + dz * 2, vz + dz * s - dx * 2]);
        for (let s = 6; s + 3 <= L; s += 8) for (const side of [1, -1]) {
          if (r() < 0.3) continue;
          const kind = KINDS[Math.floor(r() * KINDS.length)];
          const [w, d] = kind === 'farm' ? [9, 7] : kind === 'house' && r() < 0.5 ? [7, 6] : [5, 5];
          const pxv = -dz * side, pzv = dx * side, off = 3 + Math.floor(d / 2);
          const ccx = vx + dx * (s + Math.floor(w / 2)) + pxv * off, ccz = vz + dz * (s + Math.floor(w / 2)) + pzv * off;
          const sx = dx !== 0 ? w : d, sz = dx !== 0 ? d : w;
          const rect = [ccx - Math.floor(sx / 2), ccz - Math.floor(sz / 2), ccx - Math.floor(sx / 2) + sx - 1, ccz - Math.floor(sz / 2) + sz - 1];
          if (hits(rect)) continue;
          const h = this.column(ccx, ccz).h;
          if (h <= SEA || Math.abs(h - col.h) > 7) continue;
          rects.push(rect);
          v.pieces.push({ kind, x0: rect[0], z0: rect[1], x1: rect[2], z1: rect[3], y: h, door: [-pxv, -pzv], seed: hash(this.seed, ccx, ccz, 77) });
        }
      }
      if (v.pieces.length < 2) return null;
      for (const p of v.pieces) {
        v.x0 = Math.min(v.x0, p.x0 - 1); v.x1 = Math.max(v.x1, p.x1 + 1); v.z0 = Math.min(v.z0, p.z0 - 1); v.z1 = Math.max(v.z1, p.z1 + 1);
        // one villager per building, standing outside its door (farms get a farmer)
        const mx = (p.x0 + p.x1) >> 1, mz = (p.z0 + p.z1) >> 1;
        const fx = p.door[0] > 0 ? p.x1 + 1 : p.door[0] < 0 ? p.x0 - 1 : mx, fz = p.door[1] > 0 ? p.z1 + 1 : p.door[1] < 0 ? p.z0 - 1 : mz;
        const prof = p.kind === 'house' ? ['farmer', 'fisher', 'shepherd', 'cleric', 'librarian'][p.seed % 5] : p.kind === 'farm' ? 'farmer' : p.kind === 'library' ? 'librarian' : p.kind;
        v.people.push({ id: v.id + ':' + v.people.length, type: 'villager', prof, x: fx, z: fz });
      }
      for (const [dx, dz, L] of v.paths) { const ex = vx + dx * L, ez = vz + dz * L; v.x0 = Math.min(v.x0, ex - 2); v.x1 = Math.max(v.x1, ex + 2); v.z0 = Math.min(v.z0, ez - 2); v.z1 = Math.max(v.z1, ez + 2); }
      if (v.pieces.length >= 4) v.people.push({ id: v.id + ':guard', type: 'bulwark', prof: '', x: vx + 3, z: vz + 3 });
      return v;
    }
    nearestVillage(x, z, cells = 4) {
      const VC = 384, gx0 = Math.floor(x / VC), gz0 = Math.floor(z / VC);
      let best = null, bd = Infinity;
      for (let gx = gx0 - cells; gx <= gx0 + cells; gx++) for (let gz = gz0 - cells; gz <= gz0 + cells; gz++) {
        const v = this.villagePlan(gx, gz);
        if (v) { const d = Math.hypot(v.x - x, v.z - z); if (d < bd) { bd = d; best = v; } }
      }
      return best;
    }
    villages(blocks, cx, cz, chests) {
      const VC = 384, ox = cx * 16, oz = cz * 16, out = [];
      for (let gx = Math.floor((ox - 60) / VC); gx <= Math.floor((ox + 76) / VC); gx++) for (let gz = Math.floor((oz - 60) / VC); gz <= Math.floor((oz + 76) / VC); gz++) {
        const v = this.villagePlan(gx, gz);
        if (!v || v.x1 < ox || v.x0 > ox + 15 || v.z1 < oz || v.z0 > oz + 15) continue;
        this.stampVillage(v, blocks, cx, cz, chests, out);
      }
      return out;
    }
    stampVillage(v, blocks, cx, cz, chests, out) {
      const ox = cx * 16, oz = cz * 16;
      const inC = (x, z) => x >= ox && x < ox + 16 && z >= oz && z < oz + 16;
      const put = (x, y, z, id) => { if (y > 0 && y < HEIGHT && inC(x, z)) blocks[idx(x - ox, y, z - oz)] = id; };
      const get = (x, y, z) => inC(x, z) && y >= 0 && y < HEIGHT ? blocks[idx(x - ox, y, z - oz)] : 0;
      const wood = v.style === 'sand' ? null : v.style;
      const M = wood ? { wall: B[wood + '_planks'], log: B[wood + '_log'], roof: B[(wood === 'birch' ? 'dark_oak' : wood) + '_planks'], cap: B[(wood === 'birch' ? 'dark_oak' : wood) + '_slab'], floor: B[wood + '_planks'], fence: B[wood + '_fence'] || B.oak_fence }
        : { wall: B.sandstone, log: B.sandstone, roof: B.sandstone, cap: B.sandstone, floor: B.sandstone, fence: B.oak_fence };
      const path = v.style === 'sand' ? B.sandstone : B.gravel;
      // solid ground under a footprint, open air above it
      const ground = (x, z, y, clear = 8) => {
        if (!inC(x, z)) return;
        for (let yy = y - 1; yy > Math.max(1, y - 8); yy--) { const b = defs.BLOCKS[get(x, yy, z)]; if (b.solid && b.opaque) break; put(x, yy, z, B.cobblestone); }
        for (let yy = y + 1; yy <= y + clear; yy++) put(x, yy, z, 0);
      };
      // paths and lamp posts
      for (const [dx, dz, L] of v.paths) for (let s = 0; s <= L; s++) for (let k = -1; k <= 1; k++) {
        const x = v.x + dx * s + (dz ? k : 0), z = v.z + dz * s + (dx ? k : 0);
        if (!inC(x, z)) continue;
        const h = this.column(x, z).h;
        if (h < SEA) put(x, SEA, z, M.floor); else put(x, h, z, path);
        for (let yy = Math.max(h, SEA) + 1; yy <= Math.max(h, SEA) + 3; yy++) put(x, yy, z, 0);
      }
      for (const [x, z] of v.lamps) {
        if (!inC(x, z)) continue;
        const h = this.column(x, z).h;
        if (h < SEA) continue;
        put(x, h + 1, z, M.fence); put(x, h + 2, z, M.fence); put(x, h + 3, z, B.torch);
      }
      // the well in the middle
      for (let x = v.x - 2; x <= v.x + 1; x++) for (let z = v.z - 2; z <= v.z + 1; z++) {
        const edge = x === v.x - 2 || x === v.x + 1 || z === v.z - 2 || z === v.z + 1, corner = (x === v.x - 2 || x === v.x + 1) && (z === v.z - 2 || z === v.z + 1);
        ground(x, z, v.y, 6);
        if (edge) { put(x, v.y, z, B.cobblestone); put(x, v.y + 1, z, B.cobblestone); if (corner) { put(x, v.y + 2, z, M.fence); put(x, v.y + 3, z, M.fence); } }
        else for (let y = v.y - 3; y <= v.y; y++) put(x, y, z, B.water);
        put(x, v.y + 4, z, M.cap);
      }
      for (const p of v.pieces) {
        if (p.x1 < ox || p.x0 > ox + 15 || p.z1 < oz || p.z0 > oz + 15) continue;
        const y = p.y;
        if (p.kind === 'farm') {
          const long = p.x1 - p.x0 >= p.z1 - p.z0;
          const mid = long ? (p.z0 + p.z1) >> 1 : (p.x0 + p.x1) >> 1;
          const crops = [B.wheat_3, B.wheat_2, B.carrots, B.potatoes, B.beetroots].filter(c => c != null);
          for (let x = p.x0; x <= p.x1; x++) for (let z = p.z0; z <= p.z1; z++) {
            ground(x, z, y, 4);
            const edge = x === p.x0 || x === p.x1 || z === p.z0 || z === p.z1;
            if (edge) { put(x, y, z, M.log === B.sandstone ? B.sandstone : M.log); continue; }
            if ((long ? z : x) === mid) { put(x, y, z, B.water); continue; }
            put(x, y, z, B.farmland);
            put(x, y + 1, z, crops[(p.seed + (long ? x : z)) % crops.length]);
          }
          continue;
        }
        // a house: floor, log corners, plank walls with windows, a stepped roof, a door facing the path
        const mx = (p.x0 + p.x1) >> 1, mz = (p.z0 + p.z1) >> 1;
        const dX = p.door[0] > 0 ? p.x1 : p.door[0] < 0 ? p.x0 : mx, dZ = p.door[1] > 0 ? p.z1 : p.door[1] < 0 ? p.z0 : mz;
        for (let x = p.x0; x <= p.x1; x++) for (let z = p.z0; z <= p.z1; z++) {
          ground(x, z, y, 9);
          const ex = x === p.x0 || x === p.x1, ez = z === p.z0 || z === p.z1, edge = ex || ez, corner = ex && ez;
          put(x, y, z, edge ? B.cobblestone : M.floor);
          if (edge) for (let yy = y + 1; yy <= y + 3; yy++) put(x, yy, z, corner ? M.log : M.wall);
          put(x, y + 4, z, M.roof);
          if (!edge) put(x, y + 5, z, M.cap);
        }
        // windows in the middle of the three other walls
        for (const [wx, wz] of [[mx, p.z0], [mx, p.z1], [p.x0, mz], [p.x1, mz]]) if (!(wx === dX && wz === dZ)) put(wx, y + 2, wz, B.glass);
        put(dX, y + 1, dZ, B.oak_door); put(dX, y + 2, dZ, B.oak_door);
        put(dX + p.door[0], y, dZ + p.door[1], path); put(dX + p.door[0], y + 1, dZ + p.door[1], 0); put(dX + p.door[0], y + 2, dZ + p.door[1], 0);
        // furniture in the inside corners: far from the door a bed and the job block, near the door a chest and a torch
        const ins = [[p.x0 + 1, p.z0 + 1], [p.x1 - 1, p.z0 + 1], [p.x0 + 1, p.z1 - 1], [p.x1 - 1, p.z1 - 1]]
          .sort((a, b) => Math.hypot(b[0] - dX, b[1] - dZ) - Math.hypot(a[0] - dX, a[1] - dZ));
        const job = { smith: B.furnace, butcher: B.furnace, library: B.bookshelf, mason: B.stone_bricks, shepherd: B.wool, farm: B.hay_bale, fisher: B.barrel || B.chest, cleric: B.lantern }[p.kind] || B.workbench;
        put(ins[0][0], y + 1, ins[0][1], B.bed);
        put(ins[1][0], y + 1, ins[1][1], job);
        put(ins[2][0], y + 1, ins[2][1], B.chest);
        put(ins[3][0], y + 1, ins[3][1], B.torch);
        if (inC(ins[2][0], ins[2][1])) chests.push({ x: ins[2][0], y: y + 1, z: ins[2][1], seed: p.seed, kind: 'village' });
      }
      if (inC(v.x, v.z)) for (const q of v.people) out.push(Object.assign({}, q, { y: Math.max(this.column(q.x, q.z).h, SEA) + 1, hx: v.x, hz: v.z }));
    }
    ruins(blocks, cols, cx, cz, chests) {
      const r = mulberry32(hash(this.seed, cx, cz, 31));
      if (r() > 0.03) return;
      const col = cols[8 * 16 + 8], h = col.h;
      if (h <= SEA || h > 95 || col.b === BIOME.river) return;
      const desert = col.b === BIOME.desert;
      const mats = desert ? [B.sandstone, B.sandstone, B.sand] : [B.stone_bricks, B.mossy_stone_bricks, B.mossy_cobblestone, B.cobblestone];
      const pick = () => mats[Math.floor(r() * mats.length)];
      for (let lx = 4; lx <= 12; lx++) for (let lz = 4; lz <= 12; lz++) {
        const edge = lx === 4 || lx === 12 || lz === 4 || lz === 12;
        for (let y = cols[lz * 16 + lx].h; y < h; y++) blocks[idx(lx, y, lz)] = pick();
        blocks[idx(lx, h, lz)] = pick();
        for (let y = h + 1; y <= h + 6; y++) blocks[idx(lx, y, lz)] = 0;
        if (edge) {
          const wh = (lx + lz) % 4 === 0 ? 4 : Math.floor(r() * 4);
          const door = (lx === 8 && (lz === 4 || lz === 12));
          for (let y = h + 1; y <= h + wh; y++) if (!door || y > h + 2) blocks[idx(lx, y, lz)] = pick();
        }
      }
      blocks[idx(8, h + 1, 8)] = B.chest;
      blocks[idx(6, h + 1, 6)] = B.torch; blocks[idx(10, h + 1, 10)] = B.torch;
      chests.push({ x: cx * 16 + 8, y: h + 1, z: cz * 16 + 8, seed: hash(this.seed, cx, cz, 32), kind: desert ? 'desert' : 'ruin' });
    }
  }

  // A 4-wide, 5-tall gate frame facing +z/-z centred on x, with portal blocks filling the 2x3 inside.
  function portalFrame(put, x, y, z, frame, fill) {
    for (let dx = -1; dx <= 2; dx++) for (let dy = 0; dy <= 4; dy++) {
      const edge = dx === -1 || dx === 2 || dy === 0 || dy === 4;
      put(x + dx, y + dy, z, edge ? frame : fill);
    }
  }

  return { Generator, portalFrame };
});
