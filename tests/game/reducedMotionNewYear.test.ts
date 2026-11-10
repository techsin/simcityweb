/** FEEL-21: reduced motion releases New Year's camera, clock and calendar without changing the fireworks. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { NewYearCelebration } from '../../src/game/NewYear';
import { DEFAULT_SETTINGS, type GameSettings } from '../../src/game/settings';
import type { CityObjectsViewApi, WorldViewApi } from '../../src/render/contracts';
import type { CityEvents, Simulation } from '../../src/sim/Simulation';

const cleanup: (() => void)[] = [];
let systemReduced = false;
beforeEach(() => {
  systemReduced = false;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: systemReduced })));
});
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.unstubAllGlobals();
});

function setup(overrides: Partial<GameSettings> = {}) {
  const events = new Emitter<CityEvents>();
  const state = {
    day: 361, year: 2001, stats: { population: 1200 }, buildings: new Map([[1, {}]]),
    history: { pop: [] as number[] }, config: { name: 'Testville' },
  };
  const sim = { events, state, speed: 1 } as unknown as Simulation;
  const world = {
    autoTime: true, timeScale: 2, timeOfDay: 10.5,
    camera: { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 500, 0, 1] } },
    cameraController: {
      enabled: true, target: { x: 0, z: 0 }, distance: 900, yawAngle: 0.7, tiltAngle: 0.9,
      setView: vi.fn(function (this: { target: { x: number; z: number }; distance: number }, x: number, z: number, d: number) {
        this.target = { x, z };
        this.distance = d;
      }),
    },
  };
  const fw = {
    active: false, midnight: 0, timeScale: 1, onSound: null,
    centre: { x: 100, z: 100 },
    start: vi.fn(function (this: { active: boolean; midnight: number }, options: { delay?: number }) {
      this.active = true;
      this.midnight = options.delay ?? 0;
    }),
    stop: vi.fn(), fastForward: vi.fn(),
  };
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  const holdCalendar = vi.fn();
  const overlay = { style: { display: 'flex' }, textContent: '3', remove: vi.fn() };
  const ny = new NewYearCelebration({
    sim, world: () => world as unknown as WorldViewApi,
    objects: () => ({ fireworks: fw }) as unknown as CityObjectsViewApi,
    settings: () => settings, toast: vi.fn(), holdCalendar,
  });
  cleanup.push(() => ny.dispose());
  let now = 1000;
  const step = (seconds: number) => {
    const frames = Math.round(seconds * 60);
    for (let frame = 0; frame < frames; frame++) {
      ny.frame(1 / 60, now);
      now += 1000 / 60;
    }
  };
  return { ny, world, fw, settings, holdCalendar, overlay, step };
}

describe('New Year reduced motion (FEEL-21)', () => {
  it.each(['reduced', 'system'] as const)('%s starts fireworks with no camera, countdown or clock takeover', (motion) => {
    systemReduced = true;
    const { ny, world, fw, holdCalendar, step } = setup({ motion });
    expect(ny.celebrate({ camera: true })).toBe(true);
    expect(ny.cameraActive).toBe(false);
    expect(ny.ownsTime).toBe(false);
    expect(ny['countdownOn']).toBe(false);
    expect(holdCalendar).not.toHaveBeenCalled();
    step(10);
    expect(world.cameraController.setView).not.toHaveBeenCalled();
    expect(world.timeOfDay).toBe(10.5);
    expect(world.timeScale).toBe(2);
    expect(fw.start).toHaveBeenCalledTimes(1);
    expect(fw.stop).not.toHaveBeenCalled();
  });

  it('an old caller with no motion key follows the OS', () => {
    systemReduced = true;
    const { ny } = setup({ motion: undefined });
    ny.celebrate({ camera: true });
    expect(ny.cameraActive).toBe(false);
    expect(ny.ownsTime).toBe(false);
  });

  it('switching during the lapse releases the camera, clock and calendar immediately', () => {
    const { ny, settings, world, fw, holdCalendar, overlay, step } = setup({ motion: 'full' });
    ny.celebrate({ camera: true });
    step(0.5);
    expect(ny.cameraActive).toBe(true);
    expect(ny.ownsTime).toBe(true);
    expect(holdCalendar).toHaveBeenLastCalledWith(true);
    const camera = { ...world.cameraController.target };
    const views = world.cameraController.setView.mock.calls.length;
    const start = fw.start.mock.calls[0][0];
    ny['overlay'] = overlay as unknown as HTMLDivElement;
    settings.motion = 'reduced';
    ny.applyMotion();
    expect(ny.cameraActive).toBe(false);
    expect(ny.ownsTime).toBe(false);
    expect(holdCalendar).toHaveBeenLastCalledWith(false);
    expect(world.timeScale).toBe(2);
    expect(world.autoTime).toBe(true);
    expect(overlay.style.display).toBe('none');
    expect(overlay.textContent).toBe('');
    step(10);
    expect(world.cameraController.target).toEqual(camera);
    expect(world.cameraController.setView).toHaveBeenCalledTimes(views);
    expect(fw.start).toHaveBeenCalledExactlyOnceWith(start);
    expect(fw.stop).not.toHaveBeenCalled();
  });

  it('a live OS change is applied by frame(), and switching back restores the next cinematic', () => {
    const { ny, world, holdCalendar, step } = setup();
    ny.celebrate({ camera: true });
    step(0.5);
    expect(ny.cameraActive).toBe(true);
    systemReduced = true;
    ny.frame(1 / 60, 2000);
    expect(ny.cameraActive).toBe(false);
    expect(ny.ownsTime).toBe(false);
    expect(holdCalendar).toHaveBeenLastCalledWith(false);
    systemReduced = false;
    world.cameraController.setView.mockClear();
    ny.celebrate({ camera: true });
    step(0.5);
    expect(ny.cameraActive).toBe(true);
    expect(ny.ownsTime).toBe(true);
    expect(ny['countdownOn']).toBe(true);
    expect(holdCalendar).toHaveBeenLastCalledWith(true);
    expect(world.cameraController.setView).toHaveBeenCalled();
  });

  it('reduced motion restores a fixed clock without a return time-lapse', () => {
    const { ny, settings, world, fw, step } = setup({ motion: 'full', autoTime: false, fixedHour: 14 });
    ny.celebrate({ camera: true });
    // A finished show must be past the existing five-second guard after its opening salvo.
    step(fw.midnight + 6);
    expect(ny.ownsTime).toBe(true);
    settings.motion = 'reduced';
    ny.applyMotion();
    expect(ny.ownsTime).toBe(false);
    expect(ny.cameraActive).toBe(false);
    expect(world.autoTime).toBe(false);
    expect(world.timeOfDay).toBe(14);
    fw.active = false;
    step(1);
    expect(ny.active).toBe(false);
    expect(world.timeOfDay).toBe(14);
  });

  it('switching during the restore ends its clock and camera animation', () => {
    const { ny, settings, world, fw, step } = setup({ motion: 'full' });
    ny.celebrate({ camera: true });
    step(12);
    fw.active = false;
    step(1);
    expect(ny['phase']).toBe('restore');
    const views = world.cameraController.setView.mock.calls.length;
    settings.motion = 'reduced';
    ny.applyMotion();
    step(1);
    expect(ny.active).toBe(false);
    expect(ny.cameraActive).toBe(false);
    expect(ny.ownsTime).toBe(false);
    expect(world.timeScale).toBe(2);
    expect(world.cameraController.setView).toHaveBeenCalledTimes(views);
  });
});
