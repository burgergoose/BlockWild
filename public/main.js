// Blockwild 3D viewer: live spectator + replay player.
import * as THREE from 'three';
import { buildAtlas, makeIconFactory, TILE_PIX } from './textures.js';
import { playerModel, mobModel, setHeld } from './models.js';

const defs = window.BW.defs;
const { BLOCKS, ITEMS, MOBS, TILES, HEIGHT } = defs;
const qs = new URLSearchParams(location.search);
const KEY = qs.get('key') || '';
const $ = id => document.getElementById(id);
THREE.ColorManagement.enabled = false;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 1400);
scene.fog = new THREE.Fog(0x9cc4f0, 60, 120);
const amb = new THREE.AmbientLight(0xffffff, 0.6);
const sunL = new THREE.DirectionalLight(0xffffff, 0.6);
scene.add(amb, sunL, sunL.target);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// ---------- atlas + icons ----------
const atlas = buildAtlas(TILES);
const atlasTex = new THREE.CanvasTexture(atlas.canvas);
atlasTex.magFilter = THREE.NearestFilter;
atlasTex.minFilter = THREE.NearestMipmapLinearFilter;
atlasTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
atlasTex.flipY = true;
const icon = makeIconFactory(defs, atlas);
const iconUrlCache = {};
const iconURL = name => iconUrlCache[name] || (iconUrlCache[name] = icon(name).toDataURL());
const label = n => (ITEMS[n] && ITEMS[n].label) || (MOBS[n] && MOBS[n].label) || String(n).replace(/_/g, ' ');

// ---------- terrain shader ----------
const U = {
  uAtlas: { value: atlasTex }, uTime: { value: 0 }, uSkyLight: { value: new THREE.Color(1, 1, 1) }, uFogColor: { value: new THREE.Color() },
  uFogNear: { value: 60 }, uFogFar: { value: 120 }, uCam: { value: new THREE.Vector3() }, uDay: { value: 1 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uRain: { value: 0 },
  uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: 0 }, uUnder: { value: 0 },
};
const TERRAIN_VS = `
attribute vec3 tint; attribute vec4 lit;
uniform float uTime; uniform vec3 uSkyLight; uniform vec3 uCam; uniform float uFogNear, uFogFar;
varying vec2 vUv; varying vec3 vCol; varying float vFog; varying float vFlag; varying vec3 vWorld; varying float vAo;
float curve(float x) { return x / (3.0 - 2.0 * x); }
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 off = p - position;
  float f = floor(lit.w + 0.5);
  if (f == 1.0) { p.x += sin(uTime * 1.6 + p.z * 0.7 + p.y * 0.4) * 0.025; p.z += cos(uTime * 1.3 + p.x * 0.6) * 0.025; }
  else if (f == 2.0) { p.x += sin(uTime * 2.0 + p.z * 0.8 + p.x * 0.3) * 0.07; p.z += cos(uTime * 1.7 + p.x * 0.8) * 0.05; }
  else if (f == 3.0 && fract(p.y) > 0.8) { p.y += sin(uTime * 1.5 + p.x * 0.9 + p.z * 0.5) * 0.03 + cos(uTime * 1.1 + p.z * 1.3) * 0.02 - 0.03; }
  vec3 skyC = uSkyLight * curve(lit.x);
  vec3 blkC = vec3(1.0, 0.8, 0.56) * curve(lit.y) * 1.08;
  vec3 L = max(skyC, blkC) + skyC * blkC * 0.25 + vec3(0.09, 0.095, 0.11);
  if (f == 4.0 || f == 5.0) L = vec3(1.0);
  vAo = lit.z;
  vCol = tint * L;
  vUv = uv; vFlag = f; vWorld = p;
  vec4 mv = modelViewMatrix * vec4(p - off, 1.0);
  vFog = smoothstep(uFogNear, uFogFar, length(mv.xyz));
  gl_Position = projectionMatrix * mv;
}`;
const TERRAIN_FS = `
uniform sampler2D uAtlas; uniform vec3 uFogColor; uniform float uTrans; uniform vec3 uCam; uniform float uTime; uniform float uDay; uniform vec3 uSun; uniform vec3 uSkyLight;
uniform vec3 uZenith, uHorizon; uniform float uGlow, uUnder, uRain;
vec3 skyAt(vec3 d) {
  if (uUnder > 0.5) return uFogColor;
  vec3 c = mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.5));
  c += vec3(1.0, 0.55, 0.25) * pow(max(dot(d, normalize(uSun)), 0.0), 6.0) * uGlow * (1.0 - uRain * 0.8);
  return c;
}
varying vec2 vUv; varying vec3 vCol; varying float vFog; varying float vFlag; varying vec3 vWorld; varying float vAo;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  if (uTrans < 0.5 && t.a < 0.45) discard;
  vec3 c = t.rgb * vCol * (vFlag == 4.0 || vFlag == 5.0 ? 1.0 : vAo);
  float a = 1.0;
  if (vFlag == 3.0) {
    vec3 V = normalize(vWorld - uCam);
    float fres = pow(1.0 - abs(V.y), 4.0);
    float w = sin(vWorld.x * 2.3 + uTime * 1.7) * sin(vWorld.z * 1.9 - uTime * 1.3) + sin((vWorld.x + vWorld.z) * 0.9 + uTime);
    c *= 0.92 + w * 0.05;
    vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
    float spec = pow(max(dot(R, normalize(uSun)), 0.0), 60.0) * uDay;
    c = mix(c, skyAt(reflect(V, vec3(0.0, 1.0, 0.0))) * 0.9, fres * 0.55) + spec * 0.6 * vec3(1.0, 0.95, 0.8);
    a = mix(0.7, 0.95, fres);
  } else if (uTrans > 0.5) a = t.a;
  vec3 fc = skyAt(normalize(vWorld - uCam));
  c = mix(c, fc, vFog);
  gl_FragColor = vec4(c, a);
}`;
const terrainMat = new THREE.ShaderMaterial({ uniforms: Object.assign({ uTrans: { value: 0 } }, U), vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS });
const transMat = new THREE.ShaderMaterial({ uniforms: Object.assign({ uTrans: { value: 1 } }, U), vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS, transparent: true, depthWrite: false });

// ---------- sky + clouds ----------
const skyU = { uSun: U.uSun, uZenith: U.uZenith, uHorizon: U.uHorizon, uNight: { value: 0 }, uTime: U.uTime, uRain: U.uRain, uGlow: U.uGlow };
const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, depthTest: false,
  vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
uniform vec3 uSun, uZenith, uHorizon; uniform float uNight, uTime, uRain, uGlow; varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  if (h < 0.0) col = mix(uHorizon, uHorizon * 0.6, clamp(-h * 4.0, 0.0, 1.0));
  vec3 s = normalize(uSun);
  float sd = max(dot(d, s), 0.0);
  col += vec3(1.0, 0.55, 0.25) * pow(sd, 6.0) * uGlow * (1.0 - uRain * 0.8);
  col += vec3(1.0, 0.9, 0.7) * pow(sd, 120.0) * 0.5 * (1.0 - uNight) * (1.0 - uRain);
  vec3 sx = normalize(cross(s, vec3(0.0, 0.0, 1.0))), sy = cross(sx, s);
  if (dot(d, s) > 0.0) { vec2 q = vec2(dot(d, sx), dot(d, sy)); float m = max(abs(q.x), abs(q.y)); if (m < 0.055) col = mix(col, vec3(1.0, 0.97, 0.82) * 1.4, 1.0 - uRain * 0.85); }
  if (dot(d, -s) > 0.0) { vec2 q = vec2(dot(d, sx), dot(d, sy)); float m = max(abs(q.x), abs(q.y)); if (m < 0.04) { float cr = hash(floor(vec3(q * 120.0, 1.0))); col = mix(col, vec3(0.82, 0.85, 0.92) * (0.85 + cr * 0.2), uNight * (1.0 - uRain * 0.8)); } }
  if (h > 0.0) { vec3 g = floor(d * 220.0); float st = hash(g); if (st > 0.9965) col += vec3(0.9, 0.92, 1.0) * (0.5 + 0.5 * sin(uTime * 2.0 + st * 400.0)) * uNight * (1.0 - uRain) * smoothstep(0.0, 0.3, h); }
  gl_FragColor = vec4(col, 1.0);
}` }));
sky.renderOrder = -1000; sky.frustumCulled = false;
scene.add(sky);
const cloudU = { uTime: U.uTime, uCol: { value: new THREE.Color(1, 1, 1) }, uCam: U.uCam, uRain: U.uRain };
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
  uniforms: cloudU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
uniform float uTime, uRain; uniform vec3 uCol, uCam; varying vec3 vW;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = vW.xz + vec2(uTime * 1.2, uTime * 0.4);
  vec2 cell = floor(p / 10.0);
  float n = vn(cell * 0.11) * 0.6 + vn(cell * 0.27 + 7.0) * 0.3 + vn(cell * 0.6 + 3.0) * 0.1;
  float th = mix(0.56, 0.4, uRain);
  float a = step(th, n);
  float edge = 1.0 - smoothstep(500.0, 1100.0, length(vW.xz - uCam.xz));
  vec2 fp = fract(p / 10.0);
  float shade = 0.92 + 0.08 * step(0.5, n + (fp.y - 0.5) * 0.04);
  gl_FragColor = vec4(uCol * shade, a * edge * mix(0.82, 0.95, uRain));
}` }));
clouds.position.y = 150;
clouds.renderOrder = 5;
scene.add(clouds);

// ---------- world worker + chunks ----------
const worker = new Worker('/worker.js');
const chunkMeshes = new Map(); // key -> { solid, trans, emit, blocks, heights }
let renderDist = Number(qs.get('dist')) || 8;
let lastCC = null, pendingLeft = 0, workerReady = false;
function chunkGeom(d) {
  if (!d.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
  g.setAttribute('tint', new THREE.BufferAttribute(d.tint, 3));
  g.setAttribute('lit', new THREE.BufferAttribute(d.lit, 4));
  g.setIndex(new THREE.BufferAttribute(d.idx, 1));
  g.computeBoundingSphere();
  return g;
}
function disposeChunk(c) { for (const m of [c.solid, c.trans]) if (m) { scene.remove(m); m.geometry.dispose(); } }
worker.onmessage = e => {
  const m = e.data;
  if (m.type !== 'mesh') return;
  pendingLeft = m.left;
  const old = chunkMeshes.get(m.k);
  if (old) disposeChunk(old);
  const c = { emit: m.emit, blocks: m.blocks, heights: m.heights, cx: m.cx, cz: m.cz };
  const gs = chunkGeom(m.solid), gt = chunkGeom(m.trans);
  // chunk meshes hold chunk-local positions; the mesh sits at the chunk corner, so far-out chunks stay exact
  if (gs) { c.solid = new THREE.Mesh(gs, terrainMat); c.solid.position.set(m.cx * 16, 0, m.cz * 16); c.solid.updateMatrix(); c.solid.matrixAutoUpdate = false; scene.add(c.solid); }
  if (gt) { c.trans = new THREE.Mesh(gt, transMat); c.trans.position.set(m.cx * 16, 0, m.cz * 16); c.trans.updateMatrix(); c.trans.matrixAutoUpdate = false; c.trans.renderOrder = 2; scene.add(c.trans); }
  chunkMeshes.set(m.k, c);
  emittersDirty = true;
};
function updateChunks(force) {
  if (!workerReady) return;
  const cx = Math.floor(camera.position.x / 16), cz = Math.floor(camera.position.z / 16);
  const ck = cx + ',' + cz;
  if (!force && ck === lastCC) return;
  lastCC = ck;
  const list = [];
  for (let dx = -renderDist; dx <= renderDist; dx++) for (let dz = -renderDist; dz <= renderDist; dz++) {
    const x = cx + dx, z = cz + dz;
    if (!defs.realmOfChunk(x, z) || dx * dx + dz * dz > renderDist * renderDist + 1) continue;
    const k = defs.ckey(x, z);
    if (!chunkMeshes.has(k)) list.push([dx * dx + dz * dz, k]);
  }
  list.sort((a, b) => a[0] - b[0]);
  const drop = [];
  const R2 = (renderDist + 2) * (renderDist + 2);
  for (const [k, c] of chunkMeshes) if ((c.cx - cx) ** 2 + (c.cz - cz) ** 2 > R2) { disposeChunk(c); chunkMeshes.delete(k); drop.push(k); }
  worker.postMessage({ type: 'want', list: list.map(a => a[1]), drop });
}
function blockAt(x, y, z) {
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  if (y < 0 || y >= HEIGHT) return 0;
  const c = chunkMeshes.get(defs.ckey(x >> 4, z >> 4));
  return c ? c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] : 0;
}
const opaqueAt = (x, y, z) => { const id = blockAt(x, y, z); return id && BLOCKS[id].opaque; };
const solidAt = (x, y, z) => { const id = blockAt(x, y, z); return id && BLOCKS[id].solid; };
function skyOpen(x, y, z) { for (let yy = Math.floor(y) + 1; yy < HEIGHT; yy++) if (opaqueAt(x, yy, z)) return false; return true; }
let nearEmit = [], emittersDirty = true;
function refreshEmitters() {
  emittersDirty = false;
  nearEmit = [];
  const p = camera.position;
  for (const c of chunkMeshes.values()) {
    const e = c.emit;
    for (let i = 0; i < e.length; i += 4) if (Math.abs(e[i] - p.x) < 48 && Math.abs(e[i + 2] - p.z) < 48) nearEmit.push([e[i], e[i + 1], e[i + 2], e[i + 3]]);
  }
}

