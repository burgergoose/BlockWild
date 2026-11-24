'use strict';
// Extra surroundings for the AI players' brief: a mini-map, nearest resources with directions, shelter, goal progress and a
// suggested next step. The more a player can see in one report, the fewer "just looking" calls it needs.
const defs = require('../shared/defs');
const { B, BLOCKS, ITEMS, MOBS } = defs;

const dirOf = (dx, dz) => {
  if (Math.hypot(dx, dz) < 1.5) return 'here';
  const a = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / 45) % 8];
};

// 15x15 cells, 3 blocks each (45m square). One character per cell.
function miniMap(g, p, f) {
  const N = 15, S = 3, half = (N - 1) / 2, rows = [];
  const marks = new Map();
  const cellOf = (x, z) => { const cx = Math.round((x - f.x) / S) + half, cz = Math.round((z - f.z) / S) + half; return cx >= 0 && cz >= 0 && cx < N && cz < N ? cz * N + cx : -1; };
  for (const e of g.entities.values()) {
    if (e.dead) continue;
    let ch = null;
    if (e.kind === 'player' && e !== p && (e.joined || !e.agent)) ch = 'P';
    else if (e.kind === 'mob') { const d = MOBS[e.type]; ch = e.tamer === p.id ? 'd' : d.boss ? 'B' : d.kind === 'hostile' ? '!' : d.kind === 'passive' ? 'a' : null; }
    if (!ch) continue;
    const c = cellOf(e.x, e.z);
    if (c >= 0 && (!marks.has(c) || ch === '!' || ch === 'B')) marks.set(c, ch);
  }
  const realm = defs.realmAt(f.x, f.z);
  for (let cz = 0; cz < N; cz++) {
    let row = '';
    for (let cx = 0; cx < N; cx++) {
      if (cx === half && cz === half) { row += '@'; continue; }
      const m = marks.get(cz * N + cx);
      if (m) { row += m; continue; }
      const x = f.x + (cx - half) * S, z = f.z + (cz - half) * S;
      if (!g.world.inBounds(x, z) || defs.realmAt(x, z) !== realm) { row += ' '; continue; }
      row += terrainChar(g, x, z, f.y, realm.name);
    }
    rows.push(row);
  }
  return rows;
}
function terrainChar(g, x, z, py, realm) {
  if (realm === 'skyreach' && !g.world.gen.column(x, z).island) return ' ';
  // look at the surface near the player's own height (caves/ember: scan a window around the player)
  let top = null, id = 0;
  const yHi = realm === 'overworld' ? defs.HEIGHT - 1 : Math.min(defs.HEIGHT - 2, py + 6);
  for (let y = yHi; y > Math.max(0, py - 24); y--) {
    const b = BLOCKS[g.world.get(x, y, z)];
    if (realm !== 'overworld' && y > py + 3 && b.solid) { top = null; continue; } // ignore the cavern ceiling
    if (b.solid || b.liquid || b.render === 'leaves') { top = y; id = b.id; break; }
  }
  if (top == null) return realm === 'overworld' ? '.' : '#';
  const b = BLOCKS[id];
  if (b.portal) return 'O';
  if (b.liquid === 'water') return '~';
  if (b.liquid === 'lava') return 'L';
  if (b.group === 'leaves' || b.group === 'log') return 'T';
  if (b.name === 'chest' || b.name === 'workbench' || b.name === 'furnace' || b.name === 'bedroll') return 'h';
  if (/planks|bricks|cobblestone|glass|lantern/.test(b.name) && top > g.world.gen.column(x, z).h) return 'h';
  const dy = top - py;
  return dy > 6 ? '^' : dy > 2 ? '+' : dy < -6 ? 'v' : dy < -2 ? '-' : '.';
}

