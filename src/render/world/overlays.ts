/**
 * Data-view overlays: per-cell values (0..1 packed into a Uint8 DataTexture, bilinear filtered on the terrain)
 * + a color ramp (RGBA, alpha = coverage) + UI legend. Pure functions, no GPU state.
 */
import { Network, Overlay, Zone, isRoad } from '../../core/types';
import type { CityState } from '../../sim/CityState';
import { overlayLayer } from '../../sim/infra/overlays';

export interface RampStop {
  t: number;
  color: string;
  a?: number;
}

export interface OverlayDef {
  title: string;
  /** Simulation 'layerUpdated' names that should refresh this overlay */
  layers: string[];
  ramp: RampStop[];
  legend: { color: string; label: string }[];
}

const COVERAGE = (title: string, color: string, light: string): OverlayDef => ({
  title,
  layers: ['services'],
  ramp: [
    { t: 0, color: '#6b6f78', a: 0.18 },
    { t: 0.08, color: light, a: 0.35 },
    { t: 0.6, color, a: 0.72 },
    { t: 1, color, a: 0.85 },
  ],
  legend: [
    { color: '#6b6f78', label: 'None' },
    { color: light, label: 'Weak' },
    { color, label: 'Strong' },
  ],
});

const BAD = (title: string, layers: string[], c1: string, c2: string, c3: string, labels = ['Low', 'Medium', 'High']): OverlayDef => ({
  title,
  layers,
  ramp: [
    { t: 0, color: c1, a: 0 },
    { t: 0.06, color: c1, a: 0.0 },
    { t: 0.25, color: c1, a: 0.55 },
    { t: 0.6, color: c2, a: 0.72 },
    { t: 1, color: c3, a: 0.82 },
  ],
  legend: [
    { color: c1, label: labels[0] },
    { color: c2, label: labels[1] },
    { color: c3, label: labels[2] },
  ],
});

