/**
 * FEEL-19 (docs/POLISH_PLAN.md "Hover says what is wrong with a building"; T064 lane t064-feel19): the Query hover adds
 * one status line under a building's name, from the inspector's own chip table (inspectorModel FLAG_CHIPS /
 * buildingChips), in the chip's words and tone:
 *  - the table: InfoPanel's chips are exactly what they were before the move (a frozen copy of the old chip code over
 *    every flag combination, and the rendered chips of twelve buildings recorded on dev 95f6e15);
 *  - the order: On fire, Abandoned, No road, No power, No water, Understaffed, garbage, noise, polluted, needs, crime;
 *    "Thriving" (no problem, condition at least 90 %); "Under construction 60%" while it is built;
 *  - the hover equals the inspector: an unpowered shack "No power", an abandoned building "Abandoned", and every other
 *    scenario's line is one of its rendered chips (or the ruin's main problem), with the chip's class;
 *  - the line is cached per building per sim day; a growable's condition is asked of the host once per building per
 *    day (it is a lagged field on a worker host's replica, WORKER_DESIGN §1.3), and the worker host's answer matches;
 *  - the tip costs at most 0.2 ms (median of 1,000 hovers over distinct buildings).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { CATALOG, getDef } from '../../src/sim/catalog';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import type { GameContext } from '../../src/game/context';
import { QueryTool } from '../../src/game/tools/QueryTool';
import type { ToolPointer } from '../../src/game/tools/Tool';
import { icon } from '../../src/ui/icons';
import {
  CHIP_TEXT, FLAG_CHIPS, HOVER_ORDER, HoverStatusCache, RUINS_TEXT, THRIVING_CONDITION, THRIVING_TEXT, TIP_KIND, TIP_LINE, buildingChips, constructionText,
  drawsPower, hoverStatus, type Chip, type ChipContext,
} from '../../src/ui/inspectorModel';
import { InfoPanel } from '../../src/ui/panels/InfoPanel';
import { LocalSimHost } from '../../src/worker/SimHost';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { newState, place, roadLine, stressCity } from '../infra/cityGen';
import { queryHost } from './queryHost';
import { type FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();

const hosts: { dispose(): Promise<void> | void }[] = [];
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.dispose();
});

// ------------------------------------------------------------------------------------------------ the scenario town
/** name, def, flags (set after the systems' first pass), building fields */
const SCENARIOS: [string, string, number, Partial<Building>][] = [
  ['unpowered shack', 'res_shack.r1.1', 0, { pop: 4, health: 0.7 }],
  ['abandoned cottage', 'res_shack.r1.1', BF.Abandoned | BF.Powered | BF.Watered, { pop: 0, health: 0.2 }],
  ['tower under construction', 'res_tower.r2.6', BF.Constructing | BF.Powered | BF.Watered, { built: 0.6, health: 0.6 }],
  ['thriving tower', 'res_tower.r2.7', BF.Powered | BF.Watered, { pop: 1500, health: 0.95 }],
  ['ruin with an emergency', 'res_shack.r1.1', BF.Burnt | BF.Incident | BF.NoGarbage | BF.NeedsUnmet, { pop: 0 }],
  ['school without water, understaffed', 'civ_elementary_school', BF.Plopped | BF.Powered | BF.Understaffed, { jobs: 10 }],
  ['coal plant', 'util_coal_plant', BF.Plopped | BF.Powered | BF.Watered, { jobs: 180 }],
  ['small park', 'park_small', BF.Plopped, {}],
  ['troubled courtyard', 'res_courtyard.r2.5', BF.Powered | BF.NeedsUnmet | BF.Noisy | BF.Crime | BF.Polluted | BF.NoGarbage | BF.NoJobs | BF.Congested | BF.Historic, { pop: 400, health: 0.5 }],
  ['courtyard on fire', 'res_courtyard.r2.5', BF.OnFire | BF.Incident | BF.Powered | BF.Watered, { pop: 400, health: 0.8 }],
  ['corner store without road', 'com_corner_store.cs1.1', BF.NoRoad | BF.Powered, { jobs: 3 }],
  ['wind turbine on a piped cell', 'util_wind_turbine', BF.Plopped | BF.Powered | BF.Watered, { jobs: 1 }],
];

