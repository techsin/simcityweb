/**
 * LG-02 QA round 2 (real-GPU findings B2, B4, B5, B13), the texts a player reads before and while placing:
 *  - B2: the Central Library, the Botanical Dome and (same code path) the Observatory stated their flat catalog upkeep
 *    on the build card, in the Rewards panel and in the plop tip, while the budget also charges the people they serve
 *    at the tier's rate. upkeepEstimate now gives them the running-cost facilities' estimate — "≈§A/mo typical in
 *    this city · up to §B at full use" — and the card notes the formula; the plop tip's budget line counts it.
 *  - B4: placing Grand Central switched the Prestige view on and its tip's two facts were prestige and tourists: the
 *    Transit view, and its transit coverage and connections.
 *  - B5: the Stock Exchange's card read "C +55,000" (CO$$$ +40,000 lumped in) and had no office-tax row; the Crown's
 *    card had no approval row.
 *  - B13: "Income: §2,500 / month when busy" — the catalog income is the income at the venue's reference visits, and
 *    budget.ts pays up to 1.31 times it. The same claim stood in the plop tip's budget line ("before its income (up to
 *    §2,500 when busy)") and in the Rewards panel's income chip ("Income when busy"): all three say typical use now.
 * (The inspector's lines are in tests/sim/lg02StatedCost.test.ts and tests/infra/lg02Inspector.test.ts.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Network, Overlay } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import { CityActions } from '../../src/sim/actions';
import { getDef } from '../../src/sim/catalog';
import { Simulation } from '../../src/sim/Simulation';
import { VENUE_INCOME } from '../../src/sim/economy/tuning';
import { listRewards } from '../../src/sim/economy/rewards';
import type { GameContext } from '../../src/game/context';
import { normalizeReward } from '../../src/game/modules';
import { findToolSpec, type ToolSpec } from '../../src/game/toolCatalog';
import type { ToolPointer } from '../../src/game/tools/Tool';
import { PlopTool, autoOverlayOf } from '../../src/game/tools/PlopTool';
import { Toolbar } from '../../src/ui/Toolbar';
import { RewardsPanel } from '../../src/ui/panels/ListPanels';
import { upkeepEstimate } from '../../src/ui/upkeepModel';
import { newState, place, roadLine } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';
import { queryHost } from './queryHost';

installFakeDom();
// (the tooltip is placed next to its card: a zero rect is enough here)
const proto = FEl.prototype as unknown as { getBoundingClientRect?: () => DOMRect };
let hadRect: typeof proto.getBoundingClientRect;
beforeAll(() => {
  hadRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
});
afterAll(() => {
  proto.getBoundingClientRect = hadRect;
});

const LATE = ['lm_central_library', 'lm_grand_central', 'lm_stock_exchange', 'lm_botanical_dome', 'lm_world_trade_center', 'lm_millennium_tower', 'lm_metropolis_crown'];
const library = getDef('lm_central_library')!, dome = getDef('lm_botanical_dome')!, observatory = getDef('lm_observatory')!;

/**
 * a city that charges running costs, every landmark unlocked, a road along z = 20; `charged`: it runs a Public Library
 * and a Small Park (so the budget charges the college and green tiers), with 1,000 would-be students unserved. Either
 * way it has a Zoo and a Research Center, which serve those tiers without making the city charge them (no running-cost
 * facilities: budget.ts opexTiers)
 */
function city(charged: boolean): CityState {
  const st = newState(64);
  st.systemData.infraVersion = 1;
  st.funds = 1e9;
  roadLine(st, 2, 20, 61, 20, Network.Road);
  for (const id of [...LATE, 'lm_observatory', 'lm_twin_spires', 'lm_spire_tower']) st.unlocked.add(getDef(id)!.requires!);
  place(st, 'park_zoo', 12, 30, { flags: BF.Plopped });
  place(st, 'rw_research_center', 24, 30, { flags: BF.Plopped });
  if (charged) {
    place(st, 'civ_library', 4, 30, { flags: BF.Plopped });
    place(st, 'park_small', 8, 30, { flags: BF.Plopped });
  }
  const needs = st.stats.needs as unknown as Record<string, { need: number; served: number }>;
  needs.college = { ...needs.college, need: 9000, served: 8000 };
  needs.green = { ...needs.green, need: 900000, served: 100000 };
  return st;
}

