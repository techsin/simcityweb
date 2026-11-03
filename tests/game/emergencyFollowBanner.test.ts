import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext, UIEvents } from '../../src/game/context';
import { DispatchTool } from '../../src/game/tools/DispatchTool';
import type { CityEvents, EmergencyEvent } from '../../src/sim/Simulation';
import { RESPONDER_MODEL, type EmergencyDispatchEvent, type EmergencyVehicle, type Incident } from '../../src/sim/infra/emergency';
import { EMERG_DAYS_PER_MIN } from '../../src/sim/infra/params';
import { EmergencyBanner } from '../../src/ui/EmergencyBanner';
import type { ActOptions, Cause, Command } from '../../src/worker/SimHost';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();
const lifetimes: AbortController[] = [];
afterEach(() => { for (const ac of lifetimes.splice(0)) ac.abort(); vi.restoreAllMocks(); });

function incident(id = 1, patch: Partial<Incident> = {}): Incident {
  return {
    id, kind: 'fire', x: 20, z: 20, buildingId: -1, major: true, state: 'uncovered', start: 0, deadline: 20,
    severity: 1, need: { fire: 1 }, units: [], manualPossible: true, canSend: true, place: 'Refinery', note: '',
    grace: 5, arrived: -1, firstAt: {}, answered: 0, work: 1, injured: 0, deaths: 0, radius: 0, fires: [],
    lost: 0, saved: 0, retry: 0, stVer: 0, ...patch,
  };
}
function vehicle(id: number, patch: Partial<EmergencyVehicle> = {}): EmergencyVehicle {
  const responder = patch.responder ?? 'fire';
  return {
    id, responder, model: RESPONDER_MODEL[responder], stationId: 10, incidentId: 1, state: 'outbound',
    path: [0, 1], times: [0, 1], legStart: 0, m0: 0, m1: 1, arrive: 1.1 * EMERG_DAYS_PER_MIN,
    workFrom: 0, hospital: -1, cover: false, ...patch,
  };
}
function harness(initial = [incident()], fleet: EmergencyVehicle[] = []) {
  const root = new FEl('div'), events = new Emitter<CityEvents>(), ui = new Emitter<UIEvents>();
  const abort = new AbortController();
  lifetimes.push(abort);
  const incidents = new Map(initial.map((inc) => [inc.id, inc]));
  const policy = { alerts: initial.map((inc) => ({ id: inc.id, wasPossible: true })), live: false, subscribe: () => () => {} };
  let cause: Cause | null = null, active: number | null = null, now = 0, command = 0;
  const follow = { start: vi.fn((id: number) => { active = id; }), active: () => active, stop: vi.fn(() => { active = null; }) };
  const dispatch = (id: number, units: EmergencyVehicle[], tag: object | null, type: EmergencyEvent['type'] = 'dispatched', seq = ++command) => {
    const inc = incidents.get(id)!;
    for (const v of units) { if (!fleet.some((q) => q.id === v.id)) fleet.push(v); if (!inc.units.includes(v.id)) inc.units.push(v.id); }
    if (type === 'dispatched' && units.some((v) => v.responder === 'fire')) inc.state = 'dispatched';
    cause = tag ? { seq, tag } : null;
    const event: EmergencyDispatchEvent = { type, id, kind: inc.kind, x: inc.x, z: inc.z, major: inc.major, manualPossible: inc.manualPossible };
    if (type === 'dispatched' && (tag instanceof DispatchTool || tag === banner)) event.sent = units.map((v) => v.id);
    events.emit('emergency', event);
    cause = null;
  };
  const act = vi.fn((op: Command['op'], args: unknown[], opts?: ActOptions) => {
    if (op === 'dispatchBest') dispatch(args[0] as number, [vehicle(100, { incidentId: args[0] as number })], opts?.tag ?? null);
    return { done: Promise.resolve({ ok: true, responder: 'fire', sent: 1, etaMin: 1.1 }) };
  });
  const ctx = {
    sim: { events }, root, signal: abort.signal, ui,
    host: {
      get cause() { return cause; }, policy, act, simTime: () => now,
      emergency: {
        active: true, layersReady: true, incidents: () => [...incidents.values()], incident: (id: number) => incidents.get(id),
        vehicles: () => fleet, stationName: () => 'Fire Station #1', stationList: () => [], stationFleet: () => null,
      },
      watch: () => ({ value: [{ stationId: 10, name: 'Fire Station #1', responder: 'fire', free: 2, total: 2, etaMin: 1.1, etaDays: 1.1, inRange: false }], version: 1, setArgs() {}, subscribe: () => () => {}, dispose() {} }),
    },
    settings: { emergencyUncovered: 'live', emergencyAlerts: 'major', emergencyLiveSlowmo: 3 },
    panels: { open() {} }, sound() {}, toast() {}, focusCell() {}, showQuery() {},
  } as unknown as GameContext;
  const banner = new EmergencyBanner(ctx, root as unknown as HTMLElement, follow);
  return {
    root, ctx, banner, follow, act, dispatch, events, abort, fleet, incidents, policy,
    tick: () => ui.emit('uiTick', undefined), setTime: (days: number) => { now = days; },
    button: (id = 1) => {
      const b = (banner as unknown as { banners: Map<number, { follow: HTMLButtonElement }> }).banners.get(id)!;
      return b.follow as unknown as FEl;
    },
    chip: () => root.querySelector('.emg-follow-chip')!,
  };
}

