'use strict';
// AI player commands. Each command is a generator that runs one step per game tick.
const defs = require('../shared/defs');
const { findPath } = require('./path');
const { pk } = require('./world');
const { B, BLOCKS, ITEMS, MOBS, RECIPES, BIOMES, BIOME } = defs;
const TPS = 20;
const SPEED = 5.2;
const REACH = 4.6;

// ---------- small helpers ----------
const num = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };
const label = n => (ITEMS[n] && ITEMS[n].label) || (BLOCKS[B[n]] && BLOCKS[B[n]].label) || n;
function feet(g, p) {
  const x = Math.floor(p.x), z = Math.floor(p.z);
  let y = Math.floor(p.y + 0.5);
  if (BLOCKS[g.world.get(x, y, z)].solid) y++;
  return { x, y, z };
}
const eyeDist = (p, x, y, z) => Math.hypot(p.x - x - 0.5, p.y + 1.62 - y - 0.5, p.z - z - 0.5);
function* wait(n) { for (let i = 0; i < n; i++) yield; }
const DIRV = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] };
function facing(p) { const a = p.yaw; const dx = Math.sin(a), dz = Math.cos(a); return Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)]; }
function dirName(dx, dz) {
  const a = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / 45) % 8];
}
const FILLERS = ['dirt', 'cobblestone', 'darkstone', 'granite', 'sandstone', 'stone', 'netherrack', 'oak_planks', 'birch_planks', 'pine_planks'];
const filler = (g, p) => FILLERS.find(n => ITEMS[n] && g.count(p, n) > 0);

// item/block name resolution with friendly aliases
const ALIAS = { wood: '#log', log: '#log', logs: '#log', tree: '#log', trees: '#log', planks: '#planks', plank: '#planks', leaves: '#leaves', coal: 'coal_ore', iron: 'iron_ore',
  copper: 'copper_ore', gold: 'gold_ore', sapphire: 'sapphire_ore', sapphires: 'sapphire_ore', diamond: 'sapphire_ore', glow: 'glow_crystal', crystal: 'glow_crystal',
  ore: '#ore', ores: '#ore', stone: 'stone', rock: 'stone', cobble: 'cobblestone', table: 'workbench', crafting_table: 'workbench', carpet: 'red_carpet', rug: 'red_carpet', sugar_cane: 'reeds', spruce_log: 'pine_log', spruce_planks: 'pine_planks', lapis: 'lapis_lazuli', redstone: 'redstone_dust', cod: 'raw_cod', salmon: 'raw_salmon', berries: 'sweet_berries', tnt: 'blast_barrel',
  grass: 'grass', flowers: '#flower', flower: '#flower', mushroom: 'brown_mushroom', mushrooms: '#mushroom', sugarcane: 'reeds', cane: 'reeds', wheat: 'wheat_3',
  emberite: 'emberite_ore', skycrystal: 'skycrystal_ore', sky_crystal: 'skycrystal_ore', portal: '#portal', gate: '#portal', obsidian: 'obsidian', marble: 'marble', cinder: 'cinderstone' };
const DROPPED_BY = {};
for (const b of BLOCKS) {
  const d = b.drop;
  const items = !d ? [] : typeof d === 'string' ? [d] : d.filter(x => !x.chance || x.chance > 0.5).map(x => x.item);
  for (const it of items) (DROPPED_BY[it] = DROPPED_BY[it] || []).push(b.id);
}
const PORTAL_IDS = new Set(BLOCKS.filter(b => b.portal).map(b => b.id));
function blockSpec(word) {
  if (ALIAS[word] === '#portal' || word === '#portal') return { label: 'gate', ids: PORTAL_IDS };
  if (!word) return null;
  let w = word.toLowerCase().replace(/s$/, m => (B[word.toLowerCase()] != null || ITEMS[word.toLowerCase()]) ? m : '');
  if (B[word.toLowerCase()] != null) w = word.toLowerCase();
  const a = ALIAS[w] || ALIAS[word.toLowerCase()] || w;
  if (a === '#ore') return { label: 'ore', ids: new Set(BLOCKS.filter(b => b.ore).map(b => b.id)), ore: true };
  if (a === '#flower') return { label: 'flowers', ids: new Set([B.emberbloom, B.sunpetal, B.frostbell]) };
  if (a === '#mushroom') return { label: 'mushrooms', ids: new Set([B.brown_mushroom, B.glowcap]) };
  if (a[0] === '#') { const ids = new Set(BLOCKS.filter(b => b.group === a.slice(1)).map(b => b.id)); return ids.size ? { label: a.slice(1), ids } : null; }
  if (B[a] != null) {
    const ids = new Set([B[a]]);
    if (a === 'stone') ids.add(B.cobblestone).add(B.darkstone);
    return { label: a, ids, ore: BLOCKS[B[a]].ore, common: ['stone', 'dirt', 'sand', 'gravel', 'cobblestone', 'darkstone', 'clay', 'snow_block'].includes(a) };
  }
  if (DROPPED_BY[a]) return { label: a, ids: new Set(DROPPED_BY[a]), ore: DROPPED_BY[a].some(i => BLOCKS[i].ore), common: a === 'cobblestone' || a === 'dirt' };
  return null;
}
function itemName(word) {
  if (!word) return null;
  const w = word.toLowerCase();
  if (ITEMS[w]) return w;
  if (ITEMS[w.replace(/s$/, '')]) return w.replace(/s$/, '');
  const fix = { table: 'workbench', crafting_table: 'workbench', planks: 'oak_planks', wood: 'oak_log', log: 'oak_log', carpet: 'red_carpet', tnt: 'blast_barrel', sword: 'wooden_sword', pickaxe: 'wooden_pickaxe' };
  return fix[w] || null;
}

// ---------- movement ----------
function* walkPath(g, p, path) {
  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    if (node.digs) for (const [x, y, z] of node.digs) if (g.world.solid(x, y, z)) { if (!(yield* breakAt(g, p, x, y, z, { noMove: true }))) return false; }
    if (node.place) {
      const [x, y, z] = node.place, f = filler(g, p);
      if (!f) return false;
      const pillar = x === Math.floor(p.x) && z === Math.floor(p.z);
      if (pillar) {
        g.stop(p); p.jump = true;
        let t = 0;
        while (p.y < y + 1.05 && t++ < 20) { yield; }
      } else g.face(p, x + 0.5, y + 0.5, z + 0.5);
      if (g.placeBlock(p, x, y, z, f)) return false;
      yield;
    }
    let t = 0, best = Infinity, still = 0;
    const last = i === path.length - 1;
    for (;;) {
      const dx = node.x + 0.5 - p.x, dz = node.z + 0.5 - p.z, d = Math.hypot(dx, dz), dy = node.y - p.y;
      if (d < (last ? 0.25 : 0.4) && dy > -0.6 && dy < 0.6) break;
      if (d < 0.4 && dy <= -0.6) { g.stop(p); if (++t > 60) return false; yield; continue; }
      // stuck on a corner: sidestep instead of hopping in place
      if (still > 35) { const sd = (Math.floor(still / 20) % 2) ? 1 : -1; g.steer(p, dx - dz * sd * 1.5, dz + dx * sd * 1.5, SPEED); }
      else g.steer(p, dx, dz, d < 0.6 ? SPEED * 0.5 : SPEED);
      if (dy > 0.3 && d < 1.5) { if (p.onGround) p.jump = true; if (p.inWater) p.swimUp = true; if (p.onLadder) p.climbUp = true; }
      if (p.inWater && (dy > -0.3 || p.headInWater && p.air < 200)) p.swimUp = true;
      if (d < best - 0.02) { best = d; still = 0; } else if (++still > 25) { p.jump = true; if (still > 70) { g.stop(p); return false; } }
      if (++t > 160) { g.stop(p); return false; }
      yield;
    }
  }
  if (path.length) g.stop(p);
  return true;
}
// underground = at least 3 solid opaque blocks overhead (a hut roof or a tree doesn't count)
function underground(g, p) {
  const f = feet(g, p);
  let n = 0;
  for (let y = f.y + 2; y < 128 && n < 3; y++) { const b = g.world.def(f.x, y, f.z); if (b.solid && b.opaque) n++; }
  if (n < 3) return false;
  // under a cliff or overhang: open sky within a few steps at the same level means we are outside
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
    const x = f.x + dx, z = f.z + dz;
    if (g.world.solid(x, f.y, z) || g.world.solid(x, f.y + 1, z)) continue;
    let open = true;
    for (let y = f.y + 2; y < 128; y++) { const b = g.world.def(x, y, z); if (b.solid && b.opaque) { open = false; break; } }
    if (open) return false;
  }
  return true;
}
// best flat 7x7 hut site near the player, at about the player's level (null if none)
function hutSite(g, p, f, dx, dz) {
  return hutSearch(g, f, dx, dz, 6, 4) || hutSearch(g, f, dx, dz, 12, 8);
}
function hutSearch(g, f, dx, dz, R, maxDy) {
  let best = null;
  for (let r = 0; r <= R; r++) for (let ox = -r; ox <= r; ox++) for (let oz = -r; oz <= r; oz++) {
    if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
    const cx = f.x + dx * 5 + ox, cz = f.z + dz * 5 + oz;
    if (Math.abs(cx - f.x) <= 3 && Math.abs(cz - f.z) <= 3) continue;
    const hs = [];
    let wet = false;
    for (let x = cx - 3; x <= cx + 3 && !wet; x++) for (let z = cz - 3; z <= cz + 3; z++) {
      if (!g.world.inBounds(x, z)) { wet = true; break; }
      let h = g.world.height(x, z);
      while (h > 0 && (g.world.def(x, h, z).group === 'leaves' || g.world.def(x, h, z).group === 'log' || g.world.def(x, h, z).render === 'cross')) h--;
      if (g.world.def(x, h, z).liquid) { wet = true; break; }
      hs.push(h);
    }
    if (wet) continue;
    hs.sort((a, b) => a - b);
    const med = hs[24], dy = Math.abs(med + 1 - f.y);
    if (dy > maxDy) continue;
    let spread = 0;
    for (const h of hs) spread += Math.abs(h - med);
    const score = spread + dy * 3 + r * 0.6;
    if (!best || score < best.score) best = { cx, cz, y0: med + 1, score };
  }
  return best;
}
// dig a staircase up to daylight (heading toward tx,tz when given)
function* climbOut(g, p, tx, tz) {
  for (let i = 0; i < 90; i++) {
    const f = feet(g, p);
    if (!underground(g, p)) return true;
    p.doing = 'climbing to the surface';
    let first = facing(p);
    if (tx != null) first = Math.abs(tx - f.x) > Math.abs(tz - f.z) ? [Math.sign(tx - f.x) || 1, 0] : [0, Math.sign(tz - f.z) || 1];
    const dirs = [first, [first[1], -first[0]], [-first[1], first[0]], [-first[0], -first[1]]];
    const ok = dirs.find(([dx, dz]) => [[f.x, f.y + 2, f.z], [f.x + dx, f.y + 1, f.z + dz], [f.x + dx, f.y + 2, f.z + dz], [f.x + dx, f.y + 3, f.z + dz]]
      .every(([x, y, z]) => g.world.def(x, y, z).liquid !== 'lava' && g.world.get(x, y, z) !== B.bedrock));
    if (!ok) return false;
    const [dx, dz] = ok, nx = f.x + dx, nz = f.z + dz;
    const cells = [[f.x, f.y + 1, f.z], [f.x, f.y + 2, f.z], [nx, f.y + 1, nz], [nx, f.y + 2, nz]];
    for (let k = 0; k < 12; k++) { // sand and gravel keep falling in; keep digging until it settles
      const solid = cells.filter(([x, y, z]) => g.world.solid(x, y, z));
      if (!solid.length) break;
      for (const [x, y, z] of solid) if (!(yield* breakAt(g, p, x, y, z, { noMove: true }))) return false;
      if (cells.some(([x, y, z]) => g.world.def(x, y + 1, z).gravity)) yield* wait(8);
    }
    if (!g.world.solid(nx, f.y, nz)) { const fl = filler(g, p); if (!fl || g.placeBlock(p, nx, f.y, nz, fl)) return false; }
    if (!(yield* walkPath(g, p, [{ x: nx, y: f.y + 1, z: nz }]))) { p.jump = true; yield* wait(10); }
  }
  return !underground(g, p);
}
// go until goal.isGoal(feet). goal = { isGoal, hx, hy, hz }
function* goTo(g, p, goal, o = {}) {
  if (o.surface && underground(g, p)) yield* climbOut(g, p, goal.hx, goal.hz);
  for (let attempt = 0; attempt < (o.tries || 4); attempt++) {
    const s = feet(g, p);
    if (goal.isGoal(s.x, s.y, s.z)) { g.stop(p); return true; }
    const far = Math.hypot(goal.hx - s.x, goal.hz - s.z) > 56;
    let target = goal;
    if (far) { // walk in legs of ~40 blocks
      const dx = goal.hx - s.x, dz = goal.hz - s.z, d = Math.hypot(dx, dz);
      const lx = Math.floor(s.x + dx / d * 40), lz = Math.floor(s.z + dz / d * 40), ly = g.world.height(lx, lz) + 1;
      target = { hx: lx, hy: ly, hz: lz, isGoal: (x, y, z) => Math.abs(x - lx) <= 3 && Math.abs(z - lz) <= 3 && y >= g.world.height(x, z) - 1 };
    }
    let path = findPath(g.world, s.x, s.y, s.z, target, { maxNodes: 2500 });
    if (!path) path = findPath(g.world, s.x, s.y, s.z, target, {
      dig: o.dig === false ? null : id => g.digCost(p, id), place: o.place !== false && !!filler(g, p), maxNodes: o.maxNodes || 5000, partial: true,
    });
    if (!path || !path.length) { if (attempt === 0) { p.jump = true; yield* wait(6); continue; } return false; }
    const ok = yield* walkPath(g, p, path);
    if (far && ok) { attempt = -1; continue; }
    if (!ok) yield* wait(4);
  }
  const s = feet(g, p);
  return goal.isGoal(s.x, s.y, s.z);
}
function* goNear(g, p, x, y, z, reach = REACH, o = {}) {
  const exposed = g.world.exposed(x, y, z) || !g.world.solid(x, y, z);
  const isGoal = (cx, cy, cz) => {
    if (cx === x && cz === z && (cy === y || cy + 1 === y)) return false; // never stand inside the target
    if (!exposed) return (Math.abs(cx - x) + Math.abs(cz - z) === 1 && (cy === y || cy + 1 === y)) || (cx === x && cz === z && cy === y + 1);
    return Math.hypot(cx + 0.5 - x - 0.5, cy + 1.62 - y - 0.5, cz + 0.5 - z - 0.5) <= reach;
  };
  return yield* goTo(g, p, { isGoal, hx: x, hy: y, hz: z }, o);
}
function* goToEntity(g, p, e, within = 2.5) {
  for (let i = 0; i < 6 && !e.dead && g.dist(p, e) > within; i++) {
    const tx = Math.floor(e.x), ty = Math.floor(e.y + 0.5), tz = Math.floor(e.z);
    const ok = yield* goTo(g, p, { hx: tx, hy: ty, hz: tz, isGoal: (x, y, z) => Math.hypot(x - tx, z - tz) <= Math.max(1, within - 1) && Math.abs(y - ty) <= 2 }, { tries: 1 });
    if (!ok) yield* wait(10);
  }
  return !e.dead && g.dist(p, e) <= within + 0.5;
}

