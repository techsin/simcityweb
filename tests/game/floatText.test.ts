/**
 * FEEL-03, money you can feel (docs/POLISH_PLAN.md; T064 lane t064-feel03):
 * (a) cost floats at the cursor from Tool.ts's commitAction ok path (src/ui/FloatText.ts);
 * (b) the funds count-up and flash, (c) the month chip, (d) the approval chip (src/ui/topbar/**);
 * sandbox, reduced motion, and no layout read per frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { commitAction, plopUpkeep } from '../../src/game/tools/Tool';
import { CityActions, type ActionResult } from '../../src/sim/actions';
import { getDef } from '../../src/sim/catalog';
import type { CityState } from '../../src/sim/CityState';
import { Gesture, type ActOptions } from '../../src/worker/SimHost';
import { FLOAT_MERGE_MS, FLOAT_MS, FLOAT_POOL, FLOAT_RISE, attachFloatText, costText, floatTextOf, upkeepText } from '../../src/ui/FloatText';
import { COUNT_MS, FLASH_MS, FundsSegment, MONTH_CHIP_MS, showMonthChip } from '../../src/ui/topbar/fundsSegment';
import { APPROVAL_CAUSE_MIN, APPROVAL_CHIP_MS, ApprovalCauses, ApprovalSegment } from '../../src/ui/topbar/approvalSegment';
import { APPROVAL_LABELS } from '../../src/sim/economy/approval';
import { opexActive } from '../../src/sim/economy/opex';
import { APPROVAL } from '../../src/sim/economy/tuning';
import { Simulation } from '../../src/sim/Simulation';
import { economySystems } from '../../src/sim/systems/economy';
import { upkeepEstimate } from '../../src/ui/upkeepModel';
import { BudgetPanel } from '../../src/ui/panels/BudgetPanel';
import { moneySigned } from '../../src/ui/format';
import { newSim, newState, stressCity } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();

// ---- clock, animation and layout stand-ins

let now = 1000;
interface AnimCall { el: FEl; kf: Record<string, unknown>[]; opts: { duration?: number } }
let anims: AnimCall[] = [];
/** queued animation frames by request id (requestAnimationFrame / cancelAnimationFrame stand-ins) */
let frames = new Map<number, (ts: number) => void>();
let frameId = 0;
const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};

beforeEach(() => {
  now = 1000;
  anims = [];
  frames = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  (FEl.prototype as unknown as { animate: unknown }).animate = function (this: FEl, kf: Record<string, unknown>[], opts: { duration?: number }) {
    anims.push({ el: this, kf, opts });
    return { cancel: () => {} };
  };
  for (const k of ['requestAnimationFrame', 'cancelAnimationFrame']) saved[k] = g[k];
  g.requestAnimationFrame = (cb: (ts: number) => void) => { frames.set(++frameId, cb); return frameId; };
  g.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  (g.document as Record<string, unknown>).visibilityState = 'visible';
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (FEl.prototype as unknown as { animate?: unknown }).animate;
  for (const k of Object.keys(saved)) g[k] = saved[k];
  delete (g.document as Record<string, unknown>).visibilityState;
});

/** run the frame callbacks queued now, at time `ts` (the ones they queue wait for the next frame) */
function step(ts: number): void {
  const queued = [...frames.values()];
  frames.clear();
  for (const f of queued) f(ts);
}

/** run animation frames, `dt` ms apart from `ts0`, until none is queued; the frame times */
function runFrames(ts0 = 5000, dt = 1000 / 60): number[] {
  const seen: number[] = [];
  for (let ts = ts0, guard = 0; frames.size && guard < 1000; ts += dt, guard++) {
    step(ts);
    seen.push(ts);
  }
  return seen;
}

/** count layout reads on every element made while it is on (and getComputedStyle) */
function trapLayout() {
  const reads: string[] = [];
  const doc = g.document as { createElement(t: string): FEl };
  const create = doc.createElement;
  doc.createElement = (t: string) => {
    const el = create(t);
    for (const k of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'clientWidth', 'clientHeight', 'scrollTop', 'scrollWidth', 'scrollHeight']) {
      Object.defineProperty(el, k, { configurable: true, get: () => { reads.push(k); return 0; } });
    }
    Object.assign(el, {
      getBoundingClientRect: () => { reads.push('getBoundingClientRect'); return { left: 0, top: 0, width: 0, height: 0 }; },
      getClientRects: () => { reads.push('getClientRects'); return []; },
    });
    return el;
  };
  saved.getComputedStyle = g.getComputedStyle;
  g.getComputedStyle = () => { reads.push('getComputedStyle'); return {}; };
  return { reads, restore: () => { doc.createElement = create; } };
}

// ---- (a) cost floats

