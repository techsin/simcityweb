/** Summaries of a city for the region view (headless-safe). */
import type { CityState } from '../sim/CityState';
import { DevType } from '../core/types';
import type { RegionCitySummary } from './types';

/** approximate building height (m) from its capacity density (models are owned by render-city) */
export function estimateBuildingHeight(capacity: number, w: number, d: number, def = ''): number {
  const per = capacity / Math.max(1, w * d);
  if (per <= 0) return /landmark|tower|stadium/.test(def) ? 45 : 11;
  return Math.max(4, Math.min(250, 4 + per * 0.35));
}

export function encodeBytes(a: Uint8Array): string {
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}

export function decodeBytes(s: string): Uint8Array {
  const b = atob(s);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** coarse skyline grid: (size/8)^2 bytes, value = max building height / 2 (m) per 8x8-cell block */
export function skylineGrid(st: CityState): Uint8Array {
  const g = Math.max(1, Math.floor(st.size / 8));
  const out = new Uint8Array(g * g);
  for (const b of st.buildings.values()) {
    if (b.built < 0.3) continue;
    const hgt = estimateBuildingHeight(b.capacity, b.w, b.d, b.def);
    const v = Math.min(255, Math.round(hgt / 2));
    const cx = Math.min(g - 1, Math.floor((b.x + b.w / 2) / 8)), cz = Math.min(g - 1, Math.floor((b.z + b.d / 2) / 8));
    const k = cz * g + cx;
    if (v > out[k]) out[k] = v;
  }
  return out;
}

export function summarizeCity(st: CityState, prev?: Partial<RegionCitySummary>): RegionCitySummary {
  const s = st.stats;
  const jobs = s.jobsByDev ?? [];
  let c = 0, i = 0;
  for (let k = DevType.CS1; k <= DevType.CO3; k++) c += jobs[k] ?? 0;
  for (let k = DevType.IA; k <= DevType.IHT; k++) i += jobs[k] ?? 0;
  let pop = s.population ?? 0;
  if (!pop) for (const b of st.buildings.values()) pop += b.pop ?? 0;
  const r = s.residents ? s.residents[0] + s.residents[1] + s.residents[2] : pop;
  const now = Date.now();
  return {
    name: st.config.name,
    mayor: st.config.mayor,
    population: Math.round(pop),
    r: Math.round(r || pop),
    c: Math.round(c),
    i: Math.round(i),
    funds: Math.round(st.funds),
    thumbnail: prev?.thumbnail,
    lastPlayed: now,
    founded: prev?.founded ?? now,
    difficulty: st.config.difficulty,
    year: st.year,
    skyline: encodeBytes(skylineGrid(st)),
  };
}