// ---------- block actions ----------
function* breakAt(g, p, x, y, z, o = {}) {
  let id = g.world.get(x, y, z);
  if (!id || BLOCKS[id].liquid) return true;
  if (BLOCKS[id].hardness < 0) return false;
  if (!o.noMove && eyeDist(p, x, y, z) > REACH + 0.3) {
    if (!(yield* goNear(g, p, x, y, z))) return false;
    id = g.world.get(x, y, z);
    if (!id) return true;
  }
  const s = g.bestTool(p, id);
  if (s) p.held = s;
  const ticks = g.breakTicks(s, id);
  if (!isFinite(ticks)) return false;
  g.stop(p);
  const ck = x + ',' + y + ',' + z;
  g.claims = g.claims || new Map();
  g.claims.set(ck, { id: p.id, until: g.tick + ticks + 40 });
  for (let t = 0; t < ticks; t++) {
    g.face(p, x + 0.5, y + 0.5, z + 0.5);
    p.swingT = 4;
    if (t % 5 === 0 && ticks > 4) g.event({ type: 'crack', x, y, z, p: Math.round(t / ticks * 9) });
    if (g.world.get(x, y, z) !== id) return 'other';
    yield;
  }
  g.breakBlock(p, x, y, z);
  g.claims.delete(ck);
  return true;
}
function* placeAt(g, p, x, y, z, name) {
  if (eyeDist(p, x, y, z) > REACH + 0.3 || overlaps(p, x, y, z)) {
    const ok = yield* goTo(g, p, { hx: x, hy: y, hz: z, isGoal: (cx, cy, cz) => !(cx === x && cz === z && (cy === y || cy + 1 === y)) && Math.hypot(cx + 0.5 - x - 0.5, cy + 1.62 - y - 0.5, cz + 0.5 - z - 0.5) <= REACH && !(Math.abs(cx - x) <= 0 && Math.abs(cz - z) <= 0) });
    if (!ok) return 'could not get there';
  }
  g.face(p, x + 0.5, y + 0.5, z + 0.5);
  const cur = BLOCKS[g.world.get(x, y, z)];
  if (cur.replaceable && cur.render === 'cross') g.setBlock(x, y, z, 0);
  const err = g.placeBlock(p, x, y, z, name);
  yield* wait(3);
  return err;
}
const overlaps = (p, x, y, z) => p.x + 0.3 > x && p.x - 0.3 < x + 1 && p.z + 0.3 > z && p.z - 0.3 < z + 1 && p.y + 1.8 > y && p.y < y + 1;

function findBlocks(g, p, ids, o = {}) {
  const r = o.radius || 24, ry = o.ry || Math.min(r, 20), f = o.at || feet(g, p), out = [];
  const want = new Uint8Array(256);
  for (const id of ids) want[id] = 1;
  const y0 = Math.max(1, f.y - ry), y1 = Math.min(126, f.y + ry);
  for (let cx = (f.x - r) >> 4; cx <= (f.x + r) >> 4; cx++) for (let cz = (f.z - r) >> 4; cz <= (f.z + r) >> 4; cz++) {
    const c = g.world.chunk(cx, cz);
    if (!c) continue;
    const bx = cx * 16, bz = cz * 16;
    const lx0 = Math.max(0, f.x - r - bx), lx1 = Math.min(15, f.x + r - bx), lz0 = Math.max(0, f.z - r - bz), lz1 = Math.min(15, f.z + r - bz);
    for (let y = y0; y <= y1; y++) for (let lz = lz0; lz <= lz1; lz++) for (let lx = lx0; lx <= lx1; lx++) {
      const id = c.blocks[(y << 8) | (lz << 4) | lx];
      if (!want[id]) continue;
      const x = bx + lx, z = bz + lz, k = pk(x, y, z);
      if (o.skip && o.skip.has(k)) continue;
      if (o.noPlaced && g.world.placed.has(k)) continue;
      if (!o.hidden && !g.world.exposed(x, y, z)) continue;
      out.push({ x, y, z, id, d: Math.hypot(x - f.x, (y - f.y) * 1.6, z - f.z), k });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return o.limit ? out.slice(0, o.limit) : out;
}

// ---------- crafting ----------
function recipesFor(name) { return RECIPES.filter(r => r.out === name); }
function nearBlock(g, p, ids, r = 5) { const list = findBlocks(g, p, new Set(ids), { radius: r, ry: 3, hidden: true, limit: 1 }); return list[0] || null; }
function* ensureStation(g, p, name, craftable) {
  const ids = name === 'furnace' ? [B.furnace, B.furnace_lit] : [B[name]];
  let st = nearBlock(g, p, ids, 5);
  if (st) return st;
  if (!g.count(p, name) && craftable) yield* craft(g, p, name, 1, 1, []);
  if (!g.count(p, name)) return null;
  const f = feet(g, p);
  const spots = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 1; dy++) {
    const x = f.x + dx, y = f.y + dy, z = f.z + dz;
    if ((dx === 0 && dz === 0) || !g.world.def(x, y, z).replaceable || g.world.def(x, y, z).liquid || !g.world.solid(x, y - 1, z)) continue;
    spots.push([Math.abs(dx) + Math.abs(dz) + Math.abs(dy) * 2, x, y, z]);
  }
  spots.sort((a, b) => a[0] - b[0]);
  for (const [, x, y, z] of spots.slice(0, 6)) if (!(yield* placeAt(g, p, x, y, z, name))) return { x, y, z };
  const f2 = feet(g, p);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = f2.x + dx, y = f2.y, z = f2.z + dz;
    if (!g.world.solid(x, y, z) || !isFinite(g.digCost(p, g.world.get(x, y, z))) || !g.world.solid(x, y - 1, z)) continue;
    if (!(yield* breakAt(g, p, x, y, z, { noMove: true }))) continue;
    if (!(yield* placeAt(g, p, x, y, z, name))) return { x, y, z };
  }
  return null;
}
// crafts `count` of item, auto-crafting missing intermediate parts. Returns true on success.
function* craft(g, p, name, count, depth, log, why = {}) {
  const rs = recipesFor(name);
  if (!rs.length) { why.msg = `${name} has no crafting recipe${defs.smeltResult(name) || Object.values(defs.SMELT).includes(name) ? ' (smelt it instead)' : ''}`; return false; }
  let best = null, bestMissing = Infinity;
  for (const r of rs) {
    const times = Math.ceil(count / r.n);
    let missing = 0;
    for (const [k, q] of Object.entries(r.ing)) missing += Math.max(0, q * times - g.count(p, k));
    if (missing < bestMissing) { bestMissing = missing; best = r; }
  }
  const r = best, times = Math.ceil(count / r.n);
  for (const [k, q] of Object.entries(r.ing)) {
    let need = q * times - g.count(p, k);
    if (need <= 0) continue;
    if (depth >= 3) { why.msg = `need ${need} more ${k.replace('#', 'any ')}`; return false; }
    const cands = k[0] === '#' ? (defs.GROUPS[k.slice(1)] || []) : [k];
    for (const c of cands) {
      if (need <= 0) break;
      const sub = recipesFor(c);
      if (!sub.length) continue;
      const before = g.count(p, k);
      // only try this candidate if its own ingredients are on hand (or craftable)
      yield* craft(g, p, c, need, depth + 1, log, {});
      need -= g.count(p, k) - before;
    }
    if (need > 0) { why.msg = `need ${need} more ${k.replace('#', 'any ')}`; return false; }
  }
  if (r.table) {
    const t = yield* ensureStation(g, p, 'workbench', true);
    if (!t) { why.msg = `${name} needs a workbench nearby (craft one from 4 planks)`; return false; }
    if (eyeDist(p, t.x, t.y, t.z) > 6) yield* goNear(g, p, t.x, t.y, t.z);
    g.face(p, t.x + 0.5, t.y + 0.5, t.z + 0.5);
  }
  for (const [k, q] of Object.entries(r.ing)) g.take(p, k, q * times);
  const left = g.give(p, name, r.n * times);
  if (left) g.dropItem(p.x, p.y + 1, p.z, name, left);
  p.stats.crafted[name] = (p.stats.crafted[name] || 0) + r.n * times;
  p.swingT = 6;
  g.event({ type: 'craft', id: p.id, item: name, n: r.n * times });
  log.push(`${r.n * times} ${name}`);
  yield* wait(6);
  return true;
}
function canCraftNow(g, p) {
  const out = [];
  const table = !!nearBlock(g, p, [B.workbench], 5) || g.count(p, 'workbench') > 0;
  for (const r of RECIPES) {
    if (r.table && !table) continue;
    if (Object.entries(r.ing).every(([k, q]) => g.count(p, k) >= q) && !out.includes(r.out)) out.push(r.out);
  }
  return out;
}

