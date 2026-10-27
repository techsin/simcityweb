// perfrev-v2: put the bench town into this origin's IndexedDB as the last session (main menu -> Continue loads it)
const P = new URLSearchParams(location.search);
const W = window as any;
try {
  const save: any = await import('../src/save/index');
  const bytes = new Uint8Array(await (await fetch('/bench/' + (P.get('file') ?? 'town.metropolis'))).arrayBuffer());
  const f = await save.readRegionFile(bytes);
  const region = await save.importRegion(bytes, { replace: true });
  const tileKey = Object.keys(f.cities)[0];
  // (setLastRegionId first: it drops a session's tile key; setLastSession then records region + tile)
  save.setLastRegionId?.(region.id);
  save.setLastSession({ regionId: region.id, tileKey });
  localStorage.setItem('metropolis.settings', JSON.stringify({ quality: P.get('q') ?? 'low', autosaveMonths: 0, edgeScroll: false, showFps: false, v: 2 }));
  W.__seeded = { regionId: region.id, tileKey };
} catch (e) {
  console.error('[seed] failed', e);
  W.__seeded = { error: String(e) };
}
