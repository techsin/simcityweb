/**
 * R2 (docs/WORKER_DESIGN.md §6): the New Year launch-site cost at 1M, the full scan against the event-kept index
 * (T038). Node only, CPU work: `collectLaunchSites` reads plain state, building definitions and the renderer's visuals.
 *
 *   npx tsx tools/bench/fireworksSites.ts [--fixtures DIR] [--base TREE] [--city dense1m|bot256|FILE]...
 *       [--rounds 30] [--reps 20] [--cold 5] [--year] [--view] [--json FILE]
 *
 * --base TREE  a checkout of the base (e.g. a clean export of dev): its own collectLaunchSites is "before". Without it,
 *              "before" is this tree's collectLaunchSites (the same full scan; T038 only split off its tail).
 * warm         per round, one block of --reps calls of each variant in a rotated order: before (A), before again (A',
 *              the A/A control), the index's collect (B) and the waterfront scan alone (W, a part of both A and B).
 *              Medians of the per-call times; B/A and A/A ratios.
 * --cold N     N fresh processes per variant, interleaved A, B, A, B: the first call after load, as at New Year (the
 *              index is built at load, as CityObjectsView builds it, and its build time is reported separately).
 * events       the index's cost per building event: a plain change, a remove + add, and the two slow paths (a kept
 *              winner removed: its group is re-ranked from the cache; an edge building removed: the bounds re-scan).
 * --year       runs the simulation to the next New Year with the index kept from the sim's building events (and a
 *              visual map kept the way BuildingRenderer keeps it), comparing the index with both full scans at every
 *              month boundary and at the 'year' event.
 * --view       the same New Year through the production wiring: a CityObjectsView (real BuildingRenderer visuals)
 *              subscribed to the sim's events; its launchSites() against collectLaunchSites(launchSiteSource()) at
 *              load, at every month boundary and at the 'year' event.
 * Visuals are deterministic stand-ins (tests/render/fireworksHarness.ts), held in a Map like BuildingRenderer's.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CELL_SIZE } from '../../src/core/constants';
import type { Building, CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { Simulation } from '../../src/sim/Simulation';
import { collectLaunchSites, collectWaterfrontSites, LaunchSiteIndex, type LaunchSite, type SiteSource } from '../../src/render/city/effects/Fireworks';
import { standInVisual, type SiteVisual } from '../../tests/render/fireworksHarness';
import { loadCity, fixtureDir } from './roadTransitSearch/fixtures';

type Collect = (src: SiteSource) => LaunchSite[];
type Visual = SiteVisual;

const args = process.argv.slice(2);
const opt = (name: string, dflt?: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const all = (name: string) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const FIX = fixtureDir(args);
const CITIES = all('--city').length ? all('--city') : ['dense1m', 'bot256'];
const ROUNDS = Number(opt('--rounds', '30')), REPS = Number(opt('--reps', '20')), COLD = Number(opt('--cold', '0'));
const BASE = opt('--base');
const CHILD = opt('--child'); // internal: one cold first call of variant A or B

function cityFile(spec: string): string {
  if (spec === 'bot256') return join(FIX, 'bot256_s7_y60.metropolis');
  return spec;
}

/** the tests' stand-in visual, computed when the renderer would build it (load, then each building event) */
const standIn = (b: Building): Visual => standInVisual(b);

/** a source like CityObjectsView.launchSiteSource(): a fresh iterator per call, visuals from a renderer-like Map */
function source(st: CityState, vis: Map<number, Visual>): SiteSource {
  return {
    get buildings() { return st.buildings.values(); },
    defOf: getDef,
    visualOf: (id) => vis.get(id) ?? null,
    size: st.size, water: st.water, cellSize: CELL_SIZE,
    groundAt: (x, z) => st.heightAt(x, z, CELL_SIZE),
    network: st.network, building: st.building,
  };
}

