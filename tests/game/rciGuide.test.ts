/**
 * FH-03 / LG-05 on the top bar (src/ui/topbar/rciGuide.ts, src/ui/TopBar.ts): the RCI segment's "+ zone" badge while a
 * family's demand is above 0.5 and fewer than 12 empty road-facing lots exist (gone once 12 exist, and on a built-out
 * map), its click zoning that family; and the RCI popover's cap hints showing the built-out advice with its buttons.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { Network, Overlay, Zone } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import type { CityState } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { BUILT_OUT_FREE, MONTH_SCAN_DAYS, advisorsSystem, type AdvisorData, type AdvisorsSystem } from '../../src/sim/economy/advisors';
import { emptyFrontTiles, issueButtons, zoneRoom } from '../../src/ui/adviceActions';
import { TopBar } from '../../src/ui/TopBar';
import { ZONE_BADGE_LOTS, builtOut, builtOutIssue, zoneBadge } from '../../src/ui/topbar/rciGuide';
import { newState, place, registerTestDefs, roadLine } from '../infra/cityGen';
import { queryHost } from './queryHost';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const aborts: AbortController[] = [];
afterEach(() => {
  for (const a of aborts.splice(0)) a.abort('dispose');
  vi.restoreAllMocks();
});

/** a 64 × 64 city with the advisors system (plus a stand-in services system) */
function citySim(setup: (st: CityState) => void) {
  const st = newState(64);
  st.systemData.infraVersion = 1;
  st.stats.demand.fill(0);
  st.stats.demandCap.fill(0);
  const rt = new EconRuntime();
  const adv = advisorsSystem(rt) as AdvisorsSystem;
  const sim = new Simulation(st, [{ name: 'services', clustersOf: () => [] } as unknown as SimSystem, adv]);
  setup(st);
  return { st, sim, adv };
}

/** a top bar on `sim` that records what its buttons open; `now` drives the badge's recount clock */
function topBar(sim: Simulation) {
  const calls = { selected: [] as string[], focus: [] as [number, number][], overlay: [] as Overlay[], flyout: [] as string[] };
  const abort = new AbortController();
  aborts.push(abort);
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const ctx = {
    host: queryHost(sim), state: sim.state, sim, signal: abort.signal, ui: new Emitter<UIEvents>(), mods: {}, world: { timeOfDay: 12 },
    overlay: Overlay.None, overlayVariant: -1,
    tools: { activeId: null, select: (id: string) => { calls.selected.push(id); return true; } },
    focusCell: (x: number, z: number) => { calls.focus.push([x, z]); },
    setOverlay: (o: Overlay) => { calls.overlay.push(o); ctx.overlay = o; },
    openFlyout: (id: string) => { calls.flyout.push(id); },
    sound: vi.fn(), toast: vi.fn(), openPauseMenu: vi.fn(),
    panels: { toggle: vi.fn(), open: vi.fn(), get: vi.fn() },
  } as unknown as GameContext;
  const bar = new TopBar(ctx, new FEl('div') as unknown as HTMLElement);
  const el = bar.el as unknown as FEl;
  const badge = el.querySelector('.rci-zone')!;
  const shown = () => badge.style.display !== 'none';
  return { bar, el, badge, shown, calls, tick: (ms: number) => { now += ms; bar.update(); } };
}

/** strong residential demand, `n` empty residential lots along a road (and two behind them, which no road reaches) */
function homes(n: number) {
  return (st: CityState) => {
    roadLine(st, 2, 20, 60, 20, Network.Road);
    for (let x = 3; x < 3 + n; x++) st.zone[st.idx(x, 21)] = Zone.ResLow;
    st.zone[st.idx(3, 22)] = st.zone[st.idx(4, 22)] = Zone.ResLow;
    st.stats.population = 900;
    st.stats.demand[0] = 0.8;
  };
}

