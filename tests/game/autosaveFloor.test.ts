/** FEEL-02b: game-month scheduling respects real time; only manual saves announce success. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CityScene } from '../../src/game/CityScene';
import { PauseMenu, SavePill } from '../../src/ui/Modals';
import type { GameContext } from '../../src/game/context';
import { showStorageError, storageConditionVersion, storageDialogOpen } from '../../src/ui/StorageDialog';
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
vi.mock('../../src/ui/StorageDialog', () => ({ showStorageError: vi.fn(), storageConditionVersion: vi.fn(() => 0), storageDialogOpen: vi.fn(() => false) }));

installFakeDom();
let now = 0;
beforeEach(() => {
  now = 0;
  access.allowed = true;
  access.listeners.clear();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('window', { setTimeout: globalThis.setTimeout });
  vi.clearAllMocks();
  vi.mocked(storageConditionVersion).mockReturnValue(0);
  vi.mocked(storageDialogOpen).mockReturnValue(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(months = 3) {
  const parent = new FEl('div');
  const standIn = Object.assign(Object.create(CityScene.prototype) as object, {
    disposed: false, saving: null, monthsSinceSave: 0, lastSaveAt: 0,
    autosaveFailure: { count: 0, retryAt: 0 }, storageCondition: 0,
    abort: new AbortController(),
    settings: { autosaveMonths: months },
    opts: { persistence: { regionId: 'region' }, onSave: vi.fn().mockResolvedValue(undefined) },
    host: { state: {} }, storeCamera: vi.fn(),
    savePill: new SavePill(parent as unknown as HTMLElement), sound: vi.fn(),
  });
  const scene = standIn as unknown as CityScene;
  const internals = standIn as unknown as {
    onMonth(): void; lastSaveAt: number; monthsSinceSave: number; saving: Promise<void> | null;
    opts: { onSave: ReturnType<typeof vi.fn> }; sound: ReturnType<typeof vi.fn>; savePill: SavePill;
  };
  const month = async (at: number) => {
    now = at;
    internals.onMonth();
    await internals.saving;
  };
  return { scene, internals, parent, month };
}

describe('the real-time autosave floor', () => {
  it('at 1× saves at the first month end at least 60 seconds after the last save', async () => {
    const f = fixture();
    for (const at of [15_000, 30_000, 45_000]) await f.month(at);
    expect(f.internals.opts.onSave).not.toHaveBeenCalled();
    await f.month(60_000);
    expect(f.internals.opts.onSave).toHaveBeenCalledExactlyOnceWith(f.scene.host.state, 'autosave');
    expect(f.internals.monthsSinceSave).toBe(0);
    expect(f.internals.lastSaveAt).toBe(60_000);
  });

  it('at ultra makes at most five silent autosaves in five real minutes', async () => {
    const f = fixture();
    for (let at = 1500; at <= 300_000; at += 1500) await f.month(at);
    expect(f.internals.opts.onSave).toHaveBeenCalledTimes(5);
    expect(f.internals.sound).not.toHaveBeenCalled();
    expect(f.parent.querySelector('.save-pill.show')).toBeNull();
  });

  it('manual and app-level hidden saves both restart the floor', async () => {
    const f = fixture();
    now = 55_000;
    await f.scene.save();
    expect(f.internals.sound).toHaveBeenCalledExactlyOnceWith('save');
    for (const at of [60_000, 75_000, 90_000, 105_000]) await f.month(at);
    expect(f.internals.opts.onSave).toHaveBeenCalledTimes(1);
    await f.month(120_000);
    expect(f.internals.opts.onSave).toHaveBeenCalledTimes(2);
    now = 170_000;
    f.scene.recordSaved();
    for (const at of [180_000, 195_000, 210_000, 225_000]) await f.month(at);
    expect(f.internals.opts.onSave).toHaveBeenCalledTimes(2);
    await f.month(240_000);
    expect(f.internals.opts.onSave).toHaveBeenCalledTimes(3);
  });

  it('waits until a slow successful save finishes before restarting the minute', async () => {
    const f = fixture();
    let finish!: () => void;
    f.internals.opts.onSave.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    now = 60_000;
    const saving = f.scene.save(true);
    now = 70_000;
    finish(); await saving;
    for (const at of [85_000, 100_000, 115_000]) await f.month(at);
    expect(f.internals.opts.onSave).toHaveBeenCalledTimes(1);
    await f.month(130_000);
    expect(f.internals.opts.onSave).toHaveBeenCalledTimes(2);
  });

  it('turns autosave and manual saves off in a read-only region', async () => {
    const f = fixture();
    access.allowed = false;
    for (const at of [60_000, 75_000, 90_000]) await f.month(at);
    await f.scene.save();
    expect(f.internals.opts.onSave).not.toHaveBeenCalled();
    access.allowed = true;
    await f.month(105_000);
    expect(f.internals.opts.onSave).toHaveBeenCalledOnce();
  });

  it('keeps autosave disabled when the setting is off', async () => {
    const f = fixture(0);
    for (const at of [60_000, 120_000, 180_000]) await f.month(at);
    expect(f.internals.opts.onSave).not.toHaveBeenCalled();
  });

  it('starts the first backoff at failure completion and sounds once', async () => {
    const f = fixture();
    let fail!: (error: Error) => void;
    f.internals.opts.onSave.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    now = 60_000;
    const saving = f.scene.save(true);
    now = 70_000;
    fail(new DOMException('quota', 'QuotaExceededError'));
    await saving;
    expect(f.internals.lastSaveAt).toBe(70_000);
    for (const at of [85_000, 100_000, 115_000, 129_999]) await f.month(at);
    expect(f.internals.opts.onSave).toHaveBeenCalledTimes(1);
    await f.month(130_000);
    expect(f.internals.opts.onSave).toHaveBeenCalledTimes(2);
    expect(f.internals.sound).toHaveBeenCalledExactlyOnceWith('error');
    expect(f.parent.querySelector('.save-pill.show')).toBeNull();
  });

  it('skips autosave while a storage dialog is open', async () => {
    const f = fixture();
    vi.mocked(storageDialogOpen).mockReturnValue(true);
    for (const at of [60_000, 120_000, 180_000]) await f.month(at);
    expect(f.internals.opts.onSave).not.toHaveBeenCalled();
    vi.mocked(storageDialogOpen).mockReturnValue(false);
    await f.month(195_000);
    expect(f.internals.opts.onSave).toHaveBeenCalledOnce();
  });

  it('keeps the error sound and pill for a failed manual save', async () => {
    const f = fixture();
    f.internals.opts.onSave.mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));
    await f.scene.save();
    expect(f.internals.sound).toHaveBeenCalledExactlyOnceWith('error');
    expect(textOf(f.parent.querySelector('.save-pill.show')!)).toContain('Save failed');
  });

  it('sends quota failures to the guided dialog and permits its retry', async () => {
    const f = fixture();
    const error = new DOMException('raw quota message', 'QuotaExceededError');
    f.internals.opts.onSave.mockRejectedValueOnce(error);
    now = 60_000;
    await f.scene.save(true);
    expect(showStorageError).toHaveBeenCalledWith(error, expect.objectContaining({ retry: expect.any(Function), signal: expect.any(AbortSignal) }));
    expect(f.internals.lastSaveAt).toBe(60_000);
    vi.mocked(storageDialogOpen).mockReturnValue(true);
    const retry = vi.mocked(showStorageError).mock.calls[0][1].retry!;
    await retry();
    expect(f.internals.opts.onSave).toHaveBeenCalledTimes(2);
    expect(f.internals.lastSaveAt).toBe(60_000);
    expect(f.parent.querySelector('.save-pill.show')).toBeNull();
  });

  it('honours explicit Retry when the city save succeeded but the region save failed', async () => {
    const f = fixture();
    const error = new DOMException('region quota', 'QuotaExceededError');
    f.internals.opts.onSave.mockImplementationOnce(async () => {
      f.scene.recordSaved();
      throw error;
    });
    now = 60_000;
    await f.scene.save(true);
    expect(f.internals.lastSaveAt).toBe(60_000);
    const retry = vi.mocked(showStorageError).mock.calls[0][1].retry;
    await retry();
    expect(f.internals.opts.onSave).toHaveBeenCalledTimes(2);
    expect(f.internals.sound).toHaveBeenCalledExactlyOnceWith('error');
    expect(f.parent.querySelector('.save-pill.show')).toBeNull();
  });
});

describe('autosave failure backoff at ultra', () => {
  function failingUltra() {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout });
    const f = fixture();
    const attempts: number[] = [];
    f.internals.opts.onSave.mockImplementation(async () => {
      attempts.push(performance.now());
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const timer = setInterval(() => f.internals.onMonth(), 1500);
    return { ...f, attempts, stop: () => clearInterval(timer) };
  }

  it('backs off 60 seconds, then 2, 4, 8 and capped 15 minutes with one error sound', async () => {
    const f = failingUltra();
    await vi.advanceTimersByTimeAsync(2_760_000);
    f.stop();
    expect(f.attempts).toEqual([60_000, 120_000, 240_000, 480_000, 960_000, 1_860_000, 2_760_000]);
    expect(f.internals.sound).toHaveBeenCalledExactlyOnceWith('error');
    expect(f.parent.querySelector('.save-pill.show')).toBeNull();
  });

  it.each(['auto', 'manual', 'hidden'] as const)('a successful %s save resets the backoff and permits one new error sound', async (kind) => {
    const f = failingUltra();
    await vi.advanceTimersByTimeAsync(120_000);
    const savedAt = kind === 'auto' ? 240_000 : 150_000;
    if (kind === 'auto') {
      f.internals.opts.onSave.mockImplementationOnce(async () => { f.attempts.push(performance.now()); });
      await vi.advanceTimersByTimeAsync(savedAt - performance.now());
    } else {
      await vi.advanceTimersByTimeAsync(savedAt - performance.now());
      if (kind === 'manual') {
        f.internals.opts.onSave.mockImplementationOnce(async () => { f.attempts.push(performance.now()); });
        await f.scene.save();
      } else f.scene.recordSaved();
    }
    const before = f.attempts.length;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(f.attempts).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(60_001);
    f.stop();
    expect(f.attempts.slice(before)).toEqual([savedAt + 60_000, savedAt + 120_000]);
    expect(f.internals.sound.mock.calls.filter(([name]) => name === 'error')).toEqual([['error'], ['error']]);
    expect(f.internals.sound.mock.calls.filter(([name]) => name === 'save')).toHaveLength(kind === 'manual' ? 1 : 0);
  });

  it('cleared storage resets the streak without bypassing the minute floor', async () => {
    const f = failingUltra();
    await vi.advanceTimersByTimeAsync(150_000);
    vi.mocked(storageConditionVersion).mockReturnValue(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(f.attempts).toEqual([60_000, 120_000]);
    await vi.advanceTimersByTimeAsync(60_001);
    f.stop();
    expect(f.attempts).toEqual([60_000, 120_000, 180_000, 240_000]);
    expect(f.internals.sound.mock.calls).toEqual([['error'], ['error']]);
  });

  it('retains a storage-clear reset that happens while an autosave is in flight', async () => {
    const f = failingUltra();
    await vi.advanceTimersByTimeAsync(120_000);
    let fail!: (error: Error) => void;
    f.internals.opts.onSave.mockImplementationOnce(() => {
      f.attempts.push(performance.now());
      return new Promise<void>((_resolve, reject) => { fail = reject; });
    });
    await vi.advanceTimersByTimeAsync(120_000);
    vi.mocked(storageConditionVersion).mockReturnValue(1);
    await vi.advanceTimersByTimeAsync(1500);
    fail(new DOMException('quota', 'QuotaExceededError'));
    await f.internals.saving;
    await vi.advanceTimersByTimeAsync(60_000);
    f.stop();
    expect(f.attempts).toEqual([60_000, 120_000, 240_000, 301_500]);
    expect(f.internals.sound.mock.calls).toEqual([['error'], ['error']]);
  });

  it('a failed manual save keeps its feedback without changing the autosave streak', async () => {
    const f = failingUltra();
    await vi.advanceTimersByTimeAsync(150_000);
    await f.scene.save();
    expect(textOf(f.parent.querySelector('.save-pill.show')!)).toContain('Save failed');
    await vi.advanceTimersByTimeAsync(120_000);
    f.stop();
    expect(f.attempts).toEqual([60_000, 120_000, 150_000, 240_000]);
    expect(f.internals.sound.mock.calls).toEqual([['error'], ['error']]);
  });

  it('a partial city acknowledgement cannot reset a streak of failed region writes', async () => {
    const f = failingUltra();
    f.internals.opts.onSave.mockImplementation(async () => {
      f.attempts.push(performance.now());
      f.scene.recordSaved();
      throw new DOMException('region quota', 'QuotaExceededError');
    });
    await vi.advanceTimersByTimeAsync(480_000);
    f.stop();
    expect(f.attempts).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(f.internals.sound).toHaveBeenCalledExactlyOnceWith('error');
  });
});

describe('storage dialog keyboard handling', () => {
  function keys() {
    const scene = Object.assign(Object.create(CityScene.prototype) as { onKey(e: KeyboardEvent): void }, {
      disposed: false,
      host: { sim: { speed: 0 }, setSpeed: vi.fn() },
      tools: { key: vi.fn(() => false) },
      pause: { isOpen: false, open: vi.fn() },
      sound: vi.fn(), save: vi.fn(),
    });
    const press = (key: string, code: string, ctrlKey = false) => scene.onKey({
      key, code, ctrlKey, metaKey: false, altKey: false, repeat: false,
      target: new FEl('div'), preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);
    return { scene, press };
  }

  it.each([
    ['3', 'Digit3', false], [' ', 'Space', false], ['Escape', 'Escape', false], ['s', 'KeyS', true],
  ] as const)('keeps %s from reaching the city beneath a storage dialog', (key, code, ctrlKey) => {
    const f = keys();
    vi.mocked(storageDialogOpen).mockReturnValue(true);
    f.press(key, code, ctrlKey);
    expect(f.scene.host.setSpeed).not.toHaveBeenCalled();
    expect(f.scene.pause.open).not.toHaveBeenCalled();
    expect(f.scene.save).not.toHaveBeenCalled();
    expect(f.scene.tools.key).not.toHaveBeenCalled();
  });

  it('allows a speed key when storage dialogs are closed', () => {
    const f = keys();
    f.press('3', 'Digit3');
    expect(f.scene.host.setSpeed).toHaveBeenCalledExactlyOnceWith(3, 'keyboard');
  });
});

describe('SavePill', () => {
  for (const auto of [false, true]) it(`drops ${auto ? 'autosave' : 'manual save'} failure feedback after another tab takes ownership`, async () => {
    const f = fixture();
    now = 60_000;
    f.internals.opts.onSave.mockImplementationOnce(async () => {
      access.allowed = false;
      throw new DOMException('Region was taken over', 'NotAllowedError');
    });
    await f.scene.save(auto);
    expect(showStorageError).not.toHaveBeenCalled();
    expect(f.internals.sound).not.toHaveBeenCalled();
    expect(f.parent.querySelector('.save-pill.show')).toBeNull();
    expect(f.internals.saving).toBeNull();
  });

  it('never displays an autosave pill, including a failed autosave', () => {
    const f = fixture();
    f.internals.savePill.saving(true);
    f.internals.savePill.done(true, 'Autosaved');
    expect(f.parent.querySelector('.save-pill.show')).toBeNull();
    f.internals.savePill.saving(true);
    f.internals.savePill.done(false);
    expect(f.parent.querySelector('.save-pill.show')).toBeNull();
  });

  it('keeps the manual save pill', () => {
    const f = fixture();
    f.internals.savePill.saving(false);
    expect(textOf(f.parent.querySelector('.save-pill.show')!)).toContain('Saving…');
    f.internals.savePill.done(true, 'City saved');
    expect(textOf(f.parent.querySelector('.save-pill.show.done')!)).toContain('City saved');
  });
});

describe('the pause menu in a read-only region', () => {
  it('disables Save when another tab takes over, restores it on return, and still permits exit', () => {
    const parent = new FEl('div'), controller = new AbortController();
    const ctx = {
      state: { config: { name: 'City', startYear: 2000 }, day: 0, stats: { population: 0 } },
      host: { setSpeed: vi.fn(), resume: vi.fn() }, signal: controller.signal,
      sound: vi.fn(), save: vi.fn(), exitToRegion: vi.fn(),
    };
    const menu = new PauseMenu(ctx as unknown as GameContext, parent as unknown as HTMLElement, { onSettings() {}, onHelp() {} });
    menu.open();
    const save = parent.querySelectorAll('button').find((b) => textOf(b).includes('Save city'))!;
    const exit = parent.querySelectorAll('button').find((b) => textOf(b).includes('exit to region'))!;
    expect(save.disabled).toBe(false);
    access.allowed = false;
    access.listeners.forEach((update) => update());
    expect(save.disabled).toBe(true);
    expect(textOf(exit)).toBe('Exit to region');
    expect(exit.disabled).toBe(false);
    access.allowed = true;
    access.listeners.forEach((update) => update());
    expect(save.disabled).toBe(false);
    expect(textOf(exit)).toBe('Save & exit to region');
    menu.close(false, true);
    expect(access.listeners.size).toBe(0);
    controller.abort();
  });
});