describe('LG-02 QA B2: one honest upkeep estimate for a landmark with a service tier', () => {
  it('Central Library, Botanical Dome, Observatory: typical in this city, up to full use, and the formula', () => {
    const st = city(true);
    // 1,000 unserved students: a quarter of a typical load (0.25 × 0.7 × 20,000 learners) at §0.60
    expect(upkeepEstimate(st, library)).toEqual({
      now: 1600 + 3500 * 0.6, full: 1600 + 20000 * 0.6,
      title: '≈§3,700/mo typical in this city · up to §13,600 at full use', formula: '§1,600 / month + §0.60 per learner served',
    });
    // a big unserved need: a typical load (0.7 × 80,000 visitors) at §0.015
    const d = upkeepEstimate(st, dome)!;
    expect(d.title).toBe('≈§2,640/mo typical in this city · up to §3,000 at full use');
    expect(d.formula).toBe('§1,800 / month + §0.015 per visitor served');
    // the Observatory (5,000 learners): the 1,000 unserved students, above a quarter of its typical load
    const o = upkeepEstimate(st, observatory)!;
    expect(o.title).toBe('≈§750/mo typical in this city · up to §3,150 at full use');
    expect(o.formula).toBe('§150 / month + §0.60 per learner served');
    // the stated range holds what QA measured: §6,197 booked for the Library (7,662 learners), §13,600 at 20,000
    expect(1600 + 7662 * 0.6).toBeLessThanOrEqual(upkeepEstimate(st, library)!.full);
  });
  it('the flat catalog upkeep where it is the truth: a city that does not charge the tier, an economy-only city, every other landmark', () => {
    const st = city(false);
    for (const def of [library, dome, observatory]) expect(upkeepEstimate(st, def), def.id).toBeNull();
    const charged = city(true);
    for (const id of ['lm_grand_central', 'lm_stock_exchange', 'lm_world_trade_center', 'lm_millennium_tower', 'lm_metropolis_crown', 'lm_twin_spires', 'park_zoo', 'rw_research_center']) {
      expect(upkeepEstimate(charged, getDef(id)), id).toBeNull();
    }
    delete charged.systemData.infraVersion;
    expect(upkeepEstimate(charged, library)).toBeNull();
    // (a static listing without a city: the typical load)
    expect(upkeepEstimate(null, library)!.title).toBe('≈§10,000/mo typical in this city · up to §13,600 at full use');
  });
});

/** the build card tooltips of a city, rendered by the real Toolbar on the fake DOM */
function cards(st: CityState) {
  const sim = new Simulation(st, []);
  const ctx = {
    get state() { return sim.state; },
    sim,
    host: { events: sim.events, commandCount: 0 },
    signal: new AbortController().signal,
    ui: { on: () => () => undefined },
    tools: { activeId: null, select: () => true },
    panels: { isOpen: () => false },
    overlay: 0,
    sandbox: () => false,
    sound: () => undefined,
  } as unknown as GameContext;
  const parent = document.createElement('div') as unknown as HTMLElement;
  const bar = new Toolbar(ctx, parent);
  const tip = (parent as unknown as FEl).children.find((e) => e.classList.contains('rich-tip'))!;
  return (defId: string): string => {
    const spec = findToolSpec(ctx, 'plop:' + defId)!;
    expect(spec, defId).toBeTruthy();
    (bar as unknown as { showSpecTip(s: ToolSpec, a: HTMLElement): void }).showSpecTip(spec, document.createElement('div') as unknown as HTMLElement);
    return textOf(tip);
  };
}

