/** W0.5 / O9: missing data has no tint; delivery enables it without another click or simulation tick. */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Overlay } from '../../src/core/types';
import { TerrainRenderer } from '../../src/render/world/TerrainRenderer';
import { overlayLegend } from '../../src/render/world/overlays';
import { overlayValue, registerDerivedSource, type Entry } from '../../src/sim/infra/overlays';
import { legendHtml } from '../../src/ui/overlays';
import { newState } from '../infra/cityGen';

describe('W0.5 overlay readiness', () => {
  it('keeps tint off and legend loading until delivery, refreshes paused versions, and hides again on resync', () => {
    const st = newState(16), rasters = new Map<number, Entry>();
    const off = registerDerivedSource(st, (o, v) => o === Overlay.Demographics ? rasters.get(v) ?? null : null);
    const terrain = new TerrainRenderer(st, 0, false);
    const tex = terrain.uniforms.uOverlayTex.value as THREE.DataTexture;
    const legend = vi.fn(overlayLegend);
    let offFresh = () => {};
    try {
      terrain.setOverlay(Overlay.Demographics, 0);
      const uploads = tex.version;
      terrain.update();
      expect(terrain.uniforms.uOverlayOn.value).toBe(0);
      expect(tex.version).toBe(uploads);
      expect(legendHtml(Overlay.Demographics, legend, 0, st)).toContain('Loading…');
      expect(legend).not.toHaveBeenCalled();
      rasters.set(1, { data: new Float32Array(st.cells).fill(0.8), scale: 1, version: 1 });
      terrain.update();
      expect(terrain.uniforms.uOverlayOn.value).toBe(0);
      const e: Entry = { data: new Float32Array(st.cells).fill(0.25), scale: 1, version: 2 };
      rasters.set(0, e);
      terrain.update();
      expect(terrain.uniforms.uOverlayOn.value).toBe(1);
      expect(tex.version).toBe(uploads + 1);
      expect((tex.image.data as Uint8Array)[0]).toBe(64);
      expect(legendHtml(Overlay.Demographics, legend, 0, st)).not.toContain('Loading…');
      terrain.update();
      expect(tex.version).toBe(uploads + 1);
      e.data.fill(0.75); e.version++;
      overlayValue(st, Overlay.Demographics, 0, 0); // a hover before the frame must not swallow this version
      terrain.update();
      expect(tex.version).toBe(uploads + 2);
      expect((tex.image.data as Uint8Array)[0]).toBe(191);
      terrain.setOverlay(Overlay.Demographics, 2);
      terrain.update();
      expect(terrain.uniforms.uOverlayOn.value).toBe(0);
      terrain.setOverlay(Overlay.Demographics, 0);
      terrain.update();
      expect(terrain.uniforms.uOverlayOn.value).toBe(1);
      expect((tex.image.data as Uint8Array)[0]).toBe(191);
      const fresh = newState(16);
      offFresh = registerDerivedSource(fresh, () => null);
      terrain.reset(fresh);
      const beforeResetFrame = tex.version;
      terrain.update();
      expect(terrain.uniforms.uOverlayOn.value).toBe(0);
      expect(tex.version).toBe(beforeResetFrame);
      expect(legendHtml(Overlay.Demographics, legend, 0, fresh)).toContain('Loading…');
    } finally { offFresh(); off(); terrain.dispose(); }
  });

  it('direct subscribed layers enable the terrain and the renderer/fallback legends together', () => {
    const st = newState(16);
    let ready = false;
    const off = registerDerivedSource(st, () => null, () => ready);
    const terrain = new TerrainRenderer(st, 0, false);
    try {
      terrain.setOverlay(Overlay.Education, 1);
      terrain.update();
      expect(terrain.uniforms.uOverlayOn.value).toBe(0);
      expect(legendHtml(Overlay.Education, overlayLegend, 1, st)).toContain('Loading…');
      expect(legendHtml(Overlay.Education, undefined, 1, st)).toContain('Loading…');
      st.eduElemCov.fill(0.5); ready = true;
      terrain.update();
      expect(terrain.uniforms.uOverlayOn.value).toBe(1);
      expect(((terrain.uniforms.uOverlayTex.value as THREE.DataTexture).image.data as Uint8Array)[0]).toBe(128);
      expect(legendHtml(Overlay.Education, overlayLegend, 1, st)).toBe(legendHtml(Overlay.Education, overlayLegend, 1));
      expect(legendHtml(Overlay.Education, undefined, 1, st)).toBe(legendHtml(Overlay.Education, undefined, 1));
    } finally { off(); terrain.dispose(); }
  });
});