function town(): { st: CityState; sim: Simulation; by: Map<string, Building> } {
  const st = newState(64);
  roadLine(st, 2, 20, 61, 20, Network.Road);
  roadLine(st, 2, 40, 61, 40, Network.Road);
  const list: Building[] = [];
  SCENARIOS.forEach(([, def, flags, opts], k) => {
    const x = 2 + (k % 6) * 9, z = k < 6 ? 21 : 41;
    const b = place(st, def, x, z, opts);
    if (!(flags & BF.Plopped)) for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) st.zone[st.idx(xx, zz)] = def.startsWith('com') ? Zone.ComLow : def.includes('r2.') ? Zone.ResHigh : Zone.ResLow;
    list.push(b);
  });
  const sim = new Simulation(st, createSystems());
  // (the systems' first pass rewrites flags and stats: the scenario's own come after it)
  list.forEach((b, k) => { b.flags = SCENARIOS[k][2]; });
  st.funds = 1e6;
  st.stats.population = 120000;
  return { st, sim, by: new Map(list.map((b, k) => [SCENARIOS[k][0], b])) };
}

function panelCtx(sim: Simulation): GameContext {
  return {
    get state() { return sim.state; }, sim, host: queryHost(sim), signal: new AbortController().signal,
    actions: {}, objects: { setSelected: () => undefined }, panels: { close: () => undefined, open: () => undefined },
    tools: { select: () => true }, focusCell: () => undefined, showQuery: () => undefined, sandbox: () => false, sound: () => undefined, toast: () => undefined,
  } as unknown as GameContext;
}

/** the inspector of b, rendered: its chips (class, title, markup) and its main problem line */
function inspector(sim: Simulation, b: Building): { chips: { cls: string; title: string; html: string; text: string }[]; problem: { cls: string; text: string } | null } {
  const panel = new InfoPanel(panelCtx(sim));
  panel.mount(() => undefined, () => undefined, () => undefined);
  panel.show({ buildingId: b.id, x: b.x, z: b.z });
  const body = panel.body as unknown as FEl;
  const flags = body.querySelectorAll('.flags')[0];
  const chips = flags ? flags.children.map((c) => ({ cls: c.className, title: c.title, html: c.innerHTML, text: textOf(c) })) : [];
  const p = body.querySelectorAll('.ins-problem')[0];
  return { chips, problem: p ? { cls: p.className, text: textOf(p.querySelectorAll('.pt')[0]) } : null };
}

/** the inspector's icons as short tokens, so the goldens read */
const tokens = (html: string) => html.replaceAll(icon('power', 11), '{power}').replaceAll(icon('water', 11), '{water}');

/** what InfoPanel rendered on dev 95f6e15 (before the move) for each scenario: class, title, markup */
const GOLDEN: Record<string, [string, string, string][]> = {
  'unpowered shack': [['chip bad', '', '{power}No power']],
  'abandoned cottage': [['chip good', '', '{power}Powered'], ['chip good', '', '{water}Water'], ['chip bad', '', 'Abandoned']],
  'tower under construction': [['chip good', '', '{power}Powered'], ['chip good', '', '{water}Water'], ['chip info', '', 'Under construction 60%']],
  'thriving tower': [['chip good', '', '{power}Powered'], ['chip good', '', '{water}Water']],
  'ruin with an emergency': [['chip bad', '', 'Emergency here']],
  'school without water, understaffed': [['chip good', '', '{power}Powered'], ['chip warn', 'This building needs piped water', '{water}No water'], ['chip warn', '', 'Understaffed']],
  'coal plant': [['chip good', '', '{water}Water']],
  'small park': [],
  'troubled courtyard': [
    ['chip good', '', '{power}Powered'], ['chip warn', 'This building needs piped water', '{water}No water'], ['chip warn', '', 'No jobs'], ['chip warn', '', 'Congested'],
    ['chip warn', '', 'Polluted'], ['chip warn', '', 'Noisy'], ['chip warn', '', 'High crime'], ['chip warn', '', 'Garbage piling up'], ['chip info', '', 'Historic'],
    ['chip warn', 'Some residents lack a school, clinic, playground… (see Residents)', 'Needs unmet'],
  ],
  'courtyard on fire': [['chip good', '', '{power}Powered'], ['chip good', '', '{water}Water'], ['chip bad', '', 'On fire!'], ['chip bad', '', 'Emergency here']],
  'corner store without road': [['chip good', '', '{power}Powered'], ['chip bad', '', 'No road access']],
  'wind turbine on a piped cell': [],
};

