/**
 * W1.3's acceptance (WORKER_DESIGN §6 row W1.3): at 1M a save blocks the worker ≤ 60 ms and the main thread ≤ 2 ms.
 * A measurement, skipped unless asked for (it loads dense1m twice and boots it in a real worker):
 *   SIM_SAVE_COST=1 SIM_FIXTURES=<dir> npx vitest run --configLoader runner tests/perf/saveCost.test.ts
 * Worker, §4.2's two units: save:copy (SimCore.copySave: serializeCity copy, cityFingerprint, summarizeCity, and the
 * boundary flush it forces), then save:put (the IndexedDB put's synchronous structured clone; structuredClone here), on
 * the fixture in this thread. The worker runs them as separate units (simWorker's WorkerIdbStore), so its longest block
 * is the larger of the two.
 * Main: the real worker (node worker_threads, persistence 'worker-idb' through the test KV bridge) saves; the page's
 * share is the host's receive() of the packet that carries the `saved` reply, which no longer carries the record.
 * Node, not Chromium, on a shared machine: the load is printed with the numbers, and nothing here asserts a time.
 */
import { existsSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureDirectory, loadFixture } from '../../tools/bench/worker/fixtures';
import { serializeCity } from '../../src/save/serialize';
import { setKV } from '../../src/save/db';
import { SimCore } from '../../src/worker/SimCore';
import { ChangeRecorder } from '../../src/worker/recorder';
import { createSystems } from '../../src/sim/systems';
import { CityActions } from '../../src/sim/actions';
import type { WorkerOutput } from '../../src/worker/workerProtocol';
import { bootIdb } from '../worker/workerHarness';
import { PersistentMemoryKV } from '../save/fixtures';

const FILE = join(fixtureDirectory(), process.env.SIM_SAVE_FIXTURE ?? 'dense1m_s7.metropolis');
const RUNS = Number(process.env.SIM_SAVE_RUNS ?? 7);
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { median: +s[s.length >> 1].toFixed(2), max: +s[s.length - 1].toFixed(2), n: s.length }; };
const load = () => loadavg().map((x) => x.toFixed(1)).join(' ');

describe.runIf(process.env.SIM_SAVE_COST === '1' && existsSync(FILE))('W1.3: what a save costs at 1M (measured, not gated)', () => {
  it('the worker\'s save unit and the main thread\'s share of the reply', { timeout: 600000 }, async () => {
    const st = loadFixture(FILE);
    console.log(`fixture ${FILE}: population ${st.stats.population}, ${st.buildings.size} buildings, ${st.size}² cells; load ${load()}`);
    const core = new SimCore(st, { report: (t, e) => console.warn('[sim]', t, e) });
    core.boot(null, { createSystems, CityActions });
    const recorder = new ChangeRecorder(core.sim, {});
    recorder.ready();
    for (let d = 0; d < 3; d++) { core.sim.advanceDay(); recorder.flush({ force: true }); }
    const copy: number[] = [], clone: number[] = [], flush: number[] = [], unit: number[] = [], both: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      core.sim.advanceDay(); recorder.flush({ force: true });
      const t0 = performance.now();
      const c = core.copySave('bench', '0');
      const t1 = performance.now();
      recorder.flush({ force: true });
      const t2 = performance.now();
      structuredClone(c.record);
      const t3 = performance.now();
      copy.push(t1 - t0); flush.push(t2 - t1); clone.push(t3 - t2); unit.push(t2 - t0); both.push(t3 - t0);
    }
    console.log(`worker (ms): save:copy unit ${JSON.stringify(stats(unit))} (copySave ${JSON.stringify(stats(copy))}, boundary flush ${JSON.stringify(stats(flush))}); save:put unit ${JSON.stringify(stats(clone))}; both, were they one task ${JSON.stringify(stats(both))}; load ${load()}`);

    const kv = new PersistentMemoryKV(); setKV(kv);
    const city = serializeCity(core.sim.state, { copy: true }); city.savedAt = 1;
    recorder.dispose(); core.dispose();
    await kv.put('cities', { key: 'bench:0', regionId: 'bench', tileKey: '0', savedAt: 1, city }, 'bench:0');
    const host = await bootIdb('bench', '0', { kv, deterministic: true });
    try {
      expect(host.persistence).toBe('worker-idb');
      const receive = host.receive.bind(host), main: number[] = [], reply: number[] = [], sizes: string[] = [];
      host.receive = (m: WorkerOutput) => {
        const t0 = performance.now(); receive(m);
        if (m.t === 'pkt' && m.p.replies?.some((r) => r.t === 'saved')) {
          main.push(performance.now() - t0);
          sizes.push(`${m.p.log.length} log, ${m.p.layers?.length ?? 0} layers, ${m.p.replies.length} replies`);
        }
      };
      // the save's own share: the reply's settlement (the localStorage part, the journal mirror, the ack)
      const self = host as unknown as { reply(r: { t: string }): void };
      const settle = self.reply.bind(host);
      self.reply = (r) => { const t0 = performance.now(); settle(r); if (r.t === 'saved') reply.push(performance.now() - t0); };
      for (let i = 0; i < RUNS; i++) { await host.runDays(1); await host.save('manual'); }
      console.log(`main thread (ms): the saved reply ${JSON.stringify(stats(reply))}, its whole packet ${JSON.stringify(stats(main))} (${sizes[0]}); load ${load()}`);
      expect(main).toHaveLength(RUNS);
    } finally { await host.dispose(); }
  });
});
