/**
 * Close-out c1 (major: every exit to the region kept the whole previous city alive), game side. CityScene.dispose took
 * the scene's root out of the page with the WebGL canvas still in it. three.js keeps a disposed renderer — and so its
 * canvas — in the dispose listeners of the materials / geometries / textures it drew, some of which outlive the city
 * (module-level shared ones, the model registry's geometries, three's own DFG LUT); an attached canvas then pinned the
 * whole detached scene DOM, its listeners and through them the CityScene with its CityState. The canvas now leaves the
 * scene's DOM first (the render side releases those listeners too: tests/render/exitRetention.test.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { CityScene } from '../../src/game/CityScene';
import { ErrorOverlay } from '../../src/ui/Modals';
import { SimCore } from '../../src/worker/SimCore';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();

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
      const host = { dispose: vi.fn(() => Promise.resolve()) };
      // (the fields dispose() touches; its views and UI parts as stand-ins)
      const scene = {
        disposed: false, raf: 0, resolveReady: () => undefined, abort: new AbortController(), offs: [] as (() => void)[], resizeObs: null, mods: {},
        newYear: part, sirens: part, emgBanner: part, gameSounds: part, offUiSounds: () => undefined, tools: part, minimap: part,
        objects: part as object, world: part as object, host,
        uiEvents: { clear: () => undefined }, canvas, root,
      };
      (CityScene.prototype.dispose as (this: unknown) => void).call(scene);
      expect(canvas.parentNode).toBeNull();
      expect(root.childNodes).not.toContain(canvas);
      expect(root.parentNode).toBeNull();
      expect(ui.parentNode).toBe(root);
      expect(scene.disposed).toBe(true);
      // close-out c4: the signal aborts with a plain reason (no DOMException whose stack holds the scene), the guarded
      // systems are disposed through the host, and the scene keeps neither real view
      expect(scene.abort.signal.reason).toBe('dispose');
      expect(host.dispose).toHaveBeenCalledTimes(1);
      expect((scene.world as { isNull?: boolean }).isNull).toBe(true);
      expect(scene.objects).not.toBe(part);
      (CityScene.prototype.dispose as (this: unknown) => void).call(scene);
      expect(host.dispose).toHaveBeenCalledTimes(1);
    } finally {
      g.cancelAnimationFrame = had;
    }
  });
});

describe('guarded systems report through ErrorOverlay after the W0.1 move', () => {
  it('reports the existing cutoff, keeps the pause control, and drops the overlay at dispose', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const abort = new AbortController();
    const parent = new FEl('div');
    let core: SimCore;
    const overlay = new ErrorOverlay(parent as unknown as HTMLElement, { pause: () => { core.sim.speed = 0; }, signal: abort.signal });
    const report = vi.spyOn(overlay, 'report');
    core = new SimCore(newState(32), overlay);
    const daily = vi.fn(() => { throw new Error('daily failed'); });
    const system = { name: 'broken', daily };
    try {
      core.boot(null, { createSystems: () => [system] });
      core.sim.runDays(25);
      expect(daily).toHaveBeenCalledTimes(21); // the base uses >20, not >=20
      expect(report).toHaveBeenCalledTimes(21);
      expect(report.mock.calls[20][0]).toContain('disabled');
      expect(parent.querySelectorAll('.err-card')).toHaveLength(1);
      expect(textOf(parent)).toContain('daily failed');
      const pause = parent.all().find((e) => e.tagName === 'button' && textOf(e) === 'Pause simulation');
      expect(pause).toBeTruthy();
      pause!.click();
      expect(core.sim.speed).toBe(0);
      core.dispose();
      abort.abort('dispose');
      expect(parent.all().reduce((n, e) => n + e.listenerCount(), 0)).toBe(0);
      expect((core as unknown as { guard: { errors: unknown } }).guard.errors).toBeNull();
    } finally {
      core.dispose();
      abort.abort('dispose');
      report.mockRestore();
      log.mockRestore();
    }
  });
});