// ---------- commands ----------
const C = {};
const H = {}; // help text

H.goto = 'goto X Y Z | goto X Z | goto <player|spawn|home|bed|biome|block>';
C.goto = function* (g, p, a) {
  const w = (a[0] || '').toLowerCase();
  let x, y, z;
  if (a.length >= 2 && num(a[0]) != null) {
    x = num(a[0]);
    if (a.length >= 3 && num(a[2]) != null) { y = num(a[1]); z = num(a[2]); } else { z = num(a[1]); y = null; }
  } else if (w === 'spawn') ({ x, y, z } = g.spawn);
  else if (w === 'home' || w === 'bed') {
    const h = w === 'home' ? p.home || p.bed : p.bed || p.home;
    if (!h) return `FAILED goto ${w}: you have no ${w} yet (use: sethome, or sleep in a bedroll)`;
    ({ x, y, z } = h);
  } else {
    const pl = g.player(w);
    if (pl && pl !== p) { const ok = yield* goToEntity(g, p, pl, 3); return ok ? `reached ${pl.name}` : `FAILED goto ${pl.name}: could not reach them`; }
    if (BIOME[w] != null) return yield* C.explore(g, p, [w]);
    const spec = blockSpec(w);
    if (spec) {
      const t = findBlocks(g, p, spec.ids, { radius: 32, limit: 1 })[0];
      if (!t) return `FAILED goto ${w}: none visible within 32m`;
      const ok = yield* goNear(g, p, t.x, t.y, t.z, 2.5);
      return ok ? `reached ${spec.label} at ${t.x} ${t.y} ${t.z}` : `FAILED goto ${spec.label}: no path`;
    }
    return `FAILED goto: don't know "${a.join(' ')}"`;
  }
  x = Math.floor(x); z = Math.floor(z);
  if (!g.world.inBounds(x, z)) return `FAILED goto: ${x} ${z} is outside the world`;
  if (defs.realmAt(x, z) !== defs.realmAt(p.x, p.z)) return `FAILED goto: ${x} ${z} is in ${defs.realmAt(x, z).label}; walk through a gate first (enter)`;
  const ty = y == null ? g.world.height(x, z) + 1 : Math.floor(y);
  const ok = yield* goTo(g, p, { hx: x, hy: ty, hz: z, isGoal: (cx, cy, cz) => Math.abs(cx - x) <= 1 && Math.abs(cz - z) <= 1 && (y == null ? cy >= g.world.height(cx, cz) : Math.abs(cy - ty) <= 1) }, { tries: 6, surface: y == null || ty >= g.world.height(x, z) });
  const f = feet(g, p);
  return ok ? `arrived at ${f.x} ${f.y} ${f.z}` : `FAILED goto ${x} ${y == null ? '' : ty + ' '}${z}: stopped at ${f.x} ${f.y} ${f.z} (${Math.round(Math.hypot(f.x - x, f.z - z))}m away)`;
};

H.mine = 'mine <block|item> [count]  e.g. mine log 10, mine iron 5, mine stone 20';
C.mine = function* (g, p, a) {
  const spec = blockSpec(a[0]);
  if (!spec) return `FAILED mine: unknown block "${a[0]}"`;
  const n = Math.min(64, num(a[1]) || 1);
  const sample = BLOCKS[[...spec.ids][0]];
  if (sample.tier) {
    const lvl = Math.max(0, ...p.inv.map(s => ITEMS[s.id].tool && ITEMS[s.id].tool.type === sample.tool ? ITEMS[s.id].tool.level : 0));
    if (lvl < sample.tier) return `FAILED mine ${spec.label}: needs a ${['', 'wooden', 'stone', 'iron', 'sapphire'][sample.tier]} ${sample.tool} or better`;
  }
  let got = 0, fails = 0;
  const skip = new Set();
  // never strip other players' builds for raw materials (picking up a workbench/chest etc. still works)
  const noPlaced = ![...spec.ids].some(i => /workbench|furnace|chest|torch|bed|lantern|door/.test(BLOCKS[i].name));
  while (got < n) {
    let t = findBlocks(g, p, spec.ids, { radius: 16, skip, noPlaced, limit: 1 })[0] || findBlocks(g, p, spec.ids, { radius: 36, ry: 24, skip, noPlaced, limit: 1 })[0];
    if (!t && spec.common) t = findBlocks(g, p, spec.ids, { radius: 5, ry: 6, hidden: true, skip, noPlaced, limit: 1 })[0];
    if (!t) break;
    const cl = g.claims && g.claims.get(t.x + ',' + t.y + ',' + t.z);
    if (cl && cl.id !== p.id && cl.until > g.tick) { skip.add(t.k); continue; }
    p.doing = `mining ${spec.label} (${got}/${n})`;
    const ok = yield* breakAt(g, p, t.x, t.y, t.z);
    if (ok === true && !spec.ids.has(g.world.get(t.x, t.y, t.z))) got++;
    else if (ok === 'other') skip.add(t.k);
    else { skip.add(t.k); if (++fails > 8) break; }
  }
  yield* wait(20);
  if (got >= n) return `mined ${got} ${spec.label}`;
  const why = spec.ore ? 'no more visible nearby. Ores hide underground: try stairs down, tunnel, or explore caves' : 'no more reachable nearby; try explore';
  return got ? `mined ${got}/${n} ${spec.label} (${why})` : `FAILED mine ${spec.label}: ${why}`;
};

H.dig = 'dig X Y Z | dig down N';
C.dig = function* (g, p, a) {
  if ((a[0] || '').toLowerCase() === 'down') {
    const n = Math.min(60, num(a[1]) || 5);
    let done = 0;
    for (; done < n; done++) {
      const f = feet(g, p);
      for (let k = 1; k <= 3; k++) if (g.world.def(f.x, f.y - k, f.z).liquid) return `dug down ${done} blocks, stopped: ${g.world.def(f.x, f.y - k, f.z).liquid} below!`;
      if (g.world.get(f.x, f.y - 1, f.z) === B.bedrock) return `dug down ${done} blocks, hit bedrock`;
      if (!(yield* breakAt(g, p, f.x, f.y - 1, f.z, { noMove: true }))) return `dug down ${done} blocks, then got stuck`;
      p.x = f.x + 0.5; p.z = f.z + 0.5;
      yield* wait(8);
      yield* mineVisibleOres(g, p, 2, []);
    }
    return `dug down ${done} blocks to y ${feet(g, p).y}`;
  }
  const x = num(a[0]), y = num(a[1]), z = num(a[2]);
  if (x == null || y == null || z == null) return 'FAILED dig: use dig X Y Z or dig down N';
  const name = g.world.def(x, y, z).name;
  const ok = yield* breakAt(g, p, x, y, z);
  return ok ? `dug ${name} at ${x} ${y} ${z}` : `FAILED dig ${name} at ${x} ${y} ${z}`;
};

function* mineVisibleOres(g, p, r, found) {
  const ores = findBlocks(g, p, new Set(BLOCKS.filter(b => b.ore).map(b => b.id)), { radius: r, ry: r });
  for (const o of ores) {
    const b = BLOCKS[o.id];
    if (!g.canHarvest(g.bestTool(p, o.id), b)) { if (!found.includes(b.name + ' (need better pickaxe)')) found.push(b.name + ' (need better pickaxe)'); continue; }
    if (yield* breakAt(g, p, o.x, o.y, o.z)) found.push(b.name);
  }
}
function* tunnelOrStairs(g, p, a, down) {
  let n = Math.min(64, num(a[0]) || 10), dir = DIRV[(a[1] || a[0] || '').toLowerCase()];
  if (num(a[0]) == null && a[1]) n = Math.min(64, num(a[1]) || 10);
  const [dx, dz] = dir && Math.abs(dir[0]) + Math.abs(dir[1]) === 1 ? dir : facing(p);
  const found = [];
  let steps = 0, sinceTorch = 0;
  const f0 = feet(g, p);
  p.x = f0.x + 0.5; p.z = f0.z + 0.5;
  for (; steps < n; steps++) {
    const f = feet(g, p), nx = f.x + dx, nz = f.z + dz, ny = down ? f.y - 1 : f.y;
    if (!g.world.inBounds(nx, nz)) break;
    if (down && ny <= 3) { found.push('reached the bottom'); break; }
    const cells = down ? [[nx, ny + 2, nz], [nx, ny + 1, nz], [nx, ny, nz]] : [[nx, ny + 1, nz], [nx, ny, nz]];
    let danger = null;
    for (const [x, y, z] of cells) for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])
      if (g.world.def(x + ax, y + ay, z + az).liquid) danger = g.world.def(x + ax, y + ay, z + az).liquid;
    if (danger === 'lava') return `${down ? 'staircase' : 'tunnel'} stopped after ${steps} steps: LAVA ahead at about ${nx} ${ny} ${nz}. ${found.length ? 'Found: ' + summarize(found) : ''}`;
    for (const [x, y, z] of cells) if (g.world.solid(x, y, z) && !(yield* breakAt(g, p, x, y, z, { noMove: true }))) return `stopped after ${steps} steps: could not break ${g.world.def(x, y, z).name}`;
    if (!g.world.solid(nx, ny - 1, nz) && !g.world.def(nx, ny - 1, nz).liquid) { const fl = filler(g, p); if (fl) { g.placeBlock(p, nx, ny - 1, nz, fl); yield* wait(2); } }
    yield* walkPath(g, p, [{ x: nx, y: ny, z: nz }]);
    yield* mineVisibleOres(g, p, 2, found);
    const back = feet(g, p);
    if (back.x !== nx || back.z !== nz) yield* goTo(g, p, { hx: nx, hy: ny, hz: nz, isGoal: (x, y, z) => x === nx && z === nz && Math.abs(y - ny) <= 1 }, { tries: 2 });
    if (++sinceTorch >= 7 && g.count(p, 'torch')) {
      const f2 = feet(g, p);
      if (!g.placeBlock(p, f2.x - dx, f2.y, f2.z - dz, 'torch')) sinceTorch = 0;
    }
    if (danger === 'water') { found.push('water nearby'); }
  }
  const f = feet(g, p);
  return `${down ? 'staircase' : 'tunnel'} ${steps} steps ${dirName(dx, dz)}, now at ${f.x} ${f.y} ${f.z}${found.length ? '. Found: ' + summarize(found) : '. No ores seen'}`;
}
function summarize(list) { const c = {}; for (const s of list) c[s] = (c[s] || 0) + 1; return Object.entries(c).map(([k, v]) => v > 1 ? `${v} ${k}` : k).join(', '); }
H.stairs = 'stairs N [n|s|e|w]   dig a staircase down N steps (mines ores it sees, places torches)';
C.stairs = function* (g, p, a) { return yield* tunnelOrStairs(g, p, a, true); };
H.tunnel = 'tunnel N [n|s|e|w]   dig a 1x2 tunnel N blocks';
C.tunnel = function* (g, p, a) { return yield* tunnelOrStairs(g, p, a, false); };

H.place = 'place <block> X Y Z | place <block> (next to you)';
C.place = function* (g, p, a) {
  const name = itemName(a[0]);
  if (!name) return `FAILED place: unknown block "${a[0]}"`;
  let x = num(a[1]), y = num(a[2]), z = num(a[3]);
  if (x == null || y == null || z == null) {
    const f = feet(g, p), [dx, dz] = facing(p);
    const opts = [[f.x + dx, f.y, f.z + dz], [f.x - dz, f.y, f.z + dx], [f.x + dz, f.y, f.z - dx], [f.x - dx, f.y, f.z - dz]];
    const it = ITEMS[name], id = it.block != null ? it.block : B[it.places];
    const spot = opts.find(([x, y, z]) => !g.canPlaceAt(x, y, z, id));
    if (!spot) return `FAILED place ${name}: no free spot next to you`;
    [x, y, z] = spot;
  }
  const err = yield* placeAt(g, p, x, y, z, name);
  return err ? `FAILED place ${name} at ${x} ${y} ${z}: ${err}` : `placed ${name} at ${x} ${y} ${z}`;
};

