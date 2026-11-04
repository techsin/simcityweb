/** Quiet-machine node bench. Bootstrap, simulation and real view listeners are excluded from protocol timings. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, loadavg } from 'node:os';
import { bootstrapMedianCI } from '../ab';
import { LoopbackCore } from '../../../src/worker/loopbackCore';
import { Replica } from '../../../src/worker/replica';
import { EVENT_NAMES, assertOwnedBuffers, cloneBytes, type Packet, type Ready } from '../../../src/worker/protocol';
import { TRAFFIC_MIN_CYCLE_MS } from '../../../src/sim/infra/params';
import { fixtureDirectory, loadFixture } from './fixtures';

const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const days = Number(option('--days', '120')), pairs = Number(option('--pairs', '31')), warmDays = Number(option('--warm-days', '30'));
if (!Number.isInteger(days) || days < 1 || !Number.isInteger(pairs) || pairs < 3 || !Number.isInteger(warmDays) || warmDays < 0) throw new Error('Invalid --days / --pairs / --warm-days');
const bot = option('--bot', process.env.SIM_BOT256_14M);
if (!bot) throw new Error('Pass --bot FILE (or SIM_BOT256_14M) for the actual bot256-1.4M city. The older 652k fixture is not a substitute.');
const fixtures = [
  { name: 'dense1m', file: option('--dense', join(fixtureDirectory(), 'dense1m_s7.metropolis'))! },
  { name: 'bot256-1.4M', file: bot },
];
const median = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b), k = a.length >> 1;
  return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2;
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const round = (n: number) => Number(n.toFixed(4));
const loadBefore = loadavg();

function collect(file: string) {
  const st = loadFixture(file), population = st.stats.population;
  if (st.size !== 256) throw new Error(`Expected a 256² benchmark city: ${file}`);
  const packets: Packet[] = [], errors: unknown[] = [];
  let collecting = false;
  const loop = new LoopbackCore(st, {
    cadence: 'live', initialSpeed: 3, recorder: { measure: true },
    errors: { report: (...args) => errors.push(args) },
    onPacket: (p) => { if (collecting) packets.push(p); },
  });
  for (const name of EVENT_NAMES) loop.replica.events.on(name, () => {});
  let tick = 0;
  const advance = (n: number) => {
    const end = st.day + n;
    while (st.day < end) loop.frame((8 + (tick++ * 17) % 26) / 1000);
  };
  try {
    advance(warmDays);
    const ready = loop.resync();
    loop.resetTiming(); collecting = true;
    advance(days);
    if (errors.length) throw new Error(`Simulation errors while collecting: ${JSON.stringify(errors)}`);
    assertOwnedBuffers(ready);
    for (const p of packets) assertOwnedBuffers(p);
    return { ready, packets, population, captureMs: loop.recorder.captureMs, flushMs: loop.timing.flushMs };
  } finally { loop.dispose(); }
}

function cloneOnly(packets: Packet[]): number {
  const start = performance.now();
  let sum = 0;
  for (const p of packets) sum += structuredClone({ t: 'pkt', p }).p.seq;
  if (sum < packets.length) throw new Error('Incomplete clone control');
  return performance.now() - start;
}
function replay(ready: Ready, packets: Packet[]): { clone: number; apply: number; total: number } {
  const replica = new Replica({ report: (_key, error) => { throw error; } });
  replica.adopt(structuredClone(ready));
  for (const name of EVENT_NAMES) replica.events.on(name, () => {});
  let clone = 0, apply = 0;
  const start = performance.now();
  for (const p of packets) {
    let t = performance.now();
    const message = structuredClone({ t: 'pkt', p });
    clone += performance.now() - t;
    t = performance.now();
    if (!replica.apply(message.p)) throw new Error('Replay diverged');
    apply += performance.now() - t;
  }
  return { clone, apply, total: performance.now() - start };
}

const rows = [];
for (const fixture of fixtures) {
  const data = collect(fixture.file);
  if (fixture.name === 'bot256-1.4M' && (data.population < 1300000 || data.population > 1500000)) throw new Error(`Expected bot256-1.4M, got ${data.population} residents`);
  // Warm the exact dataset on both arms. Replay setup / adoption is outside each measured interval.
  for (let i = 0; i < 3; i++) { cloneOnly(data.packets); replay(data.ready, data.packets); }
  const control: number[] = [], aa: number[] = [], clones: number[] = [], applies: number[] = [], totals: number[] = [], baseline: number[] = [];
  for (let i = 0; i < pairs; i++) {
    // Identical replay arms, fresh replicas, alternating order: A/A measures drift on the actual replay workload.
    let a: ReturnType<typeof replay>, b: ReturnType<typeof replay>;
    if (i % 2) { b = replay(data.ready, data.packets); a = replay(data.ready, data.packets); }
    else { a = replay(data.ready, data.packets); b = replay(data.ready, data.packets); }
    control.push(cloneOnly(data.packets)); aa.push(b.apply / a.apply); baseline.push(a.apply / days);
    clones.push(b.clone / days); applies.push(b.apply / days); totals.push(b.total / days);
  }
  const aaRatio = median(aa), normalizedApply = mean(applies) / aaRatio;
  const capture = data.captureMs / days, flush = data.flushMs / days;
  // §5.4 defines protocol cost as apply + re-fire with no-op listeners; budgets use means, not medians.
  const protocol = normalizedApply;
  const ci = bootstrapMedianCI(aa);
  rows.push({ fixture: fixture.name, population: data.population, days, packets: data.packets.length,
    cloneBytesEstimatePerDay: Math.round(data.packets.reduce((n, p) => n + cloneBytes({ t: 'pkt', p }), 0) / days),
    captureMsPerDay: round(capture), flushMsPerDay: round(flush), cloneMeanMsPerDay: round(mean(clones)),
    applyMeanMsPerDay: round(mean(applies)), applyMedianMsPerDay: round(median(applies)), mainMeanMsPerDay: round(mean(totals)),
    cloneControlMeanMsPerDay: round(mean(control) / days), aaBaselineMsPerDay: round(mean(baseline)), aaRatio: round(aaRatio), protocolMsPerDay: round(protocol),
    allComponentsMsPerDay: round(capture + flush + mean(totals)), aaRatioCI95: ci, within05ms: protocol <= 0.5,
  });
}
const report = {
  node: process.version, cpu: cpus()[0]?.model, load: [loadBefore, loadavg()], pairs, warmDays,
  cadence: `W0.1 frame(), ultra, 8–33 ms dt; traffic wall-clock floor ${TRAFFIC_MIN_CYCLE_MS} ms`,
  method: 'Paired identical replay arms on fresh replicas, alternating order. Protocol budget (§5.4) = mean(A2 apply+re-fire ms/day) / median(A2/A1), with no-op listeners. Clone-only controls and worker capture/flush are separate; allComponents includes them. Bootstrap and simulation excluded.',
  limitations: 'W0.1 has no beginTick/nextUnit or explicit live flag. Synthetic dt does not replace the scheduler wall clock. Re-run after S5 at its 300 ms traffic cadence for the final volume gate; timing requires a quiet machine.',
  rows,
};
console.table(rows.map(({ aaRatioCI95: _ci, ...row }) => row));
console.log(report.method);
console.log(report.limitations);
const json = option('--json');
if (json) writeFileSync(json, JSON.stringify(report, null, 2) + '\n');
if (rows.some((r) => !r.within05ms)) process.exitCode = 1;
