import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { GameSounds, POP_MILESTONES } from '../../src/game/GameSounds';
import { populationMilestone } from '../../src/game/milestones';
import { AudioEngine } from '../../src/audio/AudioEngine';
import * as sfx from '../../src/audio/sfx';
import type { SoundOpts } from '../../src/game/context';

const MILESTONES = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 750000, 1000000, 1250000, 1500000];

function setup(play?: (name: string, opts?: SoundOpts) => void) {
  const events = new Emitter<Record<string, unknown>>();
  const sound = vi.fn(play);
  const sounds = new GameSounds({
    sim: { events } as never,
    sound,
    world: () => ({ camera: null }) as never,
    sandbox: () => false,
  });
  const milestone = (pop: number, city = 'Queensbury') => events.emit('news', { day: 1, kind: 'good', text: `${city} reaches ${pop.toLocaleString('en-US')} residents!` });
  return { events, sound, sounds, milestone };
}

describe('milestone sounds', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('includes every population milestone through 1.5 million residents', () => {
    expect(POP_MILESTONES).toEqual(MILESTONES);
  });

  it.each(MILESTONES)('plays milestone once when reaching %i residents', (pop) => {
    const t = setup();
    t.milestone(pop);
    vi.advanceTimersByTime(200);
    expect(t.sound).toHaveBeenCalledExactlyOnceWith('milestone', { pitch: expect.any(Number) });
    t.sounds.dispose();
  });

  it('celebrates each distinct milestone in a replay burst while suppressing duplicate news', () => {
    const t = setup();
    for (const pop of MILESTONES) {
      t.milestone(pop);
      t.milestone(pop);
    }
    vi.advanceTimersByTime(3000);
    expect(t.sound.mock.calls.map(([name]) => name)).toEqual(MILESTONES.map(() => 'milestone'));
    t.sounds.dispose();
  });

  it('spaces every cue in a packet through the real AudioEngine limiter', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    const accepted: number[] = [];
    vi.spyOn(sfx, 'playVoice').mockImplementation(() => { accepted.push(performance.now()); });
    const audio = new AudioEngine();
    // Only the voice renderer is replaced: AudioEngine.play runs its real 45 ms limiter.
    audio.ctx = { state: 'running' } as AudioContext;
    for (const _ of MILESTONES) audio.play('milestone');
    expect(accepted).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    accepted.length = 0;
    const t = setup((name, opts) => audio.play(name as sfx.SoundName, opts));
    for (const pop of MILESTONES) t.milestone(pop);
    expect(accepted).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(accepted).toHaveLength(MILESTONES.length);
    for (let i = 1; i < accepted.length; i++) expect(accepted[i] - accepted[i - 1]).toBeGreaterThan(45);
    t.sounds.dispose();
  });

  it('cancels queued cues on reset and lets the new city announce the cancelled milestone', () => {
    const t = setup();
    t.milestone(500);
    t.milestone(1000);
    t.events.emit('reset', undefined);
    vi.advanceTimersByTime(1000);
    expect(t.sound).toHaveBeenCalledTimes(1);
    t.milestone(1000);
    expect(t.sound).toHaveBeenCalledTimes(2);
    t.sounds.dispose();
  });

  it('cancels queued cues on dispose', () => {
    const t = setup();
    t.milestone(500);
    t.milestone(1000);
    t.sounds.dispose();
    vi.advanceTimersByTime(3000);
    t.milestone(2500);
    expect(t.sound).toHaveBeenCalledTimes(1);
  });

  it('parses the generated suffix when the city name resembles an announcement', () => {
    const t = setup();
    for (const pop of MILESTONES) {
      const text = `Reaches 500 residents reaches ${pop.toLocaleString('en-US')} residents!`;
      expect(populationMilestone(text)).toBe(pop);
      t.milestone(pop, 'Reaches 500 residents');
    }
    vi.advanceTimersByTime(3000);
    expect(t.sound.mock.calls.map(([name]) => name)).toEqual(MILESTONES.map(() => 'milestone'));
    expect(populationMilestone('Queensbury reaches 500 residents! More news.')).toBeNull();
    expect(populationMilestone('Queensbury reaches 501 residents!')).toBeNull();
    t.sounds.dispose();
  });

  it.each([[1000, 0], [10000, 0], [50000, 2], [100000, 2], [250000, 4], [500000, 4], [1000000, 4]])('preserves the pitch at %i residents', (pop, semitones) => {
    const t = setup();
    t.milestone(pop);
    expect(t.sound).toHaveBeenCalledExactlyOnceWith('milestone', { pitch: Math.pow(2, semitones / 12) });
    t.sounds.dispose();
  });

  it('keeps ordinary good news on the budgeted good chime', () => {
    const t = setup();
    t.events.emit('news', { day: 1, kind: 'good', text: 'A new park opens downtown.' });
    vi.advanceTimersByTime(200);
    expect(t.sound).toHaveBeenCalledExactlyOnceWith('good', undefined);
    t.sounds.dispose();
  });
});
