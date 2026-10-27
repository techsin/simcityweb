import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicDirector } from '../../src/audio/music/director';
import { song } from '../../src/audio/music/song';
import type { MusicTrack } from '../../src/audio/music/types';
import { afterAudioReveal } from '../../src/audio/loading';
import { audioSetup } from './mockAudio';
import { RNG } from '../../src/core/rng';

class Visibility extends EventTarget {
  hidden = false;
  show(hidden: boolean): void {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function setup(tracks?: MusicTrack[]) {
  const audio = audioSetup();
  Object.defineProperty(audio.mock, 'currentTime', { get: () => Date.now() / 1000 });
  const bars: number[] = [];
  const started = vi.fn();
  const track: MusicTrack = {
    id: 'test', title: 'Test', mood: 'Test', tags: ['menu'], bpm: 60,
    create: (env) => song(env, {
      bpm: 60, sections: [{ name: 'A', bars: 4 }], tail: 8,
      setup: started, bar: (b) => bars.push(b.bar),
    }),
  };
  const director = new MusicDirector(tracks ?? [track], { load: () => ({ shuffle: false, disabled: [] }), save: () => {} });
  director.attach(audio.ctx, audio.out, audio.wet, audio.noise);
  return { ...audio, director, bars, started, track };
}

describe('music deadlines', () => {
  let doc: Visibility;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    doc = new Visibility();
    vi.stubGlobal('document', doc);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('wakes for the next bar, then only for the known crossfade during the tail', () => {
    const { director, bars, started } = setup();
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const interval = vi.spyOn(globalThis, 'setInterval');
    director.start();
    expect(bars).toEqual([0]);
    expect(vi.getTimerCount()).toBe(1);
    expect(timeout).toHaveBeenLastCalledWith(expect.any(Function), 2581);
    vi.advanceTimersByTime(2500);
    expect(bars).toEqual([0]);
    expect(timeout).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(81);
    expect(bars).toEqual([0, 1]);
    vi.advanceTimersByTime(8000);
    expect(bars).toEqual([0, 1, 2, 3]);
    expect(timeout).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(6000);
    expect(started).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(1000);
    expect(started).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    expect(interval).not.toHaveBeenCalled();
  });

  it('has no timer before attach, with no tracks, or after stop, and resumes on demand', () => {
    const before = new MusicDirector([], { load: () => ({ shuffle: false, disabled: [] }), save: () => {} });
    before.start();
    expect(vi.getTimerCount()).toBe(0);
    const empty = setup([]);
    empty.director.start();
    expect(vi.getTimerCount()).toBe(0);
    const { director, started } = setup();
    director.start();
    director.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(30000);
    expect(started).toHaveBeenCalledTimes(1);
    director.start();
    expect(started).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('cancels timers when suspended or hidden and restarts from lifecycle events without bursting missed bars', () => {
    const { director, mock, bars } = setup();
    director.start();
    mock.setState('suspended');
    expect(vi.getTimerCount()).toBe(0);
    mock.setState('running');
    expect(vi.getTimerCount()).toBe(1);
    doc.show(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(12000);
    expect(bars).toEqual([0]);
    doc.show(false);
    expect(bars).toEqual([0, 2, 3]);
    expect(vi.getTimerCount()).toBe(1);
    director.stop();
    doc.show(true);
    doc.show(false);
    mock.setState('suspended');
    mock.setState('running');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps an initially hidden director asleep and queues manual selections until visible', () => {
    doc.show(true);
    const { director, started } = setup();
    director.start();
    director.select('test');
    expect(started).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    doc.show(false);
    expect(started).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    director.select('test');
    expect(started).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not retry failed tracks forever', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const create = vi.fn(() => { throw new Error('broken'); });
    const { director, mock } = setup([{ id: 'bad', title: 'Bad', mood: '', tags: [], bpm: 60, create }]);
    director.start();
    vi.advanceTimersByTime(60000);
    expect(create).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(mock.nodes.every((n) => n.connections.size === 0)).toBe(true);
  });

  it('releases stopped plays on one audio-clock completion without a paused timer', () => {
    const { director, mock, out } = setup();
    director.start();
    director.stop();
    expect(vi.getTimerCount()).toBe(0);
    const completion = mock.nodes.find((n) => n.kind === 'constant')!;
    expect(completion.offset.value).toBe(0);
    expect(completion.endedHandlers).toBe(1);
    vi.advanceTimersByTime(3000);
    completion.dispatchEvent(new Event('ended'));
    expect(mock.nodes.some((n) => n.connections.has(out as never))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for both veil removals and cancels a superseded reveal without a polling timer', () => {
    let change: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('MutationObserver', class {
      constructor(cb: () => void) { change = cb; }
      observe(): void {}
      disconnect = disconnect;
    });
    let overlays = 2;
    const root = { querySelectorAll: () => Array.from({ length: overlays }, () => ({ matches: () => false })) } as unknown as ParentNode;
    const { director, started } = setup();
    director.defer(true);
    director.start();
    afterAudioReveal(root, () => director.defer(false));
    expect(vi.getTimerCount()).toBe(0);
    expect(started).not.toHaveBeenCalled();
    overlays--;
    change();
    expect(started).not.toHaveBeenCalled();
    overlays--;
    change();
    expect(started).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    const ready = vi.fn();
    overlays = 1;
    const cancel = afterAudioReveal(root, ready);
    cancel();
    overlays = 0;
    change();
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(ready).not.toHaveBeenCalled();
  });

  it('waits for a mounted error veil to finish fading and handles a fade with no animation', async () => {
    vi.stubGlobal('MutationObserver', class {
      observe(): void {}
      disconnect(): void {}
    });
    let finish: () => void = () => {};
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const veil = { matches: () => true, getAnimations: () => [{ finished }] };
    const root = { querySelectorAll: () => [veil] } as unknown as ParentNode;
    const ready = vi.fn();
    afterAudioReveal(root, ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    finish();
    await finished;
    await Promise.resolve();
    expect(ready).toHaveBeenCalledTimes(1);
    veil.getAnimations = () => [];
    afterAudioReveal(root, ready);
    await Promise.resolve();
    expect(ready).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([15, 40])('schedules an exact %s s city rest, with one deadline while silent', (rest) => {
    vi.spyOn(RNG.prototype, 'range').mockReturnValue(rest);
    const { director, started } = setup();
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    director.setContext({ screen: 'city' });
    director.start();
    vi.advanceTimersByTime(25000);
    expect(director.nowPlaying).toBeNull();
    expect(started).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    const calls = timeout.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(timeout).toHaveBeenCalledTimes(calls);
    vi.advanceTimersByTime(180000);
    const plays = started.mock.calls.map(([at, p]) => ({ at: at as number, end: p.endTime as number }));
    expect(plays.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < plays.length; i++) expect(plays[i].at - plays[i - 1].end).toBeCloseTo(rest, 6);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('draws city rest lengths in [15, 40] seconds', () => {
    const { director, started } = setup();
    director.setContext({ screen: 'city' });
    director.start();
    vi.advanceTimersByTime(300000);
    const plays = started.mock.calls.map(([at, p]) => ({ at: at as number, end: p.endTime as number }));
    expect(plays.length).toBeGreaterThan(4);
    const gaps = plays.slice(1).map((p, i) => p.at - plays[i].end);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(15);
      expect(gap).toBeLessThanOrEqual(40);
    }
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it('discards a failed song\'s pending rest when starting its replacement', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(RNG.prototype, 'range').mockReturnValue(15);
    const replacement = vi.fn();
    const tracks = ['bad', 'good'].map((id): MusicTrack => ({
      id, title: id, mood: '', tags: [], bpm: 60,
      create: (env) => song(env, {
        bpm: 60, sections: [{ name: 'A', bars: id === 'bad' ? 4 : 8 }], tail: id === 'bad' ? 0 : 8,
        setup: id === 'good' ? replacement : undefined,
        bar: (b) => { if (id === 'bad' && b.bar === 3) throw new Error('last bar failed'); },
      }),
    }));
    const { director } = setup(tracks);
    director.setContext({ screen: 'city' });
    director.start();
    vi.advanceTimersByTime(35000);
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(director.nowPlaying?.id).toBe('good');
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(['menu', 'region', 'city'] as const)('keeps continuous crossfades in %s with pauses off', (screen) => {
    const { director, started } = setup();
    director.setContext({ screen });
    if (screen === 'city') director.setMusicPauses(false);
    director.start();
    vi.advanceTimersByTime(90000);
    const plays = started.mock.calls.map(([at, p]) => ({ at: at as number, end: p.endTime as number }));
    expect(plays.length).toBeGreaterThan(3);
    for (let i = 1; i < plays.length; i++) expect(plays[i].at - plays[i - 1].end).toBeCloseTo(-5);
  });

  it.each(['next', 'prev', 'select', 'menu', 'setting', 'restart'])('%s cancels a pending city rest', (action) => {
    const { director, started } = setup();
    director.setContext({ screen: 'city' });
    director.start();
    vi.advanceTimersByTime(25000);
    expect(started).toHaveBeenCalledTimes(1);
    if (action === 'next') director.next();
    else if (action === 'prev') director.prev();
    else if (action === 'select') director.select('test');
    else if (action === 'menu') director.setContext({ screen: 'menu' });
    else if (action === 'setting') director.setMusicPauses(false);
    else { director.stop(); director.start(); }
    expect(started).toHaveBeenCalledTimes(2);
    expect(started.mock.calls[1][0]).toBeLessThan(25.1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('keeps scheduling while hidden when background mute is off', () => {
    const { director, bars, started } = setup();
    director.setMuteInBackground(false);
    doc.show(true);
    director.start();
    vi.advanceTimersByTime(12000);
    expect(bars).toEqual([0, 1, 2, 3]);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(10000);
    expect(started).toHaveBeenCalledTimes(2);
    director.setMuteInBackground(true);
    expect(vi.getTimerCount()).toBe(0);
    director.setMuteInBackground(false);
    expect(vi.getTimerCount()).toBe(1);
  });
});
