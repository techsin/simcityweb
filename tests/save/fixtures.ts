/** Small storage fixtures: recovery never needs to generate a region's terrain. */
import type { RegionData } from '../../src/region/types';
import { MemoryKV } from '../../src/save/db';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { createCityRecord } from '../../src/save/cities';
import { buildRecoverySnapshot } from '../../src/save/recoveryCodec';
import type { Journal } from '../../src/worker/protocol';

export class PersistentMemoryKV extends MemoryKV {
  override readonly persistent = true as unknown as false;
}

export class MemStorage {
  m = new Map<string, string>();
  quota = Infinity;
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void {
    let used = 0;
    for (const [kk, vv] of this.m) if (kk !== k) used += kk.length + vv.length;
    if (used + k.length + v.length > this.quota) throw new Error('QuotaExceededError');
    this.m.set(k, String(v));
  }
  removeItem(k: string): void { this.m.delete(k); }
}

export function regionData(id = 'rtest', name = 'Test Region'): RegionData {
  return {
    format: 'metropolis-region', version: 1, genVersion: 1, id, name, seed: 5, preset: 'greenvale', climate: 'temperate',
    tiles: [0, 1, 2].map((x) => ({ key: `${x}_0`, x, z: 0, size: 1 })),
    totals: { population: 0, cities: 0, r: 0, c: 0, i: 0 }, created: 1, lastPlayed: 1,
  };
}

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function smallCity(): CityState {
  return new CityState(defaultCityConfig({ name: 'Saved City', size: 16, seed: 7, terrain: 'flat' }));
}

export function recoveryFixture() {
  const state = smallCity();
  const record = createCityRecord('rtest', '0_0', state);
  record.savedAt = record.city.savedAt = 1000;
  state.day = 10;
  state.zone[2] = 1;
  const snapshot = buildRecoverySnapshot('rtest', '0_0', state, record, { at: 1010, cityName: state.config.name, population: 0, funds: state.funds });
  return { ...snapshot, record, state };
}

export function journalFixture(): Journal {
  return { v: 1, regionId: 'rtest', tileKey: '0_0', at: 1020, base: { kind: 'save', savedAt: 1000 }, fromCmd: 1,
    ops: [{ seq: 2, op: 'setTax', args: [0, 9] }] };
}
