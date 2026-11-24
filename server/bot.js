'use strict';
// Built-in bot brain: picks the next commands for players that aren't AI agents (for demos and testing).
const { ITEMS } = require('../shared/defs');

const LINES = ['Anyone found iron yet?', 'This place is huge.', 'Night is coming, find shelter!', 'I love the sound of a pickaxe.', 'Who wants to build a village?',
  'Found a cave down here!', 'Watch out for Blastcaps.', 'Need wool for a bedroll.', 'Sapphires are deep, below y 16.', 'Anyone have spare food?'];

function plan(g, p) {
  const c = k => g.count(p, k);
  const has = k => p.inv.some(s => s.id === k);
  const tool = (type, lvl) => p.inv.some(s => ITEMS[s.id].tool && ITEMS[s.id].tool.type === type && ITEMS[s.id].tool.level >= lvl);
  const food = p.inv.filter(s => ITEMS[s.id].food).reduce((a, s) => a + s.n, 0);
  p.botStep = (p.botStep || 0) + 1;
  if (g.rng() < 0.08) return `say ${LINES[Math.floor(g.rng() * LINES.length)]}`;
  if (!g.isDay() && c('bedroll')) return 'sleep';
  if (p.food < 12 && food) return 'eat';
  if (!tool('pickaxe', 1)) return 'mine log 6; craft wooden_pickaxe; craft wooden_sword';
  if (!tool('pickaxe', 2)) return 'mine stone 8; craft stone_pickaxe; craft stone_sword';
  if (c('#log') + c('#planks') / 4 < 3) return 'mine log 8';
  if (food < 3 && g.isDay()) return 'hunt animal 2; smelt raw_venison; smelt raw_boar; smelt raw_poultry';
  if (!p.home && c('cobblestone') + c('#planks') > 60) return 'build hut';
  if (!p.home && g.isDay() && p.botStep % 3 === 0) return 'mine stone 40';
  if (!tool('pickaxe', 3)) {
    if (c('raw_iron') >= 3) return 'smelt raw_iron; craft iron_pickaxe';
    if (c('#coal') < 3) return (p.botFail === 'coal' ? 'stairs 10; ' : '') + 'mine coal 4';
    return (p.botFail === 'iron' ? 'stairs 12; ' : '') + 'mine iron 3';
  }
  if (c('raw_iron') >= 5 || c('iron_ingot') >= 5) return 'smelt raw_iron; craft iron_chestplate; craft iron_sword';
  if (!c('sapphire')) return (p.botFail === 'sapphire' ? 'stairs 16; ' : '') + 'mine sapphire 2';
  const r = g.rng();
  return r < 0.3 ? 'explore' : r < 0.6 ? 'mine iron 4' : r < 0.8 ? 'craft torch 8; tunnel 12' : 'mine gold 2';
}

function think(g, p) {
  if (p.dead || p.task || p.queue.length || p.reflex) return;
  if (p.botWait > g.tick) return;
  const last = p.results[p.results.length - 1] || '';
  const m = last.match(/FAILED mine (\w+)/);
  p.botFail = m ? m[1].replace('_ore', '') : null;
  p.results.length = 0; p.notes.length = 0;
  p.botWait = g.tick + 20;
  require('./tasks').enqueue(g, p, plan(g, p));
}

module.exports = { think };
