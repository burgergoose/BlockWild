'use strict';
// The short text an AI player reads after each command call.
const path = require('path');
const defs = require('../shared/defs');
const { B, BLOCKS, ITEMS, MOBS, BIOMES } = defs;
const { findBlocks, canCraftNow, feet, dirName } = require('./tasks');
const { extraContext } = require('./context');
const BW = path.join(__dirname, '..', 'bw.js');

const WATCH = ['log', 'coal_ore', 'copper_ore', 'iron_ore', 'gold_ore', 'sapphire_ore', 'glow_crystal', 'stone', 'sand', 'clay', 'gravel', 'water', 'lava',
  'workbench', 'furnace', 'chest', 'bedroll', 'wheat_3', 'pumpkin', 'reeds', 'tall_grass', 'brown_mushroom', 'glowcap', 'obsidian', 'blast_barrel', 'emberite_ore', 'skycrystal_ore', 'magma_rock', 'gate', 'marble'];
const WATCH_IDS = new Map();
for (const b of BLOCKS) {
  const key = b.portal ? 'gate' : b.group === 'log' ? 'log' : b.name === 'cobblestone' || b.name === 'darkstone' ? 'stone' : b.name === 'furnace_lit' ? 'furnace' : b.name;
  if (WATCH.includes(key)) WATCH_IDS.set(b.id, key);
}