const NEAR = [
  ['wood', ids(b => b.group === 'log')], ['stone', ids(b => b.name === 'stone' || b.name === 'cobblestone')], ['coal', ids(b => b.name === 'coal_ore')],
  ['copper', ids(b => b.name === 'copper_ore')], ['iron', ids(b => b.name === 'iron_ore')], ['gold', ids(b => b.name === 'gold_ore')],
  ['sapphire', ids(b => b.name === 'sapphire_ore')], ['obsidian', ids(b => b.name === 'obsidian')], ['emberite', ids(b => b.name === 'emberite_ore')],
  ['sky crystal', ids(b => b.name === 'skycrystal_ore')], ['water', ids(b => b.name === 'water')], ['lava', ids(b => b.name === 'lava')],
  ['sand', ids(b => b.name === 'sand' || b.name === 'ashsand')], ['clay', ids(b => b.name === 'clay')], ['chest', ids(b => b.name === 'chest')],
  ['gate', ids(b => !!b.portal)], ['bed', ids(b => b.bed)],
];
function ids(fn) { return new Set(BLOCKS.filter(fn).map(b => b.id)); }
const KEY_OF = BLOCKS.map(b => { const e = NEAR.find(([, set]) => set.has(b.id)); return e ? e[0] : null; });
// nearest of each resource within 40m, scanning the world directly (not just what is visible)
function nearest(g, p, f) {
  const best = new Map(), R = 40, RY = 24;
  for (let dy = -RY; dy <= RY; dy++) {
    const y = f.y + dy;
    if (y < 1 || y >= defs.HEIGHT) continue;
    for (let dx = -R; dx <= R; dx += 1) for (let dz = -R; dz <= R; dz += 1) {
      const x = f.x + dx, z = f.z + dz, id = g.world.get(x, y, z);
      const k = KEY_OF[id];
      if (!k) continue;
      const d = Math.hypot(dx, dy * 1.5, dz), cur = best.get(k);
      if (!cur || d < cur.d) best.set(k, { d, x, y, z });
    }
  }
  return NEAR.filter(([k]) => best.has(k)).map(([k]) => {
    const b = best.get(k);
    return `${k} ${Math.round(b.d)}m ${dirOf(b.x - f.x, b.z - f.z)} @${b.x} ${b.y} ${b.z}${b.y < f.y - 3 ? ' (below)' : b.y > f.y + 3 ? ' (above)' : ''}${g.world.exposed(b.x, b.y, b.z) ? '' : ' (buried)'}`;
  });
}

const has = (g, p, id, n = 1) => g.count(p, id) >= n || p.armor.some(s => s && s.id === id);
const anyOf = (g, p, list) => list.some(id => has(g, p, id));
function progress(g, p) {
  const steps = [
    ['wood pickaxe', anyOf(g, p, ['wooden_pickaxe', 'stone_pickaxe', 'copper_pickaxe', 'iron_pickaxe', 'sapphire_pickaxe', 'emberite_pickaxe', 'skysteel_pickaxe'])],
    ['stone tools', anyOf(g, p, ['stone_pickaxe', 'copper_pickaxe', 'iron_pickaxe', 'sapphire_pickaxe', 'emberite_pickaxe', 'skysteel_pickaxe'])],
    ['iron pickaxe', anyOf(g, p, ['iron_pickaxe', 'sapphire_pickaxe', 'emberite_pickaxe', 'skysteel_pickaxe'])],
    ['armor', p.armor.some(Boolean)],
    ['ember gate', !!(p.stats.realms && p.stats.realms.emberdeep)],
    ['4 storm eyes', has(g, p, 'storm_eye', 4) || !!(p.stats.realms && p.stats.realms.skyreach)],
    ['sky gate', !!(p.stats.realms && p.stats.realms.skyreach)],
    ['Stormwarden', !!g.bossDown],
  ];
  return steps.map(([n, d]) => `${d ? '[x]' : '[ ]'} ${n}`).join(' ');
}

