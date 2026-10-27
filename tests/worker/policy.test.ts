/** W0.4: the headless core owns LIVE, including EM-1's settled-burst timing. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Network } from '../../src/core/types';
import { CityActions } from '../../src/sim/actions';
import type { EmergencyEvent, Simulation, SimSystem } from '../../src/sim/Simulation';
import type { DispatchOption, EmergencySystem, Incident } from '../../src/sim/infra/emergency';
import { getFire } from '../../src/sim/systems/infra';
import { SimCore } from '../../src/worker/SimCore';
import { LocalSimHost, type PolicySnapshot, type SimSettings } from '../../src/worker/SimHost';
import { newState, place, roadLine } from '../infra/cityGen';

const settings: SimSettings = { emergencyUncovered: 'live', emergencyAlerts: 'major', emergencyLiveSlowmo: 3 };
const cores: SimCore[] = [];
const hosts: LocalSimHost[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) core.dispose();
  for (const host of hosts.splice(0)) await host.dispose();
  vi.restoreAllMocks();
});

/** A long-window fire isolates LIVE from the separate urgent-pause case. Real fires are covered below. */
function incident(id = 1, patch: Partial<Incident> = {}): Incident {
  return {
    id, kind: 'fire', x: 10, z: 10, buildingId: -1, major: true, state: 'uncovered', start: 0, deadline: 30,
    severity: 1, need: { fire: 1 }, units: [], manualPossible: true, canSend: true, place: 'Test fire', note: '',
    grace: 1, arrived: -1, firstAt: {}, answered: 0, work: 1, injured: 0, deaths: 0, radius: 0, fires: [],
    lost: 0, saved: 0, retry: 0, stVer: 0, ...patch,
  };
}
const event = (inc: Incident, type: EmergencyEvent['type'] = 'uncovered'): EmergencyEvent => ({
  type, id: inc.id, kind: inc.kind, x: inc.x, z: inc.z, major: inc.major, manualPossible: inc.manualPossible,
});

function fixture(initial: Incident[] = [], daily?: (sim: Simulation) => void) {
  const core = new SimCore(newState(32));
  cores.push(core);
  const list = [...initial];
  const option: DispatchOption = { stationId: 1, name: 'Fire', responder: 'fire', free: 1, total: 1, etaDays: 1, etaMin: 1, inRange: false };
  const em = { name: 'emergency', incidents: () => list, incident: (id: number) => list.find((i) => i.id === id), dispatchOptions: () => [option] };
  core.sim.state.stats.population = 5000;
  core.boot(null, { createSystems: () => [em, ...(daily ? [{ name: 'source', daily }] : [])] as SimSystem[], CityActions });
  core.applyCommand({ op: 'setSpeed', args: [3, 'topbar'] }, core.actions!);
  const raise = (inc = incident()) => { list.push(inc); core.sim.events.emit('emergency', event(inc)); return inc; };
  return { core, sim: core.sim, view: core.livePolicy.view, list, option, raise };
}