describe('the "+ zone" badge model (FH-03)', () => {
  const room = (front: [number, number, number], free = 4000) => ({ front, free });
  it('a family above 0.5 demand with fewer than 12 empty lots; the strongest family is the one a click zones', () => {
    expect(zoneBadge(room([4, 30, 30]), 4096, [0.8, 0.2, 0.2])).toMatchObject({ fams: [0], fam: 0 });
    expect(zoneBadge(room([4, 30, 30]), 4096, [0.8, 0.2, 0.2]).title).toBe('Residential demand is strong, with 4 empty residential lots left. Click to zone homes.');
    expect(zoneBadge(room([ZONE_BADGE_LOTS - 1, 0, 30]), 4096, [0.6, 0.9, 0.2])).toMatchObject({ fams: [0, 1], fam: 1,
      title: 'Residential and commercial demand is strong, with 11 empty residential lots and no empty commercial lots left. Click to zone shops.' });
    // 12 lots, demand at 0.5 or below: no badge
    expect(zoneBadge(room([ZONE_BADGE_LOTS, 30, 30]), 4096, [0.9, 0, 0]).fam).toBe(-1);
    expect(zoneBadge(room([0, 0, 0]), 4096, [0.5, 0.5, 0.5]).fam).toBe(-1);
  });

  it('never on a full map (free land under 1%): zoning more is not possible there', () => {
    expect(builtOut(room([0, 0, 0], 40), 4096)).toBe(true);
    expect(builtOut(room([0, 0, 0], 41), 4096)).toBe(false);
    expect(BUILT_OUT_FREE * 4096).toBeCloseTo(40.96);
    expect(zoneBadge(room([0, 0, 0], 40), 4096, [0.9, 0.9, 0.9])).toEqual({ fams: [], fam: -1, title: '' });
  });

  it('zoneRoom counts what emptyFrontTiles and the advisors\' zone scan count (one pass: front lots and free land)', () => {
    const { st, sim, adv } = citySim(homes(6));
    place(st, 't_r1', 3, 21); // one lot built on
    st.powerLines[st.idx(4, 21)] = 1; // one under a power line
    st.water[st.idx(30, 40)] = 1;
    const r = zoneRoom(st);
    expect(r.front).toEqual([4, 0, 0]);
    expect([0, 1, 2].map((f) => emptyFrontTiles(st, f))).toEqual(r.front);
    for (const d of MONTH_SCAN_DAYS) { st.day = d; adv.daily!(sim); }
    expect(r.free).toBe((st.systemData.advisors as AdvisorData).scan?.zone?.free);
  });
});

describe('TopBar: the RCI segment\'s "+ zone" badge (FH-03)', () => {
  it('shows with 4 empty lots and strong demand, a click selects zone:1; disappears once 12 empty lots exist', () => {
    const { st, sim } = citySim(homes(4));
    const t = topBar(sim);
    t.bar.update();
    expect(t.shown()).toBe(true);
    expect(textOf(t.badge)).toBe('+ zone');
    expect(t.badge.dataset.fam).toBe('R');
    expect(t.badge.title).toBe('Residential demand is strong, with 4 empty residential lots left. Click to zone homes.');
    t.badge.click();
    expect(t.calls.selected).toEqual(['zone:1']);
    // the player zones 8 more lots along the road: 12 — the badge goes at the next recount (at most once a second)
    for (let x = 7; x < 15; x++) st.zone[st.idx(x, 21)] = Zone.ResLow;
    t.tick(100);
    expect(t.shown(), 'recounted at most once a second').toBe(true);
    t.tick(1000);
    expect(t.shown()).toBe(false);
    // one built on: 11 left, the badge is back
    place(st, 't_r1', 7, 21);
    t.tick(1000);
    expect(t.shown()).toBe(true);
    // demand fades: gone
    st.stats.demand[0] = 0.4;
    t.tick(0);
    expect(t.shown()).toBe(false);
  });

  it('industry wants in: the badge zones industry', () => {
    const { st, sim } = citySim((s) => { s.stats.demand[9] = 0.9; });
    const t = topBar(sim);
    t.bar.update();
    expect(t.badge.dataset.fam).toBe('I');
    t.badge.click();
    expect(t.calls.selected).toEqual(['zone:8']);
    expect(st.stats.demand[9]).toBe(0.9);
  });
});

/** no free land (a road on every eighth row, commercial zoning elsewhere, one shop per strip; rows 25-31 the cheapest),
 *  strong commercial demand and a neighbour with 30,000 spare jobs on the east edge */
