/** FH-22: authoritative copies survive real host saves, packet delivery and continued play. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ONBOARDING_MAX_BYTES, type GuideProgress } from '../../src/core/onboarding';
import { clearRecoveryBase, getCityRecord, loadCity, saveCity } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { CityActions } from '../../src/sim/actions';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems';
import { newProgress } from '../../src/ui/guide/progress';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { SYSTEM_KEYS } from '../../src/worker/protocol';
import { exactDigest } from '../../src/worker/queries';
import { LocalSimHost, type SimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { MemStorage, PersistentMemoryKV } from '../save/fixtures';

const city = { regionId: 'guide-test', tileKey: '0_0' };
const hosts: SimHost[] = [];
let kv: PersistentMemoryKV;
beforeEach(() => {
  kv = new PersistentMemoryKV(); setKV(kv); clearRecoveryBase();
  vi.stubGlobal('localStorage', new MemStorage());
  vi.spyOn(Date, 'now').mockReturnValue(1000);
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.dispose();
  clearRecoveryBase(); setKV(new MemoryKV()); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function g4(): GuideProgress {
  return { ...newProgress(90), phase: 'year', completed: ['road', 'zones', 'power', 'water', 'play', 'G1', 'G2', 'G3'],
    started: ['G1', 'G2', 'G3', 'G4', 'G10'], dismissed: true, minimised: true, budgetOpened: true,
    solventMonths: 1, lastBudgetMonth: 4, whyOpened: true, powerMarginSince: 120, lastExplainerDay: 120 };
}

async function hostFor(kind: 'local' | 'packet', state = newState(16)): Promise<LocalSimHost | LoopbackSimHost> {
  const host = kind === 'local' ? new LocalSimHost(state, { initialSpeed: 0, persistence: city })
    : new LoopbackSimHost(state, { initialSpeed: 0, persistence: city, journal: false, loopback: { modules: {} } });
  hosts.push(host);
  if (host instanceof LocalSimHost) await host.start({});
  else { await host.start(); await host.drain(); }
  return host;
}
async function settle(host: LocalSimHost | LoopbackSimHost): Promise<void> {
  if (host instanceof LoopbackSimHost) await host.drain();
}

describe('FH-22 setOnboarding', () => {
  for (const kind of ['local', 'packet'] as const) {
    it(`${kind}: saves and reloads the complete G4 record and keeps caller, save and replica copies detached`, async () => {
      const state = newState(16); state.day = 150;
      const host = await hostFor(kind, state), progress = g4(), wanted = structuredClone(progress);
      const ticket = host.act('setOnboarding', [progress]);
      progress.completed.push('G5'); progress.dismissed = false;
      await settle(host); await expect(ticket.done).resolves.toBe(true);
      expect(host.state.systemData.onboarding).toEqual(wanted);
      expect(host.state.systemData.onboarding).not.toBe(progress);
      if (host instanceof LoopbackSimHost) {
        expect(host.harness.primary.systemData.onboarding).toEqual(wanted);
        expect(host.harness.primary.systemData.onboarding).not.toBe(host.state.systemData.onboarding);
      }
      const saved = host.save('manual'); await settle(host); await saved;
      const record = (await getCityRecord(kv, city.regionId, city.tileKey))!;
      expect(record.city.data.systemData).toMatchObject({ onboarding: wanted });
      const loaded = (await loadCity(city.regionId, city.tileKey))!;
      const again = await hostFor(kind, loaded);
      expect(again.state.systemData.onboarding).toEqual(wanted);
      const next = structuredClone(wanted); next.dismissed = false; next.completed.push('G4');
      const changed = again.act('setOnboarding', [next]); await settle(again); await changed.done;
      expect(record.city.data.systemData).toMatchObject({ onboarding: wanted });
      const resaved = again.save('manual'); await settle(again); await resaved;
      expect((await loadCity(city.regionId, city.tileKey))!.systemData.onboarding).toEqual(next);
    });

    it(`${kind}: rejects future, malformed and oversized records without replacing a saved v1 record`, async () => {
      const host = await hostFor(kind), good = g4();
      let ticket = host.act('setOnboarding', [good]); await settle(host); await ticket.done;
      const before = exactDigest(host.state);
      const invalid: unknown[] = [null, [], { ...good, version: 2 }, { ...good, phase: 'future' },
        { ...good, completed: ['G1', 'G1'] }, { ...good, completed: ['G99'] }, { ...good, started: ['road'] },
        { ...good, completed: Array(1) },
        { ...good, completed: Object.assign([], { padding: 'x'.repeat(ONBOARDING_MAX_BYTES + 1) }) },
        { ...good, solventMonths: 3 }, { ...good, startDay: NaN }, { ...good, whyOpened: 1 },
        { ...good, lastExplainerDay: -1 }, { ...good, completed: Array(ONBOARDING_MAX_BYTES).fill('G1') },
        { ...good, padding: 'x'.repeat(ONBOARDING_MAX_BYTES + 1) }];
      for (const progress of invalid) {
        ticket = host.act('setOnboarding', [progress as GuideProgress]); await settle(host);
        await expect(ticket.done).resolves.toBe(false);
        expect(host.state.systemData.onboarding).toEqual(good);
        expect(exactDigest(host.state)).toBe(before);
      }
    });

    it(`${kind}: old saves without onboarding load, save and continue without creating the optional key`, async () => {
      const original = newState(16); original.day = 90;
      await saveCity(city.regionId, city.tileKey, original);
      const host = await hostFor(kind, (await loadCity(city.regionId, city.tileKey))!);
      expect(Object.hasOwn(host.state.systemData, 'onboarding')).toBe(false);
      const saved = host.save('manual'); await settle(host); await saved;
      expect(Object.hasOwn((await loadCity(city.regionId, city.tileKey))!.systemData, 'onboarding')).toBe(false);
    });
  }

  it('keeps the pre-FH-22 exact digest when the optional op was never sent', () => {
    const state = newState(16), current = exactDigest(state);
    // The previous key list is the reference: adding an absent optional field must hash no bytes.
    const keys = SYSTEM_KEYS as unknown as string[], i = keys.indexOf('onboarding');
    expect(i).toBeGreaterThanOrEqual(0);
    keys.splice(i, 1);
    try { expect(exactDigest(state)).toBe(current); }
    finally { keys.splice(i, 0, 'onboarding'); }
    expect(Object.hasOwn(state.systemData, 'onboarding')).toBe(false);
  });

  it('keeps the simulation save, exact digest and RNG identical when the op is never sent', async () => {
    const source = newState(16), saved = serializeCity(source, { copy: true });
    const state = deserializeCity(saved), sim = new Simulation(state, []), systems = createSystems();
    sim.systems.push(...systems); for (const system of systems) system.init?.(sim);
    const host = new LocalSimHost(deserializeCity(saved)); hosts.push(host);
    await host.start({ createSystems, CityActions });
    sim.runDays(45); host.sim.runDays(45);
    expect(serializeCity(host.sim.state, { copy: true })).toEqual(serializeCity(sim.state, { copy: true }));
    expect(exactDigest(host.state)).toBe(exactDigest(sim.state));
    expect(host.sim.rng.state).toBe(sim.rng.state);
    expect(Object.hasOwn(host.state.systemData, 'onboarding')).toBe(false);
  });
});
