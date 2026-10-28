/**
 * FH-05 (polish round 1, GUIDE): what a building does to the monthly budget, shown before it is placed. At 1,574
 * residents a Fire Station read ≈§539/mo while the town made +§259/mo, and players overbuilt services without knowing it
 * (shots2/024, shots2/078). The plop tip and the build card now say "Monthly budget: +§259 → −§280 after this":
 *  - budgetEffect (Tool.ts): before = last month's recurring net, the top bar's (one-offs left out); after = before −
 *    the upkeep the tip quotes + a business deal's income; red below zero with the months of reserves, never more than
 *    60; no line before the first report, in a sandbox, or for a building that changes nothing;
 *  - the plop tip: the line under the upkeep line, at the spot's "Upkeep here" once its query lands; none on a spot it
 *    cannot be placed;
 *  - the build card: a "Monthly budget" row at the city-wide estimate; none on a card that does not select;
 *  - the acceptance town: 1,500 residents with growth frozen. Hovering a Fire Station shows before → after, and one
 *    month after placing it, its expense line and the change in net are within ±15 % of the prediction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import { CityActions } from '../../src/sim/actions';
import { getDef } from '../../src/sim/catalog';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import type { GameContext } from '../../src/game/context';
import { UNIQUE_BUILT_TEXT, findToolSpec, type ToolSpec } from '../../src/game/toolCatalog';
import { budgetEffect, reservesText, type ToolPointer } from '../../src/game/tools/Tool';
import { PlopTool } from '../../src/game/tools/PlopTool';
import { money, moneySigned } from '../../src/ui/format';
import { Toolbar } from '../../src/ui/Toolbar';
import { upkeepEstimate } from '../../src/ui/upkeepModel';
import { runQuery } from '../../src/worker/queries';
import { newSim, newState, place, roadLine, setRoad } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';
import { queryHost } from './queryHost';

installFakeDom();
// (the card's tooltip is placed next to its card: a zero rect is enough here)
const proto = FEl.prototype as unknown as { getBoundingClientRect?: () => DOMRect };
let hadRect: typeof proto.getBoundingClientRect;
beforeAll(() => {
  hadRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
});
afterAll(() => {
  proto.getBoundingClientRect = hadRect;
});

const fire = getDef('civ_fire_station')!;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/** last month: +§259 of recurring net (900 − 641), one-offs on both sides (never counted); §2,042 in the bank */
function report(st: CityState): CityState {
  st.budget.lastIncome = { 'tax:R$': 600, 'tax:CS$': 300, 'oneoff:loan': 10000, 'oneoff:refund': 250 };
  st.budget.lastExpense = { 'service:utilities': 400, 'transport:roads': 241, 'oneoff:construction': 1400, 'oneoff:zoning': 90 };
  st.funds = 2042;
  return st;
}

/** last month's recurring net, as the top bar counts it */
function net(st: CityState): number {
  let n = 0;
  for (const k in st.budget.lastIncome) if (!k.startsWith('oneoff:')) n += st.budget.lastIncome[k];
  for (const k in st.budget.lastExpense) if (!k.startsWith('oneoff:')) n -= st.budget.lastExpense[k];
  return n;
}

function fakeCtx(sim: Simulation, sandbox = false) {
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
    sandbox: () => sandbox,
    sound: () => {},
    toast: () => {},
    tools: { active: null, refresh: () => {}, select: () => true },
    preferOverlayVariant: () => {},
  } as unknown as GameContext;
  return { ctx, last: () => tips[tips.length - 1] };
}

/** a pointer over cell (x, z) (point: the cell centre, or `px`, `pz` in cells — a 2×2 lot's centre is its far corner) */
function at(x: number, z: number, px = x + 0.5, pz = z + 0.5): ToolPointer {
  return { clientX: 0, clientY: 0, hit: { x, z, point: { x: px * 16, y: 5, z: pz * 16 } } as unknown as ToolPointer['hit'], shift: false, ctrl: false, alt: false, down: false };
}

