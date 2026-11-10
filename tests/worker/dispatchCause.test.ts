/**
 * T061 item 3 (T048's request a, NOTE-049): `Cause.dispatchIncidentId`. Units the player sends to an incident the city
 * already answered by itself leave `answered === 1`, so the incident's own record cannot say the player took part
 * (FEEL-10's outcome stings, FH-08's teaching). The cause of a dispatch or dispatchBest command now names its incident,
 * on the local host (LocalSimHost.act) and on the packet hosts (PacketSimHost.post, the replica's cause hook, until the
 * command's ack). A command that dispatches as a side effect (a disaster the city answers) names none.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { emergencyOf, type EmergencySystem } from '../../src/sim/infra/emergency';
import type { Simulation } from '../../src/sim/Simulation';
import { clearRecoveryBase } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import { serializeCity } from '../../src/save/serialize';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { LocalSimHost, type Cause, type SimHost } from '../../src/worker/SimHost';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { newState, place, roadLine } from '../infra/cityGen';
import { bootNode, waitFor, within } from './workerHarness';

beforeAll(async () => { await buildWorkerTest(); }, 60000);
afterEach(() => { clearRecoveryBase(); setKV(new MemoryKV()); });

/** a clinic beside a home on a road, which answers an incident there by itself with its one ambulance, and two clinics
 *  far down the road, out of its range, whose ambulances only the player sends; a fire station beside the home */
function coveredCity() {
  const st = newState(64); roadLine(st, 2, 20, 62, 20);
  const home = place(st, 't_r2', 14, 21, { pop: 60 });
  place(st, 't_clinic', 8, 19); place(st, 't_fire', 10, 19);
  const far = place(st, 't_clinic', 50, 19), farther = place(st, 't_clinic', 56, 19);
  return { st, home, far, farther };
}
type Seen = { type: string; id: number; cause: Cause | null };
function watch(host: SimHost): { seen: Seen[]; off: () => void } {
  const seen: Seen[] = [];
  const off = host.events.on('emergency', (e) => {
    if (e.type === 'dispatched') seen.push({ type: e.type, id: e.id, cause: host.cause && { ...host.cause } });
  });
  return { seen, off };
}

describe.each(['local', 'loopback'] as const)('the %s host', (kind) => {
  async function boot() {
    const { st, home, farther } = coveredCity();
    const host = kind === 'local' ? new LocalSimHost(st, { initialSpeed: 0 }) : new LoopbackSimHost(st, { initialSpeed: 0 });
    await host.start();
    const sim: Simulation = host instanceof LoopbackSimHost ? host.harness.core.sim : host.sim;
    const settle = async () => { if (host instanceof LoopbackSimHost) await host.drain(); };
    return { host, sim, em: emergencyOf(sim) as EmergencySystem, farther, home, settle };
  }

  it('a dispatchBest or dispatch the player sends to an incident the city answered by itself names it in the cause', async () => {
    const { host, sim, em, farther, home, settle } = await boot();
    try {
      const id = em.spawn(sim, 'medical', home.x, home.z, { buildingId: home.id, major: true });
      await settle();
      // the near clinic answered it by itself: answered 1, one ambulance short
      expect(em.incident(id)?.answered).toBe(1);
      const tag = {}, w = watch(host);
      const best = host.act('dispatchBest', [id]); await settle(); expect(await best.done).toMatchObject({ ok: true });
      // and one more than it needs (a reinforcement): the incident's own record still says the city answered it
      const more = host.act('dispatch', [id, farther.id, 1], { tag }); await settle(); expect(await more.done).toMatchObject({ ok: true });
      expect(em.incident(id)?.answered).toBe(1);
      w.off();
      expect(w.seen.map((s) => [s.id, s.cause?.seq, s.cause?.tag, s.cause?.dispatchIncidentId])).toEqual([
        [id, best.seq, null, id], [id, more.seq, tag, id]]);
      expect(host.cause, 'only during the command\'s effects').toBeNull();
    } finally { await host.dispose(); }
  });

  it('a command that dispatches as a side effect names no incident', async () => {
    const { host, home, settle } = await boot();
    try {
      const w = watch(host);
      // a fire the fire station answers on its own, inside triggerDisaster's effects
      const fire = host.act('triggerDisaster', ['fire', home.x, home.z]); await settle(); expect(await fire.done).toBe(true);
      w.off();
      expect(w.seen.map((s) => [s.cause?.seq, s.cause?.dispatchIncidentId])).toEqual([[fire.seq, undefined]]);
    } finally { await host.dispose(); }
  });
});

describe('the worker host', () => {
  it('a dispatchBest the player sends names its incident in the cause', { timeout: 30000 }, async () => {
    const st = newState(64); st.config.seed = 7; st.funds = 1e6;
    roadLine(st, 2, 20, 62, 20, Network.Road);
    place(st, 't_fire', 4, 19);
    const home = place(st, 't_r2', 40, 21, { pop: 60 });
    const city = serializeCity(st, { copy: true }); city.savedAt = 1;
    const host = await bootNode(city, { kv: new MemoryKV(), initialSpeed: 0 });
    try {
      const fire = host.post('triggerDisaster', ['fire', home.x, home.z]); host.flushCommands(); await within(fire.done);
      await waitFor(() => host.emergency.incidents().length > 0, 'the fire');
      const id = host.emergency.incidents()[0].id, w = watch(host);
      const sent = host.post('dispatchBest', [id]); host.flushCommands();
      expect((await within(sent.done)).ok).toBe(true);
      w.off();
      expect(w.seen.map((s) => [s.id, s.cause?.seq, s.cause?.dispatchIncidentId])).toEqual([[id, sent.seq, id]]);
    } finally { await host.dispose(); }
  });
});
