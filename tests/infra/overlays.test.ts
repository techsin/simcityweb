/**
 * WP5 data views (SIM_DEPTH_SPEC §F, docs/SIM_DEPTH_PART_B.md items 26 / 28 / 29 / 33): every Overlay × variant has data
 * of the right length, a label and a palette; the hover value (overlayValue) is exactly what the terrain draws
 * (computeOverlayValues) at random cells; the appeal variants equal the demographics functions; the Emergency view
 * encodes the auto / just-out-of-reach / manual / no-station categories; derived rasters are cached until their layer
 * is recomputed; the default variant of every pre-spec overlay is its direct layer.
 */
import { describe, expect, it } from 'vitest';
import { DevType, Network, Overlay } from '../../src/core/types';
import { RESP_NONE } from '../../src/sim/CityState';
import {
  DEMO_KIDS, DEMO_WEALTH, DESIR_FAMILIES, DESIR_SENIORS, DESIR_STUDENTS, EMG_FIRE, EMG_NONE_T, OVERLAY_VARIANTS, attachOverlays, encodeSlack,
  markOverlaysDirty, overlayDeps, overlayLayer, overlayReadout, overlayValue, overlayVariantCount, resolveVariant,
} from '../../src/sim/infra/overlays';
import { computeOverlayValues, overlayDef, overlayLegend } from '../../src/render/world/overlays';
import { familyScoreAt, seniorScoreAt, studentScoreAt } from '../../src/sim/economy/demographics';
import { newSim, newState, place, roadLine } from './cityGen';

const ALL = Object.values(Overlay).filter((v) => typeof v === 'number') as Overlay[];

/** a small serviced town: road grid, homes with residents, shops, a school, a fire station, a park, industry */
function town() {
  const st = newState(64);
  for (let z = 8; z <= 56; z += 8) roadLine(st, 4, z, 60, z, Network.Road);
  for (let x = 4; x <= 60; x += 12) roadLine(st, x, 8, x, 56, Network.Road);
  roadLine(st, 4, 32, 60, 32, Network.Avenue);
  let k = 0;
  for (let z = 9; z < 56; z += 8) {
    for (let x = 6; x < 58; x += 3) {
      if ((x + z) % 7 === 0) continue;
      const def = z > 40 ? 't_id' : k % 5 === 0 ? 't_cs' : k % 3 === 0 ? 't_r2' : 't_r1';
      const res = def === 't_r1' || def === 't_r2';
      place(st, def, x, z, res ? { pop: def === 't_r2' ? 50 : 10, wealth: 1 + (k % 3), kids: 0.05 + (k % 7) * 0.04, teens: 0.07, yad: 0.1, srs: 0.1 + (k % 4) * 0.05 } : { jobs: 20 });
      k++;
    }
  }
  place(st, 't_school', 17, 15);
  place(st, 't_fire', 29, 23);
  place(st, 't_park', 41, 15);
  place(st, 't_police', 50, 23);
  place(st, 't_clinic', 17, 31);
  const sim = newSim(st);
  sim.runDays(40);
  return { st, sim };
}

