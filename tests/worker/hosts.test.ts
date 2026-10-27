import { beforeAll, describe, it } from 'vitest';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { hostParity, crossHostSaves, workerBoundaries, saveFailureChecks } from '../../tools/bench/worker/hostChecks';

let worker: URL;
beforeAll(async () => { worker = await buildWorkerTest(); }, 30000);

describe('Local, Loopback and real Worker hosts', () => {
  it('120 scripted deterministic days have equal full hashes at 30, 60 and 120', { timeout: 120000 }, async () => { await hostParity(worker); });
  it('save in one host, load in another, and continue for 60 days', { timeout: 120000 }, async () => { await crossHostSaves(worker); });
  it('orders command causes, queries, main saves and worker snapshots; refuses replica saves', { timeout: 30000 }, async () => { await workerBoundaries(worker); });
  it('failed and delayed main puts preserve the recovery base and FIFO save watermark', async () => { await saveFailureChecks(worker); });
});
