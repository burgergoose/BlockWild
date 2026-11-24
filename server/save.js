'use strict';
// Save / resume a live match across server restarts.
// Saves the seed + every changed block, chests, furnaces, players (position, items, armor, stats),
// pets, clock, weather and milestones. Wild mobs are not saved; they respawn naturally.
const { Game } = require('./game');
const { pk, unpk, legacyUnpk } = require('./world');
const defs = require('../shared/defs');

const PLAYER_KEYS = ['name', 'token', 'agent', 'color', 'x', 'y', 'z', 'hp', 'maxHp', 'food', 'sat', 'air', 'inv', 'armor', 'held', 'stats', 'home', 'bed', 'gateBack', 'joined', 'chatSeen', 'human'];

function save(game) {
  const w = game.world, blocks = new Map();
  for (const [, x, y, z, id] of w.changes) blocks.set(x + ',' + y + ',' + z, [x, y, z, id]);
  const pets = [];
  for (const e of game.entities.values()) if (e.kind === 'mob' && e.tamer != null && !e.dead) {
    const o = game.entities.get(e.tamer);
    if (o) pets.push({ type: e.type, owner: o.name, petName: e.petName, x: e.x, y: e.y, z: e.z, hp: e.hp, sit: !!(e.ai && e.ai.sit) });
  }
  return {
    v: 2, savedAt: new Date().toISOString(), id: game.id, seed: game.seed, config: game.config,
    clock: game.clock, weather: game.weather, milestones: [...game.milestones], bossDown: game.bossDown || null,
    blocks: [...blocks.values()], placed: [...w.placed], containers: [...w.containers], furnaces: [...game.furnaces],
    chat: game.chat.slice(-30),
    players: game.players.map(p => { const o = {}; for (const k of PLAYER_KEYS) o[k] = p[k]; o.dead = !!p.dead; return o; }),
    pets,
  };
}

// v1 saves: numeric block keys from the 512-wide island, and realms at x 640-1279 (now past the world border).
// Realm terrain is regenerated at its new place, so the few block edits made there are dropped.
function upgrade(s) {
  if (s.v >= 2) return s;
  const realm = x => x >= 512;
  const key = k => { const [x, y, z] = legacyUnpk(k); return realm(x) ? null : pk(x, y, z); };
  const moveXZ = o => { if (o && typeof o.x === 'number' && realm(o.x)) o.x += defs.RDX - 0; return o; };
  s.blocks = s.blocks.filter(b => !realm(b[0]));
  s.placed = s.placed.map(key).filter(Boolean);
  s.containers = s.containers.map(([k, v]) => [key(k), v]).filter(a => a[0]);
  s.furnaces = s.furnaces.map(([k, v]) => [key(k), v]).filter(a => a[0]);
  for (const p of s.players) { moveXZ(p); moveXZ(p.home); moveXZ(p.bed); }
  for (const pt of s.pets || []) moveXZ(pt);
  s.v = 2;
  return s;
}

function load(s) {
  s = upgrade(s);
  const game = new Game({ seed: s.seed, config: s.config });
  const w = game.world;
  for (const [x, y, z, id] of s.blocks) game.world.set(x, y, z, id);
  // generate chunks that hold saved containers first, so generation can't overwrite their contents
  for (const [k] of s.containers) { const [x, , z] = unpk(k); w.chunk(x >> 4, z >> 4); }
  for (const [k, v] of s.containers) w.containers.set(k, v);
  w.placed = new Set(s.placed);
  // blocks built before placed-tracking existed: any changed block that isn't natural-looking counts as built
  for (const [x, y, z, id] of s.blocks) if (id && !defs.BLOCKS[id].liquid && defs.BLOCKS[id].render !== 'cross') w.placed.add(pk(x, y, z));
  game.furnaces = new Map(s.furnaces);
  game.clock = s.clock; game.weather = s.weather; game.milestones = new Set(s.milestones);
  if (s.bossDown) game.bossDown = s.bossDown;
  game.chat = (s.chat || []).map(c => Object.assign({}, c, { t: 0 }));
  for (const sp of s.players) {
    const p = game.addPlayer(sp.name, { token: sp.token, agent: sp.agent, color: sp.color });
    for (const k of PLAYER_KEYS) if (sp[k] !== undefined && k !== 'chatSeen') p[k] = sp[k];
    p.chatSeen = game.chat.length;
    if (sp.dead || !(p.hp > 0)) { p.hp = 20; p.x = game.spawn.x + 0.5; p.y = game.spawn.y + 1; p.z = game.spawn.z + 0.5; }
  }
  for (const pt of s.pets || []) {
    const o = game.players.find(p => p.name === pt.owner);
    const m = o && game.spawnMob(pt.type, pt.x, pt.y, pt.z);
    if (!m) continue;
    game.tame(o, m); m.petName = pt.petName; m.hp = Math.min(m.maxHp, pt.hp); m.ai.sit = pt.sit;
  }
  game.event({ type: 'resume' });
  return game;
}

module.exports = { save, load };