describe('LivePolicy in SimCore', () => {
  it('same-day: an uncovered major fire at ultra enters LIVE after the burst, before the next advanceDay', async () => {
    const seen: number[] = [];
    let f: ReturnType<typeof fixture>;
    f = fixture([], (sim) => { seen.push(sim.speed); if (sim.state.day === 1) f.raise(); });
    f.core.frame(0.05);
    expect(f.sim.state.day).toBe(1);
    expect(f.sim.speed).toBe(3); // EM-1: still inside the task that can assign more units
    await Promise.resolve();
    expect(f.sim.state.day).toBe(1);
    expect(f.sim.speed).toBe(1);
    expect(f.sim.liveSlowdown).toBe(3);
    expect(f.view.live).toBe(true);
    expect(f.view.alerts).toEqual([{ id: 1, wasPossible: true }]);
    f.core.frame(0.15); // enough for three ultra days, not a slowed LIVE day
    expect(seen).toEqual([3]);
    expect(f.sim.state.day).toBe(1);
  });

  it('preserves the local multi-day tick boundary until W1.2 splits Simulation.update into day units', async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture([], (sim) => { if (sim.state.day === 1) f.raise(); });
    f.core.frame(0.21);
    expect(f.sim.state.day).toBe(4); // spd is still cached by Simulation.update, as before W0.4
    await Promise.resolve();
    expect(f.sim.speed).toBe(1);
    expect(f.sim.liveSlowdown).toBe(3);
    f.core.frame(0.15);
    expect(f.sim.state.day).toBe(4);
  });

  it('EM-1: a later dispatch in the same task takes the free unit before alerts or urgent pause are decided', async () => {
    const f = fixture();
    const inc = f.raise(incident(1, { deadline: 4 }));
    f.option.free = 0;
    inc.manualPossible = inc.canSend = false;
    await Promise.resolve();
    expect(f.view.alerts).toEqual([]);
    expect(f.view.live).toBe(false);
    expect(f.sim.speed).toBe(3);
    expect(f.sim.liveSlowdown).toBe(1);
  });

  it('the next host tick flushes pending alerts even if the microtask has not run', () => {
    const f = fixture();
    f.raise();
    f.core.frame(0);
    expect(f.view.live).toBe(true);
    expect(f.sim.speed).toBe(1);
    expect(f.sim.liveSlowdown).toBe(3);
  });

  it('dismissAlert is idempotent, ends LIVE neutrally, and does not re-raise until reset', async () => {
    const f = fixture();
    const updates: PolicySnapshot[] = [];
    const ac = new AbortController();
    f.view.subscribe((p) => updates.push(p), ac.signal);
    const inc = f.raise();
    await Promise.resolve();
    expect(updates.filter((p) => p.warn)).toHaveLength(1);
    f.core.applyCommand({ op: 'dismissAlert', args: [inc.id] }, f.core.actions!);
    f.core.applyCommand({ op: 'dismissAlert', args: [inc.id] }, f.core.actions!);
    expect(f.view.alerts).toEqual([]);
    expect(f.sim.speed).toBe(3);
    expect(f.sim.liveSlowdown).toBe(1);
    expect(updates.filter((p) => p.toast).map((p) => p.toast!.text)).toEqual(['Emergency over — back to ultra speed']);
    f.sim.events.emit('emergency', event(inc));
    f.core.frame(0);
    await Promise.resolve();
    expect(f.view.alerts).toEqual([]);
    f.sim.replaceState(newState(32));
    expect(f.sim.liveSlowdown).toBe(1);
    await Promise.resolve();
    expect(f.view.alerts.map((a) => a.id)).toEqual([inc.id]);
    ac.abort('dispose');
  });

  it('setSettings copies the input, changes slowdown and policy mid-episode, and filters subsequent alerts', async () => {
    const f = fixture();
    f.raise();
    await Promise.resolve();
    const changed = { ...settings, emergencyLiveSlowmo: 5 };
    f.core.applyCommand({ op: 'setSettings', args: [changed] }, f.core.actions!);
    changed.emergencyLiveSlowmo = 9;
    f.core.frame(0);
    expect(f.sim.liveSlowdown).toBe(5);
    f.core.applyCommand({ op: 'setSettings', args: [{ ...settings, emergencyUncovered: 'pause' }] }, f.core.actions!);
    expect(f.view.live).toBe(false);
    expect(f.sim.speed).toBe(0);
    expect(f.sim.liveSlowdown).toBe(1);
    f.core.applyCommand({ op: 'setSettings', args: [{ ...settings, emergencyUncovered: 'live' }] }, f.core.actions!);
    expect(f.sim.speed).toBe(1);
    f.core.applyCommand({ op: 'setSettings', args: [{ ...settings, emergencyUncovered: 'ignore' }] }, f.core.actions!);
    expect(f.sim.speed).toBe(3);
    expect(f.sim.liveSlowdown).toBe(1);
    f.raise(incident(2, { major: false }));
    await Promise.resolve();
    expect(f.view.alerts.map((a) => a.id)).toEqual([1]);
    f.core.applyCommand({ op: 'setSettings', args: [{ ...settings, emergencyAlerts: 'all', emergencyUncovered: 'ignore' }] }, f.core.actions!);
    f.raise(incident(3, { major: false }));
    await Promise.resolve();
    expect(f.view.alerts.map((a) => a.id)).toEqual([1, 3]);
  });

  it('boot re-raises saved waiting incidents without a UI or a new uncovered event', async () => {
    const f = fixture([incident()]);
    await Promise.resolve();
    expect(f.view.alerts).toEqual([{ id: 1, wasPossible: true }]);
    expect(f.sim.speed).toBe(1);
    expect(f.sim.liveSlowdown).toBe(3);
  });

  it('records a terminal loss before the incident leaves the stream and retains the outcome for 2.5 seconds', async () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const f = fixture();
    const inc = f.raise();
    await Promise.resolve();
    inc.state = 'failed'; inc.lost = 1;
    f.list.length = 0;
    f.sim.events.emit('emergency', event(inc, 'failed'));
    f.core.frame(0);
    expect(f.sim.speed).toBe(3);
    expect(f.view.toast?.text).toBe('Emergency over — back to ultra speed');
    expect(f.view.alerts).toHaveLength(1);
    now += 2501;
    f.core.frame(0);
    expect(f.view.alerts).toEqual([]);
  });

  it('aborting a subscriber removes feedback and disposing the core cancels a queued flush and its listeners', async () => {
    const f = fixture();
    const changed = vi.fn(), ac = new AbortController();
    f.view.subscribe(changed, ac.signal);
    ac.abort('dispose');
    f.raise();
    f.core.dispose();
    await Promise.resolve();
    f.sim.events.emit('emergency', event(incident(2)));
    f.sim.events.emit('reset', undefined);
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    expect(f.sim.speed).toBe(3);
    expect(f.view.alerts).toEqual([]);
    expect(f.view.live).toBe(false);
  });

  it('a real LocalSimHost fire urgently pauses, dispatchBest has an exact tagged ticket, pause/resume keeps LIVE, then ultra returns', async () => {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    place(st, 't_fire', 4, 19);
    const home = place(st, 't_r2', 40, 21, { pop: 60 });
    const host = new LocalSimHost(st, { initialSpeed: 3 });
    hosts.push(host);
    await host.start();
    getFire(host.sim)!.riskBoost = 0;
    host.act('setSettings', [settings]);
    expect(host.act('triggerDisaster', ['fire', home.x, home.z]).predicted).toBe(true);
    await Promise.resolve();
    expect(host.policy.live).toBe(true);
    expect(host.speed).toBe(0);
    const id = host.policy.alerts[0].id, tag = {};
    const causes: unknown[] = [];
    const off = host.events.on('emergency', (e) => { if (e.type === 'dispatched') causes.push(host.cause?.tag); });
    const ticket = host.act('dispatchBest', [id], { tag });
    expect(ticket.exact).toBe(true);
    expect(ticket.predicted?.ok).toBe(true);
    await expect(ticket.done).resolves.toMatchObject({ ok: true });
    expect(causes).toContain(tag);
    expect(host.cause).toBeNull();
    expect(host.speed).toBe(1);
    expect(host.liveSlowdown).toBe(3);
    host.setSpeed(0, 'pause');
    host.frame(0);
    host.resume('pause');
    host.frame(0);
    expect(host.speed).toBe(1);
    expect(host.liveSlowdown).toBe(3);
    for (let d = 0; d < 10; d++) { host.sim.runDays(1); host.frame(0); }
    expect(host.policy.live).toBe(false);
    expect(host.speed).toBe(3);
    expect(host.liveSlowdown).toBe(1);
    expect(host.sim.getSystem<EmergencySystem>('emergency')!.incident(id)).toBeUndefined();
    off();
  });
});
