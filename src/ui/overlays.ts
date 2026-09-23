/** Data-view overlay metadata (labels, icons) + legend normalization (uses render-world's overlayLegend if present). */
import { Overlay } from '../core/types';
import { escapeHtml } from './dom';

export interface OverlayInfo {
  o: Overlay;
  label: string;
  icon: string;
  group: 'Growth' | 'Services' | 'Environment' | 'Utilities & traffic';
  /** fallback legend */
  lo: string;
  hi: string;
  /** true when high values are good (green) */
  goodHigh: boolean;
}

export const OVERLAYS: OverlayInfo[] = [
  { o: Overlay.Zones, label: 'Zones', icon: 'zones', group: 'Growth', lo: '', hi: '', goodHigh: true },
  { o: Overlay.LandValue, label: 'Land value', icon: 'landValue', group: 'Growth', lo: 'Low', hi: 'High', goodHigh: true },
  { o: Overlay.Desirability, label: 'Desirability', icon: 'desire', group: 'Growth', lo: 'Undesirable', hi: 'Desirable', goodHigh: true },
  { o: Overlay.Crime, label: 'Crime', icon: 'crime', group: 'Services', lo: 'Safe', hi: 'Dangerous', goodHigh: false },
  { o: Overlay.Police, label: 'Police', icon: 'police', group: 'Services', lo: 'None', hi: 'Full coverage', goodHigh: true },
  { o: Overlay.Fire, label: 'Fire', icon: 'fire', group: 'Services', lo: 'None', hi: 'Full coverage', goodHigh: true },
  { o: Overlay.Health, label: 'Health', icon: 'health', group: 'Services', lo: 'None', hi: 'Full coverage', goodHigh: true },
  { o: Overlay.Education, label: 'Education', icon: 'education', group: 'Services', lo: 'None', hi: 'Full coverage', goodHigh: true },
  { o: Overlay.AirPollution, label: 'Air pollution', icon: 'smog', group: 'Environment', lo: 'Clean', hi: 'Polluted', goodHigh: false },
  { o: Overlay.WaterPollution, label: 'Water pollution', icon: 'water', group: 'Environment', lo: 'Clean', hi: 'Polluted', goodHigh: false },
  { o: Overlay.Garbage, label: 'Garbage', icon: 'garbage', group: 'Environment', lo: 'Clean', hi: 'Piling up', goodHigh: false },
  { o: Overlay.Noise, label: 'Noise', icon: 'noise', group: 'Environment', lo: 'Quiet', hi: 'Loud', goodHigh: false },
  { o: Overlay.Traffic, label: 'Traffic', icon: 'car', group: 'Utilities & traffic', lo: 'Free flow', hi: 'Gridlock', goodHigh: false },
  { o: Overlay.Transit, label: 'Transit', icon: 'bus', group: 'Utilities & traffic', lo: 'None', hi: 'Well served', goodHigh: true },
  { o: Overlay.Power, label: 'Power', icon: 'power', group: 'Utilities & traffic', lo: 'Unpowered', hi: 'Powered', goodHigh: true },
  { o: Overlay.Water, label: 'Water', icon: 'waterTower', group: 'Utilities & traffic', lo: 'No water', hi: 'Supplied', goodHigh: true },
];

export function overlayInfo(o: Overlay): OverlayInfo | undefined {
  return OVERLAYS.find((x) => x.o === o);
}

const GOOD_BAD = 'linear-gradient(90deg, #3cbe5a, #f0c83c, #dc3c3c)';
const BAD_GOOD = 'linear-gradient(90deg, #dc3c3c, #f0c83c, #3cbe5a)';

