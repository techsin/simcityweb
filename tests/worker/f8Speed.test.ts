/**
 * NOTE-077 (X1): the packet hosts' F8 dev check (WORKER_DESIGN §2.4 step 7: after each packet, every field with a
 * pending op still holds that op's value) and speed commands. X1 was "F8: speed read 0 before ack N, which wrote 3"
 * after a pause sent while a packet was applied. The record took a read of `host.speed` for the value the pause wrote,
 * and on WorkerSimHost before T061 that read was the packet's clock speed (T034b's F1: the getter shadowed the pending
 * pause). So F8 missed the shadowing in that packet and blamed the pause one packet later. T061 removed the shadowing;
 * a speed command's record is now the value the command itself writes, set before its write, so F8 no longer depends on
 * that read, and a newer speed command posted from the write's own speedChanged keeps the record. The other optimistic
 * fields still record what was read back: CityActions rounds, clamps or refuses what their commands carry.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SECONDS_PER_DAY } from '../../src/core/constants';
import { DevType, Network } from '../../src/core/types';
import { clearRecoveryBase } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import { serializeCity } from '../../src/save/serialize';
import { CityActions } from '../../src/sim/actions';
import { BF, type CityState } from '../../src/sim/CityState';
import { LoopbackSimHost, PacketSimHost } from '../../src/worker/LoopbackSimHost';
import type { ActOptions, CommandArgs, CommandOp, CommandResult } from '../../src/worker/SimHost';
import { EntryType, type Clock, type Entry, type Packet, type W2M } from '../../src/worker/protocol';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { newState, place, roadLine } from '../infra/cityGen';
import { bootNode, waitFor, within } from './workerHarness';

beforeAll(async () => { await buildWorkerTest(); }, 60000);
afterEach(() => { vi.restoreAllMocks(); clearRecoveryBase(); setKV(new MemoryKV()); });

const report = (errors: string[]) => ({ report: (_title: string, e: unknown) => { errors.push(e instanceof Error ? e.message : String(e)); } });

/** The page side alone: a PacketSimHost (or `Host`) at `speed` whose packets the test writes (no core behind it). */
function rig(speed: number, st: CityState = newState(16), Host: typeof PacketSimHost = PacketSimHost) {
  const clock = (s: number): Clock => ({ day: 0, frac: 0, speed: s, slow: 1, spd: SECONDS_PER_DAY[s], live: true });
  const errors: string[] = [];
  const host = new Host('loopback', {
    t: 'ready', snapshot: serializeCity(st, { copy: true }), streams: {}, policy: { alerts: [], live: false }, clock: clock(speed), savedAt: 0, cmd: 0,
  }, { errors: report(errors), optimistic: CityActions });
  host.connect(() => {});
  let seq = 0;
  /** the authority's next packet at clock speed `s`: its log, then the Acks of the commands it has applied */
  const packet = (s: number, log: Entry[] = [], acked: number[] = []): void => {
    const p: Packet = {
      seq: ++seq, cmd: acked.at(-1) ?? host.replica.cmd, clock: clock(s),
      log: [...log, ...acked.map((cmd, i): Entry => [EntryType.Ack, 0, i, cmd])], ...(acked.length ? { acks: acked.map(() => undefined) } : {}),
    };
    host.receive(structuredClone({ t: 'pkt' as const, p }));
  };
  /** a fault: the host forgets a command it has sent, so later packets no longer re-apply its optimistic write */
  const lose = (cmd: number) => { (host as unknown as { edits: Map<number, unknown> }).edits.delete(cmd); };
  return { host, errors, packet, lose };
}
const day: Entry = [EntryType.Day, 0, 0];

