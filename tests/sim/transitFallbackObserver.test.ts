import { describe, expect, it } from 'vitest';
import { Fx3Observer, type Fx3Tuning } from './transitFallbackObserver';

const tuning: Fx3Tuning = { commute: -0.25, commuteStart: 8, needsPop0: 2000, needsPop1: 8000, ema: 0.3, fallback: 25 };
function fixture() {
  const b = { id: 1, x: 2, z: 2, w: 2, d: 2, rot: 0, def: 'home', pop: 8000 };
  const st = { day: 0, size: 16, buildings: new Map([[b.id, b]]) };
  const observer = new Fx3Observer(tuning);
  return { observer, st, b };
}
function complete(f: ReturnType<typeof fixture>, selected = true, options: { minutes?: number; workers?: number; entries?: number; assigned?: number; cut?: number } = {}) {
  const { observer, st, b } = f;
  const tr = {
    oN: selected ? 1 : 0, oBid: [b.id], oPop: [b.pop], oW: [options.workers ?? 4000], oEntC: [options.entries ?? 1],
    oCell: [(b.z + (b.d >> 1)) * st.size + b.x + (b.w >> 1)],
    oAsg: [options.assigned ?? 3000], oCut: [options.cut ?? 0], commuteById: [0, options.minutes ?? 10], cycles: st.day + 1,
  };
  observer.trafficPrep(st, tr);
  st.day++;
  observer.trafficFinal(st, tr);
}
function sample(f: ReturnType<typeof fixture>, acc: number[], p: number, grid = 0, traffic = true) {
  const { observer, st, b } = f;
  observer.surveyHome(st, acc, b, (b.z + (b.d >> 1)) * st.size + b.x + (b.w >> 1), p, traffic, grid);
  acc[3] += p;
  acc[40] += (traffic && grid > 0 ? grid : tuning.fallback) * p;
}
function select(f: ReturnType<typeof fixture>, samples: { p: number; grid?: number; traffic?: boolean }[]) {
  const acc = new Array<number>(47).fill(0);
  f.observer.surveyReset(acc);
  for (const s of samples) sample(f, acc, s.p, s.grid, s.traffic);
  const sv = { pop: [0, 0, 0, acc[3]], commute: acc[3] > 0 ? acc[40] / acc[3] : tuning.fallback };
  f.observer.surveySelected(f.st, acc, sv);
  return { acc, sv };
}
function approve(f: ReturnType<typeof fixture>, sv: any, first = true, resumed = false, otherRaw = 60, previous = 50) {
  const u = Math.max(0, Math.min(1, (sv.pop[3] - tuning.needsPop0) / (tuning.needsPop1 - tuning.needsPop0)));
  const commute = sv.pop[3] > 0 ? tuning.commute * Math.max(0, sv.commute - tuning.commuteStart) * u * u * (3 - 2 * u) : 0;
  const unclamped = otherRaw + commute;
  const raw = Math.max(0, Math.min(100, unclamped));
  const approval = first ? (resumed ? previous : raw) : previous + (raw - previous) * tuning.ema;
  f.observer.approval(f.st, sv, first, resumed, { commute, clamp: raw - unclamped }, raw, approval);
  return f.observer.latest!;
}