/** a plop tool for `def`, active in its context */
function plopTool(ctx: GameContext, def = fire): PlopTool {
  const tool = new PlopTool(ctx, def, 'x');
  Object.assign(ctx.tools, { active: tool });
  tool.activate();
  return tool;
}

describe('budgetEffect: last month\'s net → after this (FH-05)', () => {
  it('the plan\'s town: +§259 a month and a §539 Fire Station read "+§259 → −§280 after this", red, with the months of reserves', () => {
    expect(budgetEffect(report(newState(32)), fire, 539)).toEqual({ before: 259, after: -280, text: '+§259 → −§280 after this', reserves: '≈ 7 months of reserves', bad: true });
  });

  it('a surplus that stays positive: the plain line, no reserves', () => {
    expect(budgetEffect(report(newState(32)), fire, 100)).toEqual({ before: 259, after: 159, text: '+§259 → +§159 after this', reserves: '', bad: false });
  });

  it('one-offs never count: construction, zoning, demolition, terraform, loan money and refunds', () => {
    const st = report(newState(32));
    Object.assign(st.budget.lastIncome, { 'oneoff:loan': 1e6 });
    Object.assign(st.budget.lastExpense, { 'oneoff:demolition': 5000, 'oneoff:terraform': 800, 'oneoff:loanRepay': 20000 });
    expect(budgetEffect(st, fire, 100)!.before).toBe(259);
    // a first month of nothing but one-offs: a report with a net of zero (the top bar's "±§0/mo")
    st.budget.lastIncome = {};
    st.budget.lastExpense = { 'oneoff:construction': 1400 };
    expect(budgetEffect(st, fire, 539)!.text).toBe('±§0 → −§539 after this');
  });

  it('no line before the first report, in a sandbox, or for a building that changes nothing', () => {
    const st = newState(32);
    st.funds = 2042;
    // (a city's first month: the top bar's "No report yet")
    expect(budgetEffect(st, fire, 539)).toBeNull();
    report(st);
    expect(budgetEffect(st, fire, 539, true)).toBeNull();
    expect(budgetEffect(st, fire, 0)).toBeNull();
    expect(budgetEffect(st, fire, 0.4)).toBeNull();
    expect(budgetEffect(st, fire, 539)).not.toBeNull();
  });

  it('a business deal\'s income counts (it pays as it is); a venue\'s or an airport\'s follows its visitors, so it is named, not counted', () => {
    const st = report(newState(32));
    const line = (id: string) => { const d = getDef(id)!; return budgetEffect(st, d, d.upkeep ?? 0); };
    expect(line('rw_casino')).toMatchObject({ text: '+§259 → +§2,859 after this', bad: false });
    expect(line('rw_military_base')).toMatchObject({ text: '+§259 → +§1,759 after this', bad: false });
    expect(line('park_stadium')).toEqual({ before: 259, after: -1541, text: '+§259 → −§1,541 after this, before its income (up to §1,500 when busy)', reserves: '≈ 1 month of reserves', bad: true });
    expect(line('tr_airport_small')).toMatchObject({ text: '+§259 → −§541 after this, before its income (up to §600 when busy)', reserves: '≈ 3 months of reserves' });
    // the build card leaves the note out: its Income row already says it
    const stadium = getDef('park_stadium')!;
    expect(budgetEffect(st, stadium, stadium.upkeep ?? 0, false, { venueNote: false })?.text).toBe('+§259 → −§1,541 after this');
  });

  it('the months of reserves: none left, under a month, one month — and never more than 60', () => {
    expect(reservesText(0, 100)).toBe('no reserves left');
    expect(reservesText(-500, 100)).toBe('no reserves left');
    expect(reservesText(99, 100)).toBe('less than a month of reserves');
    expect(reservesText(100, 100)).toBe('≈ 1 month of reserves');
    expect(reservesText(6000, 100)).toBe('≈ 60 months of reserves');
    expect(reservesText(6001, 100)).toBe('more than 5 years of reserves');
    // (acceptance: the months-left text never exceeds 60 months)
    let counted = 0;
    for (let funds = 1; funds < 2e8; funds = Math.ceil(funds * 1.37)) {
      for (let loss = 1; loss < 3e5; loss = Math.ceil(loss * 1.61)) {
        const t = reservesText(funds, loss), m = /^≈ (\d+) months? of reserves$/.exec(t);
        if (m) { counted++; expect(Number(m[1]), t).toBeLessThanOrEqual(60); }
        else expect(['no reserves left', 'less than a month of reserves', 'more than 5 years of reserves']).toContain(t);
      }
    }
    expect(counted).toBeGreaterThan(50);
    // and through a whole line: a rich city losing a little
    const st = report(newState(32));
    st.funds = 1e7;
    expect(budgetEffect(st, fire, 539)!.reserves).toBe('more than 5 years of reserves');
  });
});

