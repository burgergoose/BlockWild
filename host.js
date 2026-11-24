#!/usr/bin/env node
'use strict';
// Host controls for Blockwild. Run `node server.js` first, in its own terminal.
//   node host.js new [--keep] [--agents 16] [--names "A,B,..."] [--seed 123] [--day 600] [--goal "..."] [--pvp] [--bots] [--speed 1]
//   node host.js start                 start the clock
//   node host.js status                who is doing what
//   node host.js speed <x> | pause | resume
//   node host.js say "message"         announce something to every player
//   node host.js cmd <Name> "cmds"     give a player commands directly
//   node host.js brief <Name>          see what a player sees
//   node host.js save | end            save the replay / end the game
//   node host.js url                   print the viewer link
const fs = require('fs');
const path = require('path');

const BASE = process.env.BW_URL || 'http://127.0.0.1:7788';
const ROOT = __dirname;
const KEY_FILE = path.join(ROOT, '.host-key');
const AGENTS_DIR = path.join(ROOT, 'agents');
const NAMES = ['Claude', 'Ada', 'Bolt', 'Cosmo', 'Dot', 'Echo', 'Fizz', 'Gizmo', 'Halo', 'Ion', 'Jinx', 'Kilo', 'Lumen', 'Mochi', 'Nova', 'Pixel'];
const PERSONAS = {
  Claude: 'calm, curious and helpful; you like organising group projects', Ada: 'a precise planner who loves efficient mining routes',
  Bolt: 'impatient and daring; you rush into caves', Cosmo: 'dreamy; you build pretty things and notice the scenery', Dot: 'quiet and practical; few words',
  Echo: 'a friendly follower who teams up with whoever is doing best', Fizz: 'bubbly and excitable, narrates everything', Gizmo: 'a nerdy engineer obsessed with tools and ore',
  Halo: 'kind; you share food and help anyone in trouble', Ion: 'dramatic; every danger is a soap opera', Jinx: 'a chaotic prankster who still wants to win',
  Kilo: 'blunt survivalist; efficiency above all', Lumen: 'a hard-boiled explorer narrating your expedition', Mochi: 'a sweet farmer who wants a cosy home',
  Nova: 'a natural leader who rallies everyone into a village', Pixel: 'a speedrunner gamer who talks in gamer slang',
};

const argv = process.argv.slice(2);
const cmd = argv.shift();
const opt = (name, def) => { const i = argv.indexOf('--' + name); if (i < 0) return def; const v = argv[i + 1]; return v == null || v.startsWith('--') ? true : v; };
function key() {
  if (!fs.existsSync(KEY_FILE)) { console.log('No host key yet. Start the server first: node server.js'); process.exit(1); }
  return fs.readFileSync(KEY_FILE, 'utf8').trim();
}
async function api(p, body) {
  try {
    const res = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-host-key': key() }, body: body ? JSON.stringify(body) : undefined });
    return await res.json();
  } catch { console.log('Could not reach the server. Is `node server.js` running?'); process.exit(1); }
}