describe('FX3 fallback observer', () => {
  it('adjusts only a previously matched home omitted from the latest assignment', () => {
    const f = fixture();
    complete(f, true, { minutes: 10 });
    complete(f, false);
    const { sv } = select(f, [{ p: 8000 }]);
    const row = approve(f, sv);
    expect(row.categoryWeights.stale).toBe(8000);
    expect(row.staleShare).toBe(1);
    expect(row.resCommute).toBe(25);
    expect(row.commuteTerm).toBe(-4.25);
    expect(row.carry.mean).toBe(10);
    expect(row.carry.term).toBe(-0.5);
    expect(row.exclude.mean).toBeNull();
    expect(row.exclude.term).toBe(0);
    expect(row.examples.stale[0]).toMatchObject({ prepDay: 0, finalDay: 1, prepPop: 8000, prepWorkers: 4000, prepEntries: 1, selectedLast: false });
  });

  it('keeps measured, never-routed and traffic-disabled samples separate', () => {
    const f = fixture();
    let row = approve(f, select(f, [{ p: 4000 }, { p: 2000, grid: 6 }, { p: 2000, grid: 6, traffic: false }]).sv);
    expect(row.categoryWeights).toMatchObject({ neverRouted: 4000, measured: 2000, disabled: 2000, stale: 0 });
    expect(row.carry.term).toBe(row.commuteTerm);
    expect(row.exclude.term).toBe(row.commuteTerm);
    complete(f);
    row = approve(f, select(f, [{ p: 8000 }]).sv);
    expect(row.categoryWeights.currentZero).toBe(8000); // selected now: not the omitted-origin case
    expect(row.staleWeight).toBe(0);
  });

  it.each([
    [{ workers: 0 }, 'noWorkers'],
    [{ entries: 0 }, 'noRoadEntries'],
    [{ assigned: 0 }, 'noAssignment'],
    [{ minutes: 0 }, 'nonpositiveMinutes'],
  ] as const)('keeps an unmatched latest result instead of carrying an older valid result (%j)', (options, reason) => {
    const f = fixture();
    complete(f);
    complete(f, true, options);
    complete(f, false);
    const row = approve(f, select(f, [{ p: 8000 }]).sv);
    expect(row.categoryWeights.selectedUnmatched).toBe(8000);
    expect(row.unmatchedReasonWeights[reason]).toBe(8000);
    expect(row.staleWeight).toBe(0);
    expect(row.carry.term).toBe(row.commuteTerm);
  });

  it('does not carry a cut-off or changed-geometry home', () => {
    const f = fixture();
    complete(f);
    complete(f, true, { cut: 1 });
    complete(f, false);
    let row = approve(f, select(f, [{ p: 8000 }]).sv);
    expect(row.categoryWeights.cutoff).toBe(8000);
    complete(f);
    complete(f, false);
    f.b.x++;
    row = approve(f, select(f, [{ p: 8000 }]).sv);
    expect(row.categoryWeights.geometryMismatch).toBe(8000);
    expect(row.staleWeight).toBe(0);
  });

  it('retains the sign when the cached trip is longer than the fallback', () => {
    const f = fixture();
    complete(f, true, { minutes: 40 });
    complete(f, false);
    const row = approve(f, select(f, [{ p: 8000 }]).sv);
    expect(row.staleMinuteCorrection).toBe(-120000);
    expect(row.carry.mean).toBe(40);
    expect(row.carry.termDelta).toBe(-3.75);
  });

  it('uses sampled slice populations and the selected snapshot after accumulator reset/cache reuse', () => {
    const f = fixture();
    complete(f);
    complete(f, false);
    const acc = new Array<number>(47).fill(0);
    f.observer.surveyReset(acc);
    sample(f, acc, 1000);
    f.b.pop = 100000;
    sample(f, acc, 4000, 5);
    const sv = { pop: [0, 0, 0, 5000], commute: acc[40] / 5000 };
    f.observer.surveySelected(f.st, acc, sv);
    f.observer.surveyReset(acc);
    acc.fill(0);
    const first = approve(f, sv);
    expect(first.surveyWeight).toBe(5000);
    expect(first.staleWeight).toBe(1000);
    expect(first.populationFade).toBe(0.5);
    expect(first.carry.mean).toBe(6);
    expect(first.exclude.mean).toBe(5);
    expect(first.commuteTerm).toBe(-0.125);
    const again = approve(f, sv, false, false, 60, first.approval);
    expect(again.categorySampleCounts.stale).toBe(1);
    expect(again.surveyNumerator).toBe(first.surveyNumerator);
  });

  it('discards partial slice diagnostics when a full-pass accumulator is reset', () => {
    const f = fixture();
    const acc = new Array<number>(47).fill(0);
    f.observer.surveyReset(acc);
    sample(f, acc, 3000);
    f.observer.surveyReset(acc);
    acc.fill(0);
    sample(f, acc, 8000, 6);
    const sv = { pop: [0, 0, 0, 8000], commute: 6 };
    f.observer.surveySelected(f.st, acc, sv);
    const row = approve(f, sv);
    expect(row.categoryWeights.neverRouted).toBe(0);
    expect(row.categoryWeights.measured).toBe(8000);
    expect(row.commuteTerm).toBe(0);
  });

  it('clamps the changed raw total before its independent monthly EMA and preserves a resumed EMA', () => {
    const f = fixture();
    complete(f);
    complete(f, false);
    const { sv } = select(f, [{ p: 8000 }]);
    const loaded = approve(f, sv, true, true, 3, 42.25);
    expect(loaded.raw).toBe(0);
    expect(loaded.carry.raw).toBe(2.5);
    expect(loaded.exclude.raw).toBe(3);
    expect(loaded.carry.approval).toBe(42.25);
    expect(loaded.exclude.approval).toBe(42.25);
    const next = approve(f, sv, false, false, 3, loaded.approval);
    expect(next.carry.approval).toBe(42.25 + (2.5 - 42.25) * 0.3);
    expect(next.exclude.approval).toBe(42.25 + (3 - 42.25) * 0.3);
    expect(next.carry.approvalDelta).toBeCloseTo(0.75, 12);
    const fresh = fixture();
    complete(fresh);
    complete(fresh, false);
    const initial = approve(fresh, select(fresh, [{ p: 8000 }]).sv, true, false, 3);
    expect(initial.carry.approval).toBe(2.5);
  });

  it('limits examples and rejects an incorrectly reconstructed actual survey', () => {
    const f = fixture();
    const { acc, sv } = select(f, Array.from({ length: 5 }, () => ({ p: 1600 })));
    const row = approve(f, sv);
    expect(row.examples.neverRouted).toHaveLength(3);
    expect(row.categorySampleCounts.neverRouted).toBe(5);
    expect(() => f.observer.surveySelected(f.st, acc, { ...sv, pop: [0, 0, 0, 9000] })).toThrow('sampled population');
    expect(() => f.observer.approval(f.st, sv, false, false, { commute: 0, clamp: 0 }, 60, 60)).toThrow('actual commute term');
  });
});
