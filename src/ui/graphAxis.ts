/**
 * Graph y-axis: a "nice" tick step (1 / 2 / 5 x 10^k) and the data range rounded out to it. Count graphs (int) tick on
 * whole numbers: an all-zero or 0..2 series spans 0..4 in steps of 1 — not steps of 0.2 that a count label rounds to
 * "1 1 1 0 0 0". axisLabels writes all ticks of an axis in one notation ("0 5k 10k 15k", not "0 5,000 10.0k 15.0k").
 * Headless (no DOM).
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

/** the tick values lo, lo + step, … ≤ hi (lo + k × step: no drift from adding the step up) */
export function axisTicks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  if (!(step > 0) || !Number.isFinite(lo) || !Number.isFinite(hi)) return out;
  for (let k = 0; k <= 1000; k++) {
    const v = lo + k * step;
    if (v > hi + step * 1e-3) break;
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

const groupNf = new Map<number, Intl.NumberFormat>();
const grouped = (v: number, dec: number) => {
  let f = groupNf.get(dec);
  if (!f) groupNf.set(dec, (f = new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })));
  return f.format(v);
};

/**
 * Labels of one y-axis in a single notation (count and money graphs). compact() formats each number on its own and
 * switches notation at 10,000 and 100,000, so one axis read "0 5,000 10.0k 15.0k" or "0 50.0k 100k 150k". Here the
 * unit follows the largest |tick| at compact()'s thresholds (k from 10,000, M from 1e6, B from 1e9; below 10,000 the
 * whole number with thousands separators, as compact() writes it) and every tick gets the decimals the step needs:
 * "0 5k 10k 15k", "0 50k 100k 150k", "§0 §0.5M §1.0M §1.5M", "0 2,000 4,000". Zero reads "0" (prefix kept: "§0"),
 * negatives a true minus ("−§5k").
 */
export function axisLabels(ticks: readonly number[], step: number, prefix = ''): string[] {
  let max = 0;
  for (const t of ticks) if (Number.isFinite(t) && Math.abs(t) > max) max = Math.abs(t);
  const [unit, suffix] = max >= 1e9 ? [1e9, 'B'] : max >= 1e6 ? [1e6, 'M'] : max >= 1e4 ? [1e3, 'k'] : [1, ''];
  // decimals: enough for step / unit (a 1 / 2 / 5 x 10^k step: 0 for whole units, 1 for 0.5M, 2 for 0.25k …)
  const s = Math.abs(step) / unit;
  let dec = 0;
  while (dec < 3 && Number.isFinite(s) && Math.abs(s * 10 ** dec - Math.round(s * 10 ** dec)) > 1e-6) dec++;
  return ticks.map((t) => {
    if (!Number.isFinite(t)) return '—';
    const a = Math.abs(t) / unit;
    if (Math.round(a * 10 ** dec) === 0) return prefix + '0';
    return (t < 0 ? '−' : '') + prefix + (unit === 1 ? grouped(a, dec) : a.toFixed(dec)) + suffix;
  });
}