/** a city with real actions behind a host whose tickets are exact (the local host) or settle on acknowledgement */
function city(opts: { exact?: boolean; motion?: string; sandbox?: boolean; pointer?: { x: number; y: number } } = {}) {
  const st = newState(64);
  st.funds = 100000;
  if (opts.sandbox) st.config.sandbox = true;
  const A = new CityActions(newSim(st));
  const abort = new AbortController();
  const pending: { resolve(r: ActionResult): void; r: ActionResult }[] = [];
  const ctx = {
    state: st, signal: abort.signal, sound: vi.fn(), toast: vi.fn(), world: {},
    settings: { motion: opts.motion ?? 'full' },
    sandbox: () => !!st.config.sandbox,
    host: {
      kind: 'local',
      beginGesture: (owner: object) => new Gesture(owner),
      act: (op: string, args: unknown[], o: ActOptions) => {
        const r = (A as unknown as Record<string, (...a: unknown[]) => ActionResult>)[op](...args);
        if (opts.exact !== false) return { seq: 1, exact: true, predicted: r, done: Promise.resolve(r) };
        let resolve!: (r: ActionResult) => void;
        const done = new Promise<ActionResult>((res) => { resolve = res; });
        pending.push({ resolve, r });
        o.gesture?.track(done);
        return { seq: pending.length, exact: false, predicted: { ok: true, cost: 1 }, done };
      },
    },
  } as unknown as GameContext;
  const parent = new FEl('div');
  const ft = attachFloatText(ctx, parent as unknown as HTMLElement, () => opts.pointer ?? { x: 400, y: 300 });
  const floats = () => ft.layer.children as unknown as FEl[];
  return { st, A, abort, ctx, ft, parent, floats, pending };
}

const plop = (ctx: GameContext, x = 10, z = 10, ok = vi.fn()) => commitAction(ctx, {}, 'plop', ['util_coal_plant', x, z, 0], { ok });
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
/** the next animation frame: floats draw in it */
const draw = () => runFrames();

