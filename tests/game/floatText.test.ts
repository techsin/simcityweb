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
import { APPROVAL_CHIP_MS, ApprovalSegment, biggestTermChange } from '../../src/ui/topbar/approvalSegment';
import { BudgetPanel } from '../../src/ui/panels/BudgetPanel';
import { moneySigned } from '../../src/ui/format';
import { newSim, newState } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();

// ---- clock, animation and layout stand-ins

let now = 1000;
interface AnimCall { el: FEl; kf: Record<string, unknown>[]; opts: { duration?: number } }
let anims: AnimCall[] = [];
let frames: ((ts: number) => void)[] = [];
const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};

beforeEach(() => {
  now = 1000;
  anims = [];
  frames = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  (FEl.prototype as unknown as { animate: unknown }).animate = function (this: FEl, kf: Record<string, unknown>[], opts: { duration?: number }) {
    anims.push({ el: this, kf, opts });
    return { cancel: () => {} };
  };
  for (const k of ['requestAnimationFrame', 'cancelAnimationFrame']) saved[k] = g[k];
  g.requestAnimationFrame = (cb: (ts: number) => void) => frames.push(cb);
  g.cancelAnimationFrame = (id: number) => { frames[id - 1] = () => {}; };
  (g.document as Record<string, unknown>).visibilityState = 'visible';
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (FEl.prototype as unknown as { animate?: unknown }).animate;
  for (const k of Object.keys(saved)) g[k] = saved[k];
  delete (g.document as Record<string, unknown>).visibilityState;
});

