/** FH-08: profile settings reach the authoritative policy on both the local and clone-only packet paths. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext, UIEvents } from '../../src/game/context';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import type { DispatchOption, EmergencySystem, Incident } from '../../src/sim/infra/emergency';
import type { EmergencyEvent } from '../../src/sim/Simulation';
import { EmergencyBanner } from '../../src/ui/EmergencyBanner';
import type { ToastOptions } from '../../src/ui/Notifications';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { LocalSimHost, type PolicySnapshot, type SimSettings } from '../../src/worker/SimHost';
import type { Packet } from '../../src/worker/protocol';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom } from '../game/fakeDom';

installFakeDom();
const settings: SimSettings = { emergencyUncovered: 'live', emergencyAlerts: 'major', emergencyLiveSlowmo: 3 };
const hosts: (LocalSimHost | LoopbackSimHost)[] = [];
const closeBanners: (() => void)[] = [];
afterEach(async () => {
  for (const close of closeBanners.splice(0)) close();
  for (const host of hosts.splice(0)) await host.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function incident(id: number, manualPossible = true): Incident {
  return {
    id, kind: 'fire', x: 10, z: 10, buildingId: -1, major: true, state: 'uncovered', start: 0, deadline: 30,
    severity: 1, need: { fire: 1 }, units: [], reason: 'outOfRange', manualPossible, canSend: true, place: 'Test fire', note: '',
    grace: 1, arrived: -1, firstAt: {}, answered: 0, work: 1, injured: 0, deaths: 0, radius: 0, fires: [],
    lost: 0, saved: 0, retry: 0, stVer: 0,
  };
}

async function fixture(packet: boolean) {
  const packets: Packet[] = [];
  const st = newState(32);
  st.stats.population = 5000;
  const host = packet
    ? new LoopbackSimHost(st, { initialSpeed: 3, onPacket: (p) => packets.push(structuredClone(p)) })
    : new LocalSimHost(st, { initialSpeed: 3 });
  hosts.push(host);
  await host.start();
  const sim = host instanceof LoopbackSimHost ? host.harness.core.sim : host.sim;
  const em = sim.getSystem<EmergencySystem>('emergency')!;
  const list: Incident[] = [];
  const option: DispatchOption = { stationId: 1, name: 'Fire', responder: 'fire', free: 1, total: 1, etaDays: 1, etaMin: 1, inRange: false };
  // Settled incidents isolate the policy transport from fire generation and pathfinding.
  vi.spyOn(em, 'incidents').mockImplementation(() => list);
  vi.spyOn(em, 'incident').mockImplementation((id) => list.find((inc) => inc.id === id));
  vi.spyOn(em, 'dispatchOptions').mockImplementation(() => [option]);
  vi.spyOn(em, 'dispatchBest').mockImplementation((_sim, id) => {
    const inc = list.find((i) => i.id === id);
    if (!inc) return { ok: false, reason: 'Incident missing' };
    inc.state = 'dispatched'; inc.answered = 2; inc.etaMin = 1;
    sim.events.emit('emergency', event(inc, 'dispatched'));
    return { ok: true };
  });
  let snapshot: PolicySnapshot = { alerts: [], live: false };
  const updates: PolicySnapshot[] = [], ac = new AbortController();
  host.policy.subscribe((p) => { snapshot = structuredClone(p); updates.push(snapshot); }, ac.signal);
  const settle = async () => {
    await Promise.resolve();
    host.frame(0);
    if (host instanceof LoopbackSimHost) await host.drain();
  };
  const set = async (value: SimSettings) => {
    const ticket = host.act('setSettings', [value]);
    await settle();
    await ticket.done;
  };
  const raise = async (inc: Incident) => {
    list.push(inc);
    sim.events.emit('emergency', event(inc));
    await settle();
  };
  return {
    host, packets, updates, set, raise, settle,
    get snapshot() { return snapshot; },
    expectTeaching(teaching: PolicySnapshot['teaching']) {
      expect(snapshot.teaching).toEqual(teaching);
      if (host instanceof LoopbackSimHost) expect(host.replica.policy.teaching).toEqual(teaching);
      else expect(host.policy.teaching).toEqual(teaching);
    },
  };
}

function event(inc: Incident, type: EmergencyEvent['type'] = 'uncovered'): EmergencyEvent {
  return { type, id: inc.id, kind: inc.kind, x: inc.x, z: inc.z, major: inc.major, manualPossible: inc.manualPossible, reason: inc.reason };
}

function mountBanner(host: LocalSimHost | LoopbackSimHost) {
  const root = Object.assign(new FEl('div'), { clientWidth: 1600, offsetWidth: 1600 });
  const ui = new Emitter<UIEvents>(), abort = new AbortController();
  const ctx = {
    host, get state() { return host.state; }, root, ui, signal: abort.signal,
    settings: { ...DEFAULT_SETTINGS, tips: true }, newYearBusy: () => false,
    panels: { open: vi.fn(), isOpen: () => false }, sound: vi.fn(),
    toast: (_text: string, _kind?: string, _cell?: { x: number; z: number }, _title?: string, opts?: ToastOptions) => opts?.onShow?.(),
    setOverlay: vi.fn(), openFlyout: vi.fn(), focusCell: vi.fn(), showQuery: vi.fn(),
  } as unknown as GameContext;
  const banner = new EmergencyBanner(ctx, root as unknown as HTMLElement);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    abort.abort('exit');
    banner.dispose();
  };
  closeBanners.push(close);
  return { root, close, tick: () => ui.emit('uiTick', undefined) };
}

describe('FH-08 packet policy view', () => {
  it('keeps the public teaching getter equal to subscribed episodes after packet updates', async () => {
    const f = await fixture(true), policy = f.host.policy;
    const expectCurrent = (teaching: PolicySnapshot['teaching']) => {
      expect(f.snapshot.teaching).toEqual(teaching);
      expect(policy.teaching).toEqual(f.snapshot.teaching);
    };
    expectCurrent(undefined);
    await f.set({ ...settings, teachFirst: true, teachTooFar: true });
    await f.raise(incident(1, false));
    expectCurrent({ id: 1, variant: 'E1b' });
    const updates = f.updates.length;
    await f.set({ ...settings, teachFirst: true, teachTooFar: true, teachingAck: 1 });
    expect(f.updates.length).toBeGreaterThan(updates);
    expectCurrent(undefined);
    await f.raise(incident(2));
    expectCurrent({ id: 2, variant: 'E1a' });
  });
});

for (const packet of [false, true]) describe(`FH-08 teaching on ${packet ? 'LoopbackSimHost packets' : 'LocalSimHost'}`, () => {
  it('arms the real host from profile preferences, acknowledges through the card, and respects seen on a new city', async () => {
    const storage = new Map<string, string>(), pref = 'metropolis.ui.emergencyTeaching';
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    });
    const first = await fixture(packet), teaching = mountBanner(first.host);
    await first.settle(); // the banner, rather than the test, sends the profile's armed settings
    await first.raise(incident(1));
    teaching.tick();
    expect(first.host.speed).toBe(0);
    first.expectTeaching({ id: 1, variant: 'E1a' });
    const card = teaching.root.querySelector('.emg-teach');
    expect(card).not.toBeNull();
    expect(card!.style.display).not.toBe('none');
    expect(JSON.parse(storage.get(pref) ?? '{}')).toMatchObject({ E1a: true, E1b: false });
    const gotIt = card!.querySelectorAll('button').find((b) => b.textContent === 'Got it');
    expect(gotIt).toBeDefined();
    gotIt!.click();
    await first.settle();
    teaching.tick();
    first.expectTeaching(undefined);
    expect(teaching.root.querySelector('.emg-teach')).toBeNull();
    expect(first.host.speed).toBe(1);
    expect(first.host.liveSlowdown).toBe(3);
    teaching.close();

    const next = await fixture(packet), alreadySeen = mountBanner(next.host);
    await next.settle();
    await next.raise(incident(1));
    alreadySeen.tick();
    next.expectTeaching(undefined);
    expect(next.host.speed).toBe(1);
    expect(next.host.liveSlowdown).toBe(3);
    expect(alreadySeen.root.querySelector('.emg-teach')).toBeNull();
  });

  it('leaves teaching off when the optional settings are absent', async () => {
    const f = await fixture(packet);
    await f.set(settings);
    await f.raise(incident(1));
    f.expectTeaching(undefined);
    expect(f.host.speed).toBe(1);
    expect(f.host.liveSlowdown).toBe(3);
    if (packet) expect(f.packets.every((p) => !p.policy || !Object.hasOwn(p.policy, 'teaching'))).toBe(true);
  });

  it('pauses E1a once and keeps its hold until the matching setSettings acknowledgement', async () => {
    const f = await fixture(packet);
    await f.set({ ...settings, teachFirst: true, teachTooFar: true });
    await f.raise(incident(1));
    f.expectTeaching({ id: 1, variant: 'E1a' });
    expect(f.host.speed).toBe(0);
    expect(f.host.liveSlowdown).toBe(1);
    // Persisting seen flags disables the next lesson, without acknowledging the open one.
    await f.set({ ...settings, teachFirst: false, teachTooFar: true });
    f.expectTeaching({ id: 1, variant: 'E1a' });
    expect(f.host.speed).toBe(0);
    await f.set({ ...settings, teachFirst: false, teachTooFar: true, teachingAck: 999 });
    f.expectTeaching({ id: 1, variant: 'E1a' });
    await f.set({ ...settings, teachFirst: false, teachTooFar: true, teachingAck: 1 });
    f.expectTeaching(undefined);
    expect(f.snapshot.alerts).toEqual([{ id: 1, wasPossible: true }]);
    expect(f.host.speed).toBe(1);
    expect(f.host.liveSlowdown).toBe(3);
    await f.set({ ...settings, teachFirst: true, teachTooFar: true });
    await f.raise(incident(2));
    f.expectTeaching(undefined);
    expect(f.host.speed).toBe(1);
    if (packet) {
      expect(f.packets.some((p) => p.policy?.teaching?.variant === 'E1a')).toBe(true);
      expect(f.packets.some((p) => p.policy?.alerts.length === 1 && !Object.hasOwn(p.policy, 'teaching'))).toBe(true);
    }
  });

  it('publishes E1b without slowing and keeps its one-shot independent from E1a', async () => {
    const f = await fixture(packet);
    await f.set({ ...settings, teachTooFar: true });
    await f.raise(incident(1, false));
    f.expectTeaching({ id: 1, variant: 'E1b' });
    expect(f.host.speed).toBe(3);
    expect(f.host.policy.live).toBe(false);
    const updates = f.updates.length;
    await f.set({ ...settings, teachTooFar: false, teachingAck: 1 });
    f.expectTeaching(undefined);
    expect(f.updates.length).toBeGreaterThan(updates); // lesson-only changes must publish, including absence
    expect(f.snapshot.alerts).toEqual([{ id: 1, wasPossible: false }]);
    await f.set({ ...settings, teachFirst: true, teachTooFar: true });
    await f.raise(incident(2, false));
    f.expectTeaching(undefined);
    await f.raise(incident(3));
    f.expectTeaching({ id: 3, variant: 'E1a' });
    expect(f.host.speed).toBe(0);
  });

  it('dispatchBest clears the lesson and continues LIVE without pausing it again', async () => {
    const f = await fixture(packet);
    await f.set({ ...settings, teachFirst: true });
    await f.raise(incident(1));
    expect(f.host.speed).toBe(0);
    const ticket = f.host.act('dispatchBest', [1], { tag: {} });
    await f.settle();
    await expect(ticket.done).resolves.toMatchObject({ ok: true });
    f.expectTeaching(undefined);
    expect(f.host.emergency.incident(1)?.state).toBe('dispatched');
    expect(f.host.speed).toBe(1);
    expect(f.host.liveSlowdown).toBe(3);
    await f.settle();
    f.expectTeaching(undefined);
    expect(f.host.speed).toBe(1);
  });
});
