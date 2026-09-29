/**
 * Desirability / land-value bands bound to the live tuning + catalog modules, and system shells that run them.
 *
 *   econBandsJs     the restructured JS bands (src/wasm/js/desirabilityLandValueBands.ts: the fair A/B baseline)
 *   econBandsWasm   the WebAssembly kernels (desirabilityLandValueBandsBind.ts) falling back to econBandsJs
 *   landValueSystemWith(rt, bands) / desirabilitySystemWith(rt, bands)
 *                   landValueSystem / desirabilitySystem of commit 24f8609 with the band as a parameter (the band is a
 *                   closure inside the original systems, so it cannot be patched from outside)
 *   installEconBands(systems, bands)
 *                   replaces both systems of a createSystems() list in place, sharing the list's EconRuntime; call it
 *                   BEFORE the Simulation is constructed (init runs the first full-map pass)
 *
 *   const systems = createSystems();
 *   installEconBands(systems, econBandsWasm);
 *   const sim = new Simulation(state, systems);
 *
 * The shells (and the rarely-run helpers they need: freight access, static land value, the splats) are FROZEN copies
 * of desirability.ts / landValue.ts at 24f8609 — the version the kernels were ported from (WP6a is rewriting both
 * files). With the 24f8609 files live, a city simulated with installEconBands(…) is bit-identical to one simulated with
 * the original systems (tests/wasm/desirabilityLandValueBands.test.ts). Integration after WP6a lands: re-port its term
 * list / formula, then call the bands from the live systems instead of these shells.
 */
import type { SimSystem } from '../../sim/Simulation';
import type { Building, CityState } from '../../sim/CityState';
import type { EconRuntime } from '../../sim/economy/runtime';
import { infraFlags } from '../../sim/economy/runtime';
import { ordinanceEffect } from '../../sim/economy/ordinances';
import { ZONE_DEVTYPES, devFamily, getDef } from '../../sim/catalog';
import { DEV_TYPE_COUNT, Network, Zone } from '../../core/types';
import { smoothstep } from '../../core/rng';
import {
  COARSE, COMMUTE_BAD, COMMUTE_FALLBACK, COMMUTE_GOOD, COVERAGE_FALLBACK, DESIR_ALL_SWEEPS, DESIR_REFRESH_DAYS, DESIR_TAX,
  DESIR_WEIGHTS, FREIGHT_BLOCKS, LV, LV_EFFECTS_MIN_DAYS, LV_REFRESH_DAYS, LV_STATIC_MIN_DAYS, POP_NEAR_FULL, SLOPE_P0, SLOPE_P1,
  TAX_NEUTRAL, TAX_SENS, TRAFFIC_BUSY,
} from '../../sim/economy/tuning';
import { buildEconBandTables, makeEconBandsJs, type EconBandConstants, type EconBandFns } from '../js/desirabilityLandValueBands';
import { makeEconBandKernels } from './desirabilityLandValueBandsBind';

export { ECON_KERNEL, makeEconBandKernels, type EconBindStats, type EconWasm } from './desirabilityLandValueBandsBind';

/** the constants of the 24f8609 bands (NET_NOISE / NET_TRAFFIC are module-private in desirability.ts: copied) */
export const ECON_CONSTANTS: EconBandConstants = {
  DEV_TYPE_COUNT,
  DESIR_WEIGHTS,
  ZONE_DEVTYPES,
  zoneNone: Zone.None,
  zoneLandfill: Zone.Landfill,
  NET_NOISE: [0, 0.03, 0.08, 0.2, 0.1, 0.45, 0.2],
  NET_TRAFFIC: [0, 0.2, 0.45, 0.65, 0.45, 0, 0],
  chkA: 0,
  chkB: 11,
  COARSE, COMMUTE_GOOD, COMMUTE_BAD, COMMUTE_FALLBACK, COVERAGE_FALLBACK, TRAFFIC_BUSY, POP_NEAR_FULL, SLOPE_P0, SLOPE_P1,
  LV_EFFECT_MIN: -0.7,
  LV_EFFECT_MAX: 0.6,
  LV,
};

