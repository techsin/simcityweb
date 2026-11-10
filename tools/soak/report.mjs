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
  const runningSeconds = telemetry.reduce((n, s) => n + (s.sim?.runningSeconds ?? 0), 0);
  // NOTE-081: the sim's rate is its days per second it ran. City seconds also hold each cycle's pauses, which grow with
  // the machine's load (T082's loaded hour: 12.62 days/s per city second where the sim ran at 17.82).
  // Only a cycle's pauses leave the rate. Seconds the sim stood paused while the harness had left it to play (samples of
  // phase playing-ultra) stay in it, so a sim that something else pauses cannot pass on the few seconds it ran: under
  // 0.1 s in each of T082's hours. Without running time, or without one sample of a city left to play (a run that died
  // in its first cycle), there is no rate: null, never a pass.
  const playing = telemetry.filter(s => s.phase === 'playing-ultra' && Number.isFinite(s.sim?.runningSeconds));
  const idleSeconds = playing.reduce((n, s) => n + Math.max(0, (s.sim.citySeconds ?? 0) - s.sim.runningSeconds), 0);
  const daysPerRunningSecond = runningSeconds > 0 && playing.length ? simDays / (runningSeconds + idleSeconds) : null;
  const daysPerCitySecond = citySeconds > 0 ? simDays / citySeconds : null;
  const rate = v => v === null ? 'n/a' : v.toFixed(2);
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
    { name: 'Telemetry present and simulation advances', pass: frames > 0 && simDays > 0 && telemetry.length > 1 && telemetry.every(s => s.longTaskSupported && Number.isFinite(s.heap?.usedSize) && Number.isInteger(s.dom?.nodes)), detail: `${frames} city frames; ${simDays} sim days: ${rate(daysPerRunningSecond)} days/s over ${runningSeconds.toFixed(1)} running seconds and ${idleSeconds.toFixed(1)} s paused between cycles, ${rate(daysPerCitySecond)} days/s over ${citySeconds.toFixed(1)} city seconds (the cycles' pauses included)` },
  ];
  if (log.options.minDaysPerSec > 0) {
    // the floor itself is unchanged (NOTE-026: 15); only its denominator is the sim's own running time
    const measured = daysPerRunningSecond === null ? `no rate (${runningSeconds > 0 ? 'the city was never left to play between cycles' : 'no running time was measured'}) for the floor of ${log.options.minDaysPerSec} days/s per running second`
      : `${rate(daysPerRunningSecond)} days/s per running second >= ${log.options.minDaysPerSec}${idleSeconds >= 0.05 ? `, with ${idleSeconds.toFixed(1)} s paused between cycles counted as running` : ''}`;
    gates.push({ name: 'Simulation rate at the floor', pass: daysPerRunningSecond !== null && daysPerRunningSecond >= log.options.minDaysPerSec, detail: `${measured}; ${rate(daysPerCitySecond)} days/s per city second, with the cycles' pauses, is informative` });
  }
  return { pass: gates.every(g => g.pass), trend, late, gates, simDays, citySeconds, runningSeconds, idleSeconds, daysPerRunningSecond, daysPerCitySecond, contextLosses };
}

/**
 * The cadence limit: a cycle that is still running when the next one is due stops the run. null while the cadence holds,
 * else the reason, which names the usual cause. `dueMs` is the next cycle's start, in ms into the run, and `nowMs` the
 * time the finished cycle is checked at; a run's last cycle has no next one to be late for.
 */
export function cadenceOverrun(cycle, nowMs, dueMs, options) {
  if (nowMs < dueMs || dueMs >= options.durationMs) return null;
  const seconds = ms => (ms / 1000).toFixed(0);
  const slowest = cycle.steps.filter(step => Number.isFinite(step.endedMs)).map(step => ({ name: step.name, ms: step.endedMs - step.startedMs }))
    .sort((a, b) => b.ms - a.ms).slice(0, 3).map(step => `${step.name} ${seconds(step.ms)} s`).join(', ');
  return `Action cycle ${cycle.number} took ${seconds(cycle.endedMs - cycle.startedMs)} s and was still running when the next one was due (one every ${seconds(options.cycleMs)} s, --cycle-minutes ${options.cycleMs / 60_000}), so the run stops here. The usual cause is a busy machine: the harness, its build and Chromium run at below-normal priority, so a benchmark, a test run, another browser or another soak takes the CPU and the GPU from the cycle. Run the soak again with the machine to itself. If the machine was idle, look at the cycle's slowest steps: ${slowest || 'none recorded'}.`;
}

export function markdown(log, result) {
  const esc = value => String(value).replace(/[\r\n]+/g, ' ');
  const lines = [
    `# T019 soak: ${log.options.city} — ${result.pass ? 'PASS' : 'FAIL'}`,
    '',
    `Run: ${log.startedAt}. Branch: \`${log.provenance.branch}\`. Tested HEAD: \`${log.provenance.head}\`.`,
    `Named base at run start: \`${log.provenance.namedBase}\`. Production preview, headless Chromium, 1920×1080, quality Ultra between cycles, speed 3. Simulation host: ${log.initialCity?.host ?? 'not read'}.`,
    '',
    ...result.gates.map(g => `- **${g.pass ? 'PASS' : 'FAIL'}** ${g.name}: ${esc(g.detail)}.`),
    '',
    'Heap trend is an ordinary least-squares fit of forced-GC region samples, excluding the first exit for warm-up. Live-city heap and DOM counters remain in run.json. The default 16 MiB/hour limit is a configurable harness policy, not an established project baseline. The second-half line fits the same samples from the midpoint of their span on (default 8 MiB/hour, NOTE-026); it is n/a for a run under 1 hour.',
    'Frame p50/p99 are per-sample requestAnimationFrame intervals in 1 ms upper-bound bins (60 s overflow bin); max is exact. These are frame delivery times, not GPU timestamps. Long tasks include cycles, saves and probe overhead.',
    'The simulation rate is sim days per running second: the seconds in the city with the sim\'s speed above 0. A cycle\'s pauses and the region screen are out of it; each cycle\'s last seconds, from re-entry at speed 1 until speed 3 is pressed, are in it, and so is any time the sim stood paused between cycles, where only something other than the harness can have paused it. The NOTE-026 floor (--min-days-per-sec) reads that number. Days per city second, which has the cycles\' pauses in it and falls as the machine gets busier, is shown for reference only.',
    '',
    `Fixture: ${esc(log.options.city === 'small' ? 'newly founded 64×64 flat sandbox city, seed 7; established by coordinate input' : log.fixture?.input ?? `${log.options.fixture} (not loaded)`)}.`,
    `Interrupted/failed reason: ${esc(log.failure ?? 'none')}.`,
    'Evidence: run.json, events.jsonl (incremental), build.log. Signals and caught failures also write these summaries; a hard process kill can leave only the last checkpoint and JSONL tail.',
    '',
    'For #28: run both 20-minute smokes between timing runs, inspect the action/exit evidence, then run both scenarios for the agreed multi-hour duration on the final merged revision, with the machine to themselves. A smoke pass alone does not establish a multi-hour memory trend.',
    '',
  ];
  return lines.join('\n');
}