describe('FEEL-03 (a) cost floats', () => {
  it('placing a coal plant floats exactly ActionResult.cost and its upkeep, drawn in the next frame', async () => {
    const f = city();
    const funds = f.st.funds;
    const ok = vi.fn();
    const ticket = plop(f.ctx, 10, 10, ok);
    const r = ticket.predicted as ActionResult;
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(funds - f.st.funds);
    expect(ok).toHaveBeenCalledOnce();
    // no DOM write inside the commit (it may run inside the city's frame, before that frame's layout reads)
    expect(f.floats()).toHaveLength(0);
    expect(anims).toHaveLength(0);
    // one frame later (≈17 ms at 60 fps; the plan allows 100 ms)
    expect(draw()).toHaveLength(1);
    expect(f.floats()).toHaveLength(1);
    expect(anims).toHaveLength(1);
    const el = f.floats()[0];
    expect(textOf(el.querySelector('.ft-cost')!)).toBe(moneySigned(-r.cost));
    expect(el.querySelector('.ft-cost')!.className).toBe('ft-cost neg');
    expect(r.cost).toBeGreaterThanOrEqual(25000);
    // its upkeep, from the command's def as PlopTool quotes it (a flat-upkeep plant: the catalog's §700)
    expect(getDef('util_coal_plant')!.upkeep).toBe(700);
    expect(plopUpkeep(f.st, 'util_coal_plant')).toBe(700);
    expect(textOf(el.querySelector('.ft-sub')!)).toBe('+§700/mo');
    // the acknowledgement does not float it again
    await ticket.done;
    await flush();
    draw();
    expect(anims).toHaveLength(1);
  });

  it('a running-cost facility floats the upkeep its tip quoted, and no city-wide guess without one', () => {
    const f = city();
    const school = getDef('civ_elementary_school')!;
    // a city that charges running costs: a school costs what the people it serves cost, spot by spot
    expect(opexActive(f.st)).toBe(true);
    expect(upkeepEstimate(f.st, school)).not.toBeNull();
    expect(plopUpkeep(f.st, school.id)).toBe(0);
    commitAction(f.ctx, {}, 'plop', [school.id, 10, 10, 0], { ok: vi.fn() });
    draw();
    expect(anims).toHaveLength(1);
    expect(textOf(anims[0].el.querySelector('.ft-cost')!)).toMatch(/^−§/);
    expect(textOf(anims[0].el.querySelector('.ft-sub')!)).toBe('');
    // the figure the tool's tip showed ("Upkeep here ≈§134/mo now"), passed with the commit
    now += 2000;
    commitAction(f.ctx, {}, 'plop', [school.id, 20, 20, 0], { ok: vi.fn(), upkeep: 134 });
    draw();
    expect(anims).toHaveLength(2);
    expect(textOf(anims[1].el.querySelector('.ft-sub')!)).toBe('+§134/mo');
    expect(plopUpkeep(f.st, school.id, 134)).toBe(134);
    // the catalog's upkeep where it is exact: a flat-upkeep plant, or any building in a city without running costs
    expect(plopUpkeep(f.st, 'util_coal_plant')).toBe(700);
    const eco = newState(16);
    expect(opexActive(eco)).toBe(false);
    expect(plopUpkeep(eco, school.id)).toBe(school.upkeep);
    expect(plopUpkeep(eco, 'no_such_def')).toBe(0);
  });

  it('a failed placement shows no float', () => {
    const f = city();
    plop(f.ctx);
    draw();
    anims = [];
    const fail = vi.fn();
    const ticket = commitAction(f.ctx, {}, 'plop', ['util_coal_plant', 10, 10, 0], { ok: vi.fn(), fail });
    expect((ticket.predicted as ActionResult).ok).toBe(false);
    expect(fail).toHaveBeenCalledOnce();
    draw();
    expect(anims).toHaveLength(0);
    expect(f.floats()).toHaveLength(1);
  });

  it('bulldozing it the same day floats the refund in green', () => {
    const f = city();
    plop(f.ctx);
    draw();
    now += 2000;
    const r = commitAction(f.ctx, {}, 'bulldoze', [{ x0: 10, z0: 10, x1: 11, z1: 11 }], { ok: vi.fn() }).predicted as ActionResult;
    expect(r.ok && r.cost < 0).toBe(true);
    draw();
    expect(anims).toHaveLength(2);
    const el = anims[1].el;
    expect(textOf(el.querySelector('.ft-cost')!)).toBe(`${moneySigned(-r.cost)} refund`);
    expect(el.querySelector('.ft-cost')!.className).toBe('ft-cost pos');
    expect(textOf(el.querySelector('.ft-sub')!)).toBe('');
  });

  it('on an acknowledging host it floats once, at the acknowledgement, and never for a failure', async () => {
    const f = city({ exact: false });
    const spy = vi.spyOn(f.ft, 'cost');
    const ok = vi.fn();
    plop(f.ctx, 10, 10, ok);
    expect(spy).not.toHaveBeenCalled();
    f.pending[0].resolve(f.pending[0].r);
    await flush();
    expect(ok).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledExactlyOnceWith(f.pending[0].r.cost, 700, expect.any(Gesture));
    draw();
    expect(anims).toHaveLength(1);
    // the same spot again: the acknowledgement fails
    now += 2000;
    plop(f.ctx, 10, 10, ok);
    f.pending[1].resolve(f.pending[1].r);
    await flush();
    expect(f.pending[1].r.ok).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
    draw();
    expect(anims).toHaveLength(1);
  });

  it('rises 28 px and fades over 900 ms, transform and opacity only, from the pointer; at most 6 elements', () => {
    const f = city();
    for (let i = 0; i < 9; i++) {
      now += 50;
      expect(f.ft.cost(100 + i)).toBe(true);
      draw();
    }
    expect(f.floats()).toHaveLength(FLOAT_POOL);
    expect(anims).toHaveLength(9);
    for (const a of anims) {
      expect(a.opts.duration).toBe(FLOAT_MS);
      for (const k of a.kf) for (const p of Object.keys(k)) expect(['transform', 'opacity', 'offset', 'easing']).toContain(p);
    }
    expect(anims[0].kf[0].transform).toBe('translate(400px, 300px) scale(1)');
    expect(anims[0].kf.at(-1)!.transform).toBe(`translate(400px, ${300 - FLOAT_RISE}px) scale(1)`);
    expect(anims[0].kf.at(-1)!.opacity).toBe(0);
    // the 7th reused the oldest
    expect(anims[6].el).toBe(anims[0].el);
    // idle again after their life: the next one reuses an element
    now += FLOAT_MS;
    expect(f.ft.active).toBe(0);
    f.ft.cost(5);
    draw();
    expect(f.floats()).toHaveLength(FLOAT_POOL);
    expect(anims).toHaveLength(10);
  });

  it('seven floats within one frame: six elements, the newest drawn, one frame request', () => {
    const f = city();
    for (let i = 0; i < 7; i++) f.ft.cost(100 + i);
    expect(frames.size).toBe(1);
    draw();
    expect(f.floats()).toHaveLength(FLOAT_POOL);
    expect(anims).toHaveLength(6);
    expect(f.floats().map((el) => textOf(el.querySelector('.ft-cost')!))).toEqual(['−§106', '−§101', '−§102', '−§103', '−§104', '−§105']);
  });

  it('the commits of one gesture within 250 ms add up in one float; a new gesture gets its own', () => {
    const f = city();
    const stroke = {};
    f.ft.cost(40, 0, stroke);
    draw();
    now += FLOAT_MERGE_MS - 10;
    f.ft.cost(60, 0, stroke);
    draw();
    expect(anims).toHaveLength(1);
    expect(textOf(anims[0].el.querySelector('.ft-cost')!)).toBe('−§100');
    now += 20;
    f.ft.cost(60, 0, stroke);
    f.ft.cost(10, 0, {});
    draw();
    expect(anims).toHaveLength(3);
  });

  it('a frame that comes after the float\'s life (a hidden tab) draws nothing', () => {
    const f = city();
    f.ft.cost(500);
    now += FLOAT_MS;
    draw();
    expect(anims).toHaveLength(0);
    expect(f.floats()).toHaveLength(1);
    expect(textOf(f.floats()[0])).toBe('');
  });

  it('reduced motion: no animation; the float stands still for its life, then goes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = city({ motion: 'reduced' });
    plop(f.ctx);
    draw();
    expect(anims).toHaveLength(0);
    const el = f.floats()[0];
    expect(el.className).toBe('ft on');
    expect(el.style.transform).toBe('translate(400px, 300px) scale(1)');
    vi.advanceTimersByTime(FLOAT_MS - 1);
    draw();
    expect(el.className).toBe('ft on');
    vi.advanceTimersByTime(1);
    expect(el.className).toBe('ft on');
    draw();
    expect(el.className).toBe('ft');
  });

  it('reduced motion: a float whose element is retaken before its hide, with the next frame late, does not stay up', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = city({ motion: 'reduced' });
    f.ft.cost(500);
    draw();
    const el = f.floats()[0];
    expect(el.className).toBe('ft on');
    // its life ends: the hide waits for the next frame...
    now += FLOAT_MS;
    vi.advanceTimersByTime(FLOAT_MS);
    // ...a new commit takes the now idle element before that frame, and the frame comes a second late (a long task)
    expect(f.ft.cost(700)).toBe(true);
    now += 1000;
    draw();
    expect(f.floats()).toHaveLength(1);
    expect(el.className).toBe('ft');
    expect(anims).toHaveLength(0);
  });

  it('no float in a sandbox, for a free commit, without a pointer yet, or after the city closes', () => {
    const s = city({ sandbox: true });
    plop(s.ctx);
    draw();
    expect(s.floats()).toHaveLength(0);
    const f = city({ pointer: { x: -1, y: -1 } });
    expect(f.ft.cost(500)).toBe(false);
    const g2 = city();
    expect(g2.ft.cost(0, 700)).toBe(false);
    // closed between the commit and its frame: nothing is drawn, the layer is gone
    expect(g2.ft.cost(500)).toBe(true);
    g2.abort.abort('dispose');
    draw();
    expect(anims).toHaveLength(0);
    expect(g2.ft.cost(500)).toBe(false);
    expect(g2.parent.children).toHaveLength(0);
    expect(floatTextOf({})).toBeUndefined();
  });

  it('texts: paid, refunded and upkeep', () => {
    expect(costText(25018)).toEqual({ text: '−§25,018', cls: 'neg' });
    expect(costText(-1200)).toEqual({ text: '+§1,200 refund', cls: 'pos' });
    expect(costText(0.3)).toBeNull();
    expect(upkeepText(700)).toBe('+§700/mo');
    expect(upkeepText(0)).toBe('');
  });
});

