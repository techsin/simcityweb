import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { GameSounds } from '../../src/game/GameSounds';

function make() {
  const events = new Emitter<Record<string, unknown>>();
  const sound = vi.fn();
  const sounds = new GameSounds({
    sim: { events } as never,
    sound, world: () => ({ camera: null }) as never, sandbox: () => false,
  });
  const news = (id = 'honour_clean_air_metropolis', text = 'A translated announcement with no honour name') => {
    events.emit('news', { day: 1, kind: 'reward', text, ref: { reward: id } });
  };
  return { events, sound, sounds, news };
}

describe('honour fanfare', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it.each(['news-first', 'unlock-first'])('plays once for a metadata-keyed news and unlock pair (%s)', (order) => {
    const t = make();
    if (order === 'news-first') t.news();
    t.events.emit('unlocked', 'honour_clean_air_metropolis');
    if (order === 'unlock-first') t.news();
    expect(t.sound).toHaveBeenCalledExactlyOnceWith('reward', { pitch: 1.12, volume: 0.9 });
    t.sounds.dispose();
  });

  it('uses the reference and preserves the ordinary reward cue regardless of announcement wording', () => {
    const t = make();
    t.news('statue', 'Honour earned: Clean Air Metropolis!');
    expect(t.sound).toHaveBeenCalledExactlyOnceWith('reward', undefined);
    vi.advanceTimersByTime(6000);
    t.news();
    expect(t.sound).toHaveBeenLastCalledWith('reward', { pitch: 1.12, volume: 0.9 });
    t.sounds.dispose();
  });

  it('celebrates a burst of honours once and allows another fanfare after six real seconds', () => {
    const t = make();
    for (const id of ['honour_scholar_city', 'honour_safe_city', 'honour_green_belt']) {
      t.news(id);
      t.events.emit('unlocked', id);
    }
    expect(t.sound).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5999);
    t.news('honour_megacity');
    expect(t.sound).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    t.news('honour_megalopolis');
    expect(t.sound).toHaveBeenCalledTimes(2);
    t.sounds.dispose();
  });

  it('lets a fanfare consume the shared news budget so a queued good chime does not stack on it', () => {
    const t = make();
    t.events.emit('news', { day: 1, kind: 'good', text: 'A new garden opens downtown.' });
    t.news();
    vi.advanceTimersByTime(200);
    expect(t.sound).toHaveBeenCalledExactlyOnceWith('reward', { pitch: 1.12, volume: 0.9 });
    t.sounds.dispose();
  });

  it('allows a newly reset city to earn its first honour immediately', () => {
    const t = make();
    t.news();
    t.events.emit('reset', undefined);
    t.events.emit('unlocked', 'honour_scholar_city');
    expect(t.sound).toHaveBeenCalledTimes(2);
    t.sounds.dispose();
  });

  it('removes the news and unlock handlers on dispose', () => {
    const t = make();
    t.news();
    t.sounds.dispose();
    vi.advanceTimersByTime(6000);
    t.news('honour_megacity');
    t.events.emit('unlocked', 'honour_megalopolis');
    t.events.emit('reset', undefined);
    vi.runAllTimers();
    expect(t.sound).toHaveBeenCalledTimes(1);
  });
});
