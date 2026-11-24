#!/usr/bin/env node
'use strict';
// Blockwild server: runs the world at 20 ticks/s, streams it to the 3D viewer, and serves the AI player API.
//   node server.js            (http://127.0.0.1:7788)
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { Game, TPS } = require('./server/game');
const tasks = require('./server/tasks');
const bot = require('./server/bot');
const { brief } = require('./server/brief');
const savefile = require('./server/save');

const PORT = Number(process.env.BW_PORT) || 7788;
const ROOT = __dirname;
const REPLAYS = path.join(ROOT, 'replays');
const KEY_FILE = path.join(ROOT, '.host-key');
const SAVE_FILE = path.join(REPLAYS, 'latest-save.json.gz');
fs.mkdirSync(REPLAYS, { recursive: true });
if (!fs.existsSync(KEY_FILE)) fs.writeFileSync(KEY_FILE, crypto.randomBytes(12).toString('hex'));
const HOST_KEY = fs.readFileSync(KEY_FILE, 'utf8').trim();

let game = null, started = false, paused = false, speed = 1, acc = 0;
const streams = new Set();
const waiters = [];
let live = { last: new Map(), changeIdx: 0, logIdx: 0 };
let lastSave = Date.now();

function newGame(o) {
  if (game) saveReplay();
  game = new Game({ seed: o.seed, config: o.config });
  started = false; paused = false; speed = Number(o.speed) || 1;
  const names = o.names && o.names.length ? o.names : ['Claude', 'Ada', 'Bolt', 'Cosmo', 'Dot', 'Echo', 'Fizz', 'Gizmo', 'Halo', 'Ion', 'Jinx', 'Kilo', 'Lumen', 'Mochi', 'Nova', 'Pixel'];
  const agents = o.agents == null ? names.length : Number(o.agents);
  const keep = o.tokens || {};
  names.forEach((n, i) => game.addPlayer(n, { token: keep[n] || crypto.randomBytes(9).toString('hex'), agent: i < agents }));
  for (const w of waiters.splice(0)) respond(w.res, { error: 'a new game was started' });
  live = { last: new Map(), changeIdx: 0, logIdx: 0 };
  broadcastInit();
  return game;
}

// ---------- main loop ----------
setInterval(() => {
  if (!game) return;
  if (started && !paused && !game.over) {
    acc += speed;
    let n = 0;
    while (acc >= 1 && n < 20) { acc -= 1; n++; for (const p of game.players) if (!p.agent && !p.human) bot.think(game, p); game.step(); }
    if (acc > 20) acc = 0;
  }
  checkWaiters();
  if (Date.now() - lastSave > 180000) { lastSave = Date.now(); if (started) saveReplay(); }
}, 1000 / TPS);
setInterval(broadcastFrame, 100);

// ---------- agent calls ----------
function callStatus(p) {
  if (!started) return null;
  if (game.over) return 'over';
  if (p.dead) return null;
  if (p.stats.deaths > p.call.deaths0) return 'died';
  if (p.callHurt >= 1 && p.hp <= 6 && !p.call.warned) { p.call.warned = true; return 'danger'; }
  if (!p.task && !p.queue.length && !p.reflex) return 'done';
  if (game.tick - p.call.start >= game.config.callCap * TPS) return 'timecap';
  return null;
}
function checkWaiters() {
  for (let i = waiters.length - 1; i >= 0; i--) {
    const w = waiters[i];
    if (w.res.writableEnded) { waiters.splice(i, 1); continue; }
    const why = game ? callStatus(w.p) : 'over';
    if (why) { waiters.splice(i, 1); respond(w.res, { text: brief(game, w.p, why), final: why === 'over' }); }
    else if (Date.now() > w.until) { waiters.splice(i, 1); respond(w.res, { wait: true, text: started ? 'Still working. Run the same command with no commands to keep waiting.' : 'Waiting for the host to start the game.' }); }
  }
}
function agentAct(p, cmds, res) {
  p.joined = true;
  if (cmds && cmds.trim()) tasks.enqueue(game, p, cmds);
  p.call = { start: game.tick, deaths0: p.stats.deaths };
  p.callHurt = 0;
  waiters.push({ p, res, until: Date.now() + 8 * 60 * 1000 });
}