export const ECON_TABLES = buildEconBandTables(ECON_CONSTANTS);
/** restructured JS bands (fair baseline / fallback) */
export const econBandsJs: EconBandFns = makeEconBandsJs(ECON_TABLES);
/** WebAssembly bands (JS fallback: econBandsJs) */
export const econBandsWasm: EconBandFns = makeEconBandKernels(ECON_TABLES, econBandsJs);

// ------------------------------------------------------------------------------------------------ frozen helpers
// desirability.ts / landValue.ts @ 24f8609, verbatim (module-private or exported there; copied so these shells do not
// depend on the files WP6a rewrites)

function computeFreightAccess(st: CityState, rt: EconRuntime): void {
  const N = st.size, cw = rt.cw;
  const dist = new Int16Array(cw * cw).fill(-1);
  const queue: number[] = [];
  const mark = (x: number, z: number) => {
    const b = ((z / COARSE) | 0) * cw + ((x / COARSE) | 0);
    if (dist[b] !== 0) { dist[b] = 0; queue.push(b); }
  };
  for (let i = 0; i < st.cells; i++) {
    const n = st.network[i];
    if (n === Network.Highway || n === Network.Rail) mark(i % N, (i / N) | 0);
  }
  for (const c of st.neighborConnections) mark(c.x, c.z);
  for (const b of rt.plopped) if (b.def === 'tr_freight_station' || b.def === 'tr_seaport' || b.def === 'tr_airport_large' || b.def === 'tr_airport_small') mark(b.x, b.z);
  let h = 0;
  while (h < queue.length) {
    const b = queue[h++];
    const bx = b % cw, bz = (b / cw) | 0;
    const d = dist[b] + 1;
    if (d > FREIGHT_BLOCKS) continue;
    if (bx > 0 && dist[b - 1] < 0) { dist[b - 1] = d; queue.push(b - 1); }
    if (bx < cw - 1 && dist[b + 1] < 0) { dist[b + 1] = d; queue.push(b + 1); }
    if (bz > 0 && dist[b - cw] < 0) { dist[b - cw] = d; queue.push(b - cw); }
    if (bz < cw - 1 && dist[b + cw] < 0) { dist[b + cw] = d; queue.push(b + cw); }
  }
  // road-only cities still get some freight access by road
  const base = st.neighborConnections.length ? 0.25 : 0.1;
  for (let b = 0; b < cw * cw; b++) rt.coarseFreight[b] = dist[b] < 0 ? base : Math.max(base, 1 - dist[b] / (FREIGHT_BLOCKS + 1));
}

/** static terrain component: waterfront + view/elevation */
function computeStaticLandValue(st: CityState, out: Float32Array): void {
  const N = st.size;
  // chamfer distance to water (cells)
  const INF = 255;
  const dist = new Uint8Array(st.cells).fill(INF);
  for (let i = 0; i < st.cells; i++) if (st.water[i]) dist[i] = 0;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      let d = dist[i];
      if (x > 0 && dist[i - 1] + 1 < d) d = dist[i - 1] + 1;
      if (z > 0 && dist[i - N] + 1 < d) d = dist[i - N] + 1;
      dist[i] = d;
    }
  }
  for (let z = N - 1; z >= 0; z--) {
    for (let x = N - 1; x >= 0; x--) {
      const i = z * N + x;
      let d = dist[i];
      if (x < N - 1 && dist[i + 1] + 1 < d) d = dist[i + 1] + 1;
      if (z < N - 1 && dist[i + N] + 1 < d) d = dist[i + N] + 1;
      dist[i] = d;
    }
  }
  // coarse mean heights (for "view": elevation above surroundings)
  const cw = Math.ceil(N / COARSE);
  const sum = new Float32Array(cw * cw), cnt = new Float32Array(cw * cw);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) { const b = ((z / COARSE) | 0) * cw + ((x / COARSE) | 0); sum[b] += st.cellHeight(x, z); cnt[b]++; }
  const mean = new Float32Array(cw * cw);
  for (let bz = 0; bz < cw; bz++) {
    for (let bx = 0; bx < cw; bx++) {
      let s = 0, c = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const x = bx + dx, z = bz + dz;
        if (x < 0 || z < 0 || x >= cw || z >= cw) continue;
        const b = z * cw + x;
        s += sum[b]; c += cnt[b];
      }
      mean[bz * cw + bx] = c ? s / c : 0;
    }
  }
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (st.water[i]) { out[i] = 0; continue; }
      const h = st.cellHeight(x, z);
      const wf = dist[i] >= LV.waterDist ? 0 : LV.waterfront * (1 - dist[i] / LV.waterDist) ** 1.5;
      const rel = h - mean[((z / COARSE) | 0) * cw + ((x / COARSE) | 0)];
      const view = LV.view * smoothstep(LV.viewH0, LV.viewH1, rel) + 0.04 * smoothstep(10, 90, h);
      out[i] = wf + view;
    }
  }
}

