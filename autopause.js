// Auto-pause watchdog: pauses the game when no AI player has checked in for a while
// (e.g. usage ran out), and resumes when any player comes back.
//   node autopause.js [idleSeconds=75]
const fs = require('fs');
const path = require('path');
const BASE = process.env.BW_URL || 'http://127.0.0.1:7788';
const KEY = fs.readFileSync(path.join(__dirname, '.host-key'), 'utf8').trim();
const IDLE = (Number(process.argv[2]) || 75) * 1000;

async function api(p, body) {
  const res = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-host-key': KEY }, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

let lastActive = Date.now(), autoPaused = false;
async function tick() {
  try {
    const s = await api('/api/host/status');
    if (!s.started || s.over) return;
    const agents = (s.players || []).filter(p => p.agent || p.human);
    const active = agents.some(a => a.waiting || (a.doing && a.doing !== 'idle'));
    if (active) lastActive = Date.now();
    if (autoPaused && active) {
      autoPaused = false;
      await api('/api/host/pause', { paused: false });
      await api('/api/host/say', { text: 'Players are back, the game resumes!' });
      console.log(new Date().toLocaleTimeString(), 'resumed');
    } else if (!autoPaused && !s.paused && Date.now() - lastActive > IDLE) {
      autoPaused = true;
      await api('/api/host/say', { text: 'All players went quiet. Game paused until they return.' });
      await api('/api/host/pause', { paused: true });
      console.log(new Date().toLocaleTimeString(), 'auto-paused');
    }
  } catch (e) { /* server briefly unreachable; try again next tick */ }
}
console.log(`autopause watching ${BASE}, idle limit ${IDLE / 1000}s`);
setInterval(tick, 3000);
tick();