function brief(g, p, why) {
  const f = feet(g, p), L = [];
  const realm = defs.realmAt(f.x, f.z) || defs.REALM.overworld;
  const biome = BIOMES[g.world.gen.column(f.x, f.z).b].name;
  const under = !g.world.skyExposed(f.x, f.y + 1, f.z) && f.y < g.world.height(f.x, f.z) - 2;
  if (g.over) {
    L.push(`=== BLOCKWILD: GAME OVER (${g.over.reason}) ===`);
    L.push(`Final: deaths ${p.stats.deaths}, kills ${Object.values(p.stats.kills).reduce((a, b) => a + b, 0)}.`);
    L.push('STOP now. Reply with only: done');
    return L.join('\n');
  }
  L.push(`=== BLOCKWILD | ${g.clockText()}${g.weather.rain && realm.name === 'overworld' ? ' | raining' : ''}${realm.name !== 'overworld' ? ` | IN ${realm.label.toUpperCase()}` : ''}${g.bossDown ? ' | Stormwarden defeated' : ''} ===`);
  if (why === 'died') L.push('!! You died this turn (see results).');
  if (why === 'danger') L.push('!! DANGER: you are badly hurt. Your queue was paused.');
  if (why === 'timecap') L.push(`(time check: still working on "${p.cmd ? p.cmd.text : '...'}"${p.queue.length ? ` + ${p.queue.length} more queued` : ''}. Send new commands to replace them, or send nothing to keep going.)`);
  L.push(`YOU ${p.name} at ${f.x} ${f.y} ${f.z} (${biome}${under ? ', underground' : ''}) | HP ${Math.ceil(p.hp)}/20 Food ${p.food}/20 Armor ${g.armorPoints(p)}${p.air < 300 ? ` Air ${Math.max(0, Math.round(p.air / 20))}s` : ''}`);
  // inventory
  const inv = {};
  for (const s of p.inv) inv[s.id] = (inv[s.id] || 0) + s.n;
  const tools = p.inv.filter(s => ITEMS[s.id].tool).map(s => `${s.id}(${s.dur})`);
  const rest = Object.entries(inv).filter(([k]) => !ITEMS[k].tool).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
  L.push(`Tools: ${tools.join(', ') || 'none (bare hands)'}${p.armor.some(Boolean) ? ' | Wearing: ' + p.armor.filter(Boolean).map(s => s.id).join(', ') : ''}`);
  L.push(`Items (${p.inv.length}/36 slots): ${rest.join(', ') || 'nothing'}`);
  // results and notes since the last call
  const res = p.results.splice(0), notes = p.notes.splice(0);
  if (res.length) L.push('RESULTS: ' + res.slice(-10).join(' | '));
  if (notes.length) L.push('NOTES: ' + [...new Set(notes)].slice(-8).join(' | '));
  if (p.lastHurt && p.lastHurt.t > (p.lastBriefTick || 0)) {
    const by = p.lastHurt.by && g.entities.get(p.lastHurt.by);
    L.push(`Hurt recently by ${by ? (by.kind === 'mob' ? MOBS[by.type].label : by.kind === 'player' ? by.name : by.kind === 'thorn' ? 'a Thornspitter thorn' : by.kind === 'ember' ? 'a fireball' : by.kind) : p.lastHurt.cause}.`);
  }
  p.lastBriefTick = g.tick;
  // what the player can see
  const seen = new Map();
  for (const b of findBlocks(g, p, new Set(WATCH_IDS.keys()), { radius: 20, ry: 12 })) {
    const k = WATCH_IDS.get(b.id);
    const s = seen.get(k);
    if (!s) seen.set(k, { n: 1, b }); else s.n++;
  }
  const order = [...seen.entries()].sort((a, b) => WATCH.indexOf(a[0]) - WATCH.indexOf(b[0]));
  if (order.length) L.push('SEE: ' + order.map(([k, s]) => `${k === 'wheat_3' ? 'ripe wheat' : k} x${s.n} @${s.b.x} ${s.b.y} ${s.b.z}`).join(' | '));
  else L.push('SEE: nothing notable within 20m');
  // creatures and players
  const mobs = new Map();
  for (const e of g.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = g.dist(p, e);
    if (d > 24) continue;
    const m = MOBS[e.type], key = e.tamer != null ? (e.tamer === p.id ? 'pet:' + e.id : 'opet') : e.type;
    const cur = mobs.get(key);
    if (!cur || d < cur.d) mobs.set(key, { d, e, n: (cur ? cur.n : 0) + 1, m }); else cur.n++;
  }
  if (mobs.size) L.push('MOBS: ' + [...mobs.values()].sort((a, b) => a.d - b.d).map(({ d, e, n, m }) => e.tamer === p.id ? `your pet ${e.petName} ${Math.round(d)}m (HP ${Math.ceil(e.hp)})` : e.tamer != null ? `${n > 1 ? n + ' ' : ''}tame hound${n > 1 ? 's' : ''} ${Math.round(d)}m` : `${m.label}${n > 1 ? ' x' + n : ''} ${Math.round(d)}m ${dirName(e.x - p.x, e.z - p.z)}${m.boss ? ` BOSS HP ${Math.ceil(e.hp)}/${e.maxHp}` : m.kind === 'hostile' ? ' HOSTILE' : m.tame ? ' (tameable with bones)' : m.kind === 'neutral' ? ' (neutral)' : ''}`).join(' | '));
  const others = g.players.filter(o => o !== p && !o.dead && (o.joined || !o.agent)).map(o => ({ o, d: g.dist(p, o) })).sort((a, b) => a.d - b.d);
  if (others.length) L.push('PLAYERS: ' + others.slice(0, 6).map(({ o, d }) => `${o.name} ${Math.round(d)}m ${dirName(o.x - p.x, o.z - p.z)} (${o.doing.slice(0, 28)})`).join(' | ') + (others.length > 6 ? ` +${others.length - 6} more` : ''));
  // chat since last time
  const newChat = g.chat.slice(p.chatSeen).filter(c => c.id !== p.id);
  p.chatSeen = g.chat.length;
  if (newChat.length) L.push('CHAT: ' + newChat.slice(-8).map(c => `${c.name}: ${c.text}`).join(' || '));
  // surroundings
  const around = ['N', 'E', 'S', 'W'].map((d, i) => {
    const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][i], x = f.x + dx * 60, z = f.z + dz * 60;
    if (!g.world.inBounds(x, z) || defs.realmAt(x, z) !== realm) return `${d} realm edge`;
    if (realm.name === 'skyreach' && !g.world.gen.column(x, z).island) return `${d} open sky (deadly drop)`;
    return `${d} ${BIOMES[g.world.gen.column(x, z).b].name}`;
  }).join(', ');
  L.push(`AROUND (60m): ${around}${p.home ? ` | home ${p.home.x} ${p.home.y} ${p.home.z}` : ''}`);
  if (realm.name === 'skyreach' && !g.bossDown && g.bossSpawned) { const b = [...g.entities.values()].find(e => e.kind === 'mob' && !e.dead && MOBS[e.type].boss); if (b) L.push(`BOSS: Stormwarden HP ${Math.ceil(b.hp)}/${b.maxHp} @${Math.floor(b.x)} ${Math.floor(b.y)} ${Math.floor(b.z)}`); }
  try { L.push(...extraContext(g, p, f)); } catch (e) { console.error('context', e); }
  const cc = canCraftNow(g, p).filter(n => !/_block$|^wheat$|^goo$/.test(n));
  if (cc.length) L.push('CAN CRAFT: ' + cc.slice(0, 14).join(', ') + (cc.length > 14 ? ', ...' : ''));
  L.push(`NEXT: node "${BW}" ${p.token} "command; command; ..."`);
  return L.join('\n');
}

module.exports = { brief };
