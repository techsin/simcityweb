/**
 * Overlay support: maps a data-view Overlay to the CityState layer that backs it, with a normalisation scale and a
 * palette hint, so renderers / the query tool can draw & read any data view uniformly.
 */
import { DevType, Overlay } from '../../core/types';
import type { CityState } from '../CityState';

export interface OverlayLayer {
  /** per-cell values (i = z*N + x) */
  data: ArrayLike<number>;
  /** value mapped to full intensity (normalised = value / scale, clamp 0..1; diverging: -scale..scale) */
  scale: number;
  /** 'bad': high = bad (red), 'good': high = good (green/blue), 'binary': 0/1 (e.g. power), 'diverging': -1..1 */
  palette: 'bad' | 'good' | 'binary' | 'diverging';
  /** only meaningful on road / rail cells (traffic) */
  roadsOnly?: boolean;
  label: string;
}

/** the layer behind an overlay, or null (None / Zones are drawn by the renderer from zone data) */
export function overlayLayer(st: CityState, o: Overlay): OverlayLayer | null {
  switch (o) {
    case Overlay.Traffic: return { data: st.congestion, scale: 1.2, palette: 'bad', roadsOnly: true, label: 'Traffic (volume / capacity)' };
    case Overlay.AirPollution: return { data: st.airPollution, scale: 1, palette: 'bad', label: 'Air pollution' };
    case Overlay.WaterPollution: return { data: st.waterPollution, scale: 1, palette: 'bad', label: 'Water pollution' };
    case Overlay.Garbage: return { data: st.garbage, scale: 1, palette: 'bad', label: 'Garbage' };
    case Overlay.LandValue: return { data: st.landValue, scale: 1, palette: 'good', label: 'Land value' };
    case Overlay.Crime: return { data: st.crime, scale: 1, palette: 'bad', label: 'Crime' };
    case Overlay.Police: return { data: st.policeCov, scale: 1, palette: 'good', label: 'Police coverage' };
    case Overlay.Fire: return { data: st.fireCov, scale: 1, palette: 'good', label: 'Fire coverage' };
    case Overlay.Health: return { data: st.healthCov, scale: 1, palette: 'good', label: 'Health coverage' };
    case Overlay.Education: return { data: st.eduCov, scale: 1, palette: 'good', label: 'Education coverage' };
    case Overlay.Power: return { data: st.powered, scale: 1, palette: 'binary', label: 'Power' };
    case Overlay.Water: return { data: st.watered, scale: 1, palette: 'binary', label: 'Water' };
    case Overlay.Desirability: return { data: st.desirability[DevType.R2], scale: 1, palette: 'diverging', label: 'Desirability (R$$)' };
    case Overlay.Noise: return { data: st.noise, scale: 1, palette: 'bad', label: 'Noise' };
    case Overlay.Transit: return { data: st.transitCov, scale: 1, palette: 'good', label: 'Transit coverage' };
    default: return null;
  }
}

/** normalised overlay value at a cell (0..1; diverging overlays return -1..1), 0 when out of bounds / no layer */
export function overlayValue(st: CityState, o: Overlay, x: number, z: number): number {
  if (!st.inBounds(x, z)) return 0;
  const L = overlayLayer(st, o);
  if (!L) return 0;
  const v = L.data[z * st.size + x] / L.scale;
  if (L.palette === 'diverging') return v < -1 ? -1 : v > 1 ? 1 : v;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