describe('FEEL-09 emergency Follow banner', () => {
  it('never offers Follow for automatic dispatch, including a disaster with a cause tag', () => {
    const h = harness();
    h.dispatch(1, [vehicle(1)], { source: 'triggerDisaster' });
    h.tick();
    expect(h.button().style.display).toBe('none');
    h.button().click();
    expect(h.follow.start).not.toHaveBeenCalled();
    expect(h.chip().style.display).toBe('none');
  });

  it('recognises DispatchTool by host.cause and keeps its lead fixed when auto units join', () => {
    const h = harness(), tool = new DispatchTool(h.ctx);
    h.dispatch(1, [vehicle(7), vehicle(3)], tool);
    const button = h.button();
    expect(button.style.display).toBe('');
    expect(button.innerHTML).toContain('<svg');
    h.dispatch(1, [vehicle(2, { arrive: 0.1 })], null);
    h.tick();
    expect(h.button()).toBe(button);
    button.click();
    expect(h.follow.start).toHaveBeenLastCalledWith(3);
    expect(h.chip().textContent).toContain('Following Fire truck from Fire Station #1 · 1.1 min');
  });

  it('tags Send nearest and offers Follow for the unit from that command', async () => {
    const h = harness();
    h.root.querySelectorAll('button').find((b) => b.textContent.includes('Send nearest'))!.click();
    await Promise.resolve();
    expect(h.act).toHaveBeenCalledWith('dispatchBest', [1], { tag: h.banner });
    expect(h.button().style.display).toBe('');
    h.button().click();
    expect(h.follow.start).toHaveBeenLastCalledWith(100);
  });

  it('uses emitted sent IDs with two player commands and a mixed auto dispatch in one packet', () => {
    const a = incident(1), b = incident(2), c = incident(3);
    const h = harness([a, b, c]);
    const support = vehicle(1, { responder: 'medical', arrive: 0.01 });
    const first = vehicle(2), second = vehicle(3, { incidentId: 2 }), auto = vehicle(4, { incidentId: 3 });
    // The packet-final fleet arrives first; each event's sent IDs identify only its command's units.
    h.fleet.push(support, first, second, auto);
    h.dispatch(1, [support], null, 'uncovered');
    h.dispatch(1, [first], new DispatchTool(h.ctx));
    h.dispatch(2, [second], new DispatchTool(h.ctx));
    h.dispatch(3, [auto], { source: 'triggerDisaster' });
    h.button(1).click();
    expect(h.follow.start).toHaveBeenLastCalledWith(first.id);
    h.button(2).click();
    expect(h.follow.start).toHaveBeenLastCalledWith(second.id);
    expect(h.button(3).style.display).toBe('none');
  });

  it('follows a player-dispatched support unit while the industrial call still waits for a truck', () => {
    const h = harness([incident(1, { kind: 'industrial', need: { fire: 1, medical: 1 } })]);
    h.dispatch(1, [vehicle(5, { responder: 'medical' })], new DispatchTool(h.ctx));
    expect(h.incidents.get(1)!.state).toBe('uncovered');
    expect(h.button().style.display).toBe('');
    h.button().click();
    expect(h.follow.start).toHaveBeenLastCalledWith(5);
    expect(h.chip().textContent).toContain('Following Ambulance');
  });

  it('chooses the earliest lead across multiple dispatched events from the same command', () => {
    const h = harness([incident(1, { kind: 'industrial', need: { fire: 1, medical: 1 } })]);
    const tool = new DispatchTool(h.ctx);
    const truck = vehicle(8, { arrive: 0.3 }), support = vehicle(9, { responder: 'medical', arrive: 0.8 });
    h.dispatch(1, [truck], tool, 'dispatched', 21);
    h.dispatch(1, [support], tool, 'dispatched', 21);
    h.button().click();
    expect(h.follow.start).toHaveBeenLastCalledWith(truck.id);
    // A later command gets its own lead; the same-command merge must not retain a previous dispatch's unit.
    const next = vehicle(10, { arrive: 0.9 });
    h.dispatch(1, [next], tool, 'dispatched', 22);
    h.button().click();
    expect(h.follow.start).toHaveBeenLastCalledWith(next.id);
  });

  it('keeps the button after the speed policy removes an alert, and clears the chip immediately on cancellation', () => {
    const h = harness();
    h.dispatch(1, [vehicle(1)], new DispatchTool(h.ctx));
    h.policy.alerts = [];
    h.tick();
    expect(h.banner.bannerIds).toContain(1);
    h.button().click();
    expect(h.chip().style.display).toBe('flex');
    h.setTime(0.4 * EMERG_DAYS_PER_MIN); h.tick();
    expect(h.chip().textContent).toContain('0.7 min');
    h.follow.stop(); h.banner.refreshFollow();
    expect(h.chip().style.display).toBe('none');
  });

  it('reserves the visible chip height when fitting banners above the toolbar', () => {
    const h = harness([incident(1), incident(2)]);
    h.root.clientWidth = 1600; h.root.clientHeight = 500;
    h.tick();
    expect(h.root.querySelectorAll('.emg-banner.compact')).toHaveLength(0);
    h.dispatch(1, [vehicle(1)], new DispatchTool(h.ctx));
    h.button().click(); h.tick();
    expect(h.root.querySelectorAll('.emg-banner.compact')).toHaveLength(2);
  });

  it('does not offer a unit loaded from a save, and clears tracking on reset and abort', () => {
    const unit = vehicle(10), inc = incident(1, { units: [unit.id], state: 'dispatched' });
    const h = harness([inc], [unit]);
    expect(h.button().style.display).toBe('none');
    h.dispatch(1, [vehicle(11)], new DispatchTool(h.ctx));
    h.button().click();
    h.events.emit('reset', undefined);
    expect(h.follow.active()).toBeNull();
    expect(h.chip().style.display).toBe('none');
    h.tick();
    expect(h.button().style.display).toBe('none');
    h.dispatch(1, [vehicle(12)], new DispatchTool(h.ctx));
    const button = h.button();
    button.click();
    h.abort.abort();
    expect(h.follow.active()).toBeNull();
    expect(h.chip().style.display).toBe('none');
    button.click();
    expect(h.follow.active()).toBeNull();
  });

  it('excludes saved units when the first dispatch follows lazy loading', () => {
    const h = harness([]);
    const auto = vehicle(1, { arrive: 0.01 });
    h.incidents.set(1, incident(1, { state: 'dispatched', units: [auto.id] }));
    h.fleet.push(auto);
    h.ctx.ui.emit('viewsReady', undefined);
    const manual = vehicle(2, { arrive: 0.5 });
    h.dispatch(1, [manual], new DispatchTool(h.ctx));
    h.button().click();
    expect(h.follow.start).toHaveBeenLastCalledWith(manual.id);
  });

  it('prunes ended and missing candidates, retaining the active chip through the on-scene grace', () => {
    const h = harness([]);
    const tracking = h.banner as unknown as { followDispatches: Map<number, unknown> };
    for (let id = 1; id <= 40; id++) {
      h.incidents.set(id, incident(id));
      h.dispatch(id, [], null, 'new');
      if (id % 8 === 0) h.dispatch(id, [vehicle(1000 + id, { incidentId: id })], new DispatchTool(h.ctx));
      h.dispatch(id, [], null, 'resolved');
      h.incidents.delete(id);
    }
    expect(tracking.followDispatches.size).toBe(0);
    h.incidents.set(41, incident(41));
    const unit = vehicle(41, { incidentId: 41 });
    h.dispatch(41, [unit], new DispatchTool(h.ctx));
    h.button(41).click();
    unit.state = 'onScene';
    h.banner.refreshFollow();
    expect(h.chip().textContent).toContain('on scene');
    h.incidents.clear(); h.fleet.length = 0; h.tick();
    expect(tracking.followDispatches.size).toBe(0);
    expect(h.chip().style.display).toBe('flex');
    expect(h.chip().textContent).toContain('Following Fire truck from Fire Station #1 · on scene');
    h.follow.stop(); h.banner.refreshFollow();
    expect(h.chip().style.display).toBe('none');
  });

  it.each(['Send nearest', 'DispatchTool'])('%s follows only the player truck after a silent automatic ambulance dispatch', async (path) => {
    const h = harness([incident(1, { kind: 'industrial', need: { fire: 1, medical: 1 } })]);
    const ambulance = vehicle(1, { responder: 'medical', arrive: 0.1 });
    h.fleet.push(ambulance);
    h.incidents.get(1)!.units.push(ambulance.id); // automatic supporting pass emits no event
    if (path === 'Send nearest') {
      h.root.querySelectorAll('button').find((b) => b.textContent.includes('Send nearest'))!.click();
      await Promise.resolve();
    } else h.dispatch(1, [vehicle(100)], new DispatchTool(h.ctx));
    h.button().click();
    expect(h.follow.start).toHaveBeenLastCalledWith(100);
    expect(h.chip().textContent).toContain('Following Fire truck');
  });

  it('shows on scene at the extrapolated arrival before the next vehicle-state update', () => {
    const h = harness();
    const v = vehicle(1);
    h.dispatch(1, [v], new DispatchTool(h.ctx));
    h.button().click();
    h.setTime(v.arrive - 0.1 * EMERG_DAYS_PER_MIN); h.tick();
    expect(h.chip().textContent).toContain('0.1 min');
    h.setTime(v.arrive); h.tick();
    expect(v.state).toBe('outbound');
    expect(h.chip().textContent).toContain('on scene');
    expect(h.chip().textContent).not.toContain('0.0 min');
  });

  it.each(['resolved', 'failed'] as const)('ends Follow immediately when the incident is %s during the arrival grace', (outcome) => {
    const h = harness(), unit = vehicle(1);
    h.dispatch(1, [unit], new DispatchTool(h.ctx));
    h.button().click();
    unit.state = 'onScene';
    h.setTime(unit.arrive); h.banner.refreshFollow();
    expect(h.chip().textContent).toContain('on scene');
    unit.state = 'returning';
    h.incidents.get(1)!.state = outcome;
    h.dispatch(1, [], null, outcome);
    expect(h.follow.stop).toHaveBeenCalledTimes(1);
    expect(h.follow.active()).toBeNull();
    expect(h.chip().style.display).toBe('none');
    h.tick(); h.banner.refreshFollow();
    expect(h.chip().style.display).toBe('none');
    expect(h.button().style.display).toBe('none');
  });

  it('keeps following when a different incident resolves', () => {
    const h = harness([incident(1), incident(2)]);
    h.dispatch(1, [vehicle(1)], new DispatchTool(h.ctx));
    h.button().click();
    h.incidents.get(2)!.state = 'resolved';
    h.dispatch(2, [], null, 'resolved');
    expect(h.follow.stop).not.toHaveBeenCalled();
    expect(h.follow.active()).toBe(1);
    expect(h.chip().style.display).toBe('flex');
  });

  it('ends the active unit when a later command replaced its incident candidate', () => {
    const h = harness(), tool = new DispatchTool(h.ctx);
    h.dispatch(1, [vehicle(1)], tool);
    h.button().click();
    h.dispatch(1, [vehicle(2)], tool);
    expect(h.follow.active()).toBe(1);
    h.incidents.get(1)!.state = 'resolved';
    h.dispatch(1, [], null, 'resolved');
    expect(h.follow.active()).toBeNull();
    expect(h.chip().style.display).toBe('none');
  });

  it('ends the retained chip on resolution even after its missing vehicle candidate was pruned', () => {
    const h = harness();
    h.dispatch(1, [vehicle(1)], new DispatchTool(h.ctx));
    h.button().click();
    h.fleet.length = 0; h.tick();
    expect((h.banner as unknown as { followDispatches: Map<number, unknown> }).followDispatches.size).toBe(0);
    expect(h.chip().style.display).toBe('flex');
    h.incidents.get(1)!.state = 'resolved';
    h.dispatch(1, [], null, 'resolved');
    expect(h.follow.active()).toBeNull();
    expect(h.chip().style.display).toBe('none');
    h.tick();
    expect(h.chip().style.display).toBe('none');
  });

  it('hides Follow while active and ignores a second click instead of restarting the camera', () => {
    const h = harness();
    h.dispatch(1, [vehicle(1)], new DispatchTool(h.ctx));
    const button = h.button();
    button.click();
    expect(button.style.display).toBe('none');
    button.click();
    expect(h.follow.start).toHaveBeenCalledTimes(1);
    h.follow.stop(); h.banner.refreshFollow();
    expect(button.style.display).toBe('');
  });
});
