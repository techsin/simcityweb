import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ambience, DISTRICT_GAIN_FLOOR, districtAttenuation, sampleDistrictAmbience,
  type AmbienceDistrictCity, type DistrictLayer, type DistrictMix } from '../../src/audio/ambience';
import { CELL_SIZE } from '../../src/core/constants';
import { DevType, Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { growablesFor } from '../../src/sim/catalog';
import type { SfxEnv } from '../../src/audio/sfx';
import { audioSetup, type MockParam, type MockNode } from './mockAudio';

const mix = (change: Partial<DistrictMix> = {}): DistrictMix => ({
  industry: 0, parks: 0, crowd: 0, airport: 0, rail: 0, harbour: 0, distance: 300, ...change,
});
const layers: DistrictLayer[] = ['industry', 'parks', 'crowd', 'transport'];

function harness() {
  const h = audioSetup();
  const ambience = new Ambience(h as unknown as SfxEnv, h.out, { live: false, random: () => 0.5 });
  vi.spyOn(ambience as unknown as { loopNoise: () => AudioBufferSourceNode }, 'loopNoise')
    .mockImplementation(() => h.mock.createBufferSource() as unknown as AudioBufferSourceNode);
  const voices = ambience as unknown as {
    bird: (...args: unknown[]) => void; cricket: (...args: unknown[]) => void;
    gull: (...args: unknown[]) => void; horn: (...args: unknown[]) => void;
  };
  const bird = vi.spyOn(voices, 'bird').mockImplementation(() => {});
  const cricket = vi.spyOn(voices, 'cricket').mockImplementation(() => {});
  const gull = vi.spyOn(voices, 'gull').mockImplementation(() => {});
  const horn = vi.spyOn(voices, 'horn').mockImplementation(() => {});
  ambience.start();
  const advance = (seconds: number) => {
    const from = h.mock.currentTime;
    for (let i = 1; i <= Math.round(seconds * 10); i++) {
      h.mock.currentTime = from + i / 10;
      if (i % 2 === 0) ambience.tick();
    }
  };
  return { ...h, ambience, advance, bird, cricket, gull, horn };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('FEEL-13 camera land-use sampling', () => {
  it('reads exactly the 49 clipped map cells at every height and writes only caller scratch', () => {
    const reads: number[][] = [[], [], []];
    const sample = (slot: number, value: number) => new Proxy({} as ArrayLike<number>, {
      get(_target, key) {
        const i = Number(key);
        if (!Number.isInteger(i) || i < 0 || i >= 20 * 20) throw new Error(`unexpected read ${String(key)}`);
        reads[slot].push(i);
        return value;
      },
      set() { throw new Error('replica data is read only'); },
    });
    const st: AmbienceDistrictCity = Object.freeze({ size: 20, building: sample(0, 1), zone: sample(1, Zone.IndMed),
      network: sample(2, Network.None), buildings: new Map([[1, { def: growablesFor(DevType.ID)[0].id, built: 1, flags: 0 }]]) });
    const out = mix();
    expect(sampleDistrictAmbience(st, 10.8 * CELL_SIZE, 7.2 * CELL_SIZE, 300, out)).toBe(out);
    const expected: number[] = [];
    for (let z = 4; z <= 10; z++) for (let x = 7; x <= 13; x++) expected.push(z * 20 + x);
    for (const layer of reads) expect(layer).toEqual(expected);
    expect(out).toEqual(mix({ industry: 1 }));
    for (const layer of reads) layer.length = 0;
    sampleDistrictAmbience(st, 0, 0, 300, out);
    expect(reads.every((layer) => layer.length === 16)).toBe(true);
    sampleDistrictAmbience(st, 100 * CELL_SIZE, 0, 300, out);
    expect(out.industry).toBe(0);
    sampleDistrictAmbience(st, 0, 0, 300, out);
    sampleDistrictAmbience(st, 200 * CELL_SIZE, 200 * CELL_SIZE, 1500, out);
    expect(out.industry).toBe(0);
    expect(out.distance).toBe(1500);
    for (const distance of [700, 900, 1500, 3000]) {
      for (const layer of reads) layer.length = 0;
      sampleDistrictAmbience(st, 10.8 * CELL_SIZE, 7.2 * CELL_SIZE, distance, out);
      for (const layer of reads) expect(layer).toEqual(expected);
      expect(out).toEqual(mix({ industry: 1, distance }));
    }
  });

  it('counts footprint area and combines real facilities, zones and rails without mutating their data', () => {
    const building = new Int32Array(49).fill(-1), zone = new Uint8Array(49), network = new Uint8Array(49);
    const buildings = new Map<number, Readonly<{ def: string; built: number; flags: number }>>([
      [1, Object.freeze({ def: 'park_playground', built: 1, flags: 0 })],
      [2, Object.freeze({ def: 'tr_airport_small', built: 1, flags: 0 })],
      [3, Object.freeze({ def: 'tr_seaport', built: 1, flags: 0 })],
      [4, Object.freeze({ def: 'tr_train_station', built: 1, flags: 0 })],
      [5, Object.freeze({ def: 'park_small', built: 1, flags: BF.Burnt })],
      [6, Object.freeze({ def: 'tr_airport_large', built: 0.2, flags: BF.Constructing })],
      [7, Object.freeze({ def: growablesFor(DevType.ID)[0].id, built: 1, flags: 0 })],
      [8, Object.freeze({ def: growablesFor(DevType.CO2)[0].id, built: 1, flags: 0 })],
    ]);
    for (let i = 0; i < 7; i++) {
      zone[i] = Zone.IndMed; building[i] = 7; building[7 + i] = 1; zone[14 + i] = Zone.ComHigh; building[14 + i] = 8;
      building[21 + i] = 2; building[28 + i] = 3; network[35 + i] = Network.Rail;
    }
    building[42] = 4; building[43] = 5; building[44] = 6;
    const before = { building: building.slice(), zone: zone.slice(), network: network.slice(), buildings: [...buildings] };
    const st = Object.freeze({ size: 7, building, zone, network, buildings });
    const out = sampleDistrictAmbience(st, 3 * CELL_SIZE, 3 * CELL_SIZE, 300, mix());
    expect(out).toEqual(mix({ industry: 7 / 49, parks: 7 / 49, crowd: 7 / 49, airport: 7 / 49, harbour: 7 / 49, rail: 8 / 49 }));
    expect({ building, zone, network, buildings: [...buildings] }).toEqual(before);
    building.fill(-1); zone.fill(0); network.fill(0);
    expect(sampleDistrictAmbience(st, 3 * CELL_SIZE, 3 * CELL_SIZE, 300, out)).toEqual(mix());
  });

  it('ignores empty, unfinished and burnt zones and every agricultural building, while retaining bare rail', () => {
    const building = new Int32Array(49).fill(-1), zone = new Uint8Array(49), network = new Uint8Array(49);
    const farms = growablesFor(DevType.IA);
    const buildings = new Map<number, { def: string; built: number; flags: number }>([
      [1, { def: growablesFor(DevType.ID)[0].id, built: 0.9, flags: BF.Constructing }],
      [2, { def: growablesFor(DevType.CO2)[0].id, built: 1, flags: BF.Burnt }],
      [3, { def: growablesFor(DevType.CO2)[0].id, built: 1, flags: 0 }],
      [4, { def: growablesFor(DevType.ID)[0].id, built: 1, flags: 0 }],
      [5, { def: growablesFor(DevType.R1)[0].id, built: 1, flags: 0 }],
    ]);
    for (let i = 0; i < farms.length; i++) buildings.set(10 + i, { def: farms[i].id, built: 1, flags: 0 });
    for (let i = 0; i < 7; i++) {
      zone[i] = Zone.IndMed;
      zone[7 + i] = Zone.IndHigh; building[7 + i] = 1;
      zone[14 + i] = Zone.ComHigh; building[14 + i] = 2;
      zone[21 + i] = Zone.ComHigh; building[21 + i] = 3;
      zone[28 + i] = i % 2 ? Zone.IndAg : Zone.IndMed; building[28 + i] = 10 + i % farms.length;
      zone[35 + i] = Zone.IndMed; building[35 + i] = 4;
      zone[42 + i] = Zone.ResHigh; building[42 + i] = 5;
    }
    network[0] = Network.Rail;
    const st = { size: 7, building, zone, network, buildings };
    for (const distance of [120, 900, 1500]) {
      expect(sampleDistrictAmbience(st, 3 * CELL_SIZE, 3 * CELL_SIZE, distance, mix()))
        .toEqual(mix({ industry: 7 / 49, crowd: 14 / 49, rail: 1 / 49, distance }));
    }
  });

  it('keeps new scene reads behind the half-second tick and the host replica', () => {
    const scene = readFileSync(new URL('../../src/game/CityScene.ts', import.meta.url), 'utf8');
    expect(scene).toContain('sampleDistrictAmbience(this.host.state, target.x, target.z, dist, this.districtAmbience)');
    expect(scene).toContain('district: this.districtAmbience');
    expect(scene).toMatch(/if \(now - this\.ambAcc >= 500\) \{\s*this\.ambAcc = now;\s*this\.updateAmbience\(\);/);
    for (const fn of [sampleDistrictAmbience, districtAttenuation]) {
      const source = fn.toString();
      expect(source).not.toMatch(/\bnew\s|=>|\.\.\.|\b(?:Array|Object)\.(?:from|entries|keys|values)\s*\(/);
      expect(source).not.toMatch(/\.(?:map|filter|slice|subarray|concat|split)\s*\(/);
      expect(source).not.toMatch(/(?:=|return)\s*(?:\{|\[)/);
    }
  });
});

describe('FEEL-13 district beds', () => {
  it('switches a fully settled dense bed within 1.5 s for every district family', () => {
    vi.useFakeTimers();
    const h = harness();
    h.ambience.set({ district: mix({ industry: 1 }) }); h.advance(4);
    for (const kind of ['parks', 'crowd', 'airport', 'rail', 'harbour', 'industry'] as const) {
      const before = layers.map((layer) => h.ambience.districtLevel(layer));
      h.ambience.set({ district: mix({ [kind]: 1 }) });
      for (let i = 0; i < layers.length; i++) {
        const current = h.ambience.districtLevel(layers[i]);
        if (before[i] > 0) expect(current).toBeCloseTo(before[i], 12);
        else expect(current).toBeLessThanOrEqual(DISTRICT_GAIN_FLOOR);
      }
      h.advance(1.5);
      const dominant: DistrictLayer = kind === 'airport' || kind === 'rail' || kind === 'harbour' ? 'transport' : kind;
      for (const layer of layers) if (layer !== dominant) {
        expect(h.ambience.districtLevel(dominant), `${kind} over ${layer}`).toBeGreaterThan(h.ambience.districtLevel(layer));
      }
      h.advance(2.5);
    }
    h.ambience.stop(); vi.runAllTimers();
  });

  it('halves both people beds at night and attenuates every bed by at least 18 dB above 1,500 m', () => {
    vi.useFakeTimers();
    const h = harness(), d = mix({ industry: 1, parks: 1, crowd: 1, rail: 1 });
    h.ambience.set({ district: d, night: false }); h.advance(4);
    const day = layers.map((layer) => h.ambience.districtLevel(layer));
    h.ambience.set({ night: true }); h.advance(2);
    expect(h.ambience.districtLevel('parks')).toBeCloseTo(day[1] / 2, 8);
    expect(h.ambience.districtLevel('crowd')).toBeCloseTo(day[2] / 2, 8);
    expect(h.ambience.districtLevel('industry')).toBeCloseTo(day[0], 8);
    expect(h.ambience.districtLevel('transport')).toBeCloseTo(day[3], 8);
    for (const distance of [1500, 1700, 3000]) {
      d.distance = distance;
      h.ambience.set({ district: d, night: false }); h.advance(6);
      for (let i = 0; i < layers.length; i++) {
        const db = 20 * Math.log10(h.ambience.districtLevel(layers[i]) / day[i]);
        expect(db, `${layers[i]} at ${distance}`).toBeLessThanOrEqual(-18 + 1e-8);
      }
    }
    expect(districtAttenuation(300)).toBe(1);
    expect(20 * Math.log10(districtAttenuation(1500))).toBeCloseTo(-18, 10);
    h.ambience.stop(); vi.runAllTimers();
  });

  it('adds exactly six persistent processors, with no extra sources or hot-path node allocations', () => {
    vi.useFakeTimers();
    const h = harness();
    const graph = h.ambience as unknown as { nodes: MockNode[]; sources: MockNode[] };
    expect(graph.nodes).toHaveLength(23); // 15 original + 2 rain + 6 local processors
    expect(graph.nodes.slice(-6).map((node) => node.kind)).toEqual(['gain', 'filter', 'gain', 'gain', 'filter', 'gain']);
    expect(graph.sources).toHaveLength(10); // four original noise beds, five oscillators, rain
    const count = h.mock.nodes.length, sources = graph.sources.slice(), chain = graph.nodes.slice();
    const district = mix(), params = { district, activity: 1 };
    for (let i = 0; i < 600; i++) {
      h.mock.currentTime = i / 5;
      district.industry = i % 6 === 0 ? 1 : 0; district.parks = i % 6 === 1 ? 1 : 0;
      district.crowd = i % 6 === 2 ? 1 : 0; district.airport = i % 6 === 3 ? 1 : 0;
      district.rail = i % 6 === 4 ? 1 : 0; district.harbour = i % 6 === 5 ? 1 : 0;
      h.ambience.set(params); h.ambience.tick();
    }
    expect(h.mock.nodes).toHaveLength(count);
    expect(graph.sources).toEqual(sources);
    h.ambience.stop(); vi.runAllTimers();
    expect(chain.every((node) => node.connections.size === 0)).toBe(true);
  });

  it('bounds every positive 100 ms gain ratio over two minutes, including sparse and far districts', () => {
    vi.useFakeTimers();
    const h = harness(), district = mix();
    const params = { district, night: false };
    let previous = layers.map((layer) => h.ambience.districtLevel(layer));
    let measured = 0;
    for (let i = 1; i <= 1200; i++) {
      h.mock.currentTime = i / 10;
      const before = layers.map((layer) => h.ambience.districtLevel(layer));
      if (i % 50 === 1) {
        const kind = Math.floor(i / 50) % 4;
        const density = [1, 1 / 49, 0.00001, 0.15][Math.floor(i / 200) % 4];
        district.industry = kind === 0 ? density : 0; district.parks = kind === 1 ? density : 0;
        district.crowd = kind === 2 ? density : 0; district.rail = kind === 3 ? density : 0;
        district.distance = Math.floor(i / 400) % 2 ? 1500 : 300;
        params.night = Math.floor(i / 200) % 2 === 1;
        h.ambience.set(params);
      }
      if (i % 2 === 0) h.ambience.tick();
      const current = layers.map((layer) => h.ambience.districtLevel(layer));
      for (let j = 0; j < layers.length; j++) {
        if (before[j] > 0 && current[j] > 0) expect(current[j], `continuous ${layers[j]} at ${i / 10}`).toBeCloseTo(before[j], 10);
        else expect(Math.abs(current[j] - before[j])).toBeLessThanOrEqual(DISTRICT_GAIN_FLOOR);
        expect(Number.isFinite(current[j]) && current[j] >= 0).toBe(true);
        if (current[j] > 0 && previous[j] > 0) {
          expect(Math.abs(20 * Math.log10(current[j] / previous[j])), `${layers[j]} at ${i / 10}`).toBeLessThanOrEqual(1 + 1e-8);
          measured++;
        }
      }
      previous = current;
    }
    expect(measured).toBeGreaterThan(500);
    h.ambience.stop(); vi.runAllTimers();
  });

  it('retargets a native exponential rise without changing any earlier sample or dipping at the anchor', () => {
    vi.useFakeTimers();
    const h = harness();
    const graph = h.ambience as unknown as { industryGain: { gain: MockParam } };
    h.ambience.set({ district: mix({ industry: 1 }) });
    const gain = graph.industryGain.gain;
    const held = vi.spyOn(gain, 'cancelAndHoldAtTime');
    const rate = h.mock.sampleRate, t = 0.5;
    const times = [t - 0.1, t - 1 / rate, t];
    const before = times.map((at) => gain.valueAt(at));
    h.mock.currentTime = t;
    // Simulate a main-thread value one render quantum behind the audio envelope.
    vi.spyOn(gain, 'value', 'get').mockReturnValue(gain.valueAt(t - 128 / rate));
    h.ambience.set({ district: mix({ industry: 0.2 }) });
    expect(held).toHaveBeenCalledWith(t);
    times.forEach((at, i) => expect(gain.valueAt(at)).toBeCloseTo(before[i], 12));
    expect(gain.valueAt(t + 1 / rate)).toBeGreaterThanOrEqual(before[2]);
    expect(gain.events.filter((event) => event[0] === 'linear')).toEqual([]);
    h.ambience.stop(); vi.runAllTimers();
  });

  it('holds the dB bound below the silence boundary and only steps at zero', () => {
    vi.useFakeTimers();
    const h = harness();
    const graph = h.ambience as unknown as { industryGain: { gain: MockParam } };
    const gain = graph.industryGain.gain;
    h.ambience.set({ district: mix({ industry: 0.02 }) });
    expect(gain.valueAt(0)).toBeCloseTo(0.004, 12);
    h.mock.currentTime = 1;
    h.ambience.set({ district: mix({ industry: 0.000001 }) });
    for (let i = 1; i <= 120; i++) {
      const current = gain.valueAt(1 + i / 10), previous = gain.valueAt(1 + (i - 1) / 10);
      expect(current).toBeGreaterThan(0);
      expect(Math.abs(20 * Math.log10(current / previous))).toBeLessThanOrEqual(1 + 1e-8);
    }
    expect(gain.valueAt(13)).toBeCloseTo(0.0000002, 12);
    h.mock.currentTime = 13;
    h.ambience.set({ district: mix() });
    expect(gain.valueAt(13)).toBeCloseTo(0.0000002, 12);
    expect(gain.valueAt(13.03)).toBe(0);
    h.ambience.stop(); vi.runAllTimers();
  });

  it('spaces jet swells 30–60 audio seconds apart and reuses the existing gull/horn schedulers', () => {
    vi.useFakeTimers();
    const h = harness(), district = mix({ airport: 1 });
    h.ambience.set({ district, population: 0, water: 0 });
    const jet = h.ambience as unknown as { jetAt: number };
    const dates: number[] = [];
    for (let i = 1; i <= 600; i++) {
      h.mock.currentTime = i / 5; h.ambience.tick();
      if (Number.isFinite(jet.jetAt) && dates[dates.length - 1] !== jet.jetAt) dates.push(jet.jetAt);
    }
    expect(dates.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < dates.length; i++) expect(dates[i] - dates[i - 1]).toBeGreaterThanOrEqual(30);
    for (let i = 1; i < dates.length; i++) expect(dates[i] - dates[i - 1]).toBeLessThanOrEqual(60.2);
    h.ambience.stop(); vi.runAllTimers();
    const harbour = harness();
    harbour.ambience.set({ district: mix({ harbour: 1 }), population: 0, water: 0 }); harbour.advance(1);
    expect(harbour.gull).toHaveBeenCalledTimes(1);
    expect(harbour.horn).toHaveBeenCalledTimes(1);
    expect(harbour.horn.mock.calls[0][2]).toBe('harbour');
    harbour.ambience.stop(); vi.runAllTimers();
    const rail = harness();
    rail.ambience.set({ district: mix({ rail: 1 }), population: 0 }); rail.advance(1);
    expect(rail.horn).toHaveBeenCalledTimes(1);
    expect(rail.horn.mock.calls[0][2]).toBe('train');
    rail.ambience.stop(); vi.runAllTimers();
  });
});
