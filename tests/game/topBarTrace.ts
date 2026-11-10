/**
 * The top bar's full HUD trace (the round-1 TopBar split, POLISH_PLAN §7.3): a scripted session through every segment
 * (date and speed, funds, population, RCI with its popover and "+ zone" badge, approval with its card, the panel buttons)
 * that records, after each step, the whole DOM tree, every DOM write the step made (by element and property: the per-tick
 * write skipping of T030), and every call the bar made into the game. It drives the bar only through its public API, so
 * the same script runs on any TopBar layout. tests/game/topBarSplit.test.ts compares it with the trace recorded from the
 * TopBar before the split (tests/game/fixtures/topBarTrace.json).
 */
import { vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { Network, Overlay, Zone } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import type { CityState } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { MONTH_SCAN_DAYS, advisorsSystem, type AdvisorsSystem } from '../../src/sim/economy/advisors';
import { TopBar } from '../../src/ui/TopBar';
import { newState, place, roadLine } from '../infra/cityGen';
import { queryHost } from './queryHost';
import { FEl, FNode } from './fakeDom';

export interface TraceStep {
  name: string;
  /** what the bar called on the game during the step, in order */
  calls: string[];
  /** DOM writes of the step, per element: "<child indices> <tag>.<class>" (resolved at the end of the step) → its
   *  written properties, sorted, "×n" for more than one write */
  writes: Record<string, string>;
  /** the bar's DOM tree at the end of the step, one line per node */
  tree: string[];
}

// ---- DOM write recorder (on the fake DOM of tests/game/fakeDom.ts)

let writes: Map<FEl, Map<string, number>> | null = null;

function bump(el: FEl, prop: string): void {
  if (!writes) return;
  let m = writes.get(el);
  if (!m) writes.set(el, (m = new Map()));
  m.set(prop, (m.get(prop) ?? 0) + 1);
}

const protoHtml = Object.getOwnPropertyDescriptor(FEl.prototype, 'innerHTML')!;
const protoText = Object.getOwnPropertyDescriptor(FEl.prototype, 'textContent')!;

/** an element whose every write is counted: class, title, inline style, dataset, attributes, markup, text, children */
function recordedEl(tag: string): FEl {
  const el = new FEl(tag);
  let cls = el.className, title = el.title;
  Object.defineProperty(el, 'className', { get: () => cls, set: (v: string) => { bump(el, 'class'); cls = String(v); } });
  Object.defineProperty(el, 'title', { get: () => title, set: (v: string) => { bump(el, 'title'); title = String(v); } });
  const raw = el.style as Record<string, unknown>;
  raw.setProperty = (k: string, v: string) => { bump(el, `style.${k}`); raw[k] = v; };
  el.style = new Proxy(raw, { set: (t, k, v) => { bump(el, `style.${String(k)}`); t[k as string] = v; return true; } }) as FEl['style'];
  el.dataset = new Proxy({} as Record<string, string>, {
    set: (t, k, v) => { bump(el, `data.${String(k)}`); t[k as string] = String(v); return true; },
    deleteProperty: (t, k) => { bump(el, `data.${String(k)}-`); delete t[k as string]; return true; },
  });
  Object.defineProperty(el, 'innerHTML', { get: () => protoHtml.get!.call(el), set: (v: string) => { bump(el, 'html'); protoHtml.set!.call(el, v); } });
  Object.defineProperty(el, 'textContent', { get: () => protoText.get!.call(el), set: (v: string) => { bump(el, 'text'); protoText.set!.call(el, v); } });
  const setAttribute = el.setAttribute.bind(el), appendChild = el.appendChild.bind(el), insertBefore = el.insertBefore.bind(el), remove = el.remove.bind(el);
  el.setAttribute = (k: string, v: string) => { bump(el, `attr.${k}`); setAttribute(k, v); };
  el.appendChild = <T extends FNode>(c: T): T => { bump(el, 'children'); return appendChild(c); };
  el.insertBefore = <T extends FNode>(c: T, ref: FNode | null): T => { bump(el, 'children'); return insertBefore(c, ref); };
  el.remove = () => { if (el.parentNode) bump(el.parentNode, 'children'); remove(); };
  return el;
}

// ---- serialisation

/** icons are long SVG strings: name them by a short hash so the trace stays readable */
function svgless(html: string): string {
  return html.replace(/<svg[\s\S]*?<\/svg>/g, (m) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < m.length; i++) h = Math.imul(h ^ m.charCodeAt(i), 0x01000193) >>> 0;
    return `<svg#${h.toString(16).padStart(8, '0')}>`;
  });
}

