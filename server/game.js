'use strict';
// The simulation: 20 ticks per second. Entities, physics, mobs, survival, combat, items, explosions, spawning, time and weather.
const defs = require('../shared/defs');
const { World, pk, unpk, SIZE } = require('./world');
const { findPath } = require('./path');
const { mulberry32 } = require('../shared/noise');
const { B, BLOCKS, ITEMS, MOBS, HEIGHT, SEA, BIOMES, BIOME, RECIPES } = defs;

const TPS = 20, DT = 1 / TPS;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const r2 = v => Math.round(v * 100) / 100;

const DEFAULTS = {
  dayLength: 600,      // seconds per full day/night cycle
  hunger: 0.6,         // hunger speed multiplier
  pvp: false,
  callCap: 240,        // max game seconds one AI command call runs before reporting back
  smeltSec: 2,
  mobCap: 6,           // hostile mobs per player
  passiveCap: 70,
  keepInventory: false,
  goal: 'Survive and thrive: gather, craft better tools, tame a pet, open the gate to the Emberdeep, reach the Skyreach and defeat the Stormwarden together, and build a great base along the way.',
  days: 0,             // 0 = no limit
};

const COLORS = ['#e8553b', '#3b8fe8', '#4cc46a', '#e8c13b', '#b05ae8', '#e8883b', '#3bd6d0', '#e85fa8', '#9aa3ad', '#7a5a3a', '#1f6f4a', '#c7e83b', '#5a5ae8', '#e83b6c', '#ffffff', '#2a2a2a'];
const DEATH = { fall: 'fell from a high place', drown: 'drowned', lava: 'tried to swim in lava', fire: 'burned to death', starve: 'starved to death',
  cactus: 'was pricked to death', void: 'fell out of the world', suffocate: 'suffocated in a wall' };

class Game {
  constructor(opts = {}) {
    this.config = Object.assign({}, DEFAULTS, opts.config || {});
    this.seed = (opts.seed != null ? opts.seed : Math.floor(Math.random() * 2 ** 31)) >>> 0;
    this.id = opts.id || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.world = new World(this.seed);
    this.rng = mulberry32(this.seed ^ 0x9e3779b9);
    this.tick = 0;
    this.dayTicks = Math.round(this.config.dayLength * TPS);
    this.clock = Math.round(this.dayTicks * 0.02);
    this.entities = new Map();
    this.nextId = 1;
    this.players = [];
    this.chat = [];
    this.log = [];           // [t, event] for viewer/replay
    this.logStart = 0;
    this.updates = [];
    this.decay = [];
    this.furnaces = new Map();
    this.weather = { rain: false, next: Math.round(TPS * 60 * (4 + this.rng() * 6)) };
    this.over = null;
    this.milestones = new Set();
    this.spawn = this.findSpawn();
    this.world.onChunk = c => this.onChunk(c);
    this.rec = { frames: [], last: new Map(), n: 0 };
    this.tasks = require('./tasks');
  }

  // ---------- time ----------
  get t() { return this.tick / TPS; }
  tod() { return (this.clock % this.dayTicks) / this.dayTicks; } // 0 sunrise, .25 noon, .5 sunset, .75 midnight
  day() { return Math.floor(this.clock / this.dayTicks) + 1; }
  isDay() { const t = this.tod(); return t < 0.52 || t > 0.97; }
  clockText() {
    const t = this.tod(), mins = Math.floor(((t * 24 + 6) % 24) * 60);
    const hh = Math.floor(mins / 60), mm = mins % 60;
    const phase = t < 0.08 ? 'dawn' : t < 0.2 ? 'morning' : t < 0.32 ? 'midday' : t < 0.46 ? 'afternoon' : t < 0.54 ? 'dusk' : t < 0.96 ? 'NIGHT' : 'dawn';
    let until;
    if (this.isDay()) { const left = ((0.52 - t + 1) % 1) * this.config.dayLength; until = `night in ${Math.round(left / 60 * 10) / 10}m`; }
    else { const left = ((0.97 - t + 1) % 1) * this.config.dayLength; until = `sunrise in ${Math.round(left / 60 * 10) / 10}m`; }
    return `Day ${this.day()} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} (${phase}, ${until})`;
  }

  event(ev) { this.log.push([r2(this.t), ev]); }

  findSpawn() {
    const g = this.world.gen, c = defs.SPAWN_C;
    for (let r = 0; r < 200; r += 3) for (let a = 0; a < 24; a++) {
      const x = Math.round(c + Math.cos(a / 24 * Math.PI * 2) * r), z = Math.round(c + Math.sin(a / 24 * Math.PI * 2) * r);
      const col = g.column(x, z);
      if ((col.b === BIOME.plains || col.b === BIOME.forest) && col.h > SEA + 1 && col.h < 80) {
        const h = this.world.height(x, z);
        if (this.world.get(x, h, z) === B.grass) return { x: x + 0.5, y: h + 1, z: z + 0.5 };
      }
    }
    return { x: c + 0.5, y: this.world.height(c, c) + 1, z: c + 0.5 };
  }

  // ---------- entities ----------
  add(e) {
    e.id = this.nextId++;
    Object.assign(e, { vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, mx: 0, mz: 0, speedNow: 0, yaw: e.yaw || 0, pitch: 0, onGround: false, fallStart: e.y,
      invuln: 0, hurtT: 0, swingT: 0, fire: 0, age: 0, dead: false }, e);
    this.entities.set(e.id, e);
    return e;
  }
  spawnMob(type, x, y, z, size) {
    const d = MOBS[type];
    let w = d.w, h = d.h, hp = d.hp;
    if (d.splits) { size = size || 3; const s = size / 3; w = Math.max(0.5, d.w * s); h = Math.max(0.45, d.h * s); hp = size === 3 ? 16 : size === 2 ? 6 : 2; }
    return this.add({ kind: 'mob', type, x, y, z, w, h, hp, maxHp: hp, size, speed: d.speed, autoJump: true, yaw: this.rng() * 6.28,
      ai: { wanderT: 0, cd: 0, panic: 0, angry: 0, target: null, fuse: 0, path: null, pathI: 0, repath: 0, home: null, shed: 2400 + this.rng() * 4800 } });
  }
  dropItem(x, y, z, id, n = 1, o = {}) {
    if (!ITEMS[id] || n <= 0) return null;
    return this.add({ kind: 'item', item: id, n, dur: o.dur, x, y, z, w: 0.25, h: 0.25, vx: (this.rng() - 0.5) * 2, vy: 3, vz: (this.rng() - 0.5) * 2,
      pickup: o.pickup != null ? o.pickup : 10, magnet: o.magnet || null, life: 6000 });
  }

  // ---------- inventory ----------
  count(p, key) { let n = 0; for (const s of p.inv) if (defs.inGroup(s.id, key)) n += s.n; return n; }
  give(p, id, n = 1, dur) {
    const it = ITEMS[id];
    if (!it) return n;
    if (it.stack > 1) for (const s of p.inv) if (s.id === id && s.n < it.stack) { const k = Math.min(n, it.stack - s.n); s.n += k; n -= k; if (!n) break; }
    while (n > 0 && p.inv.length < 36) {
      const k = Math.min(n, it.stack);
      p.inv.push({ id, n: k, dur: it.tool ? (dur != null ? dur : it.tool.dur) : it.armor ? (dur != null ? dur : it.armor.dur) : undefined });
      n -= k;
    }
    if (it.armor) this.autoArmor(p);
    const key = p.id + ':' + id;
    if (MILESTONE.has(id) && !this.milestones.has(key)) { this.milestones.add(key); this.event({ type: 'milestone', id: p.id, name: p.name, item: id }); p.notes.push(`Milestone: first ${ITEMS[id].label}!`); }
    return n;
  }
  take(p, key, n) {
    const out = [];
    for (let i = p.inv.length - 1; i >= 0 && n > 0; i--) {
      const s = p.inv[i];
      if (!defs.inGroup(s.id, key)) continue;
      const k = Math.min(n, s.n);
      s.n -= k; n -= k; out.push([s.id, k]);
      if (s.n <= 0) { p.inv.splice(i, 1); if (p.held === s) p.held = null; }
    }
    return out;
  }
  removeStack(p, s) { const i = p.inv.indexOf(s); if (i >= 0) p.inv.splice(i, 1); if (p.held === s) p.held = null; }
  armorPoints(p) { let a = 0; for (const s of p.armor) if (s) a += ITEMS[s.id].armor.pts; return a; }
  autoArmor(p) {
    for (const s of p.inv.slice()) {
      const a = ITEMS[s.id].armor;
      if (!a) continue;
      const cur = p.armor[a.slot];
      if (!cur || ITEMS[cur.id].armor.pts < a.pts) {
        this.removeStack(p, s);
        p.armor[a.slot] = s;
        if (cur) p.inv.push(cur);
        p.notes.push(`Equipped ${ITEMS[s.id].label}`);
      }
    }
  }
  useTool(p, s, amt = 1) {
    if (!s || s.dur == null) return;
    s.dur -= amt;
    if (s.dur <= 0) { this.removeStack(p, s); p.notes.push(`Your ${ITEMS[s.id].label} broke!`); this.event({ type: 'toolbreak', id: p.id, item: s.id }); }
  }

