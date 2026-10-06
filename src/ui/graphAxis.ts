/**
 * Graph y-axis: a "nice" tick step (1 / 2 / 5 x 10^k) and the data range rounded out to it. Count graphs (int) tick on
 * whole numbers: an all-zero or 0..2 series spans 0..4 in steps of 1 — not steps of 0.2 that a count label rounds to
 * "1 1 1 0 0 0". Headless (no DOM).
 */
export function niceStep(span: number, ticks: number): number {
  const raw = span / Math.max(1, ticks);
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

/** y range (from 0, or below it for negative data) and tick step for data in dataLo..dataHi */
export function niceAxis(dataLo: number, dataHi: number, int = false, ticks = 4): { lo: number; hi: number; step: number } {
  let lo = Math.min(0, Number.isFinite(dataLo) ? dataLo : 0);
  let hi = Number.isFinite(dataHi) ? dataHi : 0;
  if (int) {
    if (hi - lo < ticks) hi = lo + ticks;
  } else if (hi <= lo) hi = lo + 1;
  let step = niceStep(hi - lo, ticks);
  if (int && step < 1) step = 1;
  hi = Math.ceil(hi / step) * step;
  lo = Math.floor(lo / step) * step;
  return { lo, hi, step };
}