describe('the plop tip (FH-05)', () => {
  /** the plant (2×2 at 2,10) — a road tile (4,10) — a street x = 5 (z 4..20) — five homes at x = 6 (z 12..16); last
   *  month's report: +§259 */
  function town() {
    const st = newState(32);
    place(st, 't_coal', 2, 10, { flags: BF.Plopped });
    setRoad(st, 4, 10);
    roadLine(st, 5, 4, 5, 20, Network.Road);
    place(st, 't_pump', 6, 6, { flags: BF.Plopped });
    for (let z = 12; z <= 16; z++) {
      st.zone[st.idx(6, z)] = Zone.ResMed;
      place(st, 't_r2', 6, z, { pop: 20 });
    }
    report(st);
    return { st, sim: newSim(st) };
  }
  /** the Fire Station's lot (3, 17)-(4, 18): west of the street, a short drive from the homes */
  const lot = () => at(3, 17, 4, 18);

  it('a Fire Station beside the homes: the line under the upkeep line, at the city-wide figure until the spot\'s lands; red with the reserves once it goes negative', async () => {
    const { st, sim } = town();
    const f = fakeCtx(sim);
    const tool = plopTool(f.ctx);
    tool.move(lot());
    // (before the spot's query lands the tip quotes the city-wide figure, and so does the line)
    const est = upkeepEstimate(st, fire)!.now;
    expect(text(f.last().html)).toContain(`Upkeep ≈${money(est)}/mo now`);
    expect(text(f.last().html)).toContain(`Monthly budget: +§259 → ${moneySigned(259 - est)} after this`);
    await Promise.resolve();
    const here = runQuery(sim, 'upkeepContext', { defId: fire.id, x: 3, z: 17, w: 2, d: 2 }).here!;
    expect(Math.abs(here - est)).toBeGreaterThan(20);
    let html = f.last().html;
    expect(text(html)).toContain(`Upkeep here ≈${money(here)}/mo now`);
    expect(text(html)).toContain(`Monthly budget: +§259 → ${moneySigned(259 - here)} after this`);
    expect(text(html)).not.toContain('reserves');
    // (a dim line under the upkeep line while the budget stays positive)
    expect(html).toContain('<div class="tip-sub">Monthly budget: ');
    expect(html.indexOf('Upkeep here')).toBeLessThan(html.indexOf('Monthly budget'));
    expect(f.last().kind).toBe('ok');
    // a town that only just breaks even (+§10): below zero after it — red, with how long §2,042 last
    st.budget.lastIncome['tax:R$'] -= 249;
    tool.move(lot());
    html = f.last().html;
    const after = 10 - here;
    expect(after).toBeLessThan(0);
    expect(text(html)).toContain(`Monthly budget: +§10 → ${moneySigned(after)} after this · ≈ ${Math.floor(2042 / -after)} months of reserves`);
    expect(html).toContain('<div class="tip-reason">Monthly budget: ');
    expect(f.last().kind).toBe('ok'); // a warning, not a block
    tool.deactivate();
  });

  it('a flat-upkeep building counts its catalog upkeep; no line on a spot it cannot be placed, before the first report or in a sandbox', async () => {
    const { st, sim } = town();
    const f = fakeCtx(sim);
    const pump = plopTool(f.ctx, getDef('util_water_pump')!);
    pump.move(at(6, 18));
    expect(text(f.last().html)).toContain('Upkeep §25/mo');
    expect(text(f.last().html)).toContain('Monthly budget: +§259 → +§234 after this');
    pump.deactivate();
    const tool = plopTool(f.ctx);
    // on the street and the homes: blocked
    tool.move(at(5, 14, 6, 15));
    expect(f.last().kind).toBe('bad');
    expect(text(f.last().html)).not.toContain('Monthly budget');
    // the free lot, before the first report: the upkeep, no line
    st.budget.lastIncome = {};
    st.budget.lastExpense = {};
    tool.move(lot());
    await Promise.resolve();
    expect(text(f.last().html)).toContain('Upkeep here');
    expect(text(f.last().html)).not.toContain('Monthly budget');
    tool.deactivate();
    // a sandbox: money is no object
    report(st);
    const s = fakeCtx(sim, true);
    const sandboxed = plopTool(s.ctx);
    sandboxed.move(lot());
    await Promise.resolve();
    expect(text(s.last().html)).toContain('Upkeep here');
    expect(text(s.last().html)).not.toContain('Monthly budget');
    sandboxed.deactivate();
  });
});

