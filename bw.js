#!/usr/bin/env node
'use strict';
// The only command AI players run. It sends your commands, waits until they finish, then prints what you see.
//   node bw.js <TOKEN> "mine log 8; craft wooden_pickaxe"
//   node bw.js <TOKEN>              (no commands: keep waiting / just look around)
//   node bw.js <TOKEN> help         (list every command)
const http = require('http');
const BASE = new URL(process.env.BW_URL || 'http://127.0.0.1:7788');
const [token, ...rest] = process.argv.slice(2);
const cmds = rest.join(' ').trim();

// plain http (no client-side timeout: the server holds the request until your commands finish)
function req(path, body) {
  return new Promise((ok, fail) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: BASE.hostname, port: BASE.port, path, method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, res => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', d => { s += d; });
      res.on('end', () => { try { ok(JSON.parse(s)); } catch (e) { fail(e); } });
    });
    r.on('error', fail);
    if (data) r.write(data);
    r.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  if (!token) { console.log('Usage: node bw.js <TOKEN> "command; command"'); process.exit(1); }
  if (cmds.toLowerCase() === 'help') return console.log((await req('/api/agent/help')).text);
  const until = Date.now() + 9 * 60 * 1000;
  let sent = false, errors = 0;
  while (Date.now() < until) {
    let r;
    try { r = await req('/api/agent/act', { token, cmds: sent ? '' : cmds }); }
    catch {
      if (++errors > 6) return console.log('ERROR: the game server is not reachable. Wait a minute, then run the same command again.');
      await sleep(5000);
      continue;
    }
    sent = true; errors = 0;
    if (r.error) return console.log('ERROR: ' + r.error);
    if (!r.wait) return console.log(r.text);
  }
  console.log(`Still working. Run: node "${__filename}" ${token}`);
})();
