import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { AudioDucking } from '../../src/audio/ducking';
import { MockContext, MockParam } from './mockAudio';

const valueAt = (gain: AudioParam, t: number) => (gain as unknown as MockParam).valueAt(t);
const dbAt = (gain: AudioParam, t: number) => 20 * Math.log10(valueAt(gain, t));

describe('LIVE music duck hold and release', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function engine() {
    const ctx = new MockContext();
    ctx.sampleRate = 8000;
    vi.stubGlobal('window', { AudioContext: function () { return ctx; } });
    const audio = new AudioEngine();
    audio.init();
    const graph = audio as unknown as { ducking: AudioDucking };
    return { audio, ctx, ducking: graph.ducking };
  }

  it('holds exactly 6 dB through 140 ms renewal stalls and explicitly releases in 500 ms', () => {
    const { audio, ctx, ducking } = engine();
    const base = audio.debugMusicBusGain!;
    audio.duck(6, 0.3, 0.5, { renew: true });
    for (const time of [0.1, 0.24, 0.38, 0.52, 0.66]) {
      ctx.currentTime = time;
      expect(20 * Math.log10(audio.debugMusicBusGain! / base)).toBeCloseTo(-6, 6);
      audio.duck(6, 0.3, 0.5, { renew: true });
      expect(dbAt(ducking.reverb.gain, time)).toBeCloseTo(-6, 6);
      expect(valueAt(ducking.ambience.gain, time)).toBe(1);
    }
    audio.releaseDuck();
    expect(dbAt(ducking.music.gain, 0.66)).toBeCloseTo(-6, 6);
    expect(valueAt(ducking.music.gain, 0.91)).toBeCloseTo((1 + 10 ** (-6 / 20)) / 2);
    expect(valueAt(ducking.music.gain, 1.16)).toBeCloseTo(1);
    expect(valueAt(ducking.reverb.gain, 1.16)).toBeCloseTo(1);
  });

  it('lets a stronger transient expire while LIVE renewals keep their own 6 dB floor', () => {
    const { audio, ctx, ducking } = engine();
    audio.duck(6, 0.3, 0.5, { renew: true });
    ctx.currentTime = 0.1;
    audio.duck(14, 0.3, 0.6);
    for (let i = 2; i <= 14; i++) {
      ctx.currentTime = i / 10;
      audio.duck(6, 0.3, 0.5, { renew: true });
      if (i === 3) expect(dbAt(ducking.music.gain, ctx.currentTime)).toBeCloseTo(-14, 6);
      if (i >= 8) expect(dbAt(ducking.music.gain, ctx.currentTime)).toBeCloseTo(-6, 6);
    }
    expect(dbAt(ducking.reverb.gain, 1.4)).toBeCloseTo(-6, 6);
    audio.releaseDuck(0.5);
    expect(valueAt(ducking.music.gain, 1.9)).toBeCloseTo(1);
  });

  it('does not cut a stronger event short when LIVE explicitly releases', () => {
    const { audio, ctx, ducking } = engine();
    audio.duck(14, 4, 0.6);
    audio.duck(6, 0.3, 0.5, { renew: true });
    ctx.currentTime = 0.2;
    audio.releaseDuck(0.5);
    for (const gain of [ducking.music.gain, ducking.reverb.gain]) {
      expect(dbAt(gain, 0.7)).toBeCloseTo(-14, 6);
      expect(dbAt(gain, 4.06)).toBeCloseTo(-14, 6);
      expect(valueAt(gain, 4.66)).toBeCloseTo(1);
    }
  });

  it('schedules the exact quieter-envelope intersection during overlapping releases', () => {
    const ctx = new MockContext();
    const ducking = new AudioDucking(ctx.audio);
    ducking.duck(14, 0.2, 0.6);
    ducking.duck(6, 0.8, 0.5, { renew: true });
    const floor = 10 ** (-6 / 20);
    const deeper = 10 ** (-14 / 20);
    const cross = 0.26 + 0.6 * (floor - deeper) / (1 - deeper);
    for (const gain of [ducking.music.gain, ducking.reverb.gain]) {
      expect(valueAt(gain, cross - 0.01)).toBeCloseTo(deeper + (1 - deeper) * (cross - 0.01 - 0.26) / 0.6);
      expect(valueAt(gain, cross)).toBeCloseTo(floor);
      expect(valueAt(gain, cross + 0.01)).toBeCloseTo(floor);
    }
  });

  it('preserves an ordinary duck with an immediate release', () => {
    const ctx = new MockContext();
    const ducking = new AudioDucking(ctx.audio);
    ducking.duck(6, 0.2, 0);
    expect(dbAt(ducking.music.gain, 0.25)).toBeCloseTo(-6, 6);
    expect(valueAt(ducking.music.gain, 0.26)).toBe(1);
    expect(valueAt(ducking.reverb.gain, 0.3)).toBe(1);
  });
});