function sorted(o: Record<string, unknown>): string {
  return Object.keys(o).filter((k) => typeof o[k] !== 'function' && o[k] !== '').sort().map((k) => `${k}:${svgless(String(o[k]))}`).join(';');
}

function nodeLine(n: FNode, depth: number, out: string[]): void {
  const pad = '  '.repeat(depth);
  if (!(n instanceof FEl)) {
    out.push(`${pad}"${n.textContent}"`);
    return;
  }
  const parts = [n.tagName];
  if (n.className) parts.push(`class="${n.className}"`);
  if (n.title) parts.push(`title="${n.title}"`);
  const style = sorted(n.style as Record<string, unknown>);
  if (style) parts.push(`style{${style}}`);
  const data = sorted({ ...n.dataset });
  if (data) parts.push(`data{${data}}`);
  const attrs = [...n.attrs].filter(([k]) => k !== 'title').map(([k, v]) => `${k}=${v}`).sort().join(';');
  if (attrs) parts.push(`attrs{${attrs}}`);
  const own = (n as unknown as { own: string }).own;
  if (own) parts.push(`text="${own}"`);
  const html = n.innerHTML;
  if (html) parts.push(`html="${svgless(html)}"`);
  const listeners = n.listenerCount();
  if (listeners) parts.push(`L${listeners}`);
  out.push(pad + parts.join(' '));
  for (const c of n.childNodes) nodeLine(c, depth + 1, out);
}

function pathOf(el: FEl, root: FEl): string {
  const leaf = `${el.tagName}${el.className ? '.' + el.className.split(' ')[0] : ''}`;
  const idx: number[] = [];
  for (let n: FEl = el; n !== root; n = n.parentNode!) {
    if (!n.parentNode) return `detached ${leaf}`;
    idx.push(n.parentNode.children.indexOf(n));
  }
  return `${idx.reverse().join('.')} ${leaf}`;
}

// ---- the fake DOM's missing pieces for this script: closest(), [data-x="y"] selectors and document listeners

const protoQSA = FEl.prototype.querySelectorAll;
const protoClosest = FEl.prototype.closest;
let docListeners: Map<string, ((e: unknown) => void)[]> = new Map();

export function installTraceDom(): () => void {
  const g = globalThis as unknown as { document: Record<string, unknown> };
  const doc = g.document, createElement = doc.createElement, addEventListener = doc.addEventListener;
  doc.createElement = (t: string) => recordedEl(t);
  docListeners = new Map();
  doc.addEventListener = (t: string, f: (e: unknown) => void, opts?: { signal?: AbortSignal }) => {
    if (opts?.signal?.aborted) return;
    docListeners.set(t, [...(docListeners.get(t) ?? []), f]);
    opts?.signal?.addEventListener('abort', () => docListeners.set(t, (docListeners.get(t) ?? []).filter((x) => x !== f)), { once: true });
  };
  FEl.prototype.querySelectorAll = function (this: FEl, sel: string): FEl[] {
    const m = /^\[data-([\w-]+)="([^"]*)"\]$/.exec(sel.trim());
    if (!m) return protoQSA.call(this, sel);
    const key = m[1].replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    return this.all().filter((e) => e.dataset[key] === m[2]);
  };
  FEl.prototype.closest = function (this: FEl, sel: string): FEl | null {
    const cls = sel.replace(/^\./, '');
    for (let n: FEl | null = this; n; n = n.parentNode) if (n.classList.contains(cls)) return n;
    return null;
  } as typeof FEl.prototype.closest;
  return () => {
    doc.createElement = createElement;
    doc.addEventListener = addEventListener;
    FEl.prototype.querySelectorAll = protoQSA;
    FEl.prototype.closest = protoClosest;
  };
}