async function loadBefore(): Promise<{ collect: Collect; label: string }> {
  if (!BASE) return { collect: collectLaunchSites, label: 'this tree (full scan)' };
  const file = resolve(BASE, 'src/render/city/effects/Fireworks.ts');
  const mod = (await import(pathToFileURL(file).href)) as { collectLaunchSites: Collect };
  return { collect: mod.collectLaunchSites, label: file };
}

function sameSites(a: LaunchSite[], b: LaunchSite[]): boolean {
  return a.length === b.length && a.every((s, i) => {
    const t = b[i];
    return s.kind === t.kind && Object.is(s.x, t.x) && Object.is(s.y, t.y) && Object.is(s.z, t.z) && Object.is(s.weight, t.weight);
  });
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r3 = (x: number) => Math.round(x * 1000) / 1000;

async function load(spec: string) {
  const { st } = await loadCity(cityFile(spec), FIX);
  const vis = new Map<number, Visual>();
  for (const b of st.buildings.values()) vis.set(b.id, standIn(b));
  return { st, vis, src: source(st, vis) };
}

function residents(st: CityState): number {
  let pop = 0;
  for (const b of st.buildings.values()) pop += b.pop;
  return pop;
}

async function warm(spec: string, before: Collect) {
  const { st, src } = await load(spec);
  const t0 = performance.now();
  const index = new LaunchSiteIndex(src);
  const buildMs = performance.now() - t0;
  const A = () => before(src), B = () => index.collect(src);
  const identical = sameSites(A(), B()) && sameSites(collectLaunchSites(src), B());
  // the waterfront scan alone (what B still runs per show besides the pop/jobs centre), bounds set up outside the timer
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of st.buildings.values()) { x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.w); z0 = Math.min(z0, b.z); z1 = Math.max(z1, b.z + b.d); }
  const bounds = { x0, x1, z0, z1 }, W = () => collectWaterfrontSites(src, bounds);
  const variants: [string, () => LaunchSite[]][] = [['A', A], ["A'", A], ['B', B], ['W', W]];
  const times: Record<string, number[]> = { A: [], "A'": [], B: [], W: [] };
  for (let i = 0; i < 5; i++) for (const [, f] of variants) f(); // warm-up
  for (let r = 0; r < ROUNDS; r++) {
    for (let k = 0; k < variants.length; k++) {
      const [name, f] = variants[(r + k) % variants.length];
      for (let i = 0; i < REPS; i++) {
        const s = performance.now();
        f();
        times[name].push(performance.now() - s);
      }
    }
  }
  const stat = (v: number[]) => ({ median: r3(median(v)), p90: r3(pct(v, 0.9)), min: r3(Math.min(...v)) });
  const out = {
    city: spec, buildings: st.buildings.size, residents: residents(st), sites: B().length, identical,
    indexBuildMs: r3(buildMs), samples: times.A.length,
    before: stat(times.A), beforeAgain: stat(times["A'"]), after: stat(times.B), waterfrontOnly: stat(times.W),
    aa: r3(median(times.A) / median(times["A'"])), ratio: r3(median(times.B) / median(times.A)),
    events: events(st, src, index),
  };
  index.clear();
  return out;
}

