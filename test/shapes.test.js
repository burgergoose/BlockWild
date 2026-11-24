'use strict';
// Headless test for climbable ladders, stair shapes and step-up physics.
//   node test/shapes.test.js
const defs = require('../shared/defs');
const { Game } = require('../server/game');
const tasks = require('../server/tasks');
const { brief } = require('../server/brief');
const { B } = defs;

const g = new Game({ seed: 4242, config: { dayLength: 600 } });
const p = g.addPlayer('Tester', { token: 'test-token', agent: false });
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) fails++; };
const steps = n => { for (let i = 0; i < n; i++) g.step(); };
function run(cmds, maxSec = 60) {
  tasks.enqueue(g, p, cmds);
  const start = g.tick;
  while ((p.task || p.queue.length || p.reflex) && g.tick - start < maxSec * 20) g.step();
  console.log(`>>> ${cmds} ` + (brief(g, p, 'done').match(/RESULTS: .*/) || ['(no results)'])[0].slice(0, 200));
}
steps(40);

// a flat stone test pad high in the air, far from terrain
const X = 300, Y = 100, Z = 300;
const set = (x, y, z, id) => g.world.set(x, y, z, id);
for (let x = X - 6; x <= X + 10; x++) for (let z = Z - 6; z <= Z + 6; z++) { set(x, Y - 1, z, B.stone); for (let y = Y; y < Y + 14; y++) set(x, y, z, 0); }
const place = (x, y, z) => { p.x = x + 0.5; p.y = y; p.z = z + 0.5; p.vx = p.vy = p.vz = 0; p.fallStart = y; steps(10); };

// --- stair shape rules ---
const get = (x, y, z) => g.world.get(x, y, z);
set(X + 1, Y, Z, B.oak_stairs); set(X + 2, Y + 1, Z, B.oak_stairs); set(X + 3, Y + 2, Z, B.oak_stairs);
for (const [x, y] of [[X + 2, Y], [X + 3, Y], [X + 3, Y + 1]]) set(x, y, Z, B.stone);
ok(defs.stairFacing(get, X + 1, Y, Z) === 1, 'a stair faces up the staircase (east)');

// --- walk up the stairs without jumping ---
place(X - 1, Y, Z);
const y0 = p.y;
run(`goto ${X + 3} ${Y + 3} ${Z}`);
ok(p.y >= y0 + 2.5,`walked up 3 stairs (from y ${y0.toFixed(2)} to ${p.y.toFixed(2)})`);

// --- step onto a slab without jumping ---
set(X, Y, Z + 3, B.oak_slab);
place(X - 2, Y, Z + 3);
for (let i = 0; i < 30; i++) { g.steer(p, 1, 0, 3); g.step(); }
ok(p.y >= Y + 0.49 || p.x > X + 1, `stepped over a slab (y ${p.y.toFixed(2)}, x ${p.x.toFixed(2)})`);

// --- ladder: climb up a 6-high wall ---
for (let y = Y; y < Y + 6; y++) { set(X + 5, y, Z - 3, B.stone); set(X + 6, y, Z - 3, B.stone); set(X + 7, y, Z - 3, B.stone); set(X + 4, y, Z - 3, B.ladder); }
ok(defs.wallSide(get, X + 4, Y + 2, Z - 3) === 1, 'ladder hangs on the wall to its east');
place(X + 2, Y, Z - 3);
run(`goto ${X + 7} ${Y + 6} ${Z - 3}`);
ok(p.y >= Y + 5.9,`climbed the ladder to the top (y ${p.y.toFixed(2)})`);

// --- ladder: no fall damage climbing down, and you hold on ---
place(X + 4, Y + 5, Z - 3);
const hp = p.hp;
steps(80);
ok(p.y < Y + 1.2 && p.hp === hp, `slid down the ladder safely (y ${p.y.toFixed(2)}, hp ${p.hp} of ${hp})`);

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
