/** Headless R2 source and quiet-slot timing. Visuals are deterministic stand-ins, shared by both paths. */
import { CELL_SIZE } from '../../src/core/constants';
import { BF, type CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { collectLaunchSites, collectWaterfrontSites, LaunchSiteIndex, type LaunchSite, type SiteSource } from '../../src/render/city/effects/Fireworks';

export function fireworksSiteSource(st: CityState): SiteSource {
  return {
    get buildings() { return st.buildings.values(); },
    defOf: getDef,
    visualOf: (id) => {
      const b = st.buildings.get(id);
      if (!b) return null;
      const height = b.flags & BF.Burnt ? 3 : 24 + (b.capacity % 200) + b.variant * 8;
      return { cx: (b.x + b.w / 2) * CELL_SIZE, cz: (b.z + b.d / 2) * CELL_SIZE, baseY: b.baseY, top: b.baseY + height };
    },
    size: st.size, water: st.water, cellSize: CELL_SIZE,
    groundAt: (x, z) => st.heightAt(x, z, CELL_SIZE),
    network: st.network, building: st.building,
  };
}

/** Call with an already loaded CityState. Ms are per-call means; buildMs is one build, outside newYearMs. */
export function timeLaunchSites(st: CityState, iterations = 20) {
  if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError('iterations must be a positive integer');
  const src = fireworksSiteSource(st);
  const time = (fn: () => LaunchSite[]) => {
    let sites: LaunchSite[] = [];
    const start = performance.now();
    for (let i = 0; i < iterations; i++) sites = fn();
    return { ms: (performance.now() - start) / iterations, sites };
  };
  const full = time(() => collectLaunchSites(src));
  const start = performance.now();
  const index = new LaunchSiteIndex(src);
  const buildMs = performance.now() - start;
  const incremental = time(() => index.collect(src));
  // Bounds setup is outside the isolated waterfront measurement (the production index maintains them).
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, cw = 0;
  for (const b of st.buildings.values()) {
    x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.w);
    z0 = Math.min(z0, b.z); z1 = Math.max(z1, b.z + b.d);
    cw += 1 + b.pop + b.jobs;
  }
  if (cw <= 0) { x0 = z0 = st.size * 0.35; x1 = z1 = st.size * 0.65; }
  const waterfront = time(() => collectWaterfrontSites(src, { x0, x1, z0, z1 }));
  const identical = full.sites.length === incremental.sites.length && full.sites.every((a, i) => {
    const b = incremental.sites[i];
    return a.kind === b.kind && Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z) && Object.is(a.weight, b.weight);
  });
  index.clear();
  return { buildings: st.buildings.size, sites: full.sites.length, iterations, fullScanMs: full.ms, buildMs,
    newYearMs: incremental.ms, waterfrontMs: waterfront.ms, identical };
}
