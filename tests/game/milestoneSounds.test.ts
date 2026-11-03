import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { GameSounds, POP_MILESTONES } from '../../src/game/GameSounds';

const MILESTONES = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 750000, 1000000, 1250000, 1500000];

function setup() {
  const events = new Emitter<Record<string, unknown>>();
  const sound = vi.fn();
  const sounds = new GameSounds({
    sim: { events } as never,
    sound,
    world: () => ({ camera: null }) as never,
    sandbox: () => false,
  });
  const milestone = (pop: number) => events.emit('news', { day: 1, kind: 'good', text: `Queensbury reaches ${pop.toLocaleString('en-US')} residents!` });
  return { events, sound, sounds, milestone };
}

describe('milestone sounds', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

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
    vi.advanceTimersByTime(200);
    expect(t.sound.mock.calls.map(([name]) => name)).toEqual(MILESTONES.map(() => 'milestone'));
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