function splat(st: CityState, out: Float32Array, cx: number, cz: number, amount: number, radius: number): void {
  const N = st.size;
  const r = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
  const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(N - 1, Math.ceil(cz + r));
  const r2 = radius * radius;
  for (let z = z0; z <= z1; z++) {
    const dz = z + 0.5 - cz;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r2) continue;
      out[z * N + x] += amount * (1 - Math.sqrt(d2) / radius);
    }
  }
}

/** add (sign 1) or remove (sign -1) the BuildingDef.landValue splat of a plopped building */
function splatBuilding(st: CityState, b: Building, sign: number, out: Float32Array): void {
  const lv = getDef(b.def)?.landValue;
  if (!lv) return;
  splat(st, out, b.x + b.w / 2, b.z + b.d / 2, sign * lv.amount, lv.radius + Math.max(b.w, b.d) / 2);
}

/** full rebuild of plopped-building land value effects (raw, unclamped) */
function computeLandValueEffects(st: CityState, rt: EconRuntime, out: Float32Array): void {
  out.fill(0);
  for (const b of rt.plopped) if (st.buildings.has(b.id)) splatBuilding(st, b, 1, out);
}

/** landfill zone land value (coarse 2×2 splats) */
function computeLandfillEffects(st: CityState, out: Float32Array): void {
  out.fill(0);
  const lf = getDef('util_landfill_tile')?.landValue;
  if (!lf) return;
  const N = st.size;
  for (let z = 0; z < N; z += 2) {
    for (let x = 0; x < N; x += 2) {
      let c = 0;
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) if (x + dx < N && z + dz < N && st.zone[(z + dz) * N + x + dx] === Zone.Landfill) c++;
      if (c) splat(st, out, x + 1, z + 1, (lf.amount * c) / 4, lf.radius);
    }
  }
}

// ------------------------------------------------------------------------------------------------ system shells
const DEV_ENUM = ['R1', 'R2', 'R3', 'CS1', 'CS2', 'CS3', 'CO2', 'CO3', 'IA', 'ID', 'IM', 'IHT'];

/** desirabilitySystem(rt) of 24f8609 with the band as a parameter */
export function desirabilitySystemWith(rt: EconRuntime, bands: EconBandFns): SimSystem {
  let row = 0;
  let sweep = 0;
  const shift = new Float32Array(DEV_TYPE_COUNT);
  const prepShift = (st: CityState) => {
    const rates = st.budget.taxRates;
    for (let d = 0; d < DEV_TYPE_COUNT; d++) {
      const fam = devFamily(d);
      shift[d] = -DESIR_TAX * TAX_SENS[d] * (rates[d] - TAX_NEUTRAL)
        + ordinanceEffect(st, 'add.desir.' + DEV_ENUM[d]) + ordinanceEffect(st, 'add.desir.' + fam);
    }
  };
  const band = (st: CityState, z0: number, z1: number, allCells: boolean) => bands.desirability(st, rt, infraFlags(st), shift, z0, z1, allCells);
  return {
    name: 'economy.desirability',
    init(sim) {
      rt.attach(sim);
      const st = sim.state;
      computeFreightAccess(st, rt);
      rt.networkDirty = false;
      prepShift(st);
      band(st, 0, st.size, true);
      row = 0;
      sweep = 0;
    },
    daily(sim) {
      const t0 = performance.now();
      const st = sim.state;
      if (rt.networkDirty) { computeFreightAccess(st, rt); rt.networkDirty = false; }
      if (row === 0) prepShift(st);
      const N = st.size;
      const rows = Math.ceil(N / DESIR_REFRESH_DAYS);
      const z1 = Math.min(N, row + rows);
      band(st, row, z1, sweep % DESIR_ALL_SWEEPS === 0);
      row = z1;
      if (row >= N) {
        row = 0;
        sweep++;
        sim.events.emit('layerUpdated', 'desirability');
      }
      rt.timing.desirability = performance.now() - t0;
    },
  };
}