// ------------------------------------------------------------------------------------------------ the old chip code
/** InfoPanel's chip code as it stood on dev 95f6e15 (`FLAG_CHIPS` :45-60 and the chips block :337-354), frozen */
const OLD_FLAG_CHIPS: [number, string, Chip['cls'], Chip['topic']?][] = [
  [BF.Abandoned, 'Abandoned', 'bad'],
  [BF.OnFire, 'On fire!', 'bad', 'fire'],
  [BF.Burnt, RUINS_TEXT, 'bad', 'burnt'],
  [BF.Incident, 'Emergency here', 'bad'],
  [BF.NoRoad, 'No road access', 'bad', 'road'],
  [BF.Understaffed, 'Understaffed', 'warn', 'staff'],
  [BF.NoJobs, 'No jobs', 'warn'],
  [BF.Congested, 'Congested', 'warn'],
  [BF.Polluted, 'Polluted', 'warn'],
  [BF.Noisy, 'Noisy', 'warn'],
  [BF.Crime, 'High crime', 'warn'],
  [BF.NoGarbage, 'Garbage piling up', 'warn'],
  [BF.Historic, 'Historic', 'info'],
];
interface OldInput { poweredCell: boolean; wateredCell: boolean; defUsesPower: boolean; growable: boolean; waterRequired: boolean; needsExpectation: number }
function oldChips(flags: number, built: number, c: OldInput): Chip[] {
  const chips: Chip[] = [];
  const ruin = !!(flags & BF.Burnt);
  const powered = !!(flags & BF.Powered) || c.poweredCell;
  const watered = !!(flags & BF.Watered) || c.wateredCell;
  const usesPower = !ruin && c.defUsesPower;
  if (usesPower) chips.push({ text: icon('power', 11) + (powered ? 'Powered' : 'No power'), cls: powered ? 'good' : 'bad', topic: 'power' });
  const needW = !ruin && c.waterRequired;
  if (watered && !ruin && (c.growable || needW)) chips.push({ text: icon('water', 11) + 'Water', cls: 'good', topic: 'water' });
  else if (needW) chips.push({ text: icon('water', 11) + 'No water', cls: 'warn', topic: 'water', title: 'This building needs piped water' });
  if (!ruin && (built < 1 || flags & BF.Constructing)) chips.push({ text: `Under construction ${Math.round(built * 100)}%`, cls: 'info' });
  for (const [bit, label, cls, topic] of OLD_FLAG_CHIPS) if (flags & bit && (!ruin || bit & (BF.Burnt | BF.Incident))) chips.push({ text: label, cls, topic });
  if (flags & BF.NeedsUnmet && !ruin) {
    const exp = c.needsExpectation;
    chips.push({ text: 'Needs unmet', cls: exp > 0.01 ? 'warn' : 'info', title: exp > 0.01 ? 'Some residents lack a school, clinic, playground… (see Residents)' : 'Residents of a small town do not mind yet — they will as the city grows' });
  }
  return chips;
}
/** a chip as the inspector draws it (InfoPanel.chips) */
const drawn = (c: Chip) => ({ html: (c.icon ? icon(c.icon, 11) : '') + c.text, cls: c.cls, title: c.title, topic: c.topic });
const drawnOld = (c: Chip) => ({ html: c.text, cls: c.cls, title: c.title, topic: c.topic });

