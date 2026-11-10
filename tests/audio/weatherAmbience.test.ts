import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ambience } from '../../src/audio/ambience';
import type { SfxEnv } from '../../src/audio/sfx';
import { audioSetup, type MockNode } from './mockAudio';

function harness() {
  const h = audioSetup();
  const ambience = new Ambience(h as unknown as SfxEnv, h.out, { live: false, random: () => 0.5 });
  vi.spyOn(ambience as unknown as { loopNoise: () => AudioBufferSourceNode }, 'loopNoise')
    .mockImplementation(() => h.mock.createBufferSource() as unknown as AudioBufferSourceNode);
  ambience.start();
  return { ...h, ambience };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('FEEL-23 rain ambience', () => {
  it('crossfades the rain bed, clamps intensity and scales with camera distance', () => {
    vi.useFakeTimers();
    const h = harness();
    expect(h.ambience.rainLevel).toBe(0);
    h.ambience.set({ rain: 1, zoom: 0 });
    h.mock.currentTime = 0.1;
    expect(h.ambience.rainLevel).toBeGreaterThan(0);
    expect(h.ambience.rainLevel).toBeLessThan(0.24);
    h.mock.currentTime = 12;
    expect(h.ambience.rainLevel).toBeCloseTo(0.24, 7);
    h.ambience.set({ rain: 2, zoom: 1 });
    h.mock.currentTime = 24;
    expect(h.ambience.rainLevel).toBeCloseTo(0.12, 7);
    h.ambience.set({ rain: -1 });
    h.mock.currentTime = 36;
    expect(h.ambience.rainLevel).toBeCloseTo(0, 7);
    h.ambience.stop(); vi.runAllTimers();
  });

  it('reuses the rain source/filter/gain and parameter input throughout repeated weather changes', () => {
    vi.useFakeTimers();
    const h = harness(), count = h.mock.nodes.length;
    const sources = h.mock.nodes.filter((n) => n.kind === 'buffer');
    expect(sources).toHaveLength(5); // city, hum, wind, surf, rain
    const params = { rain: 0, zoom: 0.5 };
    for (let i = 0; i < 300; i++) {
      h.mock.currentTime = i * 0.5;
      params.rain = i % 3 === 0 ? 1 : 0;
      h.ambience.set(params);
    }
    expect(h.mock.nodes.length).toBe(count);
    expect(h.mock.nodes.filter((n) => n.kind === 'buffer')).toEqual(sources);
    expect(params).toEqual({ rain: 0, zoom: 0.5 });
    h.ambience.stop(); vi.runAllTimers();
  });

  it('stops the persistent rain source and disconnects its processing chain with the rest of ambience', () => {
    vi.useFakeTimers();
    const h = harness();
    h.ambience.set({ rain: 1 });
    const sources = (h.ambience as unknown as { sources: MockNode[] }).sources.slice();
    const nodes = (h.ambience as unknown as { nodes: MockNode[] }).nodes.slice();
    const rain = sources[sources.length - 1];
    expect(rain.kind).toBe('buffer');
    h.ambience.stop();
    expect(h.ambience.running).toBe(false);
    expect(rain.stops).toEqual([1.1]);
    expect(sources.every((s) => s.stops.length === 1)).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(nodes.every((n) => n.connections.size === 0)).toBe(true);
    const count = h.mock.nodes.length;
    h.ambience.tick();
    expect(h.mock.nodes.length).toBe(count);
  });
});
