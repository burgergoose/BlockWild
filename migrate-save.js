// One-off: build a resumable save from a running OLD server (before save.js existed),
// using its replay (all block changes) plus each player's status brief (items, gear, HP, position).
//   node migrate-save.js
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { ITEMS } = require('./shared/defs');
const ROOT = __dirname, KEY = fs.readFileSync(path.join(ROOT, '.host-key'), 'utf8').trim();
const api = async (p, body) => (await fetch('http://127.0.0.1:7788' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-host-key': KEY }, body: body ? JSON.stringify(body) : undefined })).json();

(async () => {
  await api('/api/host/pause', { paused: true });
  const st = await api('/api/host/status');
  const sv = await api('/api/host/save', {});
  const rep = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'replays', sv.replay))));
  const m = rep.meta, blocks = new Map();
  for (const [, x, y, z, id] of rep.changes) blocks.set(x + ',' + y + ',' + z, [x, y, z, id]);
  const tokens = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'agents'))) { const t = fs.readFileSync(path.join(ROOT, 'agents', f), 'utf8').match(/bw.js" ([0-9a-f]+)/); if (t) tokens[f.replace('.txt', '')] = t[1]; }
  const players = [];
  for (const sp of st.players) {
    const txt = (await api('/api/host/brief?name=' + encodeURIComponent(sp.name))).text || '';
    const line = re => (txt.match(re) || [])[1] || '';
    const pos = line(/YOU \S+ at (-?\d+ -?\d+ -?\d+)/).split(' ').map(Number);
    const inv = [], armor = [null, null, null, null];
    for (const t of line(/Tools: ([^|\n]*)/).split(',')) { const mm = t.trim().match(/^(\w+)\((\d+)\)/); if (mm && ITEMS[mm[1]]) inv.push({ id: mm[1], n: 1, dur: +mm[2] }); }
    for (const t of line(/Wearing: ([^\n]*)/).split(',')) { const id = t.trim(); const it = ITEMS[id]; if (it && it.armor) armor[it.armor.slot] = { id, n: 1, dur: it.armor.dur }; }
    for (const t of line(/Items \([^)]*\): ([^\n]*)/).split(',')) {
      const mm = t.trim().match(/^(\w+) (\d+)$/); if (!mm || !ITEMS[mm[1]]) continue;
      let n = +mm[2]; const it = ITEMS[mm[1]];
      while (n > 0) { const k = Math.min(n, it.stack); inv.push({ id: mm[1], n: k, dur: it.tool ? it.tool.dur : it.armor ? it.armor.dur : undefined }); n -= k; }
    }
    const meta = m.players.find(q => q.name === sp.name) || {};
    players.push({ name: sp.name, token: tokens[sp.name], agent: sp.agent, color: meta.color, x: pos[0] + 0.5, y: pos[1], z: pos[2] + 0.5,
      hp: sp.hp, food: sp.food, sat: 2, air: 300, inv, armor, held: null, stats: { mined: {}, crafted: {}, kills: {}, deaths: sp.deaths }, joined: true });
  }
  const clock = Math.round(m.clock0 + rep.duration * 20);
  const save = { v: 1, savedAt: new Date().toISOString(), id: m.id, seed: m.seed, config: m.config, clock, weather: { rain: false, next: 6000 },
    milestones: [], bossDown: null, blocks: [...blocks.values()], placed: [], containers: [], furnaces: [], chat: [], players, pets: [] };
  fs.writeFileSync(path.join(ROOT, 'replays', 'latest-save.json.gz'), zlib.gzipSync(JSON.stringify(save)));
  console.log('saved', players.length, 'players,', save.blocks.length, 'blocks; replay', sv.replay);
  for (const p of players) console.log(' ', p.name, p.hp + 'hp', p.inv.length, 'stacks', p.armor.filter(Boolean).length, 'armor', !!p.token);
})();