describe('the build card (FH-05)', () => {
  it('a Fire Station card: a Monthly budget row at the city-wide estimate; none on a card that does not select, before the first report or in a sandbox', () => {
    const st = report(newState(64));
    // (a city that charges running costs; its fire need unknown yet: the typical load, ≈§539/mo)
    st.systemData.infraVersion = 1;
    const sim = new Simulation(st);
    let sandbox = false;
    const ctx = {
      get state() { return sim.state; },
      sim,
      host: { events: sim.events, commandCount: 0 },
      signal: new AbortController().signal,
      ui: { on: () => () => undefined },
      tools: { activeId: null, select: () => true },
      panels: { isOpen: () => false },
      overlay: 0,
      mods: {},
      sandbox: () => sandbox,
      sound: () => undefined,
    } as unknown as GameContext;
    const parent = document.createElement('div') as unknown as HTMLElement;
    const bar = new Toolbar(ctx, parent);
    const tip = (parent as unknown as FEl).children.find((e) => e.classList.contains('rich-tip'))!;
    const show = (s: ToolSpec) => {
      (bar as unknown as { showSpecTip(s: ToolSpec, a: HTMLElement): void }).showSpecTip(s, document.createElement('div') as unknown as HTMLElement);
      return tip.innerHTML;
    };
    const spec = findToolSpec(ctx, 'plop:civ_fire_station')!;
    expect(spec.locked ?? null).toBeNull();
    expect(money(upkeepEstimate(st, fire)!.now)).toBe('§539');
    // the plan's line, red, with how long §2,042 last — right under the money rows
    let html = show(spec);
    expect(html).toContain('<span>Monthly budget</span><span><span class="neg">+§259 → −§280 after this</span><br><span class="neg">≈ 7 months of reserves</span></span>');
    expect(html.indexOf('<span>Upkeep</span>')).toBeLessThan(html.indexOf('<span>Monthly budget</span>'));
    expect(html.indexOf('<span>Monthly budget</span>')).toBeLessThan(html.indexOf('<span>Size</span>'));
    // a richer town: the plain row
    st.budget.lastIncome['tax:R$'] += 1000;
    html = show(spec);
    expect(html).toContain('<span>Monthly budget</span><span><span>+§1,259 → +§720 after this</span></span>');
    // a flat-upkeep card: its catalog upkeep
    expect(show(findToolSpec(ctx, 'plop:util_water_pump')!)).toContain('<span>Monthly budget</span><span><span>+§1,259 → +§1,234 after this</span></span>');
    // none on a card that does not select, before the first report, or in a sandbox
    expect(show({ ...spec, disabled: UNIQUE_BUILT_TEXT })).not.toContain('Monthly budget');
    expect(show({ ...spec, locked: { hint: 'Reach 2,000 residents', progress: 0.4 } })).not.toContain('Monthly budget');
    sandbox = true;
    expect(show(spec)).not.toContain('Monthly budget');
    sandbox = false;
    st.budget.lastIncome = {};
    st.budget.lastExpense = {};
    expect(show(spec)).not.toContain('Monthly budget');
    expect(show(spec)).toContain('<span>Upkeep</span>');
  });
});

