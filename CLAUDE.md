# Blockwild: instructions for Claude

You're helping someone run **Blockwild**, an original 3D voxel survival game played by AI agents. They want the same setup the creator uses: 8 AI players (you plus 7 Haiku subagents) playing one match while the user watches live in a browser. They're probably not a programmer, so keep explanations short and just do the routine steps.

## 1. One-time setup
- Node.js 18 or newer is required (`node -v`). If it's missing, ask the user to install the LTS version from nodejs.org.
- The release zip already includes the three.js file in `node_modules/three/build`. If you cloned the repo instead, run `npm install` once.
- Smoke test: run `node test/realms.test.js`. It should pass.

## 2. Start a match
1. Start the server as a long-running background process, from this folder: `node server.js` (port 7788). On first run it creates `.host-key`. Never show that key to the user or anyone else.
2. Create a new game: `node host.js new --agents 8 --names "Claude,Ada,Bolt,Cosmo,Dot,Echo,Fizz,Gizmo"`. This writes one prompt per player to `agents/<Name>.txt`, and each prompt includes that player's token.
3. Run `node host.js start`.
4. Get the viewer link with `node host.js url` and open it in the browser for the user. Don't paste the link in chat, because it contains the host key.
5. Start the watchdog in the background: `node autopause.js 75`. It pauses the game when every agent has been idle for 75 s, so no game time is lost while agents are waiting.

## 3. Players
- **7 subagents:** spawn one background subagent per non-Claude player on the cheapest model (Haiku). Use this prompt: "Read `<full path>/agents/<Name>.txt` and follow it exactly. Keep playing until the game ends." Spawn each one only once, and don't spawn duplicates.
- **You play "Claude":** read `agents/Claude.txt`, then repeatedly run `node bw.js <your token> "cmd; cmd; ..."`. Run long calls in the background. Follow the status sections SUGGESTED NEXT, PROGRESS and NEAREST.
- Give the user short, fun progress updates.

## 4. Handy host commands
- `node host.js status` / `pause` / `resume` / `speed 2`
- `node host.js say "message"` (all players see it in chat)
- `node host.js brief <Name>` (look at one player's status)
- `node host.js cmd <Name> "stop; explore 8"` (unstick a player)
- `node host.js save`, `node host.js load`, `node host.js end`

## 5a. Same characters every session (diaries)
Each player has a diary, `agents/<Name>.memory.md`. Every player prompt tells the agent to read its diary first and to rewrite it before it stops, so personalities, friendships, grudges and debts carry over. Remind subagents to do this. Let the agents finish (or stop them) before you pause or restart the server, otherwise their calls hang.

## 5b. Saving and resuming a world
- `node host.js save` writes `replays/latest-save.json.gz`. The game also auto-saves every 3 minutes and when the server shuts down.
- After restarting the server, run `node host.js load` to continue the saved world instead of starting a new one.

## 5c. Building tips
- `fill <block> X1 Y1 Z1 X2 Y2 Z2 replace` swaps out blocks that are already there, for example cobblestone to oak_planks.
- The game has oak_door, bed, glass and six carpet colours (red, blue, green, cream, brown, purple).

Replays are saved in `replays/`. Watch one with the viewer URL plus `&replay=<file>`.

## 5. Saving usage
With 8 players, a match takes about 2–3 hours of real time to beat the Stormwarden boss. To use less, run fewer players (`--agents 4`), or end early with `node host.js end`.

## Rules
- Keep the game original. Don't turn it into a copy of another game.
- Never reveal the host key or player tokens in chat.
- Make sure there's free disk space for replays (a few tens of MB per match).

See README.md for the full game guide.
