/** T085: a loading first-dispatch coach does not consume the profile's lesson. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { Overlay } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import type { CityEvents } from '../../src/sim/Simulation';
import type { DispatchOption, DispatchResult, Incident } from '../../src/sim/infra/emergency';
import { EMERG_DAYS_PER_MIN } from '../../src/sim/infra/params';
import { EmergencyBanner } from '../../src/ui/EmergencyBanner';
import type { PolicySnapshot } from '../../src/worker/SimHost';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();

const prefKey = 'metropolis.ui.emergencyTeaching';
let storage: Map<string, string>;
const cities: { abort: AbortController; banner: EmergencyBanner }[] = [];
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  });
});
afterEach(() => {
  for (const { abort, banner } of cities.splice(0)) { abort.abort('exit'); banner.dispose(); }
  vi.unstubAllGlobals();
});

function incident(id = 1): Incident {
  return {
    id, kind: 'fire', x: 20, z: 12, buildingId: 7, major: true, state: 'uncovered', start: 0,
    deadline: 5 * EMERG_DAYS_PER_MIN, severity: 1, need: { fire: 1 }, units: [], reason: 'outOfRange',
    manualPossible: true, canSend: true, place: 'Harbor Refinery', note: '', grace: 5 * EMERG_DAYS_PER_MIN,
    arrived: -1, firstAt: {}, answered: 0, work: 0, injured: 0, deaths: 0, radius: 0, fires: [7], lost: 0,
    saved: 0, retry: 0, stVer: 0,
  };
}
function option(): DispatchOption {
  return { stationId: 7, name: 'Harbor Fire Station #7', responder: 'fire', free: 1, etaMin: 4.2,
    etaDays: 4.2 * EMERG_DAYS_PER_MIN, total: 2, inRange: false };
}
function harness(config: { initialOptions?: DispatchOption[]; busy?: boolean; variant?: 'E1a' | 'E1b' } = {}) {
  const root = new FEl('div'), ui = new Emitter<UIEvents>(), events = new Emitter<CityEvents>();
  const abort = new AbortController(), inc = incident();
  const incidents = new Map([[inc.id, inc]]);
  const policy: PolicySnapshot = { alerts: [{ id: inc.id, wasPossible: true }], live: false,
    teaching: { id: inc.id, variant: config.variant ?? 'E1a' } };
  const listeners = new Set<(p: PolicySnapshot) => void>();
  const settings: Record<string, unknown>[] = [];
  const clock = { busy: config.busy ?? false };
  let options = config.initialOptions, version = 1;
  let result = Promise.resolve<DispatchResult>({ ok: true, responder: 'fire', sent: 1, etaMin: 4.2 });
  const act = vi.fn((op: string, args: unknown[]) => {
    if (op === 'setSettings') settings.push(args[0] as Record<string, unknown>);
    return { seq: 1, exact: false, done: op === 'dispatchBest' ? result.then((r) => {
      if (r.ok) inc.state = 'dispatched';
      return r;
    }) : Promise.resolve(undefined) };
  });
  const setOverlay = vi.fn(), openFlyout = vi.fn();
  const ctx = {
    state: { day: 0 }, root, ui, signal: abort.signal, settings: { ...DEFAULT_SETTINGS, tips: true },
    newYearBusy: () => clock.busy, setOverlay, openFlyout,
    panels: { open: vi.fn(), isOpen: () => false }, sound: vi.fn(), toast: vi.fn(),
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
  return {
    root, ui, events, abort, inc, incidents, clock, settings, act, setOverlay, openFlyout, ctx, banner,
    tick: () => ui.emit('uiTick', undefined),
    publish: (patch: Partial<PolicySnapshot>) => { Object.assign(policy, patch); for (const fn of listeners) fn(policy); },
    options: (next: DispatchOption[]) => { options = next; version++; },
    dispatch: (next: Promise<DispatchResult>) => { result = next; },
  };
}
type Harness = ReturnType<typeof harness>;
const seen = () => JSON.parse(storage.get(prefKey) ?? '{}') as Record<string, unknown>;
const card = (t: Harness) => t.root.querySelector('.emg-teach');
function button(parent: FEl, label: string): FEl {
  const found = parent.all().find((e) => e.tagName === 'button' && e.textContent === label);
  expect(found, `button ${label}`).toBeDefined();
  return found!;
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('T085 first-dispatch lesson seen timing', () => {
  it('keeps a loading E1a available until the delivered station and ETA are rendered', () => {
    const t = harness(), c = card(t)!;
    expect(c.textContent).toContain('Loading dispatch options');
    expect(button(c, 'Send nearest').disabled).toBe(true);
    t.tick();
    t.tick();
    expect(seen().E1a).not.toBe(true);
    expect(t.settings.at(-1)).toMatchObject({ teachFirst: true });
    t.options([option()]);
    expect(seen().E1a).not.toBe(true);
    t.tick();
    expect(card(t)).toBe(c);
    expect(c.textContent).toContain('Harbor Fire Station #7 (4.2 min)');
    expect(button(c, 'Send nearest').disabled).toBe(false);
    expect(seen().E1a).toBe(true);
    expect(t.settings.at(-1)).toMatchObject({ teachFirst: false });
    expect(t.settings.some((s) => s.teachingAck === 1)).toBe(false);
  });

  it('counts a rendered no-free-unit result as shown options', () => {
    const t = harness();
    expect(seen().E1a).not.toBe(true);
    t.options([]);
    t.tick();
    expect(card(t)!.textContent).toContain('No free unit can go right now.');
    expect(button(card(t)!, 'Send nearest').disabled).toBe(true);
    expect(seen().E1a).toBe(true);
    expect(t.settings.some((s) => s.teachingAck === 1)).toBe(false);
  });

  it.each(['resolved', 'invalidated', 'removed'] as const)('does not consume a loading card when its incident is %s', (end) => {
    const t = harness();
    if (end === 'resolved') {
      t.inc.state = 'resolved';
      t.events.emit('emergency', { id: 1, kind: 'fire', type: 'resolved', x: 20, z: 12, major: true, manualPossible: false });
    } else if (end === 'invalidated') {
      t.inc.state = 'dispatched';
      t.tick();
    } else {
      t.incidents.delete(1);
      t.publish({ alerts: [], teaching: undefined });
    }
    expect(card(t)).toBeNull();
    expect(seen().E1a).not.toBe(true);
    t.abort.abort('exit');
    const next = harness();
    expect(next.settings[0]).toMatchObject({ teachFirst: true });
    expect(card(next)!.textContent).toContain('Loading dispatch options');
  });

  it('leaves E1a available after abort even if a retained options reply arrives', () => {
    const t = harness();
    t.abort.abort('exit');
    t.options([option()]);
    t.tick();
    t.publish({});
    expect(card(t)).toBeNull();
    expect(seen().E1a).not.toBe(true);
    const next = harness();
    expect(card(next)).not.toBeNull();
    expect(next.settings[0]).toMatchObject({ teachFirst: true });
  });

  it.each([false, true])('waits for visible options when New Year is busy from mount: %s', (initialBusy) => {
    const t = harness({ busy: initialBusy });
    const c = card(t);
    t.clock.busy = true;
    t.tick();
    t.options([option()]);
    t.tick();
    if (c) expect(c.style.display).toBe('none');
    else expect(card(t)).toBeNull();
    expect(seen().E1a).not.toBe(true);
    t.clock.busy = false;
    t.tick();
    expect(card(t)!.style.display).not.toBe('none');
    expect(card(t)!.textContent).toContain('Harbor Fire Station #7');
    if (c) expect(card(t)).toBe(c);
    expect(seen().E1a).toBe(true);
    expect(t.settings.some((s) => s.teachingAck === 1)).toBe(false);
  });

  it.each(['Got it', 'Emergency view', 'Dismiss'])('records explicit %s while E1a is still loading', (action) => {
    const t = harness();
    expect(seen().E1a).not.toBe(true);
    if (action === 'Dismiss') t.root.querySelector('.emg-x')!.click();
    else button(card(t)!, action).click();
    expect(seen().E1a).toBe(true);
    expect(card(t)).toBeNull();
    expect(t.settings.at(-1)).toMatchObject({ teachFirst: false, teachingAck: 1 });
    if (action === 'Emergency view') expect(t.setOverlay).toHaveBeenCalledWith(Overlay.Emergency);
    if (action === 'Dismiss') expect(t.act).toHaveBeenCalledWith('dismissAlert', [1], expect.objectContaining({ tag: t.banner }));
    t.publish({});
    t.tick();
    expect(card(t)).toBeNull();
  });

  it('turning Tips off closes a loading card without using E1a up', () => {
    const t = harness();
    t.ctx.settings.tips = false;
    t.ui.emit('settings', t.ctx.settings);
    expect(card(t)).toBeNull();
    expect(seen().E1a).not.toBe(true);
    expect(t.settings.at(-1)).toMatchObject({ teachingAck: 1, teachFirst: false });
    t.abort.abort('exit');
    const next = harness();
    expect(card(next)).not.toBeNull();
    expect(next.settings[0]).toMatchObject({ teachFirst: true });
  });

  it('keeps Send pending and only acknowledges its episode after a successful dispatch', async () => {
    const t = harness({ initialOptions: [option()] });
    let finish!: (r: DispatchResult) => void;
    t.dispatch(new Promise((resolve) => { finish = resolve; }));
    button(card(t)!, 'Send nearest').click();
    expect(seen().E1a).toBe(true);
    expect(card(t)).not.toBeNull();
    expect(t.settings.some((s) => s.teachingAck === 1)).toBe(false);
    expect(t.act).toHaveBeenCalledWith('dispatchBest', [1], expect.objectContaining({ tag: t.banner }));
    finish({ ok: true, responder: 'fire', sent: 1, etaMin: 4.2 });
    await flush();
    expect(card(t)).toBeNull();
    expect(t.settings.at(-1)).toMatchObject({ teachingAck: 1 });
  });

  it('records E1b after its prevention text is rendered without waiting for dispatch options', () => {
    const t = harness({ variant: 'E1b' });
    expect(card(t)!.textContent).toContain('No station can reach this in time.');
    expect(seen().E1b).toBe(true);
    expect(seen().E1a).not.toBe(true);
    button(card(t)!, 'Fire tab').click();
    expect(card(t)).toBeNull();
    expect(t.openFlyout).toHaveBeenCalledWith('civic', 'fire');
    expect(t.settings.at(-1)).toMatchObject({ teachingAck: 1 });
  });
});
