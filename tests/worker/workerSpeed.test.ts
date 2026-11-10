/**
 * T061 item 1 (NOTE-048, NOTE-049; T034b's B4): a speed change the authority makes by itself (the emergency policy's urgent
 * pause) reaches main as a speedChanged in a packet's log. The replica used to replay that log before PacketSimHost's
 * clock hook moved its speed mirror to the packet's clock, so a handler that re-read host.speed inside the event read the
 * old speed (T048's QA: after an urgent pause the LIVE duck never engaged). PacketSimHost now moves the mirror at each of
 * the log's speedChanged, before it is emitted, unless a newer speed command of the page's is pending. One test, both
 * packet hosts: the loopback and the real worker (worker_threads).
 * T061 F1 (T034b's review): WorkerSimHost's packet-speed override, which this replaces, shadowed a speed command the page
 * posted inside the packet (a handler's setSpeed read the packet's speed back); the last case pins that.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Network } from '../../src/core/types';
import { clearRecoveryBase } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import { serializeCity } from '../../src/save/serialize';
import { LoopbackSimHost, type PacketSimHost } from '../../src/worker/LoopbackSimHost';
import type { CommandArgs, CommandOp, CommandResult } from '../../src/worker/SimHost';
import type { M2W } from '../../src/worker/protocol';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { newState, place, roadLine } from '../infra/cityGen';
import { bootNode, waitFor, within } from './workerHarness';

beforeAll(async () => { await buildWorkerTest(); }, 60000);
afterEach(() => { vi.restoreAllMocks(); clearRecoveryBase(); setKV(new MemoryKV()); });

/** a fire station at one end of a road and a home far down it: a fire there is uncovered, and a unit can be sent */
function uncoveredCity() {
  const st = newState(64); st.config.seed = 7; st.funds = 1e6;
  roadLine(st, 2, 20, 62, 20, Network.Road);
  place(st, 't_fire', 4, 19);
  const home = place(st, 't_r2', 40, 21, { pop: 60 });
  return { st, home };
}

type Kind = 'loopback' | 'worker';
/** the host at speed 3; `hold` decides which posted command the transport keeps back (into `held`) */
async function boot(kind: Kind, hold?: (m: Extract<M2W, { t: 'cmd' }>) => boolean): Promise<{ host: PacketSimHost; held: unknown[] }> {
  const { st } = uncoveredCity(), held: unknown[] = [];
  if (kind === 'worker') {
    const city = serializeCity(st, { copy: true }); city.savedAt = 1;
    const host = await bootNode(city, { kv: new MemoryKV(), initialSpeed: 3, wrap: (port) => ({ ...port, postMessage(m) {
      if (m.t === 'cmd' && hold?.(m)) { held.push(m); return; }
      port.postMessage(m);
    } }) });
    return { host, held };
  }
  const host = new LoopbackSimHost(st, { initialSpeed: 3 });
  await host.start();
  const post = host.harness.post.bind(host.harness);
  vi.spyOn(host.harness, 'post').mockImplementation((m) => { if (m.t === 'cmd' && hold?.(m)) held.push(m); else post(m); });
  return { host, held };
}
function send<K extends CommandOp>(host: PacketSimHost, op: K, args: CommandArgs<K>): Promise<CommandResult<K>> {
  const t = host.post(op, args); host.flushCommands(); return t.done;
}
const frames = async (host: PacketSimHost, n: number) => { for (let i = 0; i < n; i++) { host.frame(0.25); await new Promise((r) => setTimeout(r, 5)); } };
/** an uncovered major fire with the policy set to pause on it: the authority pauses the city by itself in a frame */
async function armFire(host: PacketSimHost): Promise<void> {
  await within(send(host, 'setSettings', [{ emergencyUncovered: 'pause', emergencyAlerts: 'all', emergencyLiveSlowmo: 3 }]));
  const { home } = uncoveredCity();
  await within(send(host, 'triggerDisaster', ['fire', home.x, home.z]));
}
async function untilPause(host: PacketSimHost, seen: { event: number }[]): Promise<void> {
  for (let i = 0; i < 40 && !seen.some((s) => s.event === 0); i++) await frames(host, 1);
  await waitFor(() => seen.some((s) => s.event === 0), 'the urgent pause');
}

describe.each<Kind>(['loopback', 'worker'])('the %s host\'s speed inside a packet', (kind) => {
  it('a handler that re-reads host.speed inside the authority\'s own speedChanged (an urgent pause) reads the new speed', { timeout: 30000 }, async () => {
    const { host } = await boot(kind);
    try {
      expect(host.speed).toBe(3);
      const seen: { event: number; speed: number }[] = [];
      const off = host.events.on('speedChanged', (event) => seen.push({ event, speed: host.speed }));
      await armFire(host); await untilPause(host, seen);
      off();
      expect(host.speed).toBe(0);
      // the authority paused the city by itself: no speed command of the page's is pending, so the event is the speed
      expect(seen).toEqual([{ event: 0, speed: 0 }]);
    } finally { await host.dispose(); }
  });

  it('while a newer speed command of the page is pending, a packet\'s speedChanged reads that command\'s speed (the mirror)', { timeout: 30000 }, async () => {
    let holding = false;
    // the page's setSpeed is held back on its way to the authority, so its packet carries the authority's pause first
    const { host, held } = await boot(kind, (m) => holding && m.op === 'setSpeed');
    try {
      await armFire(host);
      const seen: { event: number; speed: number }[] = [];
      const off = host.events.on('speedChanged', (event) => seen.push({ event, speed: host.speed }));
      holding = true;
      host.setSpeed(2, 'keyboard'); // optimistic: speedChanged(2) at once, then the authority's pause (0) in a packet
      await untilPause(host, seen);
      off();
      expect(held.length).toBe(1);
      // the pending setSpeed(2) is newer than the packet: the mirror keeps it, inside the event and after it
      expect(seen).toEqual([{ event: 2, speed: 2 }, { event: 0, speed: 2 }]);
      expect(host.speed).toBe(2);
    } finally { await host.dispose(); }
  });

  it('F1: a speed command a handler posts inside the packet is not shadowed by the packet\'s speed', { timeout: 30000 }, async () => {
    const { host } = await boot(kind);
    try {
      const seen: { event: number; speed: number }[] = [];
      let nested = false;
      const off = host.events.on('speedChanged', (event) => {
        seen.push({ event, speed: host.speed });
        // inside the authority's pause: the player (or a UI rule) asks for speed 2 at once
        if (event === 0 && !nested) { nested = true; host.setSpeed(2, 'keyboard'); seen.push({ event: -1, speed: host.speed }); }
      });
      await armFire(host); await untilPause(host, seen);
      // the optimistic speedChanged(2) inside the pause, and the read after it, see the page's 2
      expect(seen.slice(0, 3)).toEqual([{ event: 0, speed: 0 }, { event: 2, speed: 2 }, { event: -1, speed: 2 }]);
      expect(host.speed, 'after the packet, the pending command still holds').toBe(2);
      // the authority applies it; its own speedChanged(2) reads 2 as well
      await waitFor(() => seen.length >= 4, 'the authority\'s speedChanged(2)');
      await frames(host, 2);
      off();
      expect(seen.slice(3)).toEqual([{ event: 2, speed: 2 }]);
      expect(host.speed).toBe(2);
    } finally { await host.dispose(); }
  });
});