// ---- (b) funds count-up, (c) month chip

function fundsFixture(opts: { motion?: string; speed?: number } = {}) {
  const st = newState(16);
  const abort = new AbortController();
  st.day = 462; st.funds = 100000;
  st.budget.lastIncome = { taxes: 5000, 'oneoff:loan': 10000 };
  st.budget.lastExpense = { upkeep: 1000, 'oneoff:construction': 2500 };
  const sim = { speed: opts.speed ?? 1 };
  const ctx = { state: st, sim, signal: abort.signal, panels: { toggle: vi.fn() }, settings: { motion: opts.motion ?? 'full' } } as unknown as GameContext;
  const seg = new FundsSegment(ctx);
  const el = seg.el as unknown as FEl;
  const funds = () => textOf(el.querySelector('.hud-value')!);
  const chip = el.querySelector('.hud-chip')!;
  return { st, ctx, sim, seg, el, funds, chip, abort };
}

describe('FEEL-03 (b) the funds count-up', () => {
  it('counts to the new figure over 350 ms through at least 3 intermediate values, with a 400 ms red flash', () => {
    const f = fundsFixture();
    f.seg.update();
    expect(f.funds()).toBe('§100,000');
    expect(frames.size).toBe(0);
    f.st.funds = 74982;
    f.seg.update();
    expect(f.funds()).toBe('§100,000');
    const seen: string[] = [];
    const texts = new Set<string>();
    const label = f.el.querySelector('.hud-value')!;
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(label), 'textContent')!;
    Object.defineProperty(label, 'textContent', { configurable: true, get: () => set.get!.call(label), set: (v: string) => { seen.push(v); texts.add(v); set.set!.call(label, v); } });
    const ts = runFrames();
    expect(f.funds()).toBe('§74,982');
    const mid = [...texts].filter((t) => t !== '§100,000' && t !== '§74,982');
    expect(mid.length).toBeGreaterThanOrEqual(3);
    const values = seen.map((t) => Number(t.replace(/[^0-9]/g, '')));
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    expect(ts.at(-1)! - ts[0]).toBeGreaterThanOrEqual(COUNT_MS);
    expect(ts.at(-1)! - ts[0]).toBeLessThan(COUNT_MS + 40);
    expect(anims).toHaveLength(1);
    expect(anims[0].el).toBe(label);
    expect(anims[0].opts.duration).toBe(FLASH_MS);
    expect(anims[0].kf[0].color).toBe('#ff5d5d');
    // earning flashes green; the HUD tick during a count-up writes nothing extra
    now += FLASH_MS;
    f.st.funds = 80000;
    f.seg.update();
    expect(anims[1].kf[0].color).toBe('#43d17a');
    const before = seen.length;
    f.seg.update();
    expect(seen.length).toBe(before);
    runFrames();
    expect(f.funds()).toBe('§80,000');
  });

  it('a change during a count-up continues from the figure shown', () => {
    const f = fundsFixture();
    f.seg.update();
    f.st.funds = 0;
    f.seg.update();
    for (let i = 0; i < 6; i++) step(5000 + i * 16);
    const mid = Number(f.funds().replace(/[^0-9]/g, ''));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100000);
    f.st.funds = 200000;
    f.seg.update();
    step(9000);
    expect(Number(f.funds().replace(/[^0-9]/g, ''))).toBe(mid);
    runFrames(9016);
    expect(f.funds()).toBe('§200,000');
  });

  it.each(['reduced motion', 'a hidden tab'])('%s: the figure is set at once, with no flash', (why) => {
    const f = fundsFixture({ motion: why === 'reduced motion' ? 'reduced' : 'full' });
    if (why === 'a hidden tab') (g.document as Record<string, unknown>).visibilityState = 'hidden';
    f.seg.update();
    f.st.funds = 95000;
    f.seg.update();
    expect(f.funds()).toBe('§95,000');
    expect(frames.size).toBe(0);
    expect(anims).toHaveLength(0);
  });

  it('adds no layout read per frame (nor at a float\'s spawn)', () => {
    const trap = trapLayout();
    try {
      const f = fundsFixture();
      f.seg.update();
      f.st.funds = 1234;
      f.seg.update();
      runFrames();
      expect(f.funds()).toBe('§1,234');
      const c = city();
      c.ft.cost(500);
      draw();
      now += 1000;
      plop(c.ctx);
      draw();
      expect(anims.length).toBeGreaterThanOrEqual(3);
      expect(trap.reads).toEqual([]);
    } finally { trap.restore(); }
  });
});

