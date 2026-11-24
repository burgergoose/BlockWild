'use strict';
// Headless test for a person playing: walking, jumping, mining by holding, placing, hotbar, attacking.
//   node test/play.test.js
const defs = require('../shared/defs');
const { Game } = require('../server/game');
const { B } = defs;
const g = new Game({ seed: 838552895, config: { dayLength: 600 } });
const p = g.addPlayer('You', { token: 't', agent: false }); p.human = true;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fails++; };
const steps = n => { for (let i = 0; i < n; i++) { p.inputAt = Date.now(); g.step(); } };
p.input = {}; steps(40);
// flatten a test pad
const X = Math.floor(p.x), Z = Math.floor(p.z), Y = g.world.height(X, Z);
for (let x = X - 6; x <= X + 10; x++) for (let z = Z - 6; z <= Z + 6; z++) { g.setBlock(x, Y, z, B.stone); for (let y = Y + 1; y < Y + 6; y++) g.setBlock(x, y, z, 0); }
p.x = X + 0.5; p.z = Z + 0.5; p.y = Y + 1; p.vx = p.vy = p.vz = 0; p.fallStart = p.y; steps(10);
const x0 = p.x;
p.input = { mx: 1, mz: 0, yaw: Math.PI / 2 }; steps(20);
ok(p.x - x0 > 3, `walks forward (${(p.x - x0).toFixed(2)} blocks in 1s)`);
p.input = { mx: 0, mz: 0 }; steps(10);
const y0 = p.y; p.input = { jump: true }; steps(4); ok(p.y > y0 + 0.5, 'jumps');
p.input = {}; steps(20);
// mining by holding
const tx = Math.floor(p.x) + 2, ty = Math.floor(p.y) - 1 + 0, tz = Math.floor(p.z);
const target = [tx, Math.floor(p.y) - 1, tz];
ok(g.world.get(...target) === B.stone, 'stone target');
g.give(p, 'wooden_pickaxe', 1);
p.input = { mine: target }; let t = 0; while (g.world.get(...target) && t < 400) { steps(1); t++; }
ok(!g.world.get(...target), `held-mine broke stone in ${t} ticks`);
steps(30);
ok(g.count(p, 'cobblestone') >= 1, 'the drop flew into the inventory');
// place it back from the hotbar
const slot = p.inv.findIndex(s => s.id === 'cobblestone');
p.input = { slot, use: { seq: 1, x: target[0], y: target[1] - 1, z: target[2], face: [0, 1, 0] } }; steps(2);
ok(g.world.get(...target) === B.cobblestone, `placed cobblestone (${p.lastErr || 'ok'})`);
// attack
const z = g.spawnMob('zombie', p.x + 1.5, p.y, p.z); const hp0 = z.hp;
p.input = { hit: { seq: 1, id: z.id } }; steps(2);
ok(z.hp < hp0, `hit the zombie (${hp0} -> ${z.hp})`);
z.dead = true; g.entities.delete(z.id); p.input = {}; steps(10);
// stale input stops the player
p.input = { mx: 1, mz: 0 }; p.inputAt = Date.now() - 5000; const xs = p.x; for (let i = 0; i < 20; i++) g.step();
ok(Math.abs(p.x - xs) < 0.5, 'stops when the viewer disconnects');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
