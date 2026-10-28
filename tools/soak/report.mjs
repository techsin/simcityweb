import { CYCLE_STEPS } from './driver.mjs';

const MiB = 1024 * 1024;
export function heapTrend(points) {
  const valid = points.filter(p => Number.isFinite(p.elapsedMs) && Number.isFinite(p.heap?.usedSize));
  if (valid.length < 3) return null;
  const xs = valid.map(p => (p.elapsedMs - valid[0].elapsedMs) / 3_600_000);
  const ys = valid.map(p => p.heap.usedSize / MiB);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let numerator = 0, denominator = 0;
  for (let i = 0; i < xs.length; i++) { numerator += (xs[i] - meanX) * (ys[i] - meanY); denominator += (xs[i] - meanX) ** 2; }
  if (denominator <= 0) return null;
  return { samples: valid.length, spanHours: xs.at(-1), slopeMiBPerHour: numerator / denominator, firstMiB: ys[0], lastMiB: ys.at(-1) };
}

/** NOTE-026: the trend over the later half of the exits' span catches a slow, steady leak that the warm-up would hide */
export function lateHeapTrend(points) {
  const valid = points.filter(p => Number.isFinite(p.elapsedMs) && Number.isFinite(p.heap?.usedSize));
  if (valid.length < 2) return null;
  const mid = (valid[0].elapsedMs + valid.at(-1).elapsedMs) / 2;
  return heapTrend(valid.filter(p => p.elapsedMs >= mid));
}

export function assess(log) {
  // The first exit warms code/panels; the next one also includes LOW/HIGH caches.
  // All exits still participate in the zero-city gate, including the warm-up exit.
  const trend = heapTrend(log.exits.slice(1));
  // runs under an hour (the smokes) have too few second-half exits for a slope; from an hour on, missing data fails
  const late = lateHeapTrend(log.exits.slice(1)), lateRequired = log.options.durationMs >= 3_600_000;
  const expectedCycles = Math.ceil(log.options.durationMs / log.options.cycleMs);
  const cyclesComplete = log.cycles.length >= expectedCycles && log.cycles.every(c => c.completed && CYCLE_STEPS.every(s => c.steps.some(step => step.name === s && step.ok)));
  const telemetry = log.samples.filter(s => s.elapsedMs !== null);
  const simDays = telemetry.reduce((n, s) => n + (s.sim?.days ?? 0), 0);
  const citySeconds = telemetry.reduce((n, s) => n + (s.sim?.citySeconds ?? 0), 0);
  const frames = telemetry.reduce((n, s) => n + (s.frames?.city?.count ?? 0), 0);
  const contextLosses = log.samples.reduce((n, s) => n + (s.unexpectedLosses ?? 0), 0);
  const intentionalLosses = log.samples.reduce((n, s) => n + s.losses.filter(l => l.intentional).length, 0);
  const countsValid = log.exits.length > 0 && log.exits.every(e => ['CityScene', 'CityState', 'WebGLRenderer'].every(k => Number.isInteger(e.counts?.[k])));
  const gates = [
    { name: 'Completed requested duration and every action cycle', pass: log.completed && log.observedMs >= log.options.durationMs && cyclesComplete && log.finalExit === true, detail: `${log.cycles.filter(c => c.completed).length}/${expectedCycles} cycles; ${((log.observedMs ?? 0) / 60_000).toFixed(2)}/${(log.options.durationMs / 60_000).toFixed(2)} minutes` },
    { name: 'Real GPU and production build', pass: log.build?.ok === true && log.gpu?.hardware === true, detail: log.gpu?.renderer ?? 'GPU not verified' },
    { name: 'Post-exit heap growth below threshold', pass: trend !== null && trend.slopeMiBPerHour < log.options.heapMiBPerHour, detail: trend ? `${trend.slopeMiBPerHour.toFixed(2)} MiB/hour < ${log.options.heapMiBPerHour} (${trend.samples} samples over ${(trend.spanHours * 60).toFixed(1)} min)` : 'insufficient data: need at least 3 post-warm-up exit samples' },
    { name: 'Second-half heap growth below threshold', pass: late ? late.slopeMiBPerHour <= log.options.lateHeapMiBPerHour : !lateRequired, detail: late ? `${late.slopeMiBPerHour.toFixed(2)} MiB/hour <= ${log.options.lateHeapMiBPerHour} (${late.samples} samples over ${(late.spanHours * 60).toFixed(1)} min)` : lateRequired ? 'insufficient data: need at least 3 exit samples in the second half' : 'n/a for a run under 1 hour' },
    { name: '0 cities left after every exit', pass: countsValid && log.exits.every(e => e.counts.CityScene === 0 && e.counts.CityState === 0), detail: log.exits.map(e => `${e.label}: scene=${e.counts?.CityScene ?? '?'}, state=${e.counts?.CityState ?? '?'}, renderer=${e.counts?.WebGLRenderer ?? '?'}`).join('; ') || 'no exit measurements' },
    { name: 'No errors', pass: log.errorCounts.console === 0 && log.errorCounts.page === 0 && log.errorCounts.harness === 0, detail: JSON.stringify(log.errorCounts) },
    { name: 'No crashes or unexpected WebGL context losses', pass: log.crashes === 0 && log.disconnects === 0 && contextLosses === 0, detail: `${log.crashes} page crashes; ${log.disconnects} unexpected disconnects; ${contextLosses} unexpected context losses; ${intentionalLosses} recorded intentional disposal losses` },
    { name: 'Telemetry present and simulation advances', pass: frames > 0 && simDays > 0 && telemetry.length > 1 && telemetry.every(s => s.longTaskSupported && Number.isFinite(s.heap?.usedSize) && Number.isInteger(s.dom?.nodes)), detail: `${frames} city frames; ${simDays} sim days in ${citySeconds.toFixed(1)} city seconds; ${citySeconds ? (simDays / citySeconds).toFixed(3) : 'n/a'} days/s` },
  ];
  if (log.options.minDaysPerSec > 0) {
    const rate = citySeconds > 0 ? simDays / citySeconds : 0;
    gates.push({ name: 'Simulation rate at the floor', pass: rate >= log.options.minDaysPerSec, detail: `${rate.toFixed(2)} days/s >= ${log.options.minDaysPerSec}` });
  }
  return { pass: gates.every(g => g.pass), trend, late, gates, simDays, citySeconds, contextLosses };
}