/** Budget's "Monthly net (recurring)" for this state (the Income & expenses tab) */
function budgetNet(st: CityState): string {
  const abort = new AbortController();
  const ctx = { state: st, sim: { events: { on: () => () => {} } }, host: { watch: () => ({ value: null, dispose() {} }) }, signal: abort.signal, mods: {}, sound: vi.fn(), toast: vi.fn() } as unknown as GameContext;
  const panel = new BudgetPanel(ctx);
  panel.mount(() => {}, () => {}, () => {});
  panel.showTab('ledger');
  const net = (panel.el as unknown as FEl).querySelector('.ledger-net')!.querySelector('b')!;
  abort.abort('dispose');
  return textOf(net);
}

describe('FEEL-03 (c) the month chip', () => {
  it.each([
    ['a surplus with one-offs', { taxes: 5000, 'oneoff:loan': 10000 }, { upkeep: 3689, 'oneoff:construction': 2500 }],
    ['a deficit', { taxes: 1200 }, { upkeep: 2168, police: 900 }],
    ['a big surplus', { taxes: 412345 }, { upkeep: 100 }],
  ])('at the month tick it shows the month\'s net, equal to Budget\'s "Monthly net (recurring)": %s', (_name, inc, exp) => {
    const f = fundsFixture();
    f.seg.update();
    expect(f.chip.className).toBe('hud-chip month');
    f.st.day = 480;
    f.st.budget.lastIncome = { ...inc };
    f.st.budget.lastExpense = { ...exp };
    f.seg.update();
    expect(f.chip.className).toMatch(/^hud-chip month (pos|neg) on$/);
    expect(textOf(f.chip)).toBe(budgetNet(f.st));
    expect(f.chip.classList.contains(textOf(f.chip).startsWith('−') ? 'neg' : 'pos')).toBe(true);
  });

  it('shows for 2.5 s, not again within the month, and not for the city opening', () => {
    const f = fundsFixture();
    f.st.day = 479;
    f.seg.update();
    expect(f.chip.classList.contains('on')).toBe(false);
    f.st.day = 480;
    f.seg.update();
    expect(f.chip.classList.contains('on')).toBe(true);
    now += MONTH_CHIP_MS - 1;
    f.st.day = 481;
    f.seg.update();
    expect(f.chip.classList.contains('on')).toBe(true);
    now += 1;
    f.seg.update();
    expect(f.chip.className).toBe('hud-chip month pos');
    now += 10000;
    f.st.day = 509;
    f.seg.update();
    expect(f.chip.classList.contains('on')).toBe(false);
  });

  it('a replaced state (a load, a replica\'s resync) is no month tick: no chip until the next one', () => {
    const f = fundsFixture();
    f.seg.update();
    const st2 = newState(16);
    Object.assign(st2, { day: 540, funds: 100000 });
    st2.budget.lastIncome = { taxes: 9000 };
    st2.budget.lastExpense = { upkeep: 1000 };
    (f.ctx as { state: CityState }).state = st2;
    f.seg.update();
    expect(f.chip.classList.contains('on')).toBe(false);
    st2.day = 570;
    f.seg.update();
    expect(textOf(f.chip)).toBe('+§8,000');
    // the approval chip re-baselines the same way
    const a = approvalFixture();
    a.seg.update();
    const st3 = newState(16);
    Object.assign(st3, { day: 540 });
    st3.stats.population = 20000;
    st3.stats.approval = 40;
    st3.systemData.economy = { approvalTerms: { ...T0, tax: -20 } };
    (a.ctx as { state: CityState }).state = st3;
    a.seg.update();
    expect(a.chip.classList.contains('on')).toBe(false);
  });

  it('at ultra only when the sign flips or the net moves by 20% or more', () => {
    const f = fundsFixture({ speed: 3 });
    const month = (net: number) => {
      f.st.day += 30;
      f.st.budget.lastIncome = { taxes: 10000 + net };
      f.st.budget.lastExpense = { upkeep: 10000 };
      now += MONTH_CHIP_MS;
      f.seg.update();
      return f.chip.classList.contains('on');
    };
    f.seg.update();
    expect(month(1000)).toBe(true); // last month's net was 4,000
    expect(month(1100)).toBe(false); // +10%
    expect(month(1320)).toBe(true); // +20%
    expect(month(-50)).toBe(true); // the sign flips
    expect(month(-55)).toBe(false);
    f.sim.speed = 2;
    expect(month(-56)).toBe(true); // fast: every month
    expect(showMonthChip(0, 0, true)).toBe(false);
    expect(showMonthChip(5, 0, true)).toBe(true);
    expect(showMonthChip(5, null, true)).toBe(true);
  });

  it('sandbox: "∞", no net, no chip, no count-up', () => {
    const f = fundsFixture();
    f.st.config.sandbox = true;
    f.seg.update();
    expect(f.funds()).toBe('∞');
    const net = f.el.querySelector('.hud-sub')!;
    expect(textOf(net)).toBe('');
    expect(net.className).toBe('hud-sub faint');
    f.st.funds = 5;
    f.st.day = 480;
    f.st.budget.lastExpense = { upkeep: 99999 };
    f.seg.update();
    expect(f.funds()).toBe('∞');
    expect(textOf(net)).toBe('');
    expect(f.chip.classList.contains('on')).toBe(false);
    expect(frames.size).toBe(0);
    expect(anims).toHaveLength(0);
    // out of the sandbox: the figure at once, the net back
    f.st.config.sandbox = false;
    f.seg.update();
    expect(f.funds()).toBe('§5');
    expect(textOf(net)).toBe('−§94,999/mo');
  });

  it('reduced motion: the chip shows and hides without a transition', () => {
    const f = fundsFixture({ motion: 'reduced' });
    f.seg.update();
    f.st.day = 480;
    f.seg.update();
    expect(f.chip.className).toBe('hud-chip month pos rm on');
    now += MONTH_CHIP_MS;
    f.seg.update();
    expect(f.chip.className).toBe('hud-chip month pos rm');
  });
});

