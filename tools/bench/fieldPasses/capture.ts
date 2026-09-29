/**
 * Node side of the field-pass captures: load a .metropolis fixture (optionally with a synthetic water body: the
 * profiler's 1M fixtures have none), simulate `warm` days (headless, all systems), then record the inputs of the field
 * kernels of one NIMBY rebuild and one pollution pass (see core.ts). The recording runs the pass through
 * installFieldPasses() with a kernel wrapper that copies every argument before calling the fair JS kernels; the NIMBY
 * splat list is recorded by a NimbySources that logs the walk's splatAdd calls. The genuine rebuildNimby's outputs and
 * cost estimate are stored as the reference. Bundled with plugins.mjs's tree redirect (the frozen 24f8609 sim unless
 * the live tree is requested).
 */
import { readFileSync } from 'node:fs';
import { deserializeCity, type SerializedCity } from '../../../src/save/serialize';
import { unpackFile } from '../../../src/save/bundle';
import { Simulation } from '../../../src/sim/Simulation';
import type { CityState } from '../../../src/sim/CityState';
import { createSystems } from '../../../src/sim/systems/index';
import { defaultCityConfig } from '../../../src/sim/config';
import { createCityState } from '../../../src/sim/terrainGen';
import { getDef } from '../../../src/sim/catalog';
import { readEffects, buildingList } from '../../../src/sim/infra/common';
import { POLL_PERIOD, type PollutionSystem } from '../../../src/sim/infra/pollution';
import { nimbyCost, rebuildNimby } from '../../../src/sim/infra/nimby';
import {
  AIR_K, BANK_COUPLING, LANDFILL_AIR, LANDFILL_IDLE_EMIT, LANDFILL_SIZE_REF, NIMBY_HIGHWAY, NIMBY_HIGHWAY_BRIDGE, NIMBY_LANDFILL_IDLE,
  NIMBY_RAIL, POLL_PEAK_GAIN, SOIL_DECAY, SOIL_RATE, SOIL_SRC_LANDFILL, WATER_K, NOISE_K,
} from '../../../src/sim/infra/params';
import { NimbySources, fieldKernelsJs, intensityToSource, type CellsArgs, type FieldKernels, type NimbyTables, type WaterArgs } from '../../../src/wasm/js/fieldPasses';
import { installFieldPasses, makeNimby } from '../../../src/wasm/kernels/fieldPasses';
import type { CaptureMeta, FieldCapture, TA } from './core';

export async function loadFixture(file: string): Promise<CityState> {
  const bytes = new Uint8Array(readFileSync(file));
  return deserializeCity((await unpackFile(bytes)) as SerializedCity);
}

/**
 * Synthetic water for fixtures without any: the water mask of the 'coast' terrain preset (sea + river mouth) of the same
 * size, applied to the cells of `st` that have no network and no building (so the city stays consistent). Returns the
 * number of water cells added.
 */
export function overlayWater(st: CityState, preset: 'coast' | 'river' = 'coast', seed = 7): number {
  const t = createCityState(defaultCityConfig({ size: st.size, seed, terrain: preset, waterAmount: 0.45, treeDensity: 0 }));
  let n = 0;
  for (let i = 0; i < st.cells; i++) {
    if (t.water[i] && !st.water[i] && st.network[i] === 0 && st.building[i] < 0) {
      st.water[i] = 1;
      st.zone[i] = 0;
      n++;
    }
  }
  return n;
}

/** the pollution system's private fields read by the capture (pollution.ts @24f8609) */
interface PolPriv {
  lastRun: number;
  usedCls: Uint8Array;
  nReg: number;
  regCap: number[];
  regUsed: number[];
  dtMonthsB: number;
  fxB: { air: number; water: number } | null;
  fx3B: { soilDecay: number } | null;
}

const copy = <T extends TA>(a: T): T => a.slice() as T;

