/**
 * NOTE-081 (T085 round 2): the emergency banner's click rule. A press on a banner's button is ignored only when it began
 * before that banner (or the button) appeared or moved under the pointer — it was aimed at what sat there before — and no
 * longer for 350 ms after every appearance or move: the first click on a new banner's Send nearest, right after the game
 * had paused for it, was lost three times in five.
 *  - a press that began before the banner appeared sends nothing when it is released on it;
 *  - a press that begins once the banner is there sends with one click, however soon (30 ms after; the same millisecond);
 *  - a press whose pointerdown waited out the long task that added the banner counts from when it began;
 *  - a reflow that moves another banner's button under a pressed pointer sends nothing; the pressed control still clicks;
 *  - the keyboard (Enter / Space on the focused button: a click with no press) acts at once;
 *  - touch: the tap's click is its own task after the release, and may be moved onto the nearest button;
 *  - FH-08's first-lesson card and its folded-stack fallback, and round 1's E1a timing, keep working.
 * Events travel as in the browser: the window's capture listeners, the stack's, then the control's own (the stand-in
 * DOM of fakeDom.ts keeps no capture phase; El adds it, with closest / contains and a place on screen).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext, UIEvents } from '../../src/game/context';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import type { CityEvents } from '../../src/sim/Simulation';
import type { DispatchOption, DispatchResult, Incident } from '../../src/sim/infra/emergency';
import { EMERG_DAYS_PER_MIN } from '../../src/sim/infra/params';
import { EmergencyBanner, PRESS_LAG_MAX, SETTLE_FLASH_MS } from '../../src/ui/EmergencyBanner';
import type { PolicySnapshot } from '../../src/worker/SimHost';
import { FEl, textNode, type FNode } from './fakeDom';

// ------------------------------------------------------------------------------------------------ DOM with a capture phase
type Listener = (e: unknown) => void;
/** the listeners registered for the capture phase */
const capturing = new WeakSet<Listener>();
const isCapture = (opts: unknown): boolean => opts === true || (typeof opts === 'object' && opts !== null && (opts as { capture?: boolean }).capture === true);

class El extends FEl {
  /** pointers it captured (setPointerCapture) */
  captured: number[] = [];
  override addEventListener(t: string, f: Listener, opts?: boolean | { signal?: AbortSignal; capture?: boolean }): void {
    if (isCapture(opts)) capturing.add(f);
    super.addEventListener(t, f, opts);
  }
  /** "button, .emg-more" (tags / .classes, comma separated): the nearest match up the tree */
  override closest(sel = ''): El | null {
    const alts = sel.split(',').map((a) => a.trim());
    for (let e: FEl | null = this; e; e = e.parentElement) {
      const el = e;
      if (alts.some((a) => (a.startsWith('.') ? el.classList.contains(a.slice(1)) : el.tagName.toLowerCase() === a))) return el as El;
    }
    return null;
  }
  contains(n: FNode | null): boolean {
    for (let e: FNode | null = n; e; e = e.parentElement) if (e === this) return true;
    return false;
  }
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
}
/** the window's listeners, by phase */
class Win {
  private all: { t: string; f: Listener; capture: boolean }[] = [];
  addEventListener(t: string, f: Listener, opts?: unknown): void {
    this.all.push({ t, f, capture: isCapture(opts) });
  }
  removeEventListener(t: string, f: Listener, opts?: unknown): void {
    const capture = isCapture(opts);
    this.all = this.all.filter((l) => !(l.t === t && l.f === f && l.capture === capture));
  }
  of(t: string, capture: boolean): Listener[] {
    return this.all.filter((l) => l.t === t && l.capture === capture).map((l) => l.f);
  }
  count(t?: string): number {
    return this.all.filter((l) => !t || l.t === t).length;
  }
}
let win: Win;
const own = (el: El, t: string, capture: boolean): Listener[] =>
  ((el as unknown as { listeners: Map<string, Listener[]> }).listeners.get(t) ?? []).filter((f) => capturing.has(f) === capture);