function agentPrompt(p, goal, n) {
  const bw = path.join(ROOT, 'bw.js');
  return `You are playing BLOCKWILD, a 3D voxel survival game, as the player "${p.name}". ${n} AI players share one island world. The game is filmed for a YouTube video, so be entertaining: chat in character, react to events, team up or compete. Your personality: ${PERSONAS[p.name] || 'a unique, memorable personality of your own'}.

YOUR DIARY (keeps you the same character between sessions)
Your memory file is ${path.join(ROOT, 'agents', p.name + '.memory.md')}.
FIRST: read it if it exists. It is YOU from earlier sessions, so carry on as that same ${p.name} (friends, grudges, promises, unfinished plans).
LAST: before you stop playing, rewrite it in under 250 words: who you are, what happened, how you feel about each player, what you owe or are owed, and what you were doing. Never put your token in it.

GOAL: ${goal}

HOW IT WORKS
The game engine walks, digs, crafts, fights and swims for you. You give orders; one call runs them all, waits until they finish, then shows your status (position, health, food, items, what you can see, mobs, players, chat).
Use the Bash tool, ALWAYS with timeout 600000:
  node "${bw}" ${p.token} "command; command; command"
Chain several commands per call (separated by ;) so you need fewer calls. Run it with no commands to just look or keep waiting.

COMMANDS
 mine <block> [n]       mine log 10 | mine stone 20 | mine coal 5 | mine iron 3 | mine sapphire 2 | mine sand 8 (finds the nearest visible ones)
 craft <item> [n]       craft wooden_pickaxe | craft torch 8 (auto-makes planks/sticks, places a workbench if needed)
 smelt <item> [n]       smelt raw_iron 6 | smelt sand 4 | smelt raw_venison 3 (needs a furnace: 8 cobblestone; fuel: coal/logs/planks)
 stairs <n> [dir]       dig a staircase down (finds ores, places torches) | tunnel <n> [dir] | dig down <n> | dig X Y Z
 goto X Y Z | goto X Z | goto <player|spawn|home|forest|desert|...|water|workbench>
 explore [n|s|e|w|ne|...|<biome>] [distance]
 hunt <animal|mob> [n]   attack <mob|hostile>   fight
 eat [food]   equip <item>   sleep (night only, needs a bedroll: 3 wool + 3 planks; the night is skipped if half the players sleep)
 build hut [material] | build wall <len> [height] | build platform <size> | build pillar <h> | build bridge <len>
 fill <block> X1 Y1 Z1 X2 Y2 Z2 [hollow|walls]   place <block> [X Y Z]   torch   sethome
 farm [n] | harvest | plant <seeds|sapling> | use <bone_meal|bucket|water_bucket>
 store <item|all> | take <item> | chest    give <player> <item> [n] | drop <item> [n] | collect
 tame [n] (feed bones to a Brindlehound to get a pet)   pet sit|follow|list   fish [n] (fishing_rod)   shear [n] (shears, for wool)
 gate ember | gate sky (build a realm gate)   enter (walk into the nearest gate)
 say <message>    follow <player> [sec]    wait <sec>    recipes [item]    help
Coordinates: x is east, z is south, y is up. Sea level is y 48.

HOW TO PROGRESS
logs -> wooden_pickaxe -> stone -> stone_pickaxe + stone_sword + furnace -> coal (torches) and copper/iron (dig stairs down to y 15-45, or explore caves) -> smelt raw_iron -> iron tools and armor -> sapphires (deep, below y 16, need an iron pickaxe) -> sapphire gear.
Food: hunt Bramblebucks, Mossbacks, Puffhens and Fluffalos (they drop wool for bedrolls), then smelt the meat. Farming: farm, then harvest the wheat and craft bread.
Night is dangerous: Gloomlings, Thornspitters, Blastcaps (they explode!), Burrowers and Gelatoads come out. Build a hut, light torches, or sleep. Deep caves hold Cragjaws.
You fight back and eat automatically when attacked or hungry.
Pets: Brindlehounds (shaggy striped hounds in forests, plains, snow) can be tamed with bones ("tame"). Your pet follows you, fights for you and travels through gates with you.
THE REALMS (the big adventure):
 1. The Emberdeep, a fire cavern over a lava sea. Get 10 obsidian (deep, y 3-12, needs an iron pickaxe) + craft flint_and_steel (iron_ingot + flint), then "gate ember; enter". There: emberite ore (best fire-proof gear), Scorchlings (shoot fireballs, drop ember_rods), Magmites, Cinderhogs (food). Ember keeps hold loot chests. Walk back into the gate to return.
 2. The Skyreach, floating islands in the sky. Craft 4 storm_eye (ember_rod + sapphire + 2 glow_dust each) and 10 stone_bricks, then "gate sky; enter". Falling off an island is death. Sky crystals there make skysteel (the best gear).
 3. The Stormwarden, a giant storm guardian waiting in the Skyreach arena (600 HP, fireballs, summons Galewings). Beating it together is the ultimate victory.
Other gear: shield (blocks 40% of hits), bow + arrows, golden_apple, lantern, fishing_rod, shears. Building blocks: stone_bricks, bricks, marble_bricks, cinder_bricks, skystone_bricks, glass, glass_tile, terracotta, thatch, lanterns.
YOUR STATUS includes a MAP, NEAREST resources (with direction, even buried ones), PROGRESS and SUGGESTED NEXT. Use them instead of calling just to look, and chain many commands per call.

RULES
- Only run bw.js with your own token. Do not read files, look at other processes, or contact the server any other way. That would be cheating.
- Keep your thinking short: read the status, decide, run the next command.
- Use "say" to talk to the others (short, in character, at most one per call).
- When the output says STOP, stop immediately and reply with only: done`;
}