// ---------- particles ----------
class Particles {
  constructor(n, additive) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.g = g;
    this.pts = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: innerHeight } },
      vertexShader: `attribute vec4 color; attribute float size; uniform float uScale; varying vec4 vC; void main() { vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(48.0, size * uScale / max(0.6, -mv.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main() { if (vC.a <= 0.0) discard; gl_FragColor = vC; }`,
    }));
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 3;
    scene.add(this.pts);
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.size[i] = size; this.life[i] = life; this.max[i] = life; this.grav[i] = grav;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.col[i * 4 + 3] !== 0) this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const nx = this.pos[i * 3] + this.vel[i * 3] * dt, ny = this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt, nz = this.pos[i * 3 + 2] + this.vel[i * 3 + 2] * dt;
      if (this.grav[i] > 0 && solidAt(nx, ny, nz)) { this.vel[i * 3] *= 0.5; this.vel[i * 3 + 1] = 0; this.vel[i * 3 + 2] *= 0.5; }
      else { this.pos[i * 3] = nx; this.pos[i * 3 + 1] = ny; this.pos[i * 3 + 2] = nz; }
      if (this.life[i] < this.max[i] * 0.3) this.col[i * 4 + 3] *= 0.9;
      if (this.life[i] <= 0) this.col[i * 4 + 3] = 0;
    }
    this.g.attributes.position.needsUpdate = this.g.attributes.color.needsUpdate = this.g.attributes.size.needsUpdate = true;
    this.pts.material.uniforms.uScale.value = renderer.getPixelRatio() * innerHeight / 2 / Math.tan(camera.fov * Math.PI / 360) / 40;
  }
}
const parts = new Particles(5000, false);
const glows = new Particles(2500, true);
const R = Math.random;
function burst(x, y, z, col, n, spd = 3, size = 3, life = 0.8, grav = 14) {
  const L = Math.min(1, lightAt(x, y - 1, z) * dayFactor + 0.08);
  col = [col[0] * L, col[1] * L, col[2] * L];
  for (let i = 0; i < n; i++) { const k = 0.75 + R() * 0.4; parts.spawn(x + (R() - 0.5) * 0.7, y + (R() - 0.5) * 0.7, z + (R() - 0.5) * 0.7, (R() - 0.5) * spd, R() * spd * 0.9, (R() - 0.5) * spd, col[0] * k, col[1] * k, col[2] * k, 1, size * (0.6 + R() * 0.6), life * (0.6 + R() * 0.8), grav); }
}
const palCache = {};
function tilePal(id) {
  if (palCache[id]) return palCache[id];
  const b = BLOCKS[id], out = [];
  if (b) for (const f of [2, 4, 0]) {
    const pix = TILE_PIX[defs.faceTile(b, f)]; if (!pix) continue;
    const tint = b.tint === 'grass' || b.tint === 'foliage' ? [0.55, 0.8, 0.4] : [1, 1, 1];
    for (let i = 0; i < pix.length; i += 4 * 3) if (pix[i + 3] > 100) out.push([pix[i] / 255 * tint[0], pix[i + 1] / 255 * tint[1], pix[i + 2] / 255 * tint[2]]);
  }
  if (!out.length) out.push(tileColor(id));
  return (palCache[id] = out);
}
function crumbs(x, y, z, id, n, spd = 3, size = 3.2, life = 0.9) {
  const pal = tilePal(id), L = Math.min(1, lightAt(x, y - 1, z) * dayFactor + 0.08);
  for (let i = 0; i < n; i++) { const c = pal[(R() * pal.length) | 0]; parts.spawn(x + (R() - 0.5) * 0.8, y + (R() - 0.5) * 0.8, z + (R() - 0.5) * 0.8, (R() - 0.5) * spd, R() * spd * 0.8 + 0.6, (R() - 0.5) * spd, c[0] * L, c[1] * L, c[2] * L, 1, size * (0.55 + R() * 0.7), life * (0.6 + R() * 0.8), 16); }
}
function tileColor(id) { const b = BLOCKS[id]; if (!b) return [0.5, 0.5, 0.5]; const c = atlas.avg[defs.faceTile(b, 4)] || [0.5, 0.5, 0.5]; return b.tint === 'grass' || b.tint === 'foliage' ? [c[0] * 0.55, c[1] * 0.8, c[2] * 0.4] : c; }

// rain
const RAIN_N = 1800;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 6);
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0x9ab0d0, transparent: true, opacity: 0.45 }));
rain.frustumCulled = false; rain.visible = false;
scene.add(rain);
const rainDrops = Array.from({ length: RAIN_N }, () => [R() * 60 - 30, R() * 40, R() * 60 - 30, 18 + R() * 8]);

// crack overlays
const crackTex = [];
for (let s = 0; s < 10; s++) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const x = c.getContext('2d');
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  x.fillStyle = 'rgba(0,0,0,0.75)';
  for (let k = 0; k < 4 + s * 5; k++) {
    let px = 8, py = 8; const a = rnd() * 6.28;
    for (let j = 0; j < 2 + s * 0.8; j++) { px += Math.round(Math.cos(a + (rnd() - 0.5) * 1.5)); py += Math.round(Math.sin(a + (rnd() - 0.5) * 1.5)); x.fillRect((px + 16) % 16, (py + 16) % 16, 1, 1); }
  }
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  crackTex.push(t);
}
const cracks = new Map();
const crackGeo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
function setCrack(x, y, z, p) {
  const k = x + ',' + y + ',' + z;
  let c = cracks.get(k);
  if (!c) { c = { m: new THREE.Mesh(crackGeo, new THREE.MeshBasicMaterial({ map: crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })) }; c.m.position.set(x + 0.5, y + 0.5, z + 0.5); scene.add(c.m); cracks.set(k, c); }
  c.m.material.map = crackTex[Math.max(0, Math.min(9, p))]; c.until = performance.now() + 700;
}
function clearCrack(x, y, z) { const k = x + ',' + y + ',' + z, c = cracks.get(k); if (c) { scene.remove(c.m); c.m.material.dispose(); cracks.delete(k); } }

// explosion flashes
const flashTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.35, 'rgba(255,190,90,0.8)'); g.addColorStop(1, 'rgba(255,120,40,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const flashes = [];
let shake = 0;
function explosion(x, y, z, p) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.position.set(x, y, z); s.scale.setScalar(1); scene.add(s); flashes.push({ s, t: 0, p });
  for (let i = 0; i < 90; i++) { const g = 0.25 + R() * 0.35; parts.spawn(x, y, z, (R() - 0.5) * 10, R() * 8, (R() - 0.5) * 10, g, g, g, 0.9, 6 + R() * 8, 1 + R() * 1.4, -1.5); }
  for (let i = 0; i < 50; i++) glows.spawn(x, y, z, (R() - 0.5) * 14, R() * 10, (R() - 0.5) * 14, 1, 0.6 + R() * 0.3, 0.2, 1, 2 + R() * 3, 0.4 + R() * 0.5, 12);
  const d = camera.position.distanceTo(new THREE.Vector3(x, y, z));
  shake = Math.max(shake, Math.max(0, 1 - d / 40) * p * 0.15);
  sfx.boom(d);
}

// ---------- items as meshes ----------
const itemMats = {}, blockGeos = {};
const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
function blockGeo(id, size) {
  const k = id + ':' + size;
  if (blockGeos[k]) return blockGeos[k];
  const b = BLOCKS[id];
  const g = new THREE.BoxGeometry(size, size * (b.height || 1), size);
  const uv = g.attributes.uv, col = new Float32Array(uv.count * 3);
  const shade = [0.7, 0.7, 1, 0.5, 0.85, 0.85];
  for (let f = 0; f < 6; f++) {
    const r = atlas.rects[defs.faceTile(b, f)] || [0, 0, 0.01, 0.01];
    const tinted = b.tint === 'foliage' || (b.tint === 'grass' && f === 2) || b.tint === 'water';
    const tc = tinted ? (b.tint === 'water' ? [0.3, 0.5, 0.9] : [0.5, 0.78, 0.32]) : b.tint === 'birch' ? [0.55, 0.72, 0.38] : b.tint === 'pine' ? [0.34, 0.5, 0.36] : [1, 1, 1];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, r[0] + (r[2] - r[0]) * uv.getX(i), r[1] + (r[3] - r[1]) * uv.getY(i) * (f < 2 || f > 3 ? (b.height || 1) : 1));
      col[i * 3] = tc[0] * shade[f]; col[i * 3 + 1] = tc[1] * shade[f]; col[i * 3 + 2] = tc[2] * shade[f];
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return (blockGeos[k] = g);
}
const blockItemMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.4 });
const extruded = {};
const spriteMat = new THREE.MeshLambertMaterial({ vertexColors: true });
function extrudeIcon(name) {
  if (extruded[name]) return extruded[name];
  const cv = icon(name), N = cv.width, d = cv.getContext('2d').getImageData(0, 0, N, N).data;
  const st = N >= 32 ? 2 : 1, G = N / st, px = 1 / G, th = px * 1.2;
  const P = [], Nn = [], C = [];
  const at = (x, y) => x >= 0 && y >= 0 && x < G && y < G && d[((y * st) * N + x * st) * 4 + 3] > 120;
  const quad = (a, b, c, e, n, col) => { for (const v of [a, b, c, a, c, e]) { P.push(...v); Nn.push(...n); C.push(...col); } };
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    if (!at(x, y)) continue;
    const i = ((y * st) * N + x * st) * 4, col = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255], sd = col.map(c => c * 0.7);
    const x0 = x * px - 0.5, x1 = x0 + px, y1 = 0.5 - y * px, y0 = y1 - px, z0 = -th / 2, z1 = th / 2;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], col);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], col);
    if (!at(x - 1, y)) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], sd);
    if (!at(x + 1, y)) quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], sd);
    if (!at(x, y - 1)) quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], sd);
    if (!at(x, y + 1)) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], sd);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  return (extruded[name] = g);
}
function makeItemMesh(name, held) {
  const it = ITEMS[name];
  if (!it) return null;
  const b = it.block != null ? BLOCKS[it.block] : null;
  let m;
  if (b && b.render !== 'cross' && b.render !== 'torch' && !b.noItem) {
    m = new THREE.Mesh(blockGeo(it.block, held ? 0.32 : 0.3), blockItemMat);
    if (held) { m.position.set(0, -0.02, 0.18); m.rotation.y = 0.6; }
  } else {
    if (!itemMats[name]) { const t = new THREE.CanvasTexture(icon(name)); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; itemMats[name] = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }); }
    if (held) m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), itemMats[name]);
    else { m = new THREE.Mesh(extrudeIcon(name), spriteMat); m.scale.setScalar(0.5); }
    if (held) { m.rotation.set(0, -Math.PI / 2, Math.PI * 0.25 + Math.PI); m.position.set(0, 0.1, 0.25); }
  }
  return m;
}

