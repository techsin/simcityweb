/** W1.2 test harness: a small seeded city, the real worker under node worker_threads, and the worker loop in-process. */
import { createHash } from 'node:crypto';
import { encodeBundle } from '../../src/save/bundleCodec';
import { serializeCity, type SerializedCity } from '../../src/save/serialize';
import type { KV } from '../../src/save/db';
import { CityActions, type ActionResult } from '../../src/sim/actions';
import type { SimSystem } from '../../src/sim/Simulation';
import { installSimWorker } from '../../src/worker/simWorker';
import { bootWorkerSimHost, type WorkerSimHost, type WorkerSimHostOptions } from '../../src/worker/WorkerSimHost';
import { PROTOCOL_VERSION } from '../../src/worker/protocol';
import type { WorkerInput, WorkerOutput, WorkerPort } from '../../src/worker/workerProtocol';
import type { CommandArgs, CommandOp, CommandResult } from '../../src/worker/SimHost';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { nodeWorkerPort } from '../../tools/bench/worker/nodePort';
import { newState, place } from '../infra/cityGen';

/** a 32² city on the test catalog: power, water, a row of homes and a shop */
export function initialCity(): SerializedCity {
  const st = newState(32); st.config.seed = 7; st.funds = 1e6;
  place(st, 't_coal', 2, 13); place(st, 't_pump', 6, 14);
  for (let x = 4; x < 20; x += 2) place(st, 't_r1', x, 17, { pop: 10, capacity: 12 });
  place(st, 't_cs', 22, 17, { jobs: 20 });
  const city = serializeCity(st, { copy: true }); city.savedAt = 1; return city;
}
/** the full save, its timestamp aside */
export function hash(city: SerializedCity): string {
  return createHash('sha256').update(encodeBundle({ ...city, savedAt: 0 })).digest('hex');
}
/** acks carry no preview cells (§2.2) */
export function stripCells(r: unknown): unknown {
  if (!r || typeof r !== 'object' || !('cells' in r)) return r;
  const { cells: _cells, ...rest } = r as ActionResult;
  return rest;
}

/** the real worker on a node worker_threads port; `wrap` may interpose on the transport */
export async function bootNode(city: SerializedCity, opts: WorkerSimHostOptions & { kv: KV; wrap?: (port: WorkerPort) => WorkerPort } ): Promise<WorkerSimHost> {
  const port = nodeWorkerPort(await buildWorkerTest());
  return bootWorkerSimHost({ kind: 'serialized', regionId: 'hosts', tileKey: '0', savedAt: city.savedAt, city },
    { dev: true, ...opts, port: opts.wrap?.(port) ?? port });
}
/** post a command and send it at once (sliders otherwise coalesce until the next frame) */
export function send<K extends CommandOp>(host: WorkerSimHost, op: K, args: CommandArgs<K>): Promise<CommandResult<K>> {
  const t = host.post(op, args); host.flushCommands(); return t.done;
}

/** the promise, or a rejection after `ms`: an outcome that never comes fails fast instead of timing out */
export const within = <T>(p: Promise<T>, ms = 2000) => Promise.race([p,
  new Promise<never>((_, no) => setTimeout(() => no(new Error(`still pending after ${ms} ms`)), ms))]);
export async function waitFor(test: () => boolean, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** The production worker loop in this thread, behind a cloning scope, with test systems (no worker_threads). It acks
 *  each packet as main does, unless `ack` is false. */
export function inProcess(systems: SimSystem[], init: { deterministic?: boolean; initialSpeed?: number; ack?: boolean } = {}) {
  let receive!: (m: WorkerInput) => void, epoch = 0;
  const messages: WorkerOutput[] = [];
  const runtime = installSimWorker({
    listen(fn) { receive = fn; },
    postMessage(message) {
      const m = structuredClone(message);
      messages.push(m);
      if (m.t === 'ready') epoch++;
      else if (m.t === 'pkt' && init.ack !== false) queueMicrotask(() => receive({ t: 'ack', ack: m.p.seq, epoch }));
    },
  }, { createSystems: () => systems, CityActions });
  const city = initialCity();
  receive({ t: 'init', v: PROTOCOL_VERSION, city: { kind: 'serialized', regionId: 'units', tileKey: '0', savedAt: 1, city },
    persistence: 'main', rctx: null, initialSpeed: init.initialSpeed ?? 3, deterministic: init.deterministic,
    settings: { emergencyUncovered: 'ignore', emergencyLiveSlowmo: 3, emergencyAlerts: 'all' }, flags: { simwasm: null, dev: true } });
  return {
    messages,
    send: (m: WorkerInput) => receive(m),
    packets: () => messages.flatMap((m) => m.t === 'pkt' ? [m.p] : []),
    async until(test: (m: WorkerOutput) => boolean, what: string): Promise<WorkerOutput> {
      await waitFor(() => messages.some(test), what);
      return messages.find(test)!;
    },
    dispose: () => runtime.dispose(),
  };
}