export const OVERLAYS: Record<Overlay, OverlayDef> = {
  [Overlay.None]: { title: 'None', layers: [], ramp: [{ t: 0, color: '#000000', a: 0 }, { t: 1, color: '#000000', a: 0 }], legend: [] },
  [Overlay.Zones]: {
    title: 'Zones',
    layers: [],
    ramp: [{ t: 0, color: '#000000', a: 0 }, { t: 1, color: '#000000', a: 0 }],
    legend: [
      { color: '#7fd66b', label: 'Residential (low)' },
      { color: '#2f9e3a', label: 'Residential (high)' },
      { color: '#6fa8e8', label: 'Commercial (low)' },
      { color: '#2456b8', label: 'Commercial (high)' },
      { color: '#f0d45a', label: 'Industrial (low)' },
      { color: '#c9901e', label: 'Industrial (high)' },
      { color: '#9a7a5a', label: 'Landfill' },
    ],
  },
  [Overlay.Traffic]: {
    title: 'Traffic',
    layers: ['traffic'],
    ramp: [
      { t: 0, color: '#3fbf5a', a: 0 },
      { t: 0.015, color: '#3fbf5a', a: 0.0 },
      { t: 0.05, color: '#3fbf5a', a: 0.85 },
      { t: 0.45, color: '#e8d840', a: 0.9 },
      { t: 0.75, color: '#ef8a2a', a: 0.92 },
      { t: 1, color: '#d42a2a', a: 0.95 },
    ],
    legend: [
      { color: '#3fbf5a', label: 'Free flow' },
      { color: '#e8d840', label: 'Busy' },
      { color: '#ef8a2a', label: 'Heavy' },
      { color: '#d42a2a', label: 'Jammed' },
    ],
  },
  [Overlay.AirPollution]: BAD('Air Pollution', ['pollution'], '#d6cf62', '#b87a34', '#5e2a22'),
  [Overlay.WaterPollution]: BAD('Water Pollution', ['pollution'], '#8fd0a8', '#5a8f3c', '#3b4418'),
  [Overlay.Garbage]: BAD('Garbage', ['pollution'], '#d9c07a', '#a8703a', '#5e3a1e'),
  [Overlay.LandValue]: {
    title: 'Land Value',
    layers: ['landValue', 'desirability'],
    ramp: [
      { t: 0, color: '#9c3b2a', a: 0.55 },
      { t: 0.3, color: '#dcb65a', a: 0.6 },
      { t: 0.6, color: '#46b35a', a: 0.68 },
      { t: 1, color: '#1b6fb0', a: 0.78 },
    ],
    legend: [
      { color: '#9c3b2a', label: 'Low ($)' },
      { color: '#dcb65a', label: 'Medium' },
      { color: '#46b35a', label: 'High ($$)' },
      { color: '#1b6fb0', label: 'Very high ($$$)' },
    ],
  },
  [Overlay.Crime]: BAD('Crime', ['crime', 'services'], '#e3c64e', '#d65a2a', '#7a1a4a'),
  [Overlay.Police]: COVERAGE('Police Coverage', '#2d5fd6', '#8fb0f0'),
  [Overlay.Fire]: COVERAGE('Fire Coverage', '#d9412b', '#f0a08a'),
  [Overlay.Health]: COVERAGE('Health Coverage', '#d6457e', '#f0a0c0'),
  [Overlay.Education]: COVERAGE('Education Coverage', '#8a52d6', '#c8a8f0'),
  [Overlay.Power]: {
    title: 'Power',
    layers: ['utilities'],
    ramp: [
      { t: 0, color: '#000000', a: 0 },
      { t: 0.3, color: '#000000', a: 0 },
      { t: 0.5, color: '#d9412b', a: 0.8 },
      { t: 0.62, color: '#d9412b', a: 0.8 },
      { t: 0.85, color: '#ffd84a', a: 0.75 },
      { t: 1, color: '#ffd84a', a: 0.75 },
    ],
    legend: [
      { color: '#ffd84a', label: 'Powered' },
      { color: '#d9412b', label: 'No power' },
    ],
  },
  [Overlay.Water]: {
    title: 'Water Supply',
    layers: ['utilities'],
    ramp: [
      { t: 0, color: '#000000', a: 0 },
      { t: 0.3, color: '#000000', a: 0 },
      { t: 0.5, color: '#d9412b', a: 0.8 },
      { t: 0.62, color: '#d9412b', a: 0.8 },
      { t: 0.85, color: '#3aa0e6', a: 0.75 },
      { t: 1, color: '#3aa0e6', a: 0.75 },
    ],
    legend: [
      { color: '#3aa0e6', label: 'Water service' },
      { color: '#d9412b', label: 'No water' },
    ],
  },
  [Overlay.Desirability]: {
    title: 'Desirability',
    layers: ['desirability'],
    ramp: [
      { t: 0, color: '#c8322a', a: 0.75 },
      { t: 0.35, color: '#e89a5a', a: 0.45 },
      { t: 0.5, color: '#d8d8c8', a: 0.08 },
      { t: 0.65, color: '#8fd07a', a: 0.45 },
      { t: 1, color: '#1f9a4a', a: 0.8 },
    ],
    legend: [
      { color: '#c8322a', label: 'Undesirable' },
      { color: '#d8d8c8', label: 'Neutral' },
      { color: '#1f9a4a', label: 'Desirable' },
    ],
  },
  [Overlay.Noise]: BAD('Noise', ['pollution', 'traffic'], '#dbb05a', '#c2482e', '#6a1f5a', ['Quiet', 'Noisy', 'Very noisy']),
  [Overlay.Transit]: COVERAGE('Transit Coverage', '#1f9fb0', '#8fd6e0'),
  // SIM_DEPTH_SPEC overlays: Phase 0 placeholders (WP5 owns the final ramps / legends / data wiring)
  [Overlay.Parks]: COVERAGE('Parks & Recreation', '#3a9a3a', '#a8dca0'),
  [Overlay.Commute]: BAD('Commute Time', ['catchments', 'traffic'], '#dbb05a', '#c2482e', '#6a1f5a', ['Short', 'Long', 'Very long']),
  [Overlay.Shops]: COVERAGE('Shop Access', '#c07a2a', '#ecc890'),
  [Overlay.Demographics]: COVERAGE('Demographics', '#7a5ac0', '#c8b8ec'),
  [Overlay.Tourism]: COVERAGE('Tourism', '#d0508a', '#f0b8d0'),
  [Overlay.Nimby]: BAD('NIMBY / YIMBY', ['catchments'], '#dbb05a', '#c2482e', '#6a1f5a', ['Mild', 'Unwanted', 'Very unwanted']),
  [Overlay.Soil]: BAD('Soil Contamination', ['pollution'], '#c8b070', '#8a6a30', '#4a3010', ['Low', 'Medium', 'High']),
  [Overlay.Emergency]: COVERAGE('Emergency Response', '#d83a3a', '#f0a8a8'),
  [Overlay.Parking]: BAD('Parking Pressure', ['traffic'], '#dbb05a', '#c2482e', '#6a1f5a', ['Low', 'Medium', 'High']),
};

