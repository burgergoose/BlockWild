'use strict';
// Headless test of the realm update: gates, the Emberdeep, the Skyreach + boss, pets, new tools.
//   node test/realms.test.js [seed]
const defs = require('../shared/defs');
const { Game } = require('../server/game');
const tasks = require('../server/tasks');
const { brief } = require('../server/brief');

const seed = Number(process.argv[2]) || 4242;
const g = new Game({ seed, config: { dayLength: 600 } });
const p = g.addPlayer('Tester', { token: 'test-token', agent: false });
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) fails++; };
const realm = () => defs.realmAt(p.x, p.z).name;
function run(cmds, maxSec = 300, show = false) {
  tasks.enqueue(g, p, cmds);
  const start = g.tick;
  while ((p.task || p.queue.length || p.reflex) && g.tick - start < maxSec * 20) g.step();
  const text = brief(g, p, 'done');
  console.log(`>>> ${cmds} [${((g.tick - start) / 20).toFixed(1)}s] ` + (text.match(/RESULTS: .*/) || ['(no results)'])[0].slice(0, 220));
  if (show) console.log(text);
  return text;
}
const give = (id, n) => g.give(p, id, n);
for (let i = 0; i < 40; i++) g.step();

// world generation
const gen = g.world.gen, count = (c, id) => c.blocks.reduce((n, b) => n + (b === id), 0);
const RX = defs.RDX, RC = RX / 16;
const ec = gen.chunk(RC + 52, 20), sc = gen.chunk(RC + 72, 16);
ok(count(ec, defs.B.lava) > 100, `Emberdeep chunk has a lava sea (${count(ec, defs.B.lava)} lava)`);
ok(count(sc, defs.B.skystone) > 1000, `Skyreach arena chunk has island stone (${count(sc, defs.B.skystone)})`);
ok(!g.world.inBounds(RX + 600, 256) && g.world.inBounds(RX + 768, 256) && g.world.inBounds(RX + 1152, 256) && g.world.inBounds(-29999000, 29999000) && !g.world.inBounds(30000001, 0), 'realm and world-border bounds');
ok(defs.RECIPES.some(r => r.out === 'skysteel_pickaxe') && defs.ITEMS.emberite_chestplate, 'new tiers have tools and armor');

// gear up and build an ember gate
for (const [id, n] of [['obsidian', 10], ['flint_and_steel', 1], ['iron_pickaxe', 1], ['iron_sword', 1], ['shield', 1], ['cooked_boar', 16], ['iron_chestplate', 1], ['bone', 12]]) give(id, n);
g.autoArmor(p);
run('gate ember');
ok(g.world.changes.some(c => c[4] === defs.B.ember_portal), 'ember gate blocks placed');
run('enter');
ok(realm() === 'emberdeep', `entered the Emberdeep (at ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)})`);
const t1 = run('mine emberite 2; explore e 40', 300, true);
ok(/emberdeep/.test(t1) && /IN THE EMBERDEEP/.test(t1), 'brief shows the realm');
for (let i = 0; i < 20 * 60; i++) g.step();
ok([...g.entities.values()].some(e => e.kind === 'mob' && defs.MOBS[e.type].realm === 'emberdeep'), 'ember mobs spawn: ' + [...new Set([...g.entities.values()].filter(e => e.kind === 'mob' && defs.realmAt(e.x, e.z).name === 'emberdeep').map(e => e.type))].join(','));
p.hp = 20; p.food = 20; p.fire = 0;
run(`goto ${RX + 768} 51 258; enter`);
ok(realm() === 'overworld', `returned to the Island (at ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}, hp ${Math.ceil(p.hp)})`);

// pets
const hound = g.spawnMob('brindlehound', p.x + 4, p.y + 1, p.z);
run('tame');
ok(hound.tamer === p.id, `tamed a hound (${hound.petName || 'none'})`);
run('pet list');

// sky gate, boss
give('stone_bricks', 10); give('storm_eye', 4);
p.hp = 20;
run('gate sky; enter');
ok(realm() === 'skyreach', `entered the Skyreach (at ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)})`);
ok(g.bossSpawned, 'Stormwarden spawned');
for (let i = 0; i < 40; i++) g.step();
ok(hound.tamer === p.id && defs.realmAt(hound.x, hound.z).name === 'skyreach', 'pet came along through the gate');
for (const [id, n] of [['skysteel_sword', 1], ['skysteel_chestplate', 1], ['skysteel_helmet', 1], ['skysteel_leggings', 1], ['skysteel_boots', 1], ['golden_apple', 8]]) give(id, n);
g.autoArmor(p);
const boss = [...g.entities.values()].find(e => e.type === 'stormwarden');
run(`goto ${RX + 1152} 81 262`, 120);
for (let k = 0; k < 8 && !boss.dead; k++) { p.hp = 20; p.food = 20; run('attack stormwarden', 120); }
ok(boss.dead && g.bossDown, `defeated the Stormwarden (boss hp ${Math.ceil(boss.hp)})`);
console.log(run('collect', 60, true).split('\n').slice(0, 6).join('\n'));

// tools
give('fishing_rod', 1); give('shears', 1);
run('goto spawn; enter', 200);
console.log('realm now', realm());
run('fish 2', 200);
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
