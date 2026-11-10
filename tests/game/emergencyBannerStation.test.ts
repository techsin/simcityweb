/** T085: the displayed station follows the same road options and responder order as Send nearest. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { Network } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import type { EmergencyVehicle, DispatchOption, Incident } from '../../src/sim/infra/emergency';
import { EmergencySystem } from '../../src/sim/infra/emergency';
import { FireSystem } from '../../src/sim/infra/fire';
import type { CityEvents } from '../../src/sim/Simulation';
import { EmergencyBanner } from '../../src/ui/EmergencyBanner';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { LocalSimHost, type SimHost } from '../../src/worker/SimHost';
import { newState, place, roadLine } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();
const hosts: (LocalSimHost | LoopbackSimHost)[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) close();
  for (const host of hosts.splice(0)) await host.dispose();
  vi.restoreAllMocks();
});

function mount(host: SimHost) {
  const root = Object.assign(new FEl('div'), { clientWidth: 1600, offsetWidth: 1600 });
  const abort = new AbortController(), ui = new Emitter<UIEvents>();
  const ctx = {
    host, get state() { return host.state; }, root, ui, signal: abort.signal,
    settings: { ...DEFAULT_SETTINGS, tips: false },
    panels: { open: vi.fn(), isOpen: () => false }, sound: vi.fn(), toast: vi.fn(),
    setOverlay: vi.fn(), openFlyout: vi.fn(), focusCell: vi.fn(), showQuery: vi.fn(),
  } as unknown as GameContext;
  const banner = new EmergencyBanner(ctx, root as unknown as HTMLElement);
  cleanups.push(() => { abort.abort('exit'); banner.dispose(); });
  return { banner, root, tick: () => ui.emit('uiTick', undefined) };
}

function parts(root: FEl, id: number, banner: EmergencyBanner) {
  const rows = (banner as unknown as { banners: Map<number, { note: FEl; send: FEl }> }).banners;
  const row = rows.get(id);
  expect(root.querySelector('.emg-banner')).not.toBeNull();
  expect(row).toBeDefined();
  return row!;
}

async function roadFixture(packet: boolean) {
  let now = 0;
  const st = newState(128);
  st.stats.population = 5000;
  // Two parallel streets join only at the far end. A is closer in a straight line, B by road.
  roadLine(st, 10, 11, 100, 11, Network.Road);
  roadLine(st, 100, 11, 100, 16, Network.Road);
  roadLine(st, 100, 16, 10, 16, Network.Road);
  const a = place(st, 't_fire', 10, 17), b = place(st, 't_fire', 80, 12);
  const home = place(st, 't_r2', 10, 10, { pop: 60 });
  const modules = { createSystems: () => [new FireSystem(), new EmergencySystem()] };
  const host = packet
    ? new LoopbackSimHost(st, { initialSpeed: 0, now: () => now, journal: false, loopback: { modules } })
    : new LocalSimHost(st, { initialSpeed: 0, now: () => now });
  hosts.push(host);
  if (host instanceof LoopbackSimHost) await host.start(); else await host.start(modules);
  const sim = host instanceof LoopbackSimHost ? host.harness.core.sim : host.sim;
  const em = sim.getSystem<EmergencySystem>('emergency')!;
  const ui = mount(host);
  const settle = async () => {
    now += 250;
    host.frame(0);
    if (host instanceof LoopbackSimHost) await host.drain();
    ui.tick();
    if (host instanceof LoopbackSimHost) await host.drain();
    ui.tick();
  };
  await settle();
  const id = em.spawn(sim, 'fire', home.x, home.z, { buildingId: home.id });
  await settle();
  return { host, sim, em, a, b, home, id, ui, settle };
}

for (const packet of [false, true]) describe(`T085 station choice (${packet ? 'loopback' : 'local'} host)`, () => {
  it('names the road-nearest station while leaving the simulation fallback unchanged, then sends that station', async () => {
    const f = await roadFixture(packet), inc = f.em.incident(f.id)!;
    expect([inc.state, inc.reason, inc.manualPossible, inc.canSend]).toEqual(['uncovered', 'outOfRange', false, true]);
    const nameA = f.em.stationName(f.a.id), nameB = f.em.stationName(f.b.id);
    expect(inc.note).toContain(nameA);
    const options = await f.host.query('dispatchOptions', { incidentId: f.id });
    expect(options.map((o) => [o.stationId, o.etaMin])).toEqual([[f.b.id, 7], [f.a.id, 18.5]]);
    await f.settle();
    const row = parts(f.ui.root, f.id, f.ui.banner);
    expect(row.note.textContent).toContain(nameB);
    expect(row.note.textContent).not.toContain(nameA);
    expect(row.send.title).toContain(nameB);

    const sent = f.host.act('dispatchBest', [f.id], { tag: f.ui.banner });
    await f.settle();
    await expect(sent.done).resolves.toMatchObject({ ok: true, responder: 'fire', etaMin: 7 });
    expect(f.host.emergency.vehicles().find((v) => v.incidentId === f.id)?.stationId).toBe(f.b.id);
  });

  it('updates the note and button together when the fastest station gives away its last free units', async () => {
    const f = await roadFixture(packet);
    const row = parts(f.ui.root, f.id, f.ui.banner);
    expect(row.note.textContent).toContain(f.em.stationName(f.b.id));
    const spill = f.em.spawn(f.sim, 'spill', f.home.x, f.home.z, { buildingId: f.home.id });
    const sent = f.host.act('dispatch', [spill, f.b.id, 2]);
    await f.settle();
    await expect(sent.done).resolves.toMatchObject({ ok: true, sent: 2 });
    expect(row.note.textContent).toContain(f.em.stationName(f.a.id));
    expect(row.note.textContent).not.toContain(f.em.stationName(f.b.id));
    expect(row.send.title).toContain(f.em.stationName(f.a.id));
  });

  it('updates the note after the road graph changes, without rewriting the simulation note', async () => {
    const f = await roadFixture(packet), inc = f.em.incident(f.id)!;
    const rawNote = inc.note, row = parts(f.ui.root, f.id, f.ui.banner);
    expect(row.note.textContent).toContain(f.em.stationName(f.b.id));
    roadLine(f.sim.state, 10, 11, 10, 16, Network.Road);
    f.sim.events.emit('networkChanged', { x0: 10, z0: 11, x1: 11, z1: 17 });
    // A read synchronises the graph; the watch observes its existing graph revision on the next host frame.
    const options = await f.host.query('dispatchOptions', { incidentId: f.id });
    expect(options[0]).toMatchObject({ stationId: f.a.id, etaMin: 0.5 });
    await f.settle();
    expect(inc.note).toBe(rawNote);
    expect(row.note.textContent).toContain(f.em.stationName(f.a.id));
    expect(row.note.textContent).not.toContain(f.em.stationName(f.b.id));
    expect(row.send.title).toContain(f.em.stationName(f.a.id));
  });
});

function incident(patch: Partial<Incident> = {}): Incident {
  return {
    id: 1, kind: 'fire', x: 10, z: 10, buildingId: -1, major: true, state: 'uncovered', start: 0,
    deadline: 6, severity: 1, need: { fire: 1 }, units: [], reason: 'outOfRange', manualPossible: false,
    canSend: true, place: 'Test fire', note: 'Outside fire coverage — nearest free fire truck: Fire #1 (too far to make it in time)',
    grace: 4, arrived: -1, firstAt: {}, answered: 0, work: 1, injured: 0, deaths: 0, radius: 0,
    fires: [], lost: 0, saved: 0, retry: 5, stVer: 1, ...patch,
  };
}

function option(stationId: number, responder: 'fire' | 'medical', etaMin: number): DispatchOption {
  return { stationId, name: responder === 'fire' ? `Fire #${stationId}` : `Clinic #${stationId}`, responder,
    free: 1, total: 1, etaMin, etaDays: etaMin, inRange: false };
}

function delayedFixture(inc = incident(), initial?: DispatchOption[]) {
  let options = initial, version = 0;
  const vehicles: EmergencyVehicle[] = [];
  const events = new Emitter<CityEvents>(), st = newState(32);
  const host = {
    kind: 'worker', state: st, events, speed: 0, liveSlowdown: 1, commandCount: 0,
    policy: { alerts: [{ id: inc.id, wasPossible: inc.manualPossible }], live: false, subscribe: () => () => {} },
    simTime: () => 0, act: vi.fn(() => ({ seq: 1, exact: false, done: Promise.resolve(undefined) })),
    emergency: { active: true, layersReady: true, incidents: () => [inc], incident: (id: number) => id === inc.id ? inc : undefined,
      vehicles: () => vehicles, stationList: () => [], stationFleet: () => null, stationName: (id: number) => `Station #${id}` },
    watch: () => ({ get value() { return options; }, get version() { return version; }, error: undefined,
      setArgs: () => {}, subscribe: () => () => {}, dispose: () => {} }),
  } as unknown as SimHost;
  const ui = mount(host);
  return { ...ui, inc, vehicles, row: parts(ui.root, inc.id, ui.banner), publish(next: DispatchOption[]) { options = next; version++; ui.tick(); } };
}

describe('T085 delayed dispatch options', () => {
  it('does not show the stale straight-line station before options arrive or when no eligible station remains', () => {
    const f = delayedFixture();
    expect(f.row.note.textContent).not.toContain('Fire #1');
    expect(f.row.send.disabled).toBe(true);
    expect(f.row.send.title).toContain('Loading');
    f.publish([option(2, 'fire', 7)]);
    expect(f.row.note.textContent).toContain('Fire #2');
    expect(f.row.send.title).toContain('Fire #2');
    f.publish([]);
    expect(f.row.note.textContent).not.toContain('Fire #1');
    expect(f.row.note.textContent).not.toContain('Fire #2');
    expect(f.row.send.disabled).toBe(true);
  });

  it.each([
    ['busy', 'Both fire trucks of Fire #1 are busy — one is on its way back'],
    ['noStation', 'No road leads to this place'],
  ] as const)('preserves the simulation’s %s explanation', (reason, note) => {
    const f = delayedFixture(incident({ reason, note }));
    expect(f.row.note.textContent).toBe(note);
    f.publish([option(2, 'fire', 7)]);
    expect(f.row.note.textContent).toBe(note);
  });

  it('selects the primary missing responder before a faster supporting responder, then skips an assigned primary', () => {
    const f = delayedFixture(incident({ kind: 'industrial', need: { fire: 1, medical: 1 } }),
      [option(3, 'medical', 1), option(2, 'fire', 7)]);
    expect(f.row.note.textContent).toContain('Fire #2');
    expect(f.row.send.title).toContain('Fire #2');
    expect(f.row.send.title).not.toContain('Clinic #3');
    f.vehicles.push({ id: 1, incidentId: f.inc.id, responder: 'fire', state: 'outbound' } as EmergencyVehicle);
    f.inc.units.push(1);
    f.publish([option(3, 'medical', 1), option(2, 'fire', 7)]);
    expect(f.row.send.title).toContain('Clinic #3');
  });
});
