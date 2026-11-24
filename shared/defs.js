/* Blockwild shared definitions: blocks, items, tools, armor, recipes, smelting, mobs, biomes.
   Works in Node (require), in the browser (window.BW.defs) and in workers (self.BW.defs). */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.BW = root.BW || {}; root.BW.defs = m; }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const CHUNK = 16, HEIGHT = 128, SEA = 48, WORLD_CHUNKS = 32;
  const label = s => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // ---------- realms ----------
  // The overworld runs 30,000,000 blocks out from 0,0 in every direction (60 million across), with a hard border.
  // The other realms live past the border to the east in the same block grid, so the server, viewer and replays treat them as ordinary terrain.
  const BORDER = 30000000, BC = BORDER / 16, RCX = 1900000, RDX = RCX * 16;
  const REALMS = [
    { name: 'overworld', label: 'the Overworld', cx0: -BC, cx1: BC, cz0: -BC, cz1: BC },
    { name: 'emberdeep', label: 'the Emberdeep', cx0: RCX + 40, cx1: RCX + 56, cz0: 8, cz1: 24, arrive: [RDX + 768, 256] },
    { name: 'skyreach', label: 'the Skyreach', cx0: RCX + 64, cx1: RCX + 80, cz0: 8, cz1: 24, arrive: [RDX + 1152, 318], arena: [RDX + 1152, 256] },
  ];
  const SPAWN_C = 256; // players start near 256,256 (the original island centre)
  // one number per chunk, for any chunk coords up to +/-4 million
  const CK = 8388608, CH = 4194304;
  const ckey = (cx, cz) => (cx + CH) * CK + (cz + CH);
  const ckx = k => Math.floor(k / CK) - CH, ckz = k => (k % CK) - CH;
  const REALM = {}; REALMS.forEach(r => { REALM[r.name] = r; });
  const WORLD_X_CHUNKS = RCX + 80, WORLD_X = WORLD_X_CHUNKS * 16;
  const realmOfChunk = (cx, cz) => { for (const r of REALMS) if (cx >= r.cx0 && cx < r.cx1 && cz >= r.cz0 && cz < r.cz1) return r; return null; };
  const realmAt = (x, z) => realmOfChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
  const inWorld = (x, z) => realmAt(x, z) != null;

  // ---------- biomes ----------
  const BIOMES = [
    { name: 'ocean', grass: [0.55, 0.72, 0.45], foliage: [0.38, 0.62, 0.30], water: [0.22, 0.45, 0.85] },
    { name: 'beach', grass: [0.57, 0.74, 0.36], foliage: [0.42, 0.64, 0.26], water: [0.22, 0.52, 0.86] },
    { name: 'plains', grass: [0.50, 0.72, 0.24], foliage: [0.38, 0.62, 0.18], water: [0.24, 0.48, 0.86] },
    { name: 'forest', grass: [0.36, 0.62, 0.18], foliage: [0.26, 0.52, 0.13], water: [0.22, 0.44, 0.80] },
    { name: 'desert', grass: [0.74, 0.72, 0.36], foliage: [0.68, 0.66, 0.30], water: [0.26, 0.56, 0.82] },
    { name: 'snowy', grass: [0.50, 0.68, 0.58], foliage: [0.40, 0.58, 0.48], water: [0.22, 0.34, 0.80] },
    { name: 'mountains', grass: [0.48, 0.66, 0.50], foliage: [0.36, 0.56, 0.38], water: [0.22, 0.40, 0.80] },
    { name: 'swamp', grass: [0.38, 0.44, 0.20], foliage: [0.30, 0.38, 0.15], water: [0.30, 0.42, 0.34] },
    { name: 'river', grass: [0.50, 0.72, 0.30], foliage: [0.36, 0.60, 0.22], water: [0.24, 0.50, 0.88] },
    { name: 'emberdeep', grass: [0.62, 0.36, 0.22], foliage: [0.60, 0.30, 0.18], water: [0.30, 0.30, 0.40] },
    { name: 'skyreach', grass: [0.56, 0.86, 0.70], foliage: [0.60, 0.88, 0.80], water: [0.40, 0.70, 0.98] },
  ];
  const BIOME = {}; BIOMES.forEach((b, i) => { BIOME[b.name] = i; b.label = label(b.name); });

  // ---------- blocks ----------
  // render: none | cube | cutout (alpha-tested cube) | leaves | cross | torch | liquid | blend (translucent cube)
  const BLOCKS = [], B = {};
  function block(name, o = {}) {
    const d = Object.assign({ name, label: label(name), solid: true, opaque: true, render: 'cube', tex: name, hardness: 1, tool: null, tier: 0, drop: name, light: 0, filter: 0, height: 1 }, o);
    if (d.render !== 'cube') d.opaque = o.opaque === true;
    d.id = BLOCKS.length; BLOCKS.push(d); B[name] = d.id; return d;
  }
  const plant = o => Object.assign({ solid: false, render: 'cross', hardness: 0, replaceable: true, support: true, sway: true }, o);

  block('air', { solid: false, render: 'none', hardness: 0, drop: null, replaceable: true });
  block('bedrock', { hardness: -1, drop: null });
  block('stone', { hardness: 1.5, tool: 'pickaxe', tier: 1, drop: 'cobblestone' });
  block('darkstone', { hardness: 3, tool: 'pickaxe', tier: 1 });
  block('granite', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  block('cobblestone', { hardness: 2, tool: 'pickaxe', tier: 1 });
  block('mossy_cobblestone', { hardness: 2, tool: 'pickaxe', tier: 1 });
  block('dirt', { hardness: 0.5, tool: 'shovel' });
  block('grass', { hardness: 0.6, tool: 'shovel', drop: 'dirt', tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, tint: 'grass' });
  block('snowy_grass', { hardness: 0.6, tool: 'shovel', drop: 'dirt', tex: { top: 'snow', side: 'snowy_grass_side', bottom: 'dirt' } });
  block('sand', { hardness: 0.5, tool: 'shovel', gravity: true });
  block('gravel', { hardness: 0.6, tool: 'shovel', gravity: true, drop: [{ item: 'flint', chance: 0.12, only: true }, { item: 'gravel' }] });
  block('clay', { hardness: 0.6, tool: 'shovel', drop: [{ item: 'clay_ball', n: [4, 4] }] });
  block('sandstone', { hardness: 0.8, tool: 'pickaxe', tier: 1, tex: { top: 'sandstone_top', side: 'sandstone', bottom: 'sandstone_top' } });
  block('snow_block', { hardness: 0.2, tool: 'shovel', tex: 'snow' });
  block('ice', { hardness: 0.5, tool: 'pickaxe', render: 'blend', drop: null, filter: 1, cullSame: true });
  block('water', { solid: false, render: 'liquid', hardness: -1, drop: null, liquid: 'water', filter: 2, replaceable: true, tint: 'water' });
  block('lava', { solid: false, render: 'liquid', hardness: -1, drop: null, liquid: 'lava', light: 15, replaceable: true });
  for (const w of ['oak', 'birch', 'pine']) {
    block(w + '_log', { hardness: 2, tool: 'axe', group: 'log', tex: { top: w + '_log_top', side: w + '_log', bottom: w + '_log_top' } });
    block(w + '_leaves', {
      hardness: 0.2, tool: 'hoe', render: 'leaves', filter: 1, sway: true, group: 'leaves', decays: true, tint: w === 'oak' ? 'foliage' : w,
      drop: [{ item: w + '_sapling', chance: 0.07 }, { item: 'apple', chance: w === 'oak' ? 0.05 : 0 }, { item: 'stick', chance: 0.04 }],
    });
    block(w + '_planks', { hardness: 2, tool: 'axe', group: 'planks' });
  }
  block('coal_ore', { hardness: 3, tool: 'pickaxe', tier: 1, drop: 'coal', ore: true });
  block('copper_ore', { hardness: 3, tool: 'pickaxe', tier: 2, drop: [{ item: 'raw_copper', n: [1, 3] }], ore: true });
  block('iron_ore', { hardness: 3, tool: 'pickaxe', tier: 2, drop: 'raw_iron', ore: true });
  block('gold_ore', { hardness: 3, tool: 'pickaxe', tier: 3, drop: 'raw_gold', ore: true });
  block('sapphire_ore', { hardness: 3, tool: 'pickaxe', tier: 3, drop: 'sapphire', ore: true });
  block('glow_crystal', { hardness: 0.3, light: 15, drop: [{ item: 'glow_dust', n: [2, 4] }], ore: true });
  block('obsidian', { hardness: 12, tool: 'pickaxe', tier: 3 });
  block('glass', { hardness: 0.3, render: 'cutout', drop: null, cullSame: true });
  block('bricks', { hardness: 2, tool: 'pickaxe', tier: 1 });
  block('stone_bricks', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  block('mossy_stone_bricks', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  block('workbench', { hardness: 2.5, tool: 'axe', tex: { top: 'workbench_top', side: 'workbench_side', front: 'workbench_front', bottom: 'oak_planks' } });
  block('furnace', { hardness: 3.5, tool: 'pickaxe', tier: 1, tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front', bottom: 'furnace_top' } });
  block('furnace_lit', { hardness: 3.5, tool: 'pickaxe', tier: 1, light: 13, drop: 'furnace', noItem: true, tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit', bottom: 'furnace_top' } });
  block('chest', { hardness: 2.5, tool: 'axe', tex: { top: 'chest_top', side: 'chest_side', front: 'chest_front', bottom: 'chest_top' } });
  block('torch', { solid: false, render: 'torch', hardness: 0, light: 14, support: true });
  block('tall_grass', plant({ tint: 'grass', drop: [{ item: 'seeds', chance: 0.14 }] }));
  block('emberbloom', plant({ replaceable: false }));
  block('sunpetal', plant({ replaceable: false }));
  block('frostbell', plant({ replaceable: false }));
  block('brown_mushroom', plant({ replaceable: false, sway: false }));
  block('glowcap', plant({ replaceable: false, sway: false, light: 7 }));
  block('dead_bush', plant({ drop: [{ item: 'stick', n: [0, 2] }] }));
  block('cactus', { hardness: 0.4, render: 'cutout', tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' }, hurts: 1, support: true });
  block('reeds', plant({ replaceable: false, sway: false }));
  block('pumpkin', { hardness: 1, tool: 'axe', tex: { top: 'pumpkin_top', side: 'pumpkin_side', bottom: 'pumpkin_top' } });
  block('wool', { hardness: 0.8 });
  block('bedroll', { hardness: 0.2, height: 0.25, render: 'cutout', tex: { top: 'bedroll_top', side: 'bedroll_side', bottom: 'oak_planks' }, bed: true });
  block('farmland', { hardness: 0.6, tool: 'shovel', drop: 'dirt', height: 0.9375, render: 'cutout', tex: { top: 'farmland', side: 'dirt', bottom: 'dirt' } });
  for (let i = 0; i < 4; i++) block('wheat_' + i, plant({ replaceable: false, sway: i > 0, crop: i, noItem: true, drop: i < 3 ? 'seeds' : [{ item: 'wheat' }, { item: 'seeds', n: [1, 3] }] }));
  for (const w of ['oak', 'birch', 'pine']) block(w + '_sapling', plant({ replaceable: false, sapling: w }));
  block('hay_bale', { hardness: 0.5, tex: { top: 'hay_top', side: 'hay_side', bottom: 'hay_top' } });
  block('bookshelf', { hardness: 1.5, tool: 'axe', tex: { top: 'oak_planks', side: 'bookshelf', bottom: 'oak_planks' }, drop: [{ item: 'book', n: [3, 3] }] });
  block('glow_lamp', { hardness: 0.3, light: 15 });
  block('blast_barrel', { hardness: 0, tex: { top: 'blast_barrel_top', side: 'blast_barrel_side', bottom: 'blast_barrel_top' }, explosive: true });
  block('coal_block', { hardness: 5, tool: 'pickaxe', tier: 1 });
  block('copper_block', { hardness: 5, tool: 'pickaxe', tier: 2 });
  block('iron_block', { hardness: 5, tool: 'pickaxe', tier: 2 });
  block('gold_block', { hardness: 5, tool: 'pickaxe', tier: 3 });
  block('sapphire_block', { hardness: 5, tool: 'pickaxe', tier: 3 });
  block('goo_block', { hardness: 0, render: 'blend', bouncy: true, cullSame: true });
  // building blocks
  block('lantern', { hardness: 1, tool: 'pickaxe', light: 15 });
  block('polished_granite', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  block('terracotta', { hardness: 1.25, tool: 'pickaxe', tier: 1 });
  block('glass_tile', { hardness: 0.3, render: 'cutout', drop: null, cullSame: true });
  block('thatch', { hardness: 0.5, tex: { top: 'hay_top', side: 'thatch', bottom: 'hay_top' } });
  block('marble', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  block('marble_bricks', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  // the Emberdeep
  block('cinderstone', { hardness: 0.6, tool: 'pickaxe', tier: 1 });
  block('ashsand', { hardness: 0.5, tool: 'shovel' });
  block('magma_rock', { hardness: 0.8, tool: 'pickaxe', tier: 1, light: 6, hurts: 1 });
  block('emberite_ore', { hardness: 3, tool: 'pickaxe', tier: 3, drop: [{ item: 'ember_shard', n: [1, 2] }], ore: true, light: 4 });
  block('cinder_bricks', { hardness: 2, tool: 'pickaxe', tier: 1 });
  block('emberite_block', { hardness: 5, tool: 'pickaxe', tier: 3, light: 8 });
  block('ember_portal', { solid: false, render: 'blend', hardness: -1, drop: null, light: 11, portal: 'emberdeep', noItem: true, cullSame: true });
  // the Skyreach
  block('skystone', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  block('cloud_turf', { hardness: 0.6, tool: 'shovel', drop: 'skystone', tex: { top: 'cloud_turf_top', side: 'cloud_turf_side', bottom: 'skystone' } });
  block('skycrystal_ore', { hardness: 4, tool: 'pickaxe', tier: 4, drop: 'sky_crystal', ore: true, light: 5 });
  block('skystone_bricks', { hardness: 1.5, tool: 'pickaxe', tier: 1 });
  block('skysteel_block', { hardness: 6, tool: 'pickaxe', tier: 4 });
  block('sky_portal', { solid: false, render: 'blend', hardness: -1, drop: null, light: 12, portal: 'skyreach', noItem: true, cullSame: true });
  block('gale_bloom', plant({ replaceable: false, light: 5 }));
  for (const c of ['red','blue','green','cream','brown','purple']) block(c + '_carpet', { hardness: 0.1, height: 0.0625, render: 'cutout' });
  block('bed', { hardness: 0.3, tool: 'axe', height: 0.5625, render: 'cutout', tex: { top: 'bed_top', side: 'bed_side', bottom: 'oak_planks' }, bed: true });
  block('oak_door', { solid: false, hardness: 1, tool: 'axe', render: 'cutout', tex: { top: 'oak_planks', side: 'oak_door', bottom: 'oak_planks' } });

  // ---------- v4 content: more woods, building pieces, ores, plants ----------
  const add = (name, o) => (B[name] == null ? block(name, o) : BLOCKS[B[name]]);
  const NEW_WOODS = ['jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry'];
  for (const w of NEW_WOODS) {
    add(w + '_log', { hardness: 2, tool: 'axe', group: 'log', tex: { top: w + '_log_top', side: w + '_log', bottom: w + '_log_top' } });
    add(w + '_leaves', { hardness: 0.2, tool: 'hoe', render: 'leaves', filter: 1, sway: true, group: 'leaves', decays: true, tint: w === 'cherry' ? undefined : 'foliage',
      drop: [{ item: w + '_sapling', chance: 0.07 }, { item: 'stick', chance: 0.04 }] });
    add(w + '_planks', { hardness: 2, tool: 'axe', group: 'planks' });
    add(w + '_sapling', plant({ replaceable: false, sapling: w }));
  }
  add('bamboo', plant({ replaceable: false, sway: true }));
  add('bamboo_planks', { hardness: 2, tool: 'axe', group: 'planks' });
  const ALL_WOODS = ['oak', 'birch', 'pine', ...NEW_WOODS, 'bamboo'];
  for (const w of ALL_WOODS) {
    const pl = w + '_planks';
    add(w + '_stairs', { hardness: 2, tool: 'axe', stairs: true, render: 'cutout', tex: pl });
    add(w + '_slab', { hardness: 2, tool: 'axe', height: 0.5, render: 'cutout', tex: pl });
    add(w + '_fence', { hardness: 2, tool: 'axe', render: 'cutout', tex: { top: pl, side: w + '_fence', bottom: pl } });
    add(w + '_fence_gate', { solid: false, hardness: 2, tool: 'axe', render: 'cutout', tex: { top: pl, side: w + '_fence_gate', bottom: pl } });
    add(w + '_door', { solid: false, hardness: 1, tool: 'axe', render: 'cutout', tex: { top: pl, side: w + '_door', bottom: pl } });
    add(w + '_trapdoor', { solid: false, hardness: 1, tool: 'axe', height: 0.1875, render: 'cutout', tex: w + '_trapdoor' });
  }
  add('ladder', { solid: false, hardness: 0.4, tool: 'axe', render: 'cutout', climb: true });
  add('diamond_ore', { hardness: 3, tool: 'pickaxe', tier: 3, drop: 'diamond', ore: true });
  add('emerald_ore', { hardness: 3, tool: 'pickaxe', tier: 3, drop: 'emerald', ore: true });
  add('lapis_ore', { hardness: 3, tool: 'pickaxe', tier: 2, drop: [{ item: 'lapis_lazuli', n: [4, 8] }], ore: true });
  add('redstone_ore', { hardness: 3, tool: 'pickaxe', tier: 3, drop: [{ item: 'redstone_dust', n: [4, 5] }], ore: true, light: 2 });
  add('quartz_ore', { hardness: 3, tool: 'pickaxe', tier: 1, drop: [{ item: 'quartz', n: [1, 2] }], ore: true });
  add('amethyst_block', { hardness: 1.5, tool: 'pickaxe', tier: 1, drop: [{ item: 'amethyst_shard', n: [2, 4] }], light: 3 });
  for (const m of ['diamond', 'emerald', 'lapis', 'redstone', 'quartz']) add(m + '_block', { hardness: 5, tool: 'pickaxe', tier: 2, light: m === 'redstone' ? 4 : 0 });
  add('redstone_lamp', { hardness: 0.3, light: 15 });
  add('candle', { hardness: 0.1, solid: false, render: 'torch', light: 6, drop: 'candle' });
  add('rail', { solid: false, hardness: 0.7, height: 0.0625, render: 'cutout', tool: 'pickaxe' });
  add('melon', { hardness: 1, tool: 'axe', drop: [{ item: 'melon_slice', n: [3, 7] }], tex: { top: 'melon_top', side: 'melon', bottom: 'melon_top' } });
  add('sweet_berry_bush', plant({ replaceable: false, drop: [{ item: 'sweet_berries', n: [1, 3] }] }));
  add('carrots', plant({ replaceable: false, sway: false, drop: [{ item: 'carrot', n: [1, 3] }] }));
  add('potatoes', plant({ replaceable: false, sway: false, drop: [{ item: 'potato', n: [1, 3] }, { item: 'poisonous_potato', chance: 0.02 }] }));
  add('beetroots', plant({ replaceable: false, sway: false, drop: [{ item: 'beetroot', n: [1, 1] }] }));
  const FLOWERS = ['poppy', 'dandelion', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'sunflower', 'lilac', 'rose_bush', 'peony'];
  for (const f of FLOWERS) add(f, plant({ replaceable: false, group: 'flower' }));
  add('flower_pot', { hardness: 0.1, height: 0.375, render: 'cutout', tex: { top: 'flower_pot_top', side: 'flower_pot', bottom: 'flower_pot' } });
  const DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

  // ---------- shapes: stairs face their high side towards the next stair up, else a wall; ladders hang on a wall ----------
  const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W
  function stairFacing(get, x, y, z) {
    const st = i => BLOCKS[i] && BLOCKS[i].stairs;
    for (let d = 0; d < 4; d++) if (st(get(x + SIDES[d][0], y + 1, z + SIDES[d][1]))) return d;
    for (let d = 0; d < 4; d++) if (st(get(x - SIDES[d][0], y - 1, z - SIDES[d][1]))) return d;
    for (let d = 0; d < 4; d++) { const n = BLOCKS[get(x + SIDES[d][0], y, z + SIDES[d][1])]; if (n && n.solid && n.opaque && !n.stairs) return d; }
    return 0;
  }
  const STAIR_TOP = [[0, 0.5, 0, 1, 1, 0.5], [0.5, 0.5, 0, 1, 1, 1], [0, 0.5, 0.5, 1, 1, 1], [0, 0.5, 0, 0.5, 1, 1]];
  const stairBoxes = f => [[0, 0, 0, 1, 0.5, 1], STAIR_TOP[f]];
  function wallSide(get, x, y, z) {
    for (let d = 0; d < 4; d++) { const n = BLOCKS[get(x + SIDES[d][0], y, z + SIDES[d][1])]; if (n && n.solid && n.opaque) return d; }
    return 0;
  }
  // collision boxes of a block in its own cell (unit coordinates)
  function blockBoxes(get, x, y, z, b) {
    if (b.stairs) return stairBoxes(stairFacing(get, x, y, z));
    return [[0, 0, 0, 1, b.height, 1]];
  }

  // per-face tile name. faces: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
  function faceTile(b, f) {
    const t = b.tex;
    if (typeof t === 'string') return t;
    if (f === 2) return t.top || t.side;
    if (f === 3) return t.bottom || t.top || t.side;
    if (t.front && (f === 4 || f === 5)) return t.front;
    return t.side;
  }
  // doors: the lower half uses the side tile, the upper half (when a door sits below) the "top" tile
  for (const b of BLOCKS) if (/_door$/.test(b.name)) { b.door = true; b.tex = Object.assign({}, b.tex, { top: b.name + '_top' }); }
  const TILES = [];
  for (const b of BLOCKS) if (b.render !== 'none') for (let f = 0; f < 6; f++) { const n = faceTile(b, f); if (!TILES.includes(n)) TILES.push(n); }

  // ---------- items ----------
  const ITEMS = {};
  function item(name, o = {}) { ITEMS[name] = Object.assign({ name, label: label(name), stack: 64 }, ITEMS[name] || {}, o); return ITEMS[name]; }
  for (const b of BLOCKS) if (b.name !== 'air' && !b.noItem && !b.liquid) item(b.name, { block: b.id });
  for (const n of ['stick', 'coal', 'charcoal', 'raw_copper', 'raw_iron', 'raw_gold', 'copper_ingot', 'iron_ingot', 'gold_ingot', 'sapphire', 'flint', 'fiber',
    'bone', 'bone_meal', 'spore_dust', 'goo', 'feather', 'hide', 'clay_ball', 'brick', 'glow_dust', 'wheat', 'paper', 'book', 'bowl', 'arrow', 'egg',
    'ember_shard', 'ember_rod', 'storm_eye', 'sky_crystal', 'skysteel_ingot', 'storm_heart', 'string']) item(n);
  item('flint_and_steel', { stack: 1, tool: { type: 'igniter', dur: 64, dmg: 1 } });
  item('shield', { stack: 1, shield: { dur: 240, block: 0.4 } });
  item('fishing_rod', { stack: 1, tool: { type: 'rod', dur: 64, dmg: 1 } });
  item('shears', { stack: 1, tool: { type: 'shears', dur: 238, dmg: 1 } });
  item('seeds', { places: 'wheat_0' });
  item('bucket', { stack: 16 });
  item('water_bucket', { stack: 1, places: 'water' });
  item('lava_bucket', { stack: 1, places: 'lava' });
  item('bow', { stack: 1, tool: { type: 'bow', dur: 384, dmg: 6 } });
  const FOOD = { apple: [4, 2.4], bread: [5, 6], raw_venison: [3, 1.8], cooked_venison: [8, 12.8], raw_poultry: [2, 1.2], cooked_poultry: [6, 7.2],
    raw_boar: [3, 1.8], cooked_boar: [8, 12.8], raw_fish: [2, 0.4], cooked_fish: [5, 6], mushroom_stew: [6, 7.2], pumpkin_pie: [8, 4.8],
    golden_apple: [4, 9.6], cloudberry: [3, 3.6], ember_pepper: [4, 4] };
  for (const [n, [h, s]] of Object.entries(FOOD)) item(n, { food: { hunger: h, sat: s }, stack: n === 'mushroom_stew' ? 1 : 64 });

  // v4 items
  for (const n of ['diamond', 'emerald', 'lapis_lazuli', 'redstone_dust', 'amethyst_shard', 'quartz', 'leather', 'sugar', 'glass_bottle', 'snowball', 'fire_charge',
    'compass', 'clock', 'name_tag', 'lead', 'saddle', 'gunpowder', 'slimeball', 'ink_sac', 'rotten_flesh', 'spider_eye', 'iron_nugget', 'gold_nugget']) item(n);
  for (const c of DYES) item(c + '_dye');
  item('spyglass', { stack: 1 });
  item('crossbow', { stack: 1, tool: { type: 'bow', dur: 465, dmg: 9 } });
  item('trident', { stack: 1, tool: { type: 'sword', tier: 'iron', level: 0, speed: 1, dur: 250, dmg: 9, cd: 1.1 } });
  const FOOD2 = { carrot: [3, 3.6], golden_carrot: [6, 14.4], potato: [1, 0.6], baked_potato: [5, 6], poisonous_potato: [2, 1.2], beetroot: [1, 1.2],
    beetroot_soup: [6, 7.2], cookie: [2, 0.4], cake: [14, 2.8], sweet_berries: [2, 0.4], melon_slice: [2, 1.2], raw_cod: [2, 0.4], cooked_cod: [5, 6],
    raw_salmon: [2, 0.4], cooked_salmon: [6, 9.6], tropical_fish: [1, 0.2], pufferfish: [1, 0.2], dried_kelp: [1, 0.6], honey_bottle: [6, 1.2] };
  for (const [n, [h, s]] of Object.entries(FOOD2)) { FOOD[n] = [h, s]; item(n, { food: { hunger: h, sat: s }, stack: n === 'beetroot_soup' || n === 'cake' ? 1 : 64 }); }
  const FOOD3 = { raw_beef: [3, 1.8], steak: [8, 12.8], raw_pork: [3, 1.8], cooked_pork: [8, 12.8], raw_mutton: [2, 1.2], cooked_mutton: [6, 9.6],
    raw_rabbit: [3, 1.8], cooked_rabbit: [5, 6], rabbit_stew: [10, 12] };
  for (const [n, [h, s]] of Object.entries(FOOD3)) { FOOD[n] = [h, s]; item(n, { food: { hunger: h, sat: s }, stack: n === 'rabbit_stew' ? 1 : 64 }); }
  for (const n of ['rabbit_hide', 'rabbit_foot', 'honeycomb', 'turtle_scute', 'armadillo_scute']) item(n);

  const TIERS = {
    wood: { level: 1, speed: 2, dur: 60, dmg: 0, mat: '#planks', prefix: 'wooden' },
    gold: { level: 1, speed: 12, dur: 32, dmg: 0, mat: 'gold_ingot', prefix: 'golden' },
    stone: { level: 2, speed: 4, dur: 132, dmg: 1, mat: 'cobblestone', prefix: 'stone' },
    copper: { level: 2, speed: 5, dur: 190, dmg: 1.5, mat: 'copper_ingot', prefix: 'copper' },
    iron: { level: 3, speed: 6, dur: 250, dmg: 2, mat: 'iron_ingot', prefix: 'iron' },
    sapphire: { level: 4, speed: 8, dur: 1561, dmg: 3, mat: 'sapphire', prefix: 'sapphire' },
    emberite: { level: 4, speed: 9, dur: 1900, dmg: 4, mat: 'ember_shard', prefix: 'emberite' },
    skysteel: { level: 5, speed: 11, dur: 2600, dmg: 5, mat: 'skysteel_ingot', prefix: 'skysteel' },
  };
  const TOOL_TYPES = { pickaxe: { mat: 3, stick: 2, dmg: 2, cd: 0.6 }, axe: { mat: 3, stick: 2, dmg: 5, cd: 1.0 }, shovel: { mat: 1, stick: 2, dmg: 1.5, cd: 0.6 }, sword: { mat: 2, stick: 1, dmg: 4, cd: 0.6 }, hoe: { mat: 2, stick: 2, dmg: 1, cd: 0.5 } };
  const ARMOR_MATS = {
    hide: { pts: [1, 3, 2, 1], dur: 80, mat: 'hide' }, copper: { pts: [2, 4, 3, 1], dur: 140, mat: 'copper_ingot' },
    iron: { pts: [2, 6, 5, 2], dur: 240, mat: 'iron_ingot' }, sapphire: { pts: [3, 8, 6, 3], dur: 520, mat: 'sapphire' },
    golden: { pts: [2, 5, 3, 1], dur: 110, mat: 'gold_ingot' }, emberite: { pts: [3, 8, 6, 3], dur: 640, mat: 'ember_shard', fireproof: true },
    skysteel: { pts: [4, 9, 7, 4], dur: 900, mat: 'skysteel_ingot' },
  };
  const ARMOR_SLOTS = [['helmet', 5], ['chestplate', 8], ['leggings', 7], ['boots', 4]];
  TIERS.diamond = { level: 4, speed: 8, dur: 1561, dmg: 3, mat: 'diamond', prefix: 'diamond' };
  ARMOR_MATS.leather = { pts: [1, 3, 2, 1], dur: 80, mat: 'leather' };
  ARMOR_MATS.chainmail = { pts: [2, 5, 4, 1], dur: 180, mat: 'iron_nugget' };
  ARMOR_MATS.diamond = { pts: [3, 8, 6, 3], dur: 528, mat: 'diamond' };

  // ---------- recipes (ingredient counts; shape is irrelevant for AI players) ----------
  const RECIPES = [];
  const rec = (out, n, ing, table = true) => RECIPES.push({ out, n, ing, table });
  for (const w of ['oak', 'birch', 'pine']) rec(w + '_planks', 4, { [w + '_log']: 1 }, false);
  rec('stick', 4, { '#planks': 2 }, false);
  rec('workbench', 1, { '#planks': 4 }, false);
  rec('torch', 4, { '#coal': 1, stick: 1 }, false);
  rec('furnace', 1, { cobblestone: 8 });
  rec('chest', 1, { '#planks': 8 });
  for (const c of ['red','blue','green','cream','brown','purple']) rec(c + '_carpet', 3, { wool: 2 }, false);
  rec('oak_door', 3, { oak_planks: 6 });
  rec('bed', 1, { wool: 3, '#planks': 3 });
  rec('bedroll', 1, { wool: 3, '#planks': 3 });
  rec('bread', 1, { wheat: 3 });
  rec('pumpkin_pie', 1, { pumpkin: 1, egg: 1, wheat: 1 }, false);
  rec('hay_bale', 1, { wheat: 9 });
  rec('wheat', 9, { hay_bale: 1 }, false);
  rec('stone_bricks', 4, { stone: 4 }, false);
  rec('mossy_stone_bricks', 1, { stone_bricks: 1, fiber: 1 }, false);
  rec('mossy_cobblestone', 1, { cobblestone: 1, fiber: 1 }, false);
  rec('bricks', 1, { brick: 4 }, false);
  rec('sandstone', 1, { sand: 4 }, false);
  rec('blast_barrel', 1, { spore_dust: 5, sand: 4 });
  rec('bow', 1, { stick: 3, fiber: 3 });
  rec('arrow', 4, { flint: 1, stick: 1, feather: 1 });
  rec('bucket', 1, { iron_ingot: 3 });
  rec('bowl', 4, { '#planks': 3 });
  rec('mushroom_stew', 1, { bowl: 1, brown_mushroom: 1, glowcap: 1 }, false);
  rec('paper', 3, { reeds: 3 });
  rec('book', 1, { paper: 3, hide: 1 }, false);
  rec('bookshelf', 1, { '#planks': 6, book: 3 });
  rec('glow_lamp', 1, { glow_dust: 4 }, false);
  rec('wool', 1, { fiber: 4 }, false);
  rec('bone_meal', 3, { bone: 1 }, false);
  rec('flint_and_steel', 1, { iron_ingot: 1, flint: 1 }, false);
  rec('shield', 1, { '#planks': 6, iron_ingot: 1 });
  rec('string', 2, { fiber: 3 }, false);
  rec('fishing_rod', 1, { stick: 3, string: 2 });
  rec('shears', 1, { iron_ingot: 2 }, false);
  rec('lantern', 1, { iron_ingot: 1, torch: 1 });
  rec('polished_granite', 4, { granite: 4 }, false);
  rec('glass_tile', 4, { glass: 4 }, false);
  rec('thatch', 2, { wheat: 4 }, false);
  rec('marble_bricks', 4, { marble: 4 }, false);
  rec('cinder_bricks', 4, { cinderstone: 4 }, false);
  rec('skystone_bricks', 4, { skystone: 4 }, false);
  rec('golden_apple', 1, { apple: 1, gold_ingot: 4 });
  rec('storm_eye', 1, { ember_rod: 1, sapphire: 1, glow_dust: 2 });
  rec('skysteel_ingot', 1, { sky_crystal: 2, iron_ingot: 1, ember_shard: 1 });
  rec('emberite_block', 1, { ember_shard: 9 });
  rec('ember_shard', 9, { emberite_block: 1 }, false);
  rec('skysteel_block', 1, { skysteel_ingot: 9 });
  rec('skysteel_ingot', 9, { skysteel_block: 1 }, false);
  for (const [blk, it] of [['coal_block', 'coal'], ['copper_block', 'copper_ingot'], ['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['sapphire_block', 'sapphire'], ['goo_block', 'goo']]) {
    rec(blk, 1, { [it]: 9 });
    rec(it, 9, { [blk]: 1 }, false);
  }
  for (const [tn, t] of Object.entries(TIERS)) for (const [ty, tt] of Object.entries(TOOL_TYPES)) {
    const name = t.prefix + '_' + ty;
    item(name, { stack: 1, tool: { type: ty, tier: tn, level: t.level, speed: t.speed, dur: t.dur, dmg: tt.dmg + t.dmg, cd: tt.cd } });
    rec(name, 1, { [t.mat]: tt.mat, stick: tt.stick });
  }
  for (const [mn, m] of Object.entries(ARMOR_MATS)) ARMOR_SLOTS.forEach(([slot, cost], i) => {
    const name = mn + '_' + slot;
    item(name, { stack: 1, armor: { slot: i, pts: m.pts[i], dur: m.dur } });
    rec(name, 1, { [m.mat]: cost });
  });

  // v4 recipes
  for (const w of NEW_WOODS) rec(w + '_planks', 4, { [w + '_log']: 1 }, false);
  rec('bamboo_planks', 1, { bamboo: 2 }, false);
  for (const w of ALL_WOODS) {
    const pl = w + '_planks';
    rec(w + '_stairs', 4, { [pl]: 6 });
    rec(w + '_slab', 6, { [pl]: 3 });
    rec(w + '_fence', 3, { [pl]: 4, stick: 2 });
    rec(w + '_fence_gate', 1, { [pl]: 2, stick: 4 });
    if (w !== 'oak') rec(w + '_door', 3, { [pl]: 6 });
    rec(w + '_trapdoor', 2, { [pl]: 6 });
  }
  rec('ladder', 3, { stick: 7 });
  for (const [m, it] of [['diamond', 'diamond'], ['emerald', 'emerald'], ['lapis', 'lapis_lazuli'], ['redstone', 'redstone_dust'], ['quartz', 'quartz']]) {
    rec(m + '_block', 1, { [it]: 9 }); rec(it, 9, { [m + '_block']: 1 }, false);
  }
  rec('iron_nugget', 9, { iron_ingot: 1 }, false); rec('gold_nugget', 9, { gold_ingot: 1 }, false);
  rec('leather', 1, { hide: 1 }, false);
  rec('sugar', 1, { reeds: 1 }, false);
  rec('glass_bottle', 3, { glass: 3 });
  rec('snowball', 4, { snow_block: 1 }, false);
  rec('fire_charge', 3, { '#coal': 1, ember_rod: 1, gunpowder: 1 });
  rec('compass', 1, { iron_ingot: 4, redstone_dust: 1 });
  rec('clock', 1, { gold_ingot: 4, redstone_dust: 1 });
  rec('spyglass', 1, { copper_ingot: 2, amethyst_shard: 1 });
  rec('lead', 2, { string: 4, slimeball: 1 });
  rec('name_tag', 1, { paper: 1, string: 1 });
  rec('saddle', 1, { leather: 5, iron_ingot: 1 });
  rec('crossbow', 1, { stick: 3, string: 2, iron_ingot: 1, '#planks': 1 });
  rec('trident', 1, { iron_ingot: 3, diamond: 1, stick: 2 });
  rec('redstone_lamp', 1, { redstone_dust: 4, glass: 1, torch: 1 });
  rec('candle', 2, { string: 1, goo: 1 });
  rec('rail', 16, { iron_ingot: 6, stick: 1 });
  rec('flower_pot', 1, { brick: 3 });
  rec('golden_carrot', 1, { carrot: 1, gold_nugget: 8 });
  rec('beetroot_soup', 1, { beetroot: 6, bowl: 1 });
  rec('cookie', 8, { wheat: 2, sugar: 1 });
  rec('cake', 1, { wheat: 3, sugar: 2, egg: 1 });
  for (const [dye, src] of [['white', 'bone_meal'], ['white', 'white_tulip'], ['orange', 'orange_tulip'], ['magenta', 'allium'], ['magenta', 'lilac'],
    ['light_blue', 'blue_orchid'], ['yellow', 'dandelion'], ['yellow', 'sunflower'], ['pink', 'pink_tulip'], ['pink', 'peony'], ['light_gray', 'azure_bluet'],
    ['light_gray', 'oxeye_daisy'], ['blue', 'lapis_lazuli'], ['brown', 'brown_mushroom'], ['red', 'poppy'], ['red', 'red_tulip'], ['red', 'rose_bush'],
    ['red', 'beetroot'], ['black', 'ink_sac'], ['black', 'coal']]) rec(dye + '_dye', 1, { [src]: 1 }, false);
  rec('lime_dye', 2, { green_dye: 1, white_dye: 1 }, false);
  rec('gray_dye', 2, { black_dye: 1, white_dye: 1 }, false);
  rec('cyan_dye', 2, { blue_dye: 1, green_dye: 1 }, false);
  rec('purple_dye', 2, { blue_dye: 1, red_dye: 1 }, false);

  // ---------- smelting and fuel ----------
  const SMELT = { raw_copper: 'copper_ingot', raw_iron: 'iron_ingot', raw_gold: 'gold_ingot', sand: 'glass', cobblestone: 'stone', clay_ball: 'brick',
    raw_venison: 'cooked_venison', raw_poultry: 'cooked_poultry', raw_boar: 'cooked_boar', raw_fish: 'cooked_fish', '#log': 'charcoal',
    clay: 'terracotta', ashsand: 'glass' };
  Object.assign(SMELT, { raw_beef: 'steak', raw_pork: 'cooked_pork', raw_mutton: 'cooked_mutton', raw_rabbit: 'cooked_rabbit' });
  rec('leather', 1, { rabbit_hide: 4 }, false);
  rec('rabbit_stew', 1, { cooked_rabbit: 1, carrot: 1, baked_potato: 1, bowl: 1 }, false);
  Object.assign(SMELT, { potato: 'baked_potato', raw_cod: 'cooked_cod', raw_salmon: 'cooked_salmon', cactus: 'green_dye', diamond_ore: 'diamond',
    emerald_ore: 'emerald', quartz_ore: 'quartz' });
  const FUEL = { coal: 8, charcoal: 8, coal_block: 80, lava_bucket: 100, ember_rod: 12, '#log': 1.5, '#planks': 1.5, stick: 0.5, wooden_pickaxe: 1, wooden_axe: 1, wooden_shovel: 1, wooden_sword: 1, wooden_hoe: 1 };

  // ---------- groups ----------
  const GROUPS = { coal: ['coal', 'charcoal'] };
  for (const b of BLOCKS) if (b.group) (GROUPS[b.group] = GROUPS[b.group] || []).push(b.name);
  const inGroup = (name, key) => key[0] === '#' ? (GROUPS[key.slice(1)] || []).includes(name) : name === key;
  function smeltResult(name) {
    if (SMELT[name]) return SMELT[name];
    for (const k in SMELT) if (k[0] === '#' && inGroup(name, k)) return SMELT[k];
    return null;
  }
  function fuelValue(name) {
    if (FUEL[name]) return FUEL[name];
    for (const k in FUEL) if (k[0] === '#' && inGroup(name, k)) return FUEL[k];
    return 0;
  }

  // ---------- mobs ----------
  // drops: [item, min, max, chance]
  const MOBS = {
    bramblebuck: { kind: 'passive', hp: 10, w: 0.9, h: 1.5, speed: 3.4, drops: [['raw_venison', 1, 3], ['hide', 0, 2]], biomes: ['plains', 'forest', 'mountains'], group: [2, 4], desc: 'a deer with thorny bramble antlers' },
    puffhen: { kind: 'passive', hp: 4, w: 0.5, h: 0.7, speed: 2.6, drops: [['feather', 0, 2], ['raw_poultry', 1, 1]], biomes: ['plains', 'forest', 'swamp', 'beach'], group: [2, 5], lays: 'egg', desc: 'a round fluffy bird' },
    mossback: { kind: 'passive', hp: 10, w: 0.9, h: 0.9, speed: 2.8, drops: [['raw_boar', 1, 3]], biomes: ['forest', 'swamp', 'plains'], group: [2, 4], desc: 'a boar with a mossy back' },
    fluffalo: { kind: 'passive', hp: 14, w: 1.3, h: 1.5, speed: 2.4, drops: [['wool', 1, 3], ['hide', 0, 2]], biomes: ['plains', 'snowy', 'mountains'], group: [2, 4], sheds: 'wool', desc: 'a big woolly bison' },
    glimmerfin: { kind: 'water', hp: 3, w: 0.5, h: 0.4, speed: 3, drops: [['raw_fish', 1, 1], ['glow_dust', 0, 1, 0.3]], biomes: ['ocean', 'river', 'swamp'], group: [3, 6], desc: 'a glowing fish' },
    ashfox: { kind: 'neutral', hp: 10, w: 0.6, h: 0.7, speed: 5, dmg: 3, drops: [['hide', 0, 1]], biomes: ['snowy', 'forest', 'mountains'], group: [1, 2], desc: 'a grey fox that bites back' },
    gloomling: { kind: 'hostile', hp: 20, w: 0.6, h: 1.9, speed: 3.4, dmg: 3, burns: true, drops: [['bone', 0, 2], ['raw_iron', 0, 1, 0.06]], desc: 'a shadowy night walker that burns in sunlight' },
    thornspitter: { kind: 'hostile', hp: 16, w: 0.7, h: 1.6, speed: 2.6, dmg: 2, burns: true, ranged: { range: 14, cd: 2.4, dmg: 3 }, drops: [['fiber', 0, 2], ['arrow', 0, 2]], desc: 'a walking plant that spits thorns' },
    burrower: { kind: 'hostile', hp: 12, w: 0.8, h: 0.7, speed: 4.6, dmg: 2, drops: [['flint', 0, 2], ['hide', 0, 1]], desc: 'a fast clawed mole' },
    blastcap: { kind: 'hostile', hp: 16, w: 0.6, h: 1.5, speed: 3, explode: { fuse: 1.5, power: 3 }, drops: [['spore_dust', 0, 2]], desc: 'a walking mushroom that explodes' },
    gelatoad: { kind: 'hostile', hp: 16, w: 1.4, h: 1.2, speed: 2.8, dmg: 4, splits: true, drops: [['goo', 0, 2]], biomes: ['swamp'], desc: 'a jelly toad that splits when hit hard' },
    cragjaw: { kind: 'hostile', hp: 40, w: 1.3, h: 2.4, speed: 2.2, dmg: 7, deep: true, drops: [['raw_iron', 1, 3], ['raw_copper', 1, 3], ['glow_dust', 0, 2]], desc: 'a huge rock beast of the deep caves' },
    // tameable companion: give it bones
    brindlehound: { kind: 'neutral', hp: 20, w: 0.7, h: 0.9, speed: 4.6, dmg: 4, tame: { item: 'bone', chance: 0.34 }, drops: [['bone', 0, 1]], biomes: ['forest', 'snowy', 'plains', 'mountains'], group: [1, 3], desc: 'a shaggy striped hound; feed it bones to tame it' },
    // the Emberdeep
    scorchling: { kind: 'hostile', hp: 20, w: 0.7, h: 1.8, speed: 2.8, dmg: 4, fireproof: true, realm: 'emberdeep', ranged: { range: 16, cd: 2.6, dmg: 4, kind: 'ember' }, drops: [['ember_rod', 0, 1, 0.6], ['glow_dust', 0, 2]], desc: 'a floating ember spirit that hurls fireballs' },
    magmite: { kind: 'hostile', hp: 12, w: 0.8, h: 0.8, speed: 4, dmg: 4, fireproof: true, realm: 'emberdeep', drops: [['ember_shard', 0, 1, 0.35], ['ember_pepper', 0, 1, 0.4]], desc: 'a hopping blob of molten rock' },
    cinderhog: { kind: 'neutral', hp: 18, w: 1, h: 1, speed: 3, dmg: 5, fireproof: true, realm: 'emberdeep', drops: [['raw_boar', 1, 3], ['hide', 0, 2]], desc: 'a heat-proof boar with a glowing back' },
    // the Skyreach
    galewing: { kind: 'hostile', hp: 16, w: 0.9, h: 0.8, speed: 5, dmg: 4, realm: 'skyreach', drops: [['feather', 1, 3], ['sky_crystal', 0, 1, 0.15]], desc: 'a darting storm bird' },
    puffcloud: { kind: 'passive', hp: 8, w: 0.8, h: 0.8, speed: 2.2, realm: 'skyreach', drops: [['cloudberry', 1, 2], ['string', 0, 2]], biomes: ['skyreach'], group: [2, 4], desc: 'a woolly floating sheep-cloud' },
    stormwarden: { kind: 'hostile', boss: true, hp: 600, w: 1.6, h: 3.4, speed: 2.6, dmg: 10, fireproof: true, realm: 'skyreach', ranged: { range: 22, cd: 1.6, dmg: 6, kind: 'ember' },
      drops: [['storm_heart', 1, 1], ['sky_crystal', 4, 8], ['skysteel_ingot', 2, 4]], desc: 'the giant storm guardian of the Skyreach. Defeat it to win the realm' },
    // ---- v6: real-world animals ----
    cow: { kind: 'passive', hp: 10, w: 0.9, h: 1.4, speed: 2.4, drops: [['raw_beef', 1, 3], ['leather', 0, 2]], biomes: ['plains', 'forest'], group: [2, 4], desc: 'a spotted cow' },
    pig: { kind: 'passive', hp: 10, w: 0.9, h: 0.9, speed: 2.6, drops: [['raw_pork', 1, 3]], biomes: ['plains', 'forest'], group: [2, 4], desc: 'a pink pig' },
    sheep: { kind: 'passive', hp: 8, w: 0.9, h: 1.3, speed: 2.4, sheds: 'wool', drops: [['wool', 1, 2], ['raw_mutton', 1, 2]], biomes: ['plains', 'mountains', 'forest'], group: [2, 4], desc: 'a woolly sheep' },
    chicken: { kind: 'passive', hp: 4, w: 0.4, h: 0.7, speed: 2.4, lays: 'egg', drops: [['raw_poultry', 1, 1], ['feather', 0, 2]], biomes: ['plains', 'forest'], group: [2, 4], desc: 'a farmyard chicken' },
    rabbit: { kind: 'passive', hp: 3, w: 0.4, h: 0.5, speed: 4.2, drops: [['raw_rabbit', 0, 1], ['rabbit_hide', 0, 1], ['rabbit_foot', 0, 1, 0.1]], biomes: ['plains', 'forest', 'desert', 'snowy'], group: [2, 3], desc: 'a quick hopping rabbit' },
    horse: { kind: 'passive', hp: 22, w: 1.3, h: 1.6, speed: 4.4, drops: [['leather', 0, 2]], biomes: ['plains'], group: [2, 5], desc: 'a wild horse' },
    donkey: { kind: 'passive', hp: 20, w: 1.2, h: 1.5, speed: 3.4, drops: [['leather', 0, 2]], biomes: ['plains'], group: [1, 3], weight: 0.5, desc: 'a long-eared donkey' },
    mule: { kind: 'passive', hp: 20, w: 1.2, h: 1.6, speed: 3.6, drops: [['leather', 0, 2]], biomes: ['plains'], group: [1, 2], weight: 0.25, desc: 'a sturdy mule' },
    goat: { kind: 'neutral', hp: 10, w: 0.8, h: 1.2, speed: 3.4, dmg: 3, drops: [['raw_mutton', 0, 1]], biomes: ['mountains', 'snowy'], group: [1, 3], desc: 'a mountain goat that rams back' },
    llama: { kind: 'neutral', hp: 20, w: 0.9, h: 1.8, speed: 3, dmg: 1, ranged: { range: 10, cd: 2, dmg: 1 }, drops: [['leather', 0, 2]], biomes: ['mountains'], group: [2, 4], desc: 'a woolly llama that spits when annoyed' },
    camel: { kind: 'passive', hp: 30, w: 1.6, h: 2.3, speed: 2.8, drops: [['leather', 0, 2]], biomes: ['desert'], group: [1, 2], weight: 0.6, desc: 'a tall two-humped camel' },
    armadillo: { kind: 'passive', hp: 12, w: 0.7, h: 0.6, speed: 2.4, sheds: 'armadillo_scute', drops: [['armadillo_scute', 0, 1]], biomes: ['desert', 'plains'], group: [1, 2], weight: 0.6, desc: 'an armadillo that curls into a ball' },
    panda: { kind: 'passive', hp: 20, w: 1.3, h: 1.25, speed: 2, drops: [['bamboo', 0, 2]], biomes: ['forest'], group: [1, 2], weight: 0.3, desc: 'a lazy bamboo-munching panda' },
    turtle: { kind: 'passive', hp: 30, w: 1.2, h: 0.4, speed: 1.4, drops: [['turtle_scute', 0, 1, 0.5]], biomes: ['beach'], group: [2, 4], desc: 'a slow sea turtle' },
    frog: { kind: 'passive', hp: 10, w: 0.5, h: 0.5, speed: 3, drops: [], biomes: ['swamp'], group: [2, 4], desc: 'a croaking swamp frog' },
    cat: { kind: 'passive', hp: 10, w: 0.6, h: 0.7, speed: 4.4, tame: { item: 'raw_fish', chance: 0.34 }, drops: [['string', 0, 2]], biomes: ['plains', 'forest'], group: [1, 1], weight: 0.4, desc: 'a stray cat; feed it raw fish to tame it' },
    ocelot: { kind: 'passive', hp: 10, w: 0.6, h: 0.7, speed: 5, drops: [], biomes: ['forest'], group: [1, 2], weight: 0.4, desc: 'a shy spotted wild cat' },
    polar_bear: { kind: 'neutral', hp: 30, w: 1.4, h: 1.4, speed: 3.6, dmg: 6, drops: [['raw_cod', 0, 2], ['raw_salmon', 0, 2]], biomes: ['snowy'], group: [1, 2], desc: 'a huge white bear; leave its cubs alone' },
    wolf: { kind: 'neutral', hp: 16, w: 0.6, h: 0.85, speed: 4.6, dmg: 4, tame: { item: 'bone', chance: 0.34 }, drops: [], biomes: ['forest', 'snowy', 'mountains'], group: [2, 4], desc: 'a grey wolf; feed it bones to tame it' },
    fox: { kind: 'passive', hp: 10, w: 0.6, h: 0.7, speed: 5, drops: [['sweet_berries', 0, 1, 0.3]], biomes: ['snowy', 'forest'], group: [1, 3], desc: 'a sly orange fox' },
    bat: { kind: 'passive', hp: 6, w: 0.5, h: 0.9, speed: 3.4, flies: true, cave: true, drops: [], biomes: [], group: [1, 1], desc: 'a cave bat' },
    bee: { kind: 'neutral', hp: 10, w: 0.6, h: 0.6, speed: 3.2, dmg: 2, flies: true, drops: [['honeycomb', 0, 1, 0.4]], biomes: ['plains', 'forest'], group: [2, 3], weight: 0.6, desc: 'a fuzzy bee that stings when bothered' },
    parrot: { kind: 'passive', hp: 6, w: 0.5, h: 0.9, speed: 3.6, flies: true, tame: { item: 'seeds', chance: 0.34 }, drops: [['feather', 1, 2]], biomes: ['forest'], group: [1, 2], weight: 0.4, desc: 'a bright parrot; feed it seeds to tame it' },
    // water life
    cod: { kind: 'water', hp: 3, w: 0.5, h: 0.3, speed: 3, drops: [['raw_cod', 1, 1]], biomes: ['ocean'], group: [3, 6], desc: 'a cod' },
    salmon: { kind: 'water', hp: 3, w: 0.7, h: 0.4, speed: 3.4, drops: [['raw_salmon', 1, 1]], biomes: ['river', 'ocean'], group: [3, 5], desc: 'a salmon' },
    tropical_fish: { kind: 'water', hp: 3, w: 0.5, h: 0.4, speed: 3, drops: [['tropical_fish', 1, 1]], biomes: ['ocean'], group: [3, 6], desc: 'a striped tropical fish' },
    pufferfish: { kind: 'water', hp: 3, w: 0.6, h: 0.6, speed: 2.2, drops: [['pufferfish', 1, 1]], biomes: ['ocean'], group: [1, 3], weight: 0.5, desc: 'a spiky pufferfish' },
    squid: { kind: 'water', hp: 10, w: 0.8, h: 0.8, speed: 2, drops: [['ink_sac', 1, 3]], biomes: ['ocean', 'river'], group: [2, 4], desc: 'an inky squid' },
    dolphin: { kind: 'water', hp: 10, w: 0.9, h: 0.6, speed: 5, drops: [['raw_cod', 0, 1]], biomes: ['ocean'], group: [2, 4], weight: 0.6, desc: 'a playful dolphin' },
    axolotl: { kind: 'water', hp: 14, w: 0.75, h: 0.4, speed: 2.4, drops: [], biomes: ['swamp', 'river'], group: [1, 3], weight: 0.4, desc: 'a pink frilly axolotl' },
    tadpole: { kind: 'water', hp: 6, w: 0.4, h: 0.3, speed: 2, drops: [], biomes: ['swamp'], group: [2, 5], desc: 'a tiny tadpole' },
    // ---- v6: monsters of the night and the caves ----
    zombie: { kind: 'hostile', hp: 20, w: 0.6, h: 1.95, speed: 3, dmg: 3, burns: true, drops: [['rotten_flesh', 0, 2], ['raw_iron', 0, 1, 0.03], ['carrot', 0, 1, 0.03], ['potato', 0, 1, 0.03]], desc: 'a shambling undead walker that burns in sunlight' },
    skeleton: { kind: 'hostile', hp: 20, w: 0.6, h: 1.95, speed: 3.2, dmg: 2, burns: true, ranged: { range: 15, cd: 2, dmg: 3, kind: 'arrow' }, drops: [['bone', 0, 2], ['arrow', 0, 2]], desc: 'a bony archer that burns in sunlight' },
    spider: { kind: 'hostile', hp: 16, w: 1.4, h: 0.9, speed: 4, dmg: 2, drops: [['string', 0, 2], ['spider_eye', 0, 1, 0.33]], desc: 'a big hairy spider' },
    cave_spider: { kind: 'hostile', hp: 12, w: 0.7, h: 0.5, speed: 4.4, dmg: 2, deep: true, drops: [['string', 0, 2], ['spider_eye', 0, 1, 0.33]], desc: 'a small venomous cave spider' },
    slime: { kind: 'hostile', hp: 16, w: 1.4, h: 1.4, speed: 2.6, dmg: 3, splits: true, drops: [['slimeball', 0, 2]], biomes: ['swamp'], desc: 'a bouncing green cube that splits when hit' },
    witch: { kind: 'hostile', hp: 26, w: 0.6, h: 1.95, speed: 2.6, dmg: 2, ranged: { range: 12, cd: 3, dmg: 4, kind: 'ember' }, drops: [['glass_bottle', 0, 2], ['sugar', 0, 2], ['redstone_dust', 0, 2], ['glow_dust', 0, 2], ['spider_eye', 0, 1, 0.3]], desc: 'a cackling witch who hurls magic' },
    villager: { kind: 'passive', hp: 20, w: 0.6, h: 1.95, speed: 2.2, villager: true, drops: [], biomes: [], group: [1, 1], desc: 'a villager who trades for emeralds (use: trade)' },
    bulwark: { kind: 'neutral', hp: 100, w: 1.4, h: 2.7, speed: 2.6, dmg: 9, guard: true, drops: [['iron_ingot', 3, 5], ['poppy', 0, 2]], biomes: [], group: [1, 1], desc: 'a huge stone-and-iron guardian that protects villages from monsters' },
    silverfish: { kind: 'hostile', hp: 8, w: 0.4, h: 0.3, speed: 4.4, dmg: 1, deep: true, drops: [], desc: 'a tiny grey bug that hides in stone' },
  };
  for (const [k, m] of Object.entries(MOBS)) { m.name = k; m.label = label(k); }

  return {
    stairFacing, stairBoxes, wallSide, blockBoxes, SIDES,
    REALMS, REALM, WORLD_X_CHUNKS, WORLD_X, realmOfChunk, realmAt, inWorld, BORDER, RDX, SPAWN_C, ckey, ckx, ckz,
    CHUNK, HEIGHT, SEA, WORLD_CHUNKS, BIOMES, BIOME, BLOCKS, B, ITEMS, TIERS, TOOL_TYPES, ARMOR_MATS, ARMOR_SLOTS, RECIPES, SMELT, FUEL, GROUPS, MOBS, TILES, FOOD,
    faceTile, inGroup, smeltResult, fuelValue, label,
  };
});
