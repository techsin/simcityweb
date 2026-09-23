/** Number / money / date formatting for the UI. Currency: Simoleons (§). */

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const CURRENCY = '§';

/** normalize money in simulation-generated text ("$1,200" -> "§1,200"); wealth tags like R$$ are untouched */
export function simText(s: string): string {
  return s.replace(/\$(?=[\d.])/g, CURRENCY).replace(/-\$(?=\d)/g, '−' + CURRENCY);
}

export function num(n: number): string {
  if (!isFinite(n)) return '—';
  return nf.format(Math.round(n));
}

/** compact number: 1234 -> 1.2k, 1234567 -> 1.23M */
export function compact(n: number, digits = 1): string {
  if (!isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (a >= 1e9) return s + (a / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e4) return s + (a / 1e3).toFixed(a >= 1e5 ? 0 : digits) + 'k';
  return s + nf.format(Math.round(a));
}

export function money(n: number): string {
  if (!isFinite(n)) return CURRENCY + '—';
  const s = n < 0 ? '−' : '';
  return s + CURRENCY + nf.format(Math.round(Math.abs(n)));
}

export function moneyCompact(n: number): string {
  if (!isFinite(n)) return CURRENCY + '—';
  const s = n < 0 ? '−' : '';
  return s + CURRENCY + compact(Math.abs(n));
}

/** signed money: +§1,200 / −§300 */
export function moneySigned(n: number, compactMode = false): string {
  const v = Math.round(n);
  const body = compactMode ? CURRENCY + compact(Math.abs(v)) : CURRENCY + nf.format(Math.abs(v));
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + body;
}

export function pct(v01: number, digits = 0): string {
  if (!isFinite(v01)) return '—';
  return (v01 * 100).toFixed(digits) + '%';
}

export function signClass(n: number): string {
  return n > 0.5 ? 'pos' : n < -0.5 ? 'neg' : 'zero';
}

export function titleCase(s: string): string {
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function hourLabel(h: number): string {
  const hh = Math.floor(((h % 24) + 24) % 24);
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mar 12, 2003" for an absolute day index */
export function dayLabel(day: number, startYear: number): string {
  const m = Math.floor(day / 30) % 12;
  const y = startYear + Math.floor(day / 360);
  const d = (day % 30) + 1;
  return `${MONTHS_SHORT[m]} ${d}, ${y}`;
}

/** month index (since founding) -> "Mar '03" */
export function monthLabel(mi: number, startYear: number, short = true): string {
  const m = ((mi % 12) + 12) % 12;
  const y = startYear + Math.floor(mi / 12);
  return short ? `${MONTHS_SHORT[m]} '${String(y).slice(-2)}` : `${MONTHS_SHORT[m]} ${y}`;
}
