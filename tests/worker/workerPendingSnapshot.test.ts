/**
 * T089 (W1.3 decision 20) through the real worker. With persistence 'worker-idb' the worker reads
 * `recovery/<key>#journal` from its own IndexedDB at boot (journal.ts readBootJournal; here the test's KV, through
 * nodeWorker.ts's bridge). A journal bound to a snapshot that is still stored does not extend the save the worker loads.
 * Before T089 that boot deleted it ("it can never apply"), so the edits made after the snapshot were gone when the
 * snapshot was restored later. Now it stays for as long as the snapshot does.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevType } from '../../src/core/types';
import { clearRecoveryBase, getCityRecord, type CityRecord } from '../../src/save/cities';
import { setKV } from '../../src/save/db';
import type { RecoveryJournal } from '../../src/save/recoveryCodec';
import { findRecoverySnapshot, restoreRecoverySnapshot } from '../../src/save/recovery';
import type { WorkerSimHost } from '../../src/worker/WorkerSimHost';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { bootIdb, initialCity, send } from './workerHarness';
import { MemStorage, PersistentMemoryKV, regionData } from '../save/fixtures';

const REGION = 'hosts', TILE = '0', KEY = `${REGION}:${TILE}`, JOURNAL = `${KEY}#journal`, CITY = { regionId: REGION, tileKey: TILE };
let kv: PersistentMemoryKV;
const hosts: WorkerSimHost[] = [];
beforeAll(async () => { await buildWorkerTest(); }, 60000);
beforeEach(async () => {
  kv = new PersistentMemoryKV(); setKV(kv); clearRecoveryBase();
  vi.stubGlobal('localStorage', new MemStorage());
  await kv.put('regions', regionData(REGION, 'Host Region'));
  const city = initialCity();
  await kv.put('cities', { key: KEY, regionId: REGION, tileKey: TILE, savedAt: city.savedAt, city } satisfies CityRecord, KEY);
});
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.dispose();
  clearRecoveryBase(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function boot(opts: Partial<Parameters<typeof bootIdb>[2]> = {}): Promise<WorkerSimHost> {
  const host = await bootIdb(REGION, TILE, { kv, deterministic: true, ...opts });
  hosts.push(host); return host;
}

describe('T089: the worker\'s boot and a journal bound to a pending snapshot', () => {
  it('a worker that boots the save while the snapshot waits leaves its journal, replays nothing and writes nothing; the restore then takes both', { timeout: 60000 }, async () => {
    const first = await boot();
    const saved = await first.save('manual');
    await send(first, 'setTax', [DevType.R1, 14]);
    const snap = (await first.snapshot('hidden'))!;
    await send(first, 'setFunding', ['fire', 125]);
    // the tab closes: the unload write, and nothing is saved
    first.recovery!.writeNow('pagehide');
    await first.dispose();
    const pending = { snapshot: await kv.get('recovery', KEY), journal: await kv.get<RecoveryJournal>('recovery', JOURNAL) };
    expect(pending.snapshot).toMatchObject({ marker: { at: snap.marker.at, baseSavedAt: saved.savedAt } });
    expect(pending.journal).toMatchObject({ base: { kind: 'snapshot', at: snap.marker.at, baseSavedAt: saved.savedAt }, ops: [{ op: 'setFunding' }] });

    // the city opens on its save, with the default replay, while that offer is unanswered
    const put = vi.spyOn(kv, 'put'), remove = vi.spyOn(kv, 'delete');
    const phases: string[] = [], reports: string[] = [];
    const second = await boot({ onBoot: (phase) => phases.push(phase), errors: { report: (title) => { reports.push(title); } } });
    expect(phases, 'no journal to replay onto the save').toEqual(['idb', 'deserialize', 'systems', 'snapshot']);
    expect(second.state.budget.taxRates[DevType.R1]).not.toBe(14);
    expect(second.state.budget.funding.fire).not.toBe(125);
    expect(second.changes).toBe(0);
    expect(reports).toEqual([]);
    expect(remove, 'the worker deleted no recovery record').not.toHaveBeenCalled();
    expect(put, 'and saved nothing').not.toHaveBeenCalled();
    expect(await kv.get('recovery', KEY)).toEqual(pending.snapshot);
    expect(await kv.get('recovery', JOURNAL)).toEqual(pending.journal);
    expect((await getCityRecord(kv, REGION, TILE))?.savedAt).toBe(saved.savedAt);
    await second.dispose();
    put.mockRestore(); remove.mockRestore();

    // the offer is still whole: the snapshot, and the journal bound to it at the next boot
    const offer = (await findRecoverySnapshot(CITY))!;
    expect(offer.marker).toMatchObject({ at: snap.marker.at, baseSavedAt: saved.savedAt });
    await restoreRecoverySnapshot(offer);
    const third = await boot();
    expect(third.state.budget.taxRates[DevType.R1], 'from the snapshot').toBe(14);
    expect(third.state.budget.funding.fire, 'from its journal').toBe(125);
  });
});