export async function captureFixture(file: string, warm: number, water = ''): Promise<FieldCapture> {
  const st0 = await loadFixture(file);
  const added = water ? overlayWater(st0, water === 'river' ? 'river' : 'coast') : 0;
  const sim = new Simulation(st0, createSystems());
  for (let d = 0; d < warm; d++) sim.advanceDay();
  const st = sim.state;
  const N = st.size;
  const arrays: Record<string, TA> = {};

  // ---------------------------------------------------------------------------------------------- NIMBY
  const splats: number[] = [];
  class RecSources extends NimbySources {
    override add(bx: number, bz: number, bw: number, bd: number, amount: number, R: number, target: number): number {
      splats.push(bx, bz, bw, bd, amount, R, target);
      return super.add(bx, bz, bw, bd, amount, R, target);
    }
  }
  const lfDef = getDef('util_landfill_tile');
  arrays['nimby.zone'] = copy(st.zone);
  arrays['nimby.fill'] = copy(st.landfillFill);
  arrays['nimby.net'] = copy(st.network);
  arrays['nimby.flags'] = copy(st.netFlags);
  // the genuine rebuild (reference), then the recording one (fair JS) must agree
  rebuildNimby(sim);
  const cost = nimbyCost(sim);
  const S = copy(st.stigma), P = copy(st.prestige), K = copy(st.campus);
  const rec = makeNimby(fieldKernelsJs, { sources: (t: NimbyTables) => new RecSources(t) });
  rec.rebuildNimby(sim);
  for (const [a, b, name] of [[S, st.stigma, 'stigma'], [P, st.prestige, 'prestige'], [K, st.campus, 'campus']] as const) {
    const ua = new Uint32Array(a.buffer), ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) throw new Error(`capture: fair JS NIMBY ${name} differs from nimby.ts at cell ${i}`);
  }
  if (rec.nimbyCost(sim) !== cost) throw new Error(`capture: NIMBY cost estimate ${rec.nimbyCost(sim)} != nimby.ts ${cost}`);
  arrays['nimby.splats'] = Float64Array.from(splats);
  arrays['nimby.S'] = new Float32Array(st.cells);
  arrays['nimby.P'] = new Float32Array(st.cells);
  arrays['nimby.K'] = new Float32Array(st.cells);
  arrays['nimby.expS'] = S;
  arrays['nimby.expP'] = P;
  arrays['nimby.expK'] = K;
  const nb = buildingList(st).length;
  const touches = Math.round((cost - (0.3 + 0.9 * (st.cells / 65536) + 0.45 * (nb / 20000))) / 6e-6);

  // ---------------------------------------------------------------------------------------------- pollution pass
  const pol = sim.getSystem('pollution') as unknown as PollutionSystem;
  const pp = pol as unknown as PolPriv;
  pp.lastRun = st.day - POLL_PERIOD; // a regular pass (dt = 12 / 30 months: the soil loop runs)
  let cellsMeta: CaptureMeta['cells'] | null = null;
  const sats: { field: Float32Array; L: Float32Array; buf1: Float32Array | null; buf2: Float32Array | null; invK: number; alpha: number; k1: number; k2: number }[] = [];
  let waterMeta: CaptureMeta['water'] | null = null;
  let soilMeta: CaptureMeta['soil'] | null = null;
  const recK: FieldKernels = {
    kind: 'capture',
    nimby: fieldKernelsJs.nimby,
    cells(p: CellsArgs) {
      const fx = pp.fxB ?? readEffects(st);
      const airK = AIR_K / POLL_PEAK_GAIN, waterK = WATER_K / POLL_PEAK_GAIN, noiseK = NOISE_K / POLL_PEAK_GAIN;
      const lf = getDef('util_landfill_tile')?.pollution;
      for (const k of ['garbage', 'building', 'soil', 'network', 'traffic', 'congestion', 'netFlags', 'A0', 'W0', 'N0', 'soilSrc', 'lfOrder'] as const) arrays['cells.' + k] = copy(p[k]);
      const fr = p.freight && p.freight.length > 0 ? Int32Array.from(p.freight) : null;
      arrays['cells.freight'] = fr ?? new Int32Array(0);
      cellsMeta = {
        smell: p.smell, waterK: p.waterK, soilGW: p.soilGW, trafficAir: p.trafficAir, tunnelAir: p.tunnelAir, congDamp: p.congDamp,
        crossing: p.crossing, noisePerTrip: p.noisePerTrip, tunnelNoise: p.tunnelNoise, bridgeNoise: p.bridgeNoise, tn: p.tn, freightS: p.freightS,
        perTrip: Array.from(p.perTrip), base: Array.from(p.base), highway: p.highway, rail: p.rail, nReg: p.nReg,
        regStart: Array.from(p.regStart).slice(0, p.nReg), regCount: Array.from(p.regCount).slice(0, p.nReg),
        regCap: pp.regCap.slice(0, p.nReg), regUsed: pp.regUsed.slice(0, p.nReg),
        lfAir: lf ? intensityToSource(lf.air ?? 0, airK) * fx.air : LANDFILL_AIR,
        lfWater: lf ? intensityToSource(lf.water ?? 0, waterK) * fx.water : 0,
        lfNoise: lf ? intensityToSource(lf.noise ?? 0, noiseK) : 0,
        LANDFILL_IDLE_EMIT, LANDFILL_SIZE_REF, SOIL_SRC_LANDFILL, hasFreight: fr !== null, used: Array.from(pp.usedCls),
      };
      return fieldKernelsJs.cells(p);
    },
    saturate(field, L, C, invK, alpha, mask, buf1 = null, k1 = 0, buf2 = null, k2 = 0) {
      sats.push({ field: copy(field), L: copy(L), buf1: buf1 ? copy(buf1) : null, buf2: buf2 ? copy(buf2) : null, invK, alpha, k1, k2 });
      fieldKernelsJs.saturate(field, L, C, invK, alpha, mask, buf1, k1, buf2, k2);
    },
    water(p: WaterArgs) {
      arrays['water.tmp'] = copy(p.tmp); arrays['water.tmp2'] = copy(p.tmp2); arrays['water.L'] = copy(p.L); arrays['water.ground'] = copy(p.ground);
      arrays['water.wm'] = copy(p.water); arrays['water.cells'] = p.waterCells.slice(0, p.nW); arrays['water.nb'] = p.waterNb.slice(0, 4 * p.nW);
      arrays['water.bank'] = copy(p.bankCells); arrays['water.bankSrc'] = copy(p.bankSrc);
      waterMeta = { invK: p.invK, alpha: p.alpha, bankCoupling: p.bankCoupling, nW: p.nW, WATER_K };
      fieldKernelsJs.water(p);
    },
    soil(soil, src, C, grow, keep) {
      arrays['soil.soil'] = copy(soil); arrays['soil.src'] = copy(src);
      soilMeta = { dt: pp.dtMonthsB, soilDecay: pp.fx3B?.soilDecay ?? 1, SOIL_RATE, SOIL_DECAY, grow, keep };
      fieldKernelsJs.soil(soil, src, C, grow, keep);
    },
  };
  const uninstall = installFieldPasses(pol, recK);
  try {
    pol.compute(sim, false);
  } finally {
    uninstall();
  }
  if (!cellsMeta || sats.length !== 2 || !waterMeta || !soilMeta) throw new Error(`capture: incomplete pass (cells ${!!cellsMeta}, saturate x${sats.length}, water ${!!waterMeta}, soil ${!!soilMeta})`);
  const [air, noise] = sats;
  arrays['air.field'] = air.field; arrays['air.L'] = air.L; arrays['air.buf1'] = air.buf1!;
  arrays['noise.field'] = noise.field; arrays['noise.L'] = noise.L; arrays['noise.buf1'] = noise.buf1!; arrays['noise.buf2'] = noise.buf2!;
  const name = file.split('/').pop()!.replace(/\.metropolis$/, '') + (water ? `+${water}` : '');
  const meta: CaptureMeta = {
    name, N, day: st.day, population: st.stats.population, variant: water ? `${water} (${added} cells)` : '',
    nimby: {
      lfA: lfDef?.stigma?.amount ?? 0.35, lfR: lfDef?.stigma?.radius ?? 6, idle: NIMBY_LANDFILL_IDLE, highway: { ...NIMBY_HIGHWAY },
      bridge: NIMBY_HIGHWAY_BRIDGE, rail: { ...NIMBY_RAIL }, touches, cost, buildings: nb,
    },
    cells: cellsMeta,
    air: { invK: air.invK, alpha: air.alpha, k1: air.k1 },
    noise: { invK: noise.invK, alpha: noise.alpha, k1: noise.k1, k2: noise.k2 },
    water: { ...(waterMeta as CaptureMeta['water']), bankCoupling: BANK_COUPLING },
    soil: soilMeta,
  };
  return { meta, arrays };
}
