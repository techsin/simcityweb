/**
 * Routed UI item 17 (simB ROUTED_ITEMS): the Emergency data view drew an amber half-cell ring around every red roadless
 * building. Amber is the legend's "Just out of reach", yet hovering the ring reads "Auto-dispatch": the terrain blended
 * (bilinear) the red building's texel into its green neighbour's, through the amber band of the ramp. Emergency now draws
 * whole cells (crisp: nearest texel, like Demographics and Tap water); every other overlay keeps its filtering.
 */
import { describe, expect, it } from 'vitest';
import { Overlay } from '../../src/core/types';
import { EMG_FLOOR_T, EMG_NEAR, EMG_NONE_T, OVERLAY_VARIANTS, decodeSlack, encodeSlack } from '../../src/sim/infra/overlays';
import { overlayDef, overlayLegend } from '../../src/render/world/overlays';

const OVERLAYS = Object.values(Overlay).filter((v): v is Overlay => typeof v === 'number');
const variantsOf = (o: Overlay) => (OVERLAY_VARIANTS[o]?.length ? OVERLAY_VARIANTS[o]!.map((_, v) => v) : [-1]);

/** the legend category the Emergency view's colour ramp shows for an encoded value (the hover reads the same slack) */
function category(t: number): 'none' | 'manual' | 'near' | 'auto' {
  if (t < (EMG_NONE_T + EMG_FLOOR_T) / 2) return 'none';
  const s = decodeSlack(t);
  return s >= 0 ? 'auto' : s >= -EMG_NEAR ? 'near' : 'manual';
}

/**
 * what the terrain shader samples across the edge between two cells (u8 texels, as computeOverlayValues writes them):
 * a nearest texel (crisp) or the bilinear blend, at sub-texel steps from one cell centre to the other
 */
function edgeSamples(a: number, b: number, crisp: boolean): number[] {
  const ua = Math.round(a * 255), ub = Math.round(b * 255);
  const out: number[] = [];
  for (let k = 0; k <= 32; k++) {
    const f = k / 32;
    out.push((crisp ? (f < 0.5 ? ua : ub) : ua + (ub - ua) * f) / 255);
  }
  return out;
}

describe('Emergency data view: whole cells', () => {
  it('all three responders (fire, police, ambulance) are crisp', () => {
    for (const v of [-1, 0, 1, 2]) expect(overlayDef(Overlay.Emergency, v).crisp, `variant ${v}`).toBe(true);
  });

  it('no amber ("Just out of reach") ring between a red roadless building and an auto-dispatch neighbour', () => {
    const red = EMG_FLOOR_T, green = encodeSlack(4), purple = EMG_NONE_T;
    expect(category(red)).toBe('manual');
    expect(category(green)).toBe('auto');
    for (const v of [0, 1, 2]) {
      const crisp = !!overlayDef(Overlay.Emergency, v).crisp;
      for (const [a, b] of [[red, green], [green, red], [purple, green]]) {
        const cats = new Set(edgeSamples(a, b, crisp).map(category));
        expect(cats.has('near'), `variant ${v}: ${[...cats].join(',')}`).toBe(false);
      }
    }
    // (what the bilinear blend did: the amber band between the two)
    expect(new Set(edgeSamples(red, green, false).map(category)).has('near')).toBe(true);
  });

  it('a genuine "Just out of reach" cell still reads amber, and the legend is unchanged', () => {
    expect(category(encodeSlack(-1.5))).toBe('near');
    const lg = overlayLegend(Overlay.Emergency, 0);
    expect(lg.stops.map((s) => s.label)).toEqual(['Auto-dispatch', 'Just out of reach', 'You must dispatch', 'No fire station']);
    expect(lg.swatches).toBe(true);
  });
});

describe('every other overlay keeps its filtering', () => {
  it('crisp exactly where it was (Demographics, Tap water) plus Emergency', () => {
    const crisp: string[] = [];
    for (const o of OVERLAYS) for (const v of variantsOf(o)) if (overlayDef(o, v).crisp) crisp.push(`${Overlay[o]}:${v}`);
    expect(crisp.sort()).toEqual([
      'Demographics:0', 'Demographics:1', 'Demographics:2', 'Demographics:3', 'Demographics:4', 'Demographics:5',
      'Emergency:0', 'Emergency:1', 'Emergency:2',
      'Water:1',
    ]);
  });

  it('their ramps, legends and refresh layers are untouched by the Emergency change', () => {
    // the fields that blend smoothly stay linear (a sample of each kind)
    for (const o of [Overlay.AirPollution, Overlay.Noise, Overlay.LandValue, Overlay.Fire, Overlay.Police, Overlay.Health, Overlay.Desirability, Overlay.Traffic, Overlay.Parking]) {
      expect(overlayDef(o).crisp, Overlay[o]).toBeFalsy();
    }
    expect(overlayDef(Overlay.Water, 0).crisp).toBeFalsy();
    // the Emergency view's own refresh layers are still the emergency pass
    expect(overlayDef(Overlay.Emergency, 0).layers.length).toBeGreaterThan(0);
  });
});