/**
 * Deliver an event as the browser does: the window's capture listeners, the ancestors' from the root down to the target,
 * then the bubbling ones back up to the window; stopPropagation ends it after the listeners of the element it reached.
 * Its time is now unless given (a pointerdown that waited for a long task carries the earlier time its press began). A
 * disabled button gets no click. `target` null: an event the window alone hears (a release off the page's elements).
 */
function send(target: El | null, type: string, init: Record<string, unknown> = {}): { stopped: boolean; prevented: boolean } {
  const state = { stopped: false, prevented: false };
  if (type === 'click' && target?.disabled) return state;
  const e = { type, target, timeStamp: performance.now(), preventDefault() { state.prevented = true; }, stopPropagation() { state.stopped = true; }, ...init };
  const path: El[] = [];
  for (let n: FEl | null = target; n; n = n.parentElement) path.push(n as El);
  const run = (fs: Listener[]): boolean => {
    for (const f of fs) f(e);
    return state.stopped;
  };
  if (run(win.of(type, true))) return state;
  for (const el of [...path].reverse()) if (run(own(el, type, true))) return state;
  for (const el of path) if (run(own(el, type, false))) return state;
  run(win.of(type, false));
  return state;
}
/** give a control its place on screen (the banner reads it when a press captures the control) */
function put(ctl: El, top: number): void {
  Object.assign(ctl, { getBoundingClientRect: () => ({ left: 100, right: 220, top, bottom: top + 28 }) });
}
/** a whole press on `ctl`, at its centre when it has a place: pointerdown (its press began at `began` — default: now),
 *  pointerup, click — the tap of a finger when `touch` (its click is a task of its own, after the release's timers).
 *  Did the click reach the control? */
function tap(ctl: El, o: { began?: number; touch?: boolean } = {}): boolean {
  const r = (ctl as unknown as { getBoundingClientRect?: () => { left: number; right: number; top: number; bottom: number } }).getBoundingClientRect?.();
  const pointer = { pointerId: o.touch ? 2 : 1, pointerType: o.touch ? 'touch' : 'mouse', ...(r ? { clientX: (r.left + r.right) / 2, clientY: (r.top + r.bottom) / 2 } : {}) };
  send(ctl, 'pointerdown', o.began === undefined ? pointer : { ...pointer, timeStamp: o.began });
  send(ctl, 'pointerup', pointer);
  if (o.touch) vi.advanceTimersByTime(5);
  return !send(ctl, 'click', { ...pointer, detail: 1 }).stopped;
}