/** run the queued animation frames, `dt` ms apart from `ts0`, until none is queued; the frame times */
function runFrames(ts0 = 5000, dt = 1000 / 60): number[] {
  const seen: number[] = [];
  for (let ts = ts0, guard = 0; frames.some(Boolean) && guard < 1000; ts += dt, guard++) {
    const queued = frames;
    frames = [];
    for (const f of queued) f(ts);
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
  const shown = () => floats().filter((el) => anims.some((a) => a.el === el) || el.className === 'ft on');
  return { st, A, abort, ctx, ft, parent, floats, shown, pending };
}

const plop = (ctx: GameContext, x = 10, z = 10, ok = vi.fn()) => commitAction(ctx, {}, 'plop', ['util_coal_plant', x, z, 0], { ok });
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

describe('FEEL-03 (a) cost floats', () => {
  it('placing a coal plant floats exactly ActionResult.cost and its upkeep, in the same call as the ok feedback', async () => {
    const f = city();
    const funds = f.st.funds;
    const ok = vi.fn();
    const ticket = plop(f.ctx, 10, 10, ok);
    const r = ticket.predicted as ActionResult;
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(funds - f.st.funds);
    // shown before commitAction returns (the plan's "within 100 ms"), with the ok feedback
    expect(ok).toHaveBeenCalledOnce();
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
    expect(anims).toHaveLength(1);
  });

  it('a failed placement shows no float', () => {
    const f = city();
    plop(f.ctx);
    anims = [];
    const fail = vi.fn();
    const ticket = commitAction(f.ctx, {}, 'plop', ['util_coal_plant', 10, 10, 0], { ok: vi.fn(), fail });
    expect((ticket.predicted as ActionResult).ok).toBe(false);
    expect(fail).toHaveBeenCalledOnce();
    expect(anims).toHaveLength(0);
    expect(f.floats()).toHaveLength(1);
  });

  it('bulldozing it the same day floats the refund in green', () => {
    const f = city();
    plop(f.ctx);
    now += 2000;
    const r = commitAction(f.ctx, {}, 'bulldoze', [{ x0: 10, z0: 10, x1: 11, z1: 11 }], { ok: vi.fn() }).predicted as ActionResult;
    expect(r.ok && r.cost < 0).toBe(true);
    const el = anims.at(-1)!.el;
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
    // the same spot again: the acknowledgement fails
    now += 2000;
    plop(f.ctx, 10, 10, ok);
    f.pending[1].resolve(f.pending[1].r);
    await flush();
    expect(f.pending[1].r.ok).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('rises 28 px and fades over 900 ms, transform and opacity only, from the pointer; at most 6 elements', () => {
    const f = city();
    for (let i = 0; i < 9; i++) {
      now += 50;
      expect(f.ft.cost(100 + i)).toBe(true);
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
    expect(f.floats()).toHaveLength(FLOAT_POOL);
  });

  it('the commits of one gesture within 250 ms add up in one float; a new gesture gets its own', () => {
    const f = city();
    const stroke = {};
    f.ft.cost(40, 0, stroke);
    now += FLOAT_MERGE_MS - 10;
    f.ft.cost(60, 0, stroke);
    expect(anims).toHaveLength(1);
    expect(textOf(anims[0].el.querySelector('.ft-cost')!)).toBe('−§100');
    now += 20;
    f.ft.cost(60, 0, stroke);
    f.ft.cost(10, 0, {});
    expect(anims).toHaveLength(3);
  });

  it('reduced motion: no animation; the float stands still for its life, then goes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = city({ motion: 'reduced' });
    plop(f.ctx);
    expect(anims).toHaveLength(0);
    const el = f.floats()[0];
    expect(el.className).toBe('ft on');
    expect(el.style.transform).toBe('translate(400px, 300px) scale(1)');
    vi.advanceTimersByTime(FLOAT_MS - 1);
    expect(el.className).toBe('ft on');
    vi.advanceTimersByTime(1);
    expect(el.className).toBe('ft');
  });

  it('no float in a sandbox, for a free commit, without a pointer yet, or after the city closes', () => {
    const s = city({ sandbox: true });
    plop(s.ctx);
    expect(s.floats()).toHaveLength(0);
    const f = city({ pointer: { x: -1, y: -1 } });
    expect(f.ft.cost(500)).toBe(false);
    const g2 = city();
    expect(g2.ft.cost(0, 700)).toBe(false);
    g2.abort.abort('dispose');
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
    expect(frames).toHaveLength(0);
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
    for (let i = 0; i < 6; i++) { const q = frames; frames = []; for (const cb of q) cb(5000 + i * 16); }
    const mid = Number(f.funds().replace(/[^0-9]/g, ''));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100000);
    f.st.funds = 200000;
    f.seg.update();
    const q = frames; frames = [];
    for (const cb of q) cb(9000);
    expect(f.funds()).toBe(textOf(f.el.querySelector('.hud-value')!));
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
    expect(frames).toHaveLength(0);
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
      plop(c.ctx);
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
    expect(frames).toHaveLength(0);
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

const T0 = { base: 61, tax: -7, services: -5, pollution: -3, crime: -12, parks: 1.5, unemployment: -1, clamp: 0 };

function approvalFixture(opts: { pop?: number } = {}) {
  const st = newState(16);
  const abort = new AbortController();
  st.day = 462;
  st.stats.population = opts.pop ?? 20000;
  st.stats.approval = 60;
  st.systemData.economy = { approvalTerms: { ...T0 }, approvalRaw: 58 };
  const ctx = { state: st, signal: abort.signal, panels: { toggle: vi.fn(), open: vi.fn() }, overlay: 0, settings: { motion: 'full' } } as unknown as GameContext;
  const seg = new ApprovalSegment(ctx);
  const el = seg.el as unknown as FEl;
  const chip = el.querySelector('.hud-chip')!;
  return { st, ctx, seg, el, chip, terms: () => (st.systemData.economy as { approvalTerms: Record<string, number> }).approvalTerms };
}

describe('FEEL-03 (d) the approval chip', () => {
  it('when monthly approval moves by a point or more: "−2 · <the term that changed most>" for 3 s', () => {
    const f = approvalFixture();
    f.seg.update();
    expect(f.chip.className).toBe('hud-chip appr');
    f.st.day = 480;
    f.st.stats.approval = 58;
    f.st.systemData.economy = { approvalTerms: { ...T0, tax: -10, crime: -11, services: -6 }, approvalRaw: 55 };
    f.seg.update();
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
    const T = f.terms();
    f.st.day = 480;
    f.st.stats.approval = 63.4;
    T.crime = -8; T.parks = 2;
    f.seg.update();
    expect(f.terms()).toBe(T);
    expect(textOf(f.chip)).toBe('+3 · Crime at homes');
    expect(f.chip.className).toBe('hud-chip appr pos on');
  });

  it('names a term that moved the way approval did, not a bigger one that moved against it', () => {
    expect(biggestTermChange({ tax: -7, parks: 0, services: -5 }, { tax: -10, parks: 4, services: -7 }, -1)).toBe('Residential taxes');
    expect(biggestTermChange({ tax: -7, parks: 0 }, { tax: -10, parks: 4 }, 1)).toBe('Parks near homes');
    // nothing moved that way: the biggest move; a term that appears counts from zero; clamp never
    expect(biggestTermChange({ tax: -7 }, { tax: -6 }, -1)).toBe('Residential taxes');
    expect(biggestTermChange({ tax: -7, clamp: 0 }, { tax: -7, clamp: -9, deficit: -2 }, -1)).toBe('City in debt');
    expect(biggestTermChange(null, { tax: -6 }, 1)).toBeNull();
    expect(biggestTermChange({ tax: -6 }, { tax: -6 }, 1)).toBeNull();
  });

  it('no chip for a move under a point, before the first residents, in a sandbox, or for the city opening', () => {
    const f = approvalFixture();
    f.st.stats.approval = 60.2;
    f.seg.update();
    f.st.day = 480;
    f.st.stats.approval = 60.4;
    f.seg.update();
    expect(f.chip.classList.contains('on')).toBe(false);
    const p = approvalFixture({ pop: 0 });
    p.seg.update();
    p.st.day = 480;
    p.st.stats.approval = 20;
    p.seg.update();
    expect(p.chip.classList.contains('on')).toBe(false);
    const s = approvalFixture();
    s.st.config.sandbox = true;
    s.seg.update();
    s.st.day = 480;
    s.st.stats.approval = 30;
    s.seg.update();
    expect(s.chip.classList.contains('on')).toBe(false);
    // no chip without a month tick, however far approval moves
    const t = approvalFixture();
    t.seg.update();
    t.st.stats.approval = 10;
    t.seg.update();
    expect(t.chip.classList.contains('on')).toBe(false);
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