describe('LG-02 QA B2 / B5 / B13: the build cards', () => {
  it('B2: the Library\'s card states the estimate and the formula, and its budget row counts it; flat where the tier is not charged', () => {
    const st = city(true);
    st.budget.lastIncome = { 'tax:R$': 20000 };
    st.budget.lastExpense = { 'service:education': 5000 };
    const card = cards(st);
    let t = card('lm_central_library');
    expect(t).toContain('Upkeep≈§3,700/mo typical in this city · up to §13,600 at full use');
    expect(t).toContain('Upkeep: §1,600 / month + §0.60 per learner served');
    expect(t).not.toContain('Upkeep§1,600 / month');
    // (FH-05's row: last month's net, then after the upkeep the card quotes — §3,700, not the flat §1,600)
    expect(t).toContain('Monthly budget+§15,000 → +§11,300 after this');
    t = card('lm_botanical_dome');
    expect(t).toContain('Upkeep≈§2,640/mo typical in this city · up to §3,000 at full use');
    expect(t).toContain('Upkeep: §1,800 / month + §0.015 per visitor served');
    expect(card('lm_observatory')).toContain('up to §3,150 at full use');
    // a landmark without a service tier keeps its flat row
    expect(card('lm_metropolis_crown')).toContain('Upkeep§4,500 / month');
    // a city that runs no college-level facility: the Library's learners are not charged — the flat upkeep is the truth
    const flat = cards(city(false))('lm_central_library');
    expect(flat).toContain('Upkeep§1,600 / month');
    expect(flat).not.toContain('typical in this city');
  });

  it('B5: the Stock Exchange names its CO$$$ cap apart and its office tax; the Crown its approval; base cards keep one commercial figure', () => {
    const card = cards(city(true));
    let t = card('lm_stock_exchange');
    expect(t).toContain('Demand capC +15,000 · CO$$$ +40,000');
    expect(t).not.toContain('C +55,000');
    expect(t).toContain('Office tax+5% (CO$$ and CO$$$ receipts)');
    t = card('lm_metropolis_crown');
    expect(t).toContain('Approval+3 (civic pride)');
    expect(t).toContain('Demand capR +60,000 · C +80,000');
    // (the base's Twin Spires: C 80,000 + CO$$$ 20,000 stay one figure)
    expect(card('lm_twin_spires')).toContain('Demand capR +40,000 · C +100,000');
    for (const id of ['lm_central_library', 'lm_grand_central', 'lm_twin_spires']) {
      expect(card(id), id).not.toContain('Office tax');
      expect(card(id), id).not.toContain('civic pride');
    }
  });

  it('B13: the Millennium Tower\'s income note is its income at typical use, not its most — as budget.ts computes it', () => {
    const t = cards(city(true))('lm_millennium_tower');
    expect(t).toContain('Income: about §2,500 / month at typical use — more when it is busy, less while it is quiet (its inspector shows what it earns now)');
    expect(t).not.toContain('when busy —');
    // budget.ts venueIncomeFactor = (base + use × min(useMax, visits / draw)) × clamp(A / 60, 0.5, 1.5)^aExp: the catalog
    // income at the reference draw and attractiveness, 1.31 times it at most (QA: §2,788 booked for "§2,500 when busy"),
    // 0.28 times it in an empty, unattractive month
    expect(VENUE_INCOME.base + VENUE_INCOME.use).toBeCloseTo(1, 9);
    const most = (VENUE_INCOME.base + VENUE_INCOME.use * VENUE_INCOME.useMax) * Math.pow(1.5, VENUE_INCOME.aExp);
    expect(most).toBeGreaterThan(2788 / 2500);
    expect(most).toBeCloseTo(1.3129, 3);
    expect(VENUE_INCOME.base * Math.pow(0.5, VENUE_INCOME.aExp)).toBeLessThan(0.3);
    // (the same note on every venue card: they share the sentence and the formula)
    expect(cards(city(true))('lm_spire_tower')).toContain('Income: about §800 / month at typical use — more when it is busy, less while it is quiet');
  });
});

