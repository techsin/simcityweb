/** Round 2–3 art interfaces: neutral massing with a geometric STUB label, replaced by the content lanes. */
import type { ModelBuilder } from '../ModelBuilder';
import type { ModelBuildFn, ModelBuilders } from '../registry';
import { CELL_SIZE } from '../../core/constants';

const STUB = ['111 111 101 110', '100 010 101 101', '111 010 101 110', '001 010 101 101', '111 010 111 110'];
const LEVELS: Record<number, string[]> = {
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
};

/** Flat lettering faces +Z; the roof copy is rotated to face +Y. No textures or separate materials. */
function label(b: ModelBuilder, rows: string[], unit: number): void {
  b.paint(0x303030);
  for (let row = 0; row < rows.length; row++) {
    for (const run of rows[row].matchAll(/1+/g)) {
      const x0 = (run.index - rows[row].length / 2) * unit, x1 = x0 + run[0].length * unit;
      const y0 = (rows.length / 2 - row - 1) * unit, y1 = y0 + unit;
      b.quad([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]);
    }
  }
}

function massing(size?: [number, number], level?: number): ModelBuildFn {
  return (b, variant, _rng, entry) => {
    const w = (size?.[0] ?? entry.footprint[0] * CELL_SIZE - 3) * (variant ? 0.82 : 1);
    const d = (size?.[1] ?? entry.footprint[1] * CELL_SIZE - 3) * (variant ? 0.9 : 1);
    const t = entry.variants > 1 ? variant / (entry.variants - 1) : 0.5;
    const h = entry.height[0] + (entry.height[1] - entry.height[0]) * t;
    b.paint(0xb6b6b6).boxC(0, 0, w, d, 0, h);
    const rows = level ? STUB.map((row, i) => row + ' ' + LEVELS[level][i]) : STUB;
    const frontUnit = Math.min(w * 0.8 / rows[0].length, h * 0.7 / rows.length);
    b.push().translate(0, h / 2, d / 2 + 0.02);
    label(b, rows, frontUnit);
    b.pop();
    const roofUnit = Math.min(w * 0.8 / rows[0].length, d * 0.7 / rows.length);
    b.push().translate(0, h + 0.02, 0).rotateX(-Math.PI / 2);
    label(b, rows, roofUnit);
    b.pop();
  };
}

const building = massing();
export const models: ModelBuilders = {
  // LG-03 projects, including the Expo's permanent tower.
  tr_express_metro: building,
  util_fusion_plant: building,
  lm_world_expo: building,
  lm_expo_tower: building,
  rw_space_center: building,
  // LG-04 arcologies.
  com_business_arcology: building,
  res_arcology: building,
  res_arcology_mixed: building,
  // LG-19 uses the badge option for facilities; park upgrades keep the original 1x1 lot.
  facility_level_2: massing([2, 0.4], 2),
  facility_level_3: massing([2, 0.4], 3),
  park_small_level_2: massing(undefined, 2),
  park_small_level_3: massing(undefined, 3),
  // LG-20 honours and LG-15 preparedness.
  park_eco_plaza: building,
  lm_firefighters_memorial: building,
  rw_honour_plaque: massing([2, 0.6]),
  civ_emergency_operations_center: building,
  // FEEL-17 bags / bins and FEEL-18 abandonment sign.
  garbage_pile: massing([1.4, 1.2]),
  for_lease_sign: massing([2.4, 0.3]),
};