function builtOutCity(st: CityState) {
  const LV = [0.6, 0.25, 0.7, 0.1, 0.8, 0.3, 0.9, 0.5];
  for (let z = 0; z < 64; z += 8) roadLine(st, 0, z, 63, z, Network.Road);
  for (let k = 0; k < 8; k++) {
    for (let z = 8 * k + 1; z < 8 * k + 8; z++) for (let x = 0; x < 64; x++) {
      st.zone[st.idx(x, z)] = Zone.ComLow;
      st.landValue[st.idx(x, z)] = LV[k];
    }
    place(st, 't_cs', 5, 8 * k + 1, { jobs: 10 });
  }
  st.systemData.region = { neighbors: [{ edge: 'e', tileKey: 'nb', name: 'Fooville', founded: true, population: 100000, jobs: 80000, workers: 50000, r: 0, c: 0, i: 0, from: 0, to: 64 }] };
  st.stats.population = 50000;
  st.stats.demand[3] = 0.8;
}

describe('TopBar: the RCI popover\'s built-out line (LG-05)', () => {
  it('a built-out city: no "+ zone"; the popover shows the advisors\' built-out advice with "Rezone" and "Connect a highway"', () => {
    const { st, sim, adv } = citySim(builtOutCity);
    st.day = 30;
    adv.monthly!(sim);
    const t = topBar(sim);
    t.bar.update();
    expect(t.shown(), 'no "+ zone" on a full map').toBe(false);
    const seg = t.el.querySelector('.rci-seg')!;
    seg.fire('click', { target: seg });
    const hint = t.el.querySelector('.built-out')!;
    expect(textOf(hint)).toContain('The city is built out');
    const issue = builtOutIssue(t.bar['issuesWatch']?.value);
    expect(issue?.text).toMatch(/^Commercial demand is strong, but the city is built out: no free land is left\. Rezone the lowest-value blocks/);
    expect(textOf(hint)).toContain(issue!.text);
    const button = (label: string) => hint.querySelectorAll('button').find((b) => textOf(b) === label)!;
    button('Rezone').click();
    expect(t.calls.focus).toEqual([[32, 28]]);
    expect(t.calls.overlay).toEqual([Overlay.LandValue]);
    expect(t.calls.flyout).toEqual(['zones']);
    expect(t.el.querySelector('.rci-pop')!.classList.contains('open'), 'the popover closes for the view').toBe(false);
    seg.fire('click', { target: seg });
    t.el.querySelector('.built-out')!.querySelectorAll('button').find((b) => textOf(b) === 'Connect a highway')!.click();
    expect(t.calls.focus).toEqual([[32, 28], [63, 32]]);
    expect(t.calls.selected).toEqual(['net:5']);
  });

  it('room left: no built-out line, only the cap hints', () => {
    const { sim, adv } = citySim(homes(4));
    sim.state.day = 30;
    adv.monthly!(sim);
    const t = topBar(sim);
    const seg = t.el.querySelector('.rci-seg')!;
    seg.fire('click', { target: seg });
    expect(t.el.querySelector('.built-out')).toBeNull();
  });
});

describe('the "+ zone" badge on the replica (LoopbackSimHost)', () => {
  it('reads the mirrored zone, road and building layers; a zoning command reaches it', async () => {
    const st = newState(64);
    st.funds = 1e6;
    homes(4)(st);
    const abort = new AbortController();
    const host = new LoopbackSimHost(st, { initialSpeed: 0, signal: abort.signal, loopback: { cadence: 'design' } });
    await host.start();
    try {
      await host.drain();
      const replica = host.state;
      expect(replica).not.toBe(host.harness.primary);
      replica.stats.demand.fill(0);
      replica.stats.demand[0] = 0.8;
      let now = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      const selected: string[] = [];
      const ctx = {
        host, state: replica, sim: host.sim, signal: abort.signal, ui: new Emitter<UIEvents>(), mods: {}, world: { timeOfDay: 12 },
        overlay: Overlay.None, overlayVariant: -1, tools: { activeId: null, select: (id: string) => { selected.push(id); return true; } },
        focusCell: vi.fn(), setOverlay: vi.fn(), sound: vi.fn(), toast: vi.fn(), openPauseMenu: vi.fn(), openFlyout: vi.fn(), panels: { toggle: vi.fn(), open: vi.fn() },
      } as unknown as GameContext;
      const bar = new TopBar(ctx, new FEl('div') as unknown as HTMLElement);
      bar.update();
      const badge = (bar.el as unknown as FEl).querySelector('.rci-zone')!;
      expect(badge.style.display).toBe('');
      expect(badge.title).toContain('4 empty residential lots left');
      badge.click();
      expect(selected).toEqual(['zone:1']);
      // the player zones 10 more lots along the road: a command to the core, mirrored back
      host.actions.zone({ x0: 7, z0: 21, x1: 17, z1: 22 }, Zone.ResLow);
      await host.drain();
      replica.stats.demand[0] = 0.8;
      now += 1000;
      bar.update();
      expect(badge.style.display, '14 empty lots on the replica').toBe('none');
    } finally { abort.abort('dispose'); await host.dispose(); }
  }, 60000);
});

