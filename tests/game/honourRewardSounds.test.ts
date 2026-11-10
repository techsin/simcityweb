/**
 * QA round 2 of T070, B4: an ordinary reward and an honour unlocking at one monthly check asked for the 'reward' voice
 * twice in the same instant, and AudioEngine's per-sound limiter (45 ms) dropped the second: the honour made no sound.
 * The fanfare now waits out the milestone cues' gap (180 ms) after the reward's chime, inside its own six-second budget.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { GameSounds } from '../../src/game/GameSounds';

const FANFARE = ['reward', { pitch: 1.12, volume: 0.9 }] as const;
const CHIME = ['reward', undefined] as const;

function make() {
  const events = new Emitter<Record<string, unknown>>();
  const sound = vi.fn();
  /** real ms at which each sound was asked for */
  const at: number[] = [];
  const sounds = new GameSounds({
    // (a month in the black: its budget tick is a sound the fanfare must keep out)
    sim: { events, state: { budget: { lastIncome: { taxes: 100 }, lastExpense: { police: 40 } } } } as never,
    sound: (name, opts) => { at.push(performance.now()); sound(name, opts); },
    world: () => ({ camera: null }) as never, sandbox: () => false,
  });
  /** the two events a monthly check sends for one unlock: its announcement, then 'unlocked' */
  const unlock = (id: string) => {
    events.emit('news', { day: 1, kind: 'reward', text: 'An announcement', ref: { reward: id } });
    events.emit('unlocked', id);
  };
  return { events, sound, sounds, unlock, at };
}

describe('QA round 2, B4: a reward and an honour at the same check', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('plays the chime at once and the fanfare 180 ms after it', () => {
    const t = make();
    const t0 = performance.now();
    t.unlock('lm_obelisk');
    t.unlock('honour_green_belt');
    expect(t.sound.mock.calls).toEqual([CHIME]);
    vi.advanceTimersByTime(179);
    expect(t.sound).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(t.sound.mock.calls).toEqual([CHIME, FANFARE]);
    // further apart than the audio engine's same-sound limit (45 ms), so both are heard
    expect(t.at.map((x) => x - t0)).toEqual([0, 180]);
    vi.advanceTimersByTime(10000);
    expect(t.sound).toHaveBeenCalledTimes(2);
    t.sounds.dispose();
  });

  it('waits only for what is left of the gap', () => {
    const t = make();
    t.unlock('statue');
    vi.advanceTimersByTime(100);
    const t1 = performance.now();
    t.unlock('honour_scholar_city');
    expect(t.sound).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(79);
    expect(t.sound).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(t.sound.mock.calls).toEqual([CHIME, FANFARE]);
    expect(t.at[1] - t1).toBe(80);
    t.sounds.dispose();
  });

  it('does not wait when the chime is further back than the gap, or was never played', () => {
    const t = make();
    t.unlock('honour_scholar_city');
    expect(t.sound.mock.calls).toEqual([FANFARE]);
    vi.advanceTimersByTime(6000);
    t.unlock('statue');
    vi.advanceTimersByTime(180);
    t.unlock('honour_safe_city');
    expect(t.sound.mock.calls).toEqual([FANFARE, CHIME, FANFARE]);
    t.sounds.dispose();
  });

  it('several rewards and several honours at one check: one chime, one fanfare', () => {
    const t = make();
    for (const id of ['lm_obelisk', 'museum', 'honour_green_belt', 'honour_scholar_city', 'honour_megacity']) t.unlock(id);
    vi.advanceTimersByTime(5000);
    expect(t.sound.mock.calls).toEqual([CHIME, FANFARE]);
    // the waiting fanfare had already taken the honours' six-second budget: counted from the request, not from the sound
    vi.advanceTimersByTime(999);
    t.unlock('honour_megalopolis');
    expect(t.sound).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    t.unlock('honour_quiet_city');
    expect(t.sound.mock.calls.at(-1)).toEqual(FANFARE);
    expect(t.sound).toHaveBeenCalledTimes(3);
    t.sounds.dispose();
  });

  it('the waiting fanfare keeps the month\'s other sounds out: a good-news chime of the same burst, the budget tick', () => {
    const t = make();
    t.events.emit('news', { day: 1, kind: 'good', text: 'A new garden opens downtown.' });
    t.unlock('lm_obelisk');
    t.unlock('honour_green_belt');
    t.events.emit('month', 1);
    vi.advanceTimersByTime(3000);
    expect(t.sound.mock.calls).toEqual([CHIME, FANFARE]);
    t.sounds.dispose();
  });

  it('a new city, or leaving the city, drops a fanfare that is still waiting', () => {
    const t = make();
    t.unlock('lm_obelisk');
    t.unlock('honour_green_belt');
    t.events.emit('reset', undefined);
    vi.advanceTimersByTime(1000);
    expect(t.sound.mock.calls).toEqual([CHIME]);
    // (the new city's first honour is not held back by the old one's budget; its chime is six seconds off)
    vi.advanceTimersByTime(5000);
    t.unlock('lm_clock_tower');
    t.unlock('honour_scholar_city');
    t.sounds.dispose();
    vi.runAllTimers();
    expect(t.sound.mock.calls).toEqual([CHIME, CHIME]);
  });
});
