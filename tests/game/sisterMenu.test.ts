/**
 * LG-12: "Found a sister city" from inside a city.
 * - The pause menu offers it while the scene has the hook (GameContext.foundSister), closes without resuming, and
 *   disables it in a read-only region.
 * - The scene sets the hook only when the App takes it and the region context of the entry has a free tile next door.
 * - It leaves the city exactly as "Save & exit to region" does (pause, exit save, thumbnail), then hands over to the
 *   App's onFoundSister instead of onExitToRegion.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CityScene, sisterOffered } from '../../src/game/CityScene';
import type { GameContext } from '../../src/game/context';
import type { RegionContext, RegionNeighbor } from '../../src/region/regionEffects';
import { PauseMenu } from '../../src/ui/Modals';
import type { HostState, SaveReason } from '../../src/worker/SimHost';
import { deferred, smallCity } from '../save/fixtures';
import { FEl, installFakeDom, textOf } from './fakeDom';

const access = vi.hoisted(() => ({ allowed: true, listeners: new Set<() => void>() }));
vi.mock('../../src/save/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/save/db')>(),
  regionSaveAccess: () => access.allowed,
  watchRegionSaveAccess: (_regionId: string | undefined, update: () => void, signal?: AbortSignal) => {
    access.listeners.add(update);
    const off = () => { access.listeners.delete(update); };
    signal?.addEventListener('abort', off, { once: true });
    return off;
  },
}));
vi.mock('../../src/ui/StorageDialog', () => ({ showStorageError: vi.fn(), storageConditionVersion: () => 0, storageDialogOpen: () => false }));

installFakeDom();
beforeEach(() => {
  access.allowed = true;
  access.listeners.clear();
  vi.clearAllMocks();
});

function menu(withSister: boolean) {
  const parent = new FEl('div'), controller = new AbortController();
  const ctx = {
    state: { config: { name: 'Queensbury', startYear: 2000 }, day: 0, stats: { population: 0 } },
    host: { setSpeed: vi.fn(), resume: vi.fn() }, signal: controller.signal,
    sound: vi.fn(), save: vi.fn(), exitToRegion: vi.fn(),
    ...(withSister ? { foundSister: vi.fn(async () => undefined) } : {}),
  };
  const pause = new PauseMenu(ctx as unknown as GameContext, parent as unknown as HTMLElement, { onSettings() {}, onHelp() {} });
  pause.open();
  const labels = () => parent.querySelectorAll('button').map((b) => textOf(b));
  const item = (label: string) => parent.querySelectorAll('button').find((b) => textOf(b).includes(label));
  return { ctx, pause, parent, controller, labels, item };
}

describe('LG-12: the pause menu', () => {
  it('offers "Found a sister city" under the exit while the scene has the hook, and not otherwise', () => {
    const m = menu(true);
    expect(m.labels()).toEqual(['ResumeEsc', 'Save cityCtrl S', 'Save & exit to region', 'Found a sister city', 'Settings', 'Help & shortcutsF1']);
    expect(m.item('Found a sister city')!.title).toBe('Saves the city and opens the New City dialog on the free land next to it');
    m.controller.abort();
    const none = menu(false);
    expect(none.labels()).toEqual(['ResumeEsc', 'Save cityCtrl S', 'Save & exit to region', 'Settings', 'Help & shortcutsF1']);
    none.controller.abort();
  });

  it('closes the menu without resuming the game and starts the founding', async () => {
    const m = menu(true);
    m.item('Found a sister city')!.click();
    await Promise.resolve();
    expect(m.pause.isOpen).toBe(false);
    expect(m.ctx.host.resume).not.toHaveBeenCalled();
    expect(m.ctx.foundSister).toHaveBeenCalledOnce();
    expect(m.ctx.exitToRegion).not.toHaveBeenCalled();
    m.controller.abort();
  });

  it('is disabled while the region is open in another tab: founding writes', () => {
    const m = menu(true);
    const sister = m.item('Found a sister city')!;
    expect(sister.disabled).toBe(false);
    access.allowed = false;
    access.listeners.forEach((update) => update());
    expect(sister.disabled).toBe(true);
    expect(m.item('Exit to region')!.disabled).toBe(false);
    access.allowed = true;
    access.listeners.forEach((update) => update());
    expect(sister.disabled).toBe(false);
    m.controller.abort();
  });
});

describe('LG-12: when the scene offers it', () => {
  const neighbour = (founded: boolean): RegionNeighbor => ({ edge: 'e', tileKey: '6_4', name: founded ? 'Fairland' : null, founded, population: 0, jobs: 0, workers: 0, r: 0, c: 0, i: 0, from: 0, to: 64 });
  const rctx = (...neighbors: RegionNeighbor[]): RegionContext => ({ regionId: 'r', tileKey: '4_4', population: 0, jobs: 0, workers: 0, neighbors, adjacentPopulation: 0, adjacentJobs: 0, adjacentWorkers: 0, jobBonus: 0, workerBonus: 0 });

  it('needs the App\'s handler and an unfounded tile next to the city', () => {
    const onFoundSister = vi.fn();
    expect(sisterOffered({ onFoundSister, rctx: rctx(neighbour(true), neighbour(false)) })).toBe(true);
    expect(sisterOffered({ onFoundSister, rctx: rctx(neighbour(true)) })).toBe(false);
    expect(sisterOffered({ onFoundSister, rctx: rctx() })).toBe(false);
    expect(sisterOffered({ onFoundSister })).toBe(false);
    expect(sisterOffered({ rctx: rctx(neighbour(false)) })).toBe(false);
  });
});

describe('LG-12: leaving the city to found a sister city', () => {
  function fixture() {
    const gate = deferred(), state = smallCity(), order: string[] = [];
    const onSave = vi.fn((_state: HostState, reason?: SaveReason) => { order.push(reason!); return gate.promise; });
    const scene = {
      disposed: false, saving: null as Promise<void> | null, monthsSinceSave: 3, lastSaveAt: -Infinity,
      autosaveFailure: { count: 0, retryAt: 0 }, storageCondition: 0,
      abort: new AbortController(),
      host: { state, setSpeed: vi.fn(() => { order.push('pause'); }) },
      storeCamera: vi.fn(() => { order.push('camera'); }),
      opts: { onSave, onExitToRegion: vi.fn(() => { order.push('region'); }), onFoundSister: vi.fn(() => { order.push('sister'); }) },
      savePill: { saving: vi.fn(), done: vi.fn(), cancel: vi.fn() }, sound: vi.fn(), errors: { report: vi.fn() },
      tools: { select: vi.fn() }, panels: { closeAll: vi.fn() },
      world: { capture: vi.fn(() => { order.push('capture'); return 'thumbnail'; }) },
      recordSaved() { CityScene.prototype.recordSaved.call(this as unknown as CityScene); },
      save(auto?: boolean, reason?: SaveReason) { return CityScene.prototype.save.call(this as unknown as CityScene, auto, reason); },
    };
    return { scene, gate, order };
  }

  it('pauses, waits for the exit save, takes the thumbnail, then hands the city to onFoundSister', async () => {
    const { scene, gate, order } = fixture();
    const leaving = CityScene.prototype.exitToRegion.call(scene as unknown as CityScene, scene.opts.onFoundSister);
    expect(order).toEqual(['pause', 'camera', 'exit']);
    expect(scene.opts.onFoundSister).not.toHaveBeenCalled();
    gate.resolve();
    await leaving;
    expect(order).toEqual(['pause', 'camera', 'exit', 'capture', 'sister']);
    expect(scene.opts.onFoundSister).toHaveBeenCalledExactlyOnceWith('thumbnail');
    expect(scene.opts.onExitToRegion).not.toHaveBeenCalled();
  });

  it('the ordinary exit still goes to onExitToRegion alone', async () => {
    const { scene, gate, order } = fixture();
    const leaving = CityScene.prototype.exitToRegion.call(scene as unknown as CityScene);
    gate.resolve();
    await leaving;
    expect(order).toEqual(['pause', 'camera', 'exit', 'capture', 'region']);
    expect(scene.opts.onExitToRegion).toHaveBeenCalledExactlyOnceWith('thumbnail');
    expect(scene.opts.onFoundSister).not.toHaveBeenCalled();
  });

  it('a scene disposed while its exit save was written founds nothing', async () => {
    const { scene, gate } = fixture();
    const leaving = CityScene.prototype.exitToRegion.call(scene as unknown as CityScene, scene.opts.onFoundSister);
    scene.disposed = true;
    gate.resolve();
    await leaving;
    expect(scene.world.capture).not.toHaveBeenCalled();
    expect(scene.opts.onFoundSister).not.toHaveBeenCalled();
  });
});
