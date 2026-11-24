'use strict';
// Block storage on the server: lazily generated chunks plus a log of every block change (for the viewer and replays).
const defs = require('../shared/defs');
const { Generator } = require('../shared/worldgen');
const { mulberry32 } = require('../shared/noise');
const { B, BLOCKS, HEIGHT, inWorld, realmOfChunk, ckey, ckx, ckz } = defs;
const SIZE = 512; // the old island size; only used to read saves from before the big world
// a block position as a key: "x,y,z" (numbers can't hold every block of a 60-million-wide world)
const pk = (x, y, z) => x + ',' + y + ',' + z;
const unpk = k => { const a = k.split(','); return [+a[0], +a[1], +a[2]]; };
const legacyUnpk = k => { const y = k % HEIGHT, r = (k - y) / HEIGHT; return [Math.floor(r / SIZE), y, r % SIZE]; };

const LOOT = {
  ruin: [['bread', 1, 3, 0.7], ['coal', 2, 8, 0.6], ['iron_ingot', 1, 4, 0.5], ['copper_ingot', 2, 5, 0.4], ['gold_ingot', 1, 3, 0.25], ['sapphire', 1, 2, 0.15],
    ['apple', 1, 3, 0.4], ['arrow', 2, 8, 0.3], ['bow', 1, 1, 0.12], ['iron_sword', 1, 1, 0.08], ['iron_pickaxe', 1, 1, 0.06], ['seeds', 2, 6, 0.4],
    ['book', 1, 2, 0.2], ['bone', 1, 4, 0.4], ['torch', 2, 8, 0.4], ['hide', 1, 3, 0.3], ['iron_helmet', 1, 1, 0.06], ['glow_dust', 1, 4, 0.2]],
};
LOOT.ember = [['ember_shard', 2, 6, 0.7], ['ember_rod', 1, 2, 0.5], ['gold_ingot', 2, 6, 0.6], ['obsidian', 2, 6, 0.4], ['flint_and_steel', 1, 1, 0.2],
  ['golden_apple', 1, 1, 0.15], ['iron_ingot', 2, 5, 0.5], ['emberite_sword', 1, 1, 0.05], ['sapphire', 1, 2, 0.2], ['ember_pepper', 1, 3, 0.4]];
LOOT.village = [['bread', 1, 4, 0.7], ['wheat', 2, 8, 0.5], ['apple', 1, 3, 0.4], ['emerald', 1, 3, 0.35], ['iron_ingot', 1, 3, 0.25], ['seeds', 2, 6, 0.5],
  ['carrot', 1, 4, 0.4], ['potato', 1, 4, 0.4], ['coal', 1, 4, 0.3], ['torch', 2, 6, 0.4], ['book', 1, 2, 0.15], ['wool', 1, 3, 0.25], ['saddle', 1, 1, 0.05]];
LOOT.desert = LOOT.ruin.concat([['gold_ingot', 1, 4, 0.3], ['sapphire', 1, 1, 0.1]]);