H.sneak = 'sneak [seconds]   crouch and creep slowly (quiet, careful near edges); sneak 0 to stop';
C.sneak = function* (g, p, a) {
  const sec = a[0] == null ? 10 : Math.max(0, Math.min(120, Number(a[0]) || 0));
  if (!sec) { p.sneak = false; return 'stopped sneaking'; }
  p.sneak = true;
  yield* wait(sec * 20);
  p.sneak = false;
  return `sneaked for ${sec}s`;
};
H.fill = 'fill <block> X1 Y1 Z1 X2 Y2 Z2 [hollow|walls]   build a box of blocks (max 512). Add replace to swap out blocks already there (e.g. cobblestone walls -> oak_planks); you keep what you remove';
C.fill = function* (g, p, a) {
  const name = itemName(a[0]);
  const c = a.slice(1, 7).map(num);
  if (!name || c.some(v => v == null)) return 'FAILED fill: use fill <block> X1 Y1 Z1 X2 Y2 Z2 [hollow|walls]';
  return yield* fillBox(g, p, name, c, a.slice(7).join(' ').toLowerCase(), 'fill');
};
function* fillBox(g, p, name, c, mode, what, skipSet) {
  const [x1, y1, z1, x2, y2, z2] = c;
  const repl = /replace/.test(mode); mode = mode.replace('replace', '').trim();
  const lo = [Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)], hi = [Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)];
  const cells = [];
  for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) for (let z = lo[2]; z <= hi[2]; z++) {
    const edgeX = x === lo[0] || x === hi[0], edgeZ = z === lo[2] || z === hi[2], edgeY = y === lo[1] || y === hi[1];
    if (mode === 'hollow' && !(edgeX || edgeZ || edgeY)) continue;
    if (mode === 'walls' && !(edgeX || edgeZ)) continue;
    if (skipSet && skipSet.has(`${x},${y},${z}`)) continue;
    cells.push([x, y, z]);
  }
  if (cells.length > 512) return `FAILED ${what}: too big (${cells.length} blocks, max 512)`;
  let placed = 0, skipped = 0, err = null;
  const id = ITEMS[name] && (ITEMS[name].block != null ? ITEMS[name].block : B[ITEMS[name].places]);
  for (const [x, y, z] of cells) {
    const cur = g.world.get(x, y, z);
    if (cur === id) continue;
    if (!BLOCKS[cur].replaceable) {
      const cb = BLOCKS[cur];
      if (!repl || cb.hardness < 0 || cb.liquid || /chest|furnace|workbench|door|bed|torch|lantern|portal/.test(cb.name)) { skipped++; continue; }
      if (!g.count(p, name)) { err = `ran out of ${name}`; break; }
      p.doing = `swapping ${cb.name} (${placed}/${cells.length})`;
      if (!(yield* breakAt(g, p, x, y, z))) { skipped++; continue; }
    }
    if (!g.count(p, name)) { err = `ran out of ${name}`; break; }
    p.doing = `building (${placed}/${cells.length})`;
    const e = yield* placeAt(g, p, x, y, z, name);
    if (e) { skipped++; if (e === 'could not get there' && skipped > 12) { err = 'could not reach parts of it'; break; } } else placed++;
  }
  const left = cells.filter(([x, y, z]) => g.world.get(x, y, z) !== id && BLOCKS[g.world.get(x, y, z)].replaceable).length;
  return `${what}: placed ${placed} ${name}${left ? `, ${left} spots still empty` : ''}${err ? ` (${err})` : ''}`;
}

H.build = 'build hut [material] | build wall LEN [HEIGHT] [material] | build pillar H | build bridge LEN | build platform SIZE [material]';
C.build = function* (g, p, a) {
  const kind = (a[0] || '').toLowerCase();
  const f = feet(g, p);
  let [dx, dz] = facing(p);
  const matArg = a.find(s => itemName(s) && ITEMS[itemName(s)].block != null && BLOCKS[ITEMS[itemName(s)].block].solid);
  const best = () => ['oak_planks', 'birch_planks', 'pine_planks', 'stone_bricks', 'cobblestone', 'bricks', 'sandstone', 'darkstone', 'stone', 'granite', 'dirt'].sort((x, y) => g.count(p, y) - g.count(p, x))[0];
  const mat = matArg ? itemName(matArg) : best();
  if (kind === 'hut' || kind === 'house' || kind === 'shelter') {
    Object.assign(f, feet(g, p));
    let site = hutSite(g, p, f, dx, dz);
    if (!site && underground(g, p)) {
      if (!(yield* climbOut(g, p))) return 'FAILED build hut: could not get to the surface';
      Object.assign(f, feet(g, p));
      site = hutSite(g, p, f, dx, dz);
    }
    if (!site) return 'FAILED build hut: no flat spot nearby. Move to flatter ground (plains or a valley) and try again';
    // 7x7 room, door facing you, 3 high walls, flat roof
    const cx = site.cx, cz = site.cz, y0 = site.y0;
    const x0 = cx - 3, z0 = cz - 3;
    const doorX = cx - dx * 3, doorZ = cz - dz * 3;
    // clear the inside
    for (let y = y0; y <= y0 + 3; y++) for (let x = x0; x <= x0 + 6; x++) for (let z = z0; z <= z0 + 6; z++) {
      const b = g.world.def(x, y, z);
      if (b.solid && !b.replaceable && b.hardness >= 0 && b.hardness < 5) { p.doing = 'clearing the site'; yield* breakAt(g, p, x, y, z); }
      else if (b.render === 'cross') g.setBlock(x, y, z, 0);
    }
    for (let x = x0; x <= x0 + 6; x++) for (let z = z0; z <= z0 + 6; z++) if (!g.world.solid(x, y0 - 1, z) && g.world.solid(x, y0 - 2, z) && g.count(p, mat)) yield* placeAt(g, p, x, y0 - 1, z, mat);
    const skip = new Set([`${doorX},${y0},${doorZ}`, `${doorX},${y0 + 1},${doorZ}`]);
    const windows = g.count(p, 'glass') >= 3;
    if (windows) for (const [wx, wz] of [[cx + dx * 3, cz + dz * 3], [cx + dz * 3, cz - dx * 3], [cx - dz * 3, cz + dx * 3]]) skip.add(`${wx},${y0 + 1},${wz}`);
    let r = yield* fillBox(g, p, mat, [x0, y0, z0, x0 + 6, y0 + 2, z0 + 6], 'walls', 'walls', skip);
    if (windows) for (const [wx, wz] of [[cx + dx * 3, cz + dz * 3], [cx + dz * 3, cz - dx * 3], [cx - dz * 3, cz + dx * 3]]) yield* placeAt(g, p, wx, y0 + 1, wz, 'glass');
    // walk inside for the roof
    yield* goTo(g, p, { hx: cx, hy: y0, hz: cz, isGoal: (x, y, z) => Math.abs(x - cx) <= 1 && Math.abs(z - cz) <= 1 && y === y0 }, { tries: 2, place: false });
    const r2 = yield* fillBox(g, p, mat, [x0, y0 + 3, z0, x0 + 6, y0 + 3, z0 + 6], '', 'roof');
    if (g.count(p, 'torch')) { yield* placeAt(g, p, x0 + 1, y0, z0 + 1, 'torch'); yield* placeAt(g, p, x0 + 5, y0, z0 + 5, 'torch'); }
    p.home = { x: cx, y: y0, z: cz };
    return `hut at ${cx} ${y0} ${cz} (door ${doorX} ${doorZ}). ${r}; ${r2}. Home set here.`;
  }
  if (kind === 'wall') {
    const len = Math.min(32, num(a[1]) || 8), h = Math.min(6, num(a[2]) || 3);
    const sx = f.x + dx * 2 - dz * Math.floor(len / 2), sz = f.z + dz * 2 + dx * Math.floor(len / 2);
    return yield* fillBox(g, p, mat, [sx, f.y, sz, sx + dz * (len - 1), f.y + h - 1, sz - dx * (len - 1)], '', 'wall');
  }
  if (kind === 'platform' || kind === 'floor') {
    const s = Math.min(16, num(a[1]) || 5), h = Math.floor(s / 2);
    return yield* fillBox(g, p, mat, [f.x - h, f.y - 1, f.z - h, f.x - h + s - 1, f.y - 1, f.z - h + s - 1], '', 'platform');
  }
  if (kind === 'pillar' || kind === 'tower') {
    const h = Math.min(30, num(a[1]) || 5);
    let up = 0;
    for (; up < h; up++) {
      const fl = matArg ? mat : filler(g, p);
      if (!fl || !g.count(p, fl)) break;
      const s = feet(g, p);
      if (g.world.solid(s.x, s.y + 2, s.z)) break;
      g.stop(p); p.x = s.x + 0.5; p.z = s.z + 0.5; p.jump = true;
      let t = 0;
      while (p.y < s.y + 1.05 && t++ < 20) yield;
      if (g.placeBlock(p, s.x, s.y, s.z, fl)) break;
      yield* wait(4);
    }
    return `pillared up ${up} blocks, now at y ${feet(g, p).y}`;
  }
  if (kind === 'bridge') {
    const len = Math.min(40, num(a[1]) || 8);
    let n = 0;
    for (; n < len; n++) {
      const s = feet(g, p), nx = s.x + dx, nz = s.z + dz;
      if (!g.world.solid(nx, s.y - 1, nz)) {
        const fl = matArg ? mat : filler(g, p);
        if (!fl || !g.count(p, fl)) break;
        g.stop(p); g.face(p, nx + 0.5, s.y - 0.5, nz + 0.5);
        if (g.placeBlock(p, nx, s.y - 1, nz, fl)) break;
        yield* wait(3);
      }
      if (g.world.solid(nx, s.y, nz) || g.world.solid(nx, s.y + 1, nz)) break;
      if (!(yield* walkPath(g, p, [{ x: nx, y: s.y, z: nz }]))) break;
    }
    return `bridged ${n} blocks ${dirName(dx, dz)}`;
  }
  return 'FAILED build: options are hut, wall, platform, pillar, bridge (or use fill for custom shapes)';
};

H.craft = 'craft <item> [count]   (auto-makes planks/sticks and places a workbench if needed)';
C.craft = function* (g, p, a) {
  const name = itemName(a[0]);
  if (!name) return `FAILED craft: unknown item "${a[0]}"`;
  const n = Math.min(64, num(a[1]) || 1), log = [], why = {};
  p.doing = `crafting ${name}`;
  const ok = yield* craft(g, p, name, n, 0, log, why);
  if (ok) return `crafted ${log.join(', ')}`;
  return `FAILED craft ${name}: ${why.msg || 'missing ingredients'}${log.length ? ` (made ${log.join(', ')} on the way)` : ''}. Recipe: ${recipeText(name)}`;
};
function recipeText(name) {
  const rs = recipesFor(name);
  if (!rs.length) { const from = Object.entries(defs.SMELT).filter(([, o]) => o === name).map(([i]) => i.replace('#', 'any ')); return from.length ? `smelt ${from.join(' or ')} in a furnace` : 'not craftable'; }
  return rs.slice(0, 1).map(r => Object.entries(r.ing).map(([k, q]) => `${q} ${k.replace('#', 'any ')}`).join(' + ') + (r.table ? ' at a workbench' : '') + ` -> ${r.n}`).join('; ');
}