// ---------- sound (synthesised; off until the viewer clicks the speaker) ----------
const sfx = (() => {
  let ctx = null, on = false;
  const noiseBuf = () => { const b = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
  let nb = null;
  function vol(d) { return on ? Math.max(0, 1 - d / 36) : 0; }
  function noise(v, dur, freq, q = 1, type = 'bandpass') {
    if (!v) return;
    const s = ctx.createBufferSource(); s.buffer = nb;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(v * 0.5, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(ctx.destination); s.start(); s.stop(ctx.currentTime + dur);
  }
  function tone(v, f0, f1, dur, type = 'sine') {
    if (!v) return;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(v * 0.25, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
  }
  // ---- optional sound pack: files named like block.grass.break_2.ogg, picked by name, else the synth plays ----
  const pack = { idx: null, bufs: new Map() };
  fetch('/api/soundpack').then(r => r.json()).then(r => {
    if (!r.files || !r.files.length) return;
    pack.idx = new Map();
    for (const f of r.files) { const k = f.split('/').pop().replace(/\.(ogg|mp3|wav)$/i, '').replace(/_?\d+$/, ''); if (!pack.idx.has(k)) pack.idx.set(k, []); pack.idx.get(k).push(f); }
    console.log('sound pack:', r.files.length, 'files,', pack.idx.size, 'sounds');
  }).catch(() => {});
  function load(f) {
    let b = pack.bufs.get(f);
    if (!b) { b = fetch('/soundpack/' + f.split('/').map(encodeURIComponent).join('/')).then(r => r.arrayBuffer()).then(a => ctx.decodeAudioData(a)).catch(() => null); pack.bufs.set(f, b); }
    return b;
  }
  // play the first name in keys that the pack has; returns false when none matches (so the synth plays instead)
  function sample(keys, v, o = {}) {
    if (!pack.idx || !ctx) return false;
    let list = null;
    for (const k of keys) if (k && (list = pack.idx.get(k))) break;
    if (!list) return false;
    if (!v) return true;
    const f = list[(Math.random() * list.length) | 0], t0 = ctx.currentTime;
    load(f).then(buf => {
      if (!buf || ctx.currentTime - t0 > (o.late || 0.3)) return;
      const s = ctx.createBufferSource(); s.buffer = buf;
      s.playbackRate.value = o.rate || 1 + (Math.random() - 0.5) * (o.vary == null ? 0.16 : o.vary);
      const g = ctx.createGain(); g.gain.value = v * (o.gain || 0.7);
      s.connect(g); g.connect(ctx.destination); s.start();
      if (o.onend) s.onended = o.onend;
    });
    return true;
  }
  const mat = id => {
    const b = BLOCKS[id]; if (!b) return 'stone';
    const n = b.name;
    if (/glass|ice/.test(n)) return 'glass';
    if (/wool|carpet|bed/.test(n)) return 'wool';
    if (/snow/.test(n)) return 'snow';
    if (/gravel/.test(n)) return 'gravel';
    if (/sand(?!stone)/.test(n)) return 'sand';
    if (/ladder/.test(n)) return 'ladder';
    if (/lantern/.test(n)) return 'lantern';
    if (/grass|dirt|farmland|leaves|moss|clay|mud/.test(n) || b.render === 'cross') return 'grass';
    if (/log|planks|wood|door|chest|workbench|fence|stairs_oak|bookshelf/.test(n) || b.tool === 'axe') return 'wood';
    if (b.tool === 'shovel') return 'gravel';
    if (/copper/.test(n)) return 'copper';
    if (/iron|gold|metal|steel/.test(n)) return 'metal';
    return 'stone';
  };
  const ALT = { stone: ['deepslate', 'tuff_bricks', 'polished_tuff', 'calcite', 'basalt'], wood: ['cherry_wood', 'bamboo_wood', 'nether_wood'], metal: ['iron', 'netherite_block', 'copper'], copper: ['copper', 'iron'], grass: ['grass', 'moss', 'azalea'], gravel: ['gravel', 'rooted_dirt'], sand: ['sand', 'suspicious_sand'] };
  const blockKeys = (id, act) => { const m = mat(id), ms = [m, ...(ALT[m] || [])], out = []; for (const a of act === 'break' ? ['break'] : [act, 'break']) for (const x of ms) out.push('block.' + x + '.' + a); return out; };
  let musicAt = performance.now() + 20000, rainOn = false;
  function ambience() {
    if (!on || !pack.idx) return;
    const now = performance.now();
    if (now > musicAt) { musicAt = now + 300000 + Math.random() * 300000; const ks = [...pack.idx.keys()].filter(k => /^music\.(game|creative|overworld|menu)/.test(k)); if (ks.length) sample([ks[(Math.random() * ks.length) | 0]], 0.35, { vary: 0, late: 30, onend: () => { musicAt = Math.min(musicAt, performance.now() + 120000); } }); }
    if (S.rain && !rainOn && pack.idx.get('weather.rain')) { rainOn = true; const loop = () => { if (!on || !S.rain) { rainOn = false; return; } sample(['weather.rain'], 0.45, { vary: 0.05, late: 5, onend: loop }); }; loop(); }
  }
  setInterval(ambience, 2000);
  return {
    sample, mat,
    toggle() { if (!ctx) { ctx = new AudioContext(); nb = noiseBuf(); } on = !on; if (on) ctx.resume(); return on; },
    get on() { return on; },
    brk(d, id) { if (sample(blockKeys(id, 'break'), vol(d))) return; const b = BLOCKS[id] || {}; const f = b.tool === 'pickaxe' ? 2400 : b.tool === 'axe' ? 900 : b.tool === 'shovel' ? 600 : 1500; noise(vol(d), 0.18, f, 0.8); },
    place(d, id) { if (id != null && sample(blockKeys(id, 'place'), vol(d))) return; noise(vol(d) * 0.7, 0.1, 500, 1.2); },
    step(d, id) { if (id && sample(blockKeys(id, 'step'), vol(d) * 0.35)) return; noise(vol(d) * 0.15, 0.06, 700, 1); },
    hurt(d, type) { if (sample(['entity.' + type + '.hurt', type === 'player' ? 'entity.player.hurt' : null, 'entity.generic.hurt'], vol(d))) return; tone(vol(d), 420, 220, 0.18, 'square'); },
    pop(d) { if (sample(['entity.item.pickup'], vol(d) * 0.6)) return; tone(vol(d) * 0.5, 600, 1300, 0.08); },
    boom(d) { if (sample(['entity.generic.explode'], vol(d * 0.4) * 1.5)) return; noise(vol(d * 0.4) * 2, 1.4, 120, 0.5, 'lowpass'); },
    twang(d) { if (sample(['entity.arrow.shoot'], vol(d))) return; tone(vol(d) * 0.6, 900, 300, 0.15, 'triangle'); },
    hiss(d) { if (sample(['entity.tnt.primed', 'entity.creeper.primed'], vol(d))) return; noise(vol(d) * 0.6, 1.2, 4000, 0.4, 'highpass'); },
    chime(d) { if (sample(['entity.player.levelup'], vol(d) * 0.6)) return; tone(vol(d) * 0.6, 880, 1320, 0.35, 'triangle'); },
    death(d, type) { sample(['entity.' + type + '.death', 'entity.generic.death'], vol(d)); },
    ambient(d, type) { sample(['entity.' + type + '.ambient'], vol(d) * 0.6); },
    eat(d) { if (sample(['entity.generic.eat'], vol(d))) return; noise(vol(d) * 0.5, 0.12, 1100, 2); },
  };
})();

// ---------- timeline state ----------
const S = {
  mode: null, meta: null, frames: [], keys: [], events: [], ei: 0, duration: 0, headT: 0,
  playT: 0, playing: true, speed: 1, live: true, ents: new Map(), fi: 0, fT: 0, fClock: 0,
  rain: false, players: new Map(), summaries: new Map(), serverSpeed: 1, started: false, paused: false, liveState: new Map(), liveN: 0, over: null,
};
function resetWorld(meta) {
  S.meta = meta;
  for (const c of chunkMeshes.values()) disposeChunk(c);
  chunkMeshes.clear(); lastCC = null;
  for (const v of views.values()) removeView(v);
  views.clear();
  S.frames = []; S.keys = []; S.events = []; S.ei = 0; S.ents = new Map(); S.fi = 0; S.liveState = new Map(); S.liveN = 0; S.summaries.clear(); S.over = null;
  S.players = new Map(meta.players.map(p => [p.id, p]));
  worker.postMessage({ type: 'init', seed: meta.seed, rects: atlas.rects });
  workerReady = true;
  $('feed').innerHTML = '';
  const sp = meta.spawn;
  camera.position.set(sp.x + 8, sp.y + 10, sp.z + 8);
  camera.lookAt(sp.x, sp.y, sp.z);
  dir.target = null;
  buildCards();
}
function pushFrame(f) { if (f[3]) S.keys.push(S.frames.length); S.frames.push(f); }
function applyFrame(f) {
  if (f[3]) S.ents.clear();
  for (const e of f[1]) S.ents.set(e[0], e);
  for (const id of f[2]) S.ents.delete(id);
  S.fT = f[0];
  S.fClock = f[4] != null ? f[4] : (S.meta.clock0 + f[0] * 20);
}
function rebuildAt(t) {
  let k = 0;
  for (let i = S.keys.length - 1; i >= 0; i--) if (S.frames[S.keys[i]][0] <= t) { k = S.keys[i]; break; }
  S.ents = new Map(); S.fi = k;
  advanceTo(t);
}
function advanceTo(t) { while (S.fi < S.frames.length && S.frames[S.fi][0] <= t) applyFrame(S.frames[S.fi++]); }
function clockNow() { return S.fClock + Math.max(0, Math.min(2, S.playT - S.fT)) * 20; }
function evIndexAt(t) { let lo = 0, hi = S.events.length; while (lo < hi) { const m = (lo + hi) >> 1; if (S.events[m][0] <= t) lo = m + 1; else hi = m; } return lo; }
function seek(t) {
  t = Math.max(0, Math.min(S.mode === 'live' ? S.headT : S.duration, t));
  if (t < S.fT || t - S.fT > 20) rebuildAt(t); else advanceTo(t);
  S.playT = t;
  // silently restore state-type events, and the feed
  S.ei = evIndexAt(t);
  S.rain = false;
  let psDone = false, rainDone = false;
  const feedEv = [];
  for (let i = S.ei - 1; i >= 0 && (!psDone || !rainDone || feedEv.length < 8); i--) {
    const ev = S.events[i][1];
    if (ev.type === 'ps' && !psDone) { psDone = true; applyPs(ev); }
    else if (ev.type === 'weather' && !rainDone) { rainDone = true; S.rain = ev.rain; }
    else if (feedEv.length < 8 && feedText(ev)) feedEv.push(S.events[i]);
  }
  if (!rainDone && S.mode === 'live') S.rain = S.initRain || false;
  $('feed').innerHTML = '';
  for (const e of feedEv.reverse()) addFeed(e[1], true);
  worker.postMessage({ type: 'time', t });
  lastWorkerT = t;
}

// ---------- live stream / replay loading ----------
let lastWorkerT = -1;
function startLive() {
  S.mode = 'live';
  const es = new EventSource('/api/stream?key=' + encodeURIComponent(KEY));
  es.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'empty') { $('loading').textContent = 'No game yet. Run: node host.js new'; return; }
    if (m.type === 'init') {
      resetWorld(m.meta);
      S.initRain = m.rain;
      worker.postMessage({ type: 'changes', list: m.changes });
      for (const ev of m.events) S.events.push(ev);
      S.liveState = new Map(m.ents.map(a => [a[0], a]));
      pushFrame([m.t, m.ents, [], 1, m.clock]);
      S.headT = m.t; S.started = m.started; S.paused = m.paused; S.serverSpeed = m.speed;
      S.live = true; S.playing = true;
      seek(m.t);
      updateChunks(true);
      return;
    }
    if (m.type === 'f') {
      if (!S.meta) return;
      if (m.c.length) worker.postMessage({ type: 'changes', list: m.c });
      for (const ev of m.ev) S.events.push(ev);
      for (const a of m.ents) S.liveState.set(a[0], a);
      for (const id of m.gone) S.liveState.delete(id);
      S.liveN++;
      if (S.liveN % 50 === 0) pushFrame([m.t, Array.from(S.liveState.values()), [], 1, m.clock]);
      else pushFrame([m.t, m.ents, m.gone, 0, m.clock]);
      S.headT = m.t; S.started = m.started; S.paused = m.paused; S.serverSpeed = m.speed;
    }
  };
  es.onerror = () => { $('status').textContent = 'reconnecting…'; };
}
async function loadReplay(file) {
  $('loading').style.display = 'flex';
  $('loading').textContent = 'Loading replay…';
  const r = await fetch('/replays/' + encodeURIComponent(file));
  const rep = await r.json();
  S.mode = 'replay';
  resetWorld(rep.meta);
  worker.postMessage({ type: 'changes', list: rep.changes });
  S.events = rep.events;
  for (const f of rep.frames) { if (f[3] === undefined && S.frames.length === 0) f[3] = 1; pushFrame(f); }
  S.duration = rep.duration; S.headT = rep.duration;
  S.live = false; S.playing = true; S.speed = 1;
  seek(0);
  updateChunks(true);
}

// ---------- events ----------
const interest = new Map();
function bump(id, n) { if (S.players.has(id)) interest.set(id, (interest.get(id) || 0) + n); }
function pname(id) { const p = S.players.get(id); return p ? `<b style="color:${p.color}">${esc(p.name)}</b>` : 'someone'; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NOTABLE_CRAFT = it => ITEMS[it] && (ITEMS[it].tool || ITEMS[it].armor || ['workbench', 'furnace', 'chest', 'bedroll', 'bread', 'blast_barrel', 'bow'].includes(it));
function feedText(ev) {
  switch (ev.type) {
    case 'chat': return ev.id === 0 ? `<span class="host">HOST: ${esc(ev.text)}</span>` : `${pname(ev.id)}: ${esc(ev.text)}`;
    case 'death': return ev.msg ? `<span class="bad">☠ ${esc(ev.msg)}</span>` : ev.by ? `⚔ ${pname(ev.by)} defeated a ${label(ev.mob)}` : null;
    case 'milestone': return `<span class="gold">★ ${pname(ev.id)} got ${label(ev.item)}</span>`;
    case 'craft': return NOTABLE_CRAFT(ev.item) ? `<img src="${iconURL(ev.item)}"> ${pname(ev.id)} crafted ${label(ev.item)}` : null;
    case 'give': return `${pname(ev.id)} gave ${ev.n} ${label(ev.item)} to ${pname(ev.to)}`;
    case 'toolbreak': return `${pname(ev.id)}'s ${label(ev.item)} broke`;
    case 'morning': return `<span class="gold">☀ Day ${ev.day} begins</span>`;
    case 'weather': return ev.rain ? '🌧 It starts to rain' : '🌤 The rain stops';
    case 'sleep': return `${pname(ev.id)} went to sleep`;
    case 'over': return `<span class="gold">GAME OVER (${esc(ev.reason)})</span>`;
    case 'start': return '<span class="gold">The game begins!</span>';
    default: return null;
  }
}
function addFeed(ev, quiet) {
  const t = feedText(ev);
  if (!t) return;
  const el = document.createElement('div');
  el.className = 'fe' + (quiet ? '' : ' new');
  el.innerHTML = t;
  const f = $('feed');
  f.appendChild(el);
  while (f.children.length > 8) f.firstChild.remove();
  setTimeout(() => el.classList.add('old'), 14000);
}
function viewPos(id) { const v = views.get(id); return v ? v.pos : null; }
function distTo(x, y, z) { return camera.position.distanceTo(new THREE.Vector3(x, y, z)); }
function handleEvent(ev) {
  addFeed(ev);
  const p = ev.x != null ? null : viewPos(ev.id);
  const d = ev.x != null ? distTo(ev.x, ev.y, ev.z) : p ? camera.position.distanceTo(p) : 99;
  switch (ev.type) {
    case 'break': crumbs(ev.x + 0.5, ev.y + 0.5, ev.z + 0.5, ev.b, 34, 3.4); clearCrack(ev.x, ev.y, ev.z); sfx.brk(d, ev.b); break;
    case 'place': sfx.place(d, ev.b); crumbs(ev.x + 0.5, ev.y + 0.1, ev.z + 0.5, ev.b, 8, 1.5, 2.4, 0.4); break;
    case 'crack': setCrack(ev.x, ev.y, ev.z, ev.p); crumbs(ev.x + 0.5, ev.y + 0.5, ev.z + 0.5, blockAt(ev.x, ev.y, ev.z), 3, 2, 2.6, 0.5); break;
    case 'explode': explosion(ev.x, ev.y, ev.z, ev.p); for (const pl of S.players.keys()) { const q = viewPos(pl); if (q && q.distanceTo(new THREE.Vector3(ev.x, ev.y, ev.z)) < 14) bump(pl, 8); } break;
    case 'hurt': if (p) { burst(p.x, p.y + 1, p.z, [0.8, 0.1, 0.1], 6, 2, 2, 0.4); const hv = views.get(ev.id); sfx.hurt(d, hv ? hv.type : 'player'); } bump(ev.id, 3); { const v = views.get(ev.id); if (v) v.hurtAt = performance.now(); } break;
    case 'shoot': sfx.twang(d); break;
    case 'pickup': sfx.pop(d); break;
    case 'eat': if (p) burst(p.x, p.y + 1.5, p.z, [0.8, 0.6, 0.4], 5, 1.5, 2, 0.4); sfx.eat(d); break;
    case 'grow': case 'bonemeal': for (let i = 0; i < 10; i++) glows.spawn(ev.x + R(), ev.y + R(), ev.z + R(), 0, 0.6, 0, 0.4, 1, 0.4, 1, 2, 1, 0); break;
    case 'fuse': sfx.hiss(d); break;
    case 'death': {
      const v = views.get(ev.id);
      if (v) { burst(v.pos.x, v.pos.y + 0.6, v.pos.z, [0.85, 0.85, 0.85], 20, 2, 5, 0.9, -1); sfx.death(d, v.type); }
      if (ev.msg) bump(ev.id, 10); if (ev.by) bump(ev.by, 4);
      break;
    }
    case 'milestone': bump(ev.id, 6); sfx.chime(d); if (p) for (let i = 0; i < 24; i++) glows.spawn(p.x, p.y + 1, p.z, (R() - 0.5) * 3, R() * 4, (R() - 0.5) * 3, 1, 0.85, 0.3, 1, 3, 1, 3); break;
    case 'chat': { const v = views.get(ev.id); if (v) showBubble(v, ev.text); bump(ev.id, 2); break; }
    case 'craft': bump(ev.id, 0.6); break;
    case 'weather': S.rain = ev.rain; break;
    case 'ps': applyPs(ev); break;
    case 'over': S.over = ev; break;
  }
}
function applyPs(ev) { for (const s of ev.list) S.summaries.set(s.id, s); updateCards(); }

// ---------- entity views ----------
const views = new Map();
const tagsEl = $('tags');
function makeView(a) {
  const [id, type] = a;
  const v = { id, type, pos: new THREE.Vector3(a[2], a[3], a[4]), yaw: a[5], root: null, M: null, bright: 1, brightT: 0, lastStep: 0 };
  if (type === 'player') {
    const p = S.players.get(id) || { name: '?', color: '#fff' };
    v.M = playerModel(p.name, p.color);
    v.root = v.M.root;
    v.tag = document.createElement('div'); v.tag.className = 'tag'; v.tag.innerHTML = `<span style="background:${p.color}"></span>${esc(p.name)}<i></i>`;
    tagsEl.appendChild(v.tag);
    v.hpEl = v.tag.querySelector('i');
  } else if (MOBS[type]) {
    v.M = mobModel(type, a[9]);
    v.root = v.M.root;
  } else if (type === 'item') {
    v.root = new THREE.Group();
    const m = makeItemMesh(a[9]);
    if (m) v.root.add(m);
    v.spin = R() * 6;
  } else if (type === 'falling' || type === 'primed') {
    v.root = new THREE.Mesh(blockGeo(a[9], 1), type === 'primed' ? new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true }) : blockItemMat);
    v.root.geometry = blockGeo(a[9], 1);
    v.inner = v.root; v.root = new THREE.Group(); v.root.add(v.inner); v.inner.position.y = 0.5;
  } else if (type === 'ember') {
    v.root = new THREE.Group();
    v.root.add(new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), new THREE.MeshBasicMaterial({ color: 0xff8a30 })));
    v.root.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xffe9a0 })));
  } else if (type === 'arrow' || type === 'thorn') {
    v.root = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, type === 'arrow' ? 0.7 : 0.35), new THREE.MeshLambertMaterial({ color: type === 'arrow' ? 0x8a6a40 : 0x6aa040 }));
    v.root.add(m);
  } else { v.root = new THREE.Group(); }
  scene.add(v.root);
  const w = type === 'player' ? 0.8 : MOBS[type] ? MOBS[type].w * 1.4 * (type === 'gelatoad' ? (a[9] || 3) / 3 : 1) : type === 'item' ? 0.4 : 1;
  v.shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  v.shadow.scale.set(w, 1, w); v.shadow.renderOrder = 1;
  scene.add(v.shadow);
  return v;
}
function removeView(v) {
  scene.remove(v.root); scene.remove(v.shadow);
  if (v.tag) v.tag.remove();
  if (v.bubble) v.bubble.remove();
}
function showBubble(v, text) {
  if (!v.tag) return;
  if (!v.bubble) { v.bubble = document.createElement('div'); v.bubble.className = 'bubble'; tagsEl.appendChild(v.bubble); }
  v.bubble.textContent = text.length > 120 ? text.slice(0, 117) + '…' : text;
  v.bubbleUntil = performance.now() + 4000 + text.length * 60;
}
const tmpV = new THREE.Vector3();
function lightAt(x, y, z) {
  const open = skyOpen(x, y + 1, z);
  let l = open ? 1 : 0.22;
  for (const e of nearEmit) { const d = Math.hypot(e[0] - x, e[1] - y - 1, e[2] - z); if (d < 12) l = Math.max(l, (1 - d / 12) * (e[3] === 2 ? 0.9 : 1) * 1.1 / dayFactor); }
  return Math.min(1.2, l);
}
let dayFactor = 1;
function updateViews(dt, now) {
  const seen = new Set();
  for (const a of S.ents.values()) {
    const id = a[0];
    seen.add(id);
    let v = views.get(id);
    if (!v || v.type !== a[1]) { if (v) removeView(v); v = makeView(a); views.set(id, v); }
    const tx = a[2], ty = a[3], tz = a[4];
    const far = Math.abs(tx - v.pos.x) + Math.abs(ty - v.pos.y) + Math.abs(tz - v.pos.z) > 8;
    const k = far ? 1 : 1 - Math.exp(-dt * (S.playing ? 12 : 30));
    v.pos.x += (tx - v.pos.x) * k; v.pos.y += (ty - v.pos.y) * k; v.pos.z += (tz - v.pos.z) * k;
    let dy = a[5] - v.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    v.yaw += dy * (far ? 1 : 1 - Math.exp(-dt * 10));
    v.flags = a[7]; v.hp = a[8];
    v.root.position.copy(v.pos);
    if (v.M) {
      v.root.rotation.y = v.yaw;
      if (now > v.brightT) { v.brightT = now + 300 + R() * 200; v.brightTarget = lightAt(v.pos.x, v.pos.y, v.pos.z); }
      v.bright += ((v.brightTarget || 1) - v.bright) * Math.min(1, dt * 4);
      v.M.bright = v.bright;
      v.M.update(dt, { flags: a[7], pitch: a[6] });
      if (v.type !== 'player' && sfx.on && (a[7] & 1) && (a[7] & 1024) && now - v.lastStep > 450) { v.lastStep = now; const sd = camera.position.distanceTo(v.pos); if (sd < 24) sfx.sample(['entity.' + v.type + '.step'], (1 - sd / 24) * 0.3); }
      if (v.type === 'player') {
        setHeld(v.M, a[9] || null, makeItemMesh);
        const s = S.summaries.get(id);
        if (s) v.M.setArmor(s.armorItems);
        v.root.visible = !((cam.mode === 'pov' || cam.mode === 'play') && cam.target === id);
        if ((a[7] & 1) && (a[7] & 1024) && now - v.lastStep > 330) { v.lastStep = now; sfx.step(camera.position.distanceTo(v.pos), blockAt(v.pos.x, v.pos.y - 0.5, v.pos.z)); if (R() < 0.5) { const below = blockAt(v.pos.x, v.pos.y - 0.5, v.pos.z); if (below) burst(v.pos.x, v.pos.y + 0.05, v.pos.z, tileColor(below), 2, 1, 1.5, 0.3); } }
      }
      if (v.type !== 'player' && R() < dt * 0.06 && sfx.on) sfx.ambient(camera.position.distanceTo(v.pos), v.type);
      if (v.type === 'glimmerfin' && R() < dt * 3) glows.spawn(v.pos.x + (R() - 0.5) * 0.4, v.pos.y + 0.2, v.pos.z + (R() - 0.5) * 0.4, 0, 0.3, 0, 0.4, 1, 0.9, 0.8, 1.5, 1, 0);
      if (v.type === 'gloomling' && R() < dt * 4) parts.spawn(v.pos.x + (R() - 0.5) * 0.6, v.pos.y + R() * 1.8, v.pos.z + (R() - 0.5) * 0.6, 0, 0.4, 0, 0.1, 0.08, 0.15, 0.7, 3, 1, -0.2);
    } else if (v.type === 'item') {
      v.spin += dt * 1.8;
      v.root.rotation.y = v.spin;
      v.root.children[0] && (v.root.children[0].position.y = 0.2 + Math.sin(v.spin * 1.4) * 0.06);
    } else if (v.type === 'primed') {
      const f = Math.sin(now / 90) > 0;
      v.inner.material.color.setScalar(f ? 2.2 : 1);
      const sc = 1 + Math.max(0, Math.sin(now / 90)) * 0.06; v.inner.scale.setScalar(sc);
      if (R() < 0.4) parts.spawn(v.pos.x, v.pos.y + 1.1, v.pos.z, 0, 1.2, 0, 0.35, 0.35, 0.35, 0.8, 2.5, 0.8, -0.5);
    } else if (v.type === 'arrow' || v.type === 'thorn' || v.type === 'ember') {
      v.root.rotation.set(0, 0, 0); v.root.rotateY(a[5]); v.root.rotateX(a[6]);
    }
    if (a[7] & 8) for (let i = 0; i < 2; i++) glows.spawn(v.pos.x + (R() - 0.5) * 0.8, v.pos.y + R() * 1.6, v.pos.z + (R() - 0.5) * 0.8, 0, 1.5, 0, 1, 0.45 + R() * 0.3, 0.1, 1, 3, 0.5, -1);
    // blob shadow
    let gy = null;
    for (let y = Math.floor(v.pos.y + 0.01); y > v.pos.y - 6 && y > 0; y--) if (solidAt(v.pos.x, y - 1, v.pos.z)) { gy = y; break; }
    v.shadow.visible = gy != null && v.root.visible;
    if (gy != null) { v.shadow.position.set(v.pos.x, gy + 0.02, v.pos.z); v.shadow.material.opacity = Math.max(0, 1 - (v.pos.y - gy) / 5) * (v.M ? v.bright : 1); }
  }
  for (const [id, v] of views) if (!seen.has(id)) { removeView(v); views.delete(id); }
}
function updateTags(now) {
  const w = innerWidth, h = innerHeight;
  for (const v of views.values()) {
    if (!v.tag) continue;
    const head = tmpV.set(v.pos.x, v.pos.y + (v.M ? v.M.height : 1.8) + 0.45, v.pos.z);
    const d = camera.position.distanceTo(head);
    head.project(camera);
    const vis = !clean && head.z < 1 && d < 70 && !((cam.mode === 'pov' || cam.mode === 'play') && cam.target === v.id) && Math.abs(head.x) < 1.1 && Math.abs(head.y) < 1.1;
    v.tag.style.display = vis ? '' : 'none';
    const x = (head.x * 0.5 + 0.5) * w, y = (-head.y * 0.5 + 0.5) * h;
    if (vis) {
      v.tag.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%) scale(${Math.max(0.6, Math.min(1, 14 / d))})`;
      v.hpEl.style.width = Math.max(0, (v.hp || 0) / 20 * 100) + '%';
      v.tag.classList.toggle('hurt', now - (v.hurtAt || 0) < 400);
      v.tag.classList.toggle('dead', !!(v.flags & 512));
    }
    if (v.bubble) {
      const show = vis && now < v.bubbleUntil;
      v.bubble.style.display = show ? '' : 'none';
      if (show) v.bubble.style.transform = `translate(${x}px,${y - 26}px) translate(-50%,-100%)`;
    }
  }
}

// ---------- camera ----------
const cam = { mode: 'director', target: null, dist: 5, oyaw: 0, opitch: 0.35, odist: 7, fyaw: 0, fpitch: 0, fov: 70 };
const dir = { target: null, shot: 'behind', until: 0, t0: 0, angle: 0 };
const SHOTS = ['behind', 'behind', 'side', 'front', 'wide', 'low', 'behind'];
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), lookTmp = new THREE.Vector3();
let snapCam = true;
function alivePlayers() { const out = []; for (const v of views.values()) if (v.type === 'player' && !(v.flags & 512)) out.push(v); return out; }
function directorPick(now, force) {
  const list = alivePlayers();
  if (!list.length) return;
  let best = null, bs = -1;
  for (const v of list) { const s = (interest.get(v.id) || 0) + R() * 3 - (v.id === dir.target ? 4 : 0); if (s > bs) { bs = s; best = v; } }
  dir.target = best.id;
  dir.shot = SHOTS[Math.floor(R() * SHOTS.length)];
  dir.until = now + 9000 + R() * 7000;
  dir.t0 = now; dir.angle = R() * 6.28;
  snapCam = true;
}
function clampCam(from, to) {
  const d = to.clone().sub(from), L = d.length(), n = Math.ceil(L / 0.2);
  for (let i = 1; i <= n; i++) {
    const p = from.clone().addScaledVector(d, i / n);
    if (solidAt(p.x, p.y, p.z)) return from.clone().addScaledVector(d, Math.max(0, (i - 2) / n));
  }
  return to;
}
function shotFor(v, shot, now) {
  const p = v.pos, fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = -fz, rz = fx;
  const head = new THREE.Vector3(p.x, p.y + 1.5, p.z);
  let c, l;
  switch (shot) {
    case 'front': c = new THREE.Vector3(p.x + fx * 4.5, p.y + 1.9, p.z + fz * 4.5); l = head; break;
    case 'side': c = new THREE.Vector3(p.x + rx * 5.5, p.y + 2.2, p.z + rz * 5.5); l = head; break;
    case 'wide': { const a = dir.angle + (now - dir.t0) / 9000; c = new THREE.Vector3(p.x + Math.cos(a) * 15, p.y + 9, p.z + Math.sin(a) * 15); l = head; break; }
    case 'cave': c = new THREE.Vector3(p.x - fx * 3 + rx * 0.5, p.y + 2.0, p.z - fz * 3 + rz * 0.5); l = new THREE.Vector3(p.x + fx * 3, p.y + 1.2, p.z + fz * 3); break;
    case 'low': c = new THREE.Vector3(p.x - fx * 2.5 + rx * 1.8, p.y + 0.5, p.z - fz * 2.5 + rz * 1.8); l = new THREE.Vector3(p.x + fx * 2, p.y + 1.7, p.z + fz * 2); break;
    default: c = new THREE.Vector3(p.x - fx * cam.dist + rx * 0.9, p.y + 2.3, p.z - fz * cam.dist + rz * 0.9); l = new THREE.Vector3(p.x + fx * 3, p.y + 1.3, p.z + fz * 3);
  }
  return [clampCam(head, c), l];
}
const keys = new Set();
function updateCamera(dt, now) {
  let target = null;
  if (cam.mode === 'director') {
    for (const [id, n] of interest) interest.set(id, n * Math.exp(-dt / 20));
    const cur = views.get(dir.target);
    if (!cur || (cur.flags & 512 && now - dir.t0 > 3000) || now > dir.until) directorPick(now);
    else {
      // cut to someone with a big moment
      for (const [id, n] of interest) if (id !== dir.target && n > 9 && now - dir.t0 > 3500) { dir.target = id; dir.shot = R() < 0.5 ? 'front' : 'behind'; dir.until = now + 10000; dir.t0 = now; snapCam = true; interest.set(id, n * 0.3); break; }
    }
    target = views.get(dir.target);
    cam.target = dir.target;
    if (target) { const under = !skyOpen(target.pos.x, target.pos.y + 1, target.pos.z); const [c, l] = shotFor(target, under ? 'cave' : dir.shot, now); moveCam(c, l, dt, under ? 6 : 3.5); }
  } else if (cam.mode === 'follow') {
    target = views.get(cam.target);
    if (target) { const [c, l] = shotFor(target, 'behind', now); moveCam(c, l, dt, 5); }
  } else if (cam.mode === 'pov') {
    target = views.get(cam.target);
    if (target) {
      const a = S.ents.get(target.id);
      const pitch = a ? a[6] : 0;
      cam.fpitch += (pitch - cam.fpitch) * Math.min(1, dt * 8);
      let dy = target.yaw - cam.fyaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); cam.fyaw += dy * Math.min(1, dt * 8);
      const sleeping = target.flags & 16;
      const eye = new THREE.Vector3(target.pos.x, target.pos.y + (sleeping ? 0.4 : 1.62), target.pos.z);
      camera.position.copy(eye);
      lookTmp.set(eye.x + Math.sin(cam.fyaw) * Math.cos(cam.fpitch), eye.y - Math.sin(cam.fpitch), eye.z + Math.cos(cam.fyaw) * Math.cos(cam.fpitch));
      camera.lookAt(lookTmp);
      camPos.copy(camera.position); camLook.copy(lookTmp);
    }
  } else if (cam.mode === 'orbit') {
    target = views.get(cam.target);
    const p = target ? target.pos : camLook;
    const head = new THREE.Vector3(p.x, p.y + 1.3, p.z);
    const c = new THREE.Vector3(head.x + Math.sin(cam.oyaw) * Math.cos(cam.opitch) * cam.odist, head.y + Math.sin(cam.opitch) * cam.odist, head.z + Math.cos(cam.oyaw) * Math.cos(cam.opitch) * cam.odist);
    moveCam(clampCam(head, c), head, dt, 10);
  } else if (cam.mode === 'play') {
    playCamera(dt);
  } else if (cam.mode === 'free') {
    const sp = (keys.has('shift') ? 40 : 14) * dt;
    const f = new THREE.Vector3(Math.sin(cam.fyaw) * Math.cos(cam.fpitch), -Math.sin(cam.fpitch), Math.cos(cam.fyaw) * Math.cos(cam.fpitch));
    const r = new THREE.Vector3(-Math.cos(cam.fyaw), 0, Math.sin(cam.fyaw));
    if (keys.has('w')) camera.position.addScaledVector(f, sp);
    if (keys.has('s')) camera.position.addScaledVector(f, -sp);
    if (keys.has('a')) camera.position.addScaledVector(r, -sp);
    if (keys.has('d')) camera.position.addScaledVector(r, sp);
    if (keys.has('e') || keys.has(' ')) camera.position.y += sp;
    if (keys.has('q') || keys.has('control')) camera.position.y -= sp;
    camera.lookAt(lookTmp.copy(camera.position).add(f));
  }
  if (shake > 0.001) { camera.position.x += (R() - 0.5) * shake; camera.position.y += (R() - 0.5) * shake; camera.position.z += (R() - 0.5) * shake; shake *= Math.exp(-dt * 6); }
  const fov = cam.mode === 'play' ? (play.me && (play.sprint || keys.has('control')) && Math.hypot(play.me.vx, play.me.vz) > 4.8 ? 84 : 76) : cam.mode === 'pov' ? 78 : 66;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
}
function moveCam(c, l, dt, rate) {
  if (snapCam) { camPos.copy(c); camLook.copy(l); snapCam = false; }
  else { const k = 1 - Math.exp(-dt * rate); camPos.lerp(c, k); camLook.lerp(l, Math.min(1, k * 1.6)); }
  camera.position.copy(camPos);
  unbury(camLook);
  camera.lookAt(camLook);
}
// never leave the camera inside a block: slide toward the subject, else rise above the ground
function inside(p) { return solidAt(p.x, p.y, p.z) || solidAt(p.x, p.y + 0.12, p.z) || solidAt(p.x, p.y - 0.12, p.z); }
function unbury(look) {
  const p = camera.position;
  if (!inside(p)) return;
  const d = look.clone().sub(p), L = d.length();
  for (let i = 1; i <= 20; i++) { const q = p.clone().addScaledVector(d, i / 20); if (!inside(q)) { camera.position.copy(q); camPos.copy(q); return; } if (i / 20 * L > L - 0.3) break; }
  for (let y = 1; y < 40; y++) { const q = new THREE.Vector3(p.x, p.y + y, p.z); if (!inside(q) && !solidAt(q.x, q.y + 1, q.z)) { camera.position.copy(q); camPos.copy(q); return; } }
}
function setMode(m) {
  if (m === 'free') { const f = new THREE.Vector3(); camera.getWorldDirection(f); cam.fyaw = Math.atan2(f.x, f.z); cam.fpitch = -Math.asin(f.y); }
  if (m === 'orbit') { const t = views.get(cam.target); if (t) { const d = camera.position.clone().sub(t.pos); cam.odist = Math.min(30, Math.max(3, d.length())); cam.oyaw = Math.atan2(d.x, d.z); cam.opitch = Math.asin(Math.max(-0.9, Math.min(0.9, (d.y - 1.3) / cam.odist))); } }
  if ((m === 'follow' || m === 'pov' || m === 'orbit') && !views.get(cam.target)) { const p = alivePlayers()[0]; if (p) cam.target = p.id; }
  if (m === 'director') directorPick(performance.now());
  cam.mode = m; snapCam = m !== 'orbit';
  for (const b of document.querySelectorAll('[data-cam]')) b.classList.toggle('on', b.dataset.cam === m);
  updateFocus();
}
function followPlayer(id) { cam.target = id; if (cam.mode === 'director' || cam.mode === 'free') setMode('follow'); else { snapCam = true; updateFocus(); } }

// input
const cv = renderer.domElement;
let drag = null;
cv.addEventListener('mousedown', e => { if (play.on) return; drag = { x: e.clientX, y: e.clientY }; if (cam.mode === 'director' || cam.mode === 'follow') setMode('orbit'); });
addEventListener('mouseup', () => { drag = null; });
addEventListener('mousemove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (cam.mode === 'orbit') { cam.oyaw -= dx * 0.006; cam.opitch = Math.max(-1.2, Math.min(1.45, cam.opitch + dy * 0.005)); }
  else if (cam.mode === 'free') { cam.fyaw -= dx * 0.004; cam.fpitch = Math.max(-1.5, Math.min(1.5, cam.fpitch + dy * 0.004)); }
});
cv.addEventListener('wheel', e => { e.preventDefault(); if (cam.mode === 'orbit') cam.odist = Math.max(2, Math.min(60, cam.odist * (1 + Math.sign(e.deltaY) * 0.12))); else if (cam.mode === 'follow' || cam.mode === 'director') cam.dist = Math.max(2.5, Math.min(14, cam.dist * (1 + Math.sign(e.deltaY) * 0.12))); }, { passive: false });
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (play.on && playKey(e, k)) return;
  if ('wasdqe'.includes(k) && k.length === 1 && cam.mode !== 'free') setMode('free');
  if (k === 'h') toggleClean();
  if (k === 'c') { const m = ['director', 'follow', 'pov', 'orbit', 'free']; setMode(m[(m.indexOf(cam.mode) + 1) % m.length]); }
  if (k === 'tab') { e.preventDefault(); const list = alivePlayers().sort((a, b) => a.id - b.id); if (list.length) { const i = list.findIndex(v => v.id === cam.target); followPlayer(list[(i + 1) % list.length].id); } }
  if (k === 'p' || (k === ' ' && cam.mode !== 'free')) { e.preventDefault(); togglePlay(); }
  if (k === 'arrowleft') { S.live = false; seek(S.playT - 10); }
  if (k === 'arrowright') seek(S.playT + 10);
  if (k === 'l') goLive();
  if (k >= '1' && k <= '9') { const list = [...S.players.values()].sort((a, b) => a.id - b.id); const p = list[Number(k) - 1]; if (p) followPlayer(p.id); }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// ---------- HUD ----------
let clean = false;
let idleT = 0;
function wake() { document.body.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (document.querySelector('#bar:hover, #cards:hover') || !$('more').hidden) wake(); else document.body.classList.add('idle'); }, 3500); }
addEventListener('mousemove', wake); addEventListener('keydown', wake); wake();
function toggleClean() { clean = !clean; document.body.classList.toggle('clean', clean); }
function togglePlay() { S.playing = !S.playing; if (S.mode === 'live' && !S.playing) S.live = false; $('play').textContent = S.playing ? '❚❚' : '▶'; }
function goLive() { if (S.mode !== 'live') return; S.live = true; S.playing = true; $('play').textContent = '❚❚'; seek(S.headT); }
function buildCards() {
  const el = $('cards');
  el.innerHTML = '';
  for (const p of [...S.players.values()].sort((a, b) => a.id - b.id)) {
    const c = document.createElement('div');
    c.className = 'card'; c.dataset.id = p.id;
    c.innerHTML = `<div class="nm"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}<em></em></div><div class="bars"><b class="hp"><i></i></b><b class="fd"><i></i></b></div><div class="doing"></div>`;
    c.onclick = () => followPlayer(p.id);
    el.appendChild(c);
  }
}
function updateCards() {
  for (const c of $('cards').children) {
    const s = S.summaries.get(Number(c.dataset.id));
    if (!s) continue;
    c.querySelector('.hp i').style.width = s.hp / 20 * 100 + '%';
    c.querySelector('.fd i').style.width = s.food / 20 * 100 + '%';
    c.querySelector('em').innerHTML = (s.held ? `<img src="${iconURL(s.held)}">` : '') + (s.deaths ? ` ☠${s.deaths}` : '');
    c.querySelector('.doing').textContent = s.doing || '';
    c.classList.toggle('dead', s.doing === 'dead');
    c.classList.toggle('sel', Number(c.dataset.id) === cam.target);
  }
  updateFocus();
}
function updateFocus() {
  const el = $('focus');
  const s = S.summaries.get(cam.target), p = S.players.get(cam.target);
  if (!s || !p) { el.style.display = 'none'; return; }
  el.style.display = '';
  let hearts = '';
  for (let i = 0; i < 10; i++) hearts += `<span class="ht ${s.hp >= (i + 1) * 2 ? 'f' : s.hp > i * 2 ? 'h' : ''}"></span>`;
  let food = '';
  for (let i = 0; i < 10; i++) food += `<span class="fo ${s.food >= (i + 1) * 2 ? 'f' : s.food > i * 2 ? 'h' : ''}"></span>`;
  const slots = s.inv.slice(0, 9).map(([id, n]) => `<div class="slot${id === s.held ? ' sel' : ''}"><img src="${iconURL(id)}" title="${esc(label(id))}">${n > 1 ? `<small>${n}</small>` : ''}</div>`).join('');
  const armor = (s.armorItems || []).filter(Boolean).map(id => `<img src="${iconURL(id)}" title="${esc(label(id))}">`).join('');
  el.innerHTML = `<div class="who"><span class="dot" style="background:${p.color}"></span>${esc(p.name)} <span class="doing">${esc(s.doing || '')}</span> <span class="armor">${armor}${s.armor ? ' 🛡' + s.armor : ''}</span></div>
    <div class="stats"><div>${hearts}</div><div class="r">${food}</div></div><div class="hot">${slots}</div>`;
  for (const c of $('cards').children) c.classList.toggle('sel', Number(c.dataset.id) === cam.target);
}
function fmtT(t) { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); }
function clockText(clock) {
  const dt = S.meta.dayTicks, tod = (clock % dt) / dt, day = Math.floor(clock / dt) + 1;
  const mins = Math.floor(((tod * 24 + 6) % 24) * 60);
  return `Day ${day} · ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}
