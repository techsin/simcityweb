/**
 * Polish FH-03 / LG-05 (src/ui/adviceActions.ts): an advice's button is found by its id — NewsItem.ref.advice for a toast,
 * the card's options, else OpenAdvice.ref ?? id, for an Advisors card — never by its text, and each opens the right tool
 * or view: "Zone homes" selects zone:1 and pulses Zones; "Build roads" the Road tool; a built-out city's "Rezone" the
 * Land value view and the Zones tools at its lowest-value block, "Connect a highway" the Highway tool at the neighbour's
 * edge. The Planning card of "no room to grow" says how many lots are left (emptyFrontTiles).
 */
import { setMaxListeners } from 'node:events';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Network, Overlay, Zone } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import { CATEGORIES } from '../../src/game/toolCatalog';
import type { CityState, NewsItem } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { advisorsSystem, type AdvisorsSystem } from '../../src/sim/economy/advisors';
import { PULSE_MS, adviceAction, emptyFrontTiles, issueButtons, newsAction } from '../../src/ui/adviceActions';
import { Toasts } from '../../src/ui/Notifications';
import { AdvisorsPanel } from '../../src/ui/panels/AdvisorsPanel';
import { newState, place, roadLine } from '../infra/cityGen';
import { queryHost } from './queryHost';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const gw = globalThis as unknown as Record<string, unknown>;
let hadWindow: unknown;
beforeAll(() => {
  hadWindow = gw.window;
  gw.window ??= globalThis; // (the toasts' timers)
});
afterAll(() => { gw.window = hadWindow; });
const aborts: AbortController[] = [];
afterEach(() => {
  for (const a of aborts.splice(0)) a.abort('dispose');
  vi.useRealTimers();
});

interface Calls { selected: string[]; focus: [number, number][]; overlay: Overlay[]; flyout: string[] }

/** a context with a toolbar (one .tb-btn per category, as Toolbar builds it) that records what the actions open */
function harness(sim?: Simulation | { events: { on: (t: string, f: (n: NewsItem) => void) => () => void } }) {
  const calls: Calls = { selected: [], focus: [], overlay: [], flyout: [] };
  const root = new FEl('div');
  const bar = new FEl('div');
  bar.className = 'toolbar mp-glass';
  for (const c of CATEGORIES) {
    const b = new FEl('button');
    b.className = 'tb-btn';
    b.dataset.cat = c.id;
    bar.appendChild(b);
  }
  root.appendChild(bar);
  const abort = new AbortController();
  aborts.push(abort);
  // (the fake DOM ties each element listener to the signal with an abort listener of its own: a full Advisors tab has
  // more than node's default ten)
  setMaxListeners(100, abort.signal);
  const real = sim instanceof Simulation ? sim : null;
  const ctx = {
    root, signal: abort.signal, overlay: Overlay.None, overlayVariant: -1, settings: { toasts: true }, mods: {},
    sim: sim ?? { events: { on: () => () => undefined } },
    host: real ? queryHost(real) : undefined,
    state: real?.state,
    tools: { select: (id: string) => { calls.selected.push(id); return true; } },
    focusCell: (x: number, z: number) => { calls.focus.push([x, z]); },
    setOverlay: (o: Overlay) => { calls.overlay.push(o); ctx.overlay = o; },
    openFlyout: (id: string) => { calls.flyout.push(id); },
    sound: () => undefined,
    panels: { open: () => undefined },
  } as unknown as GameContext;
  const pulsing = () => bar.children.filter((b) => b.classList.contains('coach')).map((b) => b.dataset.cat);
  return { ctx, calls, pulsing };
}