describe('F8 and a speed command sent while a packet is applied (crafted packets)', () => {
  it('X1: an error\'s pause inside a packet at ultra raises no F8, in that packet or before its ack', async () => {
    const { host, errors, packet } = rig(3);
    // the error overlay pauses the city from inside the packet's replay, while the packet's clock still says 3
    const off = host.events.on('day', () => { off(); host.setSpeed(0, 'error'); });
    packet(3, [day]);
    expect(host.speed).toBe(0);
    // older packets keep coming before the authority has the command: its clock says 3, the page's pause holds
    packet(3, [day]);
    packet(3);
    expect(host.speed).toBe(0);
    // the authority applies it: its own speedChanged(0) with the command as cause, then the Ack
    packet(0, [[EntryType.SpeedChanged, 0, 0, 1]], [1]);
    packet(0, [day]);
    expect(host.speed).toBe(0);
    expect(errors).toEqual([]);
    await host.dispose();
  });

  it('a handler\'s setSpeed(3) inside the authority\'s own pause raises no F8', async () => {
    const { host, errors, packet } = rig(3);
    const seen: [number, number][] = [];
    let asked = false;
    host.events.on('speedChanged', (event) => {
      seen.push([event, host.speed]);
      if (event === 0 && !asked) { asked = true; host.setSpeed(3, 'keyboard'); }
    });
    packet(0, [[EntryType.SpeedChanged, 0, 0]]);
    // the authority's pause, then the handler's own optimistic event inside it
    expect(seen).toEqual([[0, 0], [3, 3]]);
    expect(host.speed).toBe(3);
    packet(0, [day]);
    packet(3, [[EntryType.SpeedChanged, 0, 3, 1]], [1]);
    expect(host.speed).toBe(3);
    expect(errors).toEqual([]);
    await host.dispose();
  });

  it('a pause and its resume, both pending across packets, raise no F8', async () => {
    const { host, errors, packet } = rig(3);
    host.setSpeed(0, 'pause'); // 1: the pause menu opens at ultra
    expect(host.speed).toBe(0);
    host.resume('pause'); // 2: and closes before the authority answered
    expect(host.speed).toBe(3);
    packet(3, [day]);
    // the pause alone is applied: the authority's clock says 0, the pending resume still holds the page at 3
    packet(0, [[EntryType.SpeedChanged, 0, 0, 1]], [1]);
    expect(host.speed).toBe(3);
    packet(3, [[EntryType.SpeedChanged, 0, 3, 2]], [2]);
    expect(host.speed).toBe(3);
    expect(errors).toEqual([]);
    await host.dispose();
  });

  it('a newer speed command posted from the optimistic speedChanged keeps the record: no F8, and it stays guarded after the older one\'s ack', async () => {
    const { host, errors, packet, lose } = rig(1);
    let nested = false;
    host.events.on('speedChanged', (speed) => { if (speed === 3 && !nested) { nested = true; host.setSpeed(0, 'error'); } });
    host.setSpeed(3, 'keyboard'); // 1; a listener of its optimistic event posts 2: setSpeed(0)
    expect(host.speed).toBe(0);
    packet(1, [day]);
    // the older command alone is acknowledged: the authority's clock says 3, the newer one holds the page at 0
    packet(3, [[EntryType.SpeedChanged, 0, 3, 1]], [1]);
    expect(host.speed).toBe(0);
    expect(errors).toEqual([]);
    // still pending, so still guarded: a host that lost it reports the revert at the next packet
    lose(2);
    packet(3, [day]);
    expect(host.speed).toBe(3);
    expect(errors).toEqual(['F8: speed read 3 before ack 2, which wrote 0']);
    await host.dispose();
  });
});

describe('F8 still reports a real mismatch', () => {
  it('a pending speed command whose optimistic write is not re-applied after a packet', async () => {
    const { host, errors, packet, lose } = rig(3);
    host.setSpeed(0, 'pause'); // 1
    packet(3, [day]);
    expect(errors).toEqual([]);
    lose(1);
    packet(3, [day]);
    expect(host.speed).toBe(3);
    expect(errors).toEqual(['F8: speed read 3 before ack 1, which wrote 0']);
    await host.dispose();
  });

  it('a pending resume: what it wrote is the speed the pause had remembered', async () => {
    const { host, errors, packet, lose } = rig(3);
    host.setSpeed(0, 'pause'); host.resume('pause'); // 1, 2
    packet(0, [[EntryType.SpeedChanged, 0, 0, 1]], [1]);
    expect(errors).toEqual([]);
    lose(2);
    packet(0, [day]);
    expect(host.speed).toBe(0);
    expect(errors).toEqual(['F8: speed read 0 before ack 2, which wrote 3']);
    await host.dispose();
  });

  it('a host whose speed getter shadows a pending pause during a packet (X1\'s cause) is reported in that packet, with what the pause wrote', async () => {
    /** WorkerSimHost before T061 (T034b's B4): while a packet is applied, `speed` is the packet's clock speed, unless a
     *  speed command of the page's was already newer than the packet when it arrived */
    class ShadowingHost extends PacketSimHost {
      private packetSpeed: number | null = null;
      private speedSeq = 0;
      override get speed(): number { return this.packetSpeed ?? super.speed; }
      override post<K extends CommandOp>(op: K, args: CommandArgs<K>, opts?: ActOptions) {
        const ticket = super.post(op, args, opts);
        if (op === 'setSpeed' || op === 'resume') this.speedSeq = ticket.seq;
        return ticket;
      }
      override receive(message: W2M): void {
        if (message.t === 'pkt' && this.speedSeq <= message.p.cmd) this.packetSpeed = message.p.clock.speed;
        try { super.receive(message); } finally { this.packetSpeed = null; }
      }
    }
    const { host, errors, packet } = rig(3, newState(16), ShadowingHost);
    const inside: number[] = [];
    const off = host.events.on('day', () => { off(); host.setSpeed(0, 'error'); inside.push(host.speed); });
    packet(3, [day]);
    // the real mismatch, where it happens: the pause wrote 0 and the page still read 3 until the packet's end
    expect(inside).toEqual([3]);
    expect(errors).toEqual(['F8: speed read 3 before ack 1, which wrote 0']);
    // (the old record took that shadowed read for the pause's value: nothing here, then X1's "speed read 0 before ack
    // 1, which wrote 3" at the next packet, where nothing was wrong any more)
    packet(3, [day]);
    expect(host.speed).toBe(0);
    expect(errors).toHaveLength(1);
    await host.dispose();
  });

  it('a tax that no longer holds a pending setTax\'s value after a packet', async () => {
    const { host, errors, packet, lose } = rig(1);
    host.post('setTax', [DevType.R1, 12]); // 1
    // each packet re-applies the pending rate over whatever the authority's plain data holds
    host.state.budget.taxRates[DevType.R1] = 7;
    packet(1, [day]);
    expect(host.state.budget.taxRates[DevType.R1]).toBe(12);
    expect(errors).toEqual([]);
    lose(1);
    host.state.budget.taxRates[DevType.R1] = 7;
    packet(1, [day]);
    expect(errors).toEqual([`F8: tax:${DevType.R1} read 7 before ack 1, which wrote 12`]);
    await host.dispose();
  });
});