// ---- (d) the approval chip

/** steady terms: their sum (raw) is the shown approval, 60 */
const T0 = { base: 61, tax: -7, services: 5, pollution: -3, crime: -2, parks: 1.5, unemployment: 4.5, clamp: 0 };

function approvalFixture(opts: { pop?: number; ap?: number } = {}) {
  const st = newState(16);
  const abort = new AbortController();
  st.day = 462;
  st.stats.population = opts.pop ?? 20000;
  st.stats.approval = opts.ap ?? 60;
  st.systemData.economy = { approvalTerms: { ...T0 }, approvalRaw: 60 };
  const ctx = { state: st, signal: abort.signal, panels: { toggle: vi.fn(), open: vi.fn() }, overlay: 0, settings: { motion: 'full' } } as unknown as GameContext;
  const seg = new ApprovalSegment(ctx);
  const el = seg.el as unknown as FEl;
  const chip = el.querySelector('.hud-chip')!;
  const eco = () => st.systemData.economy as { approvalTerms: Record<string, number>; approvalRaw: number };
  /** a month tick as the sim makes one (src/sim/economy/approval.ts): the terms change, raw is their sum (0-100, `clamp`
   *  the rest), and the shown approval moves APPROVAL.ema of its gap to raw; `inPlace`: a replica fills one terms object */
  const month = (change: Record<string, number> = {}, inPlace = false) => {
    const e = eco();
    const T = inPlace ? e.approvalTerms : { ...e.approvalTerms };
    Object.assign(T, change);
    let raw = 0;
    for (const k in T) if (k !== 'clamp') raw += T[k];
    T.clamp = Math.min(100, Math.max(0, raw)) - raw;
    e.approvalTerms = T;
    e.approvalRaw = raw + T.clamp;
    st.stats.approval += (e.approvalRaw - st.stats.approval) * APPROVAL.ema;
    st.day += 30;
    seg.update();
  };
  return { st, ctx, seg, el, chip, eco, month, on: () => chip.classList.contains('on') };
}

