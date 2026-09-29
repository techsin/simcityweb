/**
 * Data-view overlay metadata (labels, icons, groups, variants) + legend HTML (render-world's overlayLegend when loaded,
 * else a fallback). Variants and their names come from the simulation (src/sim/infra/overlays.ts OVERLAY_VARIANTS).
 */
import { Overlay } from '../core/types';
import type { CityState } from '../sim/CityState';
import { OVERLAY_VARIANTS, commuteScale, overlayVariantLabel, resolveVariant } from '../sim/infra/overlays';
import { windFromLabel, windVector } from '../sim/infra/wind';
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
  /** one-line tooltip of the data view button */
  hint?: string;
}

export const OVERLAYS: OverlayInfo[] = [
  { o: Overlay.Zones, label: 'Zones', icon: 'zones', group: 'Growth', lo: '', hi: '', goodHigh: true, hint: 'Zoned land by type and density' },
  { o: Overlay.LandValue, label: 'Land value', icon: 'landValue', group: 'Growth', lo: 'Low', hi: 'High', goodHigh: true, hint: 'What land is worth: wealthy residents and offices want high values' },
  { o: Overlay.Desirability, label: 'Desirability', icon: 'desire', group: 'Growth', lo: 'Undesirable', hi: 'Desirable', goodHigh: true, hint: 'Where each kind of building wants to grow — and where families, seniors or students want to live' },
  { o: Overlay.Demographics, label: 'People', icon: 'people', group: 'Growth', lo: 'Few', hi: 'Many', goodHigh: true, hint: 'Who lives where: children, teens, young adults, seniors, workers, wealth' },
  { o: Overlay.Shops, label: 'Shops', icon: 'com', group: 'Growth', lo: 'None', hi: 'Plenty', goodHigh: true, hint: 'Shops within reach of homes' },
  { o: Overlay.Tourism, label: 'Tourism', icon: 'star', group: 'Growth', lo: 'Few visitors', hi: 'Crowded', goodHigh: true, hint: 'Where tourists go' },
  { o: Overlay.Nimby, label: 'Prestige', icon: 'eye', group: 'Growth', lo: 'Unwanted', hi: 'Prestigious', goodHigh: true, hint: 'Neighbourhood image: unwanted neighbours (jails, dumps) vs prestigious ones (landmarks, parks)' },
  { o: Overlay.Crime, label: 'Crime', icon: 'crime', group: 'Services', lo: 'Safe', hi: 'Dangerous', goodHigh: false, hint: 'Crime rate' },
  { o: Overlay.Police, label: 'Police', icon: 'police', group: 'Services', lo: 'None', hi: 'Full coverage', goodHigh: true, hint: 'Police patrol coverage (crime prevention)' },
  { o: Overlay.Fire, label: 'Fire', icon: 'fire', group: 'Services', lo: 'None', hi: 'Full coverage', goodHigh: true, hint: 'Fire prevention coverage' },
  { o: Overlay.Health, label: 'Health', icon: 'health', group: 'Services', lo: 'None', hi: 'Full coverage', goodHigh: true, hint: 'Care access: clinic and hospital seats within reach' },
  { o: Overlay.Education, label: 'Education', icon: 'education', group: 'Services', lo: 'None', hi: 'Full coverage', goodHigh: true, hint: 'School coverage, per tier' },
  { o: Overlay.Parks, label: 'Parks', icon: 'park', group: 'Services', lo: 'None', hi: 'Plenty', goodHigh: true, hint: 'Parks, playgrounds and sports within reach' },
  { o: Overlay.Emergency, label: 'Emergency', icon: 'siren', group: 'Services', lo: 'You dispatch', hi: 'Auto-dispatch', goodHigh: true, hint: 'Where fire trucks, police cars and ambulances arrive in time by themselves — and where you must dispatch' },
  { o: Overlay.AirPollution, label: 'Air pollution', icon: 'smog', group: 'Environment', lo: 'Clean', hi: 'Polluted', goodHigh: false, hint: 'Smog from industry, plants and traffic (drifts with the wind)' },
  { o: Overlay.WaterPollution, label: 'Water pollution', icon: 'water', group: 'Environment', lo: 'Clean', hi: 'Polluted', goodHigh: false, hint: 'Polluted ground and surface water' },
  { o: Overlay.Garbage, label: 'Garbage', icon: 'garbage', group: 'Environment', lo: 'Clean', hi: 'Piling up', goodHigh: false, hint: 'Uncollected garbage and landfill fill' },
  { o: Overlay.Noise, label: 'Noise', icon: 'noise', group: 'Environment', lo: 'Quiet', hi: 'Loud', goodHigh: false, hint: 'Noise from traffic, industry and nightlife' },
  { o: Overlay.Soil, label: 'Soil', icon: 'terrain', group: 'Environment', lo: 'Clean', hi: 'Toxic', goodHigh: false, hint: 'Soil contamination left by industry and dumps' },
  { o: Overlay.Traffic, label: 'Traffic', icon: 'car', group: 'Utilities & traffic', lo: 'Free flow', hi: 'Gridlock', goodHigh: false, hint: 'Road congestion — or trucks' },
  { o: Overlay.Transit, label: 'Transit', icon: 'bus', group: 'Utilities & traffic', lo: 'None', hi: 'Well served', goodHigh: true, hint: 'Bus, subway and train coverage' },
  { o: Overlay.Commute, label: 'Commute', icon: 'clock', group: 'Utilities & traffic', lo: 'Short', hi: 'Very long', goodHigh: false, hint: 'Minutes from each lot to work' },
  { o: Overlay.Parking, label: 'Parking', icon: 'parking', group: 'Utilities & traffic', lo: 'Easy', hi: 'Full', goodHigh: false, hint: 'Parking pressure around shops and offices' },
  { o: Overlay.Power, label: 'Power', icon: 'power', group: 'Utilities & traffic', lo: 'Unpowered', hi: 'Powered', goodHigh: true, hint: 'Power grid reach' },
  { o: Overlay.Water, label: 'Water', icon: 'waterTower', group: 'Utilities & traffic', lo: 'No water', hi: 'Supplied', goodHigh: true, hint: 'Water service — and tap water quality' },
];

