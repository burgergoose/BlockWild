'use strict';
// Headless test for villages: they generate away from spawn, villagers appear and trade, the Bulwark guards, tame works for cats.
//   node test/villages.test.js
const defs = require('../shared/defs');
const { Game } = require('../server/game');
const tasks = require('../server/tasks');
const { brief } = require('../server/brief');
const { B } = defs;

const g = new Game({ seed: 838552895, config: { dayLength: 600 } });
const p = g.addPlayer('Tester', { token: 'test-token', agent: false });
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) fails++; };
const steps = n => { for (let i = 0; i < n; i++) g.step(); };
function run(cmds, maxSec = 90) {
  tasks.enqueue(g, p, cmds);
  const start = g.tick;
  while ((p.task || p.queue.length || p.reflex) && g.tick - start < maxSec * 20) g.step();
  const res = (brief(g, p, 'done').match(/RESULTS: .*/) || ['(no results)'])[0];
  console.log(`>>> ${cmds} ${res.slice(0, 260)}`);
  return res;
}
steps(40);

const v = g.world.gen.nearestVillage(p.x, p.z, 5);
ok(v && Math.hypot(v.x - defs.SPAWN_C, v.z - defs.SPAWN_C) >= 220, `a village exists away from spawn (${v && v.x} ${v && v.z})`);
ok(/nearest village/.test(run('village')), 'village command finds it');

// teleport next to the well
p.x = v.x + 0.5; p.z = v.z + 4.5; p.y = g.world.height(Math.floor(p.x), Math.floor(p.z)) + 1; p.fallStart = p.y;
steps(60);
const vill = [...g.entities.values()].filter(e => e.type === 'villager' && !e.dead);
ok(vill.length >= 3, `villagers appeared (${vill.length}: ${vill.map(e => e.prof).join(', ')})`);
ok([...g.entities.values()].some(e => e.type === 'bulwark') || v.pieces.length < 4, 'a Bulwark guards a big village');
let houses = 0, doors = 0, beds = 0;
for (const pc of v.pieces) if (pc.kind !== 'farm') {
  houses++;
  for (let x = pc.x0; x <= pc.x1; x++) for (let z = pc.z0; z <= pc.z1; z++) for (let y = pc.y; y <= pc.y + 3; y++) { const id = g.world.get(x, y, z); if (id === B.oak_door) doors++; if (id === B.bed) beds++; }
}
ok(houses && doors >= houses * 2 && beds >= houses, `houses have doors and beds (${houses} houses, ${doors} door blocks, ${beds} beds)`);
const nearChests = [...g.world.containers.keys()].filter(k => { const [x, , z] = k.split(',').map(Number); return Math.abs(x - v.x) < 50 && Math.abs(z - v.z) < 50; });
ok(nearChests.length >= 1, `village chests have loot (${nearChests.length})`);

// trading: sell wheat for emeralds, buy bread
const farmer = vill.find(e => e.prof === 'farmer') || vill[0];
for (const e of vill) if (e !== farmer) { e.x += 40; } // keep the chosen villager nearest
farmer.x = p.x + 2; farmer.z = p.z; farmer.y = p.y;
g.give(p, 'wheat', 40); g.give(p, 'carrot', 30); g.give(p, 'potato', 30); g.give(p, 'emerald', 2); g.give(p, 'raw_pork', 20); g.give(p, 'paper', 30); g.give(p, 'rotten_flesh', 70); g.give(p, 'wool', 40); g.give(p, 'coal', 40); g.give(p, 'clay_ball', 30); g.give(p, 'string', 50);
const list = run('trade');
ok(/offers: 1\)/.test(list), 'trade lists offers');
const em0 = g.count(p, 'emerald');
const res = run('trade 1 2');
ok(/traded [12]x/.test(res) && g.count(p, 'emerald') > em0, `made a trade (${g.count(p, 'emerald')} emeralds)`);

// the Bulwark fights a zombie
const guard = [...g.entities.values()].find(e => e.type === 'bulwark');
if (guard) {
  const z = g.spawnMob('zombie', guard.x + 4, guard.y, guard.z);
  z.fire = 0;
  for (let i = 0; i < 400 && !z.dead; i++) { z.fire = 0; g.step(); }
  ok(z.dead, 'the Bulwark killed a zombie');
}

// tame a cat with raw fish
const cat = g.spawnMob('cat', p.x + 3, p.y, p.z + 1);
g.give(p, 'raw_fish', 20);
run('tame');
ok(cat.tamer === p.id, `tamed a cat with fish (${cat.petName || 'no'})`);

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
