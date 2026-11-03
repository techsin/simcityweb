/** W0.5 seam against real W1.1a deliveries: loaded bits and raster versions, including fresh adoption. */
import { describe, expect, it } from 'vitest';
import { Overlay } from '../../src/core/types';
import type { Simulation } from '../../src/sim/Simulation';
import {
  attachOverlays, overlayLayer, overlayReadout, overlayReady, overlayStale, overlayVariantCount, registerDerivedSource,
} from '../../src/sim/infra/overlays';
import { computeOverlayValues } from '../../src/render/world/overlays';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import { viewLayers } from '../../src/worker/recorder';
import type { Replica } from '../../src/worker/replica';
import type { RasterPatch, ViewState } from '../../src/worker/protocol';
import { newState, place, roadLine } from '../infra/cityGen';

const view = (overlay: Overlay, variant = -1): ViewState => ({ overlay, variant, panels: [], focus: [] });

/** The later replica host binds these seams on adoption; LocalSimHost never registers a source. */
function bind(replica: Replica): () => void {
  const facade = {
    get state() { return replica.state; }, events: replica.events,
    getSystem: (name: string) => name === 'emergency' ? replica.emergency : name === 'traffic' ? replica.traffic : undefined,
  } as unknown as Simulation;
  const offOverlays = attachOverlays(facade);
  const versions = new WeakMap<RasterPatch, number>();
  let version = 0;
  const offSource = registerDerivedSource(replica.state, (o, v) => {
    const r = replica.raster(o, v);
    if (!r) return null;
    let n = versions.get(r);
    if (n === undefined) versions.set(r, (n = ++version));
    return { data: r.data, scale: r.scale, version: n };
  }, (o, v) => {
    if (!viewLayers(view(o, v)).every((name) => replica.layerReady(name))) return false;
    if (o === Overlay.Emergency && !replica.emergency.layersReady) return false;
    return o !== Overlay.Traffic || v !== 1 || replica.traffic.truckVolume() !== null;
  });
  return () => { offSource(); offOverlays(); };
}

describe('W0.5 replica overlay seam', () => {
  it('every delivered view/variant matches the authoritative raster, and first-subscription/resync gaps stay absent', () => {
    const st = newState(32);
    roadLine(st, 2, 12, 30, 12);
    place(st, 't_r2', 8, 13, { pop: 60, kids: 0.3 });
    place(st, 't_cs', 11, 13, { jobs: 20 });
    place(st, 't_coal', 3, 13);
    place(st, 't_tower', 5, 11);
    place(st, 't_school', 14, 13);
    place(st, 't_park', 16, 13);
    place(st, 't_clinic', 18, 13);
    let off = () => {};
    const loop = new LoopbackCore(st, { replica: { adopt: (replica) => { off(); off = bind(replica); } } });
    const a = new Uint8Array(st.cells), b = new Uint8Array(st.cells);
    try {
      loop.runDays(10);
      for (const [o, v] of [[Overlay.Education, 1], [Overlay.Parks, 2], [Overlay.Nimby, 0], [Overlay.Tourism, 0], [Overlay.Parking, 0], [Overlay.Water, 1], [Overlay.Demographics, 0]]) {
        expect(overlayReady(loop.state, o, v), `${Overlay[o]}/${v} before subscription`).toBe(false);
        expect(overlayLayer(loop.state, o, v)).toBeNull();
      }
      const all = Object.values(Overlay).filter((o) => typeof o === 'number') as Overlay[];
      for (const o of all) for (let v = 0; v < overlayVariantCount(o); v++) {
        loop.setView(view(o, v));
        loop.flush();
        expect(overlayReady(loop.state, o, v), `${Overlay[o]}/${v} after delivery`).toBe(true);
        computeOverlayValues(loop.primary, o, a, v);
        computeOverlayValues(loop.state, o, b, v);
        expect(b, `${Overlay[o]}/${v} raster`).toEqual(a);
        expect(overlayReadout(loop.state, o, 8, 13, v), `${Overlay[o]}/${v} readout`).toEqual(overlayReadout(loop.primary, o, 8, 13, v));
      }
      loop.setView(view(Overlay.Demographics, 0));
      expect(overlayReady(loop.state, Overlay.Demographics, 0)).toBe(true);
      const previous = loop.state;
      loop.resync();
      expect(loop.state).not.toBe(previous);
      expect(overlayReady(loop.state, Overlay.Demographics, 0)).toBe(false);
      expect(overlayReady(loop.state, Overlay.Education, 1)).toBe(false);
      loop.flush();
      expect(overlayReady(loop.state, Overlay.Demographics, 0)).toBe(true);
      expect(overlayStale(loop.state, Overlay.Demographics, 0)).toBe(true);
      expect(overlayReady(loop.state, Overlay.Education, 1)).toBe(false);
    } finally { off(); loop.dispose(); }
  });
});
