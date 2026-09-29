/**
 * In-situ A/B of the desirability / land-value bands: the whole simulation (the frozen 24f8609 tree via plugins.mjs),
 * one Simulation per arm, advanced in interleaved chunks of days (arm order rotated every round), CPU time from an
 * otherwise idle worker thread.
 *
 *   node desirabilityLandValueBands.insitu.mjs --fixture F.metropolis [--mode frames|headless] [--warm 20] [--days 90]
 *        [--chunk 3] [--arms asis,fixed,wasmRes,wasmStaged] [--fps 60] [--speed 3] [--renderMs 6] [--json out.json]
 *
 * Arms: asis = the genuine systems (the original band closures); fixed / wasmRes / wasmStaged = installEconBands()
 * shells (24f8609 systems with the band as a parameter) running the fair JS, the wasm kernels on layers adopted into
 * wasm memory (zero copy), or the wasm kernels on plain layers (band rows staged per call).
 *
 * --mode frames (default): the profiler's `--mode frames` ultra emulation (tools/bench/sim-profile/profile.ts): a
 *   virtual clock replaces performance.now() (frame start + CPU time used in the frame), frame k+1 starts at
 *   max(start_k + 1000/fps, start_k + simCpu_k + renderMs), sim.update(dt) with dt = min(0.1, gap). The infra
 *   scheduler's budgets see CPU time, so the arms' cities drift apart slightly (a faster arm gets more infra work per
 *   frame) — the band work itself does not depend on it (fixed rows per day).
 * --mode headless: sim.advanceDay() only; the cities stay bit-identical across arms (checked at the end).
 * Measured per arm and day: the two systems' daily hooks (desirability.daily + landValue.daily = the containing systems'
 * ms/day), the band calls alone (shell arms), the whole day (advanceDay). Paired ratios per chunk of days with 95 %
 * bootstrap CIs.
 */
import { readFileSync } from 'node:fs';
import { deserializeCity, type SerializedCity } from '../../../src/save/serialize';
import { unpackFile } from '../../../src/save/bundle';
import { Simulation, type SimSystem } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import type { EconRuntime } from '../../../src/sim/economy/runtime';
import type { EconBandFns } from '../../../src/wasm/js/desirabilityLandValueBands';
import {
  ECON_TABLES, econBandsJs, installEconBands, makeEconBandKernels, type EconBindStats,
} from '../../../src/wasm/kernels/desirabilityLandValueBands';
import { adoptLayers } from '../../../src/wasm/layers';
import { bootstrapMedianCI } from '../ab';
import { benchMain, cpuMs, loadAvg } from '../node';
import { RT_LAYERS, instantiate } from './core';

type ArmName = 'asis' | 'fixed' | 'wasmRes' | 'wasmStaged';
const LABEL: Record<ArmName, string> = { asis: 'JS as-is', fixed: 'fair JS', wasmRes: 'wasm resident', wasmStaged: 'wasm staged' };

interface DayRec { day: number; hooks: number; des: number; lv: number; bands: number; total: number }
interface SimArm {
  name: ArmName;
  sim: Simulation;
  days: DayRec[];
  cur: DayRec;
  stats: EconBindStats | null;
  vClock: number;
  dt: number;
  frames: number[];
}

