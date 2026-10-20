/**
 * Render handoffs from the sim-depth part-B verifiers (simB render-handoff-r2):
 *
 *  RH-1: the Traffic data view never showed a jam. The road meshes cover their whole cell (asphalt and sidewalks to the
 *  cell edge), so the value drawn on a road cell is hidden; the only overlay colour on screen was the curb strip beside
 *  the road, a bilinear blend of the road's texel with the 0 of the land next to it — at most half the value, so a
 *  175% road read 'Busy' yellow. The land cells beside a road now carry the busiest neighbour road's value and Traffic
 *  draws whole cells (crisp), so a jam reads red along its curbs.
 *
 *  Render handoff r3: the corners count too (8 neighbours). A junction has roads on all four sides, so no land cell was
 *  4-adjacent to it: a jam locked in a junction (the worst jams of the 289k and 312k cities) never went red — its corner
 *  lots showed the orange approaches. The hover reads the same road (sim overlays.ts curbRoadOf).
 *
 *  RH-2: the Emergency view's Fire legend said "You must dispatch" for red, but red there means a fire burns down
 *  before any truck can arrive (FIRE_TOO_FAR_TEXT, the hover): the legend and notes now say what the hover says — and
 *  (render handoff r3) give the industrial-accident window in the banner's unit: "within 3.0 min", not "within 3 days".
 *
 * The colours are read the way the terrain shader reads them: the overlay byte of the cell under a fragment (nearest
 * texel when crisp, else the bilinear blend) looked up in the ramp texture (makeRampTexture: 128 texels, sRGB lerp,
 * linear filtering), then matched to the nearest legend swatch.
 */
import { describe, expect, it } from 'vitest';
import { Network, Overlay } from '../../src/core/types';
import { EMG_FIRE, EMG_MEDICAL, EMG_POLICE, FIRE_TOO_FAR_TEXT, INDUSTRIAL_WINDOW_TEXT, markOverlaysDirty, overlayReadout } from '../../src/sim/infra/overlays';
import { EMERG_DAYS_PER_MIN, EMERG_GRACE } from '../../src/sim/infra/params';
import { computeOverlayValues, overlayDef, overlayLegend, type OverlayDef, type RampStop } from '../../src/render/world/overlays';
import { newState, place, roadLine } from '../infra/cityGen';

const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** texel k of the ramp texture (makeRampTexture, width 128): the ramp at t = k / 127, lerped in sRGB, as RGBA bytes */
function rampTexel(ramp: RampStop[], k: number): number[] {
  const s = [...ramp].sort((a, b) => a.t - b.t), t = k / 127;
  let j = 0;
  while (j < s.length - 2 && t > s[j + 1].t) j++;
  const a = s[j], b = s[Math.min(j + 1, s.length - 1)];
  const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  const ca = hex(a.color), cb = hex(b.color), aa = (a.a ?? 1) * 255, ab = (b.a ?? 1) * 255;
  return [0, 1, 2].map((c) => ca[c] + (cb[c] - ca[c]) * f).concat(aa + (ab - aa) * f);
}

/** texture2D(uRamp, vec2(t, 0.5)): linear filtering between the two nearest texels, clamped to the edge */
function rampAt(ramp: RampStop[], t: number): number[] {
  const x = t * 128 - 0.5, k0 = Math.max(0, Math.min(127, Math.floor(x))), k1 = Math.min(127, k0 + 1), f = Math.max(0, Math.min(1, x - k0));
  const p = rampTexel(ramp, k0), q = rampTexel(ramp, k1);
  return p.map((v, c) => v + (q[c] - v) * f);
}

/** the legend swatch a drawn overlay byte reads as ('clear' where the ramp is (nearly) transparent) */
function category(def: OverlayDef, byte: number): string {
  const [r, g, b, a] = rampAt(def.ramp, byte / 255);
  if (a < 0.1 * 255) return 'clear';
  let best = '', bd = Infinity;
  for (const s of def.legend) {
    const [lr, lg, lb] = hex(s.color);
    const d = (r - lr) ** 2 + (g - lg) ** 2 + (b - lb) ** 2;
    if (d < bd) [bd, best] = [d, s.label];
  }
  return best;
}

/**
 * the overlay bytes the terrain shows on the curb cell beside a road cell: the road mesh covers the road cell up to the
 * cell edge, half way between the two texels, so the visible part runs from there to the curb cell's centre — the curb
 * cell's own byte when crisp, else the bilinear blend of the two
 */
