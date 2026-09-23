/**
 * UI dev page (demo-ui.html): mounts the full CityScene on a fresh city.
 *
 * URL params:
 *   size=64|128|256  seed=<n>  terrain=<preset>  difficulty=easy|medium|hard|sandbox  disasters=0|1
 *   town=1            build a small town through CityActions (roads, zones, power, services)
 *   days=<n>          run n simulated days synchronously after building (let things grow)
 *   fake=1            fill stats / history / budget / news with sample data (UI screenshots)
 *   speed=0..3        initial speed (default 1; 0 with fake=1)
 *   panel=a,b         open panels (budget, graphs, stats, advisors, ordinances, rewards, settings, dataviews, help)
 *   tool=<id|alias>   select a tool (road, street, avenue, highway, rail, power, subway, res, com, ind, bulldoze,
 *                      raise, trees, query, plop:<defId>, zone:<n>, net:<n>)
 *   fly=<category>    open a toolbar flyout (zones, transport, utilities, civic, parks, landmarks, terrain)
 *   hover=x,z         simulate the mouse over a cell;  drag=x0,z0,x1,z1  simulate a left-drag (held, not released)
 *   click=x,z         simulate a left click on a cell (e.g. with the query tool)
 *   query=x,z         open the inspector for a cell / building
 *   overlay=<name>    data view (landvalue, traffic, crime, pollution, power, zones...)
 *   rci=1             expand the RCI popover;   pause=1  open the pause menu;   toasts=1  sample notifications
 *   cam=x,z,dist      focus the camera on a cell;   fallback=all|world|objects  force stand-in views
 *   graph=<id>        graph to show when the graphs panel is open (pop, rci, funds, cash, ...)
 * Sets window.__ready once done; window.__scene is the CityScene.
 */
import { CityScene } from '../game/CityScene';
import { defaultCityConfig } from '../sim/config';
import { createCityState } from '../sim/terrainGen';
import type { CityState } from '../sim/CityState';
import { BF } from '../sim/CityState';
import { CELL_SIZE } from '../core/constants';
import { DevType, Network, Overlay, Zone } from '../core/types';
import type { Difficulty, TerrainPreset } from '../core/types';
import { ploppables, getDef } from '../sim/catalog';
import { OVERLAYS } from './overlays';
import { Toasts } from './Notifications';
import * as THREE from 'three';

const P = new URLSearchParams(location.search);
const num = (k: string, d: number) => (P.has(k) ? Number(P.get(k)) : d);
const size = num('size', 128);
const difficulty = (P.get('difficulty') ?? 'medium') as Difficulty;
const cfg = defaultCityConfig({
  size,
  seed: num('seed', 4242),
  name: P.get('name') ?? 'Riverton',
  mayor: P.get('mayor') ?? 'Avery',
  terrain: (P.get('terrain') ?? 'plains') as TerrainPreset,
  hilliness: num('hills', 0.3),
  waterAmount: num('water', 0.18),
  difficulty,
  disasters: P.get('disasters') !== '0',
});
const state = createCityState(cfg);
const fake = P.get('fake') === '1';
const container = document.getElementById('app')!;

const ALIASES: Record<string, string> = {
  street: 'net:1', road: 'net:2', avenue: 'net:3', oneway: 'net:4', highway: 'net:5', rail: 'net:6', power: 'power', subway: 'subway',
  res: 'zone:1', resmed: 'zone:2', reshigh: 'zone:3', com: 'zone:4', commed: 'zone:5', comhigh: 'zone:6', farm: 'zone:7', ind: 'zone:8', indhigh: 'zone:9',
  landfill: 'zone:10', dezone: 'dezone', bulldoze: 'bulldoze', query: 'query', raise: 'terra:raise', lower: 'terra:lower', level: 'terra:level', smooth: 'terra:smooth', trees: 'trees',
};

const scene = new CityScene({
  container,
  state,
  onExitToRegion: (thumb) => {
    console.log('[demo] exit to region', thumb ? `${thumb.length} bytes thumbnail` : 'no thumbnail');
    const img = document.createElement('img');
    if (thumb) img.src = thumb;
    img.style.cssText = 'position:fixed;inset:0;margin:auto;max-width:60vw;border-radius:12px;box-shadow:0 20px 60px #000;z-index:9999';
    document.body.appendChild(img);
  },
  onSave: async (s) => {
    await new Promise((r) => setTimeout(r, 400));
    console.log('[demo] save', s.config.name, 'day', s.day);
  },
  forceFallback: (P.get('fallback') as 'all' | 'world' | 'objects' | null) ?? undefined,
  settings: { quality: (P.get('quality') as 'low' | 'medium' | 'high' | 'ultra' | null) ?? (navigator.webdriver ? 'low' : 'high'), autosaveMonths: 0 },
  initialSpeed: P.has('speed') ? num('speed', 1) : fake ? 0 : 1,
});
(window as any).__scene = scene;
// headless screenshots render slowly: keep toasts on screen long enough to be captured
if (navigator.webdriver) Toasts.ttlScale = 20;
scene.start();
// audio needs a user gesture; the meta layer normally does this once at startup
import('../audio').then((m: any) => m.audio?.attachAutoInit?.()).catch(() => {});

