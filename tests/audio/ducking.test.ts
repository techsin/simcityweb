import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDucking } from '../../src/audio/ducking';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { SOUND_META } from '../../src/audio/sfx';
import { MockContext, MockParam } from './mockAudio';

const valueAt = (gain: AudioParam, t: number) => (gain as unknown as MockParam).valueAt(t);
const dbAt = (gain: AudioParam, t: number) => 20 * Math.log10(valueAt(gain, t));

describe('music ducking', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('attacks in 60 ms, holds through a fanfare, and releases in 600 ms on both music paths', () => {
    const ctx = new MockContext();
    const d = new AudioDucking(ctx.audio);
    const duration = SOUND_META.milestone.dur;
    d.sound(duration);
    for (const gain of [d.music.gain, d.reverb.gain]) {
      expect(valueAt(gain, 0)).toBe(1);
      expect(dbAt(gain, 0.03)).toBeGreaterThan(-6);
      expect(dbAt(gain, 0.06)).toBeCloseTo(-6, 6);
      expect(dbAt(gain, duration)).toBeCloseTo(-6, 6);
      expect(valueAt(gain, duration + 0.36)).toBeCloseTo((1 + 10 ** (-6 / 20)) / 2);
      expect(valueAt(gain, duration + 0.66)).toBeCloseTo(1);
      expect(valueAt(gain, duration + 1)).toBe(1);
    }
    expect(dbAt(d.ambience.gain, 0.06)).toBeCloseTo(-3, 6);
    expect(valueAt(d.ambience.gain, duration + 0.66)).toBeCloseTo(1);
  });

  it('includes the 0.6 s boundary and allows at most one automatic duck per 2 s', () => {
    const ctx = new MockContext();
    const d = new AudioDucking(ctx.audio);
    d.sound(0.599);
    expect(valueAt(d.music.gain, 1)).toBe(1);
    d.sound(0.6);
    expect(dbAt(d.music.gain, 0.06)).toBeCloseTo(-6);
    ctx.currentTime = 1.999;
    d.sound(2);
    expect(valueAt(d.music.gain, 2)).toBe(1);
    ctx.currentTime = 2;
    d.sound(0.6);
    expect(dbAt(d.music.gain, 2.06)).toBeCloseTo(-6);
    expect(valueAt(d.music.gain, 3.26)).toBeCloseTo(1);
  });

  it('keeps a stronger explicit duck through weaker sounds and retargets without a gain jump', () => {
    const ctx = new MockContext();
    const d = new AudioDucking(ctx.audio);
    d.sound(1);
    ctx.currentTime = 0.03;
    const before = valueAt(d.music.gain, ctx.currentTime);
    d.duck(14, 10, 0.6);
    expect(valueAt(d.music.gain, ctx.currentTime)).toBeCloseTo(before);
    expect(dbAt(d.music.gain, 0.09)).toBeCloseTo(-14);
    ctx.currentTime = 2;
    d.sound(1.9);
    expect(dbAt(d.music.gain, 5)).toBeCloseTo(-14);
    expect(dbAt(d.music.gain, 10.09)).toBeCloseTo(-14);
    expect(valueAt(d.music.gain, 10.69)).toBeCloseTo(1);
    expect(valueAt(d.ambience.gain, 5)).toBe(1);
  });

  it('retargets during release continuously and ignores invalid envelopes', () => {
    const ctx = new MockContext();
    const d = new AudioDucking(ctx.audio);
    d.duck(6, 0.6, 0.6);
    ctx.currentTime = 0.96;
    const before = valueAt(d.music.gain, ctx.currentTime);
    d.duck(14, 2, 0.6);
    expect(valueAt(d.music.gain, ctx.currentTime)).toBeCloseTo(before);
    expect(dbAt(d.music.gain, 1.02)).toBeCloseTo(-14);
    for (const args of [[NaN, 1, 1], [Infinity, 1, 1], [6, -1, 1], [6, 1, -1]]) d.duck(...args as [number, number, number]);
    expect(dbAt(d.music.gain, 2)).toBeCloseTo(-14);
    expect(valueAt(d.music.gain, 3.62)).toBeCloseTo(1);
  });

  function engine() {
    const ctx = new MockContext();
    ctx.sampleRate = 8000;
    vi.stubGlobal('window', { AudioContext: function () { return ctx; } });
    const audio = new AudioEngine();
    audio.init();
    const graph = audio as unknown as { ducking: AudioDucking; buses: { music: GainNode }; musicReverb: GainNode };
    return { audio, ctx, ducking: graph.ducking, buses: graph.buses, musicReverb: graph.musicReverb };
  }

  it('ducks accepted play() calls, preserving the envelope through volume and mute changes', () => {
    const { audio, ducking, buses, musicReverb } = engine();
    audio.play('milestone', { exact: true });
    expect(dbAt(ducking.music.gain, 0.06)).toBeCloseTo(-6);
    audio.setVolume('music', 0.2);
    audio.setMuted(true);
    audio.setMuted(false);
    expect(audio.getVolume('music')).toBe(0.2);
    expect(valueAt(buses.music.gain, 1)).toBeCloseTo(0.2 ** 2 * 0.9);
    expect(valueAt(musicReverb.gain, 1)).toBeCloseTo(0.2 ** 2 * 0.9);
    expect(dbAt(ducking.music.gain, 1)).toBeCloseTo(-6);
    expect(valueAt(ducking.music.gain, 3)).toBe(1);
  });

  it('ignores inaudible, disabled and short sounds without consuming the duck cooldown', () => {
    const { audio, ctx, ducking } = engine();
    audio.play('click', { exact: true });
    audio.play('reward', { volume: 0 });
    audio.setVolume('sfx', 0);
    audio.play('found');
    audio.setVolume('sfx', 0.8);
    audio.setUiSounds(false);
    audio.play('dialogOpen');
    audio.setMuted(true);
    audio.play('milestone');
    audio.setMuted(false);
    expect(valueAt(ducking.music.gain, 0.1)).toBe(1);
    audio.play('milestone', { exact: true });
    expect(dbAt(ducking.music.gain, 0.06)).toBeCloseTo(-6);
    ctx.currentTime = 0.1;
    audio.duck(14, 8, 0.6);
    expect(dbAt(ducking.music.gain, 1)).toBeCloseTo(-14);
  });
});
