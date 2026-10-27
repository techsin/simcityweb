import { describe, expect, it } from 'vitest';
import { Overlay } from '../../src/core/types';
import { EMG_FIRE, EMG_MEDICAL, EMG_POLICE, OVERLAY_VARIANTS } from '../../src/sim/infra/overlays';
import { OVERLAYS, overlayDef, overlayLegend, type RampStop } from '../../src/render/world/overlays';
import { makeRampTexture } from '../../src/render/world/textures';

const RESPONDERS = [EMG_FIRE, EMG_POLICE, EMG_MEDICAL];
const SAFE_MODES = ['red-green', 'blue-yellow'] as const;
const DISTANCE_FLOOR = 120;
type RGB = readonly [number, number, number];
type Matrix = readonly [RGB, RGB, RGB];

// Machado, Oliveira & Fernandes (2009), full severity (1.0), applied to linear RGB.
// Published matrices: https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html
const MACHADO = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.011820, 0.042940, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.303900],
  ],
} satisfies Record<string, Matrix>;

/** Decode sRGB, simulate in linear RGB, clip to gamut, then measure displayed sRGB on the plan's 0..255 scale. */
function simulate(hex: string, matrix: Matrix): number[] {
  const linear = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return matrix.map((row) => {
    const v = Math.max(0, Math.min(1, row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2]));
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  });
}

function distance(a: string, b: string, matrix: Matrix): number {
  const ca = simulate(a, matrix), cb = simulate(b, matrix);
  return Math.hypot(...ca.map((v, i) => v - cb[i]));
}

// The pre-FH-20 ramp: keep the default's colours, thresholds and alpha byte-for-byte.
const STANDARD_RAMP: RampStop[] = [
  { t: 0, color: '#6a4c93', a: 0.78 },
  { t: 0.045, color: '#6a4c93', a: 0.78 },
  { t: 0.08, color: '#b8262a', a: 0.8 },
  { t: 0.41900000000000004, color: '#d8402a', a: 0.74 },
  { t: 0.43100000000000005, color: '#f0a030', a: 0.74 },
  { t: 0.534, color: '#f0c040', a: 0.7 },
  { t: 0.546, color: '#6ccf6a', a: 0.55 },
  { t: 1, color: '#1f9a4a', a: 0.7 },
];

describe('FH-20: Emergency palette', () => {
  it('keeps the default ramp texture and legend colours identical to the standard palette', () => {
    const before = makeRampTexture(STANDARD_RAMP);
    try {
      for (const v of [-1, ...RESPONDERS, 99]) {
        const def = overlayDef(Overlay.Emergency, v);
        expect(def).toEqual(overlayDef(Overlay.Emergency, v, 'standard'));
        expect(def.ramp).toEqual(STANDARD_RAMP);
        const after = makeRampTexture(def.ramp);
        try { expect(after.image.data).toEqual(before.image.data); }
        finally { after.dispose(); }
        const legend = overlayLegend(Overlay.Emergency, v);
        expect(legend).toEqual(overlayLegend(Overlay.Emergency, v, 'standard'));
        expect(legend.stops.map((s) => s.color)).toEqual(['#3fb45a', '#f0a030', '#c8322a', '#6a4c93']);
      }
      expect(OVERLAYS[Overlay.Emergency]).toEqual(overlayDef(Overlay.Emergency));
    } finally { before.dispose(); }
  });

  it.each(SAFE_MODES)('%s keeps the response bands, opacity, labels and fire dispatch window', (mode) => {
    for (const v of RESPONDERS) {
      const standard = overlayDef(Overlay.Emergency, v, 'standard'), safe = overlayDef(Overlay.Emergency, v, mode);
      const legend = overlayLegend(Overlay.Emergency, v, mode);
      expect(safe.ramp.map(({ t, a }) => ({ t, a }))).toEqual(standard.ramp.map(({ t, a }) => ({ t, a })));
      expect(safe.ramp.map((s) => s.color)).toEqual([3, 3, 2, 2, 1, 1, 0, 0].map((i) => legend.stops[i].color));
      expect(legend.stops.map((s) => s.label)).toEqual(standard.legend.map((s) => s.label));
      expect(safe.title).toBe(standard.title);
      expect(safe.layers).toEqual(['emergency']);
      expect(safe.crisp).toBe(true);
      expect(legend.swatches).toBe(true);
      expect(legend.notes.join(' ')).not.toMatch(/\b(green|amber|red|blue|orange|magenta|grey)\b/i);
      expect(legend.notes[0]).toMatch(/^Auto-dispatch:/);
      expect(legend.notes[1]).toContain(v === EMG_FIRE ? 'sent within 3.0 min' : 'minor ones get a slower unit');
      if (v === EMG_FIRE) expect(legend.stops[2].label).toBe('Too far — fires burn down first');
      else expect(legend.stops[2].label).toBe('You must dispatch');
    }
    expect(overlayDef(Overlay.Emergency, -1, mode)).toEqual(overlayDef(Overlay.Emergency, EMG_FIRE, mode));
  });

  it('leaves every other overlay and variant unchanged in safe modes', () => {
    for (const o of Object.values(Overlay).filter((v): v is Overlay => typeof v === 'number' && v !== Overlay.Emergency)) {
      const variants = [-1, ...(OVERLAY_VARIANTS[o] ?? []).map((_, v) => v)];
      for (const v of variants) for (const mode of SAFE_MODES) {
        expect(overlayDef(o, v, mode)).toEqual(overlayDef(o, v, 'standard'));
        expect(overlayLegend(o, v, mode)).toEqual(overlayLegend(o, v, 'standard'));
      }
    }
  });

  it('reproduces FH-20 reference distances with Machado 2009 in linear RGB', () => {
    // These reference pairs catch accidentally applying the matrices to gamma-encoded RGB.
    expect(Math.round(distance('#3fb45a', '#f0a030', MACHADO.deuteranopia))).toBe(66);
    expect(Math.round(distance('#3fb45a', '#f0a030', MACHADO.protanopia))).toBe(56);
    expect(Math.round(distance('#3fb45a', '#c8322a', MACHADO.deuteranopia))).toBe(79);
    expect(Math.round(distance('#3fb45a', '#c8322a', MACHADO.protanopia))).toBe(124);
  });

  it.each(SAFE_MODES)('%s keeps all six Emergency colour pairs above 120 under deuteranopia and protanopia', (mode) => {
    for (const v of RESPONDERS) {
      const stops = overlayLegend(Overlay.Emergency, v, mode).stops;
      for (const cvd of ['deuteranopia', 'protanopia'] as const) {
        for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < stops.length; j++) {
          const a = stops[i], b = stops[j];
          expect(distance(a.color, b.color, MACHADO[cvd]), `${mode}, variant ${v}, ${cvd}: ${a.label} / ${b.label}`).toBeGreaterThan(DISTANCE_FLOOR);
        }
      }
    }
  });

  it('blue-yellow keeps the two FH-20 Emergency problem pairs above 120 under tritanopia', () => {
    for (const v of RESPONDERS) {
      const stops = overlayLegend(Overlay.Emergency, v, 'blue-yellow').stops;
      for (const i of [1, 2]) expect(distance(stops[0].color, stops[i].color, MACHADO.tritanopia)).toBeGreaterThan(DISTANCE_FLOOR);
    }
  });
});
