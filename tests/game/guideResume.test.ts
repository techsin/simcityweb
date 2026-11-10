/** FH-22: Continue must not press Play for a city saved halfway through founding. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CityScene, type CitySceneOptions } from '../../src/game/CityScene';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import type { CityState } from '../../src/sim/CityState';
import { newProgress } from '../../src/ui/guide/progress';
import { newState, place } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';

// Stop at the construction boundary: inspect the host's options without starting systems, HUD or renderers.
const boundary = vi.hoisted(() => ({ stop: new Error('host boundary'), starts: [] as { kind: string; initialSpeed?: number }[] }));
vi.mock('../../src/worker/SimHost', async (original) => ({
  ...await original<typeof import('../../src/worker/SimHost')>(),
  LocalSimHost: class {
    constructor(_state: unknown, opts: { initialSpeed?: number }) {
      boundary.starts.push({ kind: 'local', initialSpeed: opts.initialSpeed });
      throw boundary.stop;
    }
  },
}));
vi.mock('../../src/worker/LoopbackSimHost', () => ({
  LoopbackSimHost: class {
    constructor(_state: unknown, opts: { initialSpeed?: number }) {
      boundary.starts.push({ kind: 'packet', initialSpeed: opts.initialSpeed });
      throw boundary.stop;
    }
  },
}));
vi.mock('../../src/ui/Modals', async (original) => ({
  ...await original<typeof import('../../src/ui/Modals')>(),
  ErrorOverlay: class {},
}));
vi.mock('../../src/ui/CursorTip', () => ({ CursorTip: class { constructor() { throw boundary.stop; } } }));

installFakeDom();
beforeEach(() => {
  boundary.starts.length = 0;
  vi.stubGlobal('localStorage', { getItem: () => null });
  vi.stubGlobal('location', { search: '' });
});
afterEach(() => vi.unstubAllGlobals());

function construct(state: CityState, opts: Partial<CitySceneOptions> = {}): void {
  expect(() => new CityScene({
    container: new FEl('div') as unknown as HTMLElement, state,
    onExitToRegion: () => {}, onSave: async () => {}, ...opts,
  })).toThrow(boundary.stop);
}

function savedFounding(): CityState {
  const st = newState(32); st.day = 90;
  place(st, 'util_wind_turbine', 10, 10);
  place(st, 'util_water_tower', 12, 10);
  st.systemData.camera = { x: 160, z: 160, distance: 600 };
  st.systemData.onboarding = { ...newProgress(st.day), completed: ['road', 'zones', 'power', 'water'] };
  return deserializeCity(serializeCity(st, { copy: true }));
}

describe('FH-22 founding save initial speed', () => {
  for (const kind of ['local', 'packet'] as const) {
    it(`${kind}: reloads an unfinished founding save paused even with buildings and a camera`, () => {
      const st = savedFounding();
      vi.stubGlobal('location', { search: kind === 'packet' ? '?simworker=loopback' : '' });
      construct(st);
      expect(boundary.starts).toEqual([{ kind, initialSpeed: 0 }]);
      expect(st.day).toBe(90);
      expect(st.systemData.onboarding).toMatchObject({ phase: 'founding', completed: ['road', 'zones', 'power', 'water'] });
    });
  }

  it('leaves a booted packet host paused without sending an initial speed command', () => {
    const setSpeed = vi.fn();
    construct(savedFounding(), { host: { setSpeed, isDisposed: false } as unknown as CitySceneOptions['host'] });
    expect(boundary.starts).toEqual([]);
    expect(setSpeed).not.toHaveBeenCalled();
  });

  it('preserves normal speed for completed Play, first-year and old saves', () => {
    for (const progress of [
      { ...newProgress(90), completed: ['road', 'zones', 'power', 'water', 'play'] },
      { ...newProgress(90), phase: 'year' },
      undefined,
      { version: 2, phase: 'founding' },
    ]) {
      const st = savedFounding(); st.systemData.onboarding = progress;
      construct(st);
      expect(boundary.starts.at(-1)).toEqual({ kind: 'local', initialSpeed: undefined });
      const setSpeed = vi.fn();
      construct(st, { host: { setSpeed, isDisposed: false } as unknown as CitySceneOptions['host'] });
      expect(setSpeed).toHaveBeenCalledExactlyOnceWith(1, 'initial');
    }
  });

  it('keeps a new city paused and honours the explicit development speed override', () => {
    construct(newState(32));
    expect(boundary.starts.at(-1)?.initialSpeed).toBe(0);
    construct(savedFounding(), { initialSpeed: 3 });
    expect(boundary.starts.at(-1)?.initialSpeed).toBe(3);
    const setSpeed = vi.fn();
    construct(savedFounding(), { initialSpeed: 2, host: { setSpeed, isDisposed: false } as unknown as CitySceneOptions['host'] });
    expect(setSpeed).toHaveBeenCalledExactlyOnceWith(2, 'initial');
  });
});