describe('overlays: every Overlay × variant', () => {
  const { st, sim } = town();

  it('has data, a label, a palette and refresh layers; labels / legends name the variant', () => {
    for (const o of ALL) {
      const n = overlayVariantCount(o);
      expect(n).toBe(OVERLAY_VARIANTS[o]?.length ?? 1);
      for (let v = 0; v < n; v++) {
        const L = overlayLayer(st, o, v);
        const def = overlayDef(o, v);
        expect(def.ramp.length, `${Overlay[o]}/${v} ramp`).toBeGreaterThanOrEqual(2);
        if (o === Overlay.None || o === Overlay.Zones) {
          expect(L).toBeNull();
          continue;
        }
        expect(L, `${Overlay[o]}/${v}`).not.toBeNull();
        expect(L!.data.length).toBe(st.cells);
        expect(L!.label.length).toBeGreaterThan(2);
        expect(['bad', 'good', 'binary', 'diverging']).toContain(L!.palette);
        expect(L!.variant).toBe(v);
        expect(L!.deps).toEqual(overlayDeps(o, v));
        expect(def.layers).toEqual(overlayDeps(o, v));
        const leg = overlayLegend(o, v);
        expect(leg.title.length).toBeGreaterThan(2);
        expect(leg.stops.length).toBeGreaterThanOrEqual(2);
        for (const s of leg.stops) expect(s.label.length).toBeGreaterThan(0);
        // variant labels are distinct legends (a Desirability variant names its DevType / group)
        if (n > 1 && v > 0 && o !== Overlay.Desirability) expect(overlayDef(o, v).title === overlayDef(o, 0).title && !overlayDef(o, v).notes).toBe(false);
      }
    }
    expect(overlayLegend(Overlay.AirPollution).wind).toBe(true);
    expect(overlayLegend(Overlay.AirPollution).stops.some((s) => /Polluted ≥/.test(s.label))).toBe(true);
    expect(overlayLegend(Overlay.Emergency, EMG_FIRE).stops.map((s) => s.label)).toEqual(['Auto-dispatch', 'Just out of reach', 'You must dispatch', 'No fire station']);
    expect(overlayDef(Overlay.Desirability, DevType.CO3).title).toContain('CO$$$');
    expect(overlayDef(Overlay.Desirability, DESIR_FAMILIES).title).toContain('families');
    // appeal (0..1, unsigned): a sequential ramp — poor places nearly clear, not the diverging red of desirability
    expect(overlayLegend(Overlay.Desirability, DESIR_FAMILIES).stops.map((s) => s.label)).toEqual(['Poor', 'Fair', 'Great']);
    expect(overlayDef(Overlay.Desirability, DESIR_SENIORS).ramp[0].a).toBeLessThan(0.25);
    // per-building / per-served-cell views draw whole cells (no halo over the streets, no "unsafe" rim)
    expect(overlayDef(Overlay.Demographics, DEMO_KIDS).crisp).toBe(true);
    expect(overlayDef(Overlay.Water, 1).crisp).toBe(true);
    expect(overlayDef(Overlay.Water, 0).crisp).toBeFalsy();
    expect(overlayDef(Overlay.AirPollution).crisp).toBeFalsy();
  });

  it('the hover value is the rendered raster at 100 random cells (every variant) and always has a readout', () => {
    const out = new Uint8Array(st.cells);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const o of ALL) {
      if (o === Overlay.None || o === Overlay.Zones) continue;
      for (let v = 0; v < overlayVariantCount(o); v++) {
        computeOverlayValues(st, o, out, v);
        const L = overlayLayer(st, o, v)!;
        for (let k = 0; k < 100; k++) {
          const x = Math.floor(rnd() * st.size), z = Math.floor(rnd() * st.size), i = z * st.size + x;
          const n = overlayValue(st, o, x, z, v);
          let want: number;
          if (L.palette === 'binary') want = n > 0.5 ? 255 : st.building[i] >= 0 || st.zone[i] !== 0 ? 128 : 0;
          else if (L.roadsOnly) want = st.network[i] !== 0 && st.network[i] !== Network.Rail ? Math.round((0.05 + 0.95 * n) * 255) : 0;
          else if (L.palette === 'diverging') want = Math.round((0.5 + 0.5 * n) * 255);
          else want = Math.round(n * 255);
          expect(Math.abs(out[i] - want), `${Overlay[o]}/${v} at ${x},${z}`).toBeLessThanOrEqual(1);
          expect(overlayReadout(st, o, x, z, v), `${Overlay[o]}/${v} readout`).not.toBeNull();
        }
      }
    }
  });

  it('default variants: pre-spec overlays read their direct layer; Desirability defaults to R$$ (hover = render)', () => {
    expect(overlayLayer(st, Overlay.Transit)!.data).toBe(st.transitCov);
    expect(overlayLayer(st, Overlay.Traffic)!.data).toBe(st.congestion);
    expect(overlayLayer(st, Overlay.Education)!.data).toBe(st.eduCov);
    expect(overlayLayer(st, Overlay.Garbage)!.data).toBe(st.garbage);
    expect(overlayLayer(st, Overlay.Water)!.data).toBe(st.watered);
    expect(resolveVariant(Overlay.Desirability)).toBe(DevType.R2);
    expect(overlayLayer(st, Overlay.Desirability)!.data).toBe(st.desirability[DevType.R2]);
    expect(overlayLayer(st, Overlay.Education, 1)!.data).toBe(st.eduElemCov);
    expect(overlayLayer(st, Overlay.Parks, 2)!.data).toBe(st.greenCov);
    expect(overlayLayer(st, Overlay.Garbage, 1)!.data).toBe(st.landfillFill);
    // out-of-range variants fall back to the default
    expect(overlayLayer(st, Overlay.Education, 99)!.data).toBe(st.eduCov);
  });

  it('appeal variants equal familyScoreAt / seniorScoreAt / studentScoreAt (one hoisted typed-array loop)', () => {
    const fns: [number, (s: typeof st, i: number) => number][] = [[DESIR_FAMILIES, familyScoreAt], [DESIR_SENIORS, seniorScoreAt], [DESIR_STUDENTS, studentScoreAt]];
    for (const [v, f] of fns) {
      const d = overlayLayer(st, Overlay.Desirability, v)!.data;
      let checked = 0, nonTrivial = 0;
      for (let i = 0; i < st.cells; i += 37) {
        if (st.water[i]) continue;
        expect(Math.abs(d[i] - f(st, i))).toBeLessThan(1e-5);
        if (Math.abs(d[i] - 0.15) > 0.02) nonTrivial++;
        checked++;
      }
      expect(checked).toBeGreaterThan(50);
      expect(nonTrivial).toBeGreaterThan(5);
    }
  });

  it('demographics rasters: homes only, share against the city-typical mix; wealth by building', () => {
    const d = overlayLayer(st, Overlay.Demographics, DEMO_KIDS)!.data;
    const w = overlayLayer(st, Overlay.Demographics, DEMO_WEALTH)!.data;
    let homes = 0;
    for (const b of st.buildings.values()) {
      const i = b.z * st.size + b.x;
      const res = b.def === 't_r1' || b.def === 't_r2';
      if (res && b.pop > 0) {
        homes++;
        expect(d[i]).toBeGreaterThan(0.03);
        expect(w[i]).toBeCloseTo(Math.max(1, Math.min(3, b.wealth)) / 3, 5);
      } else expect(d[i]).toBe(0);
    }
    expect(homes).toBeGreaterThan(20);
    const b = [...st.buildings.values()].find((x) => x.def === 't_r2' && x.pop > 0)!;
    const r = overlayReadout(st, Overlay.Demographics, b.x, b.z, DEMO_KIDS)!;
    expect(r.text).toMatch(/%$/);
    expect(r.sub).toContain('residents');
  });

  it('emergency response: categories encoded continuously, RESP_NONE gets its own colour; readout explains', () => {
    expect(encodeSlack(RESP_NONE)).toBe(EMG_NONE_T);
    expect(encodeSlack(-12)).toBeCloseTo(0.08, 6);
    expect(encodeSlack(-50)).toBeCloseTo(0.08, 6);
    expect(encodeSlack(0)).toBeCloseTo(0.54, 6);
    expect(encodeSlack(12)).toBeCloseTo(1, 6);
    expect(encodeSlack(-3)).toBeLessThan(encodeSlack(-1));
    // readouts at synthetic slack values (a copy of the state's layer)
    const i = st.idx(30, 30);
    const keep = st.respFire[i];
    const text = (s: number) => {
      st.respFire[i] = s;
      markOverlaysDirty(st, 'emergency');
      return overlayReadout(st, Overlay.Emergency, 30, 30, EMG_FIRE)!.text;
    };
    expect(text(2.1)).toBe('Auto-dispatch · 2.1 min to spare');
    expect(text(-1.8)).toBe('Just out of reach by 1.8 min');
    expect(text(-7)).toBe('Out of reach by 7.0 min');
    expect(text(RESP_NONE)).toBe('No fire station');
    st.respFire[i] = keep;
    markOverlaysDirty(st, 'emergency');
  });

  it('emergency: empty land beside no road shows its nearest road / lot (block interiors do not read "You must dispatch")', () => {
    const N = st.size, L = st.respFire;
    const keep = Float32Array.from(L);
    // a block (roads x = 4 / z = 8 / z = 16, lots on z = 9 and 15): the land fill leaves rows 10..14 at its floor
    for (let z = 8; z <= 16; z++) {
      for (let x = 3; x <= 11; x++) {
        const k = z * N + x;
        const empty = z >= 10 && z <= 14 && st.building[k] < 0 && st.network[k] === Network.None;
        L[k] = empty ? -12 : 3;
      }
    }
    markOverlaysDirty(st, 'emergency');
    const i = 12 * N + 7;
    expect(st.building[i]).toBeLessThan(0);
    const raw = overlayLayer(st, Overlay.Emergency, EMG_FIRE)!.data[i];
    expect(raw).toBeCloseTo(encodeSlack(3), 5);
    expect(overlayValue(st, Overlay.Emergency, 7, 12, EMG_FIRE)).toBeCloseTo(raw, 5);
    const r = overlayReadout(st, Overlay.Emergency, 7, 12, EMG_FIRE)!;
    expect(r.text).toBe('Auto-dispatch · 3.0 min to spare');
    expect(r.sub).toMatch(/^Empty land/);
    // a lot keeps its own reach
    const lot = [...st.buildings.values()].find((b) => b.z === 9 && b.x >= 5 && b.x <= 10)!;
    L[lot.z * N + lot.x] = -7;
    markOverlaysDirty(st, 'emergency');
    expect(overlayReadout(st, Overlay.Emergency, lot.x, lot.z, EMG_FIRE)!.text).toBe('Out of reach by 7.0 min');
    L.set(keep);
    markOverlaysDirty(st, 'emergency');
  });

  it('derived rasters are cached until their layer is recomputed (subscribed) or for one day (headless)', () => {
    const st2 = newState(32);
    const b = place(st2, 't_r2', 5, 5, { pop: 40, kids: 0.1, teens: 0.07, yad: 0.1, srs: 0.15 });
    const sim2 = newSim(st2);
    const off = attachOverlays(sim2);
    const v0 = overlayLayer(st2, Overlay.Demographics, DEMO_KIDS)!.data[st2.idx(5, 5)];
    b.kids = 0.3;
    // not recomputed: hover and render keep reading the same raster (no per-call rebuild)
    expect(overlayLayer(st2, Overlay.Demographics, DEMO_KIDS)!.data[st2.idx(5, 5)]).toBe(v0);
    sim2.events.emit('layerUpdated', 'demographics');
    const v1 = overlayLayer(st2, Overlay.Demographics, DEMO_KIDS)!.data[st2.idx(5, 5)];
    expect(v1).toBeGreaterThan(v0);
    // other layers do not invalidate it
    b.kids = 0.05;
    sim2.events.emit('layerUpdated', 'traffic');
    expect(overlayLayer(st2, Overlay.Demographics, DEMO_KIDS)!.data[st2.idx(5, 5)]).toBe(v1);
    off();
    void sim;
  });
});
