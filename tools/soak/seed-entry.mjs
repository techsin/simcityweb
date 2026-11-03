// Runs ONLY in an empty, same-origin setup document, which is then navigated away.
// No helper code or fixture bytes survive in the document used for the actual soak.
import { unpackFile } from '../../src/save/bundle.ts';
import { openKV } from '../../src/save/db.ts';

globalThis.__soakSeed = async base64 => {
  const file = await unpackFile(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
  if (file.kind !== 'metropolis-region-file') throw new Error('Not a prepared region');
  const kv = await openKV();
  if (!kv.persistent) throw new Error('IndexedDB is unavailable; refusing an in-memory soak');
  for (const [tileKey, city] of Object.entries(file.cities)) {
    const key = `${file.region.id}:${tileKey}`;
    await kv.put('cities', { key, regionId: file.region.id, tileKey, savedAt: Date.now(), city }, key);
  }
  await kv.put('regions', file.region);
  return { regionId: file.region.id, cities: Object.keys(file.cities).length };
};
