/**
 * NEW-01 QA round 3: the re-paletted facade models differ as a whole in every variant, mirrored twins included.
 * The measure is the QA's (qa/T072 "what the eye sees"): per variant the area-weighted mean wall and roof colours in
 * CIE Lab, the massing height and extents and the share of the roof that slopes; two variants of a model look alike
 * when both colours are within dE T (CIE76; the QA used 15, with 10 and 20 for sensitivity) and the massing matches.
 */
import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { getModelGeometry } from '../../src/assets/registry';

registerAllModels();

interface Look { wall: number[]; roof: number[]; h: number; ext: [number, number]; sloped: number }

/** linear rgb -> Lab (D65) */
function lab(r: number, g: number, b: number): number[] {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047), y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function look(g: BufferGeometry): Look {
  const P = g.getAttribute('position').array, N = g.getAttribute('normal').array, C = g.getAttribute('color').array;
  let H = 0;
  for (let i = 1; i < P.length; i += 3) if (P[i] > H) H = P[i];
  const wall = [0, 0, 0, 0], roof = [0, 0, 0, 0];
  let sloped = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let t = 0; t < P.length; t += 9) {
    const ux = P[t + 3] - P[t], uy = P[t + 4] - P[t + 1], uz = P[t + 5] - P[t + 2], vx = P[t + 6] - P[t], vy = P[t + 7] - P[t + 1], vz = P[t + 8] - P[t + 2];
    const A = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (!(A > 1e-6)) continue;
    const yc = (P[t + 1] + P[t + 4] + P[t + 7]) / 3, n = (N[t + 1] + N[t + 4] + N[t + 7]) / 3;
    if (yc < 0.7) continue; // lot paving, lawns, kerbs
    if (yc > 2) for (const k of [0, 3, 6]) { x0 = Math.min(x0, P[t + k]); x1 = Math.max(x1, P[t + k]); z0 = Math.min(z0, P[t + k + 2]); z1 = Math.max(z1, P[t + k + 2]); }
    const a = n > 0.35 && yc > 0.45 * H ? roof : Math.abs(n) <= 0.35 ? wall : null;
    if (!a) continue;
    for (let c = 0; c < 3; c++) a[c] += ((C[t + c] + C[t + 3 + c] + C[t + 6 + c]) / 3) * A;
    a[3] += A;
    if (a === roof && n < 0.95) sloped += A;
  }
  return {
    wall: lab(wall[0] / wall[3], wall[1] / wall[3], wall[2] / wall[3]), roof: lab(roof[0] / roof[3], roof[1] / roof[3], roof[2] / roof[3]),
    h: H, ext: [x1 - x0, z1 - z0], sloped: sloped / roof[3],
  };
}

const dE = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sameMassing = (a: Look, b: Look) => Math.abs(a.h - b.h) <= 2 && Math.abs(a.ext[0] - b.ext[0]) <= 2 && Math.abs(a.ext[1] - b.ext[1]) <= 2 && Math.abs(a.sloped - b.sloped) < 0.3;
const alike = (a: Look, b: Look, T: number) => sameMassing(a, b) && dE(a.wall, b.wall) < T && dE(a.roof, b.roof) < T;
const looks = (id: string) => Array.from({ length: MANIFEST_BY_ID[id].variants }, (_, v) => look(getModelGeometry(id, v)));
/** pairs of variants that look alike at T */
function alikePairs(id: string, T: number): string[] {
  const ls = looks(id), out: string[] = [];
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    if (alike(ls[i], ls[j], T)) out.push(`#${i} / #${j}: wall dE ${dE(ls[i].wall, ls[j].wall).toFixed(1)}, roof dE ${dE(ls[i].roof, ls[j].roof).toFixed(1)}`);
  }
  return out;
}

/** the models finding F1 names: their first palettes were one mix in another order, or shades of one hue */
const REDONE = ['res_rowhouses_hip', 'res_rowhouses_gables', 'res_rowhouses_mansard', 'res_walkup_monitor', 'res_walkup_gables', 'com_boutique_terrace'];

describe('NEW-01 round 3 palettes', () => {
  it.each(REDONE)('%s: no two variants look alike, mirrored twins included (dE 20, the loosest threshold of the QA)', (id) => {
    expect(alikePairs(id, 20)).toEqual([]);
    expect(alikePairs(id, 15)).toEqual([]);
  });

  it.each(REDONE)('%s: a mirrored twin keeps the walls of its variant and takes another roof', (id) => {
    const e = MANIFEST_BY_ID[id], ls = looks(id), bv = e.buildVariants!;
    expect(e.mirror).toBe(true);
    expect(e.variants).toBe(2 * bv);
    for (let v = 0; v < bv; v++) {
      expect(dE(ls[v].wall, ls[v + bv].wall), `${id} #${v} walls`).toBeLessThan(5);
      expect(dE(ls[v].roof, ls[v + bv].roof), `${id} #${v} roofs`).toBeGreaterThan(20);
    }
  });

  it.each(REDONE)('%s: its wall families span pale, mid-tone and dark, and its roofs at least three colour families', (id) => {
    const ls = looks(id), L = ls.map((l) => l.wall[0]);
    expect(Math.max(...L) - Math.min(...L), 'wall lightness range').toBeGreaterThan(30);
    // roofs: greedy families at dE 20
    const fams: number[][] = [];
    for (const l of ls) if (!fams.some((f) => dE(f, l.roof) < 20)) fams.push(l.roof);
    expect(fams.length).toBeGreaterThanOrEqual(3);
  });

  it('the measure can fail: the hip walk-up and the two boutiques left as they were still repeat a look in their mirrored twins', () => {
    for (const id of ['res_walkup_hip', 'com_boutique_hip', 'com_boutique_gable']) {
      const bv = MANIFEST_BY_ID[id].buildVariants!;
      expect(alikePairs(id, 15).length, id).toBeGreaterThanOrEqual(bv);
    }
  });

  it('keeps the triangle counts of the round-2 shapes (the terrace boutique drops its hidden roof and separate deck)', () => {
    const tris = (id: string) => [...new Set(Array.from({ length: MANIFEST_BY_ID[id].variants }, (_, v) => getModelGeometry(id, v).getAttribute('position').count / 3))].sort((a, b) => a - b);
    expect(tris('res_rowhouses_hip')).toEqual([752]);
    expect(tris('res_rowhouses_gables')).toEqual([934]);
    expect(tris('res_rowhouses_mansard')).toEqual([902]);
    expect(Math.max(...tris('res_walkup_monitor'), ...tris('res_walkup_gables'))).toBe(461);
    expect(Math.max(...tris('com_boutique_terrace'))).toBe(372);
  });
});
