/** W0.5: supplied rasters and subscription readiness leave the local builders unchanged. */
import { describe, expect, it } from 'vitest';
import { Overlay } from '../../src/core/types';
import {
  DESIR_FAMILIES, emergencyReachAt, markOverlayRendered, overlayLayer, overlayReadout, overlayReady, overlayStale, overlayValue,
  overlayVariantCount, registerDerivedSource, type Entry,
} from '../../src/sim/infra/overlays';
import { computeOverlayValues } from '../../src/render/world/overlays';
import { legendHtml } from '../../src/ui/overlays';
import { newState } from './cityGen';

describe('W0.5 derived sources', () => {
  it('supplied data wins over a cached local raster; only an upload acknowledges its version', () => {
    const st = newState(16);
    st.watered.fill(1);
    expect(overlayLayer(st, Overlay.Water, 1)!.data[0]).toBe(1);
    const supplied: Entry = { data: new Float32Array(st.cells).fill(0.55), scale: 1, version: 7 };
    const off = registerDerivedSource(st, (o, v) => o === Overlay.Water && v === 1 ? supplied : null);
    try {
      expect(overlayLayer(st, Overlay.Water, 1)!.data).toBe(supplied.data);
      expect(overlayReadout(st, Overlay.Water, 0, 0, 1)!.text).toContain('50%');
      expect(overlayStale(st, Overlay.Water, 1)).toBe(true);
      markOverlayRendered(st, Overlay.Water, 1);
      expect(overlayStale(st, Overlay.Water, 1)).toBe(false);
      // Same day and buffer: a version, not day or object identity, drives the refresh.
      supplied.data.fill(0.82);
      supplied.version++;
      expect(overlayValue(st, Overlay.Water, 0, 0, 1)).toBeCloseTo(0.82);
      legendHtml(Overlay.Water, undefined, 1, st);
      expect(overlayStale(st, Overlay.Water, 1)).toBe(true);
      expect(overlayStale(st, Overlay.Water, 1)).toBe(true);
      markOverlayRendered(st, Overlay.Water, 1);
      expect(overlayStale(st, Overlay.Water, 1)).toBe(false);
    } finally { off(); }
    expect(overlayLayer(st, Overlay.Water, 1)!.data[0]).toBe(1);
  });

  it('missing worker rasters stay absent per resolved variant and return after a fresh-state resync', () => {
    const st = newState(16);
    const rasters = new Map<string, Entry>();
    const source = (o: Overlay, v: number) => rasters.get(`${o}:${v}`) ?? null;
    const off = registerDerivedSource(st, source);
    try {
      for (const [o, first] of [[Overlay.Water, 1], [Overlay.Desirability, DESIR_FAMILIES], [Overlay.Demographics, 0]]) {
        for (let v = first; v < overlayVariantCount(o); v++) {
          expect(overlayReady(st, o, v)).toBe(false);
          expect(overlayLayer(st, o, v)).toBeNull();
          expect(overlayReadout(st, o, 0, 0, v)).toBeNull();
          expect(legendHtml(o, undefined, v, st)).toContain('Loading…');
        }
      }
      const e: Entry = { data: new Float32Array(st.cells).fill(0.25), scale: 1, version: 1 };
      rasters.set(`${Overlay.Demographics}:0`, e);
      expect(overlayLayer(st, Overlay.Demographics)!.data).toBe(e.data);
      expect(overlayReady(st, Overlay.Demographics, 1)).toBe(false);
      expect(overlayReady(st, Overlay.Demographics)).toBe(true); // switching back uses cached source data
      const fresh = newState(16);
      const offFresh = registerDerivedSource(fresh, () => null);
      try {
        expect(overlayReady(fresh, Overlay.Demographics)).toBe(false);
        expect(overlayLayer(fresh, Overlay.Demographics)).toBeNull();
      } finally { offFresh(); }
    } finally { off(); }
  });

  it('direct and main-built views wait for their inputs; None and Zones never wait', () => {
    const st = newState(16);
    st.eduElemCov.fill(0.75); st.prestige.fill(0.4); st.stigma.fill(0.1);
    const ready = new Set<string>();
    const off = registerDerivedSource(st, () => null, (o, v) => ready.has(`${o}:${v}`));
    try {
      for (const [o, v] of [[Overlay.Education, 1], [Overlay.Nimby, 0], [Overlay.Emergency, 0], [Overlay.Traffic, 1]]) {
        expect(overlayReady(st, o, v)).toBe(false);
        expect(overlayLayer(st, o, v)).toBeNull();
        expect(overlayReadout(st, o, 0, 0, v)).toBeNull();
      }
      expect(emergencyReachAt(st, 0)).toBeNull();
      expect(overlayReady(st, Overlay.None)).toBe(true);
      expect(overlayReady(st, Overlay.Zones)).toBe(true);
      ready.add(`${Overlay.Education}:1`);
      expect(overlayLayer(st, Overlay.Education, 1)!.data).toBe(st.eduElemCov);
      expect(overlayReady(st, Overlay.Education, 2)).toBe(false);
      ready.add(`${Overlay.Nimby}:0`);
      expect(overlayLayer(st, Overlay.Nimby)!.data[0]).toBeCloseTo(0.3);
    } finally { off(); }
  });

  it('with no source every local view and variant retains its raster and legend', () => {
    const st = newState(16);
    const out = new Uint8Array(st.cells);
    const all = Object.values(Overlay).filter((o) => typeof o === 'number') as Overlay[];
    const before = all.flatMap((o) => Array.from({ length: overlayVariantCount(o) }, (_, v) => {
      computeOverlayValues(st, o, out, v);
      return { o, v, bytes: out.slice(), legend: legendHtml(o, undefined, v, st) };
    }));
    const off = registerDerivedSource(st, () => null, () => false);
    off();
    for (const { o, v, bytes, legend } of before) {
      expect(overlayReady(st, o, v)).toBe(true);
      computeOverlayValues(st, o, out, v);
      expect(out, `${Overlay[o]}/${v}`).toEqual(bytes);
      expect(legendHtml(o, undefined, v, st)).toBe(legend);
    }
  });
});
