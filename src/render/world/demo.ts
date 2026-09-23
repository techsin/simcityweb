/**
 * World renderer demo (demo-world.html). URL params:
 *   size=64|128|256  terrain=hills|coast|mountains|river|islands|lakes|plains|flat  climate=temperate|desert|tropical|alpine
 *   seed=<n> time=<hours> auto=0|1 (auto time) scale=<game min per s>  quality=low|medium|high|ultra
 *   dist=<m> tilt=<deg> yaw=<deg> tx=<cell> tz=<cell>  (camera)
 *   overlay=<name|id> (e.g. landValue, traffic, police, power, zones)  grid=1  zones=0|1 (fake zones, default 1)
 *   bld=1 (drop a few catalog models on zoned lots)  hl=1 (tool highlight demo)  brush=1  hud=0  frames=<n>
 *   capture=top (render a top-down thumbnail into the page instead)
 * Keys (in addition to the camera): T toggle auto time, [ ] -/+ 1 h, 1..4 quality, O cycle overlay, G grid.
 */
import * as THREE from 'three';
import { Emitter } from '../../core/events';
import { CELL_SIZE } from '../../core/constants';
import { Noise2D, RNG } from '../../core/rng';
import { Overlay, Zone, type Climate, type TerrainPreset } from '../../core/types';
import { defaultCityConfig } from '../../sim/config';
import { createCityState } from '../../sim/terrainGen';
import type { CityState } from '../../sim/CityState';
import type { CityEvents } from '../../sim/Simulation';
import type { QualityLevel } from '../contracts';
import { MANIFEST } from '../../assets/manifest';
import { getModelGeometry } from '../../assets/registry';
import { getBuildingMaterial } from '../../assets/materials';
import { WorldView } from './WorldView';
import { overlayLegend } from './overlays';

const P = new URLSearchParams(location.search);
const num = (k: string, d: number) => (P.has(k) ? parseFloat(P.get(k)!) : d);
const size = num('size', 128);
const terrain = (P.get('terrain') ?? 'hills') as TerrainPreset;
const climate = (P.get('climate') ?? 'temperate') as Climate;
const seed = num('seed', 20240);
const quality = (P.get('quality') ?? 'high') as QualityLevel;

const state = createCityState(defaultCityConfig({ size, terrain, climate, seed, treeDensity: num('trees', 0.5), waterAmount: num('water', 0.3), hilliness: num('hills', 0.4) }));
const events = new Emitter<CityEvents>();

