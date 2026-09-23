/**
 * Prevailing wind (SIM_DEPTH_SPEC WP3 C2). Deterministic from the city seed and the day, so the plume drift in
 * pollution.ts, the render smoke (WP5 Effects uWind) and the legend arrow all agree.
 *
 *  - prevailing heading theta0 = hash(seed) in [0, 2 pi)
 *  - daily heading theta = theta0 + 0.6 sin(2 pi day / 360) + 0.25 sin(0.21 day)   (about +-40 deg around theta0)
 *  - strength 0.7 .. 1.0 (gusty: 0.85 + 0.15 sin(0.13 day + phase))
 * The vector (x, z) points DOWNWIND (the direction the wind blows towards, i.e. where the smoke goes), length = strength.
 * `deg` is the compass bearing of that direction (0 = north / -z, 90 = east / +x).
 * Headless: no DOM / three.js.
 */
import type { CityState } from '../CityState';
import { hash2 } from '../../core/rng';

export interface WindVector {
  /** downwind direction x strength (cells / unit): +x = east, +z = south */
  x: number;
  z: number;
  /** compass bearing (degrees) the wind blows towards: 0 north (-z), 90 east (+x), 180 south (+z), 270 west */
  deg: number;
  /** 0.7 .. 1.0 */
  strength: number;
}

/** prevailing (seed) heading in radians, angle measured in the x/z plane from +x towards +z */
export function prevailingHeading(st: CityState): number {
  return hash2(st.config.seed | 0, 0x57a1d, 7) * Math.PI * 2;
}

/** wind of day `day` (default: today) */
export function windVector(st: CityState, day: number = st.day): WindVector {
  const th0 = prevailingHeading(st);
  const th = th0 + 0.6 * Math.sin((2 * Math.PI * day) / 360) + 0.25 * Math.sin(0.21 * day);
  const phase = hash2(st.config.seed | 0, 0x9e37, 11) * Math.PI * 2;
  const strength = 0.85 + 0.15 * Math.sin(0.13 * day + phase);
  const dx = Math.cos(th), dz = Math.sin(th);
  let deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return { x: dx * strength, z: dz * strength, deg, strength };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** "SW" style label of the direction the wind comes FROM (weather-report convention), e.g. for the legend */
export function windFromLabel(w: WindVector): string {
  const from = (w.deg + 180) % 360;
  return COMPASS[Math.round(from / 45) % 8];
}