describe('the advisors\' buttons on the replica (LoopbackSimHost, NOTE-048: src/worker additions tested on a packet host)', () => {
  it('advisorIssues carries a built-out card\'s options and a zone-rule variant\'s ref through the packet seam', async () => {
    registerTestDefs();
    const st = newState(64);
    st.systemData.infraVersion = 1;
    builtOutCity(st);
    // every road-facing shop lot taken (growth counts the room from the map: EconRuntime.emptyFront) …
    for (let k = 0; k < 7; k++) for (const z of [8 * k + 1, 8 * k + 7]) for (let x = 0; x < 64; x++) {
      if (st.building[st.idx(x, z)] < 0) place(st, 't_cs', x, z, { jobs: 10 });
    }
    // … and the last strip homes no road reaches, cut off from the shops by a lake row (not free land either)
    for (let x = 0; x < 64; x++) {
      const i = st.idx(x, 56);
      st.network[i] = Network.None;
      st.water[i] = 1;
      for (let z = 57; z < 64; z++) st.zone[st.idx(x, z)] = Zone.ResLow;
    }
    expect(zoneRoom(st)).toEqual({ front: [0, 0, 0], free: 0 });
    const abort = new AbortController();
    const host = new LoopbackSimHost(st, { initialSpeed: 0, signal: abort.signal, loopback: { cadence: 'design' } });
    await host.start();
    try {
      await host.drain();
      // the month tick on the core (no day runs: the demand stays as set)
      const core = host.harness.core.sim;
      core.state.stats.demand.fill(0);
      core.state.stats.demand[0] = 0.8;
      core.state.stats.demand[3] = 0.8;
      core.getSystem<AdvisorsSystem>('economy.advisors')!.monthly!(core);
      const pending = host.query('advisorIssues', {});
      await host.drain();
      const rows = await pending;
      const card = rows.find((a) => a.id === 'builtOut')!;
      expect(card.text).toMatch(/^Commercial demand is strong, but the city is built out: no free land is left\. Rezone the lowest-value blocks/);
      expect(card.options?.map((o) => o.id)).toEqual(['rezone', 'connect']);
      expect(card.options?.[1]).toEqual({ id: 'connect', x: 63, z: 32 });
      expect(card).toMatchObject({ ref: 'rezone', x: card.options![0].x, z: card.options![0].z });
      expect(issueButtons(card).map((b) => [b.action.label, b.at])).toEqual([['Rezone', { x: card.options![0].x, z: card.options![0].z }], ['Connect a highway', { x: 63, z: 32 }]]);
      // the homes have no room, but a road would open 448 tiles: not built out — zoneR's "Build roads" variant
      const homes = rows.find((a) => a.id === 'zoneR')!;
      expect(homes.text).toMatch(/^Residential demand is strong, but 448 residential tiles have no road access/);
      expect(homes.ref).toBe('noRoadAccess');
      expect(issueButtons(homes).map((b) => b.action.label)).toEqual(['Build roads']);
      // (copies: the core's own rows are not handed out)
      card.options![0].x = -1;
      const again = host.query('advisorIssues', {});
      await host.drain();
      expect((await again).find((a) => a.id === 'builtOut')!.options![0].x).not.toBe(-1);
    } finally { abort.abort('dispose'); await host.dispose(); }
  }, 60000);
});