describe('advice actions: by id, each opening its tool or view', () => {
  it('the zone rules select their zone tool and pulse Zones for a few seconds', () => {
    vi.useFakeTimers();
    const { ctx, calls, pulsing } = harness();
    expect(adviceAction('zoneR')?.label).toBe('Zone homes');
    adviceAction('zoneR')!.run(ctx, null);
    expect(calls.selected).toEqual(['zone:1']);
    expect(pulsing()).toEqual(['zones']);
    vi.advanceTimersByTime(PULSE_MS);
    expect(pulsing()).toEqual([]);
    adviceAction('zoneC')!.run(ctx, null);
    // (a place: the camera goes there first — "zone next to your most desirable homes")
    adviceAction('zoneI')!.run(ctx, { x: 4, z: 41 });
    expect(calls.selected).toEqual(['zone:1', 'zone:4', 'zone:8']);
    expect(calls.focus).toEqual([[4, 41]]);
  });

  it('Build roads: the Road tool; Rezone: the Land value view and the Zones tools at the block; Connect: the Highway tool at the edge', () => {
    const { ctx, calls, pulsing } = harness();
    adviceAction('noRoadAccess')!.run(ctx, { x: 10, z: 40 });
    expect(calls.selected).toEqual(['net:2']);
    expect(pulsing()).toEqual(['transport']);
    adviceAction('rezone')!.run(ctx, { x: 32, z: 28 });
    expect(calls.overlay).toEqual([Overlay.LandValue]);
    expect(calls.flyout).toEqual(['zones']);
    // (the built-out card's own post offers its first option; the view already on is left on)
    adviceAction('builtOut')!.run(ctx, null);
    expect(calls.overlay).toEqual([Overlay.LandValue]);
    expect(calls.flyout).toEqual(['zones', 'zones']);
    adviceAction('connect')!.run(ctx, { x: 63, z: 32 });
    expect(calls.selected).toEqual(['net:2', 'net:5']);
    expect(calls.focus).toEqual([[10, 40], [32, 28], [63, 32]]);
  });

  it('no button for other ids, and the lookups never read a text', () => {
    for (const id of ['garbage', 'zoneDev2', 'toString', '', undefined, null]) expect(adviceAction(id)).toBeNull();
    expect(newsAction({ ref: { advice: 'zoneR' } })?.label).toBe('Zone homes');
    expect(newsAction({})).toBeNull();
    expect(newsAction({ ref: { reward: 'mayor_house' } })).toBeNull();
    // a card: its options first, else its ref, else its rule id
    expect(issueButtons({ id: 'zoneR' }).map((b) => b.action.label)).toEqual(['Zone homes']);
    expect(issueButtons({ id: 'zoneR', ref: 'noRoadAccess', x: 10, z: 40 })).toEqual([{ action: adviceAction('noRoadAccess'), at: { x: 10, z: 40 } }]);
    expect(issueButtons({ id: 'zoneR', ref: 'zoneDev2' })).toEqual([]);
    const opts = [{ id: 'rezone', x: 32, z: 28 }, { id: 'connect', x: 63, z: 32 }, { id: 'arcology' }];
    expect(issueButtons({ id: 'builtOut', x: 32, z: 28, options: opts }).map((b) => [b.action.label, b.at]))
      .toEqual([['Rezone', { x: 32, z: 28 }], ['Connect a highway', { x: 63, z: 32 }]]);
  });
});

// ------------------------------------------------------------------------------------------------ cities
/** a sim with the advisors system only (plus a stand-in services system); `tick(d)` runs its month tick on day d */
function citySim(setup: (st: CityState, rt: EconRuntime) => void) {
  const st = newState(64);
  st.systemData.infraVersion = 1;
  const rt = new EconRuntime();
  const adv = advisorsSystem(rt) as AdvisorsSystem;
  const sim = new Simulation(st, [{ name: 'services', clustersOf: () => [] } as unknown as SimSystem, adv]);
  setup(st, rt);
  return { sim, tick: (d: number) => { st.day = d; adv.monthly!(sim); } };
}
/** strong residential demand, 4 empty residential lots on a road (and one more off it) */
function noRoom(st: CityState, rt: EconRuntime) {
  roadLine(st, 2, 20, 60, 20, Network.Road);
  for (let x = 3; x < 7; x++) st.zone[st.idx(x, 21)] = Zone.ResLow;
  st.zone[st.idx(8, 23)] = Zone.ResLow;
  st.stats.population = 5000;
  st.stats.demand[0] = 0.7;
  rt.emptyFront[Zone.ResLow] = 4;
}
/** no free land (a road on every eighth row, commercial zoning elsewhere, one shop per strip; the strip of rows 25-31
 *  the cheapest), strong commercial demand and a neighbour with 30,000 spare jobs on the east edge */
