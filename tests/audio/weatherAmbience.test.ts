import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ambience } from '../../src/audio/ambience';
import type { SfxEnv } from '../../src/audio/sfx';
import { audioSetup, type MockNode } from './mockAudio';
import * as THREE from 'three';
import { Weather, weather } from '../../src/render/world/Weather';
import { newState } from '../infra/cityGen';

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
  it('follows the held visual rain at the scene sampling rate without calendar-speed pulses', () => {
    vi.useFakeTimers();
    const h = harness(), st = newState(64), visual = new Weather(new THREE.Scene(), THREE);
    const target = new THREE.Vector3(); st.config.seed = 7;
    let wet = 0, dry = 0;
    for (let day = 0; day < 360; day++) {
      if (weather(day, 7).kind === 'rain') wet = day;
      if (weather(day, 7).kind === 'clear') dry = day;
    }
    st.day = wet; visual.update(st, target, 0, 0, 'high');
    h.ambience.set({ rain: visual.rainAmount(), zoom: 0 });
    h.mock.currentTime = 12;
    const level = h.ambience.rainLevel, nodes = h.mock.nodes.length;
    for (let frame = 1; frame <= 19 * 60; frame++) {
      st.day = frame % 2 ? wet : dry;
      visual.update(st, target, 0, 1 / 60, 'high');
      h.mock.currentTime = 12 + frame / 60;
      if (frame % 30 === 0) h.ambience.set({ rain: visual.rainAmount() });
      expect(h.ambience.rainLevel).toBeGreaterThanOrEqual(level);
      expect(h.ambience.rainLevel).toBeCloseTo(visual.rainAmount() * 0.24, 5);
    }
    st.day = dry;
    let before = h.ambience.rainLevel;
    for (let frame = 1; frame <= 12 * 60; frame++) {
      visual.update(st, target, 0, 1 / 60, 'high');
      h.mock.currentTime = 31 + frame / 60;
      if (frame % 30 === 0) h.ambience.set({ rain: visual.rainAmount() });
      const next = h.ambience.rainLevel;
      expect(next).toBeLessThanOrEqual(before + 1e-8);
      expect(before - next).toBeLessThan(0.001);
      before = next;
    }
    expect(h.ambience.rainLevel).toBeLessThan(level * 0.1);
    expect(h.mock.nodes).toHaveLength(nodes);
    visual.dispose(); h.ambience.stop(); vi.runAllTimers();
  });

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
