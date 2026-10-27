import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ambience, type AmbienceEvent, type AmbienceParams } from '../../src/audio/ambience';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { ambienceZoom, sampleAmbienceWater } from '../../src/audio/ambienceSample';
import type { SfxEnv } from '../../src/audio/sfx';
import { CELL_SIZE } from '../../src/core/constants';
import type { Climate } from '../../src/core/types';
import { RNG } from '../../src/core/rng';

// Record automation targets and emitted voices; actual DSP is measured by the offline audio lab.
class Param {
  value = 0;
  timeConstant = 0;
  setValueAtTime(v: number) { this.value = v; }
  linearRampToValueAtTime(v: number) { this.value = v; }
  exponentialRampToValueAtTime(v: number) { this.value = v; }
  setTargetAtTime(v: number, _t: number, tau: number) { this.value = v; this.timeConstant = tau; }
  cancelScheduledValues() {}
}

class Node {
  gain = new Param();
  frequency = new Param();
  Q = new Param();
  pan = new Param();
  connect(n: unknown) { return n; }
  start() {}
  stop() {}
  disconnect() {}
}

function harness(params: AmbienceParams = {}, random = () => 0.5, live = false) {
  const nodes: Node[] = [];
  const node = () => { const n = new Node(); nodes.push(n); return n; };
  const ctx = { currentTime: 0, state: 'running', createGain: node, createOscillator: node, createBiquadFilter: node, createStereoPanner: node };
  const env = { ctx, out: node(), wet: node() } as unknown as SfxEnv;
  const events: { kind: AmbienceEvent; t: number }[] = [];
  const amb = new Ambience(env, env.out, { live, random, onEvent: (kind, t) => events.push({ kind, t }) });
  // Continuous noise samples do not affect scheduling or gains. Avoid rendering buffers in unit tests.
  vi.spyOn(amb as unknown as { loopNoise: () => AudioBufferSourceNode }, 'loopNoise').mockImplementation(() => node() as unknown as AudioBufferSourceNode);
  amb.set(params);
  amb.start();
  const advance = (seconds: number) => {
    const start = ctx.currentTime;
    for (let i = 1; i <= Math.round(seconds * 5); i++) { ctx.currentTime = start + i * 0.2; amb.tick(); }
  };
  return { amb, ctx, events, advance, nodes };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('FEEL-12 seasons and climate', () => {
  it('uses full bird frequency Apr-Aug, half Mar/Sep/Oct, and 15% Nov-Feb in every climate', () => {
    const rates = [0.15, 0.15, 0.5, 1, 1, 1, 1, 1, 0.5, 0.5, 0.15, 0.15];
    for (const climate of ['temperate', 'desert', 'tropical', 'alpine'] as Climate[]) {
      const periods = rates.map((_, month) => {
        const h = harness({ month, climate, zoom: 0.4, population: 2000 });
        h.advance(45);
        const birds = h.events.filter((e) => e.kind === 'bird');
        expect(birds.length).toBeGreaterThanOrEqual(2);
        return birds[1].t - birds[0].t;
      });
      for (let m = 0; m < 12; m++) expect(Math.abs(periods[6] / periods[m] - rates[m]), `${climate} month ${m}`).toBeLessThan(0.03);
    }
  });

  it('emits at most a quarter as many January bird phrases as July over two minutes', () => {
    for (const seed of [1, 7, 33]) {
      const counts = [0, 6].map((month) => {
        const rng = new RNG(seed);
        const h = harness({ month, zoom: ambienceZoom(300, 64) }, () => rng.next());
        h.advance(120);
        return h.events.filter((e) => e.kind === 'bird').length;
      });
      expect(counts[0]).toBeGreaterThan(0);
      expect(counts[0], `seed ${seed}: January / July ${counts}`).toBeLessThanOrEqual(counts[1] / 4);
    }
  });

  it('allows crickets only on May-Sep nights, or any desert night; birds stay silent at night', () => {
    for (const climate of ['temperate', 'desert', 'tropical', 'alpine'] as Climate[]) {
      for (let month = 0; month < 12; month++) {
        const h = harness({ month, climate, night: true });
        h.advance(1);
        expect(h.events.some((e) => e.kind === 'cricket'), `${climate} month ${month}`).toBe(climate === 'desert' || (month >= 4 && month <= 8));
        expect(h.events.some((e) => e.kind === 'bird')).toBe(false);
        h.amb.set({ night: false });
        h.events.length = 0;
        h.advance(1);
        expect(h.events.some((e) => e.kind === 'cricket')).toBe(false);
      }
    }
  });

  it('boosts wind 40% in Dec-Feb or alpine, without stacking the two conditions', () => {
    const h = harness({ month: 6, climate: 'temperate' });
    const normal = h.amb.windLevel;
    for (const climate of ['temperate', 'desert', 'tropical', 'alpine'] as Climate[]) {
      for (let month = 0; month < 12; month++) {
        h.amb.set({ month, climate });
        expect(h.amb.windLevel).toBeCloseTo(normal * (month === 11 || month < 2 || climate === 'alpine' ? 1.4 : 1), 10);
      }
    }
  });

  it('emits gulls strictly above 30% water and stops scheduling them after leaving the coast', () => {
    for (const water of [0, 24 / 81, 0.3, 25 / 81, 1]) {
      const h = harness({ water });
      h.advance(1);
      expect(h.events.some((e) => e.kind === 'gull')).toBe(water > 0.3);
      h.amb.set({ water: 0 });
      h.events.length = 0;
      h.advance(30);
      expect(h.events.some((e) => e.kind === 'gull')).toBe(false);
    }
  });

  it('supports the offline clock while suspended, but silences a suspended live context', () => {
    vi.useFakeTimers();
    for (const live of [false, true]) {
      const h = harness({ month: 6 }, () => 0.5, live);
      h.ctx.state = 'suspended';
      h.advance(1);
      expect(h.events.length > 0).toBe(!live);
      h.amb.stop();
      h.events.length = 0;
      h.advance(1);
      expect(h.events).toEqual([]);
    }
  });
});

describe('FEEL-12 water sampling and surf', () => {
  it('reads each of the 81 centered cells exactly once, with no out-of-bounds reads or writes', () => {
    const reads: number[] = [];
    const water = new Proxy({} as ArrayLike<number>, {
      get(_target, key) {
        const i = Number(key);
        if (!Number.isInteger(i) || i < 0 || i >= 20 * 20) throw new Error(`unexpected read ${String(key)}`);
        reads.push(i);
        return i % 20 < 10 ? 1 : 0;
      },
      set() { throw new Error('water is read only'); },
    });
    expect(sampleAmbienceWater(water, 20, 10.8 * CELL_SIZE, 7.2 * CELL_SIZE)).toBe(4 / 9);
    const expected: number[] = [];
    for (let z = 3; z <= 11; z++) for (let x = 6; x <= 14; x++) expected.push(z * 20 + x);
    expect(reads).toEqual(expected);
  });

  it('clips at map edges and reads fresh terrain every time, including while paused', () => {
    const water = new Uint8Array(12 * 12).fill(1);
    const before = water.slice();
    expect(sampleAmbienceWater(water, 12, 0, 0)).toBe(1);
    expect(sampleAmbienceWater(water, 12, 12 * CELL_SIZE, 12 * CELL_SIZE)).toBe(1);
    expect(sampleAmbienceWater(water, 12, -10 * CELL_SIZE, 0)).toBe(0);
    expect(sampleAmbienceWater(water, 12, 30 * CELL_SIZE, 0)).toBe(0);
    expect(sampleAmbienceWater(water, 0, 0, 0)).toBe(0);
    expect(water).toEqual(before);
    water.fill(0);
    expect(sampleAmbienceWater(water, 12, 6 * CELL_SIZE, 6 * CELL_SIZE)).toBe(0);
    water[0] = 1;
    expect(sampleAmbienceWater(water, 12, 0, 0)).toBe(1 / 25);
  });

  it('keeps shoreline surf above 0.1 at 300 m on every city size and fades it when zooming out', () => {
    const h = harness();
    const engine = new AudioEngine();
    (engine as unknown as { ambience: Ambience }).ambience = h.amb;
    for (const size of [64, 128, 256]) {
      const water = new Uint8Array(size * size);
      for (let z = 0; z < size; z++) for (let x = 0; x < size / 2; x++) water[z * size + x] = 1;
      const city = Object.freeze({ size, water, month: 0, config: Object.freeze({ climate: 'temperate' as const }), stats: Object.freeze({ population: 0 }) });
      engine.setCityAmbience(city, size / 2 * CELL_SIZE, size / 2 * CELL_SIZE, 300, false, 0, 0);
      const beach = h.amb.surfLevel;
      expect(beach).toBeGreaterThan(0.1);
      engine.setCityAmbience(city, size / 2 * CELL_SIZE, size / 2 * CELL_SIZE, 60 + size * CELL_SIZE, false, 0, 0);
      expect(h.amb.surfLevel).toBeLessThan(beach);
      water.fill(0);
      engine.setCityAmbience(city, size / 2 * CELL_SIZE, size / 2 * CELL_SIZE, 300, false, 0, 0);
      expect(h.amb.surfLevel).toBe(0);
    }
    h.amb.set({ zoom: 0, water: -1 });
    expect(h.amb.surfLevel).toBe(0);
    h.amb.set({ water: 2 });
    expect(h.amb.surfLevel).toBeCloseTo(0.36);
  });

  it('reuses the parameter object and audio nodes when sampling, forwarding the current month and climate', () => {
    const h = harness();
    const engine = new AudioEngine();
    (engine as unknown as { ambience: Ambience }).ambience = h.amb;
    const set = vi.spyOn(h.amb, 'set');
    const city = Object.freeze({ size: 9, water: Object.freeze(new Array<number>(81).fill(1)), month: 8, config: Object.freeze({ climate: 'desert' as const }), stats: Object.freeze({ population: 1234 }) });
    const nodes = h.nodes.length;
    engine.setCityAmbience(city, 4 * CELL_SIZE, 4 * CELL_SIZE, 300, true, 0.2, 0);
    const p = set.mock.calls[0][0];
    expect(p).toMatchObject({ population: 1234, water: 1, month: 8, climate: 'desert', night: true, construction: 0.2, activity: 0 });
    engine.setCityAmbience(city, -10 * CELL_SIZE, 0, 300, false, 0, 1);
    expect(set.mock.calls[1][0]).toBe(p);
    expect(p.water).toBe(0);
    expect(h.nodes.length).toBe(nodes);
    expect(h.nodes.filter((n) => n.gain.timeConstant > 0).every((n) => n.gain.timeConstant === 0.6)).toBe(true);
  });

  it('guards the sample path against temporary containers, closures and allocating array helpers', () => {
    // No heap/timing benchmark: check the small hot path structurally, alongside identity/read-count checks.
    const amb = Ambience.prototype as unknown as { apply: () => void; cityLevel: () => number };
    for (const fn of [sampleAmbienceWater, ambienceZoom, AudioEngine.prototype.setCityAmbience, Ambience.prototype.set, amb.apply, amb.cityLevel]) {
      const src = fn.toString();
      expect(src).not.toMatch(/\bnew\s|=>|\.\.\.|\b(?:Array|Object)\.(?:from|entries|fromEntries|keys|values)\s*\(/);
      expect(src).not.toMatch(/\.(?:map|filter|slice|subarray|concat|split)\s*\(/);
      expect(src).not.toMatch(/(?:=|return)\s*(?:\{|\[)/);
    }
  });

  it('keeps the scene sample behind its half-second timer and initializes seasons before starting ambience', () => {
    const scene = readFileSync(new URL('../../src/game/CityScene.ts', import.meta.url), 'utf8');
    expect(scene).toMatch(/if \(now - this\.ambAcc >= 500\) \{\s*this\.ambAcc = now;\s*this\.updateAmbience\(\);/);
    expect(scene.match(/this\.updateAmbience\(\)/g)).toHaveLength(1);
    expect(scene).toContain('a.setCityAmbience(st, target.x, target.z, dist,');
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/audio\.setAmbience\(\{[^\n]*water: 0, month: st\.month, climate: st\.config\.climate[^\n]*\}\);\s*audio\.startAmbience\(\);/);
  });
});