describe('F8 records what was read back for the fields whose commands do not carry the written value', () => {
  it('a rounded tax, a clamped funding and a historic flag a plopped building refuses raise no F8', async () => {
    const st = newState(16), plopped = place(st, 't_r1', 3, 3, { flags: BF.Plopped });
    const { host, errors, packet } = rig(1, st);
    host.post('setTax', [DevType.R1, 9.57]);
    host.post('setFunding', ['fire', 400]);
    host.post('setHistoric', [plopped.id, true]);
    expect(host.state.budget.taxRates[DevType.R1]).toBe(9.6);
    expect(host.state.budget.funding.fire).toBe(150);
    expect(host.state.buildings.get(plopped.id)!.flags & BF.Historic).toBe(0);
    packet(1, [day]);
    packet(1, [day]);
    expect(errors).toEqual([]);
    await host.dispose();
  });
});

// ------------------------------------------------------------------------------------------------ the real hosts
type Kind = 'loopback' | 'worker';
/** a fire station at one end of a road and a home far down it: a fire there is uncovered (workerSpeed.test.ts) */
function uncoveredCity() {
  const st = newState(64); st.config.seed = 7; st.funds = 1e6;
  roadLine(st, 2, 20, 62, 20, Network.Road);
  place(st, 't_fire', 4, 19);
  const home = place(st, 't_r2', 40, 21, { pop: 60 });
  return { st, home };
}
async function boot(kind: Kind, errors: string[]): Promise<PacketSimHost> {
  const { st } = uncoveredCity();
  if (kind === 'worker') {
    const city = serializeCity(st, { copy: true }); city.savedAt = 1;
    return bootNode(city, { kv: new MemoryKV(), initialSpeed: 3, errors: report(errors) });
  }
  const host = new LoopbackSimHost(st, { initialSpeed: 3, errors: report(errors) });
  await host.start();
  return host;
}
function send<K extends CommandOp>(host: PacketSimHost, op: K, args: CommandArgs<K>): Promise<CommandResult<K>> {
  const t = host.post(op, args); host.flushCommands(); return t.done;
}
const frames = async (host: PacketSimHost, n: number) => { for (let i = 0; i < n; i++) { host.frame(0.25); await new Promise((r) => setTimeout(r, 5)); } };

describe.each<Kind>(['loopback', 'worker'])('F8 on the %s host', (kind) => {
  it('a speed command a handler sends inside the authority\'s own pause raises no F8', { timeout: 30000 }, async () => {
    const errors: string[] = [];
    const host = await boot(kind, errors);
    try {
      expect(host.speed).toBe(3);
      const seen: number[] = [];
      let asked = false;
      const off = host.events.on('speedChanged', (event) => {
        seen.push(event);
        // inside the packet that carries the authority's urgent pause: the player (or a UI rule) asks for speed 2
        if (event === 0 && !asked) { asked = true; host.setSpeed(2, 'keyboard'); }
      });
      // an uncovered major fire with the policy set to pause on it: the authority pauses the city by itself
      await within(send(host, 'setSettings', [{ emergencyUncovered: 'pause', emergencyAlerts: 'all', emergencyLiveSlowmo: 3 }]));
      const { home } = uncoveredCity();
      await within(send(host, 'triggerDisaster', ['fire', home.x, home.z]));
      for (let i = 0; i < 40 && !asked; i++) await frames(host, 1);
      await waitFor(() => asked, 'the urgent pause');
      expect(host.speed).toBe(2);
      // the optimistic event, then the authority's own speedChanged(2) once it has applied the command
      await waitFor(() => seen.filter((speed) => speed === 2).length >= 2, 'the authority\'s speedChanged(2)');
      await frames(host, 3);
      off();
      expect(host.speed).toBe(2);
      expect(errors).toEqual([]);
    } finally { await host.dispose(); }
  });
});
