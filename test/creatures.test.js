'use strict';
// Headless test for the v6 animals and monsters: every mob spawns and runs, fliers stay airborne, archers shoot, drops are real items.
//   node test/creatures.test.js
const defs = require('../shared/defs');
const { Game } = require('../server/game');
const { MOBS, ITEMS, B } = defs;

const g = new Game({ seed: 4242, config: { dayLength: 600 } });
const p = g.addPlayer('Tester', { token: 'test-token', agent: false });
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) fails++; };
const steps = n => { for (let i = 0; i < n; i++) g.step(); };
steps(40);

// drops, tames and sheds all name real items
const bad = [];
for (const [k, m] of Object.entries(MOBS)) {
  for (const d of m.drops) if (!ITEMS[d[0]]) bad.push(`${k}:${d[0]}`);
  if (m.tame && !ITEMS[m.tame.item]) bad.push(`${k} tame`);
  if (m.sheds && !ITEMS[m.sheds]) bad.push(`${k} sheds`);
  if (m.lays && !ITEMS[m.lays]) bad.push(`${k} lays`);
}
ok(!bad.length, 'all drops are real items ' + bad.join(' '));

// a sealed stone box high up with a water pool, so land, water and flying mobs can all run
const X = 300, Y = 100, Z = 300;
for (let x = X - 12; x <= X + 12; x++) for (let z = Z - 12; z <= Z + 12; z++) {
  g.world.set(x, Y - 1, z, B.stone);
  for (let y = Y; y < Y + 12; y++) g.world.set(x, y, z, Math.abs(x - X) === 12 || Math.abs(z - Z) === 12 ? B.stone : 0);
  g.world.set(x, Y + 12, z, B.stone);
}
for (let x = X + 4; x <= X + 10; x++) for (let z = Z - 10; z <= Z - 4; z++) for (let y = Y; y < Y + 3; y++) g.world.set(x, y, z, B.water);
p.x = X - 10.5; p.y = Y; p.z = Z + 10.5; p.creative = true;

const NEW = ['cow', 'pig', 'sheep', 'chicken', 'rabbit', 'horse', 'donkey', 'mule', 'goat', 'llama', 'camel', 'armadillo', 'panda', 'turtle', 'frog', 'cat', 'ocelot',
  'polar_bear', 'wolf', 'fox', 'bat', 'bee', 'parrot', 'cod', 'salmon', 'tropical_fish', 'pufferfish', 'squid', 'dolphin', 'axolotl', 'tadpole',
  'zombie', 'skeleton', 'spider', 'cave_spider', 'slime', 'witch', 'silverfish'];
ok(NEW.every(k => MOBS[k]), `all ${NEW.length} new creatures are defined`);
const spawned = {};
for (const k of NEW) {
  const water = MOBS[k].kind === 'water';
  spawned[k] = g.spawnMob(k, water ? X + 7 : X - 6 + Math.random() * 8, Y + (water ? 1 : MOBS[k].flies ? 4 : 0), water ? Z - 7 : Z - 4 + Math.random() * 8);
}
let crashed = null;
try { steps(400); } catch (e) { crashed = e; }
ok(!crashed, 'every creature ran for 20 seconds without errors' + (crashed ? ': ' + crashed.stack : ''));
const alive = NEW.filter(k => !spawned[k].dead || MOBS[k].kind === 'hostile'); // the test player fights back, so monsters may die
ok(alive.length >= NEW.length - 4, `most creatures are still alive (${alive.length}/${NEW.length}; dead: ${NEW.filter(k => spawned[k].dead).join(' ')})`);
for (const k of ['bat', 'bee', 'parrot']) ok(!spawned[k].dead && !spawned[k].onGround && spawned[k].y > Y + 0.4, `${k} stays in the air (y ${(spawned[k].y - Y).toFixed(2)} above the floor)`);
ok(!spawned.cod.dead && spawned.cod.inWater, 'cod stays in the water');

// the skeleton shoots arrows at a visible player
p.creative = false; p.hp = 20;
const sk = spawned.skeleton;
let arrows = 0;
for (let i = 0; i < 200; i++) { g.step(); for (const e of g.entities.values()) if (e.kind === 'arrow' && e.owner === sk.id) { arrows++; e.dead = true; } }
ok(sk.dead || arrows > 0, `the skeleton shoots arrows (${arrows})`);

// hitting a bee makes it angry and it stings back
const bee = spawned.bee;
if (!bee.dead) {
  bee.x = X - 6; bee.z = Z + 6; bee.y = Y + 2; p.hp = 20; p.x = bee.x; p.z = bee.z + 1.5; p.y = Y;
  g.damage(bee, 1, 'player', p);
  const hp0 = p.hp;
  steps(120);
  ok(p.hp < hp0 || bee.dead, `an angry bee stings (hp ${hp0} -> ${p.hp}; bee ${(bee.x - p.x).toFixed(1)},${(bee.y - p.y).toFixed(1)},${(bee.z - p.z).toFixed(1)} angry ${bee.ai.angry} target ${bee.ai.target})`);
}

// slimes split when killed
const sl = g.spawnMob('slime', X, Y, Z);
g.damage(sl, 100, 'player', p);
steps(5);
ok([...g.entities.values()].filter(e => e.type === 'slime' && !e.dead && e.size === 2).length >= 2, 'a big slime splits into smaller slimes');

// cooked meat
ok(defs.SMELT.raw_beef === 'steak' && defs.SMELT.raw_pork === 'cooked_pork' && defs.SMELT.raw_mutton === 'cooked_mutton' && defs.SMELT.raw_rabbit === 'cooked_rabbit', 'new meats cook in a furnace');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