$('play').onclick = togglePlay;
$('live').onclick = goLive;
$('speed').onchange = e => { S.speed = Number(e.target.value); };
$('time').oninput = e => { const t = Number(e.target.value); if (S.mode === 'live' && t < S.headT - 1) S.live = false; seek(t); };
$('snd').onclick = () => { $('snd').textContent = sfx.toggle() ? '🔊' : '🔇'; };
$('cleanbtn').onclick = toggleClean;
$('morebtn').onclick = e => { e.stopPropagation(); $('more').hidden = !$('more').hidden; };
addEventListener('click', e => { if (!$('more').hidden && !e.target.closest('#more')) $('more').hidden = true; });
$('cardsbtn').onclick = () => document.body.classList.toggle('nocards');
for (const b of document.querySelectorAll('[data-cam]')) b.onclick = () => setMode(b.dataset.cam);
$('dist').value = renderDist;
$('dist').onchange = e => { renderDist = Number(e.target.value); updateChunks(true); };
fetch('/api/replays').then(r => r.json()).then(r => {
  const sel = $('replays');
  for (const f of r.replays) { const o = document.createElement('option'); o.value = f; o.textContent = f.replace('.json.gz', ''); sel.appendChild(o); }
  sel.onchange = () => { if (sel.value) location.href = '/?replay=' + encodeURIComponent(sel.value) + (KEY ? '&key=' + KEY : ''); };
}).catch(() => {});

