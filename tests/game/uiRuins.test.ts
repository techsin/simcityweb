/**
 * Final fixes r3 (lane ui): ruins were misreported (veteran r3 shots 018 / 019, playtest, newplayer #11, veteran #6,
 * LD21c).
 *  (a) a ruined Giant Observation Wheel's inspector read "Income +§400/mo" in green and the ruined Missile Test Range
 *      "+§2,500/mo": the header fell back to the catalog income. A ruin earns nothing (headerIncome);
 *  (b) tornado, quake and meteor ruins read "Burnt down": BF.Burnt records no cause, so the inspector says "In ruins"
 *      (the chip, the rubble line — tests/game/uiRubble.test.ts — and the facility warning's topic);
 *  (c) the Rewards panel read "Built" for a reward whose only building is a ruin: "In ruins — bulldoze to rebuild",
 *      from exact mirrored building flags, with a button to the ruin instead of a Place that is refused;
 *  (d) a ruin's header showed rows that look live: the Powered chip and "Jobs filled 0 / 40".
 */
import { describe, expect, it, vi } from 'vitest';
import { Network } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import { facilityReport } from '../../src/sim/infra/facilities';
import { listRewards } from '../../src/sim/economy/rewards';
import { normalizeReward } from '../../src/game/modules';
import type { GameContext } from '../../src/game/context';
import { queryHost } from './queryHost';
import { InfoPanel } from '../../src/ui/panels/InfoPanel';
import { REWARD_RUIN_TEXT, RewardsPanel, rewardRuin, ruinState } from '../../src/ui/panels/ListPanels';
import { RUINS_TEXT, dedupeChips, facilityView, headerIncome, splitFacilityRows, warningTopic, type Chip } from '../../src/ui/inspectorModel';
import { CityActions } from '../../src/sim/actions';
import { removeBuilding } from '../../src/sim/economy/buildings';
import { UNIQUE_BUILT_TEXT, UNIQUE_RUINS_TEXT, findToolSpec } from '../../src/game/toolCatalog';
import { ToolController } from '../../src/game/tools/ToolController';
import { QueryTool } from '../../src/game/tools/QueryTool';
import type { ToolPointer } from '../../src/game/tools/Tool';
import { newState, place, roadLine } from '../infra/cityGen';
import { type FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();

// ------------------------------------------------------------------------------------------------ harness
interface Calls { focus: [number, number][]; query: unknown[]; closed: string[]; selected: string[]; toasts: string[]; order: string[] }
function ctxOf(sim: Simulation): { ctx: GameContext; calls: Calls } {
  const calls: Calls = { focus: [], query: [], closed: [], selected: [], toasts: [], order: [] };
  const ctx = {
    get state() { return sim.state; },
    sim,
    host: queryHost(sim),
    signal: new AbortController().signal,
    mods: { listRewards: (s: CityState) => listRewards(s).map(normalizeReward) },
    actions: { bulldoze: () => ({ ok: true, cost: 30 }) },
    objects: { setSelected: () => undefined },
    panels: { close: (id: string) => { calls.closed.push(id); calls.order.push('close'); }, open: () => undefined },
    tools: { select: (id: string) => { calls.selected.push(id); return true; } },
    focusCell: (x: number, z: number) => { calls.focus.push([x, z]); calls.order.push('focus'); },
    showQuery: (t: unknown) => { calls.query.push(t); calls.order.push('query'); },
    sandbox: () => false,
    sound: () => undefined,
    toast: (t: string) => calls.toasts.push(t),
  } as unknown as GameContext;
  return { ctx, calls };
}

/** a street along z = 20 powered by a coal plant, with a Giant Observation Wheel, a Missile Test Range and a home */
function town(): { st: CityState; sim: Simulation; wheel: Building; range: Building; home: Building } {
  const st = newState(64);
  roadLine(st, 2, 20, 61, 20, Network.Road);
  place(st, 't_coal', 2, 18, { flags: BF.Plopped });
  const wheel = place(st, 'lm_ferris_wheel', 6, 21, { flags: BF.Plopped | BF.Powered });
  const range = place(st, 'rw_missile_range', 20, 21, { flags: BF.Plopped | BF.Powered | BF.Watered });
  const home = place(st, 't_r2', 40, 21, { pop: 0, flags: BF.Powered | BF.Watered });
  st.milestones.lm_ferris_wheel = 1;
  st.milestones.rw_missile_range = 1;
  st.funds = 1e6;
  st.stats.population = 120000;
  const sim = new Simulation(st, createSystems());
  return { st, sim, wheel, range, home };
}

/** the inspector of building b, rendered */
function inspect(sim: Simulation, b: Building): { panel: InfoPanel; body: FEl; text: string } {
  const { ctx } = ctxOf(sim);
  const panel = new InfoPanel(ctx);
  panel.mount(() => undefined, () => undefined, () => undefined);
  panel.show({ buildingId: b.id, x: b.x, z: b.z });
  const body = panel.body as unknown as FEl;
  return { panel, body, text: textOf(body) };
}
const part = (body: FEl, sel: string) => body.querySelectorAll(sel).map(textOf).join(' | ');

// ------------------------------------------------------------------------------------------------ the model
describe('inspector model: a ruin earns nothing, in cause-neutral words', () => {
  it('headerIncome: never the catalog income for a ruin, the report\'s line when it has one', () => {
    const wheel = getDef('lm_ferris_wheel')!, range = getDef('rw_missile_range')!;
    expect(wheel.income).toBe(400);
    expect(range.income).toBe(2500);
    // the sim's line for a ruin (facilities.ts: "none — in ruins", status bad) as it is
    expect(headerIncome(range, { key: 'income', label: 'Deal income', value: 'none — in ruins', status: 'bad' }, true)).toEqual({ label: 'Deal income', value: 'none — in ruins', tone: 'neg' });
    // no line at all (an older report, or the report failed): still none, never "+§400/mo"
    expect(headerIncome(wheel, null, true)).toEqual({ label: 'Income', value: 'none — in ruins', tone: 'neg' });
    expect(headerIncome(range, null, true)).toEqual({ label: 'Deal income', value: 'none — in ruins', tone: 'neg' });
    // a live-looking line on a ruin is overruled
    expect(headerIncome(wheel, { key: 'income', label: 'Income', value: '§400 / month' }, true)).toEqual({ label: 'Income', value: 'none — in ruins', tone: 'neg' });
    // a standing building: the report's actual income, else the catalog's (as before)
    expect(headerIncome(wheel, { key: 'income', label: 'Income', value: '§260 / month', hint: 'h' }, false)).toEqual({ label: 'Income', value: '+§260/mo', tone: 'pos', hint: 'h' });
    expect(headerIncome(wheel, { key: 'income', label: 'Income', value: 'none while it has no power', status: 'bad' }, false)).toEqual({ label: 'Income', value: 'none while it has no power', tone: 'neg' });
    expect(headerIncome(wheel, null, false)).toEqual({ label: 'Income', value: '+§400/mo', tone: 'pos' });
    expect(headerIncome({ category: 'fire' }, null, true)).toBeNull();
  });

  it('"In ruins": the facility warning\'s topic, so the ruin chip is not shown twice', () => {
    expect(RUINS_TEXT).toBe('In ruins');
    expect(warningTopic('In ruins — bulldoze it and build it again')).toBe('burnt');
    expect(warningTopic('Burnt down — bulldoze it and build it again')).toBe('burnt');
    const chips: Chip[] = [{ text: RUINS_TEXT, cls: 'bad', topic: 'burnt' }, { text: 'Emergency here', cls: 'bad' }];
    expect(dedupeChips(chips, ['In ruins — bulldoze it and build it again']).map((c) => c.text)).toEqual(['Emergency here']);
  });

  it('the sim\'s report of a ruined venue / deal: the same words, and an income line the header shows', () => {
    const { sim, wheel, range } = town();
    wheel.flags |= BF.Burnt;
    range.flags |= BF.Burnt;
    for (const [b, label] of [[wheel, 'Income'], [range, 'Deal income']] as const) {
      const rep = facilityView(facilityReport(sim, b.id))!;
      expect(rep.warnings[0].startsWith(`${RUINS_TEXT} — `)).toBe(true);
      const inc = splitFacilityRows(rep.rows).income;
      expect(inc?.label).toBe(label);
      expect(headerIncome(getDef(b.def)!, inc, true)).toEqual({ label, value: 'none — in ruins', tone: 'neg' });
    }
  });
});

// ------------------------------------------------------------------------------------------------ the inspector
describe('inspector of a ruin (InfoPanel): nothing that reads as a live building', () => {
  it('a ruined landmark: "In ruins", no income in green, no Powered chip, no "Jobs filled" bar; its upkeep still charged', () => {
    const { sim, wheel } = town();
    // standing first: the power chip, the jobs bar and an income row
    const live = inspect(sim, wheel);
    expect(live.text).not.toContain('Nothing to show here');
    expect(part(live.body, '.flags')).toMatch(/Powered/);
    expect(live.body.querySelectorAll('.cap-bar').length).toBe(1);
    expect(live.text).toMatch(/Income/);
    // flattened (a tornado, a quake, a meteor or a fire: BF.Burnt either way)
    wheel.flags |= BF.Burnt;
    const r = inspect(sim, wheel);
    expect(r.text).not.toContain('Nothing to show here');
    expect(r.text).not.toContain('Burnt down');
    expect(part(r.body, '.ins-problem')).toMatch(new RegExp(`^${RUINS_TEXT}\\s*bulldoze it and build it again$`));
    expect(part(r.body, '.flags')).toBe('');
    expect(r.body.querySelectorAll('.cap-bar').length).toBe(0);
    expect(r.text).not.toMatch(/Jobs filled/);
    const kv = part(r.body, '.kv');
    expect(kv).toMatch(/Income\s*none — in ruins/);
    expect(kv).not.toMatch(/\+§/);
    expect(kv).toMatch(/Upkeep\s*§350\/mo/);
    expect(kv).toMatch(/Still charged until you bulldoze it/);
    expect(r.text).toMatch(/Clear rubble/);
  });

  it('a ruined deal: "Deal income none — in ruins", not the §2,500 of the catalog', () => {
    const { sim, range } = town();
    range.flags |= BF.Burnt;
    const r = inspect(sim, range);
    const kv = part(r.body, '.kv');
    expect(kv).toMatch(/Deal income\s*none — in ruins/);
    expect(kv).not.toContain('2,500');
    expect(part(r.body, '.flags')).toBe('');
    expect(r.text).not.toMatch(/Jobs filled|Powered|Water\b/);
  });

  it('a home in rubble: one "In ruins" line with its fix; no chips, residents bar or commute of a home nobody lives in', () => {
    const { sim, home } = town();
    home.flags |= BF.Burnt | BF.NoGarbage | BF.NeedsUnmet;
    const r = inspect(sim, home);
    expect(r.text).not.toContain('Nothing to show here');
    expect(part(r.body, '.ins-problem')).toMatch(new RegExp(`^${RUINS_TEXT}\\s*Bulldoze the rubble so the lot can rebuild`));
    expect(r.text.split(RUINS_TEXT).length - 1).toBe(1);
    // (stale flags of its old life: no "Garbage piling up", no "Needs unmet")
    expect(part(r.body, '.flags')).toBe('');
    expect(r.body.querySelectorAll('.cap-bar').length).toBe(0);
    const kv = part(r.body, '.kv');
    expect(kv).toMatch(/Land value/);
    expect(kv).not.toMatch(/Commute|Job access|Condition/);
    // an emergency still on the ruin keeps its chip
    home.flags |= BF.Incident;
    expect(part(inspect(sim, home).body, '.flags')).toBe('Emergency here');
  });
});

// ------------------------------------------------------------------------------------------------ the Rewards panel
describe('Rewards panel: a reward whose building is a ruin reads "In ruins — bulldoze to rebuild", not "Built"', () => {
  it('ruinState / rewardRuin: in ruins only while none of its buildings stands', () => {
    const b = (id: number, def: string, flags: number) => ({ id, def, flags }) as unknown as Building;
    const s = ruinState([b(1, 'rw_missile_range', BF.Plopped | BF.Burnt), b(2, 'lm_ferris_wheel', BF.Plopped | BF.Burnt), b(3, 'lm_ferris_wheel', BF.Plopped), b(4, 't_r2', BF.Burnt)]);
    expect(rewardRuin(['rw_missile_range'], s)?.id).toBe(1);
    expect(rewardRuin(['lm_ferris_wheel'], s)).toBeNull(); // another one stands
    expect(rewardRuin(['t_r2'], s)).toBeNull(); // (growables are no reward buildings)
    expect(rewardRuin(['lm_castle'], s)).toBeNull();
  });

  /** the row of a reward in the rendered panel */
  const rowOf = (panel: RewardsPanel, name: string): FEl => {
    const row = (panel.body as unknown as FEl).querySelectorAll('div.li').find((r) => textOf(r.querySelector('div.li-t')!) === name);
    expect(row, `row ${name}`).toBeDefined();
    return row!;
  };

  it('the ruined Missile Test Range: the ruin chip, a button to its inspector instead of Place; rebuilt: Built again', () => {
    const { st, sim, range } = town();
    st.unlocked.add('missile_range');
    range.flags |= BF.Burnt;
    const { ctx, calls } = ctxOf(sim);
    const panel = new RewardsPanel(ctx);
    panel.mount(() => undefined, () => undefined, () => undefined);
    panel.onOpen();
    panel.update();
    let row = rowOf(panel, 'Missile Test Range');
    const right = textOf(row.querySelector('div.li-r')!);
    expect(right).toContain(REWARD_RUIN_TEXT);
    expect(right).not.toMatch(/\bBuilt\b/);
    expect(row.querySelector('span.chip.bad')).not.toBeNull();
    const buttons = row.querySelectorAll('button').map(textOf);
    expect(buttons).toEqual(['Show ruins']);
    row.querySelector('button')!.click();
    expect(calls.focus).toEqual([[range.x + range.w / 2 - 0.5, range.z + range.d / 2 - 0.5]]);
    expect(calls.query).toEqual([{ buildingId: range.id, x: range.x, z: range.z }]);
    expect(calls.closed).toEqual(['rewards']);
    // (closed first: the inspector takes its usual place, not the free spot beside this panel, over the ruin)
    expect(calls.order).toEqual(['close', 'focus', 'query']);
    // the standing wheel next to it is just "Built"
    st.unlocked.add('lm_ferris_wheel');
    panel.onOpen();
    panel.update();
    expect(textOf(rowOf(panel, 'Giant Observation Wheel').querySelector('div.li-r')!)).toMatch(/^Built/);
    // the ruin cleared and the deal placed again: only the flag changed — the gate signature carries it
    const now = vi.spyOn(performance, 'now');
    try {
      now.mockReturnValue(1e9);
      panel.update();
      range.flags &= ~BF.Burnt;
      sim.events.emit('buildingChanged', range);
      now.mockReturnValue(1e9 + 1500);
      panel.update();
    } finally {
      now.mockRestore();
    }
    row = rowOf(panel, 'Missile Test Range');
    expect(textOf(row.querySelector('div.li-r')!)).toMatch(/^Built/);
    expect(textOf(row)).not.toContain(REWARD_RUIN_TEXT);
  });
});

// ------------------------------------------------------------------------------------------------ final fixes r4 U2
/**
 * Final fixes r4 U2 (lane ui; veteran r4 finding 3 + shots 013 / 014 / 021, playtest r4 polish 2 / 10): a ruined
 * one-per-city deal or landmark — the UI contradicted the ruins texts ("bulldoze it and build it again").
 *  (a) the build menu read "Already built (one per city)" (state.milestones counts the ruin until it is bulldozed)
 *      while the sim refuses with "… bulldoze its ruins first";
 *  (c) the Rewards panel offered Place next to "Built" for a standing one (only a toast "Already built"), and a ruined
 *      row kept its green income chip next to the red "In ruins" one;
 *  (d) the Query hover of a fresh ruin read its stale "40 / 40 jobs".
 * ((b), the demolish confirm of a lone ruin: tests/game/demolishRisk.test.ts.)
 */
describe('final fixes r4 U2: a ruined one-per-city building reads the way the ruins texts say', () => {
  const rowIn = (panel: RewardsPanel, name: string): FEl => {
    const row = (panel.body as unknown as FEl).querySelectorAll('div.li').find((r) => textOf(r.querySelector('div.li-t')!) === name);
    expect(row, `row ${name}`).toBeDefined();
    return row!;
  };
  /** the row's income chip ("+§2,500/mo") */
  const incomeChip = (row: FEl): FEl => {
    const c = row.querySelectorAll('span.chip').find((e) => /^\+§/.test(textOf(e)));
    expect(c, 'income chip').toBeDefined();
    return c!;
  };

  it('(a) the build menu: "In ruins — bulldoze its ruins first", the sim\'s own refusal; bulldozed, it can be placed again', () => {
    const { st, sim, range } = town();
    st.unlocked.add('missile_range');
    const { ctx, calls } = ctxOf(sim);
    const spec = () => findToolSpec(ctx, 'plop:rw_missile_range')!;
    expect(spec().disabled).toBe(UNIQUE_BUILT_TEXT);
    expect(UNIQUE_BUILT_TEXT).toBe('Already built (one per city)');
    // flattened (a fire, a tornado, a quake or a meteor): counted until bulldozed, and the menu says what to do
    range.flags |= BF.Burnt;
    sim.events.emit('buildingChanged', range);
    expect(spec().disabled).toBe(UNIQUE_RUINS_TEXT);
    expect(UNIQUE_RUINS_TEXT).toBe('In ruins — bulldoze its ruins first');
    expect(new CityActions(sim).plop('rw_missile_range', 40, 40, 0, true).reason).toBe('Only one Missile Test Range allowed — bulldoze its ruins first');
    // picked from the flyout anyway: refused with the toast that names it (ToolController.select)
    const gw = globalThis as unknown as { window?: unknown };
    const hadWin = gw.window;
    gw.window = { addEventListener: () => undefined, removeEventListener: () => undefined };
    try {
      const canvas = document.createElement('canvas') as unknown as HTMLCanvasElement;
      const tools = new ToolController(ctx, canvas);
      expect(tools.select('plop:rw_missile_range')).toBe(false);
      expect(calls.toasts.at(-1)).toBe('Missile Test Range: In ruins — bulldoze its ruins first');
    } finally {
      gw.window = hadWin;
    }
    // (a standing one next to a ruin of the same def — an older save: built)
    const twin = place(st, 'rw_missile_range', 40, 30, { flags: BF.Plopped | BF.Powered });
    sim.events.emit('buildingAdded', twin);
    st.milestones.rw_missile_range = 2;
    expect(spec().disabled).toBe(UNIQUE_BUILT_TEXT);
    removeBuilding(sim, twin);
    expect(spec().disabled).toBe(UNIQUE_RUINS_TEXT);
    // the ruin bulldozed: nothing counted any more — placeable again (the sim agrees)
    removeBuilding(sim, range);
    expect(st.milestones.rw_missile_range).toBeUndefined();
    expect(spec().disabled).toBeNull();
    expect(new CityActions(sim).plop('rw_missile_range', 40, 40, 0, true).reason ?? '').not.toMatch(/Only one/);
    // (no building scan for a one-per-city def nobody has placed: a city without one is not searched)
    expect(findToolSpec(ctx, 'plop:rw_military_base')!.disabled).toBeNull();
  });

  it('(c) Rewards: no Place next to "Built" for a standing Military Base; a ruin\'s income chip is neutral and says why', () => {
    const { st, sim, range } = town();
    for (const r of ['missile_range', 'military_base', 'casino']) st.unlocked.add(r);
    const base = place(st, 'rw_military_base', 46, 22, { flags: BF.Plopped | BF.Powered | BF.Watered });
    st.milestones.rw_military_base = 1;
    sim.events.emit('buildingAdded', base);
    const { ctx } = ctxOf(sim);
    const panel = new RewardsPanel(ctx);
    panel.mount(() => undefined, () => undefined, () => undefined);
    panel.onOpen();
    panel.update();
    // standing: "Built", nothing to place (Place only toasted "Already built"), the deal income in green
    for (const name of ['Military Base', 'Missile Test Range']) {
      const row = rowIn(panel, name);
      expect(textOf(row.querySelector('div.li-r')!)).toMatch(/^Built/);
      expect(row.querySelectorAll('button').map(textOf)).toEqual([]);
      expect(incomeChip(row).className).toBe('chip good');
      expect(incomeChip(row).title).toBe('Deal income');
    }
    // unlocked, not built yet: Place as before
    expect(rowIn(panel, 'Casino Resort').querySelectorAll('button').map(textOf)).toEqual(['Place']);
    // in ruins: the ruin chip, the way to the ruin, and the deal income neutral — none while it lies in ruins
    range.flags |= BF.Burnt;
    sim.events.emit('buildingChanged', range);
    panel.onOpen();
    panel.update();
    const row = rowIn(panel, 'Missile Test Range');
    expect(textOf(row.querySelector('div.li-r')!)).toContain(REWARD_RUIN_TEXT);
    expect(row.querySelectorAll('button').map(textOf)).toEqual(['Show ruins']);
    const chip = incomeChip(row);
    expect(chip.className).toBe('chip');
    expect(chip.title).toBe('Deal income once rebuilt — none while it lies in ruins');
    expect(textOf(chip)).toBe('+§2,500/mo');
    expect(row.querySelectorAll('span.chip.good').length).toBe(0);
  });

  it('(d) the Query hover of a ruin: "In ruins", not the stale jobs / residents of the building it was', () => {
    const { sim, range, home } = town();
    range.jobs = 40;
    range.capacity = 40;
    home.pop = 12;
    const tips: string[] = [];
    let under = range.id;
    const ctx = {
      get state() { return sim.state; },
      sim,
      overlay: 0,
      overlayVariant: 0,
      objects: { pickBuilding: () => under, setSelected: () => undefined },
      tip: { show: (html: string) => tips.push(html), hide: () => undefined },
    } as unknown as GameContext;
    const tool = new QueryTool(ctx);
    const at = (b: Building): ToolPointer => ({ clientX: 1, clientY: 1, hit: { x: b.x, z: b.z } as ToolPointer['hit'], shift: false, ctrl: false, alt: false, down: false });
    tool.move(at(range));
    expect(tips.at(-1)).toContain('40 / 40 jobs');
    // a fresh ruin: its jobs are only cleared by the next population pass
    range.flags |= BF.Burnt;
    tool.leave();
    tool.move(at(range));
    expect(tips.at(-1)).toContain('Missile Test Range');
    expect(tips.at(-1)).toContain(RUINS_TEXT);
    expect(tips.at(-1)).not.toMatch(/jobs/);
    // a home in rubble: no residents
    under = home.id;
    tool.move(at(home));
    expect(tips.at(-1)).toContain('12 residents');
    home.flags |= BF.Burnt;
    tool.leave();
    tool.move(at(home));
    expect(tips.at(-1)).toContain(RUINS_TEXT);
    expect(tips.at(-1)).not.toMatch(/residents/);
  });
});
