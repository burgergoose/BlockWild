/* Seeded random numbers and Perlin noise (2D and 3D). */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.BW = root.BW || {}; root.BW.noise = m; }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash() {
    let h = 0x811c9dc5;
    for (let i = 0; i < arguments.length; i++) {
      h = Math.imul(h ^ (arguments[i] | 0), 0x01000193);
      h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    }
    return h >>> 0;
  }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  function g2(h, x, y) {
    switch (h & 7) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y; case 4: return x; case 5: return -x; case 6: return y; default: return -y; }
  }
  function g3(h, x, y, z) {
    const hh = h & 15, u = hh < 8 ? x : y, v = hh < 4 ? y : (hh === 12 || hh === 14 ? x : z);
    return ((hh & 1) ? -u : u) + ((hh & 2) ? -v : v);
  }
  // scrambles the gradient of each 256x256 block of lattice cells; the first block (0,0,0) is left exactly as it was
  function hi(a, b, c) {
    if ((a | b | c) === 0) return 0;
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return (h ^ (h >>> 16)) & 255;
  }
  class Perlin {
    constructor(seed) {
      const r = mulberry32(seed), p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
      this.p = new Uint8Array(512);
      for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
    }
    noise2(x, y) {
      const p = this.p;
      let X = Math.floor(x), Y = Math.floor(y);
      x -= X; y -= Y;
      const H = (i, j) => p[p[i & 255] + (j & 255)] ^ hi(i >> 8, j >> 8, 0);
      const u = fade(x), v = fade(y);
      return lerp(lerp(g2(H(X, Y), x, y), g2(H(X + 1, Y), x - 1, y), u), lerp(g2(H(X, Y + 1), x, y - 1), g2(H(X + 1, Y + 1), x - 1, y - 1), u), v) * 0.9;
    }
    noise3(x, y, z) {
      const p = this.p;
      let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
      x -= X; y -= Y; z -= Z;
      const H = (i, j, k) => p[p[p[i & 255] + (j & 255)] + (k & 255)] ^ hi(i >> 8, j >> 8, k >> 8);
      const u = fade(x), v = fade(y), w = fade(z);
      return lerp(
        lerp(lerp(g3(H(X, Y, Z), x, y, z), g3(H(X + 1, Y, Z), x - 1, y, z), u), lerp(g3(H(X, Y + 1, Z), x, y - 1, z), g3(H(X + 1, Y + 1, Z), x - 1, y - 1, z), u), v),
        lerp(lerp(g3(H(X, Y, Z + 1), x, y, z - 1), g3(H(X + 1, Y, Z + 1), x - 1, y, z - 1), u), lerp(g3(H(X, Y + 1, Z + 1), x, y - 1, z - 1), g3(H(X + 1, Y + 1, Z + 1), x - 1, y - 1, z - 1), u), v), w);
    }
  }
  function fbm2(n, x, y, oct) {
    let s = 0, a = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += a * n.noise2(x * f, y * f); norm += a; a *= 0.5; f *= 2; }
    return s / norm;
  }
  return { mulberry32, hash, Perlin, fbm2 };
});