export function overlayInfo(o: Overlay): OverlayInfo | undefined {
  return OVERLAYS.find((x) => x.o === o);
}

/** variant names of a data view ([] = none) */
export function overlayVariants(o: Overlay): string[] {
  return OVERLAY_VARIANTS[o] ?? [];
}

/** "Education · Elementary" (just the label without variants) */
export function overlayTitle(o: Overlay, variant = -1): string {
  const info = overlayInfo(o);
  const v = overlayVariantLabel(o, variant);
  return v ? `${info?.label ?? 'Data view'} · ${v}` : info?.label ?? 'Data view';
}

/** Desirability variant rows (short chips): residential / commercial / industrial / appeal groups */
export const DESIR_GROUPS: { label: string; short: string; from: number; to: number }[] = [
  { label: 'Residential', short: 'Res', from: 0, to: 2 },
  { label: 'Commercial', short: 'Com', from: 3, to: 7 },
  { label: 'Industrial', short: 'Ind', from: 8, to: 11 },
  { label: 'Appeal', short: 'Appeal', from: 12, to: 14 },
];

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

interface LegendLike {
  title?: string;
  stops?: { color?: unknown; label?: string }[];
  swatches?: boolean;
  notes?: string[];
  wind?: boolean;
}

/** a compass arrow pointing where the wind blows (downwind; screen up = north) */
function windHtml(st: CityState): string {
  const w = windVector(st);
  const from = windFromLabel(w);
  const to = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(w.deg / 45) % 8];
  const arrow = `<svg class="lg-wind-arrow" viewBox="0 0 24 24" width="22" height="22" style="transform:rotate(${Math.round(w.deg)}deg)"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-opacity=".28"/><path d="M12 4 L16.5 14 L12 11.6 L7.5 14 Z" fill="currentColor"/></svg>`;
  return `<div class="lg-wind" title="Prevailing wind today (it turns slowly with the seasons)">${arrow}<span>Wind from the <b>${from}</b> · smoke drifts ${to}</span></div>`;
}

/** Build legend HTML of a data view + variant from render-world's overlayLegend (or the fallback). */
export function legendHtml(o: Overlay, fromRenderer?: (o: Overlay, variant?: number) => unknown, variant = -1, st?: CityState): string {
  const info = overlayInfo(o);
  const v = resolveVariant(o, variant);
  let body = '';
  let L: LegendLike | null = null;
  if (fromRenderer) {
    try {
      L = (fromRenderer(o, v) as LegendLike) ?? null;
    } catch (e) {
      console.warn('[ui] overlayLegend failed', e);
    }
  }
  const stops = Array.isArray(L?.stops) ? L!.stops! : [];
  if (stops.length) {
    const cat = L!.swatches || o === Overlay.Zones || o === Overlay.Power || o === Overlay.None;
    if (cat) {
      body = `<div class="lg-sw">${stops.map((s) => `<span><i style="background:${colorStr(s.color)}"></i>${escapeHtml(String(s.label ?? ''))}</span>`).join('')}</div>`;
    } else {
      const css = `linear-gradient(90deg, ${stops.map((s) => colorStr(s.color)).join(', ')})`;
      body = `<div class="lg-grad" style="background:${css}"></div><div class="lg-ends">${stops.map((s) => `<span>${escapeHtml(String(s.label ?? ''))}</span>`).join('')}</div>`;
    }
  } else if (info) {
    if (o === Overlay.Zones) {
      const z: [string, string][] = [['#57d17f', 'Residential'], ['#3d8bff', 'Commercial'], ['#f0b429', 'Industrial'], ['#c3cf62', 'Agriculture'], ['#9c7a55', 'Landfill']];
      body = `<div class="lg-sw">${z.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
    } else if (o === Overlay.Power || o === Overlay.Water) {
      body = `<div class="lg-sw"><span><i style="background:#3cbe5a"></i>${info.hi}</span><span><i style="background:#dc3c3c"></i>${info.lo}</span></div>`;
    } else {
      body = `<div class="lg-grad" style="background:${info.goodHigh ? BAD_GOOD : GOOD_BAD}"></div><div class="lg-ends"><span>${info.lo}</span><span>${info.hi}</span></div>`;
    }
  }
  const extra: string[] = [];
  if (st && o === Overlay.Commute) extra.push(`<div class="lg-note">Scale 0 – ${Math.round(commuteScale(st))} min (3 × the city average).</div>`);
  for (const n of L?.notes ?? []) extra.push(`<div class="lg-note">${escapeHtml(n)}</div>`);
  if (st && L?.wind) extra.push(windHtml(st));
  return body + extra.join('');
}