describe('the shared chip table: the inspector looks exactly as before', () => {
  it('buildingChips equals the old InfoPanel code for every flag combination, utility cell, water need and town size', () => {
    const bits = Object.values(BF).reduce((a, b) => a | b, 0);
    expect(bits).toBe((1 << 18) - 1);
    let checked = 0;
    for (let f = 0; f <= bits; f++) {
      const v = f % 64; // (the context variants rotate through the flag combinations)
      const c: OldInput = { poweredCell: !!(v & 1), wateredCell: !!(v & 2), defUsesPower: !!(v & 4), growable: !!(v & 8), waterRequired: !!(v & 16), needsExpectation: v & 32 ? 1 : 0 };
      const built = (f >> 6) % 3 === 0 ? 0.6 : 1;
      const ctx: ChipContext = { poweredCell: c.poweredCell, wateredCell: c.wateredCell, usesPower: c.defUsesPower, growable: c.growable, needsWater: c.waterRequired, needsExpectation: c.needsExpectation };
      const now = buildingChips(f, built, ctx).map(drawn), before = oldChips(f, built, c).map(drawnOld);
      if (JSON.stringify(now) !== JSON.stringify(before)) expect(now, `flags ${f}, variant ${v}, built ${built}`).toEqual(before);
      checked++;
    }
    expect(checked).toBe(1 << 18);
  });

  it('drawsPower is the old usesPower rule for every catalog def', () => {
    for (const def of CATALOG) {
      const growable = def.category === 'growable';
      const isPlant = (def.powerOut ?? 0) > 0;
      expect(drawsPower(def, growable), def.id).toBe(growable || (!isPlant && (def.category !== 'park' || (def.powerUse ?? 0) > 0)));
    }
    expect(drawsPower(undefined, true)).toBe(true);
    expect(drawsPower(undefined, false)).toBe(false);
  });

  it('the rendered inspector chips of twelve buildings equal what dev rendered before the move', () => {
    const { sim, by } = town();
    for (const [name] of SCENARIOS) {
      const got = inspector(sim, by.get(name)!).chips.map((c) => [c.cls, c.title, tokens(c.html)]);
      expect(got, name).toEqual(GOLDEN[name]);
    }
  });
});

// ------------------------------------------------------------------------------------------------ the status line
const ALL_PROBLEMS = BF.OnFire | BF.Incident | BF.Abandoned | BF.NoRoad | BF.Understaffed | BF.NoGarbage | BF.Noisy | BF.Polluted | BF.NeedsUnmet | BF.Crime | BF.NoJobs | BF.Congested;
/** the flag change that clears each line (power and water clear by being supplied) */
const CLEAR: Record<string, (f: number) => number> = {
  'On fire!': (f) => f & ~BF.OnFire, 'Emergency here': (f) => f & ~BF.Incident, Abandoned: (f) => f & ~BF.Abandoned, 'No road access': (f) => f & ~BF.NoRoad,
  'No power': (f) => f | BF.Powered, 'No water': (f) => f | BF.Watered, Understaffed: (f) => f & ~BF.Understaffed, 'Garbage piling up': (f) => f & ~BF.NoGarbage,
  Noisy: (f) => f & ~BF.Noisy, Polluted: (f) => f & ~BF.Polluted, 'Needs unmet': (f) => f & ~BF.NeedsUnmet, 'High crime': (f) => f & ~BF.Crime,
  'No jobs': (f) => f & ~BF.NoJobs, Congested: (f) => f & ~BF.Congested,
};