// ------------------------------------------------------------------------------------------------ town builder
function flatSpot(st: CityState, w: number, d: number): { x: number; z: number } {
  const N = st.size;
  let best = { x: (N - w) >> 1, z: (N - d) >> 1 }, bestScore = Infinity;
  for (let z = 4; z + d < N - 4; z += 4)
    for (let x = 4; x + w < N - 4; x += 4) {
      let water = 0, mn = Infinity, mx = -Infinity;
      for (let zz = z; zz < z + d; zz += 2)
        for (let xx = x; xx < x + w; xx += 2) {
          if (st.water[zz * N + xx]) water++;
          const hh = st.cellHeight(xx, zz);
          mn = Math.min(mn, hh);
          mx = Math.max(mx, hh);
        }
      const dc = Math.hypot(x + w / 2 - N / 2, z + d / 2 - N / 2);
      const score = water * 100 + (mx - mn) * 3 + dc * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
  return best;
}

function buildTown(): { cx: number; cz: number } {
  const a = scene.actions;
  const st = scene.sim.state;
  const funds = st.funds;
  st.funds = 1e9;
  const W = 44, D = 34;
  const o = flatSpot(st, W + 16, D);
  const x0 = o.x, z0 = o.z;
  const line = (ax: number, az: number, bx: number, bz: number, t: Network) => a.buildNetwork(lpath(ax, az, bx, bz), t);
  // avenue spine + road grid + streets
  line(x0, z0 + 16, x0 + W, z0 + 16, Network.Avenue);
  for (let x = x0; x <= x0 + W; x += 9) line(x, z0, x, z0 + D, Network.Road);
  for (const z of [z0, z0 + 8, z0 + 24, z0 + D]) line(x0, z, x0 + W, z, Network.Street);
  // zones
  const zone = (xa: number, za: number, xb: number, zb: number, zn: Zone) => a.zone({ x0: xa, z0: za, x1: xb, z1: zb }, zn);
  for (let bx = 0; bx < 5; bx++) {
    const xa = x0 + bx * 9 + 1, xb = xa + 8;
    if (bx <= 2) {
      zone(xa, z0 + 1, xb, z0 + 8, Zone.ResLow);
      zone(xa, z0 + 9, xb, z0 + 16, Zone.ResMed);
    } else {
      zone(xa, z0 + 1, xb, z0 + 8, Zone.ResLow);
      zone(xa, z0 + 9, xb, z0 + 16, Zone.ComMed);
    }
    if (bx <= 1) zone(xa, z0 + 17, xb, z0 + 24, Zone.ComLow);
    else zone(xa, z0 + 17, xb, z0 + 24, Zone.ComMed);
    zone(xa, z0 + 25, xb, z0 + D, bx >= 3 ? Zone.IndMed : Zone.ResLow);
  }
  // industry + farms east of the grid
  line(x0 + W, z0 + 16, x0 + W + 14, z0 + 16, Network.Road);
  zone(x0 + W + 1, z0 + 17, x0 + W + 14, z0 + 26, Zone.IndMed);
  zone(x0 + W + 1, z0 + 6, x0 + W + 14, z0 + 16, Zone.IndAg);
  // civic plops
  const plopNear = (defId: string, nx: number, nz: number, allowWarnings = false) => {
    const def = getDef(defId);
    if (!def) return null;
    for (let r = 0; r < 12; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          for (const rot of [0, 1, 2, 3] as const) {
            const p = a.plop(defId, nx + dx, nz + dz, rot, true);
            if (p.ok && (allowWarnings || !p.reason)) {
              a.plop(defId, nx + dx, nz + dz, rot, false);
              return st.buildingAt(nx + dx, nz + dz) ?? null;
            }
          }
        }
    return null;
  };
  const pick = (cat: Parameters<typeof ploppables>[0], re?: RegExp) => {
    const list = ploppables(cat).filter((d) => !d.requires && (!re || re.test(d.id)));
    return list[0]?.id;
  };
  const power = pick('power', /coal|gas|oil/) ?? pick('power');
  // power plant east of the industry, fed into the road grid (roads conduct power) by a short power line
  const pwX = x0 + W + 22, pwZ = z0 + 14;
  const plant = power ? plopNear(power, pwX, pwZ, true) : null;
  if (plant) {
    // road from the industrial spur to the plant's west side (plant cells + roads form one conductor component)
    const zc = Math.max(plant.z, Math.min(plant.z + plant.d - 1, z0 + 16));
    a.buildNetwork(lpath(x0 + W + 14, z0 + 16, plant.x - 1, z0 + 16), Network.Road);
    if (zc !== z0 + 16) a.buildNetwork(lpath(plant.x - 1, z0 + 16, plant.x - 1, zc), Network.Road);
    // and a power line along the north edge of the farms (visual + redundancy)
    a.buildPowerLine(lpath(plant.x - 1, plant.z - 1, x0 + W + 1, plant.z - 1));
  }
  console.log('[demo] power plant', plant ? `${plant.def} at ${plant.x},${plant.z}` : 'not placed');
  const water = pick('water', /tower/) ?? pick('water');
  if (water) plopNear(water, x0 + 2, z0 + 11);
  const police = pick('police');
  if (police) plopNear(police, x0 + 21, z0 + 19);
  const fire = pick('fire');
  if (fire) plopNear(fire, x0 + 30, z0 + 3);
  const clinic = pick('health');
  if (clinic) plopNear(clinic, x0 + 12, z0 + 3);
  const school = pick('education');
  if (school) plopNear(school, x0 + 3, z0 + 27);
  const park = pick('park');
  if (park) {
    plopNear(park, x0 + 14, z0 + 11);
    plopNear(park, x0 + 24, z0 + 28);
  }
  st.funds = Math.min(funds, 60000) + Math.max(0, funds - 60000) * 0.4;
  return { cx: x0 + W / 2, cz: z0 + D / 2 };
}

function lpath(ax: number, az: number, bx: number, bz: number) {
  const out: { x: number; z: number }[] = [{ x: ax, z: az }];
  let x = ax, z = az;
  while (x !== bx) {
    x += Math.sign(bx - x);
    out.push({ x, z });
  }
  while (z !== bz) {
    z += Math.sign(bz - z);
    out.push({ x, z });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ fake data (UI shots)
function fakeData(): void {
  const st = scene.sim.state;
  const s = st.stats;
  const months = 96;
  const H = st.history;
  for (const k of Object.keys(H) as (keyof typeof H)[]) (H[k] as number[]).length = 0;
  let pop = 400, funds = 100000;
  for (let m = 0; m < months; m++) {
    const t = m / months;
    pop = Math.round(400 + 38000 * t * t + Math.sin(m * 0.7) * 300 * t);
    const inc = 2500 + pop * 0.62 + Math.sin(m) * 400;
    const exp = 2200 + pop * 0.55 + Math.cos(m * 1.3) * 500 + (m > 60 ? 1800 : 0);
    funds += inc - exp;
    H.t.push(m);
    H.pop.push(pop);
    H.funds.push(Math.round(funds));
    H.income.push(Math.round(inc));
    H.expense.push(Math.round(exp));
    H.r.push(Math.round(pop));
    H.c.push(Math.round(pop * 0.32));
    H.i.push(Math.round(pop * 0.22 + 400 * Math.sin(t * 3)));
    H.landValue.push(0.25 + t * 0.3);
    H.crime.push(0.12 + 0.1 * Math.sin(t * 5) ** 2);
    H.pollution.push(0.1 + t * 0.25);
    H.traffic.push(0.15 + t * 0.45);
    H.eq.push(60 + t * 45);
    H.hq.push(70 + t * 30);
    H.approval.push(55 + 20 * Math.sin(t * 4));
  }
  st.day = months * 30 + 12;
  st.funds = Math.round(funds);
  s.population = pop;
  s.residents = [Math.round(pop * 0.46), Math.round(pop * 0.38), Math.round(pop * 0.16)];
  s.jobCapByDev = [0, 0, 0, 2400, 3100, 900, 2600, 1200, 400, 2200, 3100, 900];
  s.jobsByDev = s.jobCapByDev.map((c) => Math.round(c * 0.86));
  s.workforce = Math.round(pop * 0.52);
  s.employed = Math.round(s.workforce * 0.93);
  s.unemployment = 0.07;
  s.demand = [0.62, 0.35, -0.12, 0.45, 0.2, -0.3, 0.55, 0.1, -0.4, 0.15, 0.48, 0.3];
  s.demandCap = [40000, 20000, 18000, 3000, 3200, 1000, 2700, 5000, 2000, 5000, 6000, 3000];
  s.powerSupply = 1200;
  s.powerDemand = 980;
  s.waterSupply = 900;
  s.waterDemand = 940;
  s.garbageProduced = 610;
  s.garbageCapacity = 800;
  s.eq = 104;
  s.hq = 96;
  s.avgLandValue = 0.54;
  s.avgCrime = 0.18;
  s.avgPollution = 0.29;
  s.avgTraffic = 0.58;
  s.avgCommute = 27;
  s.approval = 68;
  s.tripsCar = 21000;
  s.tripsTransit = 6400;
  s.tripsWalk = 3100;
  s.buildingCount = st.buildings.size || 1240;
  const b = st.budget;
  b.taxRates = [9, 9, 8, 10, 10, 9, 11, 11, 7, 9, 9, 8];
  b.lastIncome = { 'tax:R$': 4200, 'tax:R$$': 5100, 'tax:R$$$': 2300, 'tax:CS$': 1100, 'tax:CS$$': 1900, 'tax:CS$$$': 700, 'tax:CO$$': 2400, 'tax:CO$$$': 1300, 'tax:I-Ag': 300, 'tax:I-D': 1400, 'tax:I-M': 2100, 'tax:I-HT': 900, 'deal:rw_casino': 1500, 'neighbor:water': 400 };
  b.lastExpense = { 'service:police': 3100, 'service:fire': 2600, 'service:health': 2900, 'service:education': 4200, 'service:transit': 1500, 'service:parks': 800, 'service:utilities': 2700, 'transport:roads': 2400, 'ordinance:recycling': 450, loan: 1200 };
  b.loans = [{ principal: 50000, remaining: 31200, rate: 0.065, monthlyPayment: 1200, monthsLeft: 28 }];
  const N = st.size;
  const news: [string, string, number?, number?, string?][] = [
    ['Riverton celebrates 30,000 residents!', 'good'],
    ['Traffic jams reported on the main avenue during rush hour.', 'warning', N / 2, N / 2, 'Transportation'],
    ['Power demand is approaching plant capacity.', 'advisor', undefined, undefined, 'Utilities'],
    ['A fire broke out downtown — firefighters are on the scene.', 'disaster', N / 2 + 4, N / 2 - 3],
    ['New reward unlocked: Mayor’s House', 'reward'],
    ['Crime is up in the industrial district.', 'bad', N / 2 + 10, N / 2 + 6, 'Public safety'],
    ['Local farmers report a record harvest.', 'info'],
  ];
  st.news.length = 0;
  news.forEach(([text, kind, x, z, adv], i) => st.news.push({ day: st.day - (news.length - i) * 9, text, kind: kind as any, x, z, advisor: adv }));
  // zone + place fake growables around the center for the fallback view / minimap
  void DevType;
}

// ------------------------------------------------------------------------------------------------ pointer simulation
function cellToClient(x: number, z: number): { cx: number; cy: number } | null {
  const w = scene.worldView;
  const cam = w.camera as THREE.PerspectiveCamera;
  if (!cam?.isPerspectiveCamera) return null;
  const st = scene.sim.state;
  const wx = x * CELL_SIZE + CELL_SIZE / 2, wz = z * CELL_SIZE + CELL_SIZE / 2;
  const v = new THREE.Vector3(wx, st.heightAt(wx, wz), wz).project(cam);
  const canvas = container.querySelector('canvas.mp-canvas') as HTMLCanvasElement;
  const r = canvas.getBoundingClientRect();
  return { cx: r.left + ((v.x + 1) / 2) * r.width, cy: r.top + ((1 - v.y) / 2) * r.height };
}

function pointer(type: string, x: number, z: number, buttons = 0): void {
  const p = cellToClient(x, z);
  const canvas = container.querySelector('canvas.mp-canvas') as HTMLCanvasElement;
  if (!p || !canvas) return;
  canvas.dispatchEvent(new PointerEvent(type, { clientX: p.cx, clientY: p.cy, button: type === 'pointermove' ? -1 : 0, buttons, pointerId: 1, bubbles: true, isPrimary: true, pointerType: 'mouse' }));
}

const frames = (n: number) => new Promise<void>((res) => {
  let k = 0;
  const f = () => (++k >= n ? res() : requestAnimationFrame(f));
  requestAnimationFrame(f);
});

const OVERLAY_ALIASES: Record<string, Overlay> = Object.fromEntries(OVERLAYS.map((o) => [o.label.toLowerCase().replace(/\s+/g, ''), o.o]));

async function run(): Promise<void> {
  await new Promise<void>((res) => scene.ctx.ui.on('viewsReady', () => res()));
  console.log('[demo] views ready', Math.round(performance.now()));
  let center = { cx: size / 2, cz: size / 2 };
  if (P.get('town') === '1') {
    try {
      const t0 = performance.now();
      center = buildTown();
      console.log(`[demo] town built in ${Math.round(performance.now() - t0)} ms, buildings ${scene.sim.state.buildings.size}`);
    } catch (e) {
      console.error('[demo] town builder failed', e);
    }
  }
  const days = num('days', 0);
  if (days > 0) {
    const t0 = performance.now();
    try {
      scene.sim.runDays(days);
    } catch (e) {
      console.error('[demo] runDays failed', e);
    }
    console.log(`[demo] ran ${days} days in ${Math.round(performance.now() - t0)} ms; pop ${scene.sim.state.stats.population}, buildings ${scene.sim.state.buildings.size}`);
  }
  if (fake) fakeData();
  const cam = P.get('cam')?.split(',').map(Number);
  if (cam && cam.length >= 2) scene.ctx.focusCell(cam[0], cam[1], cam[2]);
  else if (P.get('town') === '1') scene.ctx.focusCell(center.cx, center.cz, 700);
  (window as any).__step = "f20"; await frames(num("f1", 3)); (window as any).__step = "after-f20";
  const ov = P.get('overlay');
  if (ov) scene.ctx.setOverlay(OVERLAY_ALIASES[ov.toLowerCase()] ?? (Number(ov) as Overlay));
  const tool = P.get('tool');
  if (tool) scene.selectTool(ALIASES[tool] ?? tool);
  for (const p of (P.get('panel') ?? '').split(',').filter(Boolean)) scene.openPanel(p);
  const graph = P.get('graph');
  if (graph) {
    const gp = (scene as any).panels?.get?.('graphs');
    const g = (await import('./panels/GraphsPanel')).GRAPHS.find((x) => x.id === graph);
    if (gp && g) {
      gp.cur = g;
      gp.draw();
    }
  }
  if (P.get('fly')) scene.openFlyout(P.get('fly')!);
  if (P.get('rci') === '1') (document.querySelector('.rci-seg') as HTMLElement)?.click();
  if (P.get('toasts') === '1') {
    scene.ctx.toast('Power shortage! Build another power plant.', 'bad', { x: center.cx, z: center.cz });
    scene.ctx.toast('New reward unlocked: Mayor’s House', 'reward');
    scene.ctx.toast('Your city reached 10,000 residents!', 'good');
  }
  const coords = (k: string) => { const v = P.get(k)?.split(',').map(Number); if (v && P.get('rel') === '1') return v.map((n, i) => n + Math.round(i % 2 ? center.cz : center.cx)); return v; };
  const q = coords('query');
  if (q && q.length >= 2) {
    const b = scene.sim.state.buildingAt(q[0], q[1]);
    scene.ctx.showQuery({ buildingId: b?.id ?? null, x: q[0], z: q[1] });
  }
  (window as any).__step = "f10"; await frames(2); (window as any).__step = "after-f10";
  const hov = coords('hover');
  if (hov && hov.length >= 2) {
    pointer('pointermove', hov[0], hov[1]);
    await frames(2);
  }
  const click = coords('click');
  if (click && click.length >= 2) {
    pointer('pointermove', click[0], click[1]);
    await frames(2);
    pointer('pointerdown', click[0], click[1], 1);
    await frames(2);
    pointer('pointerup', click[0], click[1], 0);
    await frames(2);
  }
  const drag = coords('drag');
  if (drag && drag.length >= 4) {
    pointer('pointermove', drag[0], drag[1]);
    await frames(2);
    pointer('pointerdown', drag[0], drag[1], 1);
    await frames(2);
    pointer('pointermove', drag[2], drag[3], 1);
    await frames(2);
  }
  if (P.get('pause') === '1') scene.ctx.openPauseMenu();
  (window as any).__step = "final"; await frames(num("frames", 3));
  (window as any).__ready = true;
  console.log('[demo] ready', JSON.stringify({ degraded: scene.ctx.degraded, errors: scene.modules.errors, catalog: ploppables().length, buildings: scene.sim.state.buildings.size, flagsAbandoned: BF.Abandoned }));
}
run().catch((e) => {
  console.error('[demo] failed', e);
  (window as any).__ready = true;
});