function curbSamples(road: number, curb: number, crisp: boolean): number[] {
  const out: number[] = [];
  for (let k = 0; k <= 16; k++) {
    const f = 0.5 + k / 32;
    out.push(crisp ? curb : Math.round(road + (curb - road) * f));
  }
  return out;
}

const N = 24;
/** a 175% road (z = 8), a free road (z = 14, 10%), a 30% street joining them (x = 5), a rail cell and a pond cell
 *  beside the jam, and a road on the map's east edge (wrap-around check) */
function strip() {
  const st = newState(N);
  roadLine(st, 2, 8, 21, 8, Network.Road);
  roadLine(st, 2, 14, 21, 14, Network.Road);
  roadLine(st, 5, 9, 5, 13, Network.Street);
  roadLine(st, N - 1, 2, N - 1, 4, Network.Road);
  for (let x = 2; x <= 21; x++) {
    st.congestion[8 * N + x] = 1.75;
    st.congestion[14 * N + x] = 0.1;
  }
  for (let z = 9; z <= 13; z++) st.congestion[z * N + 5] = 0.3;
  for (let z = 2; z <= 4; z++) st.congestion[z * N + N - 1] = 1.75;
  st.network[9 * N + 15] = Network.Rail;
  st.water[9 * N + 17] = 1;
  const out = new Uint8Array(st.cells);
  computeOverlayValues(st, Overlay.Traffic, out, 0);
  return { st, out, at: (x: number, z: number) => out[z * N + x] };
}
/** a road cell's byte: 0.05 floor + 0.95 x clamp01(congestion / 1.2) (the Cars layer's scale) */
const enc = (c: number) => Math.round((0.05 + 0.95 * Math.min(1, c / 1.2)) * 255);