describe('hoverStatus: one line, in priority order, in the chip\'s words and tone', () => {
  const growable: ChipContext = { needsWater: true, needsExpectation: 1 };

  it('the priority order: the plan\'s list in order, an emergency with the fire, then No jobs and Congested; then Thriving', () => {
    let flags = ALL_PROBLEMS | BF.Historic;
    const seen: string[] = [];
    for (let k = 0; k < 20; k++) {
      const s = hoverStatus(flags, 1, 0.95, growable);
      if (!s) break;
      seen.push(s.text);
      if (s.text === THRIVING_TEXT) break;
      flags = CLEAR[s.text](flags);
    }
    expect(seen).toEqual(['On fire!', 'Emergency here', 'Abandoned', 'No road access', 'No power', 'No water', 'Understaffed', 'Garbage piling up', 'Noisy',
      'Polluted', 'Needs unmet', 'High crime', 'No jobs', 'Congested', THRIVING_TEXT]);
    // the plan's order (POLISH_PLAN FEEL-19, T064: On fire, Abandoned, No road, No power, No water, Understaffed, garbage,
    // noise, polluted, needs, crime) holds as written
    const plan = ['On fire!', 'Abandoned', 'No road access', 'No power', 'No water', 'Understaffed', 'Garbage piling up', 'Noisy', 'Polluted', 'Needs unmet', 'High crime'];
    expect(seen.filter((t) => plan.includes(t))).toEqual(plan);
    // every problem chip of the table has a place in the order; the info chips and Powered / Water have none
    const problemKeys = FLAG_CHIPS.filter((c) => c.cls !== 'info').map((c) => c.key);
    for (const k of [...problemKeys, 'power', 'water', 'needs', 'construction'] as const) expect(HOVER_ORDER, k).toContain(k);
    expect(HOVER_ORDER).not.toContain('historic');
  });

  it('each line is the chip\'s own text and class (No power: the chip\'s bad tone; Abandoned: bad; Noisy: warn)', () => {
    for (const [flags, ctx, text] of [
      [0, growable, 'No power'], [BF.Abandoned | BF.Powered | BF.Watered, growable, 'Abandoned'], [BF.Powered | BF.Watered | BF.Noisy, growable, 'Noisy'],
      [BF.Powered, growable, 'No water'], [BF.Powered | BF.Watered | BF.NeedsUnmet, growable, 'Needs unmet'],
    ] as const) {
      const s = hoverStatus(flags, 1, 0.5, ctx)!;
      const chip = buildingChips(flags, 1, ctx).find((c) => c.text === text)!;
      expect(s).toEqual({ text, tone: chip.cls });
    }
    expect(hoverStatus(0, 1, 1, growable)).toEqual({ text: CHIP_TEXT.noPower, tone: 'bad' });
    expect(hoverStatus(BF.Abandoned | BF.Powered, 1, 1, {})).toEqual({ text: 'Abandoned', tone: 'bad' });
  });

  it('"Thriving": a growable with no problem chip from condition 90 %; never a plopped building or an unknown condition', () => {
    const ok = BF.Powered | BF.Watered;
    expect(THRIVING_CONDITION).toBe(0.9);
    expect(hoverStatus(ok, 1, 0.9, growable)).toEqual({ text: 'Thriving', tone: 'good' });
    expect(hoverStatus(ok, 1, 0.899, growable)).toBeNull();
    expect(hoverStatus(ok, 1, undefined, growable)).toBeNull();
    expect(hoverStatus(ok, 1, null, growable)).toBeNull();
    // (a plopped building keeps health 1 from the day it is placed)
    expect(hoverStatus(BF.Plopped | ok, 1, 1, { growable: false })).toBeNull();
    // info chips are no problem: Historic, and a small town's unmet need
    expect(hoverStatus(ok | BF.Historic, 1, 0.95, growable)?.text).toBe('Thriving');
    expect(hoverStatus(ok | BF.NeedsUnmet, 1, 0.95, { ...growable, needsExpectation: 0 })?.text).toBe('Thriving');
    expect(hoverStatus(ok | BF.NeedsUnmet, 1, 0.95, growable)).toEqual({ text: 'Needs unmet', tone: 'warn' });
  });

  it('"Under construction 60%" while it is built (an emergency still comes first); a ruin reads "In ruins"', () => {
    const building = BF.Constructing | BF.Powered | BF.Watered;
    expect(constructionText(0.6)).toBe('Under construction 60%');
    expect(hoverStatus(building, 0.6, 0.6, growable)).toEqual({ text: 'Under construction 60%', tone: 'info' });
    expect(hoverStatus(BF.Constructing, 0.25, 0.6, growable)).toEqual({ text: 'Under construction 25%', tone: 'info' });
    expect(hoverStatus(BF.Powered | BF.Watered, 0.5, 0.6, growable)?.text).toBe('Under construction 50%');
    expect(hoverStatus(building | BF.NoRoad | BF.Noisy, 0.6, 0.6, growable)?.text).toBe('Under construction 60%');
    expect(hoverStatus(building | BF.OnFire, 0.6, 0.6, growable)?.text).toBe('On fire!');
    expect(hoverStatus(building | BF.Incident, 0.6, 0.6, growable)?.text).toBe('Emergency here');
    // a ruin: its own chip, never the stale ones of the building it was (no power chip either)
    expect(hoverStatus(BF.Burnt | BF.NoGarbage | BF.NeedsUnmet | BF.Abandoned, 1, 1, growable)).toEqual({ text: RUINS_TEXT, tone: 'bad' });
    expect(hoverStatus(BF.Burnt | BF.Incident, 1, 1, growable)?.text).toBe(RUINS_TEXT);
  });

  it('the tip classes follow the tone: bad red, warn amber, good green, info dim', () => {
    expect(TIP_LINE).toEqual({ good: 'tip-ok', warn: 'tip-warn', bad: 'tip-reason', info: 'tip-sub' });
    expect(TIP_KIND).toEqual({ good: 'ok', warn: 'info', bad: 'bad', info: 'info' });
  });
});