// ---------------------------------------------------------------------------------------------- fake city data
function flatEnough(st: CityState, x: number, z: number) {
  return st.inBounds(x, z) && !st.isWater(x, z) && st.cellSlope(x, z) < 2.5 && st.cellHeight(x, z) > 1.5;
}
function fakeZones(st: CityState) {
  const rng = new RNG(seed + 3);
  const N = st.size;
  const c = N / 2;
  const kinds = [Zone.ResLow, Zone.ResMed, Zone.ResHigh, Zone.ComLow, Zone.ComMed, Zone.ComHigh, Zone.IndAg, Zone.IndMed, Zone.IndHigh];
  let placed = 0;
  for (let tries = 0; tries < 400 && placed < 26; tries++) {
    const w = rng.int(3, 7), d = rng.int(2, 5);
    const x0 = Math.floor(c + rng.range(-N * 0.28, N * 0.28)), z0 = Math.floor(c + rng.range(-N * 0.28, N * 0.28));
    let ok = true;
    for (let z = z0 - 1; z <= z0 + d && ok; z++) for (let x = x0 - 1; x <= x0 + w && ok; x++) if (!flatEnough(st, x, z) || st.zone[st.idx(x, z)]) ok = false;
    if (!ok) continue;
    const k = kinds[placed % kinds.length];
    for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) st.zone[st.idx(x, z)] = k;
    // fake street along the front
    for (let x = x0 - 1; x <= x0 + w; x++) if (st.inBounds(x, z0 + d)) st.network[st.idx(x, z0 + d)] = 2;
    placed++;
  }
}
function fakeLayers(st: CityState) {
  const n = new Noise2D(seed + 9);
  const N = st.size;
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const u = x / N, v = z / N;
      const dc = Math.hypot(u - 0.5, v - 0.5);
      const a = n.fbm(u * 4, v * 4, 3) * 0.5 + 0.5;
      const b = n.fbm(u * 3 + 7, v * 3 - 2, 3) * 0.5 + 0.5;
      st.landValue[i] = Math.max(0, Math.min(1, a * 0.8 + (0.5 - dc) * 0.6));
      st.airPollution[i] = Math.max(0, b * 1.4 - 0.6);
      st.waterPollution[i] = st.water[i] ? Math.max(0, b - 0.4) : 0;
      st.garbage[i] = Math.max(0, a - 0.6);
      st.crime[i] = Math.max(0, (1 - a) * 1.2 - 0.5);
      st.noise[i] = Math.max(0, b - 0.35);
      const cov = (cx: number, cz: number, r: number) => Math.max(0, 1 - Math.hypot(u - cx, v - cz) / r);
      st.policeCov[i] = Math.min(1, cov(0.45, 0.5, 0.18) + cov(0.62, 0.4, 0.12));
      st.fireCov[i] = Math.min(1, cov(0.55, 0.55, 0.2));
      st.healthCov[i] = cov(0.4, 0.42, 0.22);
      st.eduCov[i] = cov(0.58, 0.6, 0.16);
      st.transitCov[i] = cov(0.5, 0.5, 0.12);
      const zoned = st.zone[i] !== 0;
      st.powered[i] = zoned && a > 0.35 ? 1 : 0;
      st.watered[i] = zoned && b > 0.3 ? 1 : 0;
      st.congestion[i] = st.network[i] ? a * 1.3 : 0;
      for (let k = 0; k < st.desirability.length; k++) st.desirability[k][i] = (a - 0.5) * 1.6;
    }
  st.stats.population = 250000;
}
const fakeZ = P.get('zones') !== '0';
if (fakeZ) fakeZones(state);
fakeLayers(state);

// ---------------------------------------------------------------------------------------------- world
const canvas = document.getElementById('c') as HTMLCanvasElement;
const world = new WorldView(canvas, state, events, { quality, timeOfDay: num('time', 10.5), autoTime: P.get('auto') === '1' });
world.timeScale = num('scale', 2);
(window as any).world = world;
(window as any).state = state;

const W = size * CELL_SIZE;
world.cameraController.setView(num('tx', size / 2) * CELL_SIZE, num('tz', size / 2) * CELL_SIZE, num('dist', Math.min(1500, W * 0.6)), num('tilt', 48), num('yaw', 45));

// optional sample buildings on zoned lots (to check lighting / night windows under this renderer)
if (P.get('bld') === '1') {
  const pick: Record<string, string[]> = {
    R: MANIFEST.filter((e) => e.group === 'residential' && e.footprint[0] === 1 && e.footprint[1] === 1).map((e) => e.id),
    C: MANIFEST.filter((e) => e.group === 'commercial' && e.footprint[0] === 1 && e.footprint[1] === 1).map((e) => e.id),
    I: MANIFEST.filter((e) => e.group === 'industrial' && e.footprint[0] === 1 && e.footprint[1] === 1).map((e) => e.id),
  };
  const rng = new RNG(seed + 77);
  const mat = getBuildingMaterial();
  const g = new THREE.Group();
  let id = 1;
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      const zn = state.zone[z * size + x];
      if (!zn || rng.chance(0.25)) continue;
      const fam = zn <= 3 ? 'R' : zn <= 6 ? 'C' : 'I';
      const list = pick[fam];
      if (!list.length) continue;
      const mid = rng.pick(list);
      const mesh = new THREE.Mesh(getModelGeometry(mid, rng.int(0, 5)), mat);
      const cx = (x + 0.5) * CELL_SIZE, cz = (z + 0.5) * CELL_SIZE;
      mesh.position.set(cx, world.terrainHeightAt(cx, cz), cz);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
      state.building[z * size + x] = id++;
    }
  world.scene.add(g);
  events.emit('buildingAdded', { x: 0, z: 0, w: size, d: size } as any);
}

