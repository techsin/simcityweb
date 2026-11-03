/** FH-08 presentation contract. The policy episode is supplied by a mock host: worker transport wiring is staged
 *  separately. No simulation reads or speed mutations are available to the banner in this fixture. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { Overlay } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import type { CityEvents } from '../../src/sim/Simulation';
import { INCIDENT_RESPONDERS, type DispatchOption, type DispatchResult, type Incident } from '../../src/sim/infra/emergency';
import { EMERG_DAYS_PER_MIN } from '../../src/sim/infra/params';
import { EmergencyBanner } from '../../src/ui/EmergencyBanner';
import type { PolicySnapshot } from '../../src/worker/SimHost';

// Minimal DOM, as in emergencyBanner.test.ts; signal-bound listeners also work on retained elements after exit.
class FakeNode {
  parentElement: FakeEl | null = null;
  childNodes: FakeNode[] = [];
  protected text = '';
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get textContent(): string { return this.text + this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this.childNodes = []; this.text = v; }
  remove(): void {
    const p = this.parentElement;
    if (!p) return;
    const i = p.childNodes.indexOf(this);
    if (i >= 0) p.childNodes.splice(i, 1);
    this.parentElement = null;
  }
}
class FakeEl extends FakeNode {
  className = '';
  style: Record<string, unknown> & { setProperty(k: string, v: string): void } = { setProperty(k: string, v: string) { this[k] = v; } };
  dataset: Record<string, string> = {};
  disabled = false;
  title = '';
  offsetLeft = 0;
  offsetTop = 70;
  offsetWidth = 440;
  offsetHeight = 0;
  clientWidth = 1600;
  clientHeight = 0;
  private html = '';
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor(readonly tagName: string) { super(); }
  get classList() {
    const get = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const put = (s: Set<string>) => { this.className = [...s].join(' '); };
    return {
      contains: (c: string) => get().has(c),
      add: (...cs: string[]) => { const s = get(); for (const c of cs) s.add(c); put(s); },
      remove: (...cs: string[]) => { const s = get(); for (const c of cs) s.delete(c); put(s); },
      toggle: (c: string, on?: boolean) => { const s = get(), v = on ?? !s.has(c); if (v) s.add(c); else s.delete(c); put(s); return v; },
    };
  }
  get innerHTML(): string { return this.html; }
  set innerHTML(v: string) { this.childNodes = []; this.text = ''; this.html = v; }
  override get textContent(): string { return super.textContent + this.html.replace(/<[^>]*>/g, ''); }
  override set textContent(v: string) { this.html = ''; super.textContent = v; }
  setAttribute(k: string, v: string): void { (this as unknown as Record<string, string>)[k] = v; }
  addEventListener(t: string, f: (e: unknown) => void, opts?: boolean | AddEventListenerOptions): void {
    const signal = typeof opts === 'object' ? opts.signal : undefined;
    if (signal?.aborted) return;
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
    signal?.addEventListener('abort', () => this.listeners.set(t, (this.listeners.get(t) ?? []).filter((fn) => fn !== f)), { once: true });
  }
  click(): void { if (!this.disabled) for (const f of this.listeners.get('click') ?? []) f({}); }
  appendChild<T extends FakeNode>(c: T): T { c.remove(); c.parentElement = this; this.childNodes.push(c); return c; }
  insertBefore<T extends FakeNode>(c: T, ref: FakeNode | null): T {
    c.remove(); c.parentElement = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    return c;
  }
  removeChild<T extends FakeNode>(c: T): T { c.remove(); return c; }
  all(): FakeEl[] {
    const out: FakeEl[] = [];
    for (const c of this.childNodes) if (c instanceof FakeEl) out.push(c, ...c.all());
    return out;
  }
  querySelectorAll(): FakeEl[] { return []; }
  closest(sel: string): FakeEl | null {
    const alts = sel.split(',').map((a) => a.trim());
    for (let e: FakeEl | null = this; e; e = e.parentElement) {
      const el = e;
      if (alts.some((a) => a.startsWith('.') ? el.classList.contains(a.slice(1)) : el.tagName.toLowerCase() === a)) return el;
    }
    return null;
  }
  contains(n: FakeNode | null): boolean { for (let e: FakeNode | null = n; e; e = e.parentElement) if (e === this) return true; return false; }
}

let storage: Map<string, string>;
const lifetimes: AbortController[] = [];
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('document', {
    createElement: (t: string) => new FakeEl(t),
    createTextNode: (s: string) => { const n = new FakeNode(); n.textContent = s; return n; },
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v); },
  });
});
afterEach(() => {
  for (const ac of lifetimes.splice(0)) ac.abort('dispose');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type TeachingPolicy = PolicySnapshot & { teaching?: { id: number; variant: 'E1a' | 'E1b' } };
function incident(patch: Partial<Incident> = {}): Incident {
  return {
    id: 1, kind: 'fire', x: 20, z: 12, buildingId: 7, major: true, state: 'uncovered', start: 0,
    deadline: 5 * EMERG_DAYS_PER_MIN, severity: 1, need: { fire: 1 }, units: [], reason: 'outOfRange',
    manualPossible: true, canSend: true, place: 'Harbor Refinery', note: '', grace: 5 * EMERG_DAYS_PER_MIN,
    arrived: -1, firstAt: {}, answered: 0, work: 0, injured: 0, deaths: 0, radius: 0, fires: [7], lost: 0,
    saved: 0, retry: 0, stVer: 0, ...patch,
  };
}
function option(patch: Partial<DispatchOption> = {}): DispatchOption {
  return { stationId: 7, name: 'Harbor Fire Station #7', responder: 'fire', free: 1, etaMin: 4.2,
    etaDays: 4.2 * EMERG_DAYS_PER_MIN, total: 2, inRange: false, ...patch };
}
function harness(inc = incident(), teaching?: TeachingPolicy['teaching'], tips = true, initialOptions: DispatchOption[] | null = [option()]) {
  const root = new FakeEl('div'), ui = new Emitter<UIEvents>(), events = new Emitter<CityEvents>();
  const abort = new AbortController();
  lifetimes.push(abort);
  const incidents = new Map([[inc.id, inc]]);
  const policy: TeachingPolicy = { alerts: [{ id: inc.id, wasPossible: inc.manualPossible }], live: false, teaching };
  const listeners = new Set<(p: TeachingPolicy) => void>();
  const toasts: string[] = [], settings: Record<string, unknown>[] = [];
  const clock = { now: 0, day: undefined as number | undefined, speed: teaching?.variant === 'E1a' ? 0 : 3, slowdown: 1 };
  let options: DispatchOption[] | undefined = initialOptions ?? undefined, version = 1;
  let result: Promise<DispatchResult> = Promise.resolve({ ok: true, responder: 'fire', sent: 1, etaMin: 4.2 });
  const act = vi.fn((op: string, args: unknown[], _opts?: unknown) => {
    if (op === 'setSettings') settings.push(args[0] as Record<string, unknown>);
    const done = op === 'dispatchBest' ? result.then((r) => {
      const primary = INCIDENT_RESPONDERS[inc.kind][0];
      if (r.ok && r.responder === primary && !r.missing?.includes(primary)) inc.state = 'dispatched';
      return r;
    }) : Promise.resolve(undefined);
    return { seq: 1, exact: false, done };
  });
  const setSpeed = vi.fn(), setOverlay = vi.fn(), openFlyout = vi.fn();
  const ctx = {
    get state() { return { day: clock.day ?? clock.now }; },
    sim: new Proxy({ events }, { get: (target, key) => {
      if (key === 'events') return target.events;
      throw new Error(`Unexpected simulation read: ${String(key)}`);
    } }),
    host: {
      kind: 'worker', events, act, setSpeed, simTime: () => clock.now,
      beginGesture: vi.fn(() => ({ end: vi.fn(), settled: Promise.resolve() })),
      get speed() { return clock.speed; }, get liveSlowdown() { return clock.slowdown; },
      policy: Object.assign(policy, { subscribe: (fn: (p: TeachingPolicy) => void, signal: AbortSignal) => {
        listeners.add(fn);
        const off = () => { listeners.delete(fn); };
        signal.addEventListener('abort', off, { once: true });
        return off;
      } }),
      emergency: {
        active: true, layersReady: true, incident: (id: number) => incidents.get(id),
        incidents: () => [...incidents.values()], vehicles: () => [], stationList: () => [],
        stationFleet: () => null, stationName: () => 'Harbor Fire Station #7',
      },
      watch: () => ({ get value() { return options; }, get version() { return version; }, error: undefined,
        setArgs: () => undefined, subscribe: () => () => undefined, dispose: () => undefined }),
    },
    root, ui, signal: abort.signal, settings: { ...DEFAULT_SETTINGS, tips },
    panels: { open: vi.fn(), isOpen: () => false }, sound: vi.fn(), toast: (t: string) => { toasts.push(t); },
    setOverlay, openFlyout, focusCell: vi.fn(), showQuery: vi.fn(),
  } as unknown as GameContext;
  const banner = new EmergencyBanner(ctx, root as unknown as HTMLElement);
  return {
    banner, ctx, root, inc, incidents, policy, abort, clock, toasts, settings, act, setSpeed, setOverlay, openFlyout, events, ui,
    tick: () => ui.emit('uiTick', undefined),
    publish: (patch: Partial<TeachingPolicy>) => { Object.assign(policy, patch); for (const fn of listeners) fn(policy); },
    options: (next: DispatchOption[]) => { options = next; version++; },
    dispatch: (next: DispatchResult | Promise<DispatchResult>) => { result = Promise.resolve(next); },
  };
}
type Harness = ReturnType<typeof harness>;
const prefKey = 'metropolis.ui.emergencyTeaching';
const seen = () => JSON.parse(storage.get(prefKey) ?? '{}') as Record<string, unknown>;
const byClass = (parent: FakeEl, cls: string) => parent.all().filter((e) => e.classList.contains(cls));
function card(t: Harness): FakeEl | undefined { return byClass(t.root, 'emg-teach').find((e) => e.style.display !== 'none'); }
function button(parent: FakeEl, text: string | RegExp): FakeEl {
  const b = parent.all().find((e) => e.tagName === 'button' && (typeof text === 'string' ? e.textContent === text : text.test(e.textContent)));
  expect(b, `button ${text}`).toBeDefined();
  return b!;
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('FH-08 emergency teaching from a host snapshot', () => {
  it('E1a uses the real primary station, ETA, place and legend label without simulation reads', () => {
    const t = harness(incident(), { id: 1, variant: 'E1a' });
    t.options([option({ responder: 'medical', name: 'Wrong clinic', etaMin: 1.1 }), option()]);
    t.tick();
    const c = card(t)!;
    expect(c).toBeDefined();
    expect(c.closest('.emg-banner')).not.toBeNull();
    const text = byClass(c, 'emg-teach-text')[0].textContent;
    expect(c.textContent).toContain('Harbor Refinery');
    expect(text).toContain('Harbor Fire Station #7');
    expect(text).toContain('4.2 min');
    expect(text).toContain('Auto-dispatch');
    expect(text).not.toMatch(/\b(?:green|amber|blue|orange|magenta|grey|gray)\b/i);
    expect(text).not.toContain('Wrong clinic');
    for (const label of ['Send nearest', 'Emergency view', 'Got it']) expect(button(c, label)).toBeDefined();
    expect(seen().E1a).toBe(true);
    expect(t.settings[0]).toMatchObject({ teachFirst: true, teachTooFar: true });
    expect(t.setSpeed).not.toHaveBeenCalled();
  });

  it.each(['card', 'banner'])('successful %s Send nearest closes the teaching card after the dispatch acknowledgement', async (source) => {
    const t = harness(incident(), { id: 1, variant: 'E1a' });
    let finish!: (r: DispatchResult) => void;
    t.dispatch(new Promise((resolve) => { finish = resolve; }));
    const parent = source === 'card' ? card(t)! : byClass(t.root, 'emg-btns')[0];
    button(parent, /^Send nearest/).click();
    expect(card(t)).toBeDefined();
    expect(t.act).toHaveBeenCalledWith('dispatchBest', [1], expect.objectContaining({ tag: t.banner }));
    finish({ ok: true, responder: 'fire', sent: 1, etaMin: 4.2 });
    await flush();
    expect(t.inc.state).toBe('dispatched');
    expect(card(t)).toBeUndefined();
    expect(t.settings.at(-1)).toMatchObject({ teachingAck: 1 });
    t.tick();
    expect(card(t)).toBeUndefined();
  });

  it('a failed dispatch or a supporting ambulance leaves the E1a card open', async () => {
    const t = harness(incident({ kind: 'industrial', need: { fire: 1, medical: 1 } }), { id: 1, variant: 'E1a' });
    t.dispatch({ ok: false, reason: 'Every truck is busy' });
    button(card(t)!, 'Send nearest').click();
    await flush();
    expect(card(t)).toBeDefined();
    expect(t.toasts).toContain('Every truck is busy');
    expect(t.settings.some((s) => s.teachingAck === 1)).toBe(false);
    t.dispatch({ ok: true, responder: 'medical', sent: 1, missing: ['fire'], etaMin: 2 });
    button(card(t)!, 'Send nearest').click();
    await flush();
    expect(card(t)).toBeDefined();
    expect(t.settings.some((s) => s.teachingAck === 1)).toBe(false);
  });

  it('Got it acknowledges once; repeated snapshots and a later E1a do not reopen the card', () => {
    const t = harness(incident(), { id: 1, variant: 'E1a' });
    button(card(t)!, 'Got it').click();
    expect(card(t)).toBeUndefined();
    t.publish({ teaching: { id: 1, variant: 'E1a' } });
    t.tick();
    expect(card(t)).toBeUndefined();
    const second = incident({ id: 2 });
    t.incidents.set(2, second);
    t.publish({ alerts: [{ id: 1, wasPossible: true }, { id: 2, wasPossible: true }], teaching: { id: 2, variant: 'E1a' } });
    expect(card(t)).toBeUndefined();
    expect(t.settings.filter((s) => s.teachingAck === 1)).toHaveLength(1);
  });

  it('keeps the same teaching card operable in the root fallback when docking folds its banner', () => {
    const t = harness(incident(), { id: 1, variant: 'E1a' });
    const c = card(t)!;
    const dock = t.banner as unknown as { applyDock(place: null, compact: boolean, rows: number): void };
    dock.applyDock(null, true, -1);
    let fallback = byClass(t.root, 'emg-teach-fallback')[0];
    expect(fallback).toBeDefined();
    expect(fallback.parentElement).toBe(t.root);
    expect(fallback.contains(c)).toBe(true);
    expect(card(t)).toBe(c);
    dock.applyDock(null, false, 0);
    expect(c.closest('.emg-banner')).not.toBeNull();
    expect(card(t)).toBe(c);
    dock.applyDock(null, true, -1);
    fallback = byClass(t.root, 'emg-teach-fallback')[0];
    expect(fallback.contains(c)).toBe(true);
    button(c, 'Got it').click();
    expect(card(t)).toBeUndefined();
    expect(byClass(t.root, 'emg-teach-fallback')).toHaveLength(0);
    expect(t.settings.at(-1)).toMatchObject({ teachingAck: 1 });
  });

  it('acknowledges an already-seen authoritative episode on mount without showing another card', () => {
    storage.set(prefKey, JSON.stringify({ E1a: true }));
    const t = harness(incident(), { id: 1, variant: 'E1a' });
    expect(card(t)).toBeUndefined();
    expect(t.settings.some((s) => s.teachingAck === 1)).toBe(true);
    t.publish({ teaching: { id: 1, variant: 'E1a' } });
    t.tick();
    expect(card(t)).toBeUndefined();
    expect(t.settings.filter((s) => s.teachingAck === 1)).toHaveLength(1);
  });

  it('shows an E1a loading coach before dispatch options arrive and enables Send when they are delivered', () => {
    const t = harness(incident(), { id: 1, variant: 'E1a' }, true, null);
    const c = card(t)!;
    expect(c).toBeDefined();
    expect(c.textContent).toMatch(/loading/i);
    expect(c.textContent).not.toContain('No free unit can go right now.');
    expect(button(c, 'Got it')).toBeDefined();
    expect(button(c, 'Send nearest').disabled).toBe(true);
    t.options([]);
    t.tick();
    expect(card(t)).toBe(c);
    expect(c.textContent).toContain('No free unit can go right now.');
    expect(c.textContent).not.toMatch(/loading/i);
    expect(button(c, 'Send nearest').disabled).toBe(true);
    t.options([option()]);
    t.tick();
    expect(card(t)).toBe(c);
    expect(button(c, 'Send nearest').disabled).toBe(false);
    expect(c.textContent).not.toMatch(/loading/i);
    expect(c.textContent).not.toContain('No free unit can go right now.');
    expect(c.textContent).toContain('Harbor Fire Station #7');
    expect(c.textContent).toContain('4.2 min');
    button(c, 'Got it').click();
    expect(card(t)).toBeUndefined();
    expect(t.settings.at(-1)).toMatchObject({ teachingAck: 1 });
  });

  it.each([
    ['fire', 'Fire tab', 'fire'], ['medical', 'Health tab', 'health'], ['crime', 'Police tab', 'police'],
  ] as const)('E1b for %s names the right service and opens its tab without changing speed', (kind, label, tab) => {
    const primary = INCIDENT_RESPONDERS[kind][0];
    const t = harness(incident({ kind, need: { [primary]: 1 }, manualPossible: false }), { id: 1, variant: 'E1b' });
    const c = card(t)!;
    expect(c.textContent).toContain('No station can reach this in time');
    expect(button(c, 'Emergency view')).toBeDefined();
    expect(c.all().some((e) => e.tagName === 'button' && e.textContent === 'Got it')).toBe(false);
    button(c, label).click();
    expect(t.openFlyout).toHaveBeenCalledWith('civic', tab);
    expect(card(t)).toBeUndefined();
    expect(t.settings.at(-1)).toMatchObject({ teachingAck: 1 });
    expect(t.clock.speed).toBe(3);
    expect(t.setSpeed).not.toHaveBeenCalled();
  });

  it('Emergency view acknowledges the card and opens the host-facing emergency overlay', () => {
    const t = harness(incident(), { id: 1, variant: 'E1a' });
    button(card(t)!, 'Emergency view').click();
    expect(t.setOverlay).toHaveBeenCalledWith(Overlay.Emergency);
    expect(card(t)).toBeUndefined();
    expect(t.settings.at(-1)).toMatchObject({ teachingAck: 1 });
  });

  it('remembers E1a and E1b independently across city remounts in the same profile', () => {
    const first = harness(incident(), { id: 1, variant: 'E1a' });
    button(card(first)!, 'Got it').click();
    first.abort.abort('exit');
    first.banner.dispose();
    const next = harness(incident(), { id: 1, variant: 'E1a' });
    expect(card(next)).toBeUndefined();
    expect(next.settings[0]).toMatchObject({ teachFirst: false, teachTooFar: true });
    next.inc.manualPossible = false;
    next.publish({ teaching: { id: 1, variant: 'E1b' } });
    expect(card(next)).toBeDefined();
    button(card(next)!, 'Emergency view').click();
    next.abort.abort('exit');
    next.banner.dispose();
    const third = harness(incident({ manualPossible: false }), { id: 1, variant: 'E1b' });
    expect(card(third)).toBeUndefined();
    expect(third.settings[0]).toMatchObject({ teachFirst: false, teachTooFar: false });
  });

  it('accepts only exact true preference flags as seen', () => {
    storage.set(prefKey, JSON.stringify({ E1a: 'true', E1b: 1, E2: [], E3: true }));
    const t = harness(incident(), { id: 1, variant: 'E1a' });
    expect(card(t)).toBeDefined();
    expect(t.settings[0]).toMatchObject({ teachFirst: true, teachTooFar: true });
    t.clock.speed = 1;
    t.clock.slowdown = 3;
    t.publish({ live: true });
    expect(t.toasts.filter((s) => s.startsWith('LIVE:'))).toHaveLength(1);
  });

  it('E2 explains an actual LIVE slowdown once, including feedback, repeated ticks and a city remount', () => {
    const t = harness();
    t.publish({ live: true }); // fast speed: the slow clock has not arrived yet
    t.tick();
    t.clock.speed = 0; // an urgent or teaching pause is not a LIVE slowdown
    t.clock.slowdown = 3;
    t.tick();
    expect(t.toasts.filter((s) => s.startsWith('LIVE:'))).toHaveLength(0);
    t.clock.speed = 1;
    t.clock.slowdown = 1; // plain 1x is not a slowdown either
    t.tick();
    expect(t.toasts.filter((s) => s.startsWith('LIVE:'))).toHaveLength(0);
    t.clock.slowdown = 3;
    t.tick();
    t.publish({ live: true, toast: { text: 'Emergency over', kind: 'info' } });
    t.tick();
    expect(t.toasts.filter((s) => s.startsWith('LIVE:'))).toHaveLength(1);
    expect(t.toasts.find((s) => s.startsWith('LIVE:'))).toContain('Your speed comes back');
    expect(seen().E2).toBe(true);
    t.abort.abort('exit');
    t.banner.dispose();
    const next = harness();
    next.clock.speed = 1;
    next.clock.slowdown = 3;
    next.publish({ live: true });
    next.tick();
    expect(next.toasts.filter((s) => s.startsWith('LIVE:'))).toHaveLength(0);
  });

  it('E3 uses the replayed event day while the host clock is stale, once, retaining the existing outcome', () => {
    const t = harness(incident({ manualPossible: false, bestEta: undefined }));
    t.options([option({ etaMin: 6.3, etaDays: 6.3 * EMERG_DAYS_PER_MIN })]);
    t.tick(); // cache the last delivered free primary option before the incident ends
    t.inc.state = 'failed';
    t.inc.lost = 1;
    t.clock.day = 5 * EMERG_DAYS_PER_MIN; // packet replay precedes the host's clock update
    expect(t.clock.now).toBe(0);
    t.events.emit('emergency', { id: 1, kind: 'fire', type: 'failed', x: 20, z: 12, major: true, manualPossible: false });
    t.incidents.delete(1);
    t.tick();
    const reason = byClass(t.root, 'emg-teach-reason')[0];
    expect(reason).toBeDefined();
    expect(reason.textContent).toContain('6.3 min');
    expect(reason.textContent).toMatch(/(?:in|after) 5(?:\.0)?(?: min)?/);
    expect(byClass(t.root, 'emg-note')[0].textContent).toBe('No fire truck could reach it in time — 1 building lost');
    expect(seen().E3).toBe(true);
    const second = incident({ id: 2, manualPossible: false });
    t.incidents.set(2, second);
    t.publish({ alerts: [{ id: 1, wasPossible: false }, { id: 2, wasPossible: false }] });
    second.state = 'failed';
    second.lost = 1;
    t.events.emit('emergency', { id: 2, kind: 'fire', type: 'failed', x: 20, z: 12, major: true, manualPossible: false });
    t.incidents.delete(2);
    t.tick();
    expect(byClass(t.root, 'emg-teach-reason')).toHaveLength(1);
  });

  it('E3 names the dispatched primary unit ETA rather than the nearer free station', () => {
    const t = harness(incident());
    t.options([option({ etaMin: 6.3, etaDays: 6.3 * EMERG_DAYS_PER_MIN })]);
    t.tick();
    t.inc.state = 'failed';
    t.inc.answered = 2;
    t.inc.etaMin = 8.7;
    t.inc.lost = 1;
    t.clock.day = 5 * EMERG_DAYS_PER_MIN;
    t.events.emit('emergency', { id: 1, kind: 'fire', type: 'failed', x: 20, z: 12, major: true, manualPossible: false });
    t.incidents.delete(1);
    t.tick();
    const reason = byClass(t.root, 'emg-teach-reason')[0];
    expect(reason).toBeDefined();
    expect(reason.textContent).toContain('8.7 min');
    expect(reason.textContent).not.toContain('6.3 min');
    expect(reason.textContent).toMatch(/(?:in|after) 5(?:\.0)?(?: min)?/);
  });

  it('E3 does not count an industrial accident ambulance as its primary fire truck', () => {
    const t = harness(incident({ kind: 'industrial', need: { fire: 1, medical: 1 }, firstAt: { medical: 1 }, answered: 0 }));
    t.options([option({ responder: 'medical', name: 'Harbor Clinic', etaMin: 1 }), option({ etaMin: 6.3, etaDays: 6.3 * EMERG_DAYS_PER_MIN })]);
    t.tick();
    t.inc.state = 'failed';
    t.inc.lost = 1;
    t.clock.day = 3 * EMERG_DAYS_PER_MIN;
    t.events.emit('emergency', { id: 1, kind: 'industrial', type: 'failed', x: 20, z: 12, major: true, manualPossible: false });
    t.incidents.delete(1);
    t.tick();
    const reason = byClass(t.root, 'emg-teach-reason')[0];
    expect(reason).toBeDefined();
    expect(reason.textContent).toMatch(/no fire truck was sent/i);
    expect(reason.textContent).toMatch(/3(?:\.0)? min/);
    expect(reason.textContent).not.toMatch(/ambulance/i);
  });

  it('Tips off disables the policy teaching flags, card, LIVE explainer and failed-incident explainer', () => {
    const t = harness(incident(), { id: 1, variant: 'E1a' }, false);
    expect(t.settings[0]).toMatchObject({ teachFirst: false, teachTooFar: false });
    expect(card(t)).toBeUndefined();
    t.clock.speed = 1;
    t.clock.slowdown = 3;
    t.publish({ live: true });
    t.tick();
    t.inc.state = 'failed';
    t.clock.now = 5 * EMERG_DAYS_PER_MIN;
    t.events.emit('emergency', { id: 1, kind: 'fire', type: 'failed', x: 20, z: 12, major: true, manualPossible: false });
    t.incidents.delete(1);
    t.tick();
    expect(t.toasts.filter((s) => s.startsWith('LIVE:'))).toHaveLength(0);
    expect(byClass(t.root, 'emg-teach-reason')).toHaveLength(0);
    expect(storage.has(prefKey)).toBe(false);
  });

  it('turning Tips off while the card is open acknowledges and closes the teaching episode', () => {
    const t = harness(incident(), { id: 1, variant: 'E1a' });
    expect(card(t)).toBeDefined();
    t.ctx.settings.tips = false;
    t.ui.emit('settings', t.ctx.settings);
    expect(card(t)).toBeUndefined();
    expect(t.settings.at(-1)).toMatchObject({ teachFirst: false, teachTooFar: false, teachingAck: 1 });
    t.publish({ teaching: { id: 1, variant: 'E1a' } });
    t.tick();
    expect(card(t)).toBeUndefined();
    expect(t.setSpeed).not.toHaveBeenCalled();
  });

  it('city abort removes retained card listeners and suppresses a late dispatch acknowledgement', async () => {
    const t = harness(incident(), { id: 1, variant: 'E1a' });
    const send = button(card(t)!, 'Send nearest'), gotIt = button(card(t)!, 'Got it');
    let finish!: (r: DispatchResult) => void;
    t.dispatch(new Promise((resolve) => { finish = resolve; }));
    send.click();
    t.abort.abort('exit');
    const calls = t.act.mock.calls.length;
    gotIt.click();
    send.click();
    finish({ ok: true, responder: 'fire', sent: 1, etaMin: 4.2 });
    await flush();
    expect(t.act).toHaveBeenCalledTimes(calls);
    expect(t.settings.some((s) => s.teachingAck === 1)).toBe(false);
    expect(t.toasts).toHaveLength(0);
  });
});