  // ---------- mining ----------
  canHarvest(s, b) {
    if (!b.tier) return true;
    const t = s && ITEMS[s.id].tool;
    return !!(t && t.type === b.tool && t.level >= b.tier);
  }
  breakTicks(s, id) {
    const b = BLOCKS[id];
    if (b.hardness < 0) return Infinity;
    if (b.hardness === 0) return 1;
    const t = s && ITEMS[s.id].tool;
    const speed = t && t.type === b.tool ? t.speed : 1;
    return Math.ceil(1 / (speed / b.hardness / (this.canHarvest(s, b) ? 30 : 100)));
  }
  bestTool(p, id) {
    const b = BLOCKS[id];
    let best = null, bt = this.breakTicks(null, id);
    for (const s of p.inv) {
      const t = ITEMS[s.id].tool;
      if (!t || t.type !== b.tool) continue;
      const k = this.breakTicks(s, id);
      if (k < bt || (k === bt && best && ITEMS[best.id].tool.level > t.level)) { best = s; bt = k; }
    }
    return best;
  }
  digCost(p, id) {
    const b = BLOCKS[id];
    if (b.hardness < 0 || b.liquid || b.name === 'chest' || b.name === 'furnace' || b.name === 'furnace_lit' || b.name === 'workbench' || b.bed || b.explosive) return Infinity;
    const t = this.breakTicks(this.bestTool(p, id), id);
    return t > 160 ? Infinity : t;
  }
  blockDrops(b, s) {
    if (!this.canHarvest(s, b) || !b.drop) return [];
    if (typeof b.drop === 'string') return [[b.drop, 1]];
    const out = [];
    for (const d of b.drop) {
      if (d.chance != null && this.rng() >= d.chance) continue;
      const n = d.n ? d.n[0] + Math.floor(this.rng() * (d.n[1] - d.n[0] + 1)) : 1;
      if (n > 0) out.push([d.item, n]);
      if (d.only) break;
    }
    return out;
  }
  breakBlock(p, x, y, z) {
    const id = this.world.get(x, y, z), b = BLOCKS[id];
    if (!id || b.hardness < 0) return false;
    const s = p ? this.bestTool(p, id) : null;
    this.setBlock(x, y, z, 0);
    this.event({ type: 'break', x, y, z, b: id });
    if (b.explosive) { this.prime(x, y, z); return true; }
    const k = pk(x, y, z);
    if (id === B.chest && this.world.containers.has(k)) { for (const st of this.world.containers.get(k)) this.dropItem(x + 0.5, y + 0.5, z + 0.5, st.id, st.n, { dur: st.dur }); this.world.containers.delete(k); }
    for (const [item, n] of this.blockDrops(b, s)) this.dropItem(x + 0.5, y + 0.4, z + 0.5, item, n, { magnet: p ? p.id : null });
    if (p) {
      if (s) this.useTool(p, s);
      p.exh += 0.005 * this.config.hunger;
      p.stats.mined[b.name] = (p.stats.mined[b.name] || 0) + 1;
      p.swingT = 6;
    }
    return true;
  }
  // set a block and run follow-up updates (falling sand, plants losing support, leaf decay)
  setBlock(x, y, z, id) {
    const old = this.world.get(x, y, z);
    if (!this.world.set(x, y, z, id)) return false;
    if (!BLOCKS[id].solid) this.updates.push([x, y + 1, z]);
    if (BLOCKS[old].group === 'log') this.scheduleDecay(x, y, z);
    if (this.updates.length && !this.updating) {
      this.updating = true;
      for (let guard = 0; this.updates.length && guard < 400; guard++) this.blockUpdate(...this.updates.shift());
      this.updates.length = 0; this.updating = false;
    }
    return true;
  }
  blockUpdate(x, y, z) {
    const id = this.world.get(x, y, z), b = BLOCKS[id];
    if (!id) return;
    const below = BLOCKS[this.world.get(x, y - 1, z)];
    if (b.gravity && !below.solid) {
      this.world.set(x, y, z, 0);
      this.updates.push([x, y + 1, z]);
      this.add({ kind: 'falling', block: id, x: x + 0.5, y, z: z + 0.5, w: 0.98, h: 0.98 });
    } else if (b.support && !below.solid) {
      this.world.set(x, y, z, 0);
      this.updates.push([x, y + 1, z]);
      this.event({ type: 'break', x, y, z, b: id });
      for (const [item, n] of this.blockDrops(b, null)) this.dropItem(x + 0.5, y + 0.3, z + 0.5, item, n);
    }
  }
  scheduleDecay(x, y, z) {
    for (let dx = -4; dx <= 4; dx++) for (let dy = -3; dy <= 5; dy++) for (let dz = -4; dz <= 4; dz++) {
      const b = BLOCKS[this.world.get(x + dx, y + dy, z + dz)];
      if (b.decays) this.decay.push([this.tick + 20 + Math.floor(this.rng() * 160), x + dx, y + dy, z + dz]);
    }
  }
  logNear(x, y, z) {
    for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++)
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= 6 && BLOCKS[this.world.get(x + dx, y + dy, z + dz)].group === 'log') return true;
    return false;
  }
  canPlaceAt(x, y, z, id) {
    const w = this.world, cur = w.def(x, y, z), b = BLOCKS[id];
    if (!cur.replaceable) return 'that spot is occupied by ' + cur.name;
    if (y < 1 || y >= HEIGHT - 1) return 'out of the world';
    const below = w.def(x, y - 1, z);
    if (b.crop !== undefined && below.name !== 'farmland') return 'seeds need farmland (use: farm)';
    if (b.sapling || b.render === 'cross') { if (!['grass', 'dirt', 'farmland', 'snowy_grass', 'sand'].includes(below.name)) return 'plants need soil below'; }
    if (b.name === 'cactus' && below.name !== 'sand' && below.name !== 'cactus') return 'cactus needs sand';
    if (b.support && !below.solid) return 'needs a solid block below';
    let touching = false;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const n = w.def(x + dx, y + dy, z + dz); if (n.solid || n.liquid) touching = true; }
    if (!touching) return 'nothing to attach it to';
    if (b.solid) for (const e of this.entities.values()) {
      if (e.dead || (e.kind !== 'player' && e.kind !== 'mob')) continue;
      if (e.x + e.w / 2 > x && e.x - e.w / 2 < x + 1 && e.z + e.w / 2 > z && e.z - e.w / 2 < z + 1 && e.y + e.h > y && e.y < y + b.height) return (e.kind === 'player' ? e.name : MOBS[e.type].label) + ' is in the way';
    }
    return null;
  }
  placeBlock(p, x, y, z, name) {
    const it = ITEMS[name];
    if (!it) return `unknown item ${name}`;
    const id = it.block != null ? it.block : it.places ? B[it.places] : null;
    if (id == null) return `${name} can't be placed`;
    if (this.count(p, name) < 1) return `you have no ${name}`;
    const err = this.canPlaceAt(x, y, z, id);
    if (err) return err;
    this.take(p, name, 1);
    if (name === 'water_bucket' || name === 'lava_bucket') this.give(p, 'bucket', 1);
    this.setBlock(x, y, z, id);
    this.world.placed.add(pk(x, y, z));
    if (id === B.chest) this.world.containers.set(pk(x, y, z), []);
    this.event({ type: 'place', x, y, z, b: id, id: p.id });
    p.swingT = 6;
    p.stats.placed = (p.stats.placed || 0) + 1;
    return null;
  }

  // ---------- explosions ----------
  prime(x, y, z) { this.add({ kind: 'primed', block: B.blast_barrel, x: x + 0.5, y, z: z + 0.5, w: 0.98, h: 0.98, fuse: 60 }); }
  explode(x, y, z, power, src) {
    this.event({ type: 'explode', x: r2(x), y: r2(y), z: r2(z), p: power });
    const r = Math.ceil(power);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > power + 0.3) continue;
      const bx = Math.floor(x + dx), by = Math.floor(y + dy), bz = Math.floor(z + dz), id = this.world.get(bx, by, bz), b = BLOCKS[id];
      if (!id || b.liquid || b.hardness < 0 || b.hardness >= 40) continue;
      if (this.rng() > 1.15 - d / (power + 0.3) * 0.6) continue;
      if (b.explosive) { this.setBlock(bx, by, bz, 0); this.add({ kind: 'primed', block: id, x: bx + 0.5, y: by, z: bz + 0.5, w: 0.98, h: 0.98, fuse: 10 + Math.floor(this.rng() * 20) }); continue; }
      this.setBlock(bx, by, bz, 0);
      if (this.rng() < 0.3) for (const [item, n] of this.blockDrops(b, null)) this.dropItem(bx + 0.5, by + 0.5, bz + 0.5, item, n);
    }
    for (const e of this.entities.values()) {
      if (e.dead || e === src || (e.kind !== 'player' && e.kind !== 'mob' && e.kind !== 'item')) continue;
      const dx = e.x - x, dy = e.y + e.h / 2 - y, dz = e.z - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > power * 2) continue;
      const f = 1 - d / (power * 2);
      if (e.kind === 'item') { if (d < power) e.life = 0; continue; }
      this.damage(e, Math.round(f * (power * 5 + 2)), 'explosion', src, 0);
      const n = d || 1;
      e.kx += dx / n * f * 14; e.kz += dz / n * f * 14; e.vy += f * 7;
    }
  }

  // ---------- combat ----------
  damage(e, amt, cause, src, kb = 1) {
    if (e.dead || amt <= 0) return false;
    if (e.invuln > 0 && cause !== 'void' && cause !== 'starve' && cause !== 'drown') return false;
    if (e.kind === 'player') {
      if (e.sleeping) e.sleeping = false;
      if (['mob', 'player', 'explosion', 'projectile', 'lava', 'fire'].includes(cause)) {
        amt *= 1 - Math.min(22, this.armorPoints(e)) * 0.04;
        if ((cause === 'fire' || cause === 'lava') && e.armor.some(s => s && /^emberite_/.test(s.id))) amt *= 0.35;
        const sh = (cause === 'mob' || cause === 'projectile' || cause === 'explosion') && e.inv.find(s => s.id === 'shield');
        if (sh) { amt *= 1 - ITEMS.shield.shield.block; sh.dur = (sh.dur == null ? ITEMS.shield.shield.dur : sh.dur) - 1; if (sh.dur <= 0) { this.removeStack(e, sh); e.notes.push('Your Shield broke!'); } }
        if (cause !== 'fire' && cause !== 'lava') for (const s of e.armor) if (s) { s.dur -= 1; if (s.dur <= 0) { e.armor[e.armor.indexOf(s)] = null; e.notes.push(`Your ${ITEMS[s.id].label} broke!`); } }
      }
      e.lastHurt = { t: this.tick, cause, by: src && (src.owner != null ? src.owner : src.id), amt };
      e.callHurt = (e.callHurt || 0) + amt;
    }
    if (e.kind === 'mob' && MOBS[e.type].fireproof && (cause === 'fire' || cause === 'lava')) { e.fire = 0; return false; }
    if (e.kind === 'mob' && src) e.lastHurtBy = { id: src.owner != null ? src.owner : src.id, t: this.tick };
    if (e.kind === 'mob' && e.tamer != null && src && (src.id === e.tamer || src.owner === e.tamer)) return false; // owners can't hurt their own pets
    e.hp -= amt;
    e.invuln = 10; e.hurtT = 8;
    if (src && src.x != null && kb) {
      const dx = e.x - src.x, dz = e.z - src.z, n = Math.hypot(dx, dz) || 1;
      e.kx = dx / n * 6 * kb; e.kz = dz / n * 6 * kb;
      if (e.onGround) e.vy = 5 * kb;
    }
    this.event({ type: 'hurt', id: e.id, c: cause });
    if (e.kind === 'mob') {
      const d = MOBS[e.type];
      if (d.kind === 'passive') { e.ai.panic = 100; e.ai.threat = src ? src.id : null; }
      if ((d.kind === 'neutral' || d.kind === 'hostile') && e.tamer == null && src && (src.kind === 'player' || src.owner)) { e.ai.angry = 600; e.ai.target = src.kind === 'player' ? src.id : src.owner; }
      if (e.tamer == null && src && src.kind === 'mob' && src.tamer != null && d.kind !== 'passive') { e.ai.angry = 600; e.ai.target = src.id; }
    }
    if (e.hp <= 0) this.kill(e, cause, src);
    return true;
  }
  srcName(src) {
    if (!src) return null;
    if (src.kind === 'player') return src.name;
    if (src.kind === 'mob') return 'a ' + MOBS[src.type].label;
    if (src.owner) return this.srcName(this.entities.get(src.owner));
    return null;
  }
  kill(e, cause, src) {
    e.dead = true; e.hp = 0; e.deadT = 0;
    const killer = src && (src.kind === 'player' ? src : src.owner ? this.entities.get(src.owner) : src);
    if (e.kind === 'mob') {
      const d = MOBS[e.type];
      if (cause !== 'self') for (const [item, a, b, ch] of d.drops) {
        if (ch != null && this.rng() > ch) continue;
        if (d.splits && e.size > 1) continue;
        const n = a + Math.floor(this.rng() * (b - a + 1));
        if (n > 0) this.dropItem(e.x, e.y + 0.4, e.z, e.fire > 0 && ITEMS['cooked_' + item.slice(4)] && item.startsWith('raw_') && ITEMS[item].food ? 'cooked_' + item.slice(4) : item, n, { magnet: killer && killer.kind === 'player' ? killer.id : null, pickup: 14 });
      }
      if (d.splits && e.size > 1) for (let i = 0; i < 2 + Math.floor(this.rng() * 2); i++) this.spawnMob(e.type, e.x + (this.rng() - 0.5), e.y + 0.3, e.z + (this.rng() - 0.5), e.size - 1);
      const credit = killer && killer.kind === 'mob' && killer.tamer != null ? this.entities.get(killer.tamer) : killer;
      if (credit && credit.kind === 'player') { credit.stats.kills[e.type] = (credit.stats.kills[e.type] || 0) + 1; credit.notes.push(`${credit === killer ? 'Killed' : `Your ${killer.petName} killed`} a ${d.label}`); }
      if (e.tamer != null) { const o = this.entities.get(e.tamer); if (o) o.notes.push(`Your pet ${e.petName} died!`); }
      if (d.boss) {
        this.bossDown = { t: this.t, by: credit && credit.kind === 'player' ? credit.name : null };
        for (const p of this.players) p.notes.push(`THE STORMWARDEN HAS FALLEN${this.bossDown.by ? ` to ${this.bossDown.by} and friends` : ''}! The Skyreach is won.`);
        this.event({ type: 'boss', mob: e.type, by: this.bossDown.by });
      }
      this.event({ type: 'death', id: e.id, mob: e.type, by: credit && credit.kind === 'player' ? credit.id : null });
    } else if (e.kind === 'player') {
      const by = this.srcName(src);
      const msg = by ? (cause === 'explosion' ? `was blown up by ${by}` : cause === 'projectile' ? `was shot by ${by}` : `was slain by ${by}`) : (DEATH[cause] || 'died');
      e.stats.deaths++;
      if (killer && killer.kind === 'player') killer.stats.pk = (killer.stats.pk || 0) + 1;
      const dropAt = `${Math.floor(e.x)} ${Math.floor(e.y)} ${Math.floor(e.z)}`;
      if (!this.config.keepInventory) {
        for (const s of e.inv.concat(e.armor.filter(Boolean))) this.dropItem(e.x, e.y + 0.5, e.z, s.id, s.n, { dur: s.dur, pickup: 40 });
        e.inv = []; e.armor = [null, null, null, null]; e.held = null;
      }
      e.notes.push(`YOU DIED: you ${msg}.${this.config.keepInventory ? '' : ` Your items were dropped at ${dropAt} (they vanish after 5 minutes).`} You respawned.`);
      e.deathMsg = `${e.name} ${msg}`;
      this.event({ type: 'death', id: e.id, name: e.name, msg: `${e.name} ${msg}` });
      e.respawnAt = this.tick + 60;
      this.tasks.cancel(this, e);
    }
  }
  respawn(p) {
    const bid = p.bed ? this.world.get(p.bed.x, p.bed.y, p.bed.z) : 0;
    const s = p.bed && (bid === B.bedroll || bid === B.bed) ? { x: p.bed.x + 0.5, y: p.bed.y + 0.3, z: p.bed.z + 0.5 } : this.spawn;
    Object.assign(p, { dead: false, hp: 20, food: 20, sat: 5, exh: 0, air: 300, fire: 0, x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, fallStart: s.y, invuln: 60 });
    this.event({ type: 'respawn', id: p.id });
  }
  attack(p, target) {
    if (p.attackCd > 0) return false;
    p.lastAttack = { id: target.id, t: this.tick };
    const weapon = this.bestWeapon(p);
    const t = weapon && ITEMS[weapon.id].tool;
    if (weapon) p.held = weapon;
    p.swingT = 6;
    p.attackCd = Math.round((t ? t.cd : 0.5) * TPS);
    p.exh += 0.1 * this.config.hunger;
    let dmg = t ? t.dmg : 1;
    if (!p.onGround && p.vy < -1) dmg *= 1.5;
    if (this.damage(target, dmg, p.kind === 'player' ? 'player' : 'mob', p) && weapon) this.useTool(p, weapon, t.type === 'sword' ? 1 : 2);
    return true;
  }
  bestWeapon(p) {
    let best = null, bd = 1;
    for (const s of p.inv) { const t = ITEMS[s.id].tool; if (t && t.type !== 'bow' && t.type !== 'igniter' && t.type !== 'rod' && t.type !== 'shears' && t.dmg / (t.cd || 0.6) > bd) { bd = t.dmg / (t.cd || 0.6); best = s; } }
    return best;
  }
  shoot(src, target, kind, dmg, speed = 20) {
    const ex = src.x, ey = src.y + src.h * 0.85, ez = src.z;
    const tx = target.x, ty = target.y + target.h * 0.6, tz = target.z;
    const dx = tx - ex, dz = tz - ez, dist = Math.hypot(dx, dz) || 1, t = dist / speed;
    const vy = (ty - ey) / t + 0.5 * 20 * t;
    const err = kind === 'thorn' ? 0.6 : kind === 'ember' ? 0.4 : 0.25;
    this.add({ kind, x: ex + dx / dist * 0.6, y: ey, z: ez + dz / dist * 0.6, w: 0.1, h: 0.1, owner: src.id, dmg, life: 120,
      vx: dx / t + (this.rng() - 0.5) * err, vy: vy + (this.rng() - 0.5) * err, vz: dz / t + (this.rng() - 0.5) * err });
    this.event({ type: 'shoot', id: src.id, k: kind });
  }

  // ---------- physics ----------
  stepMove(e, axis, d, grounded) {
    const sx = e.x, sy = e.y, sz = e.z;
    if (!this.moveAxis(e, axis, d)) return false;
    if (!grounded || (e.kind !== 'player' && e.kind !== 'mob')) return true;
    const hx = e.x, hy = e.y, hz = e.z;
    e.x = sx; e.y = sy; e.z = sz;
    if (this.moveAxis(e, 1, 0.6) || this.moveAxis(e, axis, d)) { e.x = hx; e.y = hy; e.z = hz; return true; }
    this.moveAxis(e, 1, -0.6);
    return false;
  }
  moveAxis(e, axis, d) {
    if (!d) return false;
    const hw = e.w / 2, w = this.world;
    if (axis === 0) e.x += d; else if (axis === 1) e.y += d; else e.z += d;
    const x0 = Math.floor(e.x - hw), x1 = Math.floor(e.x + hw - 1e-7), y0 = Math.floor(e.y), y1 = Math.floor(e.y + e.h - 1e-7);
    const z0 = Math.floor(e.z - hw), z1 = Math.floor(e.z + hw - 1e-7);
    let hit = false, lim = d > 0 ? Infinity : -Infinity;
    const get = (a, b2, c) => w.get(a, b2, c);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const b = BLOCKS[w.get(x, y, z)];
      if (!b.solid) continue;
      for (const bx of defs.blockBoxes(get, x, y, z, b)) {
        const bx0 = x + bx[0], by0 = y + bx[1], bz0 = z + bx[2], bx1 = x + bx[3], by1 = y + bx[4], bz1 = z + bx[5];
        if (!(e.y < by1 - 1e-6 && e.y + e.h > by0 + 1e-6 && e.x - hw < bx1 - 1e-6 && e.x + hw > bx0 + 1e-6 && e.z - hw < bz1 - 1e-6 && e.z + hw > bz0 + 1e-6)) continue;
        hit = true;
        if (axis === 0) lim = d > 0 ? Math.min(lim, bx0 - hw - 1e-4) : Math.max(lim, bx1 + hw + 1e-4);
        else if (axis === 2) lim = d > 0 ? Math.min(lim, bz0 - hw - 1e-4) : Math.max(lim, bz1 + hw + 1e-4);
        else lim = d > 0 ? Math.min(lim, by0 - e.h - 1e-4) : Math.max(lim, by1);
      }
    }
    if (hit) { if (axis === 0) e.x = lim; else if (axis === 1) e.y = lim; else e.z = lim; }
    return hit;
  }
  physics(e) {
    const w = this.world, fx = Math.floor(e.x), fz = Math.floor(e.z);
    const feet = w.def(fx, Math.floor(e.y + 0.1), fz), mid = w.def(fx, Math.floor(e.y + e.h * 0.55), fz), head = w.def(fx, Math.floor(e.y + e.h * 0.9), fz);
    e.inWater = feet.liquid === 'water' || mid.liquid === 'water';
    e.inLava = feet.liquid === 'lava' || mid.liquid === 'lava';
    e.headInWater = head.liquid === 'water';
    e.onLadder = !!(feet.climb || mid.climb);
    const sp = e.speedNow * (e.inWater || e.inLava ? 0.5 : 1) * (e.sneak ? 0.4 : 1);
    const k = e.onGround ? 0.5 : e.inWater ? 0.2 : 0.15;
    e.vx += (e.mx * sp - e.vx) * k; e.vz += (e.mz * sp - e.vz) * k;
    if (e.inWater) {
      e.vy = e.vy * 0.86 - 10 * DT;
      if (e.swimUp || e.floats) e.vy += 22 * DT;
      e.vy = clamp(e.vy, -4, 4);
    } else if (e.inLava) { e.vy = e.vy * 0.8 - 6 * DT; if (e.swimUp) e.vy += 14 * DT; }
    else if (e.flies && !e.dead) { e.vy += ((e.flyUp ? 2.6 : -1.6) - e.vy) * 0.15; e.fallStart = e.y; }
    else if (e.onLadder) { e.vy = e.climbUp || e.jump || (e.hitWall && (e.mx || e.mz)) ? 3.2 : e.sneak ? 0 : Math.max(e.vy - 28 * DT, -2.4); e.fallStart = e.y; }
    else e.vy = Math.max(e.vy - (e.kind === 'item' ? 18 : 28) * DT, -60);
    if (e.jump && e.onGround && !e.inWater) e.vy = 9.2;
    if (e.jump && e.inWater && e.hitWall) e.vy = Math.max(e.vy, 5);
    e.jump = false; e.swimUp = false; e.climbUp = false;
    const vx = e.vx + e.kx, vz = e.vz + e.kz;
    e.kx *= 0.78; e.kz *= 0.78;
    if (Math.abs(e.kx) < 0.05) e.kx = 0;
    if (Math.abs(e.kz) < 0.05) e.kz = 0;
    const wasGround = e.onGround, vyBefore = e.vy;
    const hx = this.stepMove(e, 0, vx * DT, wasGround), hz = this.stepMove(e, 2, vz * DT, wasGround);
    e.hitWall = hx || hz;
    if (hx) e.vx = 0;
    if (hz) e.vz = 0;
    let dy = e.vy * DT, hy = false;
    const steps = Math.max(1, Math.ceil(Math.abs(dy) / 0.8));
    for (let i = 0; i < steps && !hy; i++) hy = this.moveAxis(e, 1, dy / steps);
    if (hy) { e.onGround = e.vy < 0; e.vy = 0; } else e.onGround = false;
    if (e.onGround) {
      const under = w.def(fx, Math.floor(e.y - 0.05), fz);
      if (!wasGround) {
        const fall = e.fallStart - e.y;
        if (under.bouncy && vyBefore < -4) { e.vy = -vyBefore * 0.8; e.onGround = false; }
        else if (fall > 3.4 && !e.inWater && (e.kind === 'player' || e.kind === 'mob')) this.damage(e, Math.floor(fall - 3), 'fall', null, 0);
      }
      e.fallStart = e.y;
    } else if (e.inWater || e.vy > 0) e.fallStart = e.y;
    else e.fallStart = Math.max(e.fallStart, e.y);
    if (e.hitWall && e.autoJump && (e.mx || e.mz) && (e.onGround || e.inWater)) e.jump = true;
    e.x = clamp(e.x, -defs.BORDER + 0.4, defs.WORLD_X - 0.4); e.z = clamp(e.z, -defs.BORDER + 0.4, defs.BORDER - 0.4);
    if (e.y < -20) { if (e.kind === 'player' || e.kind === 'mob') this.damage(e, 1000, 'void'); else e.life = 0; }
  }
  steer(e, dx, dz, speed) {
    const n = Math.hypot(dx, dz);
    if (n < 1e-4) { e.mx = e.mz = 0; e.speedNow = 0; return; }
    e.mx = dx / n; e.mz = dz / n; e.speedNow = speed;
    e.yaw = Math.atan2(dx, dz);
  }
  stop(e) { e.mx = e.mz = 0; e.speedNow = 0; }
  face(e, x, y, z) {
    const dx = x - e.x, dz = z - e.z, dy = y - (e.y + e.h * 0.9);
    e.yaw = Math.atan2(dx, dz); e.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  }
  los(a, b) {
    const ax = a.x, ay = a.y + a.h * 0.85, az = a.z, bx = b.x, by = b.y + b.h * 0.7, bz = b.z;
    const d = Math.hypot(bx - ax, by - ay, bz - az), n = Math.ceil(d * 2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (BLOCKS[this.world.get(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t), Math.floor(az + (bz - az) * t))].opaque) return false;
    }
    return true;
  }
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

  // ---------- players ----------
  addPlayer(name, o = {}) {
    const i = this.players.length, s = this.spawn;
    const p = this.add({ kind: 'player', name, color: o.color || COLORS[i % COLORS.length], token: o.token, agent: !!o.agent,
      x: s.x + (this.rng() - 0.5) * 6, y: s.y + 1, z: s.z + (this.rng() - 0.5) * 6, w: 0.6, h: 1.8, hp: 20, maxHp: 20, food: 20, sat: 5, exh: 0, air: 300,
      inv: [], armor: [null, null, null, null], held: null, queue: [], task: null, cmd: null, results: [], notes: [], autoJump: true,
      stats: { mined: {}, crafted: {}, kills: {}, deaths: 0 }, chatSeen: 0, attackCd: 0, eatT: 0, eating: null, doing: 'idle', bed: null, home: null, joined: false });
    this.players.push(p);
    this.event({ type: 'join', id: p.id, name, color: p.color });
    return p;
  }
  player(nameOrToken) {
    const s = String(nameOrToken).toLowerCase();
    return this.players.find(p => p.token === nameOrToken || p.name.toLowerCase() === s);
  }
  say(p, text) {
    text = String(text).replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!text) return;
    this.chat.push({ t: this.t, id: p.id, name: p.name, text });
    this.event({ type: 'chat', id: p.id, name: p.name, text });
  }
  playerTick(p) {
    if (p.dead) { if (this.tick >= p.respawnAt) this.respawn(p); this.stop(p); return; }
    if (p.attackCd > 0) p.attackCd--;
    const H = this.config.hunger;
    // air and drowning
    if (p.headInWater) { p.air--; if (p.air <= -20) { p.air = 0; this.damage(p, 2, 'drown'); } }
    else p.air = Math.min(300, p.air + 6);
    if (p.inLava) { p.fire = 160; if (this.tick % 10 === 0) this.damage(p, 4, 'lava'); }
    if (p.fire > 0) { p.fire--; if (p.inWater || this.weather.rain && this.world.skyExposed(Math.floor(p.x), Math.floor(p.y + 1.7), Math.floor(p.z))) p.fire = 0; else if (p.fire % 20 === 0) this.damage(p, 1, 'fire'); }
    if (this.tick % 10 === 0 && this.touching(p, b => b.hurts)) this.damage(p, 1, 'cactus');
    if (this.tick % 20 === 0 && p.onGround && this.world.get(Math.floor(p.x), Math.floor(p.y - 0.1), Math.floor(p.z)) === B.magma_rock) this.damage(p, 1, 'fire');
    // realms: falling off the Skyreach, and stepping through gates
    const realm = defs.realmAt(p.x, p.z);
    if (realm && realm.name === 'skyreach' && p.y < 30) this.damage(p, 1000, 'void');
    if (p.portalCd > 0) p.portalCd--;
    else { const gate = this.portalTouching(p); if (gate) this.travel(p, gate); }
    if (this.tick % 10 === 0 && BLOCKS[this.world.get(Math.floor(p.x), Math.floor(p.y + 1.6), Math.floor(p.z))].opaque) this.damage(p, 1, 'suffocate');
    // hunger
    const moved = Math.hypot(p.vx, p.vz) * DT;
    p.exh += moved * 0.1 * H;
    if (p.jumpedThisTick) p.exh += 0.05 * H;
    while (p.exh >= 4) { p.exh -= 4; if (p.sat > 0) p.sat = Math.max(0, p.sat - 1); else p.food = Math.max(0, p.food - 1); }
    if (p.food >= 18 && p.hp < 20 && this.tick % 80 === 0) { p.hp = Math.min(20, p.hp + 1); p.exh += 3 * H; }
    if (p.food <= 0 && p.hp > 1 && this.tick % 80 === 0) this.damage(p, 1, 'starve');
    if (p.eatT > 0) { p.eatT--; if (p.eatT === 0 && p.eating) this.finishEat(p); }
    // reflexes, then the AI's command queue
    if (p.sleeping) { this.stop(p); return; }
    if (p.human && !p.task && !p.queue.length) return this.humanTick(p);
    this.tasks.tick(this, p);
  }
  // ---------- a real person playing from the viewer ----------
  humanTick(p) {
    const I = p.input;
    p.doing = 'playing';
    if (!I || Date.now() - p.inputAt > 3000) { this.stop(p); p.dig = null; return; }
    const n = Math.hypot(I.mx || 0, I.mz || 0);
    if (n > 0.05) { p.mx = I.mx / n; p.mz = I.mz / n; p.speedNow = (I.sprint && !I.sneak ? 5.6 : 4.3) * Math.min(1, n); } else this.stop(p);
    if (Number.isFinite(I.yaw)) p.yaw = I.yaw;
    if (Number.isFinite(I.pitch)) p.pitch = clamp(I.pitch, -1.6, 1.6);
    p.sneak = !!I.sneak; p.autoJump = false;
    if (I.jump) { p.jump = true; p.swimUp = true; p.climbUp = true; }
    if (Number.isInteger(I.slot)) p.held = p.inv[I.slot] || null;
    if (p.held && !p.inv.includes(p.held)) p.held = null;
    const ex = p.x, ey = p.y + 1.62, ez = p.z;
    const reach = (x, y, z) => Math.hypot(x + 0.5 - ex, y + 0.5 - ey, z + 0.5 - ez) <= 5.6;
    // hold to mine
    const m = Array.isArray(I.mine) && I.mine.map(Math.floor);
    const mid = m && this.world.get(m[0], m[1], m[2]), mb = mid && BLOCKS[mid];
    if (mb && mb.hardness >= 0 && !mb.liquid && reach(m[0], m[1], m[2])) {
      const k = m.join(',');
      if (!p.dig || p.dig.k !== k) p.dig = { k, t: 0 };
      const need = Math.min(this.breakTicks(this.bestTool(p, mid), mid), 600);
      p.dig.t++; p.swingT = 6;
      if (p.dig.t % 4 === 0) this.event({ type: 'crack', x: m[0], y: m[1], z: m[2], p: Math.floor(p.dig.t / need * 10) });
      if (p.dig.t >= need) { this.breakBlock(p, m[0], m[1], m[2]); p.dig = null; }
    } else p.dig = null;
    // right click: eat, sleep, or place
    const u = I.use;
    if (u && u.seq !== p.useSeq) {
      p.useSeq = u.seq;
      const s = p.held, it = s && ITEMS[s.id];
      const bx = Math.floor(u.x), by = Math.floor(u.y), bz = Math.floor(u.z), tb = u.x != null ? BLOCKS[this.world.get(bx, by, bz)] : null;
      if (it && it.food && p.food < 20 && !(tb && tb.bed)) this.startEat(p, s);
      else if (tb && tb.bed && !this.isDay()) { p.bed = { x: bx, y: by, z: bz }; this.event({ type: 'chat', id: p.id, name: p.name, text: '(set my bed here)' }); }
      else if (s && tb && Array.isArray(u.face) && reach(bx, by, bz)) {
        const [fx, fy, fz] = u.face.map(v => clamp(Math.round(v), -1, 1));
        const tx = tb.replaceable ? bx : bx + fx, ty = tb.replaceable ? by : by + fy, tz = tb.replaceable ? bz : bz + fz;
        const held = s.id, err = this.placeBlock(p, tx, ty, tz, held);
        if (!err && !p.inv.includes(s)) p.held = p.inv.find(x => x.id === held) || null;
        p.lastErr = err || null;
      }
    }
    // left click on a creature
    const h = I.hit;
    if (h && h.seq !== p.hitSeq) {
      p.hitSeq = h.seq;
      const t = this.entities.get(h.id);
      if (t && !t.dead && t !== p && (t.kind === 'mob' || t.kind === 'player') && this.dist(p, t) < 4.6) {
        const keep = p.held; this.attack(p, t); if (keep && p.inv.includes(keep)) p.held = keep;
      }
    }
  }
  // ---------- realms and gates ----------
  portalTouching(p) {
    const hw = p.w / 2;
    for (let y = Math.floor(p.y); y <= Math.floor(p.y + 1.5); y++) for (const x of [Math.floor(p.x - hw), Math.floor(p.x + hw)]) for (const z of [Math.floor(p.z - hw), Math.floor(p.z + hw)]) {
      const b = BLOCKS[this.world.get(x, y, z)];
      if (b.portal) return { realm: b.portal, x, y, z };
    }
    return null;
  }
  // a spot near (x,y,z) a player can stand on: solid floor, two free blocks, no gate block
  safeSpot(x, y, z, r = 4) {
    for (let d = 1; d <= r; d++) for (let dx = -d; dx <= d; dx++) for (let dz = -d; dz <= d; dz++) for (let dy = -2; dy <= 2; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue;
      const X = x + dx, Y = y + dy, Z = z + dz, fl = BLOCKS[this.world.get(X, Y - 1, Z)], a = BLOCKS[this.world.get(X, Y, Z)], b = BLOCKS[this.world.get(X, Y + 1, Z)];
      if (fl.solid && !fl.liquid && !a.solid && !b.solid && !a.liquid && !a.portal && !b.portal) return { x: X + 0.5, y: Y, z: Z + 0.5 };
    }
    return { x: x + 0.5, y: y + 1, z: z + 0.5 };
  }
  travel(p, gate) {
    const here = defs.realmAt(p.x, p.z), R = defs.REALM[gate.realm];
    let dest;
    if (here.name === 'overworld') {
      p.gateBack = p.gateBack || {};
      p.gateBack[gate.realm] = { x: gate.x, y: gate.y, z: gate.z };
      const [ax, az] = R.arrive;
      dest = gate.realm === 'emberdeep' ? { x: ax + 0.5, y: 51, z: az + 2.5 } : { x: ax + 0.5, y: 79, z: az - 1.5 };
    } else {
      const back = p.gateBack && p.gateBack[here.name];
      dest = back ? this.safeSpot(back.x, back.y, back.z) : this.spawn;
    }
    const pets = [...this.entities.values()].filter(m => m.kind === 'mob' && !m.dead && m.tamer === p.id && !m.ai.sit && this.dist(m, p) < 24);
    Object.assign(p, { x: dest.x, y: dest.y, z: dest.z, vx: 0, vy: 0, vz: 0, fallStart: dest.y, portalCd: 100, invuln: 40 });
    for (const m of pets) Object.assign(m, { x: dest.x + 1, y: dest.y, z: dest.z, vx: 0, vy: 0, vz: 0, fallStart: dest.y });
    const to = defs.realmAt(p.x, p.z);
    const wasEnter = p.cmd && p.cmd.name === 'enter';
    this.tasks.cancel(this, p);
    if (wasEnter) p.results.push(`travelled to ${defs.realmAt(dest.x, dest.z).label}, now at ${Math.floor(dest.x)} ${Math.floor(dest.y)} ${Math.floor(dest.z)}`);
    p.notes.push(`You stepped through the gate into ${to.label}.${to.name === 'skyreach' ? ' Careful: falling off an island is certain death.' : to.name === 'emberdeep' ? ' Lava everywhere; emberite armor resists fire.' : ''}`);
    this.event({ type: 'travel', id: p.id, name: p.name, realm: to.name });
    if (to.name === 'skyreach' && !this.bossSpawned) {
      const [bx, bz] = R.arena;
      this.bossSpawned = true;
      const boss = this.spawnMob('stormwarden', bx + 0.5, 81, bz + 0.5);
      boss.ai.home = { x: bx + 0.5, z: bz + 0.5 };
      for (const q of this.players) q.notes.push(`${p.name} reached the Skyreach. The Stormwarden awakens in the arena at ${bx} 81 ${bz}!`);
    }
    if (p.stats) { p.stats.realms = p.stats.realms || {}; if (!p.stats.realms[to.name]) { p.stats.realms[to.name] = true; if (to.name !== 'overworld') p.notes.push(`Milestone: first visit to ${to.label}!`); } }
  }
  touching(e, fn) {
    const hw = e.w / 2 + 0.05;
    for (let y = Math.floor(e.y); y <= Math.floor(e.y + e.h); y++) for (const x of [Math.floor(e.x - hw), Math.floor(e.x + hw)]) for (const z of [Math.floor(e.z - hw), Math.floor(e.z + hw)])
      if (fn(BLOCKS[this.world.get(x, y, z)])) return true;
    return false;
  }
  startEat(p, s) {
    const f = ITEMS[s.id].food;
    if (!f || p.eatT > 0) return false;
    p.eating = s.id; p.eatT = 32;
    return true;
  }
  finishEat(p) {
    const id = p.eating; p.eating = null;
    if (!this.count(p, id)) return;
    const f = ITEMS[id].food;
    this.take(p, id, 1);
    if (id === 'mushroom_stew') this.give(p, 'bowl', 1);
    p.food = Math.min(20, p.food + f.hunger);
    p.sat = Math.min(p.food, p.sat + f.sat);
    this.event({ type: 'eat', id: p.id, item: id });
  }

  // ---------- mobs ----------
  mobTick(m) {
    const d = MOBS[m.type], ai = m.ai;
    if (ai.cd > 0) ai.cd--;
    if (m.swingT > 0) m.swingT--;
    if (d.burns && this.tick % 20 === m.id % 20 && this.isDay() && !this.weather.rain && !m.inWater &&
      this.world.skyExposed(Math.floor(m.x), Math.floor(m.y + m.h), Math.floor(m.z))) m.fire = Math.max(m.fire, 60);
    if (m.fire > 0) { m.fire--; if (m.inWater) m.fire = 0; else if (m.fire % 20 === 0) this.damage(m, 1, 'fire', null, 0); }
    if (m.inLava && this.tick % 10 === 0) this.damage(m, 4, 'lava', null, 0);
    if (m.dead) return;
    if (d.kind === 'water') return this.fishAI(m, d);
    m.flies = !!d.flies;
    if (d.flies && m.tamer == null) return this.flyAI(m, d);
    if (m.tamer != null) { if (d.flies) { const o = this.entities.get(m.tamer); m.flyUp = !!o && o.y + 1.2 > m.y; } return this.petAI(m, d); }
    if (d.boss) {
      if (!ai.summoned && m.hp < m.maxHp * 0.5) {
        ai.summoned = true;
        for (let i = 0; i < 3; i++) this.spawnMob('galewing', m.x + (this.rng() - 0.5) * 6, m.y + 1, m.z + (this.rng() - 0.5) * 6);
        this.event({ type: 'roar', id: m.id });
      }
      if (this.tick % 40 === 0 && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + 1);
      if (ai.home && Math.hypot(m.x - ai.home.x, m.z - ai.home.z) > 22) { this.steer(m, ai.home.x - m.x, ai.home.z - m.z, m.speed); return; }
    }
    if (ai.angry > 0) ai.angry--;
    if (d.sheds && --ai.shed <= 0) { ai.shed = 3600 + this.rng() * 4800; this.dropItem(m.x, m.y + 0.8, m.z, d.sheds, 1); }
    if (d.lays && this.rng() < 1 / 6000) this.dropItem(m.x, m.y + 0.3, m.z, d.lays, 1);
    if (d.guard && !(ai.angry > 0)) {
      if (this.tick % 10 === m.id % 10) {
        let best = 16, h = null;
        for (const e of this.entities.values()) if (e.kind === 'mob' && !e.dead && MOBS[e.type].kind === 'hostile' && !MOBS[e.type].boss) { const dd = this.dist(m, e); if (dd < best) { best = dd; h = e; } }
        ai.guardT = h ? h.id : null;
      }
      const h = ai.guardT != null ? this.entities.get(ai.guardT) : null;
      if (h && !h.dead) return this.chase(m, d, h);
      if (ai.vhome && Math.hypot(m.x - ai.vhome.x, m.z - ai.vhome.z) > 14) { this.steer(m, ai.vhome.x - m.x, ai.vhome.z - m.z, m.speed * 0.5); return; }
    }
    let target = null;
    if (d.kind === 'hostile' || (d.kind === 'neutral' && ai.angry > 0)) target = this.mobTarget(m, d);
    if (target) return this.chase(m, d, target);
    ai.fuse = 0;
    if (ai.panic > 0) {
      ai.panic--;
      const t = this.entities.get(ai.threat);
      if (t && !t.dead) this.steer(m, m.x - t.x, m.z - t.z, m.speed * 1.35);
      else if (ai.panic % 30 === 0) { const a = this.rng() * 6.28; this.steer(m, Math.cos(a), Math.sin(a), m.speed * 1.3); }
      return;
    }
    if (d.villager && ai.vhome && Math.hypot(m.x - ai.vhome.x, m.z - ai.vhome.z) > 18) { ai.goal = null; this.steer(m, ai.vhome.x - m.x, ai.vhome.z - m.z, m.speed * 0.5); return; }
    this.wander(m, d);
  }
  // tamed companions: follow the owner, defend them, attack what they attack, sit when told
  petAI(m, d) {
    const ai = m.ai, o = this.entities.get(m.tamer);
    if (this.tick % 80 === m.id % 80 && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + 1);
    if (!o || o.dead) { this.stop(m); return; }
    if (ai.sit) { this.stop(m); return; }
    let t = ai.target != null ? this.entities.get(ai.target) : null;
    const pick = id => { const e = this.entities.get(id); return e && !e.dead && e.kind === 'mob' && e.tamer == null && this.dist(e, o) < 20 ? e : null; };
    if (!t || t.dead || this.dist(t, o) > 24) {
      t = null; ai.target = null;
      if (o.lastHurt && this.tick - o.lastHurt.t < 60 && o.lastHurt.by != null) t = pick(o.lastHurt.by);
      if (!t && o.lastAttack && this.tick - o.lastAttack.t < 60) t = pick(o.lastAttack.id);
      if (!t && m.lastHurtBy && this.tick - m.lastHurtBy.t < 60) t = pick(m.lastHurtBy.id);
      if (t) ai.target = t.id;
    }
    if (t) return this.chase(m, d, t);
    const dist = this.dist(m, o);
    if (dist > 24 || defs.realmAt(m.x, m.z) !== defs.realmAt(o.x, o.z) || (dist > 10 && (ai.stuck || 0) > 40)) {
      const s = this.safeSpot(Math.floor(o.x), Math.floor(o.y), Math.floor(o.z), 3);
      Object.assign(m, { x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, fallStart: s.y }); ai.stuck = 0; return;
    }
    if (dist > 3.5) { this.steer(m, o.x - m.x, o.z - m.z, m.speed * (dist > 8 ? 1 : 0.7)); ai.stuck = m.hitWall ? (ai.stuck || 0) + 1 : 0; }
    else { this.stop(m); if (this.rng() < 0.02) m.yaw = Math.atan2(o.x - m.x, o.z - m.z); }
  }
  tame(p, m) {
    const d = MOBS[m.type];
    m.tamer = p.id; m.ai.angry = 0; m.ai.target = null; m.ai.panic = 0; m.ai.sit = false;
    const names = ['Rusty', 'Biscuit', 'Shadow', 'Pepper', 'Nova', 'Scout', 'Mango', 'Ziggy', 'Bramble', 'Patch', 'Comet', 'Mocha'];
    m.petName = names[(m.id + p.id) % names.length];
    m.maxHp = d.hp + 10; m.hp = m.maxHp;
    p.pets = (p.pets || []).concat(m.id);
    this.event({ type: 'tame', id: m.id, by: p.id, name: m.petName });
  }
  wander(m, d) {
    const ai = m.ai;
    if (--ai.wanderT <= 0) {
      ai.wanderT = 60 + Math.floor(this.rng() * 160);
      if (this.rng() < 0.5) { ai.goal = null; this.stop(m); return; }
      const a = this.rng() * 6.28, r = 3 + this.rng() * 7, x = m.x + Math.cos(a) * r, z = m.z + Math.sin(a) * r;
      const h = this.world.height(Math.floor(x), Math.floor(z));
      if (Math.abs(h + 1 - m.y) < 4 && !BLOCKS[this.world.get(Math.floor(x), h, Math.floor(z))].liquid) ai.goal = { x, z };
    }
    if (ai.goal) {
      const dx = ai.goal.x - m.x, dz = ai.goal.z - m.z;
      if (Math.hypot(dx, dz) < 0.6) { ai.goal = null; this.stop(m); return; }
      // don't walk off cliffs or into water/lava
      const ax = Math.floor(m.x + Math.sign(dx) * 0.8), az = Math.floor(m.z + Math.sign(dz) * 0.8), fy = Math.floor(m.y);
      let drop = 0;
      while (drop < 5 && !this.world.solid(ax, fy - 1 - drop, az) && !this.world.def(ax, fy - 1 - drop, az).liquid) drop++;
      if (drop > 3 || this.world.def(ax, fy - 1 - drop, az).liquid || this.world.def(ax, fy, az).liquid) { ai.goal = null; this.stop(m); return; }
      this.steer(m, dx, dz, m.speed * 0.45);
    } else if (this.rng() < 0.01) m.yaw += (this.rng() - 0.5) * 1.5;
  }
  mobTarget(m, d) {
    const ai = m.ai;
    let t = ai.target != null ? this.entities.get(ai.target) : null;
    if (t && (t.dead || (t.kind !== 'player' && t.tamer == null) || this.dist(m, t) > 28)) { t = null; ai.target = null; }
    if (!t && d.kind === 'hostile' && this.tick % 10 === m.id % 10) {
      let best = 16;
      for (const p of this.players) {
        if (p.dead || !p.joined && p.agent) continue;
        const dd = this.dist(m, p);
        if (dd < best && Math.abs(p.y - m.y) < 12 && (dd < 5 || this.los(m, p))) { best = dd; t = p; }
      }
      if (t) ai.target = t.id;
    }
    return t;
  }
  chase(m, d, t) {
    const ai = m.ai, dx = t.x - m.x, dz = t.z - m.z, dist = Math.hypot(dx, dz), dy = t.y - m.y;
    m.yaw = Math.atan2(dx, dz);
    if (d.explode) {
      if (dist < 2.8 && Math.abs(dy) < 2.5 || ai.fuse > 0) {
        ai.fuse++; this.stop(m);
        if (ai.fuse === 1) this.event({ type: 'fuse', id: m.id });
        if (dist > 6) ai.fuse = 0;
        else if (ai.fuse >= d.explode.fuse * TPS) { m.dead = true; m.deadT = 99; this.explode(m.x, m.y + 0.6, m.z, d.explode.power, m); }
        return;
      }
    }
    if (d.ranged && dist < d.ranged.range && !(d.boss && dist < 4) && this.los(m, t)) {
      if (dist < 5 && !d.boss) this.steer(m, -dx, -dz, m.speed * 0.6); else if (d.boss && dist > 8) this.steer(m, dx, dz, m.speed * 0.6); else this.stop(m);
      m.yaw = Math.atan2(dx, dz);
      if (ai.cd <= 0) { ai.cd = Math.round(d.ranged.cd * TPS); m.swingT = 8; this.shoot(m, t, d.ranged.kind || 'thorn', d.ranged.dmg, 16); }
      return;
    }
    const reach = m.w / 2 + t.w / 2 + 0.9;
    if (dist < reach && Math.abs(dy) < 2) {
      this.stop(m);
      if (ai.cd <= 0) { ai.cd = 20; m.swingT = 8; this.damage(t, d.dmg || 2, 'mob', m); }
      return;
    }
    // follow a short path when blocked, else head straight for the target
    if (ai.path && ai.pathI < ai.path.length) {
      const n = ai.path[ai.pathI], ndx = n.x + 0.5 - m.x, ndz = n.z + 0.5 - m.z;
      if (Math.hypot(ndx, ndz) < 0.45) ai.pathI++;
      else { this.steer(m, ndx, ndz, m.speed); if (n.y > m.y + 0.4 && m.onGround) m.jump = true; }
      if (--ai.repath <= 0) ai.path = null;
      return;
    }
    this.steer(m, dx, dz, m.speed);
    if (m.hitWall) ai.stuck = (ai.stuck || 0) + 1; else ai.stuck = 0;
    if (ai.stuck > 15 || (Math.abs(dy) > 2 && this.tick % 40 === m.id % 40)) {
      ai.stuck = 0;
      const tx = Math.floor(t.x), ty = Math.floor(t.y + 0.5), tz = Math.floor(t.z);
      const path = findPath(this.world, Math.floor(m.x), Math.floor(m.y + 0.5), Math.floor(m.z), { hx: tx, hy: ty, hz: tz, isGoal: (x, y, z) => Math.abs(x - tx) + Math.abs(z - tz) <= 1 && Math.abs(y - ty) <= 1 }, { maxNodes: 300, partial: true });
      if (path && path.length) { ai.path = path; ai.pathI = 0; ai.repath = 60; }
    }
  }
  // bats, bees and parrots: flutter between nearby air spots, never too high above the ground; bees sting when angry
  flyAI(m, d) {
    const ai = m.ai;
    if (ai.angry > 0) ai.angry--;
    if (ai.panic > 0) ai.panic--;
    const t = d.kind === 'neutral' && ai.angry > 0 ? this.mobTarget(m, d) : null;
    if (t) {
      const dx = t.x - m.x, dz = t.z - m.z, dist = Math.hypot(dx, dz);
      m.flyUp = t.y + 1 > m.y; m.yaw = Math.atan2(dx, dz);
      if (dist < 1.2 && Math.abs(t.y - m.y) < 1.8) { this.stop(m); if (ai.cd <= 0) { ai.cd = 20; m.swingT = 8; this.damage(t, d.dmg || 1, 'mob', m); } }
      else this.steer(m, dx, dz, m.speed);
      return;
    }
    if (--ai.wanderT <= 0 || !ai.goal) {
      ai.wanderT = 30 + Math.floor(this.rng() * 70);
      const x = m.x + (this.rng() - 0.5) * 10, y = m.y + (this.rng() - 0.5) * 5, z = m.z + (this.rng() - 0.5) * 10;
      const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
      const ground = this.world.height(fx, fz);
      const ok = !this.world.solid(fx, fy, fz) && !this.world.def(fx, fy, fz).liquid && (d.cave ? fy < ground - 2 || this.world.blockLight(fx, fy, fz) < 8 : fy <= ground + 6 && fy > ground);
      if (ok) ai.goal = { x, y, z };
    }
    if (ai.goal) {
      this.steer(m, ai.goal.x - m.x, ai.goal.z - m.z, m.speed * (ai.panic > 0 ? 1.5 : 0.6));
      m.flyUp = ai.goal.y > m.y || m.hitWall || m.inWater;
      if (Math.hypot(ai.goal.x - m.x, ai.goal.z - m.z) < 0.6) ai.goal = null;
    } else { this.stop(m); m.flyUp = this.rng() < 0.55; }
  }
  fishAI(m, d) {
    const ai = m.ai;
    if (!m.inWater) {
      ai.dry = (ai.dry || 0) + 1;
      if (m.onGround && this.rng() < 0.08) { m.vy = 5; m.vx = (this.rng() - 0.5) * 4; m.vz = (this.rng() - 0.5) * 4; }
      if (ai.dry > 60 && ai.dry % 40 === 0) this.damage(m, 1, 'suffocate', null, 0);
      this.stop(m); return;
    }
    ai.dry = 0;
    if (--ai.wanderT <= 0 || !ai.goal) {
      ai.wanderT = 40 + Math.floor(this.rng() * 80);
      const x = m.x + (this.rng() - 0.5) * 10, y = m.y + (this.rng() - 0.5) * 4, z = m.z + (this.rng() - 0.5) * 10;
      if (this.world.def(Math.floor(x), Math.floor(y), Math.floor(z)).liquid === 'water') ai.goal = { x, y, z };
    }
    if (ai.panic > 0) ai.panic--;
    if (ai.goal) {
      this.steer(m, ai.goal.x - m.x, ai.goal.z - m.z, m.speed * (ai.panic > 0 ? 1.6 : 0.6));
      m.floats = ai.goal.y > m.y;
      if (Math.hypot(ai.goal.x - m.x, ai.goal.z - m.z) < 0.5) ai.goal = null;
    }
    if (!this.world.def(Math.floor(m.x), Math.floor(m.y + 0.6), Math.floor(m.z)).liquid) m.floats = false;
  }

  // ---------- other entities ----------
  itemTick(it) {
    if (it.pickup > 0) it.pickup--;
    if (--it.life <= 0) { it.dead = true; it.deadT = 99; return; }
    const p = it.magnet != null ? this.entities.get(it.magnet) : null;
    if (p && !p.dead && it.pickup <= 0) {
      const dx = p.x - it.x, dy = p.y + 0.9 - it.y, dz = p.z - it.z, d = Math.hypot(dx, dy, dz);
      if (d < 0.7) return this.pickup(p, it);
      if (d < 12) { const s = Math.min(d, 12 * DT); it.x += dx / d * s; it.y += dy / d * s; it.z += dz / d * s; it.vy = 0; return; }
      it.magnet = null;
    }
    this.physics(it);
    if (it.pickup <= 0 && this.tick % 4 === it.id % 4) for (const pl of this.players) if (!pl.dead && Math.abs(pl.x - it.x) < 1.6 && Math.abs(pl.z - it.z) < 1.6 && it.y - pl.y > -0.8 && it.y - pl.y < 2.2) { this.pickup(pl, it); break; }
  }
  pickup(p, it) {
    const left = this.give(p, it.item, it.n, it.dur);
    if (left < it.n) this.event({ type: 'pickup', id: p.id, e: it.id, item: it.item, n: it.n - left });
    if (left <= 0) { it.dead = true; it.deadT = 99; } else { it.n = left; it.magnet = null; }
  }
  projectileTick(a) {
    if (--a.life <= 0) { a.dead = true; a.deadT = 99; return; }
    if (a.stuck) return;
    a.vy -= 20 * DT;
    for (let s = 0; s < 4; s++) {
      a.x += a.vx * DT / 4; a.y += a.vy * DT / 4; a.z += a.vz * DT / 4;
      if (this.world.solid(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z))) { a.stuck = true; a.life = Math.min(a.life, 30); this.event({ type: 'thud', x: r2(a.x), y: r2(a.y), z: r2(a.z) }); return; }
      for (const e of this.entities.values()) {
        if (e.dead || e.id === a.owner || (e.kind !== 'player' && e.kind !== 'mob')) continue;
        if (Math.abs(e.x - a.x) < e.w / 2 + 0.15 && Math.abs(e.z - a.z) < e.w / 2 + 0.15 && a.y > e.y - 0.1 && a.y < e.y + e.h + 0.1) {
          const owner = this.entities.get(a.owner);
          if (owner && owner.kind === 'player' && e.kind === 'player' && !this.config.pvp) continue;
          if (owner && owner.kind === 'mob' && e.kind === 'mob' && e.tamer == null) continue; // mobs don't shoot each other
          if (this.damage(e, a.dmg, 'projectile', a, 0.6) && a.kind === 'ember' && !(e.kind === 'mob' && MOBS[e.type].fireproof)) e.fire = Math.max(e.fire, 60);
          a.dead = true; a.deadT = 99; return;
        }
      }
    }
    a.yaw = Math.atan2(a.vx, a.vz); a.pitch = -Math.atan2(a.vy, Math.hypot(a.vx, a.vz));
  }
  fallingTick(f) {
    this.physics(f);
    if (f.onGround || f.age > 400) {
      const x = Math.floor(f.x), y = Math.floor(f.y + 0.1), z = Math.floor(f.z);
      if (this.world.def(x, y, z).replaceable) this.setBlock(x, y, z, f.block);
      else this.dropItem(f.x, f.y + 0.5, f.z, BLOCKS[f.block].name, 1);
      f.dead = true; f.deadT = 99;
    }
  }

  // ---------- world ticks ----------
  randomTicks() {
    const w = this.world;
    for (const k of Array.from(w.crops)) {
      if (this.rng() < 1 / 40) {
        const [x, y, z] = unpk(k), b = BLOCKS[w.get(x, y, z)];
        if (b.crop !== undefined && b.crop < 3) this.setBlock(x, y, z, B['wheat_' + (b.crop + 1)]);
      }
    }
    for (const k of Array.from(w.saplings)) if (this.rng() < 1 / 150) { const [x, y, z] = unpk(k); this.growTree(x, y, z); }
    while (this.decay.length && this.decay[0][0] <= this.tick) {
      const [, x, y, z] = this.decay.shift(), b = BLOCKS[w.get(x, y, z)];
      if (b.decays && !this.logNear(x, y, z)) {
        this.setBlock(x, y, z, 0);
        this.event({ type: 'break', x, y, z, b: b.id, q: 1 });
        for (const [item, n] of this.blockDrops(b, null)) this.dropItem(x + 0.5, y + 0.5, z + 0.5, item, n);
      }
    }
    this.decay.sort((a, b) => a[0] - b[0]);
  }
  growTree(x, y, z) {
    const sp = BLOCKS[this.world.get(x, y, z)].sapling;
    if (!sp) return;
    const h = sp === 'pine' ? 7 : sp === 'birch' ? 6 : 5;
    for (let k = 1; k <= h + 1; k++) if (this.world.get(x, y + k, z) !== 0) return;
    const log = B[sp + '_log'], leaf = B[sp + '_leaves'];
    this.setBlock(x, y, z, 0);
    for (let k = 0; k < h; k++) this.setBlock(x, y + k, z, log);
    for (let yy = y + h - 3; yy <= y + h; yy++) {
      const rr = sp === 'pine' ? Math.max(0, Math.min(2, y + h - yy)) : yy >= y + h - 1 ? 1 : 2;
      for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
        if (rr > 1 && Math.abs(dx) === rr && Math.abs(dz) === rr) continue;
        if (this.world.get(x + dx, yy, z + dz) === 0) this.setBlock(x + dx, yy, z + dz, leaf);
      }
    }
    this.event({ type: 'grow', x, y, z });
  }
  onChunk(c) {
    for (const v of c.villagers || []) if (!this.world.villagersSpawned.has(v.id)) { this.world.villagersSpawned.add(v.id); (this.pendingVillagers = this.pendingVillagers || []).push(v); }
    if (this.countMobs(m => MOBS[m.type].kind === 'passive') >= this.config.passiveCap) return;
    const r = mulberry32((this.seed ^ (c.cx * 7919 + c.cz * 104729)) >>> 0);
    if (r() > 0.22) return;
    const lx = 2 + Math.floor(r() * 12), lz = 2 + Math.floor(r() * 12), b = BIOMES[c.biomes[lz * 16 + lx]].name;
    const opts = Object.keys(MOBS).filter(k => MOBS[k].kind === 'passive' && MOBS[k].biomes.includes(b));
    if (!opts.length) return;
    this.pendingSpawns = this.pendingSpawns || [];
    this.pendingSpawns.push([this.weighted(opts, r), c.cx * 16 + lx, c.cz * 16 + lz, r]);
  }
  weighted(opts, r) {
    let t = r() * opts.reduce((a, k) => a + (MOBS[k].weight || 1), 0);
    for (const k of opts) if ((t -= MOBS[k].weight || 1) < 0) return k;
    return opts[opts.length - 1];
  }
  countMobs(fn, near, rad) {
    let n = 0;
    for (const e of this.entities.values()) if (e.kind === 'mob' && !e.dead && fn(e) && (!near || Math.abs(e.x - near.x) < rad && Math.abs(e.z - near.z) < rad)) n++;
    return n;
  }
  spawnGroup(type, x, z, r) {
    const d = MOBS[type], n = d.group[0] + Math.floor(r() * (d.group[1] - d.group[0] + 1));
    for (let i = 0; i < n; i++) {
      const sx = Math.floor(x + (r() - 0.5) * 6), sz = Math.floor(z + (r() - 0.5) * 6);
      if (!this.world.inBounds(sx, sz)) continue;
      const h = this.world.height(sx, sz), top = this.world.def(sx, h, sz);
      if (d.kind === 'water') { if (top.liquid === 'water') this.spawnMob(type, sx + 0.5, h - 1 - Math.floor(r() * 2), sz + 0.5); }
      else if (top.solid && !this.world.def(sx, h + 1, sz).solid && !this.world.def(sx, h + 1, sz).liquid) this.spawnMob(type, sx + 0.5, h + 1 + (d.flies ? 1.5 : 0), sz + 0.5);
    }
  }
  spawning() {
    while (this.pendingVillagers && this.pendingVillagers.length) {
      const v = this.pendingVillagers.shift(), m = this.spawnMob(v.type, v.x + 0.5, v.y, v.z + 0.5);
      m.prof = v.prof; m.ai.vhome = { x: v.hx, z: v.hz };
    }
    if (this.pendingSpawns && this.pendingSpawns.length) { const [type, x, z, r] = this.pendingSpawns.shift(); this.spawnGroup(type, x, z, r); }
    const night = !this.isDay();
    for (const p of this.players) {
      if (p.dead || (p.agent && !p.joined)) continue;
      const realm = defs.realmAt(p.x, p.z);
      if (realm && realm.name !== 'overworld') { this.realmSpawn(p, realm.name); continue; }
      // hostiles: on the surface at night, in dark caves any time
      if (this.countMobs(m => MOBS[m.type].kind === 'hostile', p, 48) < this.config.mobCap && this.rng() < 0.5) {
        const a = this.rng() * 6.28, r = 20 + this.rng() * 22, x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
        if (this.world.inBounds(x, z)) {
          let y = null;
          const h = this.world.height(x, z);
          if (night && !this.world.def(x, h, z).liquid && this.world.def(x, h, z).solid && this.world.def(x, h, z).render !== 'leaves') y = h + 1;
          else {
            const yy = Math.floor(p.y) + Math.floor((this.rng() - 0.5) * 24);
            if (yy > 2 && yy < h - 3 && !this.world.solid(x, yy, z) && !this.world.solid(x, yy + 1, z) && this.world.solid(x, yy - 1, z) && !this.world.def(x, yy, z).liquid) y = yy;
          }
          if (y != null && this.world.blockLight(x, y, z) < 7) {
            const biome = BIOMES[this.world.gen.column(x, z).b].name, deep = y < 30 && y < h - 8;
            const roll = this.rng();
            const surface = y > h - 2;
            const W = [['gloomling', 16], ['thornspitter', 9], ['blastcap', 10], ['burrower', 7], ['gelatoad', 4], ['zombie', 18], ['skeleton', 15], ['spider', 12],
              ['slime', surface ? 0 : 4], ['witch', surface ? 3 : 0]];
            let pick = roll * W.reduce((a, w) => a + w[1], 0), type = 'gloomling';
            for (const [k, wt] of W) { if ((pick -= wt) < 0) { type = k; break; } }
            if (deep && this.rng() < 0.18) type = 'cragjaw';
            else if (deep && this.rng() < 0.22) type = this.rng() < 0.55 ? 'cave_spider' : 'silverfish';
            if (!surface && !night && this.rng() < 0.12 && this.countMobs(m => m.type === 'bat', p, 48) < 4) type = 'bat';
            if (biome === 'swamp' && surface && this.rng() < 0.12) type = 'slime';
            if (biome === 'swamp' && this.rng() < 0.35) type = 'gelatoad';
            if (type === 'gelatoad' && !(biome === 'swamp' || y < h - 6)) type = 'gloomling';
            this.spawnMob(type, x + 0.5, y, z + 0.5);
          }
        }
      }
      // passive animals in daylight
      if (!night && this.rng() < 0.05 && this.countMobs(m => MOBS[m.type].kind !== 'hostile', p, 64) < 10 && this.countMobs(m => MOBS[m.type].kind !== 'hostile') < this.config.passiveCap) {
        const a = this.rng() * 6.28, r = 26 + this.rng() * 20, x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
        if (this.world.inBounds(x, z)) {
          const b = BIOMES[this.world.gen.column(x, z).b].name;
          const opts = Object.keys(MOBS).filter(k => MOBS[k].kind !== 'hostile' && MOBS[k].biomes && MOBS[k].biomes.includes(b));
          if (opts.length) this.spawnGroup(this.weighted(opts, this.rng), x, z, this.rng);
        }
      }
    }
    // despawn far-away hostiles
    for (const e of this.entities.values()) {
      if (e.kind !== 'mob' || e.dead || MOBS[e.type].kind !== 'hostile' || MOBS[e.type].boss) continue;
      let near = Infinity;
      for (const p of this.players) if (!p.dead) near = Math.min(near, this.dist(e, p));
      if (near > 80 || (near > 36 && this.rng() < 0.02) || (this.isDay() && near > 24 && !e.ai.target && this.rng() < 0.01)) { e.dead = true; e.deadT = 99; }
    }
  }

  realmSpawn(p, realm) {
    const hostiles = this.countMobs(m => MOBS[m.type].kind === 'hostile' && !MOBS[m.type].boss, p, 48);
    const roll = this.rng();
    let type = null;
    if (realm === 'emberdeep') type = hostiles < this.config.mobCap && roll < 0.5 ? (this.rng() < 0.5 ? 'scorchling' : 'magmite') : roll > 0.97 && this.countMobs(m => m.type === 'cinderhog', p, 64) < 4 ? 'cinderhog' : null;
    else if (realm === 'skyreach') type = hostiles < Math.ceil(this.config.mobCap / 2) && roll < (this.isDay() ? 0.12 : 0.4) ? 'galewing' : roll > 0.95 && this.countMobs(m => m.type === 'puffcloud', p, 64) < 8 ? 'puffcloud' : null;
    if (!type) return;
    const a = this.rng() * 6.28, r = 14 + this.rng() * 18, x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    if (defs.realmAt(x, z) !== defs.realmAt(p.x, p.z)) return;
    for (let y = Math.floor(p.y) + 10; y > Math.floor(p.y) - 12; y--) {
      const fl = this.world.def(x, y - 1, z);
      if (fl.solid && !fl.liquid && fl.render !== 'leaves' && !this.world.solid(x, y, z) && !this.world.solid(x, y + 1, z) && !this.world.def(x, y, z).liquid) {
        if (type === 'puffcloud') this.spawnGroup(type, x, z, this.rng); else this.spawnMob(type, x + 0.5, y, z + 0.5);
        return;
      }
    }
  }

  // ---------- main loop ----------
  step() {
    if (this.over) return;
    if (this.tick % 400 === 199) this.world.unloadFar(this.players);
    this.tick++; this.clock++;
    this.world.tick = this.tick;
    const wx = this.weather;
    if (this.tick >= wx.next) { wx.rain = !wx.rain; wx.next = this.tick + Math.round(TPS * 60 * (wx.rain ? 2 + this.rng() * 4 : 6 + this.rng() * 10)); this.event({ type: 'weather', rain: wx.rain }); }
    for (const e of this.entities.values()) {
      e.age++;
      if (e.invuln > 0) e.invuln--;
      if (e.hurtT > 0) e.hurtT--;
      if (e.dead) { if (e.kind === 'player') this.playerTick(e); else if (++e.deadT > 18) this.entities.delete(e.id); continue; }
      switch (e.kind) {
        case 'player': this.playerTick(e); if (!e.dead && !e.sleeping) this.physics(e); if (e.swingT > 0) e.swingT--; break;
        case 'mob': this.mobTick(e); if (!e.dead) this.physics(e); break;
        case 'item': this.itemTick(e); break;
        case 'arrow': case 'thorn': case 'ember': this.projectileTick(e); break;
        case 'falling': this.fallingTick(e); break;
        case 'primed': this.physics(e); if (--e.fuse <= 0) { e.dead = true; e.deadT = 99; this.explode(e.x, e.y + 0.5, e.z, 3.5, null); } break;
      }
    }
    if (this.tick % 20 === 0) { this.randomTicks(); this.spawning(); }
    if (this.tick % 20 === 5) this.tasks.global(this);
    if (this.tick % 20 === 10) this.event({ type: 'ps', list: this.players.map(p => this.playerSummary(p)) });
    if (this.tick % 4 === 0) this.recordFrame();
    if (this.config.days && this.day() > this.config.days) this.end('time');
  }
  end(reason) {
    if (this.over) return;
    this.over = { reason, t: this.t };
    for (const p of this.players) this.tasks.cancel(this, p);
    this.event({ type: 'over', reason });
  }

  // ---------- viewer / replay ----------
  flags(e) {
    let f = 0;
    if (Math.hypot(e.vx, e.vz) > 0.4) f |= 1;
    if (e.swingT > 0) f |= 2;
    if (e.hurtT > 0) f |= 4;
    if (e.fire > 0) f |= 8;
    if (e.sleeping) f |= 16;
    if (e.inWater) f |= 32;
    if (e.ai && e.ai.fuse > 0) f |= 64;
    if (e.ai && (e.ai.target != null || e.ai.angry > 0)) f |= 128;
    if (e.eatT > 0) f |= 256;
    if (e.dead) f |= 512;
    if (e.onGround) f |= 1024;
    if (e.kind === 'player' && !e.dead && !e.sleeping && (e.sneak || (e.onGround && /^(building|swapping|placing)/.test(e.doing || '')))) f |= 2048;
    if (e.onLadder && !e.onGround) f |= 4096;
    return f;
  }
  pack(e) {
    let extra = 0;
    if (e.kind === 'player') extra = e.held ? e.held.id : '';
    else if (e.kind === 'item') extra = e.item;
    else if (e.kind === 'falling' || e.kind === 'primed') extra = e.block;
    else if (e.kind === 'mob' && e.size) extra = e.size;
    else if (e.kind === 'mob' && e.prof) extra = e.prof;
    return [e.id, e.kind === 'mob' ? e.type : e.kind, r2(e.x), r2(e.y), r2(e.z), r2(e.yaw), r2(e.pitch || 0), this.flags(e), Math.ceil(e.hp || 0), extra];
  }
  snapshot() { const out = []; for (const e of this.entities.values()) out.push(this.pack(e)); return out; }
  // delta frame: changed entities and removed ids since `last`
  diff(last) {
    const ents = [], seen = new Set();
    for (const e of this.entities.values()) {
      const a = this.pack(e), s = JSON.stringify(a);
      seen.add(e.id);
      if (last.get(e.id) !== s) { last.set(e.id, s); ents.push(a); }
    }
    const gone = [];
    for (const id of last.keys()) if (!seen.has(id)) { gone.push(id); last.delete(id); }
    return { ents, gone };
  }
  recordFrame() {
    const r = this.rec;
    const key = r.n++ % 50 === 0;
    if (key) r.last.clear();
    const { ents, gone } = this.diff(r.last);
    r.frames.push([r2(this.t), ents, gone, key ? 1 : 0, this.clock]);
  }
  playerSummary(p) {
    const inv = {};
    for (const s of p.inv) inv[s.id] = (inv[s.id] || 0) + s.n;
    const top = Object.entries(inv).sort((a, b) => b[1] - a[1]).slice(0, 12);
    return { id: p.id, name: p.name, color: p.color, hp: Math.ceil(p.hp), food: p.food, armor: this.armorPoints(p), held: p.held ? p.held.id : null,
      inv: top, doing: p.dead ? 'dead' : p.sleeping ? 'sleeping' : p.doing, deaths: p.stats.deaths, kills: Object.values(p.stats.kills).reduce((a, b) => a + b, 0),
      armorItems: p.armor.map(s => s && s.id) };
  }
  meta() {
    return { id: this.id, seed: this.seed, config: this.config, spawn: this.spawn, dayTicks: this.dayTicks, clock0: this.clock - this.tick,
      players: this.players.map(p => ({ id: p.id, name: p.name, color: p.color })) };
  }
  replay() {
    return { version: 1, game: 'Blockwild', meta: this.meta(), duration: this.t, changes: this.world.changes.map(c => [r2(c[0] / TPS), c[1], c[2], c[3], c[4]]),
      frames: this.rec.frames, events: this.log };
  }
}

const MILESTONE = new Set(['wooden_pickaxe', 'stone_pickaxe', 'copper_ingot', 'iron_ingot', 'iron_pickaxe', 'gold_ingot', 'sapphire', 'sapphire_pickaxe', 'sapphire_sword',
  'iron_chestplate', 'sapphire_chestplate', 'bow', 'bread', 'bedroll', 'glow_dust', 'obsidian', 'blast_barrel']);

module.exports = { Game, TPS, DT, DEFAULTS, COLORS };
