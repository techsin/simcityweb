/** Emergency outcome feedback uses the host's records, including local finalization and replay-time replacements. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { GameSounds, emergencyStingJustPlayed, emergencyStingPending } from '../../src/game/GameSounds';
import type { GameContext, UIEvents } from '../../src/game/context';
import type { CityEvents, EmergencyEvent, Simulation } from '../../src/sim/Simulation';
import { emergencyOf, type Incident } from '../../src/sim/infra/emergency';
import { EmergencyBanner } from '../../src/ui/EmergencyBanner';
import { LocalSimHost, type Cause, type PolicySnapshot, type SimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();
const cleanups: (() => void)[] = [];

function incident(id = 1, patch: Partial<Incident> = {}): Incident {
  return {
    id, kind: 'industrial', x: 12, z: 10, buildingId: -1, major: true, state: 'uncovered',
    start: 0, deadline: 20, severity: 1, need: { fire: 1 }, units: [], manualPossible: true,
    place: 'Refinery', note: 'No fire truck nearby', grace: 6, arrived: -1, firstAt: {},
    answered: 0, work: 1, injured: 0, deaths: 0, radius: 0, fires: [], lost: 0, saved: 0,
    retry: 0, stVer: 0, ...patch,
  };
}

function fixture(initial: Incident[] = [], ready: Promise<void> = Promise.resolve()) {
  const events = new Emitter<CityEvents>(), ui = new Emitter<UIEvents>();
  const policies = new Emitter<{ change: PolicySnapshot }>();
  const live = new Map(initial.map((inc) => [inc.id, inc]));
  const abort = new AbortController(), root = new FEl('div');
  let current: PolicySnapshot = { alerts: [], live: false }, cause: Cause | null = null;
  const state = { budget: { lastIncome: {}, lastExpense: {} } };
  // Deliberately separate: outcome handling must subscribe to the host rather than a simulation's private emitter.
  const sim = { events: new Emitter<CityEvents>(), state } as unknown as Simulation;
  const host = {
    events, state, ready, simTime: () => 1, speed: 1,
    get cause() { return cause; },
    emergency: {
      active: true, layersReady: true, incident: (id: number) => live.get(id),
      incidents: () => [...live.values()], vehicles: () => [], stationList: () => [],
      stationFleet: () => null, stationName: () => 'Fire station',
    },
    policy: {
      get alerts() { return current.alerts; }, get live() { return current.live; },
      get toast() { return current.toast; }, get warn() { return current.warn; },
      subscribe(listener: (p: PolicySnapshot) => void, signal: AbortSignal) {
        const off = policies.on('change', listener);
        signal.addEventListener('abort', off, { once: true });
        return off;
      },
    },
    act: vi.fn(() => ({ seq: 1, exact: true, done: Promise.resolve(undefined) })),
    watch: () => ({ value: [], error: undefined, version: 1, setArgs() {}, subscribe: () => () => {}, dispose() {} }),
  } as unknown as SimHost;
  const plays: string[] = [], sound = vi.fn((name: string) => { plays.push(name); });
  const sounds = new GameSounds({ sim, host, signal: abort.signal, sound, world: () => ({ camera: null }) as never, sandbox: () => true });
  const toast = vi.fn((text: string, kind?: string, cell?: { x: number; z: number }, title?: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) sound(kind === 'good' ? 'good' : 'notify');
  });
  const ctx = {
    host, state, sim: { events }, ui, root, signal: abort.signal, sound, toast,
    settings: { emergencyUncovered: 'live', emergencyLiveSlowmo: 3, emergencyAlerts: 'major' },
    panels: { isOpen: () => false, open() {} },
  } as unknown as GameContext;
  const banner = new EmergencyBanner(ctx, root as unknown as HTMLElement);
  const policy = (next: PolicySnapshot) => { current = next; policies.emit('change', next); };
  const emit = (type: EmergencyEvent['type'], inc: Incident, tag?: object) => {
    cause = tag ? { seq: 7, tag } : null;
    events.emit('emergency', { type, id: inc.id, kind: inc.kind, x: inc.x, z: inc.z, major: inc.major, manualPossible: inc.manualPossible });
    cause = null;
  };
  const offer = (inc: Incident) => {
    live.set(inc.id, inc);
    emit('new', inc);
    const ids = new Set(current.alerts.map((alert) => alert.id));
    ids.add(inc.id);
    policy({ alerts: [...ids].map((id) => ({ id, wasPossible: true })), live: true });
  };
  const end = (inc: Incident, type: 'resolved' | 'failed' = 'resolved') => {
    inc.state = type;
    // The real local emergency system removes its lookup entry before emitting the final outcome.
    live.delete(inc.id);
    emit(type, inc);
  };
  const row = () => root.querySelector('.emg-banner')!;
  const restore = () => policy({ alerts: current.alerts, live: false, toast: { text: 'Emergencies handled — back to ultra speed', kind: 'good' } });
  cleanups.push(() => { abort.abort(); sounds.dispose(); banner.dispose(); });
  return { host, sim, events, ui, ctx, live, abort, root, plays, sound, toast, sounds, banner, policy, emit, offer, end, row, restore };
}

describe('emergency outcome feedback', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] }));
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('plays one saved sting for a player dispatch, silences the restore toast and following outcome news, and flashes for 600 ms', () => {
    const f = fixture(), inc = incident(1, { answered: 2, state: 'onScene' });
    f.offer(inc);
    f.restore();
    expect(f.toast).toHaveBeenCalledWith('Emergencies handled — back to ultra speed', 'good', undefined, 'Emergency', { silent: true });
    expect(f.plays).toEqual([]);
    vi.advanceTimersByTime(250);
    f.end(inc);
    expect(f.plays).toEqual(['saved']);
    expect(f.row().classList.contains('emg-saved')).toBe(true);
    expect(f.row().textContent).toContain('Industrial accident under control');
    f.events.emit('news', { day: 1, kind: 'good', text: 'Refinery is under control — thanks to your dispatch.' });
    vi.advanceTimersByTime(599);
    expect(f.plays).toEqual(['saved']);
    expect(f.row().classList.contains('emg-saved')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(f.row().classList.contains('emg-saved')).toBe(false);
  });

  it('plays lost for a failed alert without a dispatch and flashes red for 600 ms', () => {
    const f = fixture(), inc = incident();
    f.offer(inc);
    f.end(inc, 'failed');
    expect(f.plays).toEqual(['lost']);
    expect(f.row().classList.contains('emg-lost')).toBe(true);
    expect(f.row().textContent).toContain('No fire truck was sent in time');
    vi.advanceTimersByTime(599);
    expect(f.row().classList.contains('emg-lost')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(f.row().classList.contains('emg-lost')).toBe(false);
  });

  it.each([
    { lost: 1, deaths: 0, text: '1 building lost' },
    { lost: 0, deaths: 1, text: '1 dead' },
  ])('uses the host terminal record for a resolved incident with $text', ({ lost, deaths, text }) => {
    const f = fixture(), inc = incident(1, { answered: 2 });
    f.offer(inc);
    // A worker replays the terminal record before the event, even when an earlier cached record had no losses.
    const terminal = { ...inc, state: 'resolved' as const, lost, deaths };
    f.live.set(inc.id, terminal);
    f.emit('resolved', terminal);
    f.live.delete(inc.id);
    expect(f.plays).toEqual(['lost']);
    expect(f.row().classList.contains('emg-lost')).toBe(true);
    expect(f.row().classList.contains('emg-saved')).toBe(false);
    expect(f.row().textContent).toContain(text);
  });

  it('shares the 10 second outcome budget across success and failure, including the exact boundary', () => {
    const f = fixture(), first = incident(1, { answered: 2 });
    f.offer(first); f.end(first);
    vi.advanceTimersByTime(9999);
    const second = incident(2);
    f.offer(second); f.end(second, 'failed');
    expect(f.plays).toEqual(['saved']);
    vi.advanceTimersByTime(1);
    const third = incident(3, { answered: 2, lost: 1 });
    f.offer(third); f.end(third);
    expect(f.plays).toEqual(['saved', 'lost']);
  });

  it('leaves an automatic lossless resolution quiet and ignores the simulation private emitter', () => {
    const f = fixture(), inc = incident(1, { answered: 1, state: 'dispatched' });
    f.offer(inc);
    f.emit('dispatched', inc);
    f.sim.events.emit('emergency', { type: 'failed', id: 999, kind: 'fire', x: 0, z: 0, major: true, manualPossible: false });
    f.end(inc);
    expect(f.plays).toEqual([]);
    expect(emergencyStingJustPlayed(f.host)).toBe(false);
  });

  it.each([
    { type: 'failed' as const, lost: 0, deaths: 0 },
    { type: 'resolved' as const, lost: 0, deaths: 1 },
    { type: 'resolved' as const, lost: 1, deaths: 0 },
  ])('ignores an unseen automatic $type with $lost losses and $deaths deaths without spending the sting budget', ({ type, lost, deaths }) => {
    const auto = incident(1, { answered: 1, state: 'onScene', lost, deaths }), f = fixture([auto]);
    f.end(auto, type);
    expect(f.plays).toEqual([]);
    expect(emergencyStingJustPlayed(f.host)).toBe(false);
    const player = incident(2, { answered: 2 });
    f.offer(player); f.end(player);
    expect(f.plays).toEqual(['saved']);
    vi.advanceTimersByTime(9999);
    const unseen = incident(3, { answered: 1, deaths: 1 });
    f.live.set(unseen.id, unseen); f.emit('new', unseen); f.end(unseen, type);
    vi.advanceTimersByTime(1);
    const alert = incident(4);
    f.offer(alert); f.end(alert, 'failed');
    expect(f.plays).toEqual(['saved', 'lost']);
  });

  it('remembers a bannered incident after its alert disappears and its response is automatic', () => {
    const f = fixture(), inc = incident(1, { answered: 1, deaths: 1 });
    f.offer(inc);
    f.policy({ alerts: [], live: false });
    f.end(inc);
    expect(f.plays).toEqual(['lost']);
  });

  it('does not silence another episode because an unrelated player response is still on scene', () => {
    const old = incident(1, { answered: 2, state: 'onScene' }), f = fixture([old]);
    const alert = incident(2);
    f.offer(alert);
    f.policy({ alerts: [{ id: alert.id, wasPossible: true }], live: true });
    f.policy({ alerts: [], live: false, toast: { text: 'Emergency over', kind: 'info' } });
    expect(f.toast).toHaveBeenLastCalledWith('Emergency over', 'info', undefined, 'Emergency', { silent: false });
    expect(emergencyStingPending(f.host, new Set([old.id]))).toBe(true);
  });

  it('keeps an episode dispatch pending even when the restore snapshot no longer lists its alert', () => {
    const f = fixture(), inc = incident(1, { answered: 2, state: 'dispatched' });
    f.offer(inc);
    f.policy({ alerts: [{ id: inc.id, wasPossible: true }], live: true });
    f.policy({ alerts: [], live: false, toast: { text: 'Emergencies handled', kind: 'good' } });
    expect(f.toast).toHaveBeenLastCalledWith('Emergencies handled', 'good', undefined, 'Emergency', { silent: true });
    expect(f.plays).toEqual([]);
    f.end(inc);
    expect(f.plays).toEqual(['saved']);
  });

  it('does not carry ignored dispatches into a new pause episode', () => {
    const old = incident(1), f = fixture([old]);
    f.ctx.settings.emergencyUncovered = 'ignore';
    f.ui.emit('settings', f.ctx.settings);
    f.policy({ alerts: [{ id: old.id, wasPossible: true }], live: false, warn: true });
    old.answered = 2; old.state = 'onScene';
    f.ctx.settings.emergencyUncovered = 'pause';
    f.ui.emit('settings', f.ctx.settings);
    const alert = incident(2);
    f.live.set(alert.id, alert); f.emit('new', alert);
    f.policy({ alerts: [{ id: old.id, wasPossible: true }, { id: alert.id, wasPossible: true }], live: false, warn: true });
    f.policy({ alerts: [{ id: old.id, wasPossible: true }], live: false, toast: { text: 'Emergency over', kind: 'info' } });
    expect(f.toast).toHaveBeenLastCalledWith('Emergency over', 'info', undefined, 'Emergency', { silent: false });
  });

  it('still silences a restore delivered just after resolution', () => {
    const f = fixture(), inc = incident(1, { answered: 2 });
    f.offer(inc); f.end(inc);
    vi.advanceTimersByTime(999);
    f.restore();
    expect(f.plays).toEqual(['saved']);
    expect(f.toast).toHaveBeenLastCalledWith(expect.any(String), 'good', undefined, 'Emergency', { silent: true });
  });

  it('recognizes a cause-tagged primary player dispatch after its command cause has ended', () => {
    const f = fixture(), inc = incident(1, { answered: 2, state: 'dispatched' });
    f.offer(inc);
    f.emit('dispatched', inc, {});
    expect(f.host.cause).toBeNull();
    f.end(inc);
    expect(f.plays).toEqual(['saved']);
  });

  it('keeps a command-triggered automatic response quiet even when its dispatched event carries a cause', () => {
    const f = fixture(), inc = incident(1, { answered: 1, state: 'dispatched' });
    f.offer(inc);
    // A disaster command can start an automatic response; a command cause does not identify a manual dispatch.
    f.emit('dispatched', inc, { tool: 'disaster' });
    f.end(inc);
    expect(f.plays).toEqual([]);
    expect(emergencyStingJustPlayed(f.host)).toBe(false);
  });

  it('retains host incident references present at boot through local-style removal', () => {
    const inc = incident(1, { answered: 2, state: 'onScene' }), f = fixture([inc]);
    inc.lost = 1;
    f.end(inc);
    expect(f.plays).toEqual(['lost']);
  });

  it.each([
    { lost: 0, expected: 'saved' },
    { lost: 1, expected: 'lost' },
  ])('plays $expected for a saved player incident restored after construction but before host.ready', async ({ lost, expected }) => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const f = fixture([], ready), inc = incident(1, { answered: 2, state: 'onScene' });
    // Local hosts start their systems after the UI is constructed; restored on-scene incidents emit no new event.
    f.live.set(inc.id, inc);
    resolveReady();
    await ready;
    inc.lost = lost;
    f.end(inc);
    expect(f.plays).toEqual([expected]);
  });

  it('does not reread or retain late host incidents when the city aborts before host.ready', async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const f = fixture([], ready), reads = vi.spyOn(f.host.emergency, 'incidents');
    f.live.set(1, incident(1, { answered: 2, state: 'onScene' }));
    f.abort.abort();
    resolveReady();
    await ready;
    expect(reads).not.toHaveBeenCalled();
    expect(emergencyStingJustPlayed(f.host)).toBe(false);
  });

  it('keeps a later restore toast audible once the sting is no longer recent', () => {
    const f = fixture(), inc = incident(1, { answered: 2 });
    f.offer(inc); f.end(inc);
    vi.advanceTimersByTime(1000);
    f.restore();
    expect(f.toast).toHaveBeenLastCalledWith('Emergencies handled — back to ultra speed', 'good', undefined, 'Emergency', { silent: false });
    expect(f.plays).toEqual(['saved', 'good']);
  });

  it('clears saved feedback, cached incidents and dispatch provenance when the host resets', () => {
    const f = fixture(), first = incident(1, { answered: 2 });
    f.offer(first); f.end(first);
    expect(emergencyStingJustPlayed(f.host)).toBe(true);
    const next = incident(2, { answered: 2 });
    f.offer(next); f.emit('dispatched', next, {});
    f.events.emit('reset', undefined);
    expect(emergencyStingJustPlayed(f.host)).toBe(false);
    expect(f.banner.bannerIds).toEqual([]);
    vi.advanceTimersByTime(10000);
    const reused = incident(2, { answered: 1 });
    f.offer(reused); f.end(reused);
    expect(f.plays).toEqual(['saved']);
  });

  it('removes outcome listeners, pending news and flash timers when the city aborts', () => {
    const f = fixture(), inc = incident(1, { answered: 2 });
    f.offer(inc); f.end(inc);
    const row = f.row();
    f.events.emit('news', { day: 1, kind: 'good', text: 'Outcome news' });
    f.abort.abort();
    expect(emergencyStingJustPlayed(f.host)).toBe(false);
    expect(row.classList.contains('emg-saved')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20000);
    f.emit('failed', incident(2));
    f.restore();
    expect(f.plays).toEqual(['saved']);
    expect(f.toast).not.toHaveBeenCalled();
  });

  it('leaves an unseen real LocalSimHost failure quiet after its incident lookup has been removed', async () => {
    const st = newState(32), host = new LocalSimHost(st), abort = new AbortController();
    await host.start();
    const plays: string[] = [];
    const sounds = new GameSounds({ sim: host.sim, host, signal: abort.signal, sound: (name) => plays.push(name), world: () => ({ camera: null }) as never, sandbox: () => true });
    let absentDuringOutcome = false;
    const off = host.events.on('emergency', (e) => {
      if (e.type === 'failed') absentDuringOutcome = host.emergency.incident(e.id) === undefined;
    });
    try {
      const em = emergencyOf(host.sim)!;
      const id = em.spawn(host.sim, 'medical', 10, 10, { major: true });
      const inc = host.emergency.incident(id)!;
      inc.deadline = st.day;
      em.dailyWork(host.sim);
      expect(absentDuringOutcome).toBe(true);
      expect(host.emergency.incident(id)).toBeUndefined();
      expect(plays.filter((name) => name === 'saved' || name === 'lost')).toEqual([]);
    } finally {
      off(); abort.abort(); sounds.dispose(); await host.dispose();
    }
  });
});