H.smelt = 'smelt <item> [count]   e.g. smelt raw_iron 6, smelt sand 4, smelt raw_venison 3 (needs a furnace + fuel)';
C.smelt = function* (g, p, a) {
  let name = itemName(a[0]) || (a[0] || '').toLowerCase();
  if (!defs.smeltResult(name)) {
    const from = Object.entries(defs.SMELT).filter(([, o]) => o === name).map(([i]) => i);
    const have = from.find(i => g.count(p, i) > 0);
    if (have && have[0] !== '#') name = have;
    else if (have) name = p.inv.find(s => defs.inGroup(s.id, have)).id;
    else if ((a[0] || '').toLowerCase() === 'iron') name = 'raw_iron';
    else return `FAILED smelt: can't smelt "${a[0]}"`;
  }
  const out = defs.smeltResult(name);
  let n = Math.min(64, num(a[1]) || g.count(p, name));
  if (!g.count(p, name)) return `FAILED smelt ${name}: you have none`;
  n = Math.min(n, g.count(p, name));
  const fz = yield* ensureStation(g, p, 'furnace', g.count(p, 'cobblestone') >= 8);
  if (!fz) return `FAILED smelt: no furnace nearby (craft one from 8 cobblestone at a workbench)`;
  const k = pk(fz.x, fz.y, fz.z);
  let fuel = g.furnaces.get(k) || 0, made = 0, err = null;
  try {
    g.setBlock(fz.x, fz.y, fz.z, B.furnace_lit);
    for (; made < n; made++) {
      if (fuel <= 0) {
        const fuels = p.inv.map(s => s.id).filter(id => defs.fuelValue(id) && id !== name).sort((x, y) => {
          const need = n - made, fx = defs.fuelValue(x), fy = defs.fuelValue(y);
          return (Math.abs(fx - need) - Math.abs(fy - need)) || (fx - fy);
        });
        if (!fuels.length) { err = 'out of fuel (coal, charcoal, logs or planks)'; break; }
        g.take(p, fuels[0], 1);
        if (fuels[0] === 'lava_bucket') g.give(p, 'bucket', 1);
        fuel += defs.fuelValue(fuels[0]);
      }
      p.doing = `smelting ${name} (${made}/${n})`;
      yield* wait(Math.round(g.config.smeltSec * TPS));
      if (!g.count(p, name)) break;
      g.take(p, name, 1);
      g.give(p, out, 1);
      fuel -= 1;
    }
  } finally {
    g.furnaces.set(k, fuel);
    if (g.world.get(fz.x, fz.y, fz.z) === B.furnace_lit) g.setBlock(fz.x, fz.y, fz.z, B.furnace);
  }
  if (made) g.event({ type: 'smelt', id: p.id, item: out, n: made });
  return made ? `smelted ${made} ${name} -> ${made} ${out}${err ? ` (${err})` : ''}` : `FAILED smelt ${name}: ${err || 'nothing smelted'}`;
};

H.eat = 'eat [food]';
C.eat = function* (g, p, a) {
  let eaten = 0;
  const want = itemName(a[0]);
  while (p.food < 20) {
    const s = want ? p.inv.find(s => s.id === want) : bestFood(p);
    if (!s || !ITEMS[s.id].food) break;
    if (p.eatT <= 0) g.startEat(p, s);
    while (p.eatT > 0) yield;
    eaten++;
    if (p.food >= 17 && !want) break;
  }
  if (!eaten && p.food >= 20) return 'not hungry (food 20/20); you eat automatically when hungry';
  return eaten ? `ate ${eaten} (food ${p.food}/20)` : `FAILED eat: ${want ? 'you have no ' + want : 'no food'}`;
};
function bestFood(p) {
  let best = null, score = -1;
  for (const s of p.inv) { const f = ITEMS[s.id].food; if (f && f.hunger + f.sat > score) { score = f.hunger + f.sat; best = s; } }
  return best;
}

H.equip = 'equip <item>';
C.equip = function* (g, p, a) {
  const name = itemName(a[0]);
  const s = name && p.inv.find(s => s.id === name);
  if (!s) return `FAILED equip: you have no ${a[0]}`;
  if (ITEMS[name].armor) { g.autoArmor(p); return `wearing ${name}`; }
  p.held = s;
  yield;
  return `holding ${name}`;
};