// ------------------------------------------------------------------------------------------------ the Query hover
interface Tip { html: string; kind: string }
function hoverTool(st: () => CityState, host: unknown): { tool: QueryTool; tips: Tip[]; at: (b: Building) => ToolPointer; under: { id: number | null } } {
  const tips: Tip[] = [], under = { id: null as number | null };
  const ctx = {
    get state() { return st(); },
    host, overlay: 0, overlayVariant: 0,
    objects: { pickBuilding: () => under.id, setSelected: () => undefined },
    tip: { show: (html: string, kind = 'info') => tips.push({ html, kind }), hide: () => undefined },
  } as unknown as GameContext;
  const tool = new QueryTool(ctx);
  const at = (b: Building): ToolPointer => {
    under.id = b.id;
    return { clientX: 1, clientY: 1, hit: { x: b.x, z: b.z } as ToolPointer['hit'], shift: false, ctrl: false, alt: false, down: false };
  };
  return { tool, tips, at, under };
}
/** the tip's status line: its class and text (the line under the name that is not the occupancy line), or null */
function statusLine(tip: Tip | undefined): { cls: string; text: string } | null {
  const lines = [...(tip?.html ?? '').matchAll(/<div class="(tip-[a-z]+)">([^<]*)<\/div>/g)].map((m) => ({ cls: m[1], text: m[2] }))
    .filter((l) => l.cls !== 'tip-head' && !/ (residents|jobs)$/.test(l.text));
  return lines.at(-1) ?? null;
}
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe('the Query hover shows the line (default host)', () => {
  it('an unpowered shack shows "No power" in its chip\'s tone, an abandoned building "Abandoned", a tower being built its progress, a thriving tower "Thriving"', async () => {
    const { sim, by } = town();
    const h = hoverTool(() => sim.state, queryHost(sim));
    const hover = async (name: string) => {
      h.tool.leave();
      h.tool.move(h.at(by.get(name)!));
      await settle();
      return h.tips.at(-1)!;
    };
    let tip = await hover('unpowered shack');
    expect(tip.html).toContain('<b>Shack</b>');
    expect(tip.html).toContain('4 residents');
    expect(statusLine(tip)).toEqual({ cls: 'tip-reason', text: 'No power' });
    expect(tip.kind).toBe('bad');
    tip = await hover('abandoned cottage');
    expect(statusLine(tip)).toEqual({ cls: 'tip-reason', text: 'Abandoned' });
    tip = await hover('tower under construction');
    expect(statusLine(tip)).toEqual({ cls: 'tip-sub', text: 'Under construction 60%' });
    expect(tip.kind).toBe('info');
    tip = await hover('thriving tower');
    expect(statusLine(tip)).toEqual({ cls: 'tip-ok', text: 'Thriving' });
    expect(tip.kind).toBe('ok');
    // a ruin keeps its old markup: "In ruins", and no stale residents / jobs
    tip = await hover('ruin with an emergency');
    expect(tip.html).toContain(`<div class="tip-reason">${RUINS_TEXT}</div>`);
    expect(tip.html).not.toMatch(/residents|jobs/);
    // a plopped building with nothing wrong: name and jobs only
    tip = await hover('coal plant');
    expect(statusLine(tip)).toBeNull();
    expect(tip.html).toContain('180 / 180 jobs');
  });

  it('the hover text equals the inspector: each line is one of the building\'s rendered chips (or the ruin\'s main problem), with that chip\'s class', async () => {
    const { sim, by } = town();
    const h = hoverTool(() => sim.state, queryHost(sim));
    const expected: Record<string, string | null> = {
      'unpowered shack': 'No power', 'abandoned cottage': 'Abandoned', 'tower under construction': 'Under construction 60%', 'thriving tower': 'Thriving',
      'ruin with an emergency': RUINS_TEXT, 'school without water, understaffed': 'No water', 'coal plant': null, 'small park': null,
      'troubled courtyard': 'No water', 'courtyard on fire': 'On fire!', 'corner store without road': 'No road access', 'wind turbine on a piped cell': null,
    };
    for (const [name] of SCENARIOS) {
      const b = by.get(name)!;
      h.tool.leave();
      h.tool.move(h.at(b));
      await settle();
      const line = statusLine(h.tips.at(-1));
      expect(line?.text ?? null, name).toBe(expected[name]);
      if (!line || line.text === THRIVING_TEXT) continue;
      const tone = (Object.keys(TIP_LINE) as Chip['cls'][]).find((t) => TIP_LINE[t] === line.cls)!;
      const ins = inspector(sim, b);
      const shown = [...ins.chips.map((c) => ({ cls: c.cls, text: c.text })), ...(ins.problem ? [{ cls: ins.problem.cls.replace('ins-problem', 'chip'), text: ins.problem.text }] : [])];
      expect(shown, name).toContainEqual({ cls: `chip ${tone}`, text: line.text });
    }
  });
});