/** Legend for the UI (title + color stops). */
export function overlayLegend(o: Overlay): { title: string; stops: { color: string; label: string }[] } {
  const d = OVERLAYS[o] ?? OVERLAYS[Overlay.None];
  return { title: d.title, stops: d.legend.map((s) => ({ ...s })) };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fill `out` (Uint8, N*N) with the overlay value per cell (0..255). */
export function computeOverlayValues(state: CityState, o: Overlay, out: Uint8Array): void {
  const C = state.cells;
  // preferred data source: the simulation's overlay layer definition (data + normalisation scale)
  if (o !== Overlay.Power && o !== Overlay.Water) {
    const L = overlayLayer(state, o);
    if (L && L.data && L.data.length >= C) {
      const d = L.data, inv = 1 / (L.scale || 1);
      if (L.roadsOnly) {
        const net = state.network;
        for (let i = 0; i < C; i++) out[i] = net[i] !== 0 && net[i] !== Network.Rail ? Math.round((0.05 + 0.95 * clamp01(d[i] * inv)) * 255) : 0;
      } else if (L.palette === 'diverging') {
        for (let i = 0; i < C; i++) out[i] = Math.round(clamp01(0.5 + 0.5 * d[i] * inv) * 255);
      } else {
        for (let i = 0; i < C; i++) out[i] = Math.round(clamp01(d[i] * inv) * 255);
      }
      return;
    }
  }
  const put = (arr: Float32Array) => {
    for (let i = 0; i < C; i++) out[i] = Math.round(clamp01(arr[i]) * 255);
  };
  switch (o) {
    case Overlay.Traffic: {
      const net = state.network, cg = state.congestion;
      for (let i = 0; i < C; i++) out[i] = isRoad(net[i] as Network) ? Math.round((0.05 + 0.95 * clamp01(cg[i] / 1.2)) * 255) : 0;
      return;
    }
    case Overlay.AirPollution: return put(state.airPollution);
    case Overlay.WaterPollution: return put(state.waterPollution);
    case Overlay.Garbage: return put(state.garbage);
    case Overlay.LandValue: return put(state.landValue);
    case Overlay.Crime: return put(state.crime);
    case Overlay.Police: return put(state.policeCov);
    case Overlay.Fire: return put(state.fireCov);
    case Overlay.Health: return put(state.healthCov);
    case Overlay.Education: return put(state.eduCov);
    case Overlay.Transit: return put(state.transitCov);
    case Overlay.Noise: return put(state.noise);
    case Overlay.Power:
    case Overlay.Water: {
      const svc = o === Overlay.Power ? state.powered : state.watered;
      for (let i = 0; i < C; i++) {
        const needs = state.building[i] >= 0 || state.zone[i] !== Zone.None;
        out[i] = svc[i] ? 255 : needs ? 128 : 0;
      }
      return;
    }
    case Overlay.Desirability: {
      const ds = state.desirability;
      const n = ds.length;
      for (let i = 0; i < C; i++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += ds[k][i];
        out[i] = Math.round(clamp01(0.5 + 0.5 * (s / n)) * 255);
      }
      return;
    }
    default:
      out.fill(0);
  }
}

/** Zone tint colors (sRGB hex) indexed by Zone. Lighter = low density, darker = high density. */
export const ZONE_COLORS: Record<number, number> = {
  [Zone.None]: 0x000000,
  [Zone.ResLow]: 0x86e070,
  [Zone.ResMed]: 0x4fc04a,
  [Zone.ResHigh]: 0x2a9434,
  [Zone.ComLow]: 0x7ab4f0,
  [Zone.ComMed]: 0x4a86dc,
  [Zone.ComHigh]: 0x2456b8,
  [Zone.IndAg]: 0xd8e070,
  [Zone.IndMed]: 0xf0cc4a,
  [Zone.IndHigh]: 0xd0921e,
  [Zone.Landfill]: 0x9a7a5a,
};