// ---- the cities

const TERMS = { base: 61, tax: -7, services: -5.4, pollution: -3, crime: -12.3, parks: -1.6, unemployment: -1, clamp: 0 };

function setApproval(st: CityState, approval: number, terms: Record<string, number> | null, raw = approval - 2): void {
  st.stats.approval = approval;
  // a new object, as each monthly report is
  st.systemData.economy = { ...(st.systemData.economy as object), approvalTerms: terms ? { ...terms } : undefined, approvalRaw: raw, resCrime: 0.41 };
}

/** strong residential demand with 4 empty road-facing lots (the "+ zone" badge) */
function homesCity(st: CityState): void {
  roadLine(st, 2, 20, 60, 20, Network.Road);
  for (let x = 3; x < 7; x++) st.zone[st.idx(x, 21)] = Zone.ResLow;
  st.stats.demand[0] = 0.8;
}

/** no free land, strong commercial demand and a neighbour on the east edge (LG-05's built-out line) */
function builtOutCity(st: CityState): void {
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
  st.stats.demand[3] = 0.8;
}

function citySim(setup: (st: CityState) => void) {
  const st = newState(64);
  st.systemData.infraVersion = 1;
  st.stats.demand.fill(0);
  st.stats.demandCap.fill(0);
  const adv = advisorsSystem(new EconRuntime()) as AdvisorsSystem;
  const sim = new Simulation(st, [{ name: 'services', clustersOf: () => [] } as unknown as SimSystem, adv]);
  st.config.name = 'Test City'; st.config.mayor = 'Pat'; st.config.startYear = 2000; st.config.difficulty = 'medium';
  setup(st);
  for (const d of MONTH_SCAN_DAYS) { st.day = d; adv.daily!(sim); }
  st.day = 30;
  adv.monthly!(sim);
  return { st, sim };
}

// ---- the session

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