describe('RH-1: the Traffic view shows a jam along its curbs', () => {
  it('a 175% road reads Jammed red on its curb cells, a free road Free flow green (before: Busy yellow at best)', () => {
    const { at } = strip();
    const cars = overlayDef(Overlay.Traffic, 0);
    expect(cars.crisp).toBe(true);
    for (const z of [7, 9]) expect(new Set(curbSamples(at(10, 8), at(10, z), true).map((b) => category(cars, b))), `z ${z}`).toEqual(new Set(['Jammed']));
    for (const z of [13, 15]) expect(new Set(curbSamples(at(10, 14), at(10, z), true).map((b) => category(cars, b))), `z ${z}`).toEqual(new Set(['Free flow']));
    // what the player saw before: the curb cell held 0 and the bilinear blend from the cell edge on showed at most half
    // the jam (green / yellow strips beside a 175% road)
    const before = new Set(curbSamples(at(10, 8), 0, false).map((b) => category(cars, b)));
    expect(before.has('Jammed') || before.has('Heavy'), [...before].join(',')).toBe(false);
    expect(before.has('Busy')).toBe(true);
  });

  it('road cells keep their own value; a lot takes its busiest road; rail, water and land beyond the curb stay clear', () => {
    const { at } = strip();
    expect(at(10, 8)).toBe(enc(1.75));
    expect(at(10, 14)).toBe(enc(0.1));
    expect(at(5, 11)).toBe(enc(0.3));
    // curbs: the road beside them; a corner lot between the jam and the 30% street: the jam
    expect(at(10, 7)).toBe(enc(1.75));
    expect(at(10, 9)).toBe(enc(1.75));
    expect(at(10, 15)).toBe(enc(0.1));
    expect(at(6, 9)).toBe(enc(1.75));
    expect(at(4, 11)).toBe(enc(0.3));
    expect(at(6, 11)).toBe(enc(0.3));
    // two cells from any road, rail and water beside the jam, the land past the rail: nothing drawn
    for (const [x, z] of [[10, 6], [10, 11], [10, 12], [15, 9], [17, 9], [15, 10], [0, 0], [0, 8], [23, 8]]) expect(at(x, z), `${x},${z}`).toBe(0);
    // (r3) the corners count: the cells diagonal to the jam's ends show it, like the curbs beside it
    for (const [x, z] of [[1, 7], [1, 9], [22, 7], [22, 9]]) expect(at(x, z), `${x},${z}`).toBe(enc(1.75));
    // map edges do not wrap: the cell after the east-edge road's row end is the west edge of the next row (sides and
    // corners: rows 1..5 of the west edge are diagonal or beside an east-edge road cell once wrapped)
    expect(at(N - 2, 3)).toBe(enc(1.75));
    expect(at(N - 2, 1)).toBe(enc(1.75));
    expect(at(N - 2, 5)).toBe(enc(1.75));
    for (let z = 0; z <= 6; z++) expect(at(0, z), `0,${z}`).toBe(0);
  });

  it('(r3) a jam locked in a junction: its corner lots read Jammed (before: the orange approaches)', () => {
    // a road crossing an avenue: the junction at 193%, its four approaches at 90%, the arms beyond them at 40%
    const st = newState(N);
    roadLine(st, 3, 12, 20, 12, Network.Road);
    roadLine(st, 11, 3, 11, 20, Network.Avenue);
    for (let k = 3; k <= 20; k++) { st.congestion[12 * N + k] = 0.4; st.congestion[k * N + 11] = 0.4; }
    for (const [x, z] of [[10, 12], [12, 12], [11, 11], [11, 13]]) st.congestion[z * N + x] = 0.9;
    st.congestion[12 * N + 11] = 1.93;
    place(st, 't_r1', 12, 13, { pop: 10 }); // a home on one corner: painted under it, read by its hover
    const out = new Uint8Array(st.cells);
    computeOverlayValues(st, Overlay.Traffic, out, 0);
    const cars = overlayDef(Overlay.Traffic, 0);
    const corners = [[10, 11], [12, 11], [10, 13], [12, 13]];
    for (const [x, z] of corners) {
      const b = out[z * N + x];
      expect(b, `${x},${z}`).toBe(enc(1.93));
      expect(category(cars, b)).toBe('Jammed');
      const r = overlayReadout(st, Overlay.Traffic, x, z, 0)!;
      expect(r.text).toBe('193%');
      expect(r.tone).toBe('bad');
      expect(r.sub).toMatch(/^road beside it · /);
    }
    // what the 4-neighbour rule painted there: the busier approach, Heavy orange
    expect(category(cars, enc(0.9))).toBe('Heavy');
    // one cell further out: the busiest road around, the corners included — (9, 11) beside the west arm (9, 12) and
    // diagonal to the west approach (10, 12); (10, 10) beside the north arm (11, 10), diagonal to the north approach
    // (11, 11); (10, 9) beside and diagonal to the north arm only; (9, 10) two cells from both roads
    expect(out[11 * N + 9]).toBe(enc(0.9));
    expect(out[10 * N + 10]).toBe(enc(0.9));
    expect(out[9 * N + 10]).toBe(enc(0.4));
    expect(out[10 * N + 9]).toBe(0);
  });

  it('the hover still reads the road cell (its own congestion and trips)', () => {
    const { st } = strip();
    const r = overlayReadout(st, Overlay.Traffic, 10, 8, 0)!;
    expect(r.text).toBe('175%');
    expect(r.tone).toBe('bad');
    expect(overlayReadout(st, Overlay.Traffic, 10, 14, 0)!.tone).toBe('good');
  });

  it('Trucks: a road without trucks paints no curb band, freight routes do; an empty road still reads Free flow in Cars', () => {
    const { st } = strip();
    const out = new Uint8Array(st.cells);
    computeOverlayValues(st, Overlay.Traffic, out, 1); // no freight data: every road at the 0.05 floor
    const trucks = overlayDef(Overlay.Traffic, 1), cars = overlayDef(Overlay.Traffic, 0);
    expect(trucks.crisp).toBe(true);
    const floor = out[8 * N + 10];
    expect(floor).toBe(enc(0));
    expect(out[7 * N + 10]).toBe(floor);
    expect(category(trucks, floor)).toBe('clear');
    expect(category(cars, floor)).toBe('Free flow');
    // a route at 1% of the busy-route scale (raster sqrt(0.01) = 0.1) already shows; the busiest reads Heavy freight
    expect(category(trucks, Math.round((0.05 + 0.95 * 0.1) * 255))).toBe('Few trucks');
    expect(category(trucks, Math.round((0.05 + 0.95 * 0.3) * 255))).toBe('Freight route');
    expect(category(trucks, 255)).toBe('Heavy freight');
  });
});