function findEntity(g, p, word, radius = 32) {
  const w = (word || '').toLowerCase();
  let best = null, bd = radius;
  for (const e of g.entities.values()) {
    if (e.dead || e === p) continue;
    if (e.kind === 'mob' && e.tamer != null && !(w === 'pet' && e.tamer === p.id)) continue;
    let match = false;
    if (e.kind === 'mob') match = !w || w === 'hostile' ? MOBS[e.type].kind === 'hostile' : w === 'animal' || w === 'food' ? MOBS[e.type].kind === 'passive' : e.type === w || e.type === w.replace(/s$/, '');
    else if (e.kind === 'player') match = e.name.toLowerCase() === w;
    if (!match) continue;
    const d = g.dist(p, e);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function* fight(g, p, e, maxTicks = 600) {
  let t = 0, fails = 0;
  while (!e.dead && t++ < maxTicks && g.dist(p, e) < 40) {
    const d = g.dist(p, e), bow = p.inv.find(s => s.id === 'bow');
    if (bow && g.count(p, 'arrow') && d > 5 && d < 22 && g.los(p, e)) {
      g.stop(p); g.face(p, e.x, e.y + e.h / 2, e.z); p.held = bow;
      if (p.attackCd <= 0) { g.take(p, 'arrow', 1); g.shoot(p, e, 'arrow', 6, 26); g.useTool(p, bow); p.attackCd = 18; p.swingT = 6; }
      yield; continue;
    }
    if (d > 2.8) {
      if (e.y - p.y > 4 && underground(g, p)) { yield* climbOut(g, p, Math.floor(e.x), Math.floor(e.z)); if (underground(g, p)) break; }
      if (d > 6 || p.hitWall) {
        const before = d;
        yield* goToEntity(g, p, e, 2.5);
        if (!e.dead && g.dist(p, e) >= before - 1) { if (++fails > 3) break; yield* wait(20); }
        continue;
      }
      g.steer(p, e.x - p.x, e.z - p.z, SPEED);
      if (p.hitWall && p.onGround) p.jump = true;
    } else {
      g.stop(p); g.face(p, e.x, e.y + e.h * 0.6, e.z);
      if (p.attackCd <= 0 && (e.kind !== 'player' || g.config.pvp)) g.attack(p, e);
    }
    yield;
  }
  g.stop(p);
  return e.dead;
}
H.attack = 'attack <mob|player|hostile>';
function* awaitDrops(g, p) {
  for (let i = 0; i < 80; i++) {
    let pending = false;
    for (const e of g.entities.values()) if (e.kind === 'item' && !e.dead && e.magnet === p.id) { pending = true; break; }
    if (!pending) return;
    yield;
  }
}
C.attack = function* (g, p, a) {
  const e = findEntity(g, p, a[0], MOBS[(a[0] || '').toLowerCase()] && MOBS[(a[0] || '').toLowerCase()].boss ? 120 : 32);
  if (!e) return `FAILED attack: no ${a[0] || 'hostile mob'} within 32m`;
  if (e.kind === 'player' && !g.config.pvp) return 'FAILED attack: player fighting is turned off';
  const name = e.kind === 'player' ? e.name : MOBS[e.type].label;
  p.doing = `fighting ${name}`;
  const ok = yield* fight(g, p, e);
  yield* wait(12);
  yield* awaitDrops(g, p);
  return ok ? `defeated ${name}` : `FAILED attack ${name}: it got away`;
};
H.hunt = 'hunt <mob|animal> [count]';
C.hunt = function* (g, p, a) {
  const n = Math.min(20, num(a[1]) || 1);
  let k = 0, misses = 0;
  while (k < n && misses < 3) {
    const e = findEntity(g, p, a[0] || 'animal', 48);
    if (!e) break;
    p.doing = `hunting ${MOBS[e.type] ? MOBS[e.type].label : a[0]} (${k}/${n})`;
    if (yield* fight(g, p, e)) k++; else misses++;
  }
  yield* wait(14);
  yield* awaitDrops(g, p);
  return k ? `hunted ${k}/${n} ${a[0] || 'animals'}` : `FAILED hunt: no ${a[0] || 'animals'} found within 48m`;
};
C.fight = function* (g, p) { return yield* C.attack(g, p, ['hostile']); };
C.kill = C.attack;

H.explore = 'explore [n|s|e|w|ne|...|<biome>] [distance]';
C.explore = function* (g, p, a) {
  const w = (a[0] || '').toLowerCase(), f = feet(g, p);
  let tx, tz;
  if (BIOME[w] != null) {
    let found = null;
    for (let r = 16; r < 360 && !found; r += 16) for (let i = 0; i < 24; i++) {
      const x = Math.floor(f.x + Math.cos(i / 24 * 6.283) * r), z = Math.floor(f.z + Math.sin(i / 24 * 6.283) * r);
      if (g.world.inBounds(x, z) && g.world.gen.column(x, z).b === BIOME[w]) { found = [x, z]; break; }
    }
    if (!found) return `FAILED explore: no ${w} biome found nearby`;
    [tx, tz] = found;
  } else {
    let d = DIRV[w];
    const dist = Math.min(200, num(a[1]) || num(a[0]) || 64);
    if (!d) { const ang = g.rng() * 6.283; d = [Math.cos(ang), Math.sin(ang)]; }
    const n = Math.hypot(d[0], d[1]);
    tx = Math.floor(f.x + d[0] / n * dist); tz = Math.floor(f.z + d[1] / n * dist);
    const R = defs.realmAt(f.x, f.z);
    tx = Math.max(R.cx0 * 16 + 4, Math.min(R.cx1 * 16 - 5, tx)); tz = Math.max(R.cz0 * 16 + 4, Math.min(R.cz1 * 16 - 5, tz));
  }
  p.doing = `exploring toward ${tx} ${tz}`;
  yield* goTo(g, p, { hx: tx, hy: g.world.height(tx, tz) + 1, hz: tz, isGoal: (x, y, z) => Math.abs(x - tx) <= 4 && Math.abs(z - tz) <= 4 && y >= g.world.height(x, z) }, { tries: 5, surface: true });
  const e = feet(g, p), short = Math.round(Math.hypot(e.x - tx, e.z - tz));
  return `${short > 6 ? `explore stopped ${short}m short, at` : 'explored to'} ${e.x} ${e.y} ${e.z} (${BIOMES[g.world.gen.column(e.x, e.z).b].name}${underground(g, p) ? ', underground' : ''})`;
};

H.follow = 'follow <player> [seconds]';
C.follow = function* (g, p, a) {
  const t = g.player(a[0] || '');
  if (!t || t === p) return `FAILED follow: no player "${a[0]}"`;
  const until = g.tick + Math.min(300, num(a[1]) || 60) * TPS;
  while (g.tick < until && !t.dead) {
    p.doing = `following ${t.name}`;
    if (g.dist(p, t) > 4) yield* goToEntity(g, p, t, 3); else { g.stop(p); g.face(p, t.x, t.y + 1.6, t.z); yield* wait(10); }
  }
  return `followed ${t.name}`;
};

H.say = 'say <message>';
C.say = function* (g, p, a) { g.say(p, a.join(' ')); yield; return null; };

H.give = 'give <player> <item> [count]';
C.give = function* (g, p, a) {
  const t = g.player(a[0] || ''), name = itemName(a[1]);
  if (!t || t === p) return `FAILED give: no player "${a[0]}"`;
  if (!name || !g.count(p, name)) return `FAILED give: you have no ${a[1]}`;
  const n = Math.min(g.count(p, name), num(a[2]) || 1);
  if (!(yield* goToEntity(g, p, t, 3))) return `FAILED give: could not reach ${t.name}`;
  const taken = g.take(p, name, n);
  let given = 0;
  for (const [id, k] of taken) { const left = g.give(t, id, k); given += k - left; if (left) g.dropItem(t.x, t.y + 1, t.z, id, left); }
  t.notes.push(`${p.name} gave you ${given} ${name}`);
  g.event({ type: 'give', id: p.id, to: t.id, item: name, n: given });
  p.swingT = 6;
  return `gave ${given} ${name} to ${t.name}`;
};
H.drop = 'drop <item> [count]';
C.drop = function* (g, p, a) {
  const name = itemName(a[0]);
  if (!name || !g.count(p, name)) return `FAILED drop: you have no ${a[0]}`;
  const n = Math.min(g.count(p, name), num(a[1]) || 1);
  for (const [id, k] of g.take(p, name, n)) { const it = g.dropItem(p.x + Math.sin(p.yaw), p.y + 1.2, p.z + Math.cos(p.yaw), id, k, { pickup: 60 }); }
  yield;
  return `dropped ${n} ${name}`;
};
H.collect = 'collect   pick up items lying nearby';
C.collect = function* (g, p) {
  let n = 0;
  for (let i = 0; i < 12; i++) {
    let best = null, bd = 14;
    for (const e of g.entities.values()) if (e.kind === 'item' && !e.dead && e.pickup <= 0 && g.dist(p, e) < bd) { bd = g.dist(p, e); best = e; }
    if (!best) break;
    const ok = yield* goToEntity(g, p, best, 1);
    if (ok || best.dead) n++; else break;
    yield* wait(4);
  }
  return n ? `collected items (${n} stacks)` : 'no items to collect nearby';
};

function* chestNear(g, p) {
  const c = yield* ensureStation(g, p, 'chest', false);
  if (!c) return null;
  if (eyeDist(p, c.x, c.y, c.z) > REACH) yield* goNear(g, p, c.x, c.y, c.z);
  const k = pk(c.x, c.y, c.z);
  if (!g.world.containers.has(k)) g.world.containers.set(k, []);
  return { c, list: g.world.containers.get(k) };
}
H.store = 'store <item|all> [count]   put items in a chest within 5m (places one from your inventory if needed)';
C.store = function* (g, p, a) {
  const ch = yield* chestNear(g, p);
  if (!ch) return 'FAILED store: no chest nearby (craft one from 8 planks)';
  const all = (a[0] || 'all').toLowerCase() === 'all';
  const name = all ? null : itemName(a[0]);
  if (!all && !name) return `FAILED store: unknown item ${a[0]}`;
  const keep = new Set(['torch']);
  let moved = 0;
  for (const s of p.inv.slice()) {
    if (all ? (ITEMS[s.id].tool || ITEMS[s.id].food || keep.has(s.id)) : s.id !== name) continue;
    if (ch.list.length >= 27) break;
    const n = all ? s.n : Math.min(s.n, (num(a[1]) || s.n) - moved);
    if (n <= 0) break;
    const ex = ch.list.find(x => x.id === s.id && x.n + n <= ITEMS[s.id].stack);
    if (ex) ex.n += n; else ch.list.push({ id: s.id, n, dur: s.dur });
    s.n -= n; moved += n;
    if (s.n <= 0) g.removeStack(p, s);
  }
  g.event({ type: 'chest', id: p.id, x: ch.c.x, y: ch.c.y, z: ch.c.z });
  yield* wait(6);
  return `stored ${moved} item(s) in the chest at ${ch.c.x} ${ch.c.y} ${ch.c.z}`;
};
H.take = 'take <item|all> [count]   from a chest within 5m';
C.take = function* (g, p, a) {
  const ch = yield* chestNear(g, p);
  if (!ch) return 'FAILED take: no chest nearby';
  const all = (a[0] || 'all').toLowerCase() === 'all', name = all ? null : itemName(a[0]);
  let moved = 0, want = num(a[1]) || Infinity;
  for (const s of ch.list.slice()) {
    if (!all && s.id !== name) continue;
    const n = Math.min(s.n, want - moved);
    if (n <= 0) break;
    const left = g.give(p, s.id, n, s.dur);
    s.n -= n - left; moved += n - left;
    if (s.n <= 0) ch.list.splice(ch.list.indexOf(s), 1);
    if (left) break;
  }
  g.event({ type: 'chest', id: p.id, x: ch.c.x, y: ch.c.y, z: ch.c.z });
  yield* wait(6);
  const inside = ch.list.map(s => `${s.id} ${s.n}`).join(', ') || 'empty';
  return `took ${moved} item(s). Chest now: ${inside}`;
};
H.chest = 'chest   list what is in the nearest chest';
C.chest = function* (g, p) {
  const ch = yield* chestNear(g, p);
  if (!ch) return 'no chest nearby';
  return `chest at ${ch.c.x} ${ch.c.y} ${ch.c.z}: ${ch.list.map(s => `${s.id} ${s.n}`).join(', ') || 'empty'}`;
};

H.sleep = 'sleep   (at night; uses a bedroll nearby or from your inventory; sets your respawn point)';
C.sleep = function* (g, p) {
  if (g.isDay()) return 'FAILED sleep: you can only sleep at night';
  let bed = nearBlock(g, p, [B.bedroll], 10);
  if (!bed) bed = yield* ensureStation(g, p, 'bedroll', false);
  if (!bed) return 'FAILED sleep: no bedroll (craft one: 3 wool + 3 planks)';
  if (!(yield* goTo(g, p, { hx: bed.x, hy: bed.y, hz: bed.z, isGoal: (x, y, z) => Math.abs(x - bed.x) + Math.abs(z - bed.z) <= 1 && Math.abs(y - bed.y) <= 1 }))) return 'FAILED sleep: could not reach the bedroll';
  for (const e of g.entities.values()) if (e.kind === 'mob' && !e.dead && MOBS[e.type].kind === 'hostile' && g.dist(e, p) < 8) return 'FAILED sleep: monsters nearby';
  p.bed = { x: bed.x, y: bed.y, z: bed.z };
  p.x = bed.x + 0.5; p.y = bed.y + 0.25; p.z = bed.z + 0.5; p.vx = p.vz = p.vy = 0;
  p.sleeping = true; p.doing = 'sleeping';
  g.event({ type: 'sleep', id: p.id });
  const until = g.tick + 90 * TPS;
  while (p.sleeping && !g.isDay() && g.tick < until) yield;
  const woke = g.isDay();
  p.sleeping = false;
  return woke ? 'slept through the night. Good morning! (respawn point set)' : 'rested, but not enough players were asleep to skip the night (respawn point set)';
};

H.farm = 'farm [count]   till soil and plant seeds (needs a hoe and seeds)';
C.farm = function* (g, p, a) {
  const n = Math.min(32, num(a[0]) || 9);
  if (!g.count(p, 'seeds')) return 'FAILED farm: no seeds (break tall grass to find some)';
  let hoe = p.inv.find(s => ITEMS[s.id].tool && ITEMS[s.id].tool.type === 'hoe');
  if (!hoe) { yield* craft(g, p, 'wooden_hoe', 1, 0, [], {}); hoe = p.inv.find(s => ITEMS[s.id].tool && ITEMS[s.id].tool.type === 'hoe'); }
  if (!hoe) return 'FAILED farm: you need a hoe (2 planks + 2 sticks at a workbench)';
  const soil = findBlocks(g, p, new Set([B.grass, B.dirt]), { radius: 6, ry: 2 }).filter(b => {
    const up = g.world.def(b.x, b.y + 1, b.z);
    return up.replaceable && !up.liquid && !g.world.solid(b.x, b.y + 2, b.z);
  });
  const water = findBlocks(g, p, new Set([B.water]), { radius: 10, ry: 2, limit: 1 })[0];
  if (water) soil.sort((x, y) => Math.hypot(x.x - water.x, x.z - water.z) - Math.hypot(y.x - water.x, y.z - water.z));
  let planted = 0;
  for (const b of soil) {
    if (planted >= n || !g.count(p, 'seeds')) break;
    p.doing = `farming (${planted}/${n})`;
    if (eyeDist(p, b.x, b.y, b.z) > REACH) if (!(yield* goNear(g, p, b.x, b.y + 1, b.z, 3.5))) continue;
    if (g.world.def(b.x, b.y + 1, b.z).render === 'cross') g.setBlock(b.x, b.y + 1, b.z, 0);
    g.face(p, b.x + 0.5, b.y + 1, b.z + 0.5); p.held = hoe; p.swingT = 6;
    g.setBlock(b.x, b.y, b.z, B.farmland);
    g.useTool(p, hoe);
    yield* wait(4);
    if (!g.placeBlock(p, b.x, b.y + 1, b.z, 'seeds')) planted++;
    yield* wait(3);
  }
  return planted ? `planted ${planted} seeds (wheat grows in a few minutes; use harvest later, bone_meal speeds it up)` : 'FAILED farm: no open dirt or grass nearby';
};
H.harvest = 'harvest   collect ripe wheat nearby and replant';
C.harvest = function* (g, p) {
  const ripe = findBlocks(g, p, new Set([B.wheat_3]), { radius: 12, ry: 4 });
  let n = 0;
  for (const b of ripe) {
    if (!(yield* breakAt(g, p, b.x, b.y, b.z))) continue;
    n++;
    if (g.count(p, 'seeds') && g.world.get(b.x, b.y - 1, b.z) === B.farmland) g.placeBlock(p, b.x, b.y, b.z, 'seeds');
  }
  const growing = findBlocks(g, p, new Set([B.wheat_0, B.wheat_1, B.wheat_2]), { radius: 12, ry: 4 }).length;
  return n ? `harvested ${n} wheat${growing ? `, ${growing} still growing` : ''}` : `FAILED harvest: nothing ripe${growing ? ` (${growing} crops still growing)` : ''}`;
};
H.plant = 'plant <seeds|sapling|flower> [X Y Z]';
C.plant = function* (g, p, a) {
  const name = itemName(a[0]);
  if (!name || !g.count(p, name)) return `FAILED plant: you have no ${a[0]}`;
  if (a.length >= 4) return yield* C.place(g, p, [name, a[1], a[2], a[3]]);
  const ground = name === 'seeds' ? [B.farmland] : [B.grass, B.dirt, B.snowy_grass];
  const spot = findBlocks(g, p, new Set(ground), { radius: 6, ry: 2 }).find(b => g.world.get(b.x, b.y + 1, b.z) === 0);
  if (!spot) return `FAILED plant: no spot for ${name} nearby`;
  const err = yield* placeAt(g, p, spot.x, spot.y + 1, spot.z, name);
  return err ? `FAILED plant ${name}: ${err}` : `planted ${name} at ${spot.x} ${spot.y + 1} ${spot.z}`;
};
H.use = 'use <bone_meal|bucket|water_bucket|lava_bucket|flint> [X Y Z]';
C.use = function* (g, p, a) {
  const name = itemName(a[0]);
  if (!name || !g.count(p, name)) return `FAILED use: you have no ${a[0]}`;
  const at = a.length >= 4 ? { x: num(a[1]), y: num(a[2]), z: num(a[3]) } : null;
  if (name === 'bone_meal') {
    const t = at || findBlocks(g, p, new Set([B.wheat_0, B.wheat_1, B.wheat_2, B.oak_sapling, B.birch_sapling, B.pine_sapling]), { radius: 8, ry: 3, limit: 1 })[0];
    if (!t) return 'FAILED use bone_meal: no crops or saplings nearby';
    if (eyeDist(p, t.x, t.y, t.z) > REACH) yield* goNear(g, p, t.x, t.y, t.z);
    const b = g.world.def(t.x, t.y, t.z);
    g.take(p, 'bone_meal', 1); p.swingT = 6; g.event({ type: 'bonemeal', x: t.x, y: t.y, z: t.z });
    if (b.crop !== undefined) { g.setBlock(t.x, t.y, t.z, B['wheat_' + Math.min(3, b.crop + 1 + Math.floor(g.rng() * 2))]); return 'used bone meal on wheat'; }
    if (b.sapling) { if (g.rng() < 0.45) g.growTree(t.x, t.y, t.z); return 'used bone meal on the sapling'; }
    return 'bone meal did nothing there';
  }
  if (name === 'bucket') {
    const t = findBlocks(g, p, new Set([B.water, B.lava]), { radius: 6, ry: 4, limit: 1 })[0];
    if (!t) return 'FAILED use bucket: no water or lava nearby';
    if (eyeDist(p, t.x, t.y, t.z) > REACH) yield* goNear(g, p, t.x, t.y, t.z);
    const lava = g.world.get(t.x, t.y, t.z) === B.lava;
    g.take(p, 'bucket', 1); g.give(p, lava ? 'lava_bucket' : 'water_bucket', 1);
    g.setBlock(t.x, t.y, t.z, 0); p.swingT = 6;
    return `filled a bucket with ${lava ? 'lava' : 'water'}`;
  }
  if (name === 'water_bucket' || name === 'lava_bucket') {
    const r = yield* C.place(g, p, [name].concat(at ? [at.x, at.y, at.z] : []));
    // water + lava = obsidian
    for (const e of findBlocks(g, p, new Set([B.lava]), { radius: 4, ry: 3 })) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (g.world.get(e.x + dx, e.y + dy, e.z + dz) === B.water) { g.setBlock(e.x, e.y, e.z, B.obsidian); g.event({ type: 'hiss', x: e.x, y: e.y, z: e.z }); break; }
    }
    return r;
  }
  if (name === 'flint') return yield* C.ignite(g, p, a.slice(1));
  return `FAILED use: ${name} has no use action (try eat, place or equip)`;
};
H.ignite = 'ignite [X Y Z]   light a blast barrel (needs flint). Run away after!';
C.ignite = function* (g, p, a) {
  if (!g.count(p, 'flint')) return 'FAILED ignite: you need flint';
  const t = a.length >= 3 ? { x: num(a[0]), y: num(a[1]), z: num(a[2]) } : findBlocks(g, p, new Set([B.blast_barrel]), { radius: 6, ry: 3, limit: 1 })[0];
  if (!t || g.world.get(t.x, t.y, t.z) !== B.blast_barrel) return 'FAILED ignite: no blast barrel there';
  if (eyeDist(p, t.x, t.y, t.z) > REACH) yield* goNear(g, p, t.x, t.y, t.z);
  g.setBlock(t.x, t.y, t.z, 0); g.prime(t.x, t.y, t.z); p.swingT = 6;
  const ang = Math.atan2(p.x - t.x - 0.5, p.z - t.z - 0.5);
  for (let i = 0; i < 50; i++) { g.steer(p, Math.sin(ang), Math.cos(ang), SPEED); yield; }
  g.stop(p);
  return 'lit the blast barrel and ran';
};
H.torch = 'torch   place a torch where you stand';
C.torch = function* (g, p) {
  if (!g.count(p, 'torch')) { yield* craft(g, p, 'torch', 4, 1, [], {}); if (!g.count(p, 'torch')) return 'FAILED torch: no torches (coal + stick)'; }
  const f = feet(g, p);
  for (const [x, z] of [[f.x, f.z], [f.x + 1, f.z], [f.x - 1, f.z], [f.x, f.z + 1], [f.x, f.z - 1]]) if (!g.placeBlock(p, x, f.y, z, 'torch')) return `placed a torch at ${x} ${f.y} ${z}`;
  yield;
  return 'FAILED torch: no spot';
};
H.sethome = 'sethome   remember this spot (goto home)';
C.sethome = function* (g, p) { p.home = feet(g, p); yield; return `home set at ${p.home.x} ${p.home.y} ${p.home.z}`; };
H.wait = 'wait <seconds>';
C.wait = function* (g, p, a) { const s = Math.min(120, num(a[0]) || 5); p.doing = 'waiting'; g.stop(p); yield* wait(s * TPS); return null; };
H.recipes = 'recipes [item]   what you can craft now, or how to make an item';
C.recipes = function* (g, p, a) {
  yield;
  if (a[0]) { const n = itemName(a[0]); return n ? `${n}: ${recipeText(n)}` : `unknown item ${a[0]}`; }
  const list = canCraftNow(g, p);
  return list.length ? `you can craft now: ${list.join(', ')}` : 'nothing craftable with what you carry';
};
C.status = C.look = C.inv = C.inventory = function* () { yield; return null; };
H.tame = 'tame [count]   feed a wild animal its favourite food until it becomes your pet (hounds and wolves: bone, cats: raw_fish, parrots: seeds)';
C.tame = function* (g, p, a) {
  const want = Math.min(4, num(a[0]) || 1);
  let got = 0, tries = 0;
  while (got < want && tries < 12) {
    let e = null, bd = 40;
    for (const m of g.entities.values()) {
      const t = m.kind === 'mob' && !m.dead && m.tamer == null && MOBS[m.type].tame;
      if (t && g.count(p, t.item)) { const d = g.dist(p, m); if (d < bd) { bd = d; e = m; } }
    }
    if (!e) return got ? `tamed ${got}` : 'FAILED tame: no tameable animal within 40m that you have food for (hounds and wolves eat bone, cats raw_fish, parrots seeds)';
    const d = MOBS[e.type], food = d.tame.item;
    p.doing = 'taming a ' + d.label;
    if (!(yield* goToEntity(g, p, e, 2))) { tries++; continue; }
    g.stop(p); g.face(p, e.x, e.y + 0.5, e.z); p.swingT = 6;
    g.take(p, food, 1); tries++;
    yield* wait(16);
    if (e.dead) continue;
    if (g.rng() < d.tame.chance) { g.tame(p, e); got++; p.notes.push(`Tamed a ${d.label}! Its name is ${e.petName}.`); }
  }
  const names = (p.pets || []).map(id => g.entities.get(id)).filter(m => m && !m.dead).map(m => m.petName).join(', ');
  return got ? `tamed ${got}: ${names}` : 'FAILED tame: it refused every treat (keep trying)';
};
// what each kind of villager trades: [what you give, what you get]
const TRADES_RAW = {
  farmer: [[['wheat', 20], ['emerald', 1]], [['carrot', 22], ['emerald', 1]], [['potato', 26], ['emerald', 1]], [['emerald', 1], ['bread', 6]], [['emerald', 1], ['apple', 4]], [['emerald', 3], ['golden_carrot', 3]]],
  librarian: [[['paper', 24], ['emerald', 1]], [['book', 4], ['emerald', 1]], [['emerald', 3], ['bookshelf', 1]], [['emerald', 1], ['lantern', 1]], [['emerald', 5], ['name_tag', 1]], [['emerald', 4], ['compass', 1]]],
  smith: [[['coal', 15], ['emerald', 1]], [['iron_ingot', 4], ['emerald', 1]], [['emerald', 3], ['iron_pickaxe', 1]], [['emerald', 3], ['iron_sword', 1]], [['emerald', 9], ['iron_chestplate', 1]], [['emerald', 5], ['shield', 1]], [['emerald', 18], ['diamond_pickaxe', 1]]],
  butcher: [[['raw_pork', 7], ['emerald', 1]], [['raw_beef', 10], ['emerald', 1]], [['raw_poultry', 14], ['emerald', 1]], [['emerald', 1], ['cooked_pork', 5]], [['emerald', 1], ['steak', 4]]],
  mason: [[['clay_ball', 10], ['emerald', 1]], [['stone', 20], ['emerald', 1]], [['emerald', 1], ['stone_bricks', 4]], [['emerald', 1], ['terracotta', 2]], [['emerald', 1], ['bricks', 4]]],
  shepherd: [[['wool', 18], ['emerald', 1]], [['emerald', 1], ['wool', 2]], [['emerald', 3], ['bed', 1]], [['emerald', 1], ['red_dye', 3]], [['emerald', 1], ['blue_dye', 3]]],
  fisher: [[['string', 20], ['emerald', 1]], [['raw_cod', 15], ['emerald', 1]], [['emerald', 1], ['cooked_cod', 6]], [['emerald', 3], ['fishing_rod', 1]]],
  cleric: [[['rotten_flesh', 32], ['emerald', 1]], [['emerald', 1], ['redstone_dust', 2]], [['emerald', 1], ['lapis_lazuli', 1]], [['emerald', 2], ['glow_dust', 4]], [['emerald', 8], ['golden_apple', 1]]],
};
const TRADES = {};
for (const [k, list] of Object.entries(TRADES_RAW)) TRADES[k] = list.filter(([g1, g2]) => ITEMS[g1[0]] && ITEMS[g2[0]]);
H.trade = 'trade | trade N [times]   see what the nearest villager offers, then make trade N (villagers buy crops, meat, wool, coal, iron, paper for emeralds and sell gear, food and blocks)';
C.trade = function* (g, p, a) {
  yield;
  let v = null, bd = 32;
  for (const m of g.entities.values()) if (m.kind === 'mob' && !m.dead && m.type === 'villager') { const d = g.dist(p, m); if (d < bd) { bd = d; v = m; } }
  if (!v) return 'FAILED trade: no villager within 32m (find one with: village)';
  const offers = TRADES[v.prof] || TRADES.farmer, who = `the ${v.prof || 'farmer'} villager`;
  const list = offers.map((o, i) => `${i + 1}) ${o[0][1]} ${o[0][0]} -> ${o[1][1]} ${o[1][0]}`).join(' | ');
  if (a[0] == null) return `${who} ${Math.round(bd)}m away offers: ${list}. You have ${g.count(p, 'emerald')} emerald`;
  const o = offers[(num(a[0]) || 0) - 1];
  if (!o) return `FAILED trade: pick 1-${offers.length}. ${who} offers: ${list}`;
  const times = Math.max(1, Math.min(64, num(a[1]) || 1));
  if (g.count(p, o[0][0]) < o[0][1]) return `FAILED trade: you need ${o[0][1]} ${o[0][0]} (you have ${g.count(p, o[0][0])})`;
  p.doing = 'trading with a villager';
  if (!(yield* goToEntity(g, p, v, 2.5))) return `FAILED trade: could not reach ${who}`;
  g.stop(p); g.face(p, v.x, v.y + 1.5, v.z);
  let done = 0;
  for (; done < times && g.count(p, o[0][0]) >= o[0][1]; done++) {
    g.take(p, o[0][0], o[0][1]);
    const left = g.give(p, o[1][0], o[1][1]);
    if (left) g.dropItem(p.x, p.y + 1, p.z, o[1][0], left);
  }
  yield* wait(10);
  return `traded ${done}x with ${who}: gave ${o[0][1] * done} ${o[0][0]}, got ${o[1][1] * done} ${o[1][0]}`;
};
H.village = 'village   direction and distance to the nearest village (they have houses, farms, beds, chests and villagers to trade with)';
C.village = function* (g, p) {
  yield;
  const v = g.world.gen.nearestVillage(p.x, p.z, 5);
  if (!v) return 'no village within about 2000m. Try exploring further out';
  const dx = v.x - p.x, dz = v.z - p.z, d = Math.round(Math.hypot(dx, dz));
  const dir = (dz < -d * 0.38 ? 'north' : dz > d * 0.38 ? 'south' : '') + (dx > d * 0.38 ? 'east' : dx < -d * 0.38 ? 'west' : '');
  return `nearest village: well at ${v.x} ${v.y + 1} ${v.z}, ${d}m ${dir || 'here'} (${v.pieces.length} buildings). Walk there with: goto ${v.x} ${v.z + 4}`;
};
H.pet = 'pet sit|follow|list   order your tamed hounds';
C.pet = function* (g, p, a) {
  const pets = [...g.entities.values()].filter(m => m.kind === 'mob' && !m.dead && m.tamer === p.id);
  yield;
  if (!pets.length) return 'you have no pets (tame a Brindlehound with bones: tame)';
  const w = (a[0] || 'list').toLowerCase();
  if (w === 'sit' || w === 'stay') { pets.forEach(m => { m.ai.sit = true; }); return `${pets.map(m => m.petName).join(', ')} sat down`; }
  if (w === 'follow' || w === 'come') { pets.forEach(m => { m.ai.sit = false; }); return `${pets.map(m => m.petName).join(', ')} will follow you`; }
  return 'pets: ' + pets.map(m => `${m.petName} (HP ${Math.ceil(m.hp)}/${m.maxHp}, ${m.ai.sit ? 'sitting' : 'following'}) @${Math.floor(m.x)} ${Math.floor(m.y)} ${Math.floor(m.z)}`).join(' | ');
};
// gates: a 4 wide x 5 tall frame 3 blocks in front of you, the inside filled with gate blocks
function* buildGate(g, p, frame, fill, need) {
  for (const [it, n] of Object.entries(need)) if (g.count(p, it) < n) return `FAILED gate: need ${n} ${label(it)} (you have ${g.count(p, it)})`;
  if (defs.realmAt(p.x, p.z).name !== 'overworld') return 'FAILED gate: gates can only be built on the Island';
  const f = feet(g, p), [dx, dz] = facing(p);
  const ox = f.x + dx * 3, oz = f.z + dz * 3, ax = dz !== 0 ? 1 : 0, az = dx !== 0 ? 1 : 0; // the frame runs sideways to where you face
  const cells = [];
  for (let i = -1; i <= 2; i++) for (let j = 0; j <= 4; j++) cells.push([ox + ax * i, f.y - 1 + j, oz + az * i, i === -1 || i === 2 || j === 0 || j === 4]);
  for (const [x, y, z] of cells) { const b = g.world.def(x, y, z); if ((b.hardness < 0 && !b.liquid) || !g.world.inBounds(x, z)) return 'FAILED gate: bedrock or a gate in the way, move somewhere else'; }
  p.doing = 'building a gate';
  for (const [x, y, z] of cells) { const b = g.world.def(x, y, z); if (b.solid || b.render === 'cross' || b.liquid) { g.setBlock(x, y, z, 0); yield* wait(2); } }
  for (const [x, y, z, edge] of cells) if (edge) { g.setBlock(x, y, z, frame); p.swingT = 6; yield* wait(3); }
  for (const [it, n] of Object.entries(need)) { if (ITEMS[it].tool) { const s = p.inv.find(q => q.id === it); if (s) g.useTool(p, s, 1); } else g.take(p, it, n); }
  for (const [x, y, z, edge] of cells) if (!edge) g.setBlock(x, y, z, fill);
  yield* wait(10);
  return `built a gate at ${ox} ${f.y - 1} ${oz}. Walk into it (enter) to travel`;
}
H.gate = 'gate ember | gate sky   build a realm gate. ember: 10 obsidian + flint_and_steel. sky: 10 stone_bricks + 4 storm_eye';
C.gate = function* (g, p, a) {
  const w = (a[0] || 'ember').toLowerCase();
  if (w.startsWith('sky') || w === 'storm') return yield* buildGate(g, p, B.stone_bricks, B.sky_portal, { stone_bricks: 10, storm_eye: 4 });
  return yield* buildGate(g, p, B.obsidian, B.ember_portal, { obsidian: 10, flint_and_steel: 1 });
};
H.enter = 'enter   walk into the nearest gate (travel between realms)';
C.enter = function* (g, p) {
  const near = findBlocks(g, p, PORTAL_IDS, { radius: 48, ry: 12, limit: 1, hidden: true })[0];
  if (!near) return 'FAILED enter: no gate within 48m (build one: gate ember)';
  let t = near; // the lowest gate block of that gate
  for (const q of findBlocks(g, p, PORTAL_IDS, { radius: 48, ry: 12, limit: 40, hidden: true })) if (Math.abs(q.x - near.x) + Math.abs(q.z - near.z) <= 2 && q.y < t.y) t = q;
  const from = defs.realmAt(p.x, p.z);
  p.doing = 'heading into the gate';
  yield* goTo(g, p, { hx: t.x, hy: t.y, hz: t.z, isGoal: (x, y, z) => y === t.y && Math.abs(x - t.x) + Math.abs(z - t.z) <= 1 }, { tries: 4 });
  for (let i = 0; i < 60 && defs.realmAt(p.x, p.z) === from; i++) { g.steer(p, t.x + 0.5 - p.x, t.z + 0.5 - p.z, SPEED * 0.6); if (p.hitWall && p.onGround) p.jump = true; yield; }
  g.stop(p);
  const to = defs.realmAt(p.x, p.z);
  return to !== from ? `travelled to ${to.label}, now at ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}` : 'FAILED enter: could not step into the gate';
};
H.fish = 'fish [count]   fish in nearby water (needs a fishing_rod)';
C.fish = function* (g, p, a) {
  const rod = p.inv.find(s => s.id === 'fishing_rod');
  if (!rod) return 'FAILED fish: you need a fishing_rod (3 sticks + 2 string)';
  const w = findBlocks(g, p, new Set([B.water]), { radius: 24, ry: 6, limit: 1 })[0];
  if (!w) return 'FAILED fish: no water within 24m';
  yield* goNear(g, p, w.x, w.y, w.z, 4);
  const n = Math.min(10, num(a[0]) || 3), got = [];
  for (let i = 0; i < n; i++) {
    p.doing = `fishing (${i}/${n})`; p.held = rod; g.stop(p); g.face(p, w.x + 0.5, w.y + 0.5, w.z + 0.5);
    yield* wait(TPS * (4 + Math.floor(g.rng() * 7)));
    const r = g.rng(), it = r < 0.3 ? 'raw_fish' : r < 0.48 ? 'raw_cod' : r < 0.6 ? 'raw_salmon' : r < 0.64 ? 'tropical_fish' : r < 0.67 ? 'pufferfish' : r < 0.7 ? 'ink_sac' : r < 0.8 ? 'string' : r < 0.88 ? 'bone' : r < 0.94 ? 'glow_dust' : r < 0.985 ? 'iron_ingot' : 'sapphire';
    g.give(p, it, 1); got.push(it); p.swingT = 6;
    g.useTool(p, rod, 1);
    if (!p.inv.includes(rod)) break;
  }
  return `caught: ${summarize(got)}`;
};
H.shear = 'shear [count]   shear Fluffalos for wool (needs shears)';
C.shear = function* (g, p, a) {
  const sh = p.inv.find(s => s.id === 'shears');
  if (!sh) return 'FAILED shear: you need shears (2 iron ingots)';
  const n = Math.min(8, num(a[0]) || 2);
  let k = 0, wool = 0;
  while (k < n) {
    let e = null, bd = 40;
    for (const m of g.entities.values()) if (m.kind === 'mob' && !m.dead && m.type === 'fluffalo' && !(m.ai.sheared > g.tick)) { const d = g.dist(p, m); if (d < bd) { bd = d; e = m; } }
    if (!e) break;
    p.doing = `shearing (${k}/${n})`;
    if (!(yield* goToEntity(g, p, e, 2))) break;
    const c = 1 + Math.floor(g.rng() * 3);
    g.give(p, 'wool', c); wool += c; e.ai.sheared = g.tick + TPS * 300; p.swingT = 6; g.useTool(p, sh, 1); k++;
    yield* wait(10);
  }
  return k ? `sheared ${k} fluffalo${k > 1 ? 's' : ''} for ${wool} wool` : 'FAILED shear: no unshorn Fluffalo within 40m';
};

H.help = 'help   list commands';
C.help = function* () { yield; return 'commands: ' + Object.values(H).map(s => s.split('   ')[0]).join(' ; '); };
C.come = C.goto;
C.chop = function* (g, p, a) { return yield* C.mine(g, p, ['log', a[0] || a[1]]); };
C.build_hut = function* (g, p, a) { return yield* C.build(g, p, ['hut'].concat(a)); };

// ---------- reflexes (run automatically, even between commands) ----------
function* fightReflex(g, p, m) {
  const was = p.doing;
  p.doing = `fighting a ${MOBS[m.type].label}`;
  const won = yield* fight(g, p, m, 400);
  if (won) p.notes.push(`Fought off a ${MOBS[m.type].label}`);
  p.doing = was;
}
function* fleeReflex(g, p, m, ticks = 60) {
  const was = p.doing;
  p.doing = `running from a ${MOBS[m.type].label}`;
  for (let i = 0; i < ticks && !m.dead; i++) { g.steer(p, p.x - m.x, p.z - m.z, SPEED); if (p.hitWall) p.jump = true; if (p.inWater) p.swimUp = true; yield; }
  g.stop(p);
  p.doing = was;
}
function reflexes(g, p) {
  if (p.reflex) { const r = p.reflex.next(); if (!r.done) return true; p.reflex = null; }
  // auto-eat
  if (g.tick % 20 === p.id % 20 && p.eatT <= 0 && (p.food <= 12 || (p.hp <= 14 && p.food < 18))) { const s = bestFood(p); if (s) g.startEat(p, s); }
  if (p.inWater && p.headInWater && p.air < 120) p.swimUp = true;
  if (g.tick % 4 !== p.id % 4) return false;
  let threat = null, td = 7;
  for (const e of g.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.ai.target !== p.id) continue;
    const d = g.dist(e, p);
    if (d < td) { td = d; threat = e; }
  }
  if (!threat) return false;
  if (p.cmd && (p.cmd.name === 'attack' || p.cmd.name === 'hunt' || p.cmd.name === 'fight')) return false;
  const d = MOBS[threat.type];
  const weapon = g.bestWeapon(p);
  if (d.explode && threat.ai.fuse > 0) p.reflex = fleeReflex(g, p, threat, 50);
  else if (d.explode && !p.inv.some(s => s.id === 'bow') && td < 4) p.reflex = fleeReflex(g, p, threat, 30);
  else if (p.hp <= 5 && (!weapon || d.hp > 20)) p.reflex = fleeReflex(g, p, threat, 80);
  else if (td < (d.ranged ? 14 : 5)) p.reflex = fightReflex(g, p, threat);
  else return false;
  return true;
}

