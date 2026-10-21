/**
 * Close-out c1 (major: every exit to the region kept the whole previous city alive), game side. CityScene.dispose took
 * the scene's root out of the page with the WebGL canvas still in it. three.js keeps a disposed renderer — and so its
 * canvas — in the dispose listeners of the materials / geometries / textures it drew, some of which outlive the city
 * (module-level shared ones, the model registry's geometries, three's own DFG LUT); an attached canvas then pinned the
 * whole detached scene DOM, its listeners and through them the CityScene with its CityState. The canvas now leaves the
 * scene's DOM first (the render side releases those listeners too: tests/render/exitRetention.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { CityScene } from '../../src/game/CityScene';
import { FEl } from './fakeDom';

describe('CityScene.dispose (close-out c1)', () => {
  it('takes the WebGL canvas out of the scene DOM before taking the scene root out of the page', () => {
    const g = globalThis as { cancelAnimationFrame?: unknown };
    const had = g.cancelAnimationFrame;
    g.cancelAnimationFrame = () => undefined;
    try {
      const page = new FEl('div'), root = new FEl('div'), canvas = new FEl('canvas'), ui = new FEl('div');
      page.appendChild(root);
      root.appendChild(canvas);
      root.appendChild(ui);
      const part = { dispose: () => undefined };
      // (the fields dispose() touches; its views and UI parts as stand-ins)
      const scene = {
        disposed: false, raf: 0, resolveReady: () => undefined, abort: new AbortController(), offs: [] as (() => void)[], resizeObs: null, mods: {},
        newYear: part, sirens: part, emgBanner: part, gameSounds: part, offUiSounds: () => undefined, tools: part, minimap: part, objects: part, world: part,
        uiEvents: { clear: () => undefined }, canvas, root,
      };
      (CityScene.prototype.dispose as (this: unknown) => void).call(scene);
      expect(canvas.parentNode).toBeNull();
      expect(root.childNodes).not.toContain(canvas);
      expect(root.parentNode).toBeNull();
      expect(ui.parentNode).toBe(root);
      expect(scene.disposed).toBe(true);
    } finally {
      g.cancelAnimationFrame = had;
    }
  });
});
