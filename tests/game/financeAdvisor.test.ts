/**
 * Polish FH-05, the finance advisor's half (T037e: src/ui/panels/AdvisorsPanel.ts with src/ui/guide/budgetDelta.ts). The
 * card said "A healthy surplus of §150 last month. Consider investing in services." to a town whose Fire Station read
 * ≈§539 a month (shots2/027), and "At this rate the treasury runs dry in 1119 months" to a player who lost money for
 * years (newplayer/073). Now:
 *  - "healthy" only from a quarter of last month's income, and only when the surplus pays for the cheapest service the
 *    other advisors ask for; else "A small surplus of §150 — a Fire Station costs about §540 a month. Grow the town or
 *    raise taxes a little first." (the plan's acceptance: a net of §150 with a §540 cheapest unmet service);
 *  - the months left never exceed 60: "more than 5 years at this rate" (the plan's second acceptance item);
 *  - the card and the plop tip agree: the card quotes the tip's own upkeep — "Upkeep here" on the lot beside the advice's
 *    place, through the tip's upkeepContext query — not the city-wide estimate (NOTE-043). Checked against a real plop
 *    tip in a 1,550-resident town, with a stand-in issue feed for the cheapest of several, and on a replica.
 */
import { setMaxListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { Network, Overlay, Zone } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import { PlopTool } from '../../src/game/tools/PlopTool';
import type { ToolPointer } from '../../src/game/tools/Tool';
import { CityActions } from '../../src/sim/actions';
import { BF, type CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import type { OpenAdvice } from '../../src/sim/economy/advisors';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import { money, moneySigned } from '../../src/ui/format';
import { budgetEffect, serviceLot } from '../../src/ui/guide/budgetDelta';
import { ADVISORS, AdvisorsPanel } from '../../src/ui/panels/AdvisorsPanel';
import { upkeepEstimate } from '../../src/ui/upkeepModel';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { runQuery } from '../../src/worker/queries';
import { newState, place, roadLine } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';
import { queryHost } from './queryHost';

installFakeDom();
const aborts: AbortController[] = [];
afterEach(() => {
  for (const a of aborts.splice(0)) a.abort('dispose');
  vi.restoreAllMocks();
});

const finance = ADVISORS.find((a) => a.id === 'finance')!;
const fire = getDef('civ_fire_station')!;
const asked = (name: string, upkeep: number) => () => ({ name, upkeep });
const never = () => { throw new Error('the asked service was looked up'); };
/** promise callbacks and the timers due now have run */
const settle = () => new Promise<void>((r) => { setTimeout(r, 0); });

/** last month's report: `net` on `income` of taxes — one-offs on both sides, never counted */
function report(st: CityState, net: number, income: number): CityState {
  st.budget.lastIncome = { 'tax:R$': income, 'oneoff:loan': 10000 };
  st.budget.lastExpense = { 'service:utilities': income - net, 'oneoff:construction': 1400 };
  return st;
}
/** a city whose last month made `net` on `income` of taxes, with `funds` in the bank */
function city(net: number, income = 1000, funds = 20000): GameContext {
  const st = report(newState(16), net, income);
  st.funds = funds;
  return { state: st } as unknown as GameContext;
}

describe('the finance advisor\'s assessment (FH-05)', () => {
  const SMALL = 'A small surplus of §150 — a Fire Station costs about §540 a month. Grow the town or raise taxes a little first.';
  const healthy = (n: string) => `A healthy surplus of ${n} last month. Consider investing in services.`;

  it('acceptance: a net of §150 with a §540 cheapest unmet service gives the "small surplus" wording', () => {
    expect(finance.assess(city(150), asked('Fire Station', 540))).toEqual({ level: 'good', text: SMALL });
    // whatever share of the income it is: a surplus that cannot pay for the service is not "healthy"
    expect(finance.assess(city(150, 400), asked('Fire Station', 540)).text).toBe(SMALL);
    expect(finance.assess(city(150), asked('Elementary School', 230)).text)
      .toBe('A small surplus of §150 — an Elementary School costs about §230 a month. Grow the town or raise taxes a little first.');
  });

  it('"healthy" only from a quarter of the income, and only when the surplus pays for the cheapest asked service', () => {
    // nothing asked: a quarter of the income is healthy, a simoleon less is small
    expect(finance.assess(city(250)).text).toBe(healthy('§250'));
    expect(finance.assess(city(250), () => null).text).toBe(healthy('§250'));
    expect(finance.assess(city(249)).text).toBe('A small surplus of §249 last month. Grow the town or raise taxes a little before adding services.');
    // the asked service fits: healthy from a quarter; below it, what it costs and what it would leave
    expect(finance.assess(city(600), asked('Fire Station', 540)).text).toBe(healthy('§600'));
    expect(finance.assess(city(200), asked('Fire Station', 159)).text).toBe('A small surplus of §200 — a Fire Station costs about §159 a month and would leave §41.');
    // it does not fit: small, however large a share of the income
    expect(finance.assess(city(600), asked('High School', 912)).text).toBe('A small surplus of §600 — a High School costs about §912 a month. Grow the town or raise taxes a little first.');
    // every surplus is good news: the card's dot stays green
    for (const [net, s] of [[250, undefined], [249, undefined], [150, asked('Fire Station', 540)], [200, asked('Fire Station', 159)]] as const) {
      expect(finance.assess(city(net), s).level).toBe('good');
    }
  });

  it('"fits" is the plop tip\'s own test: the line that turns its "Monthly budget" red (the rounded net − upkeep below zero)', () => {
    expect(finance.assess(city(200, 4000), asked('Fire Station', 200.4)).text).toBe('A small surplus of §200 — a Fire Station costs about §200 a month and would leave §0.');
    expect(finance.assess(city(200, 4000), asked('Fire Station', 200.6)).text).toBe('A small surplus of §200 — a Fire Station costs about §201 a month. Grow the town or raise taxes a little first.');
    for (const [net, upkeep] of [[200, 159], [200, 200.4], [200, 200.6], [150, 540], [42, 58.5], [42.4, 42.8], [42.6, 43]]) {
      const ctx = city(net, 4000);
      const tip = budgetEffect(ctx.state, fire, upkeep)!;
      const text = finance.assess(ctx, asked('Fire Station', upkeep)).text;
      expect(text.endsWith('raise taxes a little first.'), `${net} − ${upkeep}`).toBe(tip.bad);
      // (and what it would leave is the tip's "after this", to the simoleon)
      if (!tip.bad) expect(text).toContain(`would leave ${money(Math.round(tip.after))}.`);
    }
  });

  it('a balanced month, the red and a sandbox read as before, and look no service up', () => {
    expect(finance.assess(city(0), never)).toEqual({ level: 'good', text: 'The budget is balanced. Keep an eye on expenses as the city grows.' });
    // (a city's first month: no report yet)
    expect(finance.assess({ state: newState(16) } as unknown as GameContext, never).text).toBe('The budget is balanced. Keep an eye on expenses as the city grows.');
    expect(finance.assess(city(150, 1000, -300), never)).toEqual({ level: 'bad', text: 'We\'re in the red (−§300). Raise taxes, cut services or take a loan immediately.' });
    expect(finance.assess(city(-100), never).level).toBe('warn');
    const sandbox = city(150);
    sandbox.state.config.sandbox = true;
    expect(finance.assess(sandbox, never)).toEqual({ level: 'good', text: 'Sandbox mode — money is no object, Mayor.' });
  });

  it('acceptance: the months-left text never exceeds 60 months — "more than 5 years at this rate"', () => {
    // the new player's town: income §189 against expenses of §372, §59k in the bank (322 months: it read "1119 months")
    expect(finance.assess(city(-183, 189, 59000))).toEqual({ level: 'warn', text: 'We lost §183 last month. The treasury lasts more than 5 years at this rate.' });
    expect(finance.assess(city(-100, 1000, 6001)).text).toBe('We lost §100 last month. The treasury lasts more than 5 years at this rate.');
    expect(finance.assess(city(-100, 1000, 6000)).text).toBe('We lost §100 last month. At this rate the treasury runs dry in 60 months.');
    expect(finance.assess(city(-100, 1000, 250)).text).toBe('We lost §100 last month. At this rate the treasury runs dry in 2 months.');
    expect(finance.assess(city(-100, 1000, 199)).text).toBe('We lost §100 last month. At this rate the treasury runs dry in 1 month.');
    expect(finance.assess(city(-100, 1000, 99)).text).toBe('We lost §100 last month. At this rate the treasury runs dry within a month.');
    expect(finance.assess(city(-100, 1000, 0)).text).toBe('We lost §100 last month. At this rate the treasury runs dry within a month.');
    let counted = 0, capped = 0;
    const ctx = city(-1);
    for (let funds = 0; funds < 2e8; funds = Math.ceil(funds * 1.37) + 1) {
      for (let loss = 1; loss < 3e5; loss = Math.ceil(loss * 1.61)) {
        report(ctx.state, -loss, 1000).funds = funds;
        const a = finance.assess(ctx);
        expect(a.level).toBe('warn');
        const m = /^We lost §[\d,]+ last month\. At this rate the treasury runs dry in (\d+) months?\.$/.exec(a.text);
        if (m) { counted++; expect(Number(m[1]), a.text).toBeLessThanOrEqual(60); expect(Number(m[1])).toBe(Math.floor(funds / loss)); }
        else if (/The treasury lasts more than 5 years at this rate\.$/.test(a.text)) { capped++; expect(funds / loss).toBeGreaterThan(60); }
        else expect(a.text, `${funds} / ${loss}`).toMatch(/At this rate the treasury runs dry within a month\.$/);
        expect(a.text).not.toMatch(/\d{3,} months/);
      }
    }
    expect(counted).toBeGreaterThan(50);
    expect(capped).toBeGreaterThan(50);
  });
});

// ------------------------------------------------------------------------------------------------ the card
/** an Advisors panel open on its Advisors tab; `message(name)`: what that advisor's card says now */
function openPanel(host: unknown, sim: unknown, state: () => CityState) {
  const abort = new AbortController();
  aborts.push(abort);
  // (the fake DOM ties each element listener to the signal with an abort listener of its own)
  setMaxListeners(100, abort.signal);
  const ctx = {
    root: new FEl('div'), signal: abort.signal, overlay: Overlay.None, overlayVariant: -1, settings: { toasts: true }, mods: {},
    host, sim, get state() { return state(); }, ui: new Emitter<UIEvents>(),
    tools: { activeId: null, select: () => true }, focusCell: () => undefined, setOverlay: () => undefined, sound: () => undefined,
    panels: { open: () => undefined, isOpen: () => false },
  } as unknown as GameContext;
  const panel = new AdvisorsPanel(ctx);
  panel.mount(() => undefined, () => undefined, () => undefined);
  panel.isOpen = true;
  panel.onOpen();
  panel.update();
  const message = (name: string) => textOf((panel.body as unknown as FEl).querySelectorAll('.adv').find((c) => textOf(c).includes(name))!.querySelector('.am')!);
  return { panel, message };
}

/** the spot upkeeps a host was asked for */
const spots = (query: { mock: { calls: unknown[][] } }) => query.mock.calls.filter(([name]) => name === 'upkeepContext').map(([, args]) => args);

/**
 * T037c's acceptance town, with the lot beside its fire advice left free: streets z = 8, 16, 24, 32 (x 2..60) and
 * x = 2, 31, 60; a coal plant and two pumps in the north-east; 25 + 25 homes (R$$, 60 each) south of the streets z = 16
 * and z = 24; 28 shops and 9 factories. It settles at about 1,550 residents with no fire station: the safety advisor
 * asks for one at (12, 20), the middle of the block with the most residents out of reach.
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
  for (let x = 3; x <= 11; x++) { st.zone[st.idx(x, 23)] = Zone.IndMed; place(st, 't_id', x, 23, { jobs: 40 }); }
  return st;
}
/** growth off: the town holds its size (FH-05's acceptance fixture) */
const frozen = () => createSystems().filter((s) => s.name !== 'economy.growth');
/** the lot beside the fire advice's place (12, 20): on the north side of the street z = 24 */
const LOT = { x: 12, z: 22, w: 2, d: 2 };

// ---- a plop tool on the same simulation (budgetPreview.test.ts's stand-ins)
const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
function plopTip(sim: Simulation) {
  const tips: { html: string; kind?: string }[] = [];
  const ctx = {
    state: sim.state, sim, host: queryHost(sim), signal: new AbortController().signal, actions: new CityActions(sim),
    world: { setHighlight: () => {}, setHighlightRect: () => {} }, objects: { setGhost: () => {}, setNetworkPreview: () => {} },
    tip: { show: (html: string, kind?: string) => tips.push({ html, kind }), hide: () => {}, move: () => {} },
    sandbox: () => false, sound: () => {}, toast: () => {}, tools: { active: null, refresh: () => {}, select: () => true }, preferOverlayVariant: () => {},
  } as unknown as GameContext;
  const tool = new PlopTool(ctx, fire, 'x');
  Object.assign(ctx.tools, { active: tool });
  tool.activate();
  /** hover the lot (the tool centres the footprint on the pointer) */
  const hover = (lot: { x: number; z: number; w: number; d: number }) => tool.move({
    clientX: 0, clientY: 0, shift: false, ctrl: false, alt: false, down: false,
    hit: { x: lot.x, z: lot.z, point: { x: (lot.x + lot.w / 2) * 16, y: 5, z: (lot.z + lot.d / 2) * 16 } } as unknown as ToolPointer['hit'],
  });
  return { hover, last: () => tips[tips.length - 1], done: () => tool.deactivate() };
}

describe('the Finance card and the plop tip agree (FH-05, NOTE-043)', () => {
  it('a 1,550-resident town without a fire station: the card names the Fire Station the safety advisor asks for, at the upkeep the plop tip quotes beside that advice\'s place', async () => {
    const st = town();
    const sim = new Simulation(st, frozen());
    sim.runDays(60);
    expect(st.stats.population).toBeGreaterThan(1500);
    expect(st.stats.population).toBeLessThan(1700);
    // the safety advisor's advice names the middle of a block; the lot beside it lies along the street z = 24
    expect(runQuery(sim, 'advisorIssues', {}).find((o) => o.id === 'noFireResponse')).toMatchObject({ advisor: 'safety', x: 12, z: 20 });
    expect(serviceLot(st, fire, 12, 20)).toEqual(LOT);
    // (the fixture, as of this writing: ≈§171 a month typical in this city, §85 on that lot — and §48, the bare building,
    // on the advice's own roadless cell)
    const est = upkeepEstimate(st, fire)!.now;
    const here = runQuery(sim, 'upkeepContext', { defId: fire.id, ...LOT }).here!;
    expect(here).toBeGreaterThan(50);
    expect(est).toBeGreaterThan(1.5 * here);
    expect(runQuery(sim, 'upkeepContext', { defId: fire.id, x: 12, z: 20, w: 2, d: 2 }).here!).toBeLessThan(0.75 * here);
    // last month made small: +§42 on §700 of taxes
    report(st, 42, 700);
    const host = queryHost(sim);
    const query = vi.spyOn(host, 'query');
    const p = openPanel(host, sim, () => sim.state);
    expect(p.message('Chief Reyes')).toMatch(/^The city has no fire station: .* Build a Fire Station near here\.$/);
    // until the spot's reply lands, the city-wide estimate the plop tip starts from too
    expect(p.message('Morgan Price')).toBe(`A small surplus of §42 — a Fire Station costs about ${money(est)} a month. Grow the town or raise taxes a little first.`);
    await settle();
    expect(p.message('Morgan Price')).toBe(`A small surplus of §42 — a Fire Station costs about ${money(here)} a month. Grow the town or raise taxes a little first.`);
    // the plop tip on that lot quotes the same upkeep, and its budget line is red: the card and the tip agree
    const tip = plopTip(sim);
    tip.hover(LOT);
    await settle();
    expect(tip.last().kind).toBe('ok');
    expect(strip(tip.last().html)).toContain(`Upkeep here ≈${money(here)}/mo now`);
    expect(strip(tip.last().html)).toContain(`Monthly budget: +§42 → ${moneySigned(42 - here)} after this`);
    expect(tip.last().html).toContain('<div class="tip-reason">Monthly budget: ');
    // (next door the upkeep is the same within a few percent: the card's lot need not be the player's)
    for (const x of [10, 14, 16]) {
      const near = runQuery(sim, 'upkeepContext', { defId: fire.id, ...LOT, x }).here!;
      expect(Math.abs(near - here) / here, `lot x = ${x}: §${near.toFixed(1)}`).toBeLessThan(0.05);
    }
    tip.done();
    // asked once for the issue list, however often the panel updates
    for (let k = 0; k < 5; k++) p.panel.update();
    await settle();
    expect(spots(query)).toEqual([{ defId: fire.id, ...LOT }]);
  });

  it('a surplus that pays for the station: "healthy" from a quarter of the income, else what it costs and what it would leave — the tip\'s own "before → after"', async () => {
    const st = town();
    const sim = new Simulation(st, frozen());
    sim.runDays(60);
    const here = runQuery(sim, 'upkeepContext', { defId: fire.id, ...LOT }).here!;
    expect(here).toBeGreaterThan(50);
    const tip = plopTip(sim);
    // a tenth of the income, §15 more than the station costs on that lot (+§100 on §1,000 as of this writing): small,
    // and the station fits
    const small = Math.round(here) + 15;
    report(st, small, 10 * small);
    let p = openPanel(queryHost(sim), sim, () => sim.state);
    await settle();
    expect(p.message('Morgan Price')).toBe(`A small surplus of ${money(small)} — a Fire Station costs about ${money(here)} a month and would leave ${money(Math.round(small - here))}.`);
    tip.hover(LOT);
    await settle();
    expect(strip(tip.last().html)).toContain(`Monthly budget: ${moneySigned(small)} → ${moneySigned(small - here)} after this`);
    expect(moneySigned(small - here)).toBe('+' + money(Math.round(small - here)));
    expect(tip.last().html).toContain('<div class="tip-sub">Monthly budget: ');
    // a third of the income and §100 more than the station costs: healthy
    const big = Math.round(here) + 100;
    report(st, big, 3 * big);
    p = openPanel(queryHost(sim), sim, () => sim.state);
    await settle();
    expect(p.message('Morgan Price')).toBe(`A healthy surplus of ${money(big)} last month. Consider investing in services.`);
    // … but not when the station does not fit, whatever the share: a third of the income, §25 short of the station
    const thin = Math.round(here) - 25;
    report(st, thin, 3 * thin);
    p = openPanel(queryHost(sim), sim, () => sim.state);
    await settle();
    expect(p.message('Morgan Price')).toBe(`A small surplus of ${money(thin)} — a Fire Station costs about ${money(here)} a month. Grow the town or raise taxes a little first.`);
    tip.done();
  });

  it('a loss asks for no spot; a new month\'s issue list asks again', async () => {
    const st = town();
    const sim = new Simulation(st, frozen());
    sim.runDays(60);
    report(st, -58, 700);
    expect(st.funds).toBeGreaterThan(60 * 58);
    const host = queryHost(sim);
    const query = vi.spyOn(host, 'query');
    const p = openPanel(host, sim, () => sim.state);
    await settle();
    expect(p.message('Morgan Price')).toBe('We lost §58 last month. The treasury lasts more than 5 years at this rate.');
    expect(spots(query)).toEqual([]);
    // the next month tick: its own report (a surplus) and a new issue list
    sim.runDays(30);
    p.panel.update();
    await settle();
    expect(spots(query)).toEqual([{ defId: fire.id, ...LOT }]);
    for (let k = 0; k < 3; k++) p.panel.update();
    sim.runDays(30);
    p.panel.update();
    await settle();
    expect(spots(query)).toEqual([{ defId: fire.id, ...LOT }, { defId: fire.id, ...LOT }]);
  });
});

describe('the cheapest of the services asked for (a stand-in issue feed)', () => {
  const issue = (id: string, advisor: string, at?: [number, number]): OpenAdvice => ({ id, advisor, text: `(${id})`, kind: 'warning', priority: 5, ...(at ? { x: at[0], z: at[1] } : {}) });
  /** a 32 × 32 city that charges running costs, one road along z = 10, last month +§200 on §4,000 of taxes */
  function strip32(): CityState {
    const st = report(newState(32), 200, 4000);
    st.systemData.infraVersion = 1;
    roadLine(st, 2, 10, 29, 10, Network.Road);
    return st;
  }
  /** a host that hands out `open` as the month tick's issues and `here[defId]` as a spot's upkeep */
  function feed(open: OpenAdvice[], here: Record<string, number | null>) {
    const asked: { defId: string }[] = [];
    const host = {
      commandCount: 0, newsSeq: 0,
      query: (name: string, args: { defId: string }) => {
        if (name !== 'upkeepContext') return Promise.resolve(open);
        asked.push(args);
        return Promise.resolve({ here: here[args.defId] ?? null });
      },
      watch: () => ({ version: 1, value: open, error: undefined, setArgs: () => {}, subscribe: () => () => {}, dispose: () => {} }),
    };
    return { host, asked, sim: { speed: 1, events: { on: () => () => undefined } } };
  }

  it('each asked building at its spot\'s upkeep — a placeless advice at the city-wide estimate — and the cheapest named', async () => {
    const st = strip32();
    const high = getDef('civ_high_school')!, police = getDef('civ_police_station')!;
    const open = [issue('noFireResponse', 'safety', [20, 13]), issue('noHigh', 'health', [12, 14]), issue('crime', 'safety')];
    const f = feed(open, { civ_fire_station: 260, civ_high_school: 150 });
    const p = openPanel(f.host, f.sim, () => st);
    // before the replies: the cheapest of the city-wide estimates (a Fire Station's ≈§539, more than the surplus)
    const [fireEst, highEst, policeEst] = [fire, high, police].map((d) => upkeepEstimate(st, d)!.now);
    expect(fireEst).toBeGreaterThan(260);
    expect(Math.min(highEst, policeEst)).toBeGreaterThan(fireEst);
    expect(p.message('Morgan Price')).toBe(`A small surplus of §200 — a Fire Station costs about ${money(fireEst)} a month. Grow the town or raise taxes a little first.`);
    await settle();
    // the spots: the High School is the cheapest here, and the surplus pays for it
    expect(p.message('Morgan Price')).toBe('A small surplus of §200 — a High School costs about §150 a month and would leave §50.');
    // only the advice with a place is asked, each on its lot beside the road
    expect(f.asked).toEqual([{ defId: 'civ_fire_station', x: 20, z: 11, w: 2, d: 2 }, { defId: 'civ_high_school', x: 11, z: 11, w: 4, d: 4 }]);
  });

  it('a spot without a figure (no need raster yet) keeps the estimate; an open finance issue or no asked service leaves the line alone', async () => {
    const st = strip32();
    let f = feed([issue('noFireResponse', 'safety', [20, 13])], { civ_fire_station: null });
    let p = openPanel(f.host, f.sim, () => st);
    await settle();
    expect(f.asked).toHaveLength(1);
    expect(p.message('Morgan Price')).toBe(`A small surplus of §200 — a Fire Station costs about ${money(upkeepEstimate(st, fire)!.now)} a month. Grow the town or raise taxes a little first.`);
    // nothing asked for: the plain small surplus, and no spot query
    f = feed([issue('zoneR', 'planning'), issue('garbage', 'utilities', [5, 11])], {});
    p = openPanel(f.host, f.sim, () => st);
    await settle();
    expect(f.asked).toEqual([]);
    expect(p.message('Morgan Price')).toBe('A small surplus of §200 last month. Grow the town or raise taxes a little before adding services.');
    // the finance advisor's own open issue speaks first, as before
    f = feed([issue('taxHigh', 'finance'), issue('noFireResponse', 'safety', [20, 13])], { civ_fire_station: 85 });
    p = openPanel(f.host, f.sim, () => st);
    await settle();
    expect(p.message('Morgan Price')).toBe('(taxHigh)');
  });
});

describe('the Finance card on the replica (LoopbackSimHost: the spot\'s upkeep crosses the packet seam)', () => {
  it('the open advice and the spot\'s upkeep come from the core; the report, the roads and the estimate are the mirrored ones', async () => {
    const abort = new AbortController();
    const host = new LoopbackSimHost(town(), { initialSpeed: 0, signal: abort.signal, loopback: { cadence: 'design', modules: { createSystems: frozen, CityActions } } });
    await host.start();
    try {
      host.harness.runDays(60);
      await host.drain();
      const replica = host.state, core = host.harness.core.sim;
      expect(replica).not.toBe(core.state);
      expect(replica.stats.population).toBe(core.state.stats.population);
      expect(replica.stats.population).toBeGreaterThan(1500);
      // (a test's write, as rciGuide.test.ts sets the replica's demand: last month made small, +§42 on §700)
      report(replica, 42, 700);
      const query = vi.spyOn(host, 'query');
      const p = openPanel(host, host.sim, () => host.state);
      // paused: the panel asks for a fresh scan of the advice — until it lands no card asks for a service …
      expect(p.message('Morgan Price')).toBe('A small surplus of §42 last month. Grow the town or raise taxes a little before adding services.');
      // … then for the spot of the Fire Station the safety card asks for
      for (let k = 0; k < 3; k++) { await host.drain(); await settle(); }
      expect(p.message('Chief Reyes')).toMatch(/^The city has no fire station: .* Build a Fire Station near here\.$/);
      expect(serviceLot(replica, fire, 12, 20)).toEqual(LOT);
      expect(spots(query)).toEqual([{ defId: fire.id, ...LOT }]);
      // the core's figure for that lot, not the mirrored state's city-wide estimate
      const here = runQuery(core, 'upkeepContext', { defId: fire.id, ...LOT }).here!;
      expect(here).toBeGreaterThan(50);
      expect(upkeepEstimate(replica, fire)!.now).toBeGreaterThan(1.5 * here);
      expect(p.message('Morgan Price')).toBe(`A small surplus of §42 — a Fire Station costs about ${money(here)} a month. Grow the town or raise taxes a little first.`);
    } finally { abort.abort('dispose'); await host.dispose(); }
  }, 60000);
});
