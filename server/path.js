'use strict';
// A* over standing positions. Can dig through blocks, bridge gaps and pillar up when allowed.
const { BLOCKS } = require('../shared/defs');

class Heap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= n.f) break; a[i] = a[p]; i = p; } a[i] = n; }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      let i = 0; const n = a.length;
      for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < n && a[l].f < (m === i ? last.f : a[m].f)) m = l; if (r < n && a[r].f < (m === i ? last.f : a[m].f)) m = r; if (m === i) break; a[i] = a[m]; i = m; }
      a[i] = last;
    }
    return top;
  }
  get size() { return this.a.length; }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

// opts: { dig: (id) => ticks|Infinity, place: bool, maxNodes, maxFall, partial }
function findPath(world, sx, sy, sz, goal, opts = {}) {
  const maxNodes = opts.maxNodes || 4000, maxFall = opts.maxFall || 3;
  const key = (x, y, z) => (x * 1024 + z) * 256 + y;
  const id = (x, y, z) => world.get(x, y, z);
  const bodyCell = (x, y, z, digs) => { // cost to have a body part in this cell
    const b = BLOCKS[id(x, y, z)];
    if (b.liquid === 'lava' || b.hurts) return Infinity;
    if (!b.solid) return b.liquid ? 1.5 : 0;
    if (!opts.dig || b.hardness < 0) return Infinity;
    const t = opts.dig(b.id);
    if (!isFinite(t)) return Infinity;
    if (BLOCKS[id(x, y + 1, z)].gravity && y + 1 > sy - 50) return Infinity; // avoid digging under sand/gravel
    digs.push([x, y, z]);
    return 2.5 + t / 3;
  };
  const climb = (x, y, z) => !!BLOCKS[id(x, y, z)].climb;
  const ground = (x, y, z) => { const b = BLOCKS[id(x, y - 1, z)]; return (b.solid && !b.hurts) || climb(x, y, z) || b.climb; };
  const inWater = (x, y, z) => BLOCKS[id(x, y, z)].liquid === 'water';
  const h = (x, y, z) => { const dx = x - goal.hx, dy = y - goal.hy, dz = z - goal.hz; return Math.sqrt(dx * dx + dy * dy * 1.5 + dz * dz); };

  const open = new Heap(), seen = new Map();
  const start = { x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz), p: null, digs: null, place: null, k: key(sx, sy, sz) };
  open.push(start); seen.set(start.k, start);
  let best = start, bestH = h(sx, sy, sz), count = 0;
  const add = (from, x, y, z, cost, digs, place) => {
    const k = key(x, y, z), g = from.g + cost, old = seen.get(k);
    if (old && old.g <= g) return;
    const n = { x, y, z, g, f: g + h(x, y, z) * 1.05, p: from, digs: digs && digs.length ? digs : null, place, k };
    seen.set(k, n); open.push(n);
  };
  while (open.size) {
    const n = open.pop();
    if (n.closed) continue;
    n.closed = true;
    if (goal.isGoal(n.x, n.y, n.z)) return build(n);
    const hn = h(n.x, n.y, n.z);
    if (hn < bestH) { bestH = hn; best = n; }
    if (++count > maxNodes) break;
    const { x, y, z } = n, swim = inWater(x, y, z);
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (!world.inBounds(nx, nz)) continue;
      // flat
      let d = [], c = bodyCell(nx, y, nz, d) + bodyCell(nx, y + 1, nz, d);
      if (isFinite(c)) {
        if (ground(nx, y, nz) || inWater(nx, y, nz)) add(n, nx, y, nz, 1 + c, d);
        else if (!d.length) {
          // drop down
          let k = 1;
          for (; k <= maxFall + (inWater(nx, y - k, nz) ? 20 : 0); k++) {
            const b = BLOCKS[id(nx, y - k, nz)];
            if (b.solid || b.liquid === 'lava' || b.hurts) break;
            if (ground(nx, y - k, nz) || inWater(nx, y - k, nz)) { add(n, nx, y - k, nz, 1 + k * 0.4, null); break; }
          }
          // bridge: place a block under the next cell
          if (opts.place && !BLOCKS[id(nx, y - 1, nz)].solid) add(n, nx, y, nz, 4, null, [nx, y - 1, nz]);
        }
      }
      // step up
      d = [];
      c = bodyCell(x, y + 2, z, d) + bodyCell(nx, y + 1, nz, d) + bodyCell(nx, y + 2, nz, d);
      if (isFinite(c) && (ground(nx, y + 1, nz) || inWater(nx, y + 1, nz)) && (ground(x, y, z) || swim)) add(n, nx, y + 1, nz, 1.6 + c, d);
    }
    for (const [dx, dz] of DIAG) {
      const nx = x + dx, nz = z + dz, e = [];
      if (bodyCell(nx, y, z, e) + bodyCell(nx, y + 1, z, e) + bodyCell(x, y, nz, e) + bodyCell(x, y + 1, nz, e) + bodyCell(nx, y, nz, e) + bodyCell(nx, y + 1, nz, e) === 0 && !e.length && ground(nx, y, nz))
        add(n, nx, y, nz, 1.42, null);
    }
    // dig straight down
    if (opts.dig) {
      const d = [], c = bodyCell(x, y - 1, z, d);
      if (d.length && isFinite(c) && ground(x, y - 1, z) && !BLOCKS[id(x, y - 2, z)].liquid) add(n, x, y - 1, z, 1 + c, d);
    }
    // climb a ladder up or down
    if (climb(x, y, z) || climb(x, y + 1, z)) { const d = [], c = bodyCell(x, y + 2, z, d); if (c === 0) add(n, x, y + 1, z, 1.3, null); }
    if (climb(x, y - 1, z)) add(n, x, y - 1, z, 1.2, null);
    // swim up / pillar up
    if (swim) { const d = [], c = bodyCell(x, y + 1, z, d) + bodyCell(x, y + 2, z, d); if (isFinite(c) && !d.length) add(n, x, y + 1, z, 1.2, null); }
    else if (opts.place && ground(x, y, z)) {
      const d = [], c = bodyCell(x, y + 2, z, d);
      if (isFinite(c)) add(n, x, y + 1, z, 4 + c, d, [x, y, z]);
    }
  }
  return opts.partial && best !== start ? build(best, true) : null;
}

function build(n, partial) {
  const out = [];
  for (; n.p; n = n.p) out.push({ x: n.x, y: n.y, z: n.z, digs: n.digs, place: n.place });
  out.reverse();
  out.partial = !!partial;
  return out;
}

module.exports = { findPath };