(async () => {
  switch (cmd) {
    case 'new': {
      const names = opt('names') ? String(opt('names')).split(',').map(s => s.trim()).filter(Boolean) : NAMES;
      const agents = opt('bots') ? 0 : Number(opt('agents', names.length));
      const config = {};
      if (opt('day')) config.dayLength = Number(opt('day'));
      if (opt('goal')) config.goal = String(opt('goal'));
      if (opt('pvp')) config.pvp = true;
      if (opt('days')) config.days = Number(opt('days'));
      if (opt('cap')) config.callCap = Number(opt('cap'));
      const tokens = {};
      if (opt('keep') && fs.existsSync(AGENTS_DIR)) for (const f of fs.readdirSync(AGENTS_DIR)) { const m = fs.readFileSync(path.join(AGENTS_DIR, f), 'utf8').match(/bw.js" ([0-9a-f]+)/); if (m) tokens[f.replace('.txt', '')] = m[1]; }
      const r = await api('/api/host/new', { names, agents, config, tokens, seed: opt('seed') ? Number(opt('seed')) : undefined, speed: Number(opt('speed', 1)) });
      if (r.error) return console.log(r.error);
      fs.rmSync(AGENTS_DIR, { recursive: true, force: true });
      fs.mkdirSync(AGENTS_DIR, { recursive: true });
      const roster = [];
      for (const p of r.players) if (p.agent) { fs.writeFileSync(path.join(AGENTS_DIR, `${p.name}.txt`), agentPrompt(p, r.config.goal, r.players.length)); roster.push(p.name); }
      console.log(`New world ${r.id} (seed ${r.seed}): ${r.players.length} players, ${roster.length} AI-controlled. Spawn ${Math.floor(r.spawn.x)} ${Math.floor(r.spawn.y)} ${Math.floor(r.spawn.z)}.`);
      if (roster.length) console.log(`Player prompts written to agents\\<Name>.txt (${roster.join(', ')}). Then: node host.js start`);
      else console.log('All players are built-in bots. Run: node host.js start');
      break;
    }
    case 'start': console.log(await api('/api/host/start', {})); break;
    case 'status': {
      const r = await api('/api/host/status');
      if (r.error) return console.log(r.error);
      console.log(`${r.id} | ${r.started ? (r.paused ? 'PAUSED' : 'running') : 'not started'} x${r.speed} | ${r.clock} | ${r.entities} entities${r.over ? ' | OVER' : ''}`);
      for (const p of r.players) console.log(`  ${p.name.padEnd(8)} ${p.agent ? (p.joined ? (p.waiting ? 'AI(wait)' : 'AI(busy)') : 'AI(--)  ') : 'bot     '} HP ${String(p.hp).padStart(2)} food ${String(p.food).padStart(2)} deaths ${p.deaths} @${p.at.join(' ')}  ${p.doing}`);
      break;
    }
    case 'speed': console.log(await api('/api/host/speed', { speed: Number(argv[0]) || 1 })); break;
    case 'pause': console.log(await api('/api/host/pause', { paused: true })); break;
    case 'resume': console.log(await api('/api/host/pause', { paused: false })); break;
    case 'say': console.log(await api('/api/host/say', { text: argv.join(' ') })); break;
    case 'cmd': console.log(await api('/api/host/cmd', { name: argv[0], cmds: argv.slice(1).join(' ') })); break;
    case 'brief': { const r = await api('/api/host/brief', { name: argv[0] }); console.log(r.text || r.error); break; }
    case 'save': console.log(await api('/api/host/save', {})); break;
    case 'load': console.log(await api('/api/host/load', {})); break;
    case 'end': console.log(await api('/api/host/end', { reason: argv.join(' ') || 'host' })); break;
    case 'url': console.log(`${BASE}/?key=${key()}`); break;
    default: console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 13).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  }
})();
