/**
 * Seasonal variants of the deciduous tree models (nature.ts) and the month -> season mix used by every renderer that
 * draws them (forest TreeRenderer, street / median trees in PropRenderer). Pure data + tiny helpers, no three.js.
 *
 * Variant layout (manifest `variants` counts all of them):
 *   tree_oak   0 1 2 green | 3 autumn orange | 4 green | 5 autumn red | 6 bare winter
 *   tree_maple 0 green | 1 autumn orange | 2 autumn red | 3 green | 4 bare winter | 5 spring blossom
 *   tree_birch 0 1 2 green | 3 autumn yellow | 4 bare winter
 * The first four variants keep the old contract of TreeRenderer (green ones + at most one autumn-coloured one that it
 * detects by colour), so forests keep working unchanged until a renderer adopts seasonMix()/seasonalVariant().
 *
 * Month mix (temperate / alpine; tropical and desert never change):
 *   autumn  Sep 0.3, Oct 0.8, Nov 0.55
 *   bare    Nov 0.2, Dec-Feb 0.85, Mar 0.4
 *   blossom Apr 0.15 (maple only)
 */

export interface SeasonSet {
  green: readonly number[];
  autumn: readonly number[];
  bare: readonly number[];
  blossom: readonly number[];
}

export const SEASONAL_TREES: Readonly<Record<string, SeasonSet>> = {
  tree_oak: { green: [0, 1, 2, 4], autumn: [3, 5], bare: [6], blossom: [] },
  tree_maple: { green: [0, 3], autumn: [1, 2], bare: [4], blossom: [5] },
  tree_birch: { green: [0, 1, 2], autumn: [3], bare: [4], blossom: [] },
};

export interface SeasonMix {
  autumn: number;
  bare: number;
  blossom: number;
}

const NONE: SeasonMix = { autumn: 0, bare: 0, blossom: 0 };

/** fractions of deciduous trees showing autumn colours / bare branches / blossom in `month` (0 = Jan) */
export function seasonMix(month: number, climate = 'temperate'): SeasonMix {
  if (climate === 'tropical' || climate === 'desert') return NONE;
  const m = ((Math.floor(month) % 12) + 12) % 12;
  const autumn = m === 8 ? 0.3 : m === 9 ? 0.8 : m === 10 ? 0.55 : 0;
  const bare = m === 11 || m <= 1 ? 0.85 : m === 10 ? 0.2 : m === 2 ? 0.4 : 0;
  const blossom = m === 3 ? 0.15 : 0;
  return { autumn, bare, blossom };
}

/**
 * Variant to draw for one tree: `variant` is the tree's base (all-year) variant, `r` a stable per-tree random in
 * [0, 1). Non-seasonal models return `variant` unchanged; seasonal ones map it onto their green list outside the
 * seasonal fractions (so any base variant index is safe, e.g. `hash % 4`).
 */
export function seasonalVariant(id: string, variant: number, r: number, mix: SeasonMix): number {
  const s = SEASONAL_TREES[id];
  if (!s) return variant;
  const sub = (l: readonly number[]) => l[Math.floor(((r * 7.31) % 1) * l.length) % l.length];
  let t = r;
  if (s.bare.length && t < mix.bare) return sub(s.bare);
  t -= mix.bare;
  if (s.autumn.length && t >= 0 && t < mix.autumn) return sub(s.autumn);
  t -= mix.autumn;
  if (s.blossom.length && t >= 0 && t < mix.blossom) return sub(s.blossom);
  const g = s.green;
  return g[((variant % g.length) + g.length) % g.length];
}

/**
 * Current season, published by the world view (month + climate) for renderers that have no CityState of their own
 * (PropRenderer's street trees). `version` bumps whenever the resulting mix changes.
 */
export const treeSeason = { month: 5, climate: 'temperate', mix: NONE as SeasonMix, version: 0 };

export function setTreeSeason(month: number, climate: string): void {
  if (month === treeSeason.month && climate === treeSeason.climate) return;
  treeSeason.month = month;
  treeSeason.climate = climate;
  const m = seasonMix(month, climate);
  const o = treeSeason.mix;
  if (m.autumn !== o.autumn || m.bare !== o.bare || m.blossom !== o.blossom) {
    treeSeason.mix = m;
    treeSeason.version++;
  }
}