/** per-event cost of keeping the index; restores the city afterwards */
function events(st: CityState, src: SiteSource, index: LaunchSiteIndex) {
  const ids = [...st.buildings.keys()];
  const pick = (i: number) => st.buildings.get(ids[(i * 7919) % ids.length])!;
  /** n samples of f(prep(i)); prep runs outside the timer */
  const time = <T>(n: number, prep: (i: number) => T, f: (x: T) => void) => {
    const v: number[] = [];
    for (let i = 0; i < n; i++) { const x = prep(i), s = performance.now(); f(x); v.push(performance.now() - s); }
    return { median: r3(median(v)), max: r3(Math.max(...v)) };
  };
  const change = time(2000, pick, (b) => index.update(b, src));
  // remove + add of an ordinary building: delete it from the Map (as removeBuilding does) and re-add it at the end
  const readd = (b: Building) => { st.buildings.delete(b.id); index.remove(b.id); st.buildings.set(b.id, b); index.update(b, src); };
  const removeAdd = time(500, (i) => pick(i + 1), readd);
  const priv = index as unknown as { best: object[][]; entries: Map<number, object>; bounds: { x0: number } };
  const idOf = (e: object | undefined) => { for (const [id, x] of priv.entries) if (x === e) return id; return -1; };
  const byId = (id: number) => (id >= 0 ? st.buildings.get(id) : undefined);
  const winner = time(20, () => byId(idOf(priv.best[0][0] ?? priv.best[2][0])), (b) => { if (b) readd(b); });
  const edge = time(20, () => {
    for (const b of st.buildings.values()) if (b.x === priv.bounds.x0) return b;
    return undefined;
  }, (b) => { if (b) readd(b); });
  return { change, removeAdd, winnerRemoveAdd: winner, edgeRemoveAdd: edge, identicalAfter: sameSites(index.collect(src), collectLaunchSites(src)) };
}

/** one cold first call in this process (--child A|B), printed as JSON */
async function child(spec: string, which: string, before: Collect) {
  const { src } = await load(spec);
  let buildMs = 0, index: LaunchSiteIndex | null = null;
  if (which === 'B') { const t = performance.now(); index = new LaunchSiteIndex(src); buildMs = performance.now() - t; }
  const s = performance.now();
  const sites = which === 'B' ? index!.collect(src) : before(src);
  const firstMs = performance.now() - s;
  const s2 = performance.now();
  if (which === 'B') index!.collect(src); else before(src);
  const secondMs = performance.now() - s2;
  console.log(JSON.stringify({ which, firstMs, secondMs, buildMs, sites: sites.length }));
}

function cold(spec: string) {
  const v: Record<string, { first: number[]; second: number[]; build: number[] }> = { A: { first: [], second: [], build: [] }, B: { first: [], second: [], build: [] } };
  for (let i = 0; i < COLD; i++) for (const which of i % 2 ? ['B', 'A'] : ['A', 'B']) {
    const extra = BASE ? ['--base', BASE] : [];
    const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], '--child', which, '--city', spec, '--fixtures', FIX, ...extra], { encoding: 'utf8' });
    const line = r.stdout.trim().split('\n').pop() ?? '';
    if (r.status !== 0 || !line.startsWith('{')) throw new Error(`cold child failed: ${r.stderr}`);
    const j = JSON.parse(line) as { firstMs: number; secondMs: number; buildMs: number };
    v[which].first.push(j.firstMs); v[which].second.push(j.secondMs); v[which].build.push(j.buildMs);
  }
  const s = (x: number[]) => ({ median: r3(median(x)), min: r3(Math.min(...x)), max: r3(Math.max(...x)) });
  return { city: spec, runs: COLD, before: { first: s(v.A.first), second: s(v.A.second) },
    after: { first: s(v.B.first), second: s(v.B.second), indexBuild: s(v.B.build) },
    ratioFirst: r3(median(v.B.first) / median(v.A.first)) };
}

/** the simulation to the next New Year, the index kept from its events; compared at every month and the year */
async function year(spec: string, before: Collect) {
  const { st, vis, src } = await load(spec);
  const { createSystems } = await import('../../src/sim/systems/index');
  const sim = new Simulation(st, createSystems());
  const index = new LaunchSiteIndex(src);
  let added = 0, changed = 0, removed = 0;
  const checks: { day: number; event: string; sites: number; identical: boolean }[] = [];
  const offs = [
    sim.events.on('buildingAdded', (b) => { added++; vis.set(b.id, standIn(b)); index.update(b, src); }),
    sim.events.on('buildingChanged', (b) => { changed++; vis.set(b.id, standIn(b)); index.update(b, src); }),
    sim.events.on('buildingRemoved', (b) => { removed++; index.remove(b.id); vis.delete(b.id); }),
    sim.events.on('month', () => { const s = index.collect(src); checks.push({ day: st.day, event: 'month', sites: s.length, identical: sameSites(s, before(src)) && sameSites(s, collectLaunchSites(src)) }); }),
    sim.events.on('year', () => { const s = index.collect(src); checks.push({ day: st.day, event: 'year', sites: s.length, identical: sameSites(s, before(src)) && sameSites(s, collectLaunchSites(src)) }); }),
  ];
  const startDay = st.day, t0 = performance.now();
  let guard = 0;
  while (!checks.some((c) => c.event === 'year') && guard++ < 400) sim.advanceDay();
  for (const off of offs) off();
  return { city: spec, startDay, endDay: st.day, simSeconds: r3((performance.now() - t0) / 1000), events: { added, changed, removed },
    checks: checks.length, allIdentical: checks.every((c) => c.identical), yearCheck: checks.find((c) => c.event === 'year') ?? null };
}