/** run the scripted session on a fresh TopBar and return its trace */
export async function traceTopBar(): Promise<TraceStep[]> {
  const steps: TraceStep[] = [];
  let calls: string[] = [];
  const rec = (name: string) => (...args: unknown[]) => { calls.push(`${name}(${args.map((a) => (a === undefined ? 'undefined' : JSON.stringify(a))).join(', ')})`); };
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);

  const session = async (label: string, setup: (st: CityState) => void, script: (s: Session) => Promise<void>) => {
    const { st, sim } = citySim(setup);
    const abort = new AbortController();
    const world = { timeOfDay: 10.5 };
    const showTab = rec('budget.showTab');
    const ctx = {
      host: { ...queryHost(sim), setSpeed: (s: number, src: string) => { rec('host.setSpeed')(s, src); sim.speed = s; } },
      state: st, sim, signal: abort.signal, ui: new Emitter<UIEvents>(), mods: {} as GameContext['mods'], world,
      overlay: Overlay.None, overlayVariant: -1,
      tools: { activeId: null, select: (id: string) => { rec('tools.select')(id); return true; } },
      focusCell: rec('focusCell'),
      setOverlay: (o: Overlay, v?: number) => { rec('setOverlay')(o, v); ctx.overlay = o; },
      openFlyout: rec('openFlyout'), openPauseMenu: rec('openPauseMenu'), sound: rec('sound'), toast: rec('toast'),
      panels: { toggle: rec('panels.toggle'), open: rec('panels.open'), get: (id: string) => (id === 'budget' ? { showTab } : undefined) },
    } as unknown as GameContext;
    sim.speed = 0;
    const parent = new FEl('div');
    writes = new Map();
    calls = [];
    const bar = new TopBar(ctx, parent as unknown as HTMLElement);
    const el = bar.el as unknown as FEl;
    const end = (name: string) => {
      const byPath = new Map<string, Map<string, number>>();
      for (const [e, m] of writes!) {
        const k = pathOf(e, parent);
        const into = byPath.get(k) ?? new Map<string, number>();
        for (const [p, n] of m) into.set(p, (into.get(p) ?? 0) + n);
        byPath.set(k, into);
      }
      const w: Record<string, string> = {};
      for (const k of [...byPath.keys()].sort()) w[k] = [...byPath.get(k)!].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, n]) => (n > 1 ? `${p}×${n}` : p)).join(' ');
      const tree: string[] = [];
      nodeLine(parent, 0, tree);
      steps.push({ name: `${label}: ${name}`, calls, writes: w, tree });
      writes = new Map();
      calls = [];
    };
    const q = (cls: string) => el.querySelector(cls)!;
    const step = async (name: string, f: () => void | Promise<void>) => { f(); await flush(); end(name); };
    const s: Session = { st, sim, ctx, bar, el, world, q, step, abort, tick: (ms) => { now += ms; bar.update(); } };
    end('construct');
    await script(s);
    abort.abort('dispose');
    writes = null;
  };

  await session('homes', homesCity, async ({ st, ctx, bar, el, world, q, step, abort, tick }) => {
    const speed = () => q('.speed').children;
    await step('first update (paused, a city of 12,345)', () => {
      st.day = 462; st.funds = 100000; st.stats.population = 12345; st.stats.residents = [12345, 0, 0];
      st.history.pop = [11000, 12000];
      st.budget.lastIncome = { taxes: 5000, 'oneoff:loan': 10000 };
      st.budget.lastExpense = { upkeep: 1000, 'oneoff:construction': 2500 };
      setApproval(st, 68, TERMS);
      bar.update();
    });
    await step('five unchanged ticks', () => { for (let i = 0; i < 5; i++) bar.update(); });
    await step('click Fast', () => { speed()[2].click(); bar.update(); });
    await step('click Fast again (the active speed ticks)', () => { speed()[2].click(); bar.update(); });
    await step('click Pause', () => { speed()[0].click(); bar.update(); });
    await step('click Normal', () => { speed()[1].click(); bar.update(); });
    for (const [h, label] of [[22, 'night'], [7, 'sunrise'], [5.9, 'before dawn'], [19.5, 'dusk'], [12, 'noon']] as const) {
      await step(`time of day ${h} (${label})`, () => { world.timeOfDay = h; bar.update(); });
    }
    await step('time of day throws', () => {
      Object.defineProperty(world, 'timeOfDay', { configurable: true, get: () => { throw new Error('no world'); } });
      bar.update();
      Object.defineProperty(world, 'timeOfDay', { configurable: true, writable: true, value: 12 });
    });
    await step('in debt, a deficit', () => {
      st.funds = -500;
      st.budget.lastExpense = { upkeep: 9000, 'oneoff:construction': 2500 };
      bar.update();
    });
    await step('a big surplus (compact)', () => { st.funds = 2_500_000; st.budget.lastIncome = { taxes: 400000 }; st.budget.lastExpense = { upkeep: 100 }; bar.update(); });
    await step('no report yet', () => { st.budget.lastIncome = {}; st.budget.lastExpense = {}; bar.update(); });
    await step('sandbox', () => { st.config.sandbox = true; bar.update(); });
    await step('back from sandbox, no mayor, hard', () => { st.config.sandbox = false; st.config.mayor = ''; st.config.difficulty = 'hard'; st.config.name = ''; bar.update(); });
    await step('population falling', () => { st.history.pop = [13000, 12345]; st.stats.population = 12000; bar.update(); });
    await step('population stable', () => { st.history.pop = [12000, 12000]; bar.update(); });
    await step('population from nothing', () => { st.history.pop = [0, 40]; st.stats.population = 40; bar.update(); });
    await step('population, one month of history', () => { st.history.pop = [500]; st.stats.population = 900; bar.update(); });
    await step('population, no history', () => { st.history.pop = []; st.stats.population = 12345; bar.update(); });
    await step('demand mixed (no caps)', () => {
      st.stats.demand.splice(0, 12, 0.8, -0.3, 0.1, 1.7, -1.7, 0, 0.45, -0.05, 0.2, -1, 0.6, 0.02);
      bar.update();
    });
    await step('the residential cap binds (fallback heuristic) and toasts', () => {
      st.stats.demandCap[0] = 10000; st.stats.residents = [9800, 0, 0];
      econData(st).capBinding[0] = 1;
      bar.update();
    });
    await step('still capped: no second toast', () => { bar.update(); });
    await step('sim-core demandInfo: commercial and industrial capped', () => {
      ctx.mods.econ = { demandInfo: () => ({ capped: [false, false, false, true, false, false, false, false, false, false, true, false] }) } as unknown as GameContext['mods']['econ'];
      econData(st).capBinding[3] = econData(st).capBinding[10] = 1;
      st.day += 200;
      bar.update();
    });
    await step('demandInfo throws: the heuristic again', () => {
      ctx.mods.econ = { demandInfo: () => { throw new Error('no core'); } } as unknown as GameContext['mods']['econ'];
      bar.update();
    });
    await step('the neighbours add demand', () => {
      econData(st).regionTerms = { R: [1200, 300, 40], CS: [500, 80, 0], CO: 60, I: 900, market: 1.25, capR: 2000, capC: 0, capI: 450 };
      bar.update();
    });
    await step('open the RCI popover', () => { q('.rci-seg').fire('click', { target: q('.rci') }); });
    await step('three ticks with it open', () => { for (let i = 0; i < 3; i++) bar.update(); });
    await step('demand moves while open', () => { st.stats.demand[1] = 0.9; st.stats.demandCap[4] = 5000; bar.update(); });
    await step('a click inside the popover keeps it open', () => { q('.rci-seg').fire('click', { target: q('.rci-grid') }); bar.update(); });
    await step('a cap hint\'s button', () => { q('.cap-hint').querySelector('button')!.click(); bar.update(); });
    await step('reopen, then pointerdown inside the segment', () => {
      q('.rci-seg').fire('click', { target: q('.rci') });
      for (const f of docListeners.get('pointerdown') ?? []) f({ target: q('.rci-grid') });
    });
    await step('pointerdown elsewhere closes it', () => { for (const f of docListeners.get('pointerdown') ?? []) f({ target: new FEl('div') }); });
    await step('reopen, then pointerdown on the funds segment closes it', () => {
      q('.rci-seg').fire('click', { target: q('.rci') });
      for (const f of docListeners.get('pointerdown') ?? []) f({ target: el.children[1].children[0].lastElementChild });
    });
    await step('closePopover while closed, then open, then closePopover', () => {
      calls.push(`closePopover → ${bar.closePopover()}`);
      q('.rci-seg').fire('click', { target: q('.rci') });
      calls.push(`closePopover → ${bar.closePopover()}`);
    });
    await step('funds and date move, then the popover opens: the whole bar refreshes', () => {
      st.funds = 777777; st.day += 1; st.stats.approval = 64;
      q('.rci-seg').fire('click', { target: q('.rci') });
      bar.closePopover();
    });
    await step('the neighbours leave', () => { econData(st).regionTerms = undefined; econData(st).capBinding.fill(0); ctx.mods.econ = undefined; st.stats.demandCap.fill(0); st.stats.demand.fill(0); st.stats.demand[0] = 0.8; bar.update(); });
    await step('"+ zone" click', () => { q('.rci-zone').click(); });
    await step('8 more lots, 100 ms later (no recount yet)', () => { for (let x = 7; x < 15; x++) st.zone[st.idx(x, 21)] = Zone.ResLow; tick(100); });
    await step('a second later: recounted, gone', () => { tick(1000); });
    await step('one built on: back', () => { place(st, 't_r1', 7, 21); tick(1000); });
    await step('industry wants in more', () => { st.stats.demand[9] = 0.95; tick(0); });
    await step('emergencies: 3 waiting', () => { st.stats.emergency = { ...(st.stats.emergency ?? {}), manualActive: 3 } as typeof st.stats.emergency; bar.update(); });
    await step('emergencies: 12 waiting', () => { st.stats.emergency!.manualActive = 12; bar.update(); });
    await step('emergencies: none', () => { st.stats.emergency!.manualActive = 0; bar.update(); });
    await step('badges', () => { bar.setBadge('rewards', 1); bar.setBadge('advisors', 4); bar.setBadge('advisors', 10); bar.setBadge('nowhere', 2); });
    await step('badges cleared', () => { bar.setBadge('rewards', 0); bar.setBadge('advisors', 0); bar.setBadge('stats', 0); });
    await step('coach on Play', () => { bar.setCoachPlay(true); bar.update(); });
    await step('coach off', () => { bar.setCoachPlay(false); });
    await step('panel events', () => {
      ctx.ui.emit('panel', { id: 'budget', open: true });
      ctx.ui.emit('panel', { id: 'settings', open: true });
      ctx.ui.emit('panel', { id: 'help', open: true });
      ctx.ui.emit('panel', { id: 'budget', open: false });
    });
    await step('every panel button', () => { for (const b of el.lastElementChild!.querySelectorAll('button')) b.click(); });
    await step('city, funds and population clicks', () => {
      const segs = el.querySelectorAll('.hud-seg');
      segs[0].click();
      for (const s of el.children[1].children.slice(0, 2)) s.click();
    });
    const appr = () => q('.approval');
    const row = (id: string) => q('.appr-pop').querySelectorAll('.ap-r').find((r) => r.dataset.fix === id)!;
    await step('approval: a click on the segment', () => { appr().fire('click', { target: q('.appr-pop') }); });
    await step('approval: the crime row', () => { appr().fire('click', { target: row('crime').firstElementChild }); });
    await step('approval: the services row (in the Police view)', () => { appr().fire('click', { target: row('services') }); });
    await step('approval: the tax row', () => { appr().fire('click', { target: row('tax') }); });
    await step('approval: pointer leaves', () => { appr().fire('pointerleave'); });
    await step('approval: the parks row', () => { appr().fire('click', { target: row('parks') }); appr().fire('pointerleave'); });
    await step('approval: an unchanged report (no rebuild)', () => { bar.update(); bar.update(); });
    await step('approval: a new town of 3,000 at 52%', () => { st.stats.population = 3000; setApproval(st, 52, TERMS); bar.update(); });
    await step('approval: 38% (meh)', () => { setApproval(st, 38, TERMS); bar.update(); });
    await step('approval: 30% (bad)', () => { setApproval(st, 30, TERMS); bar.update(); });
    await step('approval: easy difficulty footer', () => { st.config.difficulty = 'easy'; setApproval(st, 30, TERMS); bar.update(); });
    await step('approval: no residents', () => { st.stats.population = 0; st.stats.residents = [0, 0, 0]; bar.update(); });
    await step('approval: 20,000 residents at 45%', () => { st.stats.population = 20000; st.stats.residents = [20000, 0, 0]; setApproval(st, 45, TERMS, 49); bar.update(); });
    await step('approval: one term only (the plain title)', () => { setApproval(st, 45, { base: 45, clamp: 0 }); bar.update(); });
    await step('approval: no report', () => { setApproval(st, 50, null); bar.update(); });
    await step('dispose, then clicks', () => {
      abort.abort('dispose');
      speed()[2].click();
      q('.rci-seg').fire('click', { target: q('.rci') });
      for (const b of el.lastElementChild!.querySelectorAll('button')) b.click();
      appr().fire('click', { target: appr() });
    });
  });

  await session('built out', builtOutCity, async ({ st, bar, q, step }) => {
    await step('first update', () => { st.stats.population = 50000; st.stats.residents = [50000, 0, 0]; setApproval(st, 61, TERMS); bar.update(); });
    await step('open the RCI popover: the built-out line', () => { q('.rci-seg').fire('click', { target: q('.rci') }); });
    const button = (label: string) => q('.built-out').querySelectorAll('button').find((b) => b.textContent.includes(label))!;
    await step('Rezone', () => { button('Rezone').click(); });
    await step('reopen, Connect a highway', () => { q('.rci-seg').fire('click', { target: q('.rci') }); button('Connect a highway').click(); });
    await step('reopen, then two ticks', () => { q('.rci-seg').fire('click', { target: q('.rci') }); bar.update(); bar.update(); });
  });

  return steps;
}

interface Session {
  st: CityState;
  sim: Simulation;
  ctx: GameContext;
  bar: TopBar;
  el: FEl;
  world: { timeOfDay: number };
  q: (cls: string) => FEl;
  step: (name: string, f: () => void | Promise<void>) => Promise<void>;
  abort: AbortController;
  /** advance the mocked clock by `ms` and update the bar */
  tick: (ms: number) => void;
}