describe('RH-2: the Emergency legend says what the hover says', () => {
  it('Fire: red is "Too far — fires burn down first"; police and ambulance keep "You must dispatch"', () => {
    const labels = (v: number) => overlayLegend(Overlay.Emergency, v).stops.map((s) => s.label);
    expect(labels(EMG_FIRE)).toEqual(['Auto-dispatch', 'Just out of reach', 'Too far — fires burn down first', 'No fire station']);
    expect(labels(-1)).toEqual(labels(EMG_FIRE));
    expect(labels(EMG_POLICE)).toEqual(['Auto-dispatch', 'Just out of reach', 'You must dispatch', 'No police station']);
    expect(labels(EMG_MEDICAL)).toEqual(['Auto-dispatch', 'Just out of reach', 'You must dispatch', 'No clinic or hospital']);
    const fire = overlayLegend(Overlay.Emergency, EMG_FIRE).notes;
    // (r3) the industrial window in emergency minutes, the banner's unit ("3.0 min left to send a truck")
    expect(INDUSTRIAL_WINDOW_TEXT).toBe(`within ${(EMERG_GRACE.industrial / EMERG_DAYS_PER_MIN).toFixed(1)} min`);
    expect(INDUSTRIAL_WINDOW_TEXT).toBe('within 3.0 min');
    expect(fire).toEqual([
      'Green: fire trucks are sent automatically in time — incidents there become statistics.',
      'Amber: fires wait for your dispatch — a truck sent at once still makes it. Red: too far for fires; an industrial accident there is still saved by a fire truck sent within 3.0 min.',
      'Red on a single building: no road reaches it — build one beside it.',
    ]);
    for (const v of [EMG_POLICE, EMG_MEDICAL]) {
      expect(overlayLegend(Overlay.Emergency, v).notes[1]).toBe('Amber / red: major emergencies there wait for your dispatch (live speed by default); minor ones get a slower unit.');
    }
  });

  it('an amber and a red building: the swatch their colour reads as and their hover tell the same story', () => {
    const st = newState(N);
    roadLine(st, 2, 10, 21, 10, Network.Road);
    const b = place(st, 't_r1', 8, 11, { pop: 10 });
    const bi = b.z * N + b.x;
    const out = new Uint8Array(st.cells);
    const look = (v: number, L: Float32Array, slack: number) => {
      L[bi] = slack;
      markOverlaysDirty(st, 'emergency');
      computeOverlayValues(st, Overlay.Emergency, out, v);
      return { swatch: category(overlayDef(Overlay.Emergency, v), out[bi]), hover: overlayReadout(st, Overlay.Emergency, b.x, b.z, v)! };
    };
    const notes = overlayLegend(Overlay.Emergency, EMG_FIRE).notes.join(' ').toLowerCase();
    // fire, 0.6 min beyond the auto range: inside the burn-down window
    let r = look(EMG_FIRE, st.respFire, -0.6);
    expect(r.swatch).toBe('Just out of reach');
    expect(r.hover.tone).toBe('warn');
    expect(notes).toContain(r.hover.sub!.toLowerCase()); // "fires wait for your dispatch — a truck sent at once still makes it"
    // fire, 2.2 min beyond: it burns down before a truck arrives; an industrial accident still waits 3.0 min for one
    r = look(EMG_FIRE, st.respFire, -2.2);
    expect(r.swatch).toBe('Too far — fires burn down first');
    expect(r.hover.tone).toBe('bad');
    expect(r.hover.sub).toBe(FIRE_TOO_FAR_TEXT);
    expect(FIRE_TOO_FAR_TEXT).toMatch(/^Too far — a fire here burns down before a truck can arrive/);
    expect(FIRE_TOO_FAR_TEXT).toContain(`sent ${INDUSTRIAL_WINDOW_TEXT}`);
    expect(notes).toContain(`sent ${INDUSTRIAL_WINDOW_TEXT}`);
    // one unit everywhere: no "days" in the hover or the legend
    expect(FIRE_TOO_FAR_TEXT).not.toMatch(/\bdays?\b/);
    expect(notes).not.toMatch(/\bdays?\b/);
    expect(notes).not.toContain('wait for your dispatch (live speed');
    // police, 5 min beyond: the player dispatches — the legend's "You must dispatch"
    r = look(EMG_POLICE, st.respPolice, -5);
    expect(r.swatch).toBe('You must dispatch');
    expect(r.hover.tone).toBe('bad');
    expect(r.hover.sub).toMatch(/dispatch/);
  });
});