/** --view: the production wiring (CityObjectsView, its real BuildingRenderer visuals) through the next New Year */
async function view(spec: string) {
  const { st } = await loadCity(cityFile(spec), FIX);
  const THREE = await import('three');
  const { createSystems } = await import('../../src/sim/systems/index');
  const { CityObjectsView } = await import('../../src/render/city/CityObjectsView');
  const sim = new Simulation(st, createSystems());
  const t0 = performance.now();
  const v = new CityObjectsView(st, sim.events, {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer: {} as never, canvas: {} as never, getState: () => sim.state,
  });
  const buildSeconds = r3((performance.now() - t0) / 1000);
  const fw = v as unknown as { launchSites(): LaunchSite[]; launchSiteSource(): SiteSource };
  const ev = { added: 0, changed: 0, removed: 0 };
  const checks: { day: number; event: string; sites: number; identical: boolean }[] = [];
  const check = (event: string) => {
    const s = fw.launchSites();
    checks.push({ day: st.day, event, sites: s.length, identical: sameSites(s, collectLaunchSites(fw.launchSiteSource())) });
  };
  const offs = [
    sim.events.on('buildingAdded', () => { ev.added++; }), sim.events.on('buildingChanged', () => { ev.changed++; }),
    sim.events.on('buildingRemoved', () => { ev.removed++; }),
    sim.events.on('month', () => check('month')), sim.events.on('year', () => check('year')),
  ];
  check('load');
  const startDay = st.day;
  let guard = 0;
  while (!checks.some((c) => c.event === 'year') && guard++ < 400) sim.advanceDay();
  for (const off of offs) off();
  v.dispose();
  return { city: spec, buildings: st.buildings.size, viewBuildSeconds: buildSeconds, startDay, endDay: st.day, events: ev,
    checks: checks.length, allIdentical: checks.every((c) => c.identical), yearCheck: checks.find((c) => c.event === 'year') ?? null };
}

async function main() {
  const { collect: before, label } = await loadBefore();
  if (CHILD) { await child(CITIES[0], CHILD, before); return; }
  const meta = { node: process.version, cpus: cpus().length, cpu: cpus()[0]?.model, loadBefore: loadavg().map((x) => r3(x)), before: label, rounds: ROUNDS, reps: REPS };
  console.log(`# ${JSON.stringify(meta)}`);
  const out: Record<string, unknown> = { meta };
  for (const spec of CITIES) {
    const w = await warm(spec, before);
    console.log(JSON.stringify(w));
    const res: Record<string, unknown> = { warm: w };
    if (COLD > 0) { const c = cold(spec); console.log(JSON.stringify(c)); res.cold = c; }
    if (args.includes('--year')) { const y = await year(spec, before); console.log(JSON.stringify(y)); res.year = y; }
    if (args.includes('--view')) { const y = await view(spec); console.log(JSON.stringify(y)); res.view = y; }
    out[spec] = res;
  }
  (out.meta as Record<string, unknown>).loadAfter = loadavg().map((x) => r3(x));
  const json = opt('--json');
  if (json) writeFileSync(json, JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