function suggest(g, p, f, realm) {
  const night = !g.isDay(), tod = g.tod();
  const pick = anyOf(g, p, ['wooden_pickaxe', 'stone_pickaxe', 'copper_pickaxe', 'iron_pickaxe', 'sapphire_pickaxe', 'emberite_pickaxe', 'skysteel_pickaxe']);
  const stone = anyOf(g, p, ['stone_pickaxe', 'copper_pickaxe', 'iron_pickaxe', 'sapphire_pickaxe', 'emberite_pickaxe', 'skysteel_pickaxe']);
  const iron = anyOf(g, p, ['iron_pickaxe', 'sapphire_pickaxe', 'emberite_pickaxe', 'skysteel_pickaxe']);
  const food = Object.keys(ITEMS).filter(k => ITEMS[k].food).reduce((n, k) => n + g.count(p, k), 0);
  if (p.hp <= 6) return 'you are hurt: eat, back off from mobs, and rest in a shelter until HP regenerates';
  if (realm === 'overworld' && night && tod > 0.5 && tod < 0.95 && !p.sleeping) return 'it is night: build hut (or sleep with a bedroll, or stay underground with torches)';
  if (food < 3 && p.food < 16) return realm === 'emberdeep' ? 'low on food: hunt cinderhog, then smelt raw_boar' : 'low on food: hunt animal 2, then smelt the raw meat (or fish)';
  if (!pick) return 'mine log 6; craft wooden_pickaxe';
  if (!stone) return 'mine stone 12; craft stone_pickaxe; craft stone_sword; craft furnace';
  if (!iron) return 'stairs 20 (to y 15-45); mine iron 3; mine coal 3; smelt raw_iron 3; craft iron_pickaxe';
  if (realm === 'overworld') {
    if (!p.armor.some(Boolean) && g.count(p, 'iron_ingot') >= 8) return 'craft iron_chestplate';
    if (!(p.stats.realms && p.stats.realms.emberdeep)) {
      if (g.count(p, 'obsidian') < 10) return `obsidian ${g.count(p, 'obsidian')}/10: it hides deep (y 3-12, near lava). stairs down and mine obsidian`;
      if (!has(g, p, 'flint_and_steel')) return 'craft flint_and_steel (1 iron_ingot + 1 flint from gravel)';
      return 'gate ember; enter   (travel to the Emberdeep)';
    }
    if (g.count(p, 'storm_eye') < 4) return `storm eyes ${g.count(p, 'storm_eye')}/4: each = ember_rod (from Scorchlings in the Emberdeep) + sapphire + 2 glow_dust`;
    if (g.count(p, 'stone_bricks') < 10) return 'craft stone_bricks (4 stone each) until you have 10, then: gate sky';
    if (!g.bossDown) return 'gate sky; enter   (the Stormwarden waits in the Skyreach: bring friends, food and armor)';
    return 'the Stormwarden is beaten: build something great, help others, craft skysteel gear';
  }
  if (realm === 'emberdeep') {
    if (g.count(p, 'ember_rod') + g.count(p, 'storm_eye') < 4) return 'hunt scorchling (they drop ember_rods); mine emberite for emberite gear';
    return 'you have enough ember rods: goto the gate and enter to go home, then craft storm_eye';
  }
  if (realm === 'skyreach') {
    if (!g.bossDown) return 'attack stormwarden (arena at the island centre). Keep HP up; retreat across the bridge if low';
    return 'mine sky crystal for skysteel_ingot (2 sky_crystal + iron_ingot + ember_shard); enter the gate to go home';
  }
  return 'explore';
}

function extraContext(g, p, f) {
  const realm = (defs.realmAt(f.x, f.z) || defs.REALM.overworld).name;
  const L = [];
  const map = miniMap(g, p, f);
  L.push('MAP (north up, 1 char = 3m, 45m across): @ you, P player, ! hostile, B boss, a animal, d your pet, T trees, ~ water, L lava, h building, O gate, ^ + higher ground, - v lower, . level, # rock');
  for (const r of map) L.push('  ' + r);
  const near = nearest(g, p, f);
  if (near.length) L.push('NEAREST (40m, incl. hidden): ' + near.join(' | '));
  const shelter = [];
  if (p.home) shelter.push(`home ${Math.round(Math.hypot(p.home.x - f.x, p.home.z - f.z))}m ${dirOf(p.home.x - f.x, p.home.z - f.z)}`);
  if (p.bed) shelter.push(`bed ${Math.round(Math.hypot(p.bed.x - f.x, p.bed.z - f.z))}m ${dirOf(p.bed.x - f.x, p.bed.z - f.z)}`);
  if (realm === 'overworld') { const tod = g.tod(); shelter.push(g.isDay() ? `daylight left ~${Math.max(0, Math.round((0.5 - tod) * g.dayTicks / 20 / 60 * 10) / 10)}m` : 'NIGHT: hostiles spawn in the dark'); }
  if (shelter.length) L.push('SHELTER: ' + shelter.join(' | '));
  L.push('PROGRESS: ' + progress(g, p));
  L.push('SUGGESTED NEXT: ' + suggest(g, p, f, realm));
  return L;
}

module.exports = { extraContext, miniMap, nearest, suggest };