export function markdown(log, result) {
  const esc = value => String(value).replace(/[\r\n]+/g, ' ');
  const lines = [
    `# T019 soak: ${log.options.city} — ${result.pass ? 'PASS' : 'FAIL'}`,
    '',
    `Run: ${log.startedAt}. Branch: \`${log.provenance.branch}\`. Tested HEAD: \`${log.provenance.head}\`.`,
    `Named base at run start: \`${log.provenance.namedBase}\`. Production preview, headless Chromium, 1920×1080, quality Ultra between cycles, speed 3.`,
    '',
    ...result.gates.map(g => `- **${g.pass ? 'PASS' : 'FAIL'}** ${g.name}: ${esc(g.detail)}.`),
    '',
    'Heap trend is an ordinary least-squares fit of forced-GC region samples, excluding the first exit for warm-up. Live-city heap and DOM counters remain in run.json. The default 16 MiB/hour limit is a configurable harness policy, not an established project baseline. The second-half line fits the same samples from the midpoint of their span on (default 8 MiB/hour, NOTE-026); it is n/a for a run under 1 hour.',
    'Frame p50/p99 are per-sample requestAnimationFrame intervals in 1 ms upper-bound bins (60 s overflow bin); max is exact. These are frame delivery times, not GPU timestamps. Long tasks include cycles, saves and probe overhead; simulation throughput includes pauses while in a city and excludes region time.',
    '',
    `Fixture: ${esc(log.fixture?.input ?? 'newly founded 64×64 flat sandbox city, seed 7; established by coordinate input')}.`,
    `Interrupted/failed reason: ${esc(log.failure ?? 'none')}.`,
    'Evidence: run.json, events.jsonl (incremental), build.log. Signals and caught failures also write these summaries; a hard process kill can leave only the last checkpoint and JSONL tail.',
    '',
    'For #28: run both 20-minute smokes between timing runs, inspect the action/exit evidence, then run both scenarios for the agreed multi-hour duration on the final merged revision. A smoke pass alone does not establish a multi-hour memory trend.',
    '',
  ];
  return lines.join('\n');
}