// ---------- environment (time of day) ----------
const C = (r, g, b) => new THREE.Color(r, g, b);
const ZEN = { day: C(0.3, 0.52, 0.92), set: C(0.3, 0.36, 0.62), night: C(0.035, 0.055, 0.13) };
const HOR = { day: C(0.68, 0.82, 0.98), set: C(0.98, 0.58, 0.34), night: C(0.11, 0.14, 0.24) };
const SKYL = { day: C(1, 1, 0.96), set: C(1, 0.8, 0.66), night: C(0.5, 0.56, 0.76) };
function mix3(o, wd, ws, wn) { const c = new THREE.Color(0, 0, 0); c.r = o.day.r * wd + o.set.r * ws + o.night.r * wn; c.g = o.day.g * wd + o.set.g * ws + o.night.g * wn; c.b = o.day.b * wd + o.set.b * ws + o.night.b * wn; return c; }
let rainAmt = 0, underwater = false;
function updateEnv(dt) {
  const clock = clockNow();
  const tod = (clock % S.meta.dayTicks) / S.meta.dayTicks;
  const a = tod * Math.PI * 2;
  const sun = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.25).normalize();
  U.uSun.value.copy(sun);
  const e = sun.y;
  const wd = THREE.MathUtils.smoothstep(e, -0.02, 0.3), wn = THREE.MathUtils.smoothstep(-e, 0.02, 0.28);
  const ws = Math.max(0, 1 - wd - wn);
  rainAmt += ((S.rain ? 1 : 0) - rainAmt) * Math.min(1, dt * 0.5);
  U.uRain.value = rainAmt;
  const grey = (c, k) => { const l = (c.r + c.g + c.b) / 3; c.lerp(new THREE.Color(l, l, l), k * 0.75); c.multiplyScalar(1 - k * 0.18); return c; };
  const realm = (defs.realmAt(camera.position.x, camera.position.z) || defs.REALM.overworld).name;
  let zen = grey(mix3(ZEN, wd, ws, wn), rainAmt), hor = grey(mix3(HOR, wd, ws, wn), rainAmt);
  if (realm === 'emberdeep') { zen = C(0.22, 0.05, 0.03); hor = C(0.55, 0.17, 0.07); }
  else if (realm === 'skyreach') { zen = C(0.36, 0.62, 0.98).lerp(zen, 0.3); hor = C(0.86, 0.93, 1).lerp(hor, 0.3); }
  skyU.uZenith.value.copy(zen); skyU.uHorizon.value.copy(hor);
  skyU.uNight.value = wn; skyU.uGlow.value = ws;
  let skyL = grey(mix3(SKYL, wd, ws, wn), rainAmt * 0.6);
  if (realm === 'emberdeep') skyL = C(0.85, 0.55, 0.42);
  else if (realm === 'skyreach') skyL = C(1, 1, 1).lerp(skyL, 0.35);
  U.uSkyLight.value.copy(skyL);
  dayFactor = Math.max(0.2, (skyL.r + skyL.g + skyL.b) / 3);
  U.uDay.value = realm === 'emberdeep' ? 0 : realm === 'skyreach' ? Math.max(0.6, wd) : wd * (1 - rainAmt);
  clouds.visible = realm !== 'emberdeep';
  skyU.uNight.value = realm === 'overworld' ? wn : 0;
  // underwater tint
  underwater = blockAt(camera.position.x, camera.position.y, camera.position.z) === defs.B.water;
  U.uUnder.value = underwater ? 1 : 0;
  const fogC = underwater ? new THREE.Color(0.08, 0.2, 0.38).multiplyScalar(0.3 + dayFactor * 0.7) : hor;
  U.uFogColor.value.copy(fogC);
  const far = renderDist * 16 - 10;
  U.uFogFar.value = underwater ? 22 : far * (1 - rainAmt * 0.35);
  U.uFogNear.value = underwater ? 2 : far * (0.5 - rainAmt * 0.2);
  scene.fog.color.copy(fogC); scene.fog.near = U.uFogNear.value; scene.fog.far = U.uFogFar.value;
  amb.intensity = 0.3 + dayFactor * 0.55; amb.color.copy(skyL).lerp(new THREE.Color(1, 1, 1), 0.4);
  sunL.intensity = realm === 'emberdeep' ? 0 : Math.max(0, e) * 0.7 * (1 - rainAmt * 0.6);
  sunL.position.copy(camera.position).addScaledVector(sun, 50); sunL.target.position.copy(camera.position);
  cloudU.uCol.value.copy(skyL).lerp(hor, 0.25).multiplyScalar(0.98);
  clouds.position.x = Math.round(camera.position.x / 10) * 10; clouds.position.z = Math.round(camera.position.z / 10) * 10;
  sky.position.copy(camera.position);
  // rain
  const showRain = realm === 'overworld' && rainAmt > 0.05 && skyOpen(camera.position.x, camera.position.y, camera.position.z) && !underwater;
  rain.visible = showRain;
  if (showRain) {
    rain.material.opacity = 0.45 * rainAmt;
    const p = camera.position;
    for (let i = 0; i < RAIN_N; i++) {
      const d = rainDrops[i];
      d[1] -= d[3] * dt;
      if (d[1] < -8) { d[0] = R() * 60 - 30; d[1] = 24 + R() * 8; d[2] = R() * 60 - 30; }
      const x = p.x + d[0], y = p.y + d[1], z = p.z + d[2];
      rainPos[i * 6] = x; rainPos[i * 6 + 1] = y; rainPos[i * 6 + 2] = z;
      rainPos[i * 6 + 3] = x + 0.05; rainPos[i * 6 + 4] = y + 0.7; rainPos[i * 6 + 5] = z;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }
  $('clock').textContent = clockText(clock) + (S.rain ? ' · 🌧' : '');
}