describe('acceptance (FH-05): a 1,500-resident town with growth frozen', () => {
  /**
   * streets z = 8, 16, 24, 32 (x 2..60) and x = 2, 31, 60; a coal plant and two pumps in the north-east; 25 + 25 homes
   * (R$$, 60 each) south of the streets z = 16 and z = 24; 28 shops and 10 factories (960 jobs). It settles at about
   * 1,550 residents in its second month and holds there.
   */
  function town(): CityState {
    const st = newState(64);
    st.funds = 20000;
    for (const z of [8, 16, 24, 32]) roadLine(st, 2, z, 60, z, Network.Road);
    for (const x of [2, 31, 60]) roadLine(st, x, 8, x, 32, Network.Road);
    place(st, 'util_coal_plant', 40, 9, { flags: BF.Plopped });
    place(st, 'util_water_pump', 50, 9, { flags: BF.Plopped });
    place(st, 'util_water_pump', 52, 9, { flags: BF.Plopped });
    for (const z of [17, 25]) for (let x = 3; x < 28; x++) { st.zone[st.idx(x, z)] = Zone.ResMed; place(st, 't_r2', x, z, { pop: 60 }); }
    for (let x = 3; x <= 30; x++) { st.zone[st.idx(x, 15)] = Zone.ComLow; place(st, 't_cs', x, 15, { jobs: 20 }); }
    for (let x = 3; x <= 12; x++) { st.zone[st.idx(x, 23)] = Zone.IndMed; place(st, 't_id', x, 23, { jobs: 40 }); }
    return st;
  }

  it('hovering a Fire Station shows before → after; a month after placing it, its expense line and the change in net are within ±15 % of the prediction', async () => {
    // the town and a twin that never gets the station: the change in net is measured against the twin on the same day,
    // so the town's own month-to-month drift (−§8 in the twin) is not counted as the station's
    const frozen = () => createSystems().filter((s) => s.name !== 'economy.growth');
    const stA = town(), stB = town();
    const A = new Simulation(stA, frozen()), B = new Simulation(stB, frozen());
    A.runDays(60);
    B.runDays(60);
    expect(stA.stats.population).toBeGreaterThan(1400);
    expect(stA.stats.population).toBeLessThan(1700);
    expect(net(stA)).toBe(net(stB));
    // the hover: (33, 17)-(34, 18), east of the street x = 31, facing the street z = 16
    const f = fakeCtx(A);
    const tool = plopTool(f.ctx);
    tool.move(at(33, 17, 34, 18));
    await Promise.resolve();
    const before = net(stA);
    const here = runQuery(A, 'upkeepContext', { defId: fire.id, x: 33, z: 17, w: 2, d: 2 }).here!;
    expect(text(f.last().html)).toContain(`Monthly budget: ${moneySigned(before)} → ${moneySigned(before - here)} after this`);
    tool.deactivate();
    // placed there, then a month: its own expense line (the only fire facility) and the change in net
    expect(new CityActions(A).plop(fire.id, 33, 17, 2).ok).toBe(true);
    A.runDays(30);
    B.runDays(30);
    const expense = stA.budget.lastExpense['service:fire'] ?? 0;
    expect(Math.abs(expense - here) / here, `expense §${expense} vs predicted §${here.toFixed(0)}`).toBeLessThanOrEqual(0.15);
    const change = net(stA) - net(stB);
    expect(Math.abs(change + here) / here, `change §${change} vs predicted −§${here.toFixed(0)}`).toBeLessThanOrEqual(0.15);
  });
});