function builtOut(st: CityState) {
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

describe('the toast of an advice post (FH-03)', () => {
  /** Toasts on a stand-in news feed: post() emits a news item */
  function toasts() {
    let onNews: ((n: NewsItem) => void) | null = null;
    const h = harness({ events: { on: (t: string, f: (n: NewsItem) => void) => { if (t === 'news') onNews = f; return () => undefined; } } });
    const parent = new FEl('div');
    new Toasts(h.ctx, parent as unknown as HTMLElement);
    const post = (n: Partial<NewsItem>) => onNews!({ day: 30, kind: 'warning', advisor: 'planning', text: '', ...n } as NewsItem);
    /** the toasts, newest first */
    const shown = () => parent.children[0].children;
    return { ...h, post, shown };
  }

  it('end to end: a town with no room gets the warning within one month tick, as a toast with "Zone homes"; a click selects zone:1', () => {
    const { sim, tick } = citySim(noRoom);
    const h = harness(sim);
    const parent = new FEl('div');
    new Toasts(h.ctx, parent as unknown as HTMLElement);
    tick(30);
    const t = parent.children[0].children.find((e) => textOf(e).includes('no room to grow'));
    expect(t, 'toasted at the first month tick').toBeDefined();
    expect(textOf(t!)).toContain('Zone homes');
    t!.click();
    expect(h.calls.selected).toEqual(['zone:1']);
    expect(h.pulsing()).toEqual(['zones']);
  });

  it('the button is found by ref.advice: reworded advice keeps it, the same words without a ref have none', () => {
    const t = toasts();
    t.post({ text: 'We need more homes — rezone along the avenue!', ref: { advice: 'zoneR' } });
    expect(textOf(t.shown()[0])).toContain('Zone homes');
    t.shown()[0].click();
    expect(t.calls.selected).toEqual(['zone:1']);
    t.post({ text: 'Residential demand is strong but there is no room to grow — zone more residential land along roads.' });
    expect(textOf(t.shown()[0])).toContain('no room to grow');
    expect(textOf(t.shown()[0])).not.toContain('Zone homes');
  });

  it('a post with a place: its button goes there first (the click no longer only jumps)', () => {
    const t = toasts();
    t.post({ text: 'Roadless homes', ref: { advice: 'noRoadAccess' }, x: 10, z: 40 });
    expect(textOf(t.shown()[0])).toContain('Build roads');
    t.shown()[0].click();
    expect(t.calls.focus).toEqual([[10, 40]]);
    expect(t.calls.selected).toEqual(['net:2']);
  });
});

describe('Advisors cards: the advice\'s buttons (FH-03 / LG-05)', () => {
  function panelOf(sim: Simulation) {
    const h = harness(sim);
    const panel = new AdvisorsPanel(h.ctx);
    panel.mount(() => undefined, () => undefined, () => undefined);
    panel.isOpen = true;
    panel.onOpen();
    panel.update();
    const body = panel.body as unknown as FEl;
    const card = body.querySelectorAll('.adv').find((c) => textOf(c).includes('Alex Stone'))!;
    const button = (label: string) => card.querySelectorAll('button').find((b) => textOf(b) === label);
    return { ...h, card, button };
  }

  it('"no room to grow": the Planning card counts the lots left and offers "Zone homes" next to "Show me"', () => {
    const { sim, tick } = citySim(noRoom);
    tick(30);
    const p = panelOf(sim);
    expect(textOf(p.card)).toContain('Residential demand is strong but there is no room to grow');
    expect(textOf(p.card.querySelector('.am-room')!)).toBe('4 empty residential lots left — demand wants many more');
    expect(p.button('Show me')).toBeDefined();
    p.button('Zone homes')!.click();
    expect(p.calls.selected).toEqual(['zone:1']);
  });

  it('zones no road reaches: the same rule\'s card offers "Build roads" (its ref), without the lots count', () => {
    const { sim, tick } = citySim((st) => {
      for (let x = 10; x < 20; x++) st.zone[st.idx(x, 40)] = Zone.ResLow;
      st.stats.population = 3000;
      st.stats.demand[0] = 0.8;
    });
    tick(30);
    const p = panelOf(sim);
    expect(textOf(p.card)).toContain('10 residential tiles have no road access');
    expect(p.card.querySelector('.am-room')).toBeNull();
    expect(p.button('Zone homes')).toBeUndefined();
    p.button('Build roads')!.click();
    expect(p.calls.focus).toEqual([[10, 40]]);
    expect(p.calls.selected).toEqual(['net:2']);
  });

  it('a built-out city: "Rezone" and "Connect a highway", each opening its view or tool at its place', () => {
    const { sim, tick } = citySim(builtOut);
    tick(30);
    const p = panelOf(sim);
    expect(textOf(p.card)).toContain('Commercial demand is strong, but the city is built out');
    expect(p.card.querySelector('.am-room')).toBeNull();
    p.button('Rezone')!.click();
    expect(p.calls.focus).toEqual([[32, 28]]);
    expect(p.calls.overlay).toEqual([Overlay.LandValue]);
    expect(p.calls.flyout).toEqual(['zones']);
    p.button('Connect a highway')!.click();
    expect(p.calls.focus).toEqual([[32, 28], [63, 32]]);
    expect(p.calls.selected).toEqual(['net:5']);
    expect(p.pulsing()).toEqual(['transport']);
  });
});

describe('emptyFrontTiles (FH-03): the room a family has left', () => {
  it('empty zoned tiles facing a road, with no building, network, water or power line', () => {
    const st = newState(16);
    roadLine(st, 0, 5, 15, 5, Network.Road);
    for (let x = 0; x < 6; x++) st.zone[st.idx(x, 6)] = Zone.ResLow; // 6 facing the road …
    place(st, 't_r1', 1, 6); // … one built on,
    st.powerLines[st.idx(2, 6)] = 1; // one under a power line
    st.zone[st.idx(0, 7)] = Zone.ResMed; // (behind them: no road)
    st.zone[st.idx(3, 4)] = Zone.ComLow; // across the road
    expect(emptyFrontTiles(st, 0)).toBe(4);
    expect(emptyFrontTiles(st, 1)).toBe(1);
    expect(emptyFrontTiles(st, 2)).toBe(0);
  });
});