describe('the line is cached per building per sim day', () => {
  it('HoverStatusCache: one line per building per day and inputs; a new day or a flag change works it out again', () => {
    const cache = new HoverStatusCache();
    let n = 0;
    const line = (t: string) => () => { n++; return { text: t, tone: 'warn' as const }; };
    for (let k = 0; k < 1000; k++) cache.get(7, 100, 1, line('a'));
    expect(n).toBe(1);
    expect(cache.get(7, 100, 1, line('b'))?.text).toBe('a');
    expect(cache.get(8, 100, 1, line('c'))?.text).toBe('c');
    expect(cache.get(7, 100, 2, line('d'))?.text).toBe('d'); // (a flag flipped while paused)
    expect(cache.get(7, 101, 2, line('e'))?.text).toBe('e'); // (the next day)
    expect(cache.get(8, 101, 1, line('f'))?.text).toBe('f'); // (yesterday's lines are gone)
    expect(n).toBe(5);
    expect(cache.computed).toBe(5);
  });

  it('the hover: the same line all day although its condition moves; the next day reads it again; one condition request per building per day', async () => {
    const { sim, by } = town();
    const base = queryHost(sim);
    const asked: number[] = [];
    const host = { ...base, query: (name: string, args: { id: number }) => { if (name === 'buildingCondition') asked.push(args.id); return base.query(name as never, args as never); } };
    const h = hoverTool(() => sim.state, host);
    const tower = by.get('thriving tower')!;
    const hover = async () => { h.tool.leave(); h.tool.move(h.at(tower)); await settle(); return statusLine(h.tips.at(-1)); };
    expect(await hover()).toEqual({ cls: 'tip-ok', text: 'Thriving' });
    for (let k = 0; k < 50; k++) await hover();
    expect(asked).toEqual([tower.id]);
    // its condition falls within the day: the line holds until the day turns
    tower.health = 0.5;
    expect(await hover()).toEqual({ cls: 'tip-ok', text: 'Thriving' });
    sim.state.day++;
    expect(await hover()).toBeNull();
    expect(asked).toEqual([tower.id, tower.id]);
    // a flag that flips within the day (power cut while paused) shows at once
    tower.flags &= ~BF.Powered;
    expect(await hover()).toEqual({ cls: 'tip-reason', text: 'No power' });
    // a building with a problem never asks for its condition
    const shack = by.get('unpowered shack')!;
    h.tool.leave(); h.tool.move(h.at(shack)); await settle();
    expect(asked).toEqual([tower.id, tower.id]);
  });

  it('the condition\'s answer shows the tip again while the cursor rests on the building, and not after it left', async () => {
    const { sim, by } = town();
    const base = queryHost(sim);
    const pending: (() => void)[] = [];
    const host = { ...base, query: (name: string, args: never) => new Promise((r) => pending.push(() => r(base.query(name as never, args)))) };
    const h = hoverTool(() => sim.state, host);
    const tower = by.get('thriving tower')!;
    h.tool.move(h.at(tower));
    expect(statusLine(h.tips.at(-1))).toBeNull(); // (no answer yet)
    const before = h.tips.length;
    pending.shift()!();
    await settle();
    expect(h.tips.length).toBe(before + 1);
    expect(statusLine(h.tips.at(-1))).toEqual({ cls: 'tip-ok', text: 'Thriving' });
    // the cursor leaves before the next day's answer: no tip comes back
    sim.state.day++;
    h.tool.leave(); h.tool.move(h.at(tower));
    h.tool.leave();
    const n = h.tips.length;
    pending.shift()!();
    await settle();
    expect(h.tips.length).toBe(n);
  });
});

