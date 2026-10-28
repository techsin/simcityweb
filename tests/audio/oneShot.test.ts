import { afterEach, describe, expect, it, vi } from 'vitest';
import { OneShotPool, oneShots } from '../../src/audio/oneShot';
import { playVoice, SOUND_META, soundTrim, type SoundName } from '../../src/audio/sfx';
import { Instruments } from '../../src/audio/music/synth';
import { audioSetup, MockNode, MockParam } from './mockAudio';
import { NOTE_COST, SFX_COST, type Count } from './nodeCosts';
import { FireworksAudio, spatialize } from '../../src/audio/fireworks';

function countWithin(actual: number, expected: Count, name: string): void {
  const [lo, hi] = typeof expected === 'number' ? [expected, expected] : expected;
  expect(actual, name).toBeGreaterThanOrEqual(lo);
  expect(actual, name).toBeLessThanOrEqual(hi);
}

describe('one-shot processing nodes', () => {
  afterEach(() => vi.restoreAllMocks());
  it('reuses gains, filters and panners with fresh automation and routing', () => {
    const { mock, ctx, out, wet } = audioSetup();
    const pool = new OneShotPool(ctx);
    const a = pool.begin();
    const gain = a.gain(), filter = a.filter(), pan = a.panner();
    gain.gain.setValueAtTime(0.4, 0);
    gain.gain.linearRampToValueAtTime(0, 1);
    gain.gain.setValueAtTime(0.9, 200);
    filter.frequency.value = 900;
    filter.detune.value = 80;
    filter.gain.value = 3;
    filter.Q.value = 4;
    filter.type = 'highpass';
    filter.frequency.automationRate = 'k-rate';
    pan.pan.value = -0.7;
    const source = ctx.createBufferSource();
    source.connect(filter).connect(gain).connect(pan).connect(out);
    source.start(0);
    source.stop(1);
    a.source(source, 1);
    a.finish();
    mock.currentTime = 2;
    const b = pool.begin();
    expect(b.gain()).toBe(gain);
    expect(b.filter()).toBe(filter);
    expect(b.panner()).toBe(pan);
    expect((gain.gain as unknown as MockParam).events).toEqual([]);
    expect([gain.gain.value, filter.frequency.value, filter.detune.value, filter.gain.value, filter.Q.value, pan.pan.value]).toEqual([1, 350, 0, 0, 1, 0]);
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.automationRate).toBe('a-rate');
    expect((source as unknown as MockNode).connections.size).toBe(0);
    gain.gain.value = 0.8;
    gain.connect(wet);
    expect((gain as unknown as MockNode).connections).toEqual(new Set([wet]));
    expect((pan as unknown as MockNode).connections.size).toBe(0);
    b.finish();
    pool.dispose();
  });

  it('never steals an overlapping or suspended voice, and detaches shared modulation on release', () => {
    const { mock, ctx } = audioSetup();
    const pool = new OneShotPool(ctx);
    const a = pool.begin();
    const gain = a.gain();
    const src = ctx.createOscillator(), lfo = ctx.createOscillator();
    src.connect(gain);
    lfo.connect(gain.gain);
    a.input(lfo, gain.gain);
    a.source(src, 10);
    a.finish();
    mock.setState('suspended');
    const b = pool.begin();
    expect(b.gain()).not.toBe(gain);
    b.finish();
    mock.setState('running');
    mock.currentTime = 10.1;
    pool.collect();
    expect((lfo as unknown as MockNode).connections.size).toBe(1);
    mock.currentTime = 11;
    pool.collect();
    expect((lfo as unknown as MockNode).connections.size).toBe(0);
    pool.dispose();
    expect(mock.nodes.every((n) => n.connections.size === 0)).toBe(true);
  });

  it('keeps buffers, start/stop times, trim, dry pan and wet routing on SFX reuse', () => {
    const { mock, ctx, out, wet, noise } = audioSetup();
    const env = { ctx, out, wet, noise };
    const passive = () => mock.nodes.filter((n) => ['gain', 'filter', 'panner'].includes(n.kind));
    const begin = mock.nodes.length;
    playVoice(env, 'click', out, { exact: true, pan: -0.5, volume: 0.25 });
    const first = mock.nodes.slice(begin);
    const count = passive().length;
    const sources = first.filter((n) => n.starts.length);
    expect(sources.map((n) => n.kind)).toEqual(['oscillator', 'buffer']);
    expect(sources[1].buffer).toBe(noise);
    expect(sources[1].loop).toBe(true);
    mock.currentTime = 2;
    playVoice(env, 'click', wet, { exact: true, pan: 0.75, volume: 1.5 });
    expect(passive()).toHaveLength(count);
    const next = mock.nodes.filter((n) => n.starts.length).slice(2);
    for (let i = 0; i < sources.length; i++) {
      expect(next[i].starts[0][0] - 2).toBeCloseTo(sources[i].starts[0][0]);
      expect(next[i].starts[0].slice(1)).toEqual(sources[i].starts[0].slice(1));
      expect(next[i].stops[0] - 2).toBeCloseTo(sources[i].stops[0]);
      expect(sources[i].connections.size).toBe(0);
    }
    const pan = first.find((n) => n.kind === 'panner')!;
    expect(pan.pan.value).toBe(0.75);
    expect(pan.connections).toEqual(new Set([wet]));
    const trimmed = passive().filter((n) => n.gain.value === soundTrim('click') * 1.5);
    expect(trimmed).toHaveLength(2);
    expect(trimmed.some((n) => n.connections.has(pan))).toBe(true);
    expect(trimmed.some((n) => n.connections.has(wet as unknown as MockNode))).toBe(true);
    expect(mock.nodes.every((n) => n.endedHandlers === 0)).toBe(true);
  });

  it('bounds processing-node allocations for every SFX without retaining old source connections', () => {
    for (const name of Object.keys(SOUND_META) as SoundName[]) {
      const { mock, ctx, out, wet, noise } = audioSetup();
      const count = () => mock.nodes.filter((n) => !['oscillator', 'buffer'].includes(n.kind)).length;
      playVoice({ ctx, out, wet, noise }, name, out, { exact: true, pan: 0.5 });
      const warm = count();
      countWithin(mock.nodes.filter((n) => n.starts.length).length, SFX_COST[name][0], name);
      countWithin(warm - 3, SFX_COST[name][1], name); // exclude test outputs and the optional panner
      for (let i = 1; i <= 12; i++) {
        mock.currentTime = i * 60;
        playVoice({ ctx, out, wet, noise }, name, out, { exact: true, pan: 0.5 });
      }
      expect(count(), name).toBe(warm);
      mock.currentTime += 60;
      oneShots(ctx).collect();
      expect(mock.nodes.every((n) => n.connections.size === 0), name).toBe(true);
      expect(mock.nodes.every((n) => n.endedHandlers === 0), name).toBe(true);
    }
  });

  it('matches the audited per-note costs and reuses every library instrument graph', () => {
    const drums = new Set(['kick', 'snare', 'rim', 'clap', 'hat', 'shaker', 'brush', 'tom', 'triangle', 'ride', 'cymbal', 'conga']);
    for (const name of Object.keys(NOTE_COST) as (keyof typeof NOTE_COST)[]) {
      const { mock, ctx, out, wet, noise } = audioSetup();
      const inst = new Instruments(ctx, out, wet, noise, { bpm: 90, live: true, seed: 3 });
      const play = (t: number) => {
        const args = name === 'vinyl' ? [t, t + 4, 0.5] : drums.has(name) ? [t, 0.7]
          : name === 'brushSwirl' || name === 'sweep' ? [t, 0.5, 0.7] : [t, 60, 0.5, 0.7];
        (inst[name] as (...args: number[]) => void)(...args);
      };
      play(0.1); // create channels, shared filters and LFOs
      const warm = mock.nodes.length;
      play(0.2); // overlap: count the complete per-note graph before any nodes can be reused
      const nodes = mock.nodes.slice(warm);
      const sources = nodes.filter((n) => n.starts.length);
      expect(sources.length, name).toBe(NOTE_COST[name][0]);
      expect(nodes.length - sources.length, name).toBe(NOTE_COST[name][1]);
      const passive = mock.nodes.filter((n) => !n.starts.length).length;
      mock.currentTime = 10;
      play(10.1);
      expect(mock.nodes.filter((n) => !n.starts.length).length, name).toBe(passive);
      expect(mock.nodes.every((n) => n.endedHandlers === 0), name).toBe(true);
      inst.dispose();
    }
  });

  it('pools fireworks routing and finishes without wall-clock cleanup timers', () => {
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const { mock, ctx, out, noise } = audioSetup();
    const fireworks = new FireworksAudio(() => ({ ctx, dest: out, noise }));
    const sp = spatialize({ x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0 }, 500, 100, 200);
    fireworks.launch(sp, true, 2, true);
    const passive = mock.nodes.filter((n) => !n.starts.length).length;
    mock.currentTime = 20;
    sp.pan = -0.5;
    sp.lowpass = 900;
    fireworks.launch(sp, true, 2, true);
    expect(mock.nodes.filter((n) => !n.starts.length).length).toBe(passive);
    expect(mock.nodes.find((n) => n.kind === 'panner')!.pan.value).toBe(-0.5);
    fireworks.dispose();
    expect(timer).not.toHaveBeenCalled();
    expect(mock.nodes.filter((n) => n.starts.length).every((n) => n.connections.size === 0)).toBe(true);
  });

  it('reuses music note graphs while keeping channels alive and removing shared LFO connections', () => {
    const { mock, ctx, out, wet, noise } = audioSetup();
    const inst = new Instruments(ctx, out, wet, noise, { bpm: 90, live: true, seed: 3 });
    inst.pad(0.1, [60, 64, 67], 1, 0.7, { pan: -0.3 });
    const sources = mock.nodes.filter((n) => n.kind === 'oscillator' && n.stops.length);
    const passive = () => mock.nodes.filter((n) => ['gain', 'filter', 'panner', 'merger'].includes(n.kind)).length;
    const warm = passive();
    for (let i = 1; i <= 12; i++) {
      mock.currentTime = i * 10;
      inst.pad(mock.currentTime + 0.1, [60, 64, 67], 1, 0.7, { pan: 0.6 });
    }
    expect(passive()).toBe(warm);
    expect(sources.every((n) => n.connections.size === 0)).toBe(true);
    expect(mock.nodes.every((n) => n.endedHandlers === 0)).toBe(true);
    const lfoGains = mock.nodes.filter((n) => [...n.connections].some((d) => d instanceof MockParam));
    expect(lfoGains.reduce((sum, n) => sum + n.connections.size, 0)).toBe(7);
    inst.dispose();
    expect(lfoGains.every((n) => n.connections.size === 0)).toBe(true);
    expect((inst.channel('pad').input as unknown as MockNode).connections.size).toBe(1);
  });
});