// ambient emitter particles (torch flames, lava pops, glowing crystals)
function emitterFx(dt) {
  if (emittersDirty) refreshEmitters();
  const p = camera.position;
  for (const e of nearEmit) {
    if (Math.abs(e[0] - p.x) > 28 || Math.abs(e[2] - p.z) > 28) continue;
    if (e[3] === 1) {
      if (R() < dt * 6) glows.spawn(e[0] + (R() - 0.5) * 0.08, e[1] + 0.02, e[2] + (R() - 0.5) * 0.08, 0, 0.5, 0, 1, 0.55 + R() * 0.25, 0.15, 1, 1.6, 0.35, -0.5);
      if (R() < dt * 0.8) parts.spawn(e[0], e[1] + 0.15, e[2], (R() - 0.5) * 0.1, 0.5, (R() - 0.5) * 0.1, 0.12, 0.12, 0.12, 0.45, 1.1, 1.2, -0.2);
    } else if (e[3] === 2 && R() < dt * 0.5) {
      for (let i = 0; i < 4; i++) glows.spawn(e[0], e[1], e[2], (R() - 0.5) * 2, 2 + R() * 2, (R() - 0.5) * 2, 1, 0.45, 0.1, 1, 2, 1, 10);
    } else if (e[3] === 3 && R() < dt * 0.8) glows.spawn(e[0] + (R() - 0.5), e[1] + (R() - 0.5), e[2] + (R() - 0.5), 0, 0.2, 0, 0.4, 0.95, 1, 0.8, 1.6, 1.4, 0);
  }
}

