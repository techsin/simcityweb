/**
 * Money formatting shared by sim messages (action reasons, advisors, news) and the UI. Headless.
 * The in-game currency is the simoleon '§'. (Wealth labels like R$$ / CS$$$ are SC4 notation, not money.)
 */
export const CURRENCY = '§';

/** '§1,234' / '−§1,234'; `compact` → '§12.3k' / '§1.25M' */
export function formatMoney(v: number, compact = false): string {
  const neg = v < 0;
  const a = Math.abs(v);
  let s: string;
  if (compact && a >= 1e6) s = (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
  else if (compact && a >= 1e4) s = (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k';
  else s = Math.round(a).toLocaleString('en-US');
  return (neg ? '−' : '') + CURRENCY + s;
}
