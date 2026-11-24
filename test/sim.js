'use strict';
// Headless self-test: one simulated player runs a survival script and prints its briefs.
//   node test/sim.js [seed]
const { Game } = require('../server/game');
const tasks = require('../server/tasks');
const { brief } = require('../server/brief');

const seed = Number(process.argv[2]) || 12345;
const g = new Game({ seed, config: { dayLength: 600 } });
const p = g.addPlayer('Tester', { token: 'test-token', agent: false });
const quiet = process.argv.includes('--quiet');

function run(cmds, maxSec = 400) {
  tasks.enqueue(g, p, cmds);
  const start = g.tick, t0 = Date.now();
  while ((p.task || p.queue.length || p.reflex) && g.tick - start < maxSec * 20) g.step();
  const ms = Date.now() - t0;
  const text = brief(g, p, 'done');
  if (!quiet) console.log(`\n>>> ${cmds}   [${((g.tick - start) / 20).toFixed(1)} game s, ${ms} ms real]\n${text}`);
  else console.log(`>>> ${cmds} [${((g.tick - start) / 20).toFixed(1)}s] ` + (text.match(/RESULTS: .*/) || ['(no results)'])[0]);
  return text;
}

for (let i = 0; i < 40; i++) g.step();
run('status');
run('mine log 8');
run('craft wooden_pickaxe; craft stick 4');
run('mine stone 14');
run('craft stone_pickaxe; craft stone_sword; craft furnace');
run('stairs 18');
run('mine coal 4; mine iron 3');
run('craft torch 8; smelt raw_iron');
run('explore e 50');
run('hunt animal 2');
run('build hut');
run('say hello from the test bot; eat');
console.log(`\nentities: ${g.entities.size}, mobs: ${[...g.entities.values()].filter(e => e.kind === 'mob').length}, chunks: ${g.world.chunks.size}, changes: ${g.world.changes.length}, frames: ${g.rec.frames.length}`);
console.log('replay JSON size MB:', (JSON.stringify(g.replay()).length / 1e6).toFixed(2));