// ---------- main loop ----------
let lastFrame = performance.now(), fpsAcc = 0, fpsN = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!S.meta) { renderer.render(scene, camera); return; }
  // advance time
  if (S.mode === 'live') {
    if (S.live) {
      const target = S.headT;
      if (target > S.playT) { advanceTo(target); S.playT = target; }
    } else if (S.playing) {
      const t = S.playT + dt * S.speed;
      if (t >= S.headT) goLive(); else { advanceTo(t); S.playT = t; }
    }
  } else if (S.playing) {
    const t = Math.min(S.duration, S.playT + dt * S.speed);
    advanceTo(t); S.playT = t;
    if (t >= S.duration) { S.playing = false; $('play').textContent = '▶'; }
  }
  // events up to now
  let n = 0;
  while (S.ei < S.events.length && S.events[S.ei][0] <= S.playT && n++ < 400) handleEvent(S.events[S.ei++][1]);
  if (Math.abs(S.playT - lastWorkerT) > 0.05) { worker.postMessage({ type: 'time', t: S.playT }); lastWorkerT = S.playT; }
  U.uTime.value = now / 1000;
  updateViews(dt, now);
  updateCamera(dt, now);
  U.uCam.value.copy(camera.position);
  updateChunks(false);
  updateEnv(dt);
  emitterFx(dt);
  parts.update(dt); glows.update(dt);
  for (const [k, c] of cracks) if (now > c.until) { scene.remove(c.m); c.m.material.dispose(); cracks.delete(k); }
  for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.t += dt; f.s.scale.setScalar(2 + f.t * 30 * f.p / 3); f.s.material.opacity = Math.max(0, 1 - f.t / 0.45); if (f.t > 0.45) { scene.remove(f.s); f.s.material.dispose(); flashes.splice(i, 1); } }
  updateTags(now);
  renderer.render(scene, camera);
  // HUD text
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    $('fps').textContent = Math.round(fpsN / fpsAcc) + ' fps' + (pendingLeft ? ` · ${pendingLeft} chunks` : '');
    fpsAcc = 0; fpsN = 0;
    const max = S.mode === 'live' ? S.headT : S.duration;
    const tl = $('time'); tl.max = max; if (document.activeElement !== tl) tl.value = S.playT;
    $('tt').textContent = `${fmtT(S.playT)} / ${fmtT(max)}`;
    $('live').classList.toggle('on', S.mode === 'live' && S.live);
    $('live').style.display = S.mode === 'live' ? '' : 'none';
    $('status').textContent = S.mode === 'replay' ? 'REPLAY ' + S.meta.id : S.over ? 'GAME OVER' : !S.started ? 'waiting to start' : S.paused ? 'PAUSED' : `LIVE ×${S.serverSpeed}`;
    if (chunkMeshes.size > 8) $('loading').style.display = 'none';
  }
}
requestAnimationFrame(loop);

// ---------- start ----------
if (qs.get('replay')) loadReplay(qs.get('replay'));
else if (KEY) startLive();
else $('loading').innerHTML = 'Open the viewer link printed by <code>node host.js url</code>, or pick a replay below.';
setMode('director');
window.BWV = { S, views, cam, setMode, seek, chunkMeshes, camera, U, scene, blockAt,setClock: c => { S.fClock = c; S.fT = S.playT; } };

// ---------- Play mode: you join the world as your own player ----------
const play = { on: false, token: null, id: null, name: null, me: null, at: 0, slot: 0, useSeq: 0, hitSeq: 0, mining: false, useHeld: false, hitAt: 0, useAt: 0,
  pos: new THREE.Vector3(), eye: 1.62, bob: 0, swing: 0, locked: false, target: null, sending: false, fresh: true, hudKey: '', handId: undefined, lastW: 0, sprint: false, useReq: null, hitReq: null };