const med = (xs: number[]): number => { const s = xs.slice().sort((p, q) => p - q); const n = s.length; return n ? (n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : NaN; };
const mean = (xs: number[]): number => xs.reduce((p, q) => p + q, 0) / Math.max(1, xs.length);
const pct = (xs: number[], p: number): number => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const fixture = opt('--fixture')!;
  const mode = opt('--mode', 'frames')!;
  const warm = Number(opt('--warm', '20'));
  const days = Number(opt('--days', '90'));
  const chunk = Number(opt('--chunk', '3'));
  const FPS = Number(opt('--fps', '60')), SPEED = Number(opt('--speed', '3')), RENDER_MS = Number(opt('--renderMs', '6'));
  const armNames = (opt('--arms', 'asis,fixed,wasmRes,wasmStaged')!.split(',')) as ArmName[];
  const simdFile = opt('--simd', 'src/wasm/sim_kernels.wasm')!;

  // ---------------------------------------------------------------------------------------------- virtual clock
  const realNow = performance.now.bind(performance);
  let useVirtual = false, vFrameStart = 0, vCpuAtFrameStart = 0;
  (performance as unknown as { now: () => number }).now = () => (useVirtual ? vFrameStart + (cpuMs() - vCpuAtFrameStart) : realNow());

  // ---------------------------------------------------------------------------------------------- arms
  const bytes = new Uint8Array(readFileSync(fixture));
  const w = instantiate(new WebAssembly.Module(readFileSync(simdFile)), 160 << 20);
  const never: EconBandFns = {
    desirability() { throw new Error('wasm band fell back to JS'); },
    landValue() { throw new Error('wasm band fell back to JS'); },
  };
  const arms: SimArm[] = [];
  for (const name of armNames) {
    const st = deserializeCity((await unpackFile(bytes)) as SerializedCity);
    const systems = createSystems();
    let stats: EconBindStats | null = null;
    const rec: { arm?: SimArm } = {};
    if (name !== 'asis') {
      let bands: EconBandFns = econBandsJs;
      if (name !== 'fixed') {
        stats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
        bands = makeEconBandKernels(ECON_TABLES, never, { wasm: w, stats });
      }
      const inner = bands;
      bands = {
        desirability(...a) { const t0 = cpuMs(); try { inner.desirability(...a); } finally { if (rec.arm) rec.arm.cur.bands += cpuMs() - t0; } },
        landValue(...a) { const t0 = cpuMs(); try { inner.landValue(...a); } finally { if (rec.arm) rec.arm.cur.bands += cpuMs() - t0; } },
      };
      if (!installEconBands(systems, bands)) throw new Error('no economy systems');
    }
    let adoptedRt = false;
    if (name === 'wasmRes') adoptLayers(st, w.heap, { reserveExtra: 16 << 20 });
    const sim = new Simulation(st, systems);
    if (name === 'wasmRes') {
      const rt = (systems.find((s) => s.name === 'economy.population') as unknown as { rt: EconRuntime }).rt;
      adoptLayers(rt, w.heap, { include: (k) => (RT_LAYERS as readonly string[]).includes(k) });
      adoptedRt = true;
    }
    const arm: SimArm = { name, sim, days: [], cur: { day: 0, hooks: 0, des: 0, lv: 0, bands: 0, total: 0 }, stats, vClock: 0, dt: 1 / FPS, frames: [] };
    rec.arm = arm;
    // hook timers on the two containing systems
    for (const s of sim.systems as SimSystem[]) {
      if (s.name !== 'economy.desirability' && s.name !== 'economy.landValue') continue;
      const f = s.daily!.bind(s);
      const key = s.name === 'economy.desirability' ? 'des' : 'lv';
      s.daily = (x) => { const t0 = cpuMs(); try { f(x); } finally { const c = cpuMs() - t0; arm.cur[key] += c; arm.cur.hooks += c; } };
    }
    const ad = sim.advanceDay.bind(sim);
    sim.advanceDay = () => {
      arm.cur = { day: sim.state.day + 1, hooks: 0, des: 0, lv: 0, bands: 0, total: 0 };
      const t0 = cpuMs();
      ad();
      arm.cur.total = cpuMs() - t0;
      arm.days.push(arm.cur);
    };
    arms.push(arm);
    log(`# ${LABEL[name]}: ${fixture.split('/').pop()} day ${st.day}, population ${st.stats.population}${adoptedRt ? ', layers resident in wasm memory' : ''}`);
  }

  // ---------------------------------------------------------------------------------------------- warm-up (headless)
  for (let d = 0; d < warm; d++) for (const a of arms) a.sim.advanceDay();
  for (const a of arms) { a.days.length = 0; if (a.stats) Object.assign(a.stats, { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 }); }
  const day0 = arms[0].sim.state.day;
  log(`# warm-up ${warm} days done (day ${day0}); ${mode} mode, ${days} days in chunks of ${chunk}, ${armNames.length} arms interleaved; load ${loadAvg().join(' ')}`);

  // ---------------------------------------------------------------------------------------------- run
  const runFrames = (a: SimArm, target: number) => {
    const sim = a.sim;
    sim.speed = SPEED;
    const frameMs = 1000 / FPS;
    useVirtual = true;
    let guard = 0;
    while (sim.state.day < target && guard++ < 1e6) {
      vFrameStart = a.vClock;
      vCpuAtFrameStart = cpuMs();
      const c0 = cpuMs();
      sim.update(a.dt);
      const c = cpuMs() - c0;
      a.frames.push(c);
      const next = Math.max(a.vClock + frameMs, a.vClock + c + RENDER_MS);
      a.dt = Math.min(0.1, (next - a.vClock) / 1000);
      a.vClock = next;
    }
    useVirtual = false;
  };
  const rounds = Math.ceil(days / chunk);
  const w0 = realNow();
  for (let r = 0; r < rounds; r++) {
    const target = day0 + Math.min(days, (r + 1) * chunk);
    for (let k = 0; k < arms.length; k++) {
      const a = arms[(k + r) % arms.length];
      if (mode === 'frames') runFrames(a, target);
      else while (a.sim.state.day < target) a.sim.advanceDay();
    }
  }
  log(`# ran ${days} days x ${arms.length} arms in ${((realNow() - w0) / 1000).toFixed(0)} s wall; load ${loadAvg().join(' ')}`);

  // ---------------------------------------------------------------------------------------------- results
  const dayEnd = day0 + days;
  const perArm: Record<string, unknown> = {};
  const byDay = (a: SimArm) => { const m = new Map<number, DayRec>(); for (const d of a.days) if (d.day > day0 && d.day <= dayEnd) m.set(d.day, d); return m; };
  const maps = new Map(arms.map((a) => [a.name, byDay(a)]));
  for (const a of arms) {
    const ds = [...maps.get(a.name)!.values()];
    const col = (k: keyof DayRec) => ds.map((d) => d[k] as number);
    perArm[a.name] = {
      label: LABEL[a.name], days: ds.length,
      hooksMsPerDay: { mean: mean(col('hooks')), median: med(col('hooks')), p95: pct(col('hooks'), 0.95) },
      desHookMsPerDay: mean(col('des')), lvHookMsPerDay: mean(col('lv')),
      bandsMsPerDay: a.name === 'asis' ? null : { mean: mean(col('bands')), median: med(col('bands')) },
      dayMs: { mean: mean(col('total')), median: med(col('total')), p95: pct(col('total'), 0.95) },
      frames: a.frames.length ? { n: a.frames.length, mean: mean(a.frames), p95: pct(a.frames, 0.95), max: Math.max(...a.frames) } : null,
      staged: a.stats ? { calls: a.stats.wasmCalls, jsCalls: a.stats.jsCalls, kibInPerCall: a.stats.bytesIn / Math.max(1, a.stats.wasmCalls) / 1024, kibOutPerCall: a.stats.bytesOut / Math.max(1, a.stats.wasmCalls) / 1024 } : null,
      population: a.sim.state.stats.population,
    };
    const p = perArm[a.name] as { hooksMsPerDay: { mean: number; median: number }; bandsMsPerDay: { mean: number } | null; dayMs: { mean: number; median: number } };
    log(`${LABEL[a.name].padEnd(14)} hooks ${p.hooksMsPerDay.mean.toFixed(3)} ms/day (median ${p.hooksMsPerDay.median.toFixed(3)})` +
      `${p.bandsMsPerDay ? `, bands ${p.bandsMsPerDay.mean.toFixed(3)} ms/day` : ''}, whole day ${p.dayMs.mean.toFixed(2)} ms (median ${p.dayMs.median.toFixed(2)})`);
  }
  // paired ratios per chunk of days (B / A), bootstrap CI of the median
  const ratio = (A: ArmName, B: ArmName, key: keyof DayRec) => {
    const ma = maps.get(A), mb = maps.get(B);
    if (!ma || !mb) return null;
    const rs: number[] = [];
    for (let c0 = day0 + 1; c0 <= dayEnd; c0 += chunk) {
      let sa = 0, sb = 0, n = 0;
      for (let d = c0; d < c0 + chunk && d <= dayEnd; d++) {
        const x = ma.get(d), y = mb.get(d);
        if (!x || !y) continue;
        sa += x[key] as number; sb += y[key] as number; n++;
      }
      if (n && sa > 0) rs.push(sb / sa);
    }
    const ci = bootstrapMedianCI(rs, 4242);
    const m = med(rs);
    return { n: rs.length, ratio: m, lo: ci.lo, hi: ci.hi, speedup: 1 / m, speedupLo: 1 / ci.hi, speedupHi: 1 / ci.lo };
  };
  const pairs: [string, ArmName, ArmName][] = [
    ['as-is -> fair JS', 'asis', 'fixed'], ['fair JS -> wasm resident', 'fixed', 'wasmRes'], ['fair JS -> wasm staged', 'fixed', 'wasmStaged'],
    ['as-is -> wasm resident', 'asis', 'wasmRes'], ['wasm staged -> resident', 'wasmStaged', 'wasmRes'],
  ];
  const ratios: Record<string, unknown> = {};
  for (const [label, A, B] of pairs) {
    const rows: Record<string, unknown> = {};
    for (const key of ['hooks', 'bands', 'total'] as const) {
      if (key === 'bands' && (A === 'asis' || B === 'asis')) continue;
      const r = ratio(A, B, key);
      if (!r) continue;
      rows[key] = r;
      log(`${label.padEnd(26)} ${key.padEnd(6)} speedup ${r.speedup.toFixed(2)}x [${r.speedupLo.toFixed(2)}, ${r.speedupHi.toFixed(2)}] (n=${r.n} chunks of ${chunk} days)`);
    }
    if (Object.keys(rows).length) ratios[label] = rows;
  }
  // headless: the cities must still be bit-identical (frames: they drift with the scheduler's CPU-time budgets)
  let identical: boolean | null = null;
  if (mode === 'headless') {
    const lay = (st: object) => Object.entries(st).flatMap(([k, v]) => ArrayBuffer.isView(v) ? [[k, v] as const] : Array.isArray(v) && v.length && v.every((x) => ArrayBuffer.isView(x)) ? (v as ArrayBufferView[]).map((x, i) => [`${k}[${i}]`, x] as const) : []);
    const ref = new Map(lay(arms[0].sim.state));
    identical = true;
    for (const a of arms.slice(1)) {
      for (const [k, v] of lay(a.sim.state)) {
        const u = ref.get(k)!;
        const x = new Uint8Array(u.buffer, u.byteOffset, u.byteLength), y = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        if (x.length !== y.length || x.some((b, i) => b !== y[i])) { identical = false; log(`# NOT identical: ${a.name} ${k}`); break; }
      }
      if (JSON.stringify(a.sim.state.stats) !== JSON.stringify(arms[0].sim.state.stats)) { identical = false; log(`# NOT identical: ${a.name} stats`); }
    }
    log(`# cities after ${warm + days} days: ${identical ? 'bit-identical across all arms' : 'DIFFERENT'}`);
  }
  return { fixture, mode, warm, days, chunk, fps: FPS, speed: SPEED, renderMs: RENDER_MS, day0, arms: perArm, ratios, identical, load: loadAvg() };
});