// ---------- command queue ----------
function parse(text) {
  const out = [];
  for (let part of String(text || '').split(/;|\n/)) {
    part = part.trim();
    if (!part) continue;
    const m = part.match(/^(\S+)\s*(.*)$/);
    const name = m[1].toLowerCase().replace(/^\//, '');
    const rest = m[2].trim();
    const args = name === 'say' ? [rest.replace(/^["']|["']$/g, '')] : rest.split(/[\s,]+/).filter(Boolean);
    out.push({ name, args, text: part });
  }
  return out;
}
function enqueue(g, p, text) {
  cancel(g, p, true);
  const list = parse(text), bad = list.filter(c => !C[c.name]);
  for (const c of bad) p.results.push(`unknown command "${c.name}" (try: help)`);
  p.queue = list.filter(c => C[c.name]);
  return p.queue.length;
}
function cancel(g, p, keepResults) {
  if (p.task) { try { p.task.return(); } catch (e) { /* ignore */ } }
  if (p.task && p.cmd && keepResults) p.results.push(`interrupted: ${p.cmd.text}`);
  p.task = null; p.cmd = null; p.queue = []; p.reflex = null;
  g.stop(p);
  p.doing = 'idle';
}
function tick(g, p) {
  if (reflexes(g, p)) return;
  if (!p.task) {
    const next = p.queue.shift();
    if (!next) { if (p.doing !== 'idle') { p.doing = 'idle'; g.stop(p); } return; }
    p.cmd = next;
    p.doing = next.text.slice(0, 60);
    p.task = C[next.name](g, p, next.args);
  }
  let r;
  try { r = p.task.next(); } catch (e) { r = { done: true, value: `FAILED ${p.cmd.text}: ${e.message}` }; console.error(e); }
  if (r.done) {
    if (r.value) p.results.push(r.value);
    p.task = null; p.cmd = null;
    g.stop(p);
  }
}
// game-wide checks once a second: skip the night when enough players sleep
function global(g) {
  const alive = g.players.filter(p => !p.dead && (p.joined || !p.agent));
  const sleepers = alive.filter(p => p.sleeping);
  if (!g.isDay() && sleepers.length && sleepers.length * 2 >= alive.length) {
    const tod = g.tod();
    g.clock += Math.round((1 - tod) * g.dayTicks);
    g.event({ type: 'morning', day: g.day() });
    for (const p of sleepers) p.sleeping = false;
  }
  if (g.isDay()) for (const p of sleepers) p.sleeping = false;
}

module.exports = { climbOut, underground, tick, enqueue, cancel, parse, global, findBlocks, canCraftNow, feet, dirName, blockSpec, HELP: H, COMMANDS: C };