class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.gen = new Generator(this.seed);
    this.chunks = new Map();
    this.changes = [];          // [tick, x, y, z, id]
    this.containers = new Map(); // pk -> stacks
    this.emitters = new Map();   // chunk key -> Set(pk)
    this.crops = new Set();
    this.saplings = new Set();
    this.placed = new Set();     // pk of blocks players put down (mine skips them)
    this.tick = 0;
    this.edited = new Set();
    this.villagersSpawned = new Set(); // villager ids already out in the world (so reloading a chunk doesn't duplicate them)     // chunk keys with player changes: these stay in memory
    this.onChunk = null;
  }
  inBounds(x, z) { return inWorld(x, z); }
  chunk(cx, cz) {
    if (!realmOfChunk(cx, cz)) return null;
    const k = ckey(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = this.gen.chunk(cx, cz);
      c.used = this.tick;
      this.chunks.set(k, c);
      const em = new Set();
      for (let i = 0; i < c.blocks.length; i++) if (BLOCKS[c.blocks[i]].light) em.add(pk(cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)));
      this.emitters.set(k, em);
      // reloaded chunks keep their (maybe looted) chests
      for (const ch of c.chests) { const ck = pk(ch.x, ch.y, ch.z); if (!this.containers.has(ck)) this.containers.set(ck, this.loot(ch)); }
      if (this.onChunk) this.onChunk(c);
    }
    return c;
  }
  // forget unchanged chunks far from every player; they regenerate exactly the same if anyone comes back
  unloadFar(players, keep = 12) {
    const near = players.filter(p => !p.dead).map(p => [Math.floor(p.x) >> 4, Math.floor(p.z) >> 4]);
    let n = 0;
    for (const k of this.chunks.keys()) {
      if (this.edited.has(k)) continue;
      const cx = ckx(k), cz = ckz(k);
      if (near.some(([px, pz]) => Math.abs(px - cx) <= keep && Math.abs(pz - cz) <= keep)) continue;
      this.chunks.delete(k); this.emitters.delete(k); n++;
    }
    return n;
  }
  loot(ch) {
    const r = mulberry32(ch.seed), out = [];
    for (const [name, a, b, p] of LOOT[ch.kind] || LOOT.ruin) if (r() < p) out.push({ id: name, n: a + Math.floor(r() * (b - a + 1)) });
    return out;
  }
  get(x, y, z) {
    if (y < 0) return B.bedrock;
    if (y >= HEIGHT) return 0;
    if (!inWorld(x, z)) return B.bedrock;
    return this.chunk(x >> 4, z >> 4).blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
  }
  def(x, y, z) { return BLOCKS[this.get(x, y, z)]; }
  solid(x, y, z) { return BLOCKS[this.get(x, y, z)].solid; }
  set(x, y, z, id) {
    if (y < 0 || y >= HEIGHT || !this.inBounds(x, z)) return false;
    const c = this.chunk(x >> 4, z >> 4), i = (y << 8) | ((z & 15) << 4) | (x & 15), old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    this.changes.push([this.tick, x, y, z, id]);
    const k = pk(x, y, z), ck = ckey(x >> 4, z >> 4);
    this.edited.add(ck);
    const ob = BLOCKS[old], nb = BLOCKS[id];
    if (ob.light) this.emitters.get(ck).delete(k);
    if (nb.light) this.emitters.get(ck).add(k);
    if (ob.crop !== undefined) this.crops.delete(k);
    if (nb.crop !== undefined && nb.crop < 3) this.crops.add(k);
    if (ob.sapling) this.saplings.delete(k);
    if (!id) this.placed.delete(k);
    if (nb.sapling) this.saplings.add(k);
    if (old === B.chest && id !== B.chest) this.containers.delete(k);
    return true;
  }
  height(x, z) {
    for (let y = HEIGHT - 1; y > 0; y--) { const b = BLOCKS[this.get(x, y, z)]; if (b.solid || b.liquid) return y; }
    return 0;
  }
  skyExposed(x, y, z) {
    for (let yy = y; yy < HEIGHT; yy++) { const b = BLOCKS[this.get(x, yy, z)]; if (b.opaque || b.filter || b.render === 'leaves') return false; }
    return true;
  }
  // brightest block light reaching (x,y,z), ignoring walls (good enough for mob spawning)
  blockLight(x, y, z) {
    let best = 0;
    for (let cx = (x >> 4) - 1; cx <= (x >> 4) + 1; cx++) for (let cz = (z >> 4) - 1; cz <= (z >> 4) + 1; cz++) {
      const em = this.emitters.get(ckey(cx, cz));
      if (!em) continue;
      for (const k of em) {
        const [ex, ey, ez] = unpk(k);
        const l = BLOCKS[this.get(ex, ey, ez)].light - (Math.abs(ex - x) + Math.abs(ey - y) + Math.abs(ez - z));
        if (l > best) best = l;
      }
    }
    return best;
  }
  exposed(x, y, z) {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (!BLOCKS[this.get(x + dx, y + dy, z + dz)].opaque) return true;
    return false;
  }
}

module.exports = { World, pk, unpk, legacyUnpk, SIZE };