// ------------------------------------------------------------------------------------------------ harness
const prefKey = 'metropolis.ui.emergencyTeaching';
let storage: Map<string, string>;
const cities: { abort: AbortController; banner: EmergencyBanner }[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.advanceTimersByTime(5000);
  storage = new Map();
  win = new Win();
  vi.stubGlobal('window', win);
  // (no frame is ever painted here: a rule that waits for one would never take a press)
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('document', { createElement: (t: string) => new El(t), createTextNode: (s: string) => textNode(s), addEventListener: () => undefined });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  });
});
afterEach(() => {
  for (const { abort, banner } of cities.splice(0)) { abort.abort('exit'); banner.dispose(); }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function incident(id: number): Incident {
  return {
    id, kind: 'fire', x: 20 + id, z: 12, buildingId: 7 + id, major: true, state: 'uncovered', start: 0,
    deadline: 5 * EMERG_DAYS_PER_MIN, severity: 1, need: { fire: 1 }, units: [], reason: 'outOfRange',
    manualPossible: true, canSend: true, place: `Harbor Refinery ${id}`, note: '', grace: 5 * EMERG_DAYS_PER_MIN,
    arrived: -1, firstAt: {}, answered: 0, work: 0, injured: 0, deaths: 0, radius: 0, fires: [7 + id], lost: 0,
    saved: 0, retry: 0, stVer: 0,
  };
}
function option(etaMin = 4.2): DispatchOption {
  return { stationId: 7, name: 'Harbor Fire Station #7', responder: 'fire', free: 1, etaMin, etaDays: etaMin * EMERG_DAYS_PER_MIN, total: 2, inRange: false };
}
/** a city without alerts yet (`options` null: the dispatch options have not arrived; `tips`: FH-08's lessons are on) */
function mount(config: { tips?: boolean; options?: DispatchOption[] | null } = {}) {
  const root = new El('div'), ui = new Emitter<UIEvents>(), events = new Emitter<CityEvents>();
  const abort = new AbortController();
  const incidents = new Map<number, Incident>();
  const policy: { alerts: { id: number; wasPossible: boolean }[]; live: boolean; teaching?: PolicySnapshot['teaching'] } = { alerts: [], live: false };
  const listeners = new Set<(p: PolicySnapshot) => void>();
  const settings: Record<string, unknown>[] = [], sounds: string[] = [];
  /** the incidents Send nearest was sent for, in order */
  const sent: number[] = [];
  let options = config.options === null ? undefined : config.options ?? [option()], version = 1;
  const act = vi.fn((op: string, args: unknown[]) => {
    if (op === 'setSettings') settings.push(args[0] as Record<string, unknown>);
    if (op !== 'dispatchBest') return { seq: 1, exact: false, done: Promise.resolve(undefined) };
    const id = args[0] as number;
    sent.push(id);
    const result: DispatchResult = { ok: true, responder: 'fire', sent: 1, etaMin: 4.2 };
    return { seq: 1, exact: false, done: Promise.resolve(result).then((r) => {
      const inc = incidents.get(id);
      if (inc) inc.state = 'dispatched';
      return r;
    }) };
  });
  const focusCell = vi.fn(), openFlyout = vi.fn();
  const ctx = {
    state: { day: 0 }, root, ui, signal: abort.signal, settings: { ...DEFAULT_SETTINGS, tips: config.tips ?? false },
    newYearBusy: () => false, setOverlay: vi.fn(), openFlyout, focusCell, showQuery: vi.fn(),
    panels: { open: vi.fn(), isOpen: () => false }, sound: (name: string) => { sounds.push(name); }, toast: vi.fn(),
    host: {
      kind: 'worker', events, act, speed: 0, liveSlowdown: 1, simTime: () => 0,
      beginGesture: () => ({ end: vi.fn(), settled: Promise.resolve() }),
      policy: Object.assign(policy, { subscribe: (fn: (p: PolicySnapshot) => void, signal: AbortSignal) => {
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
  } as unknown as GameContext;
  const banner = new EmergencyBanner(ctx, root as unknown as HTMLElement);
  cities.push({ abort, banner });
  const publish = () => { for (const fn of listeners) fn(policy); };
  return {
    root, banner, abort, events, incidents, settings, sounds, sent, focusCell, openFlyout,
    /** the map under the HUD: a press on it begins off the banner stack */
    map: root.appendChild(new El('canvas')),
    tick: () => ui.emit('uiTick', undefined),
    /** the policy's alerts are now these incidents (new ones get their banners, the others' go) */
    alert: (...ids: number[]) => {
      for (const id of ids) if (!incidents.has(id)) incidents.set(id, incident(id));
      policy.alerts = ids.map((id) => ({ id, wasPossible: true }));
      publish();
    },
    /** the policy latches FH-08's first lesson for an alerted incident */
    teach: (id: number) => { policy.teaching = { id, variant: 'E1a' }; publish(); },
    options: (next: DispatchOption[]) => { options = next; version++; },
    /** a banner's element, body and buttons */
    parts: (id: number) => {
      const b = (banner as unknown as { banners: Map<number, { el: El; body: El; send: El }> }).banners.get(id);
      expect(b, `banner for incident ${id}`).toBeDefined();
      const jump = b!.el.all().find((e) => e.tagName === 'button' && /^Jump$/.test(e.textContent)) as El | undefined;
      expect(jump, `Jump of ${id}`).toBeDefined();
      return { el: b!.el, body: b!.body, send: b!.send, jump: jump! };
    },
  };
}
type City = ReturnType<typeof mount>;
const seen = () => JSON.parse(storage.get(prefKey) ?? '{}') as Record<string, unknown>;
const card = (t: City) => t.root.querySelector('.emg-teach') as El | null;
function button(parent: FEl, label: string): El {
  const found = parent.all().find((e) => e.tagName === 'button' && e.textContent === label);
  expect(found, `button ${label}`).toBeDefined();
  return found as El;
}
const flashing = (el: El) => el.classList.contains('settling');
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('NOTE-081: the emergency banner click rule', () => {
  it('a press that began before the banner appeared sends nothing: pointerdown on the map, the banner slides in under it, pointerup and click on its Send nearest', () => {
    const t = mount();
    expect(send(t.map, 'pointerdown', { pointerId: 1 }).stopped).toBe(false);
    vi.advanceTimersByTime(40);
    t.alert(1);
    vi.advanceTimersByTime(60);
    t.tick();
    const b = t.parts(1);
    expect(b.send.disabled).toBe(false);
    send(t.map, 'pointerup', { pointerId: 1 });
    // (the click of a touch goes to what lies under the finger when it lifts; a mouse's needs both ends on the button)
    const click = send(b.send, 'click', { detail: 1 });
    expect([click.stopped, click.prevented]).toEqual([true, true]);
    expect(t.sent).toEqual([]);
    // it says so: the banner flashes, the click sounds denied
    expect(flashing(b.el)).toBe(true);
    expect(t.sounds).toEqual(['error']);
    vi.advanceTimersByTime(SETTLE_FLASH_MS);
    expect(flashing(b.el)).toBe(false);
    // the press that follows, begun on the button: one click sends
    expect(tap(b.send)).toBe(true);
    expect(t.sent).toEqual([1]);
    expect(t.sounds.filter((s) => s === 'error')).toHaveLength(1);
    // the same with the release itself on the new button (no element held the pointer), UI ticks in between
    const u = mount();
    send(u.map, 'pointerdown', { pointerId: 1 });
    vi.advanceTimersByTime(40);
    u.alert(1);
    for (let k = 0; k < 3; k++) {
      vi.advanceTimersByTime(160);
      u.tick();
    }
    const c = u.parts(1);
    send(c.send, 'pointerup', { pointerId: 1 });
    expect(send(c.send, 'click', { detail: 1 }).stopped).toBe(true);
    expect(u.sent).toEqual([]);
    expect(tap(c.send)).toBe(true);
    expect(u.sent).toEqual([1]);
  });

  it('a press that begins 30 ms after the banner appeared sends with one click — so does one in the millisecond it appears', () => {
    const t = mount();
    t.alert(1);
    vi.advanceTimersByTime(30);
    const b = t.parts(1);
    expect(tap(b.send)).toBe(true);
    expect(t.sent).toEqual([1]);
    expect(flashing(b.el)).toBe(false);
    expect(t.sounds).not.toContain('error');
    // however soon: no frame, no UI tick, no time between the banner and the press
    const u = mount();
    u.alert(1);
    expect(tap(u.parts(1).send)).toBe(true);
    expect(u.sent).toEqual([1]);
    // UI ticks and a new ETA while a pointerdown waits move nothing: its press is not ignored for them
    const v = mount();
    v.alert(1);
    vi.advanceTimersByTime(30);
    const began = performance.now();
    vi.advanceTimersByTime(12);
    v.options([option(3.1)]);
    v.tick();
    v.tick();
    expect(tap(v.parts(1).send, { began })).toBe(true);
    expect(v.sent).toEqual([1]);
    expect(v.sounds).not.toContain('error');
  });

  it('a press that began before the banner appeared, its pointerdown handled after the long task that added it, is ignored; a pointerdown time of another clock is not believed', () => {
    const t = mount();
    const began = performance.now();
    vi.advanceTimersByTime(20);
    t.alert(1);
    vi.advanceTimersByTime(8);
    const b = t.parts(1);
    expect(send(b.send, 'pointerdown', { pointerId: 1, timeStamp: began })).toEqual({ stopped: true, prevented: true });
    expect(flashing(b.el)).toBe(true);
    // (an ignored press holds no docking: nothing waits for its release)
    expect((t.banner as unknown as { pressAt: number }).pressAt).toBe(0);
    send(b.send, 'pointerup', { pointerId: 1 });
    expect(send(b.send, 'click', { detail: 1 }).stopped).toBe(true);
    expect(t.sent).toEqual([]);
    expect(t.sounds).toEqual(['error']);
    // begun 1 ms after the banner appeared, handled 7 ms later: at once
    expect(tap(b.send, { began: performance.now() - 7 })).toBe(true);
    expect(t.sent).toEqual([1]);
    // the edge of what is believed: 1 ms inside PRESS_LAG_MAX the event's time counts (before the banner: ignored) …
    const u = mount();
    vi.advanceTimersByTime(PRESS_LAG_MAX);
    u.alert(1);
    vi.advanceTimersByTime(5);
    expect(tap(u.parts(1).send, { began: performance.now() - (PRESS_LAG_MAX - 1) })).toBe(false);
    expect(u.sent).toEqual([]);
    // … and at that edge, after now (the epoch clock of older browsers), at or below zero or missing, the time the
    // pointerdown is handled does: at once
    const strange: [string, () => number | undefined][] = [
      ['PRESS_LAG_MAX before it is handled', () => performance.now() - PRESS_LAG_MAX], ['after it is handled', () => performance.now() + 1],
      ['the epoch clock', () => Date.now()], ['zero', () => 0], ['negative', () => -5], ['not a number', () => NaN], ['none', () => undefined],
    ];
    for (const [what, time] of strange) {
      const v = mount();
      v.alert(1);
      vi.advanceTimersByTime(5);
      expect(send(v.parts(1).send, 'pointerdown', { pointerId: 1, timeStamp: time() }).stopped, what).toBe(false);
      send(v.parts(1).send, 'pointerup', { pointerId: 1 });
      expect(send(v.parts(1).send, 'click', { detail: 1 }).stopped, what).toBe(false);
      expect(v.sent, what).toEqual([1]);
    }
  });

  it('a reflow that moves another banner\'s button under a pressed pointer sends nothing; the control the press began on still clicks', () => {
    const t = mount();
    t.alert(1, 2);
    vi.advanceTimersByTime(2000);
    t.tick();
    const a = t.parts(1), b = t.parts(2);
    put(a.send, 100);
    put(b.send, 250);
    // the press begins on the upper banner's Send nearest, in place for 2 s: taken (it captures the pointer)
    expect(send(a.send, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 114 }).stopped).toBe(false);
    expect(a.send.captured).toEqual([1]);
    // its incident is over and the banner goes: after the 250 ms it fades for, the lower one moves up — its Send nearest
    // now lies under the pressed pointer
    vi.advanceTimersByTime(20);
    t.alert(2);
    t.tick();
    vi.advanceTimersByTime(250);
    expect(a.el.parentElement).toBeNull();
    put(b.send, 100);
    // released there (the pressed control left the page, and its capture with it): the click lands on the other
    // banner's button — nothing is sent, that banner flashes, the click sounds denied
    send(b.send, 'pointerup', { pointerId: 1, clientX: 150, clientY: 114 });
    expect(send(b.send, 'click', { detail: 1, clientX: 150, clientY: 114 }).stopped).toBe(true);
    expect(t.sent).toEqual([]);
    expect(flashing(b.el)).toBe(true);
    expect(t.sounds).toEqual(['error']);
    // aimed at it where it now is: one click
    expect(tap(b.send)).toBe(true);
    expect(t.sent).toEqual([2]);

    // the other way round: the pressed banner itself moves away from under a still pointer — its control holds the
    // pointer, the release clicks it (close-out c2), whatever the banner did after the press began
    const u = mount();
    u.alert(1, 2);
    vi.advanceTimersByTime(2000);
    u.tick();
    const lower = u.parts(2);
    put(lower.send, 250);
    expect(send(lower.send, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 264 }).stopped).toBe(false);
    vi.advanceTimersByTime(20);
    u.alert(2);
    u.tick();
    vi.advanceTimersByTime(250);
    put(lower.send, 100);
    send(lower.send, 'pointerup', { pointerId: 1, clientX: 150, clientY: 264 });
    expect(send(lower.send, 'click', { detail: 1, clientX: 150, clientY: 264 }).stopped).toBe(false);
    expect(u.sent).toEqual([2]);
    expect(u.sounds).not.toContain('error');
  });

  it('keyboard activation works at once: Enter / Space on the focused button is a click without a press — also while a pointer press from before the banner is still held', () => {
    const t = mount();
    t.alert(1);
    // (in the millisecond the banner appeared, no pointer event at all)
    expect(send(t.parts(1).send, 'click', { detail: 0 }).stopped).toBe(false);
    expect(t.sent).toEqual([1]);
    // a mouse button held on the map since before the banner: the keyboard's click is no part of that press …
    const u = mount();
    send(u.map, 'pointerdown', { pointerId: 1 });
    vi.advanceTimersByTime(40);
    u.alert(1);
    vi.advanceTimersByTime(10);
    const b = u.parts(1);
    expect(send(b.send, 'click', { detail: 0 }).stopped).toBe(false);
    expect(u.sent).toEqual([1]);
    // … and leaves it to its own click: released over the banner, that one still does nothing
    send(u.map, 'pointerup', { pointerId: 1 });
    expect(send(b.jump, 'click', { detail: 1 }).stopped).toBe(true);
    expect(u.focusCell).not.toHaveBeenCalled();
    expect(u.sounds.filter((s) => s === 'error')).toHaveLength(1);
    // after a press on the button was ignored, the keyboard still clicks it, and the ignored press's own click stays out
    const v = mount();
    const began = performance.now();
    vi.advanceTimersByTime(20);
    v.alert(1);
    vi.advanceTimersByTime(8);
    const c = v.parts(1);
    expect(send(c.jump, 'pointerdown', { pointerId: 1, timeStamp: began }).stopped).toBe(true);
    expect(send(c.jump, 'click', { detail: 0 }).stopped).toBe(false);
    expect(v.focusCell).toHaveBeenCalledTimes(1);
    send(c.jump, 'pointerup', { pointerId: 1 });
    expect(send(c.jump, 'click', { detail: 1 }).stopped).toBe(true);
    expect(v.focusCell).toHaveBeenCalledTimes(1);
  });

  it('touch: a tap sends once although its click is a later task than its release; a finger down since before the banner sends nothing; an ignored tap stays ignored', () => {
    // a tap on a banner in place for 30 ms
    const t = mount();
    t.alert(1);
    vi.advanceTimersByTime(30);
    expect(tap(t.parts(1).send, { touch: true })).toBe(true);
    expect(t.sent).toEqual([1]);
    expect(t.sounds).not.toContain('error');
    // the finger was on the map when the banner appeared under it (its pointer events stay with the map); it lifts
    // without moving, and the browser sends the tap's click to the button now under it
    const u = mount();
    const finger = { pointerId: 2, pointerType: 'touch' };
    send(u.map, 'pointerdown', finger);
    vi.advanceTimersByTime(40);
    u.alert(1);
    vi.advanceTimersByTime(80);
    send(u.map, 'pointerup', finger);
    vi.advanceTimersByTime(5);
    expect(send(u.parts(1).send, 'click', { detail: 1 }).stopped).toBe(true);
    expect(u.sent).toEqual([]);
    expect(flashing(u.parts(1).el)).toBe(true);
    // a tap ignored at its pointerdown (it began before the banner; handled after the task that added it): its click,
    // a task after the release, is dropped too (the ignored press was forgotten at the release, and the click went through)
    const v = mount();
    const began = performance.now();
    vi.advanceTimersByTime(20);
    v.alert(1);
    vi.advanceTimersByTime(8);
    expect(tap(v.parts(1).send, { touch: true, began })).toBe(false);
    expect(v.sent).toEqual([]);
    expect(v.sounds).toEqual(['error']);
    expect(tap(v.parts(1).send, { touch: true })).toBe(true);
    expect(v.sent).toEqual([1]);
  });

  it('touch: a tap that lands beside the button, its click moved onto it by the browser, sends when the banner was in place — not when the tap began before the banner', () => {
    const finger = { pointerId: 2, pointerType: 'touch' };
    const t = mount();
    t.alert(1);
    vi.advanceTimersByTime(30);
    const b = t.parts(1);
    expect(send(b.body, 'pointerdown', finger).stopped).toBe(false);
    send(b.body, 'pointerup', finger);
    vi.advanceTimersByTime(5);
    expect(send(b.send, 'click', { detail: 1 }).stopped).toBe(false);
    expect(t.sent).toEqual([1]);
    const u = mount();
    const began = performance.now();
    vi.advanceTimersByTime(20);
    u.alert(1);
    vi.advanceTimersByTime(8);
    const c = u.parts(1);
    expect(send(c.body, 'pointerdown', { ...finger, timeStamp: began }).stopped).toBe(false);
    send(c.body, 'pointerup', finger);
    vi.advanceTimersByTime(5);
    expect(send(c.send, 'click', { detail: 1 }).stopped).toBe(true);
    expect(u.sent).toEqual([]);
    expect(flashing(c.el)).toBe(true);
  });

  it('FH-08: the first-lesson card appearing in a banner already in place counts as its buttons appearing; then one click on its Send nearest sends and closes it', async () => {
    const t = mount({ tips: true });
    t.alert(1);
    vi.advanceTimersByTime(2000);
    t.tick();
    const b = t.parts(1);
    expect(card(t)).toBeNull();
    // a finger rests on the banner, below its buttons, when the card and its buttons appear there
    const finger = { pointerId: 2, pointerType: 'touch' };
    send(b.body, 'pointerdown', finger);
    vi.advanceTimersByTime(40);
    t.teach(1);
    const c = card(t)!;
    expect(c.closest('.emg-banner')).toBe(b.el);
    const cardSend = button(c, 'Send nearest');
    expect(cardSend.disabled).toBe(false);
    send(b.body, 'pointerup', finger);
    vi.advanceTimersByTime(5);
    expect(send(cardSend, 'click', { detail: 1 }).stopped).toBe(true);
    expect(t.sent).toEqual([]);
    expect(card(t)).toBe(c);
    expect(t.settings.some((s) => s.teachingAck === 1)).toBe(false);
    // a press that begins on it sends with one click; the dispatch acknowledgement closes the card (round 1's timing)
    expect(tap(cardSend)).toBe(true);
    expect(t.sent).toEqual([1]);
    expect(seen().E1a).toBe(true);
    await flush();
    expect(card(t)).toBeNull();
    expect(t.settings.at(-1)).toMatchObject({ teachingAck: 1 });
  });

  it('FH-08 / round 1: a dropped click on a loading card is no action — E1a stays unseen; the keyboard\'s Got it acts at once', () => {
    const t = mount({ tips: true, options: null });
    t.alert(1);
    vi.advanceTimersByTime(2000);
    t.tick();
    const finger = { pointerId: 2, pointerType: 'touch' };
    send(t.parts(1).body, 'pointerdown', finger);
    vi.advanceTimersByTime(40);
    t.teach(1);
    const c = card(t)!;
    expect(c.textContent).toContain('Loading dispatch options');
    const gotIt = button(c, 'Got it');
    send(t.parts(1).body, 'pointerup', finger);
    vi.advanceTimersByTime(5);
    expect(send(gotIt, 'click', { detail: 1 }).stopped).toBe(true);
    expect(seen().E1a).not.toBe(true);
    expect(card(t)).toBe(c);
    expect(send(gotIt, 'click', { detail: 0 }).stopped).toBe(false);
    expect(seen().E1a).toBe(true);
    expect(card(t)).toBeNull();
    expect(t.settings.at(-1)).toMatchObject({ teachFirst: false, teachingAck: 1 });
  });

  it('FH-08: the folded-stack fallback card stays operable — a press on its Send nearest sends with one click; unfolded, the card is back in its banner and takes a press at once', () => {
    const t = mount({ tips: true });
    t.alert(1);
    t.teach(1);
    const c = card(t)!;
    const dock = t.banner as unknown as { applyDock(place: null, compact: boolean, rows: number): void };
    vi.advanceTimersByTime(500);
    dock.applyDock(null, true, -1);
    const fallback = t.root.querySelector('.emg-teach-fallback') as El;
    expect(fallback.parentElement).toBe(t.root);
    expect(fallback.contains(c)).toBe(true);
    // (outside the stack: a press there was never ignored, and is not now — however soon after the fold)
    dock.applyDock(null, false, 0);
    expect(c.closest('.emg-banner')).toBe(t.parts(1).el);
    expect(t.root.querySelector('.emg-teach-fallback')).toBeNull();
    dock.applyDock(null, true, -1);
    const again = t.root.querySelector('.emg-teach-fallback') as El;
    expect(again.contains(c)).toBe(true);
    expect(tap(button(c, 'Send nearest'))).toBe(true);
    expect(t.sent).toEqual([1]);
    expect(t.sounds).not.toContain('error');
    // unfolded, in the city of another profile (the lesson is not used up there): the banner is shown again (it moved:
    // a press from before that is ignored), and a press that begins once the card is back in it sends at once
    storage.clear();
    const u = mount({ tips: true });
    u.alert(1);
    u.teach(1);
    const d = u.banner as unknown as { applyDock(place: null, compact: boolean, rows: number): void };
    d.applyDock(null, true, -1);
    vi.advanceTimersByTime(500);
    const began = performance.now();
    vi.advanceTimersByTime(20);
    d.applyDock(null, false, 0);
    vi.advanceTimersByTime(8);
    const back = button(card(u)!, 'Send nearest');
    expect(back.closest('.emg-banner')).toBe(u.parts(1).el);
    expect(tap(back, { began })).toBe(false);
    expect(u.sent).toEqual([]);
    expect(tap(back)).toBe(true);
    expect(u.sent).toEqual([1]);
  });

  it('FH-08: the failure note appearing in a banner counts as its button appearing', () => {
    const t = mount({ tips: true });
    t.alert(1);
    vi.advanceTimersByTime(2000);
    t.tick();
    const b = t.parts(1);
    const finger = { pointerId: 2, pointerType: 'touch' };
    send(b.body, 'pointerdown', finger);
    vi.advanceTimersByTime(40);
    Object.assign(t.incidents.get(1)!, { state: 'failed', lost: 1 });
    t.events.emit('emergency', { id: 1, kind: 'fire', type: 'failed', x: 21, z: 12, major: true, manualPossible: false });
    const tab = button(t.root.querySelector('.emg-teach-reason')!, 'Fire tab');
    expect(tab.closest('.emg-banner')).toBe(b.el);
    send(b.body, 'pointerup', finger);
    vi.advanceTimersByTime(5);
    expect(send(tab, 'click', { detail: 1 }).stopped).toBe(true);
    expect(t.openFlyout).not.toHaveBeenCalled();
    expect(tap(tab)).toBe(true);
    expect(t.openFlyout).toHaveBeenCalledWith('civic', 'fire');
  });

  it('a click that follows no press of its own (a tool that sends only the click) is never ignored, whatever was pressed before it', () => {
    const t = mount();
    t.alert(1);
    vi.advanceTimersByTime(500);
    // an ordinary press and click on the first banner: over and done with
    expect(tap(t.parts(1).jump)).toBe(true);
    expect(t.focusCell).toHaveBeenCalledTimes(1);
    // a second banner appears, and a bare click lands on it: there is no press to judge it by
    vi.advanceTimersByTime(40);
    t.alert(1, 2);
    expect(send(t.parts(2).send, 'click', { detail: 1 }).stopped).toBe(false);
    expect(t.sent).toEqual([2]);
    expect(t.sounds).not.toContain('error');
  });

  it('exit: the window keeps none of the banner\'s listeners, the press listener included', () => {
    const t = mount();
    t.alert(1);
    expect(win.count('pointerdown')).toBe(1);
    expect(win.of('pointerdown', true)).toHaveLength(1);
    t.abort.abort('exit');
    expect(win.count()).toBe(0);
    // a retained stack hears nothing: a press and a click on a kept button reach only what is left of it
    const b = (t.banner as unknown as { banners: Map<number, { send: El }> }).banners.get(1)!;
    expect(tap(b.send)).toBe(true);
    expect(t.sent).toEqual([]);
  });
});
