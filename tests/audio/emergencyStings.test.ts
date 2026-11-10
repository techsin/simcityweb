import { afterEach, describe, expect, it, vi } from 'vitest';
import { oneShots } from '../../src/audio/oneShot';
import { playVoice, SOUND_META } from '../../src/audio/sfx';
import { audioSetup, type MockNode } from './mockAudio';

const outcomes = ['saved', 'lost'] as const;

function schedule(name: typeof outcomes[number], random: number) {
  vi.spyOn(Math, 'random').mockReturnValue(random);
  const env = audioSetup();
  playVoice(env, name, env.out);
  return env;
}

function graph(nodes: MockNode[]) {
  return nodes.map((node) => ({
    kind: node.kind, type: node.type, frequency: node.frequency.base, frequencies: node.frequency.events,
    gain: node.gain.base, envelope: node.gain.events, starts: node.starts, stops: node.stops,
  }));
}

describe('emergency outcome stings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('registers both outcomes as fixed-pitch 0.8-second event sounds', () => {
    for (const name of outcomes) {
      expect(SOUND_META[name]).toMatchObject({ cat: 'event', dur: 0.8, jitter: 0 });
    }
  });

  it.each(outcomes)('%s schedules the same tonal graph across random variations', (name) => {
    const first = schedule(name, 0.1);
    const second = schedule(name, 0.9);
    expect(graph(second.mock.nodes)).toEqual(graph(first.mock.nodes));
    const sources = first.mock.nodes.filter((node) => node.starts.length);
    expect(sources.every((node) => node.kind === 'oscillator')).toBe(true);
    const start = Math.min(...sources.map((node) => node.starts[0][0]));
    const end = Math.max(...sources.flatMap((node) => node.stops));
    expect(end - start).toBeGreaterThanOrEqual(0.78);
    expect(end - start).toBeLessThanOrEqual(0.82);
    expect(sources.every((node) => node.stops[0] > node.starts[0][0])).toBe(true);
  });

  it('separates a bright rising save from a low falling loss', () => {
    const pitches = (name: typeof outcomes[number]) => schedule(name, 0.5).mock.nodes
      .filter((node) => node.kind === 'oscillator' && node.type === 'triangle')
      .map((node) => node.frequency.valueAt(node.starts[0][0]));
    const saved = pitches('saved'), lost = pitches('lost');
    expect(saved[0]).toBeLessThan(saved[saved.length - 1]);
    expect(lost[0]).toBeGreaterThan(lost[lost.length - 1]);
    expect(Math.min(...saved)).toBeGreaterThan(Math.max(...lost) * 3);
    expect(Math.min(...lost)).toBeGreaterThan(100);
  });

  it.each(outcomes)('%s releases its complete graph and reuses processing nodes', (name) => {
    const env = schedule(name, 0.5);
    const { mock, ctx, out } = env;
    const first = mock.nodes.filter((node) => node.starts.length);
    const processing = () => mock.nodes.filter((node) => !node.starts.length).length;
    const warm = processing();
    mock.currentTime = 1.2;
    oneShots(ctx).collect();
    expect(mock.nodes.every((node) => node.connections.size === 0)).toBe(true);
    playVoice(env, name, out);
    expect(processing()).toBe(warm);
    expect(first.every((node) => node.connections.size === 0)).toBe(true);
    mock.currentTime = 2.5;
    oneShots(ctx).collect();
    expect(mock.nodes.every((node) => node.connections.size === 0)).toBe(true);
    expect(mock.nodes.every((node) => node.endedHandlers === 0)).toBe(true);
  });
});