// overlays
const OVERLAY_NAMES: Record<string, Overlay> = {
  none: Overlay.None, zones: Overlay.Zones, traffic: Overlay.Traffic, air: Overlay.AirPollution, airpollution: Overlay.AirPollution,
  water: Overlay.WaterPollution, waterpollution: Overlay.WaterPollution, garbage: Overlay.Garbage, landvalue: Overlay.LandValue,
  crime: Overlay.Crime, police: Overlay.Police, fire: Overlay.Fire, health: Overlay.Health, education: Overlay.Education,
  power: Overlay.Power, watersupply: Overlay.Water, desirability: Overlay.Desirability, noise: Overlay.Noise, transit: Overlay.Transit,
};
let overlay = Overlay.None;
const ov = P.get('overlay');
if (ov) overlay = /^\d+$/.test(ov) ? (parseInt(ov, 10) as Overlay) : OVERLAY_NAMES[ov.toLowerCase()] ?? Overlay.None;
const legendEl = document.getElementById('legend')!;
function setOverlay(o: Overlay) {
  overlay = o;
  world.setOverlay(o);
  const lg = overlayLegend(o);
  legendEl.innerHTML = o === Overlay.None ? '' : `<b>${lg.title}</b><br>` + lg.stops.map((s) => `<span class="sw" style="background:${s.color}"></span>${s.label}`).join('<br>');
}
setOverlay(overlay);
world.setGridVisible(P.get('grid') === '1');
if (P.get('hl') === '1') {
  const cx = Math.floor(size / 2), cz = Math.floor(size / 2);
  const cells = [];
  for (let i = 0; i < 8; i++) cells.push({ x: cx - 4 + i, z: cz + 3, ok: i < 6 });
  world.setHighlight(cells);
  world.setHighlightRect({ x0: cx - 6, z0: cz - 6, x1: cx - 1, z1: cz - 2 }, 0x4fd0ff);
}
if (P.get('brush') === '1') world.setBrush({ x: (size / 2 + 5) * CELL_SIZE, z: (size / 2 - 3) * CELL_SIZE }, 4);

// ---------------------------------------------------------------------------------------------- loop
const hud = document.getElementById('hud')!;
if (P.get('hud') === '0') hud.classList.add('hidden');
const onResize = () => world.resize(window.innerWidth, window.innerHeight);
window.addEventListener('resize', onResize);
onResize();
world.trees.flush();

window.addEventListener('keydown', (e) => {
  if (e.key === 't') world.autoTime = !world.autoTime;
  else if (e.key === '[') world.timeOfDay = world.timeOfDay - 1;
  else if (e.key === ']') world.timeOfDay = world.timeOfDay + 1;
  else if (e.key >= '1' && e.key <= '4') world.setQuality((['low', 'medium', 'high', 'ultra'] as QualityLevel[])[+e.key - 1]);
  else if (e.key === 'o') setOverlay(((overlay + 1) % 17) as Overlay);
  else if (e.key === 'g') world.setGridVisible(!(world.terrain.uniforms.uGrid.value > 0));
});
canvas.addEventListener('pointermove', (e) => {
  const hit = world.pickCell(e.clientX, e.clientY);
  (window as any).__hover = hit;
});

const framesNeeded = num('frames', 3);
let frames = 0;
let last = performance.now();
let fps = 60;
function frame() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  world.update(frames < framesNeeded ? 1 / 60 : dt);
  world.render();
  frames++;
  if (frames % 10 === 1 || frames <= framesNeeded) {
    const s = world.stats;
    const h = world.timeOfDay;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    const hover = (window as any).__hover;
    hud.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}  ${world.quality}  ${fps.toFixed(0)} fps\n` +
      `calls ${s.calls}  tris ${(s.triangles / 1e6).toFixed(2)}M  trees ${s.trees}  cpu ${s.frameMs.toFixed(1)}ms\n` +
      `dist ${world.controls.distance.toFixed(0)} m${hover ? `  cell ${hover.x},${hover.z}` : ''}`;
  }
  if (frames === framesNeeded) {
    const s = world.stats;
    console.log(`[world] ready calls=${s.calls} tris=${s.triangles} trees=${s.trees}`);
    if (P.get('capture') === 'top') {
      const url = world.capture(512, 512, true);
      const img = document.createElement('img');
      img.src = url;
      img.style.cssText = 'position:absolute;left:0;top:0;width:512px;height:512px;z-index:10';
      img.onload = () => ((window as any).__ready = true);
      document.body.appendChild(img);
    } else (window as any).__ready = true;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