// ------------------------------------------------------------------------------------------------ worker host (stand-in for ?simworker=1)
describe('the worker host: the line from the replica equals the default host\'s', () => {
  it('a loopback worker host: exact flags give the same lines; the condition comes by query, so a stale replica health cannot say "Thriving"', { timeout: 120000 }, async () => {
    const { st, by } = town();
    // a second growable doing well, whose condition will rise without a record going out
    const shack = place(st, 'res_shack.r1.1', 40, 41, { pop: 5, health: 0.6 });
    st.zone[st.idx(40, 41)] = Zone.ResLow;
    let now = 0;
    const host = new LoopbackSimHost(st, { now: () => now, loopback: { cadence: 'design' } });
    hosts.push(host);
    await host.start();
    const sim = host.harness.core.sim, primary = sim.state;
    // the scenario's flags on the authoritative side, announced as the systems announce theirs (buildingChanged)
    const scenario = new Map<number, number>([...SCENARIOS.map(([name, , flags]) => [by.get(name)!.id, flags] as const), [shack.id, BF.Powered | BF.Watered]]);
    for (const [id, flags] of scenario) { const b = primary.buildings.get(id)!; b.flags = flags; sim.events.emit('buildingChanged', b); }
    primary.stats.population = 120000;
    host.harness.flush(true);
    await host.drain();
    // then two conditions move the way the population pass moves them: silently (health is a lagged field)
    const tower = by.get('thriving tower')!;
    primary.buildings.get(tower.id)!.health = 0.5;
    primary.buildings.get(shack.id)!.health = 0.95;
    now += 1000;
    host.harness.flush(true);
    await host.drain();
    const replica = host.state as unknown as CityState, live = host.harness.delivered;
    expect(replica).not.toBe(live);
    expect(replica.buildings.get(tower.id)!.health).toBe(0.95); // (stale: its record went out before the change)
    expect(replica.buildings.get(shack.id)!.health).toBe(0.6);
    const lines = async (h: ReturnType<typeof hoverTool>, s: CityState) => {
      const ids = [...scenario.keys()];
      for (const id of ids) { h.tool.leave(); h.tool.move(h.at(s.buildings.get(id)!)); }
      await host.drain(); await settle();
      const out: Record<number, string | null> = {};
      for (const id of ids) { h.tool.leave(); h.tool.move(h.at(s.buildings.get(id)!)); const x = statusLine(h.tips.at(-1)); out[id] = x ? `${x.cls}:${x.text}` : null; }
      return out;
    };
    const fromWorker = await lines(hoverTool(() => replica, host), replica);
    const fromLive = await lines(hoverTool(() => live, queryHost(sim)), live);
    expect(fromWorker).toEqual(fromLive);
    expect(fromWorker[tower.id]).toBeNull();
    expect(fromWorker[shack.id]).toBe('tip-ok:Thriving');
    expect(fromWorker[by.get('unpowered shack')!.id]).toBe('tip-reason:No power');
    expect(fromWorker[by.get('tower under construction')!.id]).toBe('tip-sub:Under construction 60%');
    // what reading the replica's own health would have said: the opposite on both
    const r = (id: number) => { const b = replica.buildings.get(id)!; return hoverStatus(b.flags, b.built, b.health, {})?.text ?? null; };
    expect([r(tower.id), r(shack.id)]).toEqual([THRIVING_TEXT, null]);
  });
});

// ------------------------------------------------------------------------------------------------ cost
describe('the tip costs at most 0.2 ms', () => {
  it('median of 1,000 hovers over distinct buildings (the line worked out, the condition asked), and of 1,000 cached ones', { timeout: 120000 }, async () => {
    const { st } = stressCity(128);
    const host = new LocalSimHost(st);
    hosts.push(host);
    await host.start();
    const h = hoverTool(() => host.state as unknown as CityState, host);
    const all = [...host.state.buildings.values()];
    expect(all.length).toBeGreaterThanOrEqual(1000);
    const pts = all.slice(0, 1000).map((b) => h.at(b));
    const time = (list: ToolPointer[]): number[] => list.map((p) => {
      h.under.id = host.state.building[host.state.idx(p.hit!.x, p.hit!.z)];
      const t0 = performance.now();
      h.tool.move(p);
      return performance.now() - t0;
    });
    // warm-up (the JIT), then a fresh day, so every timed hover works its line out
    time(pts.slice(0, 200));
    await settle();
    host.state.day++;
    const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
    const first = median(time(pts));
    await settle();
    // the same 1,000 again later in the second (lastCell differs per building): cached lines
    const cached = median(time(pts));
    process.stderr.write(`[FEEL-19 tip cost] median of 1,000 hovers: first ${(first * 1000).toFixed(1)} µs, cached ${(cached * 1000).toFixed(1)} µs\n`);
    expect(first).toBeLessThanOrEqual(0.2);
    expect(cached).toBeLessThanOrEqual(0.2);
  });
});
