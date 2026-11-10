/** FEEL-27 / NOTE-065: execute the App's shipped entry tails without booting main.ts or a browser. */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (this: object, ...args: unknown[]) => Promise<void>;
function tail(start: string): string {
  const at = main.indexOf(start);
  if (at < 0) throw new Error(`App entry tail not found: ${start}`);
  return main.slice(at, main.indexOf('\n  }\n', at));
}
// Like graphicsRestore's frame test, run the actual method body. App is private and main auto-boots on import.
const cityEntry = new AsyncFunction('ld', 't0', 'audio', 'container', 'markReady', 'worker', tail('    const c = this.city, scene = c?.scene;\n    await ld.hide();'));
const regionEntry = new AsyncFunction('ld', 'audio', 'signalReady', 'markReady', tail('    await this.regionScreen.ready;'));

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const landing = deferred(), abort = new AbortController();
  const scene = {
    cameraLanded: landing.promise,
    ctx: { signal: abort.signal },
    reportLoadTime: vi.fn(),
    dispose: () => { abort.abort('dispose'); landing.resolve(); },
  };
  const city = { scene: scene as Partial<typeof scene> | null, entered: false };
  const app = { city: city as typeof city | null, lastLoadMs: null as number | null, onWorkerCrash: vi.fn() };
  const audio = { play: vi.fn() }, container = { isConnected: true }, markReady = vi.fn();
  const hide = vi.fn(() => Promise.resolve());
  const enter = () => cityEntry.call(app, { hide }, performance.now(), audio, container, markReady, undefined);
  return { app, city, scene, landing, abort, audio, container, markReady, hide, enter };
}

describe('city ready chime at camera landing (NOTE-065 request 1)', () => {
  it('waits for landing without delaying readiness or the entered flag', async () => {
    const t = fixture();
    await t.enter();
    expect(t.audio.play).not.toHaveBeenCalled();
    expect(t.markReady).toHaveBeenCalledOnce();
    expect(t.city.entered).toBe(true);
    expect(t.scene.reportLoadTime).toHaveBeenCalledOnce();
    t.landing.resolve();
    await t.landing.promise;
    expect(t.audio.play).toHaveBeenCalledExactlyOnceWith('cityReady');
  });

  it('plays immediately after loading for an older scene without cameraLanded or ctx', async () => {
    const t = fixture();
    t.city.scene = { reportLoadTime: vi.fn() };
    t.markReady.mockImplementation(() => { expect(t.audio.play).toHaveBeenCalledExactlyOnceWith('cityReady'); });
    await t.enter();
    expect(t.hide).toHaveBeenCalledOnce();
    expect(t.markReady).toHaveBeenCalledOnce();
  });

  it('keeps the immediate fallback for the scene-less city placeholder', async () => {
    const t = fixture();
    t.city.scene = null;
    await t.enter();
    expect(t.audio.play).toHaveBeenCalledExactlyOnceWith('cityReady');
    expect(t.city.entered).toBe(true);
  });

  it.each(['city', 'scene', 'exit', 'dispose', 'detach'] as const)('%s before landing suppresses the old chime', async (change) => {
    const t = fixture();
    await t.enter();
    if (change === 'city') t.app.city = { scene: { reportLoadTime: vi.fn() }, entered: true };
    else if (change === 'scene') t.city.scene = { reportLoadTime: vi.fn() };
    else if (change === 'exit') t.app.city = null;
    else if (change === 'dispose') t.scene.dispose();
    else t.container.isConnected = false;
    t.landing.resolve();
    await t.landing.promise;
    expect(t.audio.play).not.toHaveBeenCalled();
  });

  it('captures the original scene before the loading screen hides', async () => {
    const t = fixture(), hiding = deferred();
    t.hide.mockImplementation(() => hiding.promise);
    const entering = t.enter();
    t.app.city = { scene: { reportLoadTime: vi.fn() }, entered: false };
    hiding.resolve();
    await entering;
    t.landing.resolve();
    await t.landing.promise;
    expect(t.audio.play).not.toHaveBeenCalled();
  });

  it('handles a failed landing without a chime or an unhandled rejection', async () => {
    const t = fixture();
    await t.enter();
    t.landing.reject(new Error('Opening cancelled'));
    await expect(t.landing.promise).rejects.toThrow('Opening cancelled');
    expect(t.audio.play).not.toHaveBeenCalled();
    expect(t.markReady).toHaveBeenCalledOnce();
  });
});

describe('region entry remains independent of the city camera', () => {
  it.each([true, false])('keeps the region chime conditional on a loading screen (%s)', async (loading) => {
    const ready = deferred(), audio = { play: vi.fn() }, hide = vi.fn(() => Promise.resolve()), markReady = vi.fn();
    const app = { regionScreen: { ready: ready.promise }, useWorker: () => false, prespawnWorker: vi.fn() };
    const entering = regionEntry.call(app, loading ? { hide } : undefined, audio, true, markReady);
    expect(audio.play).not.toHaveBeenCalled();
    ready.resolve();
    await entering;
    expect(hide).toHaveBeenCalledTimes(loading ? 1 : 0);
    if (loading) expect(audio.play).toHaveBeenCalledExactlyOnceWith('regionEnter');
    else expect(audio.play).not.toHaveBeenCalled();
    expect(markReady).toHaveBeenCalledOnce();
  });
});