function fakeCtx(sim: Simulation) {
  const tips: { html: string; kind?: string }[] = [];
  const ctx = {
    state: sim.state,
    sim,
    host: queryHost(sim),
    signal: new AbortController().signal,
    actions: new CityActions(sim),
    world: { setHighlight: () => {}, setHighlightRect: () => {} },
    objects: { setGhost: () => {}, setNetworkPreview: () => {} },
    tip: { show: (html: string, kind?: string) => tips.push({ html, kind }), hide: () => {}, move: () => {} },
    sandbox: () => false,
    sound: () => {},
    toast: () => {},
    tools: { active: null, refresh: () => {}, select: () => true },
    preferOverlayVariant: () => {},
  } as unknown as GameContext;
  return { ctx, last: () => tips[tips.length - 1].html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() };
}
/** a pointer over the centre of the lot whose origin is cell (x, z) for a w × d footprint */
function at(x: number, z: number, w: number, d: number): ToolPointer {
  return { clientX: 0, clientY: 0, hit: { x, z, point: { x: (x + w / 2) * 16, y: 5, z: (z + d / 2) * 16 } } as unknown as ToolPointer['hit'], shift: false, ctrl: false, alt: false, down: false };
}

describe('LG-02 QA B2 / B4: the plop tool', () => {
  it('B2: the Library\'s cursor tip quotes the estimate, and its Monthly budget line counts it', async () => {
    const st = city(true);
    st.budget.lastIncome = { 'tax:R$': 20000 };
    st.budget.lastExpense = { 'service:education': 5000 };
    const f = fakeCtx(new Simulation(st, []));
    const tool = new PlopTool(f.ctx, library, 'landmark');
    Object.assign(f.ctx.tools, { active: tool });
    tool.activate();
    tool.move(at(30, 21, 3, 3));
    await Promise.resolve();
    const t = f.last();
    expect(t).toContain('Upkeep ≈§3,700/mo now · up to §13,600 at full use');
    expect(t).not.toContain('Upkeep §1,600/mo');
    expect(t).toContain('Monthly budget: +§15,000 → +§11,300 after this');
    tool.deactivate();
    // not charged: the flat upkeep and its budget line, as before
    const g = fakeCtx(new Simulation(Object.assign(city(false), { budget: st.budget }), []));
    const flat = new PlopTool(g.ctx, library, 'landmark');
    Object.assign(g.ctx.tools, { active: flat });
    flat.activate();
    flat.move(at(30, 21, 3, 3));
    await Promise.resolve();
    expect(g.last()).toContain('Upkeep §1,600/mo');
    expect(g.last()).toContain('Monthly budget: +§15,000 → +§13,400 after this');
  });

  it('B13: the Millennium Tower\'s cursor tip names its income at typical use, not "up to … when busy"', () => {
    const st = city(true);
    st.budget.lastIncome = { 'tax:R$': 20000 };
    st.budget.lastExpense = { 'service:education': 5000 };
    const f = fakeCtx(new Simulation(st, []));
    const tool = new PlopTool(f.ctx, getDef('lm_millennium_tower')!, 'landmark');
    Object.assign(f.ctx.tools, { active: tool });
    tool.activate();
    tool.move(at(30, 21, 4, 4));
    // (its flat §4,000 counted; the income named, not counted: it follows the visitors)
    expect(f.last()).toContain('Monthly budget: +§15,000 → +§11,000 after this, before its income (about §2,500 at typical use)');
    expect(f.last()).not.toContain('when busy');
    tool.deactivate();
  });

  it('B4: Grand Central switches the Transit view on, and its two facts are its coverage and connections', () => {
    expect(autoOverlayOf(getDef('lm_grand_central')!)).toEqual({ o: Overlay.Transit, v: -1 });
    // the other six keep their views: the Library's college tier, the Dome's green tier, prestige for the rest
    expect(autoOverlayOf(library)).toEqual({ o: Overlay.Education, v: 3 });
    expect(autoOverlayOf(dome)).toEqual({ o: Overlay.Parks, v: 2 });
    for (const id of ['lm_stock_exchange', 'lm_world_trade_center', 'lm_millennium_tower', 'lm_metropolis_crown', 'lm_twin_spires']) {
      expect(autoOverlayOf(getDef(id)!), id).toEqual({ o: Overlay.Nimby, v: -1 });
    }
    // (the stations and the depot it stands in for, unchanged)
    for (const id of ['tr_train_station', 'tr_subway_station', 'tr_bus_stop', 'civ_bus_depot']) expect(autoOverlayOf(getDef(id)!), id).toEqual({ o: Overlay.Transit, v: -1 });
    expect(autoOverlayOf(getDef('tr_parking_garage')!)).toEqual({ o: Overlay.Parking, v: -1 });

    const f = fakeCtx(new Simulation(city(true), []));
    const hub = new PlopTool(f.ctx, getDef('lm_grand_central')!, 'landmark');
    Object.assign(f.ctx.tools, { active: hub });
    hub.activate();
    hub.move(at(30, 21, 4, 3));
    let t = f.last();
    expect(t).toContain('Transit coverage 18 tiles · Connections train, subway and bus hub');
    expect(t).not.toContain('Prestige');
    expect(t).not.toContain('Tourists');
    hub.deactivate();
    // another landmark keeps its first two facts
    const crown = new PlopTool(f.ctx, getDef('lm_metropolis_crown')!, 'landmark');
    Object.assign(f.ctx.tools, { active: crown });
    crown.activate();
    crown.move(at(30, 21, 4, 4));
    t = f.last();
    expect(t).toContain('Prestige 0.7 within 28 tiles · Tourists up to 32,000 a day');
    crown.deactivate();
  });
});

