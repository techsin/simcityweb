/** The catalog and Rewards share one mirrored-building scan, including same-day flag deliveries. */
import { afterEach, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { allDefs, plopSpec, UNIQUE_BUILT_TEXT, UNIQUE_RUINS_TEXT } from '../../src/game/toolCatalog';
import { BF } from '../../src/sim/CityState';
import { RewardsPanel } from '../../src/ui/panels/ListPanels';
import { ruinsFor, type RuinState } from '../../src/ui/ruinState';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState, place } from '../infra/cityGen';
import { installFakeDom } from './fakeDom';

vi.mock('../../src/ui/thumbs', () => ({ thumbs: { cached: () => null } }));
installFakeDom();
afterEach(() => vi.restoreAllMocks());

it('shares one scan across unique defs, flyout checks and repeated Rewards reads until the epoch changes', async () => {
  const st = newState(32), host = new LocalSimHost(st), abort = new AbortController();
  const defs = allDefs().filter((d) => d.unique && !d.hidden && d.category !== 'growable');
  const sample = place(st, defs[0].id, 5, 5, { flags: BF.Plopped });
  for (const def of defs) {
    const id = st.nextBuildingId++;
    st.buildings.set(id, { ...sample, id, def: def.id });
    st.milestones[def.id] = 1;
  }
  for (let n = 0; n < 5000; n++) {
    const id = st.nextBuildingId++;
    st.buildings.set(id, { ...sample, id, def: 't_r1', flags: 0 });
  }
  const ctx = { state: st, host, signal: abort.signal, mods: {}, sandbox: () => false } as unknown as GameContext;
  const panel = new RewardsPanel(ctx) as unknown as { ruins(): RuinState };
  const scan = vi.spyOn(st.buildings, 'values');
  const readAll = () => {
    for (const def of defs) {
      expect(plopSpec(ctx, def).disabled, def.id).toBe(UNIQUE_BUILT_TEXT);
      expect(plopSpec(ctx, def).disabled, def.id).toBe(UNIQUE_BUILT_TEXT);
    }
    for (let n = 0; n < 6; n++) expect(panel.ruins()).toBe(ruinsFor(ctx));
  };
  try {
    expect(defs.length).toBeGreaterThan(20);
    readAll(); expect(scan).toHaveBeenCalledTimes(1);
    host.act('setCamera', [{ x: 0, z: 0, distance: 500 }]);
    readAll(); expect(scan).toHaveBeenCalledTimes(2);
    st.day++;
    readAll(); expect(scan).toHaveBeenCalledTimes(3);
    st.nextBuildingId++;
    readAll(); expect(scan).toHaveBeenCalledTimes(4);
    st.buildings.delete(st.nextBuildingId - 2);
    readAll(); expect(scan).toHaveBeenCalledTimes(5);
    // A growable's presentation changes do not invalidate the plopped index.
    host.events.emit('buildingChanged', { ...sample, id: st.nextBuildingId - 3, flags: BF.Powered });
    host.events.emit('buildingChanged', { ...sample, flags: BF.Plopped | BF.Powered });
    readAll(); expect(scan).toHaveBeenCalledTimes(5);
  } finally { scan.mockRestore(); abort.abort('dispose'); await host.dispose(); }
});

it('refreshes burnt flags inside a day and keeps the first mirrored ruin when several share a def', async () => {
  const st = newState(32), host = new LocalSimHost(st), abort = new AbortController();
  const a = place(st, 'civ_mayor_house', 5, 5, { flags: BF.Plopped });
  const b = place(st, a.def, 15, 15, { flags: BF.Plopped | BF.Burnt });
  st.milestones[a.def] = 2;
  const ctx = { state: st, host, signal: abort.signal, mods: {}, sandbox: () => false } as unknown as GameContext;
  const def = allDefs().find((d) => d.id === a.def)!;
  try {
    expect(plopSpec(ctx, def).disabled).toBe(UNIQUE_BUILT_TEXT);
    a.flags |= BF.Burnt;
    host.events.emit('buildingChanged', a);
    expect(plopSpec(ctx, def).disabled).toBe(UNIQUE_RUINS_TEXT);
    expect(ruinsFor(ctx).ruin.get(a.def)?.id).toBe(a.id);
    st.buildings.delete(a.id);
    expect(ruinsFor(ctx).ruin.get(a.def)?.id).toBe(b.id);
    const before = ruinsFor(ctx);
    abort.abort('dispose');
    a.flags = BF.Plopped; host.events.emit('buildingChanged', a);
    expect(before.live.size).toBe(0);
    expect(st.day).toBe(0);
  } finally { abort.abort('dispose'); await host.dispose(); }
});