function colorStr(c: unknown): string {
  if (typeof c === 'number') return '#' + c.toString(16).padStart(6, '0');
  if (typeof c === 'string') return c;
  if (Array.isArray(c) && c.length >= 3) {
    const k = c.every((v) => v <= 1) ? 255 : 1;
    return `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
  }
  if (c && typeof c === 'object' && 'r' in (c as Record<string, number>)) {
    const o = c as { r: number; g: number; b: number };
    const k = o.r <= 1 && o.g <= 1 && o.b <= 1 ? 255 : 1;
    return `rgb(${Math.round(o.r * k)},${Math.round(o.g * k)},${Math.round(o.b * k)})`;
  }
  return '#888';
}

/** Build legend HTML from render-world's overlayLegend(o) (any reasonable shape) or our fallback. */
export function legendHtml(o: Overlay, fromRenderer?: (o: Overlay) => unknown): string {
  const info = overlayInfo(o);
  if (fromRenderer) {
    try {
      const L = fromRenderer(o) as any;
      if (L) {
        const stops: any[] | undefined = Array.isArray(L) ? L : L.stops ?? L.items ?? L.entries ?? L.swatches;
        const grad = L.gradient ?? L.colors;
        if (typeof grad === 'string') return `<div class="lg-grad" style="background:${grad}"></div><div class="lg-ends"><span>${escapeHtml(L.min ?? L.lo ?? info?.lo ?? '')}</span><span>${escapeHtml(L.max ?? L.hi ?? info?.hi ?? '')}</span></div>`;
        if (Array.isArray(grad) && grad.length) {
          const css = `linear-gradient(90deg, ${grad.map(colorStr).join(', ')})`;
          return `<div class="lg-grad" style="background:${css}"></div><div class="lg-ends"><span>${escapeHtml(String(L.min ?? L.lo ?? info?.lo ?? ''))}</span><span>${escapeHtml(String(L.max ?? L.hi ?? info?.hi ?? ''))}</span></div>`;
        }
        if (Array.isArray(stops) && stops.length) {
          const continuous = L.continuous ?? (L.type ? L.type === 'gradient' : ![Overlay.Zones, Overlay.Power, Overlay.Water, Overlay.None].includes(o) && stops.length >= 2);
          if (continuous && stops.length > 2) {
            const css = `linear-gradient(90deg, ${stops.map((s) => colorStr(s.color ?? s.c ?? s[1])).join(', ')})`;
            return `<div class="lg-grad" style="background:${css}"></div><div class="lg-ends">${stops.map((s) => `<span>${escapeHtml(String(s.label ?? ''))}</span>`).join('')}</div>`;
          }
          if (continuous) {
            const css = `linear-gradient(90deg, ${stops.map((s) => colorStr(s.color ?? s.c ?? s[1])).join(', ')})`;
            const first = stops[0], last = stops[stops.length - 1];
            return `<div class="lg-grad" style="background:${css}"></div><div class="lg-ends"><span>${escapeHtml(String(first.label ?? ''))}</span><span>${escapeHtml(String(last.label ?? ''))}</span></div>`;
          }
          return `<div class="lg-sw">${stops.map((s) => `<span><i style="background:${colorStr(s.color ?? s.c ?? s[1])}"></i>${escapeHtml(String(s.label ?? s.name ?? s[0] ?? ''))}</span>`).join('')}</div>`;
        }
      }
    } catch (e) {
      console.warn('[ui] overlayLegend failed', e);
    }
  }
  if (!info) return '';
  if (o === Overlay.Zones) {
    const z: [string, string][] = [['#57d17f', 'Residential'], ['#3d8bff', 'Commercial'], ['#f0b429', 'Industrial'], ['#c3cf62', 'Agriculture'], ['#9c7a55', 'Landfill']];
    return `<div class="lg-sw">${z.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
  }
  if (o === Overlay.Power || o === Overlay.Water) {
    return `<div class="lg-sw"><span><i style="background:#3cbe5a"></i>${info.hi}</span><span><i style="background:#dc3c3c"></i>${info.lo}</span></div>`;
  }
  return `<div class="lg-grad" style="background:${info.goodHigh ? BAD_GOOD : GOOD_BAD}"></div><div class="lg-ends"><span>${info.lo}</span><span>${info.hi}</span></div>`;
}
