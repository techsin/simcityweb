import { beforeAll, describe, it } from 'vitest';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { livenessChecks, unitChecks, resyncAndCrash, bootFailures, explicitLiveChecks } from '../../tools/bench/worker/transportChecks';

let worker: URL;
beforeAll(async () => { worker = await buildWorkerTest(); }, 30000);
describe('W1.2 transport', () => {
  it('R11: visible-time liveness, ping cadence and boot progress deadlines', livenessChecks);
  it('yields between days and steps, honors pause, merges under backpressure and answers ping', unitChecks);
  it('the real worker resync settles a lost ack; exit rejects outstanding tickets and queries', async () => { await resyncAndCrash(worker); });
  it('fails fast on script error, messageerror and version mismatch', bootFailures);
  it('O7: explicit live mode survives a stale frame timestamp', explicitLiveChecks);
});