/** landValueSystem(rt) of 24f8609 with the band as a parameter (accumulators in a Float64Array: sum, cnt, sumAll, cntAll) */
export function landValueSystemWith(rt: EconRuntime, bands: EconBandFns): SimSystem {
  let row = 0;
  const acc = new Float64Array(4);
  let lastStatic = -1e9, lastLandfill = -1e9;
  const refresh = (st: CityState, force: boolean) => {
    if (rt.terrainDirty && (force || st.day - lastStatic >= LV_STATIC_MIN_DAYS)) {
      computeStaticLandValue(st, rt.lvStatic);
      rt.terrainDirty = false;
      lastStatic = st.day;
    }
    if (rt.lvEffectsDirty || force) {
      computeLandValueEffects(st, rt, rt.lvEffects);
      rt.lvEffectsDirty = false;
      rt.lvQueue.length = 0;
    } else if (rt.lvQueue.length) {
      const q = rt.lvQueue;
      for (let k = 0; k < q.length; k += 2) splatBuilding(st, q[k] as Building, q[k + 1] as number, rt.lvEffects);
      q.length = 0;
    }
    if (rt.lvLandfillDirty && (force || st.day - lastLandfill >= LV_EFFECTS_MIN_DAYS)) {
      computeLandfillEffects(st, rt.lvLandfill);
      rt.lvLandfillDirty = false;
      lastLandfill = st.day;
    }
  };
  const band = (st: CityState, z0: number, z1: number, first: boolean) => bands.landValue(st, rt, infraFlags(st), z0, z1, first, acc);
  return {
    name: 'economy.landValue',
    init(sim) {
      rt.attach(sim);
      const st = sim.state;
      refresh(st, true);
      band(st, 0, st.size, true);
      row = 0;
      acc.fill(0);
    },
    daily(sim) {
      const t0 = performance.now();
      const st = sim.state;
      rt.attach(sim);
      refresh(st, false);
      const N = st.size;
      const rows = Math.ceil(N / LV_REFRESH_DAYS);
      const z1 = Math.min(N, row + rows);
      band(st, row, z1, false);
      row = z1;
      if (row >= N) {
        row = 0;
        const [sum, cnt, sumAll, cntAll] = acc;
        st.stats.avgLandValue = cnt > 0 ? sum / cnt : cntAll > 0 ? sumAll / cntAll : 0;
        acc.fill(0);
        sim.events.emit('layerUpdated', 'landValue');
      }
      rt.timing.landValue = performance.now() - t0;
    },
  };
}

/**
 * Replace 'economy.landValue' and 'economy.desirability' of a createSystems() / economySystems() list by the shells
 * running `bands` (same positions, same EconRuntime). Returns the runtime, or null when the list has no economy systems.
 */
export function installEconBands(systems: SimSystem[], bands: EconBandFns): EconRuntime | null {
  const rt = (systems.find((s) => s.name === 'economy.population') as unknown as { rt?: EconRuntime } | undefined)?.rt;
  if (!rt) return null;
  const lv = systems.findIndex((s) => s.name === 'economy.landValue');
  const de = systems.findIndex((s) => s.name === 'economy.desirability');
  if (lv < 0 || de < 0) return null;
  systems[lv] = landValueSystemWith(rt, bands);
  systems[de] = desirabilitySystemWith(rt, bands);
  return rt;
}