try { play.token = localStorage.getItem('bw-play-token'); play.name = localStorage.getItem('bw-play-name'); } catch (e) {}
const papi = (path, b) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-host-key': KEY }, body: JSON.stringify(b) }).then(r => r.json());
let chatOpen = false;
function lockPointer() { try { const r = cv.requestPointerLock && cv.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
scene.add(camera);
const hand = new THREE.Group(); camera.add(hand); hand.visible = false;
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
outline.visible = false; scene.add(outline);
const bagOpen = () => $('pbag').style.display === 'flex';

async function joinGame() {
  if (S.mode !== 'live') { location.href = '/?key=' + encodeURIComponent(KEY); return; }
  let name = play.name;
  if (!name) { name = (prompt('Your name in Blockwild:', 'You') || '').trim().slice(0, 16); if (!name) return; }
  let r;
  try { r = await papi('/api/play/join', { name, token: play.token }); } catch (e) { r = { error: 'server unreachable' }; }
  if (r.error) { ptip(r.error); return; }
  play.token = r.token; play.id = r.id; play.name = r.name;
  try { localStorage.setItem('bw-play-token', r.token); localStorage.setItem('bw-play-name', r.name); } catch (e) {}
  play.on = true; play.fresh = true; play.hudKey = ''; play.handId = undefined; play.me = null;
  document.body.classList.add('playing');
  goLive();
  cam.mode = 'play'; cam.target = r.id;
  for (const b of document.querySelectorAll('[data-cam]')) b.classList.remove('on');
  const v = views.get(r.id); if (v) { play.pos.copy(v.pos); cam.fyaw = v.yaw || 0; }
  cam.fpitch = 0.15;
  hand.visible = true;
  lockPointer();
  ptip('WASD to move · mouse to look · left click mines · right click places · Esc for the menu');
}
function leaveGame() {
  play.on = false; hand.visible = false; outline.visible = false; play.mining = false;
  document.body.classList.remove('playing'); $('pmenu').style.display = 'none'; $('pbag').style.display = 'none'; $('pdead').style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();
  cam.target = play.id; setMode('follow');
}
document.addEventListener('pointerlockchange', () => {
  play.locked = document.pointerLockElement === cv;
  if (!play.locked) { play.mining = false; play.useHeld = false; keys.clear(); }
  if (play.on) $('pmenu').style.display = play.locked || chatOpen || bagOpen() ? 'none' : 'flex';
});
let tipT = 0;
function ptip(text) { const el = $('ptip'); el.textContent = text; el.style.opacity = 1; clearTimeout(tipT); tipT = setTimeout(() => { el.style.opacity = 0; }, 3500); }

// tell the server what you are doing, 20 times a second
setInterval(async () => {
  if (!play.on || play.sending) return;
  const k = keys, live = play.locked && !chatOpen;
  let f = 0, s = 0;
  if (live) { if (k.has('w')) f++; if (k.has('s')) f--; if (k.has('d')) s++; if (k.has('a')) s--; }
  if (!k.has('w')) play.sprint = false;
  const y = cam.fyaw, t = play.target, now = performance.now();
  if (play.mining && t && t.ent != null && now - play.hitAt > 550) { play.hitAt = now; play.hitReq = { seq: ++play.hitSeq, id: t.ent }; play.swing = 1; }
  if (play.useHeld && now - play.useAt > 260) doUse();
  const b = { token: play.token, mx: Math.sin(y) * f - Math.cos(y) * s, mz: Math.cos(y) * f + Math.sin(y) * s, yaw: cam.fyaw, pitch: cam.fpitch,
    jump: live && k.has(' '), sneak: live && k.has('shift'), sprint: live && (k.has('control') || play.sprint), slot: play.slot,
    mine: play.mining && t && t.block ? t.block : null, use: play.useReq || undefined, hit: play.hitReq || undefined };
  play.sending = true;
  try {
    const r = await papi('/api/play/input', b);
    if (r.error) {
      if (/token/.test(r.error)) { try { localStorage.removeItem('bw-play-token'); } catch (e) {} play.token = null; leaveGame(); ptip('Your player was not found. Press Play to join again.'); }
    } else {
      play.me = r; play.at = performance.now();
      if (play.fresh) { play.pos.set(r.x, r.y, r.z); play.fresh = false; }
      if (r.err && r.err !== play.lastErr) ptip(r.err);
      play.lastErr = r.err;
      playHud();
    }
  } catch (e) { /* try again next tick */ }
  play.sending = false;
}, 50);
function doUse() {
  const t = play.target; play.useAt = performance.now(); play.swing = 1;
  play.useReq = t && t.block ? { seq: ++play.useSeq, x: t.block[0], y: t.block[1], z: t.block[2], face: t.face } : { seq: ++play.useSeq };
}

// what the crosshair points at: a block (voxel walk) or a creature (ray vs box)
function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = 99;
  for (const [oo, dd, a, b] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
    if (Math.abs(dd) < 1e-9) { if (oo < a || oo > b) return null; continue; }
    let t0 = (a - oo) / dd, t1 = (b - oo) / dd; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; }
    tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1); if (tmin > tmax) return null;
  }
  return tmin;
}
function pickTarget(o, d) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
  const tdx = sx ? Math.abs(1 / d.x) : Infinity, tdy = sy ? Math.abs(1 / d.y) : Infinity, tdz = sz ? Math.abs(1 / d.z) : Infinity;
  let tmx = sx ? (sx > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity, tmy = sy ? (sy > 0 ? y + 1 - o.y : o.y - y) * tdy : Infinity, tmz = sz ? (sz > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity;
  let face = [0, 1, 0], t = 0, block = null;
  for (let i = 0; i < 40 && t <= 5.2; i++) {
    const id = blockAt(x, y, z);
    if (id && !BLOCKS[id].liquid) { block = [x, y, z]; break; }
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; face = [-sx, 0, 0]; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; face = [0, -sy, 0]; }
    else { z += sz; t = tmz; tmz += tdz; face = [0, 0, -sz]; }
  }
  let ent = null, best = block ? Math.min(t, 4.4) : 4.4;
  for (const v of views.values()) {
    if (v.id === play.id || v.flags & 512 || (v.type !== 'player' && !MOBS[v.type])) continue;
    if (Math.abs(v.pos.x - o.x) > 6 || Math.abs(v.pos.z - o.z) > 6 || Math.abs(v.pos.y - o.y) > 6) continue;
    const md = MOBS[v.type], w = v.type === 'player' ? 0.6 : md.w, h = v.type === 'player' ? 1.8 : md.h || 1;
    const hit = rayBox(o, d, v.pos.x - w / 2 - 0.1, v.pos.y, v.pos.z - w / 2 - 0.1, v.pos.x + w / 2 + 0.1, v.pos.y + h, v.pos.z + w / 2 + 0.1);
    if (hit != null && hit < best) { best = hit; ent = v.id; }
  }
  return ent != null ? { ent } : block ? { block, face } : null;
}
const playTgt = new THREE.Vector3(), playDir = new THREE.Vector3(), playEye = new THREE.Vector3();
function playCamera(dt) {
  const me = play.me;
  if (!me) return;
  const lag = Math.min(0.12, (performance.now() - play.at) / 1000);
  playTgt.set(me.x + me.vx * lag, me.y + me.vy * lag, me.z + me.vz * lag);
  if (play.pos.distanceTo(playTgt) > 4) play.pos.copy(playTgt); else play.pos.lerp(playTgt, 1 - Math.exp(-dt * 16));
  const sneak = keys.has('shift') && play.locked && !chatOpen;
  play.eye += ((me.dead ? 0.35 : sneak ? 1.3 : 1.62) - play.eye) * Math.min(1, dt * 12);
  const spd = Math.hypot(me.vx, me.vz);
  if (me.onGround && spd > 0.5) play.bob += dt * spd * 2.4;
  const bob = me.onGround ? Math.min(1, spd / 4.3) : 0;
  const sb = Math.sin(play.bob), cb = Math.abs(Math.cos(play.bob));
  camera.position.set(play.pos.x + Math.cos(cam.fyaw) * sb * 0.035 * bob, play.pos.y + play.eye + cb * 0.05 * bob, play.pos.z - Math.sin(cam.fyaw) * sb * 0.035 * bob);
  playDir.set(Math.sin(cam.fyaw) * Math.cos(cam.fpitch), -Math.sin(cam.fpitch), Math.cos(cam.fyaw) * Math.cos(cam.fpitch));
  camera.lookAt(lookTmp.copy(camera.position).add(playDir));
  camPos.copy(camera.position); camLook.copy(lookTmp);
  playEye.set(play.pos.x, play.pos.y + play.eye, play.pos.z);
  play.target = me.dead ? null : pickTarget(playEye, playDir);
  const b = play.target && play.target.block;
  outline.visible = !!b && !clean;
  if (b) outline.position.set(b[0] + 0.5, b[1] + 0.5, b[2] + 0.5);
  // the hand / held item swings when you act
  if (play.mining && b && play.swing < 0.25) play.swing = 1;
  play.swing = Math.max(0, play.swing - dt * 4);
  const sw = play.swing > 0 ? Math.sin((1 - play.swing) * Math.PI) : 0;
  hand.rotation.set(-sw * 0.9, sw * 0.3, 0);
  const hh = 0.6 * Math.tan(camera.fov * Math.PI / 360), hw = hh * camera.aspect;
  hand.position.set(Math.min(hw * 0.6, 0.5) - sw * 0.1, -hh * 0.62 - sw * 0.08 + cb * 0.02 * bob, -0.6 - sw * 0.1);
  $('pcross').classList.toggle('on', !!(play.target && play.target.ent != null));
}
function setHand(id) {
  if (id === play.handId) return;
  play.handId = id;
  while (hand.children.length) hand.remove(hand.children[0]);
  let m;
  const it = id && ITEMS[id], b = it && it.block != null ? BLOCKS[it.block] : null;
  if (b && b.render !== 'cross' && b.render !== 'torch' && !b.noItem) { m = new THREE.Mesh(blockGeo(it.block, 0.34), blockItemMat.clone()); m.rotation.set(0.1, 0.7, 0); }
  else if (it) { m = new THREE.Mesh(extrudeIcon(id), spriteMat.clone()); m.scale.setScalar(0.42); m.rotation.set(0, -0.5, 0.35); m.position.set(0, 0.08, 0); }
  else { m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.5), new THREE.MeshLambertMaterial({ color: 0xd9a77a })); m.rotation.set(0.25, 0.25, 0); m.position.set(0.05, -0.06, 0.06); }
  m.material.depthTest = false; m.renderOrder = 999;
  hand.add(m);
}
function playHud() {
  const me = play.me; if (!me) return;
  const inv = me.inv || [];
  const key = JSON.stringify([Math.ceil(me.hp), me.food, inv, play.slot, me.armor, me.dead, Math.ceil(me.air / 30)]);
  if (key === play.hudKey) return; play.hudKey = key;
  let hearts = '', food = '', air = '';
  for (let i = 0; i < 10; i++) hearts += '<span class="ht ' + (me.hp >= (i + 1) * 2 ? 'f' : me.hp > i * 2 ? 'h' : '') + '"></span>';
  for (let i = 0; i < 10; i++) food += '<span class="fo ' + (me.food >= (i + 1) * 2 ? 'f' : me.food > i * 2 ? 'h' : '') + '"></span>';
  if (me.air < 290) for (let i = 0; i < 10; i++) air += '<span class="ai ' + (me.air > i * 30 ? 'f' : '') + '"></span>';
  $('phearts').innerHTML = hearts + (me.armor ? ' <b class="arm">🛡' + me.armor + '</b>' : '');
  $('pfood').innerHTML = (air ? '<div>' + air + '</div>' : '') + food;
  let slots = '';
  for (let i = 0; i < 9; i++) { const s = inv[i]; slots += '<div class="slot' + (i === play.slot ? ' sel' : '') + '">' + (s ? '<img src="' + iconURL(s[0]) + '">' + (s[1] > 1 ? '<small>' + s[1] + '</small>' : '') : '') + '</div>'; }
  $('photbar').innerHTML = slots;
  $('pdead').style.display = me.dead ? 'flex' : 'none';
  const cur = inv[play.slot];
  setHand(cur ? cur[0] : null);
  if (bagOpen()) drawBag();
}
function pickSlot(i) { i = ((i % 9) + 9) % 9; if (i === play.slot) return; play.slot = i; const s = play.me && play.me.inv[i]; if (s) ptip(label(s[0])); play.hudKey = ''; playHud(); }
function drawBag() {
  const inv = (play.me && play.me.inv) || [];
  const keep = $('pcraft') ? $('pcraft').value : '';
  let h = '<div class="bagbox"><h3>Your bag <small>click an item to move it into the selected hotbar slot</small></h3><div class="grid">';
  for (let i = 0; i < 36; i++) { const s = inv[i]; h += '<div class="slot' + (i < 9 ? ' hb' : '') + (i === play.slot ? ' sel' : '') + '" data-i="' + i + '">' + (s ? '<img src="' + iconURL(s[0]) + '" title="' + esc(label(s[0])) + '">' + (s[1] > 1 ? '<small>' + s[1] + '</small>' : '') : '') + '</div>'; }
  h += '</div><div class="craft"><input id="pcraft" placeholder="make something, e.g. wooden_pickaxe, torch 4, smelt raw_iron 3"><button id="pcraftgo">Make</button></div><p class="hint">Uses the same recipes as the AI players. Press E to close.</p></div>';
  $('pbag').innerHTML = h;
  $('pcraft').value = keep;
  for (const el of $('pbag').querySelectorAll('.slot')) el.onclick = () => { const i = Number(el.dataset.i); papi('/api/play/swap', { token: play.token, a: play.slot, b: i }).then(() => { play.hudKey = ''; }); };
  const go = () => { let v = $('pcraft').value.trim(); if (!v) return; if (!/^(craft|smelt|cook|eat|equip|trade|tame|sleep)\b/.test(v)) v = 'craft ' + v; sendChat('/' + v); $('pcraft').value = ''; };
  $('pcraftgo').onclick = go;
  $('pcraft').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape') toggleBag(); };
}
function toggleBag() {
  const el = $('pbag'), open = !bagOpen();
  el.style.display = open ? 'flex' : 'none';
  if (open) { drawBag(); if (document.pointerLockElement) document.exitPointerLock(); }
  else lockPointer();
}
$('pbag').addEventListener('mousedown', e => { if (e.target.id === 'pbag') toggleBag(); });
async function sendChat(text) {
  if (!text) return;
  await papi('/api/play/chat', { token: play.token, text }).catch(() => {});
  if (text.startsWith('/')) setTimeout(async () => { const r = await papi('/api/play/brief', { token: play.token }).catch(() => null); const m = r && r.text && r.text.match(/RESULTS: (.*)/); if (m) ptip(m[1].slice(0, 160)); }, 1600);
}
function openChat(prefill) {
  chatOpen = true; const el = $('pchat'); el.style.display = 'block'; el.value = prefill || ''; setTimeout(() => el.focus(), 0);
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeChat(send) {
  const el = $('pchat'), text = el.value.trim(); el.style.display = 'none'; el.blur(); chatOpen = false;
  if (send && text) sendChat(text);
  lockPointer();
}
$('pchat').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') closeChat(true); if (e.key === 'Escape') { e.preventDefault(); closeChat(false); } });
function playKey(e, k) {
  if (chatOpen) return true;
  if (bagOpen()) { if (k === 'e' || k === 'escape') toggleBag(); return true; }
  if (k === 't' || k === 'enter' || k === '/') { e.preventDefault(); keys.clear(); openChat(k === '/' ? '/' : ''); return true; }
  if (k >= '1' && k <= '9') { pickSlot(Number(k) - 1); return true; }
  if (k === 'e') { toggleBag(); return true; }
  if (k === 'q' && play.me && play.me.inv[play.slot]) { sendChat('/drop ' + play.me.inv[play.slot][0] + ' 1'); return true; }
  if (k === 'w' && !e.repeat) { const n = performance.now(); if (n - play.lastW < 280) play.sprint = true; play.lastW = n; }
  if (k === 'f1') { e.preventDefault(); toggleClean(); }
  if (k === ' ' || k === 'tab' || k === 'control') e.preventDefault();
  return true;
}
addEventListener('mousemove', e => {
  if (!play.on || !play.locked) return;
  cam.fyaw -= e.movementX * 0.0024;
  cam.fpitch = Math.max(-1.55, Math.min(1.55, cam.fpitch + e.movementY * 0.0024));
});
cv.addEventListener('mousedown', e => {
  if (!play.on) return;
  if (!play.locked) { if (!chatOpen) lockPointer(); return; }
  if (e.button === 0) { play.mining = true; play.swing = 1; const t = play.target; if (t && t.ent != null) { play.hitAt = performance.now(); play.hitReq = { seq: ++play.hitSeq, id: t.ent }; } }
  if (e.button === 2) { play.useHeld = true; doUse(); }
});
addEventListener('mouseup', e => { if (e.button === 0) play.mining = false; if (e.button === 2) play.useHeld = false; });
cv.addEventListener('contextmenu', e => { if (play.on) e.preventDefault(); });
cv.addEventListener('wheel', e => { if (play.on && play.locked) pickSlot(play.slot + Math.sign(e.deltaY)); }, { passive: true });
$('joinbtn').onclick = joinGame;
$('presume').onclick = () => { $('pmenu').style.display = 'none'; lockPointer(); };
$('pleave').onclick = leaveGame;
window.BWP = play;