// ---------- viewer stream ----------
function sse(res, obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }
function initMsg() {
  if (!game) return { type: 'empty' };
  const r2 = v => Math.round(v * 100) / 100;
  return { type: 'init', meta: game.meta(), started, paused, speed, t: game.t, clock: game.clock, rain: game.weather.rain,
    changes: game.world.changes.map(c => [r2(c[0] / TPS), c[1], c[2], c[3], c[4]]), ents: game.snapshot(), events: game.log.slice(-400) };
}
function broadcastInit() { const m = initMsg(); for (const s of streams) sse(s, m); }
function broadcastFrame() {
  if (!game) return;
  const { ents, gone } = game.diff(live.last);
  const ch = game.world.changes.slice(live.changeIdx).map(c => [Math.round(c[0] / TPS * 100) / 100, c[1], c[2], c[3], c[4]]);
  live.changeIdx = game.world.changes.length;
  const ev = game.log.slice(live.logIdx);
  live.logIdx = game.log.length;
  if (!streams.size) return;
  const msg = { type: 'f', t: game.t, clock: game.clock, rain: game.weather.rain, ents, gone, c: ch, ev, started, paused, speed };
  for (const s of streams) sse(s, msg);
}

// ---------- replays ----------
function saveState() {
  if (!game || !game.tick || game.over) return null;
  try { fs.writeFileSync(SAVE_FILE, zlib.gzipSync(JSON.stringify(savefile.save(game)))); return SAVE_FILE; } catch (e) { console.error('save failed', e.message); return null; }
}
function loadState() {
  const s = JSON.parse(zlib.gunzipSync(fs.readFileSync(SAVE_FILE)));
  if (game) saveReplay();
  game = savefile.load(s);
  started = true; paused = false; speed = 1;
  for (const w of waiters.splice(0)) respond(w.res, { error: 'the game was reloaded, run your command again' });
  live = { last: new Map(), changeIdx: 0, logIdx: 0 };
  broadcastInit();
  return game;
}
function saveReplay() {
  saveState();
  if (!game || !game.tick) return null;
  const file = path.join(REPLAYS, `${game.id}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(game.replay()), { level: 6 }));
  return file;
}

// ---------- http ----------
// optional local sound pack: a "soundpack" folder next to server.js, or { "folder": "..." } in soundpack.local.json
function packDir() {
  const local = path.join(ROOT, 'soundpack');
  if (fs.existsSync(local)) return local;
  try { const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'soundpack.local.json'), 'utf8')); if (c.folder && fs.existsSync(c.folder)) return path.resolve(c.folder); } catch (e) { /* no pack */ }
  return null;
}
let packCache = null;
function packFiles() {
  const dir = packDir();
  if (!dir) return [];
  if (packCache && packCache.dir === dir) return packCache.files;
  const files = [];
  (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + '/'); else if (/\.(ogg|mp3|wav)$/i.test(e.name)) files.push(rel + e.name); } })(dir, '');
  packCache = { dir, files };
  return files;
}
const MIME = { '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function respond(res, obj, code = 200) {
  if (res.writableEnded) return;
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise(ok => { let s = ''; req.on('data', d => { s += d; if (s.length > 1e6) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });
}
function serveFile(res, file, extra = {}) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, extra));
    res.end(data);
  });
}
const safe = (base, rel) => { const f = path.normalize(path.join(base, rel)); return f.startsWith(base) ? f : null; };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const isHost = req.headers['x-host-key'] === HOST_KEY || url.searchParams.get('key') === HOST_KEY;
  try {
    // --- AI players ---
    if (p === '/api/agent/act' && req.method === 'POST') {
      const b = await body(req);
      if (!game) return respond(res, { error: 'no game yet' });
      const pl = game.players.find(x => x.token === b.token && x.agent);
      if (!pl) return respond(res, { error: 'unknown token' });
      return agentAct(pl, b.cmds, res);
    }
    // --- a person playing in the viewer ---
    if (p.startsWith('/api/play/') && req.method === 'POST') {
      const b = await body(req);
      if (!game) return respond(res, { error: 'no game yet' });
      if (p === '/api/play/join') {
        if (!isHost) return respond(res, { error: 'host key required' }, 403);
        let pl = b.token && game.players.find(x => x.token === b.token && x.human);
        const name = String(b.name || 'You').replace(/[^w -]/g, '').trim().slice(0, 16) || 'You';
        if (!pl) pl = game.players.find(x => x.human && x.name === name);
        if (!pl) { pl = game.addPlayer(name, { token: crypto.randomBytes(9).toString('hex'), agent: false }); pl.human = true; }
        pl.joined = true; pl.inputAt = Date.now();
        if (!started) { started = true; game.event({ type: 'start' }); }
        paused = false;
        return respond(res, { token: pl.token, id: pl.id, name: pl.name });
      }
      const pl = game.players.find(x => x.token === b.token && x.human);
      if (!pl) return respond(res, { error: 'unknown token' }, 403);
      if (p === '/api/play/input') {
        pl.input = b; pl.inputAt = Date.now();
        return respond(res, { x: pl.x, y: pl.y, z: pl.z, vx: pl.vx, vy: pl.vy, vz: pl.vz, hp: pl.hp, food: pl.food, air: pl.air, dead: !!pl.dead, onGround: pl.onGround, inWater: pl.inWater,
          held: pl.held ? pl.inv.indexOf(pl.held) : -1, inv: pl.inv.slice(0, 36).map(s => [s.id, s.n]), armor: game.armorPoints(pl), eating: pl.eatT > 0, err: pl.lastErr || null, busy: !!(pl.task || pl.queue.length), clock: game.clockText(), paused });
      }
      if (p === '/api/play/chat') {
        const text = String(b.text || '').trim().slice(0, 240);
        if (text.startsWith('/')) { tasks.enqueue(game, pl, text.slice(1)); }
        else if (text) game.say(pl, text);
        return respond(res, { ok: true });
      }
      if (p === '/api/play/swap') {
        const a = Number(b.a), c = Number(b.b), inv = pl.inv;
        if (Number.isInteger(a) && Number.isInteger(c) && a >= 0 && c >= 0 && a < 36 && c < 36 && a !== c) {
          if (a < inv.length && c < inv.length) [inv[a], inv[c]] = [inv[c], inv[a]];
          else if (c < inv.length) inv.splice(Math.min(a, inv.length), 0, inv.splice(c, 1)[0]);
          else if (a < inv.length) inv.push(inv.splice(a, 1)[0]);
        }
        return respond(res, { ok: true });
      }
      if (p === '/api/play/brief') return respond(res, { text: brief(game, pl, 'status') });
      return respond(res, { error: 'unknown' }, 404);
    }
    if (p === '/api/agent/help') return respond(res, { text: Object.values(tasks.HELP).join('\n') });

    // --- host ---
    if (p.startsWith('/api/host/')) {
      if (!isHost) return respond(res, { error: 'host key required' }, 403);
      const b = req.method === 'POST' ? await body(req) : {};
      const cmd = p.slice(10);
      if (cmd === 'load') {
        if (!fs.existsSync(SAVE_FILE)) return respond(res, { error: 'no saved game' });
        const g = loadState();
        return respond(res, { resumed: true, id: g.id, players: g.players.length, blocks: g.world.changes.length });
      }
      if (cmd === 'new') {
        const g = newGame(b);
        return respond(res, { id: g.id, seed: g.seed, spawn: g.spawn, players: g.players.map(x => ({ name: x.name, token: x.token, agent: x.agent, color: x.color })), config: g.config });
      }
      if (!game) return respond(res, { error: 'no game yet: node host.js new' });
      if (cmd === 'start') { started = true; game.event({ type: 'start' }); return respond(res, { started: true }); }
      if (cmd === 'speed') { speed = Math.max(0.25, Math.min(20, Number(b.speed) || 1)); return respond(res, { speed }); }
      if (cmd === 'pause') { paused = !!b.paused; return respond(res, { paused }); }
      if (cmd === 'end') { game.end(b.reason || 'host'); const f = saveReplay(); return respond(res, { ended: true, replay: f && path.basename(f) }); }
      if (cmd === 'save') { const f = saveReplay(); return respond(res, { replay: f && path.basename(f) }); }
      if (cmd === 'say') { game.chat.push({ t: game.t, id: 0, name: 'HOST', text: String(b.text || '') }); game.event({ type: 'chat', id: 0, name: 'HOST', text: String(b.text || '') }); return respond(res, { ok: true }); }
      if (cmd === 'cmd') { const pl = game.player(b.name || ''); if (!pl) return respond(res, { error: 'no such player' }); tasks.enqueue(game, pl, b.cmds || ''); return respond(res, { ok: true }); }
      if (cmd === 'brief') { const pl = game.player(b.name || url.searchParams.get('name') || ''); return respond(res, pl ? { text: brief(game, pl, 'status') } : { error: 'no such player' }); }
      if (cmd === 'status') {
        return respond(res, { id: game.id, started, paused, speed, t: Math.round(game.t), clock: game.clockText(), over: game.over, entities: game.entities.size,
          players: game.players.map(x => ({ name: x.name, agent: x.agent, joined: x.joined, waiting: waiters.some(w => w.p === x) || !!(x.human && Date.now() - (x.inputAt || 0) < 15000), human: !!x.human, hp: Math.ceil(x.hp), food: x.food, doing: x.doing, deaths: x.stats.deaths, at: [Math.floor(x.x), Math.floor(x.y), Math.floor(x.z)] })) });
      }
      return respond(res, { error: 'unknown host command' }, 404);
    }

    // --- viewer ---
    if (p === '/api/stream') {
      if (!isHost) return respond(res, { error: 'host key required' }, 403);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      sse(res, initMsg());
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (p === '/api/soundpack') return respond(res, { files: packFiles() });
    if (p.startsWith('/soundpack/')) { const dir = packDir(); const f = dir && safe(dir, decodeURIComponent(p.slice(11))); return f ? serveFile(res, f, { 'Cache-Control': 'max-age=86400' }) : (res.writeHead(404), res.end()); }
    if (p === '/api/replays') {
      const list = fs.readdirSync(REPLAYS).filter(f => f.endsWith('.json.gz')).sort().reverse();
      return respond(res, { replays: list });
    }
    if (p.startsWith('/replays/')) {
      const f = safe(REPLAYS, decodeURIComponent(p.slice(9)));
      if (!f || !f.endsWith('.json.gz')) { res.writeHead(404); return res.end(); }
      return serveFile(res, f, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
    }
    if (p.startsWith('/three/')) { const f = safe(path.join(ROOT, 'node_modules', 'three'), p.slice(7)); return f ? serveFile(res, f) : res.end(); }
    if (p.startsWith('/shared/')) { const f = safe(path.join(ROOT, 'shared'), p.slice(8)); return f ? serveFile(res, f) : res.end(); }
    const f = safe(path.join(ROOT, 'public'), p === '/' ? 'index.html' : p.slice(1));
    if (f) return serveFile(res, f);
    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e);
    respond(res, { error: e.message }, 500);
  }
});
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 0;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Blockwild server on http://127.0.0.1:${PORT}`);
  console.log(`Viewer: http://127.0.0.1:${PORT}/?key=${HOST_KEY}`);
});
process.on('SIGINT', () => { saveReplay(); process.exit(0); });