/** the Rewards panel of a city, rendered by the real panel on the fake DOM: the chips of the row named `name` */
function rewardChips(st: CityState) {
  const sim = new Simulation(st, []);
  const ctx = {
    get state() { return sim.state; },
    sim,
    host: queryHost(sim),
    signal: new AbortController().signal,
    mods: { listRewards: (s: CityState) => listRewards(s).map(normalizeReward) },
    objects: { setSelected: () => undefined },
    panels: { close: () => undefined, open: () => undefined },
    tools: { select: () => true },
    focusCell: () => undefined,
    showQuery: () => undefined,
    sandbox: () => false,
    sound: () => undefined,
    toast: () => undefined,
  } as unknown as GameContext;
  const panel = new RewardsPanel(ctx);
  panel.mount(() => undefined, () => undefined, () => undefined);
  panel.onOpen();
  panel.update();
  return (name: string): FEl[] => {
    const row = (panel.body as unknown as FEl).querySelectorAll('div.li').find((r) => textOf(r.querySelector('div.li-t')!) === name);
    expect(row, `row ${name}`).toBeDefined();
    return row!.querySelectorAll('span.chip');
  };
}

describe('LG-02 QA B2 / B13: the Rewards panel, where the late landmarks are placed from', () => {
  /** a row's upkeep chip ("≈§3,700/mo typical", "§4,500/mo") and its income chip ("+§2,500/mo") */
  const upkeep = (chips: FEl[]) => chips.find((c) => /\/mo/.test(textOf(c)) && !/^\+/.test(textOf(c)))!;
  const income = (chips: FEl[]) => chips.find((c) => /^\+§/.test(textOf(c)))!;

  it('B2: the upkeep chip of a landmark with a service tier is the build card\'s estimate; flat where the tier is not charged', () => {
    const chips = rewardChips(city(true));
    expect(textOf(upkeep(chips('Central Library')))).toBe('≈§3,700/mo typical');
    expect(upkeep(chips('Central Library')).title).toBe('Upkeep ≈§3,700/mo typical in this city · up to §13,600 at full use');
    expect(textOf(upkeep(chips('Botanical Dome')))).toBe('≈§2,640/mo typical');
    expect(textOf(upkeep(chips('Observatory')))).toBe('≈§750/mo typical');
    // a landmark without a service tier keeps its flat chip
    expect(textOf(upkeep(chips('Metropolis Crown')))).toBe('§4,500/mo');
    expect(textOf(upkeep(rewardChips(city(false))('Central Library')))).toBe('§1,600/mo');
  });

  it('B13: a venue\'s income chip says typical use — the catalog figure is not its most', () => {
    const chip = income(rewardChips(city(true))('Millennium Tower'));
    expect(textOf(chip)).toBe('+§2,500/mo');
    expect(chip.title).toBe('Income at typical use — more when it is busy, less while it is quiet (its inspector shows what it earns now)');
  });
});
