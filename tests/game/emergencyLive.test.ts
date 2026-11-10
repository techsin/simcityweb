import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { Emitter } from '../../src/core/events';
import type { GameContext, UIEvents } from '../../src/game/context';
import { GameSounds } from '../../src/game/GameSounds';
import type { CityEvents } from '../../src/sim/Simulation';
import { EmergencyBanner } from '../../src/ui/EmergencyBanner';
import type { PolicySnapshot, SimHost } from '../../src/worker/SimHost';
import { MockContext } from '../audio/mockAudio';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();
const cleanups: (() => void)[] = [];

function fixture(options: { initialize?: boolean; duck?: boolean; live?: boolean; speed?: number; speedBeforeMirror?: boolean } = {}) {
  const mock = new MockContext(), epoch = Date.now();
  let audioOffset = 0;
  mock.sampleRate = 8000;
  Object.defineProperty(mock, 'currentTime', { get: () => (Date.now() - epoch + audioOffset) / 1000 });
  vi.stubGlobal('window', { AudioContext: function () { return mock; } });
  const audio = new AudioEngine();
  if (options.initialize !== false) expect(audio.init()).toBe(true);
  const abort = new AbortController(), events = new Emitter<CityEvents>(), ui = new Emitter<UIEvents>();
  const listeners = new Set<(policy: PolicySnapshot) => void>();
  const policy = {
    alerts: [], live: options.live ?? false,
    subscribe(listener: (policy: PolicySnapshot) => void, signal: AbortSignal) {
      listeners.add(listener);
      const off = () => { listeners.delete(listener); signal.removeEventListener('abort', off); };
      signal.addEventListener('abort', off, { once: true });
      return off;
    },
  };
  const host = {
    speed: options.speed ?? 1, events, policy,
    emergency: { incidents: () => [], incident: () => undefined },
    act: vi.fn(),
  };
  const seam = host as unknown as SimHost;
  const sound = vi.fn();
  const gameSounds = new GameSounds({
    sim: { events } as never, host: seam, signal: abort.signal, sound,
    duck: options.duck === false ? undefined : (db, hold, release) => audio.duck(db, hold, release, { renew: true }),
    releaseDuck: options.duck === false ? undefined : (release) => audio.releaseDuck(release),
    world: () => ({ camera: null }) as never, sandbox: () => true,
  });
  const root = new FEl('div');
  root.className = 'mp-ui';
  const ctx = {
    host: seam, signal: abort.signal, ui, root, sound, toast: vi.fn(),
    settings: { emergencyUncovered: 'live', emergencyAlerts: 'major', emergencyLiveSlowmo: 3 },
    panels: { open: vi.fn() },
  } as unknown as GameContext;
  const banner = new EmergencyBanner(ctx, root as unknown as HTMLElement);
  const live = (value: boolean) => {
    policy.live = value;
    for (const listener of [...listeners]) listener(policy);
  };
  const speed = (value: number) => {
    if (options.speedBeforeMirror) events.emit('speedChanged', value);
    host.speed = value;
    if (!options.speedBeforeMirror) events.emit('speedChanged', value);
  };
  const stall = (ms: number) => { audioOffset += ms; };
  const dispose = () => { abort.abort(); gameSounds.dispose(); banner.dispose(); audio.stopMusic(); };
  cleanups.push(dispose);
  return { audio, mock, abort, events, policy, listeners, root, live, speed, stall, dispose };
}

function reduction(audio: AudioEngine, baseline: number): number {
  const gain = audio.debugMusicBusGain;
  expect(gain).not.toBeNull();
  return 20 * Math.log10(gain! / baseline);
}