describe('FEEL-03 (d) the approval chip', () => {
  it('when monthly approval moves by a point or more: "−2 · <the term that moved it most>" for 3 s', () => {
    const f = approvalFixture();
    f.seg.update();
    expect(f.chip.className).toBe('hud-chip appr');
    // taxes up 2 points (the term −7 → −14), services a little worse: approval 60 → 57.6
    f.month({ tax: -14, services: 4 });
    expect(f.st.stats.approval).toBeCloseTo(57.6, 9);
    expect(textOf(f.chip)).toBe('−2 · Residential taxes');
    expect(f.chip.className).toBe('hud-chip appr neg on');
    now += APPROVAL_CHIP_MS - 1;
    f.seg.update();
    expect(f.chip.classList.contains('on')).toBe(true);
    now += 1;
    f.seg.update();
    expect(f.chip.className).toBe('hud-chip appr neg');
  });

  it('reads the term values even when a replica fills the same terms object in place (NOTE-092)', () => {
    const f = approvalFixture();
    f.seg.update();
    const T = f.eco().approvalTerms;
    f.month({ crime: 8, parks: 2 }, true);
    expect(f.eco().approvalTerms).toBe(T);
    expect(textOf(f.chip)).toBe('+3 · Crime at homes');
    expect(f.chip.className).toBe('hud-chip appr pos on');
  });

  it('names the term that pushed approval its way, not a bigger move the other way', () => {
    const f = approvalFixture();
    f.seg.update();
    // parks +8 (the biggest move) while taxes −6 and services −5 pull approval down by a point
    f.month({ parks: 9.5, tax: -13, services: 0 });
    expect(textOf(f.chip)).toBe('−1 · Residential taxes');
  });

  it('the months approval takes to catch up with a tax raise name the tax, not a term that improved meanwhile', () => {
    const f = approvalFixture();
    f.seg.update();
    // taxes up 3 points: the tax term −7 → −17.5; approval falls 3.15 of its 10.5-point gap the first month
    f.month({ tax: -17.5 });
    expect(textOf(f.chip)).toBe('−3 · Residential taxes');
    // it keeps falling toward raw for months, while unemployment improves (that pushes approval up)
    const texts: string[] = [];
    for (const unemployment of [5.5, 6.5, 6.5]) {
      now += APPROVAL_CHIP_MS;
      f.month({ unemployment });
      texts.push(f.on() ? textOf(f.chip) : '');
    }
    expect(texts).toEqual(['−2 · Residential taxes', '−1 · Residential taxes', '−1 · Residential taxes']);
  });

  it('the number alone for a rounding step with no real cause, and for a fall the terms do not explain', () => {
    // approval 60.45 over terms worth 60: parks +0.7 moves it 0.075, across the rounding line (60 → 61 shown)
    const f = approvalFixture({ ap: 60.45 });
    f.seg.update();
    f.month({ parks: 2.2 });
    expect(textOf(f.chip)).toBe('+1');
    // a city loaded while approval was still falling from an earlier tax raise (approval 60 over terms worth 50): a
    // small real fall (unemployment, −0.3) inside a large one from before the load (−3)
    const g = approvalFixture();
    g.eco().approvalTerms.tax = -17;
    g.seg.update();
    g.month({ unemployment: 3.5 });
    expect(textOf(g.chip)).toBe('−3');
  });

  it('ApprovalCauses: never the 0-100 limit or the baseline; nothing to start from; months the HUD missed', () => {
    const c = new ApprovalCauses();
    // nothing to start from: it starts here
    expect(c.step({ base: 61, tax: -7 }, 54, 1, -1)).toBeNull();
    // the limit (or the baseline) took the fall: not named
    expect(c.step({ base: 58, tax: -7, clamp: -9 }, 54 - APPROVAL.ema * 12, 1, -1)).toBeNull();
    // two months at once: the share moved 1 − (1 − ema)² of the tax step, as approval did
    const f2 = 1 - (1 - APPROVAL.ema) ** 2;
    c.reset({ base: 61, tax: -7 }, 54);
    expect(c.step({ base: 61, tax: -17.5 }, 54 - f2 * 10.5, 2, -3)).toBe('tax');
    // a push under APPROVAL_CAUSE_MIN is no cause
    c.reset({ tax: -7 }, 54);
    const small = APPROVAL_CAUSE_MIN * 0.9;
    expect(c.step({ tax: -7 - small / APPROVAL.ema }, 54 - small, 1, -1)).toBeNull();
    expect(c.step({ tax: -7 - 2 * small / APPROVAL.ema }, 54 - small - 0.3 * (small / APPROVAL.ema + small), 1, -1)).toBe('tax');
    // the terms went away: start over
    expect(c.step(null, 50, 1, -1)).toBeNull();
    expect(c.step({ tax: -20 }, 46, 1, -1)).toBeNull();
  });

  it.each<[string, number]>([['+3', 3], ['+5', 5], ['−3', -3]])('a real city, residential taxes %s points: every chip after the step names a term that moved approval its way, and the months of catching up name the tax', (_, points) => {
    const { st } = stressCity(64, 7);
    const sim = new Simulation(st, economySystems());
    sim.runDays(30 * 8);
    const abort = new AbortController();
    const ctx = { state: st, signal: abort.signal, panels: { toggle: vi.fn(), open: vi.fn() }, overlay: 0, settings: { motion: 'full' } } as unknown as GameContext;
    const seg = new ApprovalSegment(ctx);
    const chips: { month: number; text: string }[] = [];
    let month = 0;
    const show = seg.chip.show.bind(seg.chip);
    seg.chip.show = (text: string, tone: string, ms: number) => { chips.push({ month, text }); show(text, tone, ms); };
    const terms = () => ({ ...(st.systemData.economy as { approvalTerms: Record<string, number> }).approvalTerms });
    const runMonth = () => { sim.runDays(30); seg.update(); };
    seg.update();
    for (let i = 0; i < 4; i++) runMonth();
    chips.length = 0;
    const before = terms();
    for (let i = 0; i < 3; i++) st.budget.taxRates[i] += points;
    const after: Record<string, number>[] = [];
    for (month = 1; month <= 8; month++) {
      runMonth();
      after[month] = terms();
    }
    abort.abort();
    const ids = Object.fromEntries(Object.entries(APPROVAL_LABELS).map(([id, label]) => [label, id]));
    const named = chips.map(({ month: m, text }) => {
      const [, sign, , label] = /^([+−])(\d+)(?: · (.+))?$/.exec(text)!;
      return { m, dir: sign === '+' ? 1 : -1, id: label ? ids[label] : null, text };
    });
    // the first month: the tax, the way the step pushes
    expect(named[0]).toMatchObject({ m: 1, dir: points > 0 ? -1 : 1, id: 'tax' });
    for (const c of named) {
      // never a term that moved against the shown change since the step (unemployment improved through every run)
      if (c.id) expect((after[c.m][c.id] - before[c.id]) * c.dir, `${c.text} in month ${c.m}`).toBeGreaterThan(0);
      // the months approval is still catching up with the tax: the tax or nothing
      if (c.m <= 4) expect([null, 'tax'], `${c.text} in month ${c.m}`).toContain(c.id);
    }
    // catching up takes months: at least two more chips in months 2-4, every one of them the tax (the review saw
    // "Unemployment" there)
    const lag = named.filter((c) => c.m >= 2 && c.m <= 4);
    expect(lag.length).toBeGreaterThanOrEqual(points > 0 ? 3 : 2);
    expect(lag.every((c) => c.id === 'tax' && c.dir === (points > 0 ? -1 : 1))).toBe(true);
  });

  it('no chip for a move under a point, before the first residents, in a sandbox, or for the city opening', () => {
    // 60.2 → 60.29: still 60
    const f = approvalFixture({ ap: 60.2 });
    f.seg.update();
    f.month({ parks: 2 });
    expect(f.st.stats.approval).toBeCloseTo(60.29, 9);
    expect(f.on()).toBe(false);
    // a 9.9-point fall with nobody to feel it, and one in a sandbox
    const p = approvalFixture({ pop: 0 });
    p.seg.update();
    p.month({ tax: -40 });
    expect(p.on()).toBe(false);
    const s = approvalFixture();
    s.st.config.sandbox = true;
    s.seg.update();
    s.month({ tax: -40 });
    expect(s.on()).toBe(false);
    // no chip without a month tick, however far approval moves
    const t = approvalFixture();
    t.seg.update();
    t.st.stats.approval = 10;
    t.seg.update();
    expect(t.on()).toBe(false);
  });

  it('an unchanged tick writes nothing to the chips (T030)', () => {
    const f = approvalFixture();
    f.seg.update();
    const writes: string[] = [];
    for (const k of ['className', 'textContent'] as const) {
      const proto = Object.getPrototypeOf(f.chip);
      const d = Object.getOwnPropertyDescriptor(f.chip, k) ?? Object.getOwnPropertyDescriptor(proto, k) ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), k)!;
      let v = (f.chip as unknown as Record<string, string>)[k];
      Object.defineProperty(f.chip, k, { configurable: true, get: () => (d.get ? d.get.call(f.chip) : v), set: (x: string) => { writes.push(k); if (d.set) d.set.call(f.chip, x); else v = x; } });
    }
    for (let i = 0; i < 5; i++) { now += 100; f.seg.update(); }
    expect(writes).toEqual([]);
  });
});