describe('emergency LIVE presentation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  });
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('holds the music 6 ± 1 dB lower throughout a long LIVE episode and releases in 0.5 seconds', () => {
    const f = fixture(), baseline = f.audio.debugMusicBusGain!;
    f.live(true);
    expect(f.root.classList.contains('emg-live')).toBe(true);
    vi.advanceTimersByTime(100);
    for (let i = 0; i < 400; i++) {
      const db = reduction(f.audio, baseline);
      expect(db).toBeGreaterThanOrEqual(-7);
      expect(db).toBeLessThanOrEqual(-5);
      vi.advanceTimersByTime(50);
    }
    f.live(false);
    expect(f.root.classList.contains('emg-live')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(499);
    expect(f.audio.debugMusicBusGain).toBeLessThan(baseline);
    vi.advanceTimersByTime(1);
    expect(f.audio.debugMusicBusGain).toBeCloseTo(baseline, 10);
  });

  it('matches the LIVE pill class during earlier pauses and resumes within an active policy episode', () => {
    const f = fixture({ live: true, speed: 0 }), baseline = f.audio.debugMusicBusGain!;
    expect(f.policy.live).toBe(true);
    expect(f.root.classList.contains('emg-live')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    f.speed(1);
    expect(f.root.classList.contains('emg-live')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-6, 1);
    f.speed(0);
    expect(f.policy.live).toBe(true);
    expect(f.root.classList.contains('emg-live')).toBe(false);
    vi.advanceTimersByTime(500);
    expect(f.audio.debugMusicBusGain).toBeCloseTo(baseline, 10);
    f.speed(2);
    expect(f.root.classList.contains('emg-live')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-6, 1);
    f.live(false);
    expect(f.root.classList.contains('emg-live')).toBe(false);
  });

  it('uses speedChanged before the worker speed mirror updates, without a policy or UI tick', () => {
    const f = fixture({ live: true, speed: 0, speedBeforeMirror: true }), baseline = f.audio.debugMusicBusGain!;
    const duck = vi.spyOn(f.audio, 'duck'), release = vi.spyOn(f.audio, 'releaseDuck');
    expect(f.root.classList.contains('emg-live')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    f.speed(1);
    expect(f.root.classList.contains('emg-live')).toBe(true);
    expect(duck).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(100);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-6, 6);
    f.speed(0);
    expect(f.root.classList.contains('emg-live')).toBe(false);
    expect(release).toHaveBeenCalledWith(0.5);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(500);
    expect(f.audio.debugMusicBusGain).toBeCloseTo(baseline, 10);
    const calls = duck.mock.calls.length;
    f.speed(3);
    expect(f.root.classList.contains('emg-live')).toBe(true);
    expect(duck).toHaveBeenCalledTimes(calls + 1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('holds the 6 dB duck through stalled callbacks and explicitly releases when LIVE ends', () => {
    const f = fixture(), baseline = f.audio.debugMusicBusGain!;
    const duck = vi.spyOn(f.audio, 'duck');
    f.live(true);
    vi.advanceTimersByTime(100);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-6, 6);
    const calls = duck.mock.calls.length;
    f.stall(140);
    expect(duck).toHaveBeenCalledTimes(calls);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-6, 6);
    f.stall(110);
    expect(duck).toHaveBeenCalledTimes(calls);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-6, 6);
    vi.advanceTimersByTime(100);
    expect(duck).toHaveBeenCalledTimes(calls + 1);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-6, 6);
    f.live(false);
    expect(f.root.classList.contains('emg-live')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(499);
    expect(f.audio.debugMusicBusGain).toBeLessThan(baseline);
    vi.advanceTimersByTime(1);
    expect(f.audio.debugMusicBusGain).toBeCloseTo(baseline, 10);
  });

  it('keeps one renewal loop across repeated transitions and removes listeners and timers on abort', () => {
    const f = fixture(), baseline = f.audio.debugMusicBusGain!;
    const duck = vi.spyOn(f.audio, 'duck');
    f.live(true); f.live(true); f.speed(3);
    expect(vi.getTimerCount()).toBe(1);
    expect(f.listeners.size).toBe(2);
    vi.advanceTimersByTime(200);
    f.live(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(250);
    f.live(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(200);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-6, 1);
    f.abort.abort();
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.root.classList.contains('emg-live')).toBe(false);
    const calls = duck.mock.calls.length;
    f.live(true); f.speed(1);
    vi.advanceTimersByTime(500);
    expect(duck).toHaveBeenCalledTimes(calls);
    expect(f.root.classList.contains('emg-live')).toBe(false);
    expect(f.audio.debugMusicBusGain).toBeCloseTo(baseline, 10);
  });

  it('preserves a stronger 14 dB duck after LIVE ends', () => {
    const f = fixture(), baseline = f.audio.debugMusicBusGain!;
    f.audio.duck(14, 5, 0.6);
    f.live(true);
    vi.advanceTimersByTime(1000);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-14, 6);
    f.live(false);
    vi.advanceTimersByTime(4000);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-14, 6);
    vi.advanceTimersByTime(660);
    expect(f.audio.debugMusicBusGain).toBeCloseTo(baseline, 10);
  });

  it('returns from a stronger short duck to 6 dB while LIVE continues', () => {
    const f = fixture(), baseline = f.audio.debugMusicBusGain!;
    f.audio.duck(14, 1, 0.6);
    f.live(true);
    vi.advanceTimersByTime(200);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-14, 6);
    vi.advanceTimersByTime(1800);
    expect(f.root.classList.contains('emg-live')).toBe(true);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-6, 1);
    vi.advanceTimersByTime(2000);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-6, 1);
    f.live(false);
    vi.advanceTimersByTime(500);
    expect(f.audio.debugMusicBusGain).toBeCloseTo(baseline, 10);
  });

  it('keeps the vignette working when audio is unavailable', () => {
    const f = fixture({ initialize: false, duck: false });
    expect(f.audio.debugMusicBusGain).toBeNull();
    f.live(true);
    expect(f.root.classList.contains('emg-live')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    f.speed(0);
    expect(f.root.classList.contains('emg-live')).toBe(false);
    f.speed(1);
    expect(f.root.classList.contains('emg-live')).toBe(true);
    f.live(false);
    expect(f.root.classList.contains('emg-live')).toBe(false);
  });

  it('starts ducking after audio initializes partway through LIVE', () => {
    const f = fixture({ initialize: false });
    f.live(true);
    vi.advanceTimersByTime(200);
    expect(f.audio.debugMusicBusGain).toBeNull();
    expect(f.audio.init()).toBe(true);
    const baseline = f.audio.debugMusicBusGain!;
    vi.advanceTimersByTime(200);
    expect(reduction(f.audio, baseline)).toBeCloseTo(-6, 1);
    f.live(false);
    vi.advanceTimersByTime(500);
    expect(f.audio.debugMusicBusGain).toBeCloseTo(baseline, 10);
  });

  it('shares the pill selector with a steady 3% red vignette and a half-second opacity release', () => {
    const css = readFileSync(new URL('../../src/ui/fx.css', import.meta.url), 'utf8');
    const before = /\.mp-ui::before\s*\{([^}]+)\}/.exec(css)?.[1] ?? '';
    const live = /\.mp-ui\.emg-live::before\s*\{([^}]+)\}/.exec(css)?.[1] ?? '';
    expect(before).toMatch(/rgb\(255 35 35 \/ 3%\)/);
    expect(before).toMatch(/pointer-events:\s*none/);
    expect(before).toMatch(/opacity:\s*0/);
    expect(before).toMatch(/transition:\s*opacity 0\.5s linear/);
    expect(live).toMatch(/opacity:\s*1/);
    expect(live).toMatch(/transition-duration:\s*0s/);
    expect(before + live).not.toMatch(/animation\s*:|@keyframes/);
    const pill = readFileSync(new URL('../../src/ui/emergency.css', import.meta.url), 'utf8');
    expect(pill).toMatch(/\.mp-ui\.emg-live \.hud-top \.live-pill\s*\{\s*display:\s*inline-block/);
    expect(pill).toMatch(/\.mp-ui\.emg-live \.hud-top \.is-paused \.live-pill\s*\{\s*display:\s*none/);
  });
});
