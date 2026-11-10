#!/usr/bin/env node
/**
 * W1.3's browser check (WORKER_DESIGN §5.4: "From W1.3: it closes the page in the middle of an edit and checks that
 * recovery offers the journal and restores the edit"; T039's gate). Playwright Chromium (SwiftShader here), the
 * production build (vite build, vite preview), ?simworker=1 with the worker on its own IndexedDB. One browser.
 *   node tools/qa-journal.mjs [--port 5639] [--out <dir>]      (SKIP_BUILD=1 reuses <out>/../dist)
 * The tab is closed for real (page.close with beforeunload) with the host's asynchronous snapshot held, so only the
 * unload handlers' synchronous writes land. Exits 1 on any failed check. Kept apart from tools/qa-worker.mjs, the
 * worker-mode acceptance harness (T028's lane), which can fold it in.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
// The synchronous writes are the localStorage slot and the small IndexedDB journal record. The checks:
//  1. journal alone: the title offers the journal; Recover; the worker's boot replays it and saves before its Ready;
//  2. a worker snapshot, then edits only the journal holds: the title offers the snapshot; Recover restores it, and the
//     re-bound journal replays at the worker's boot;
//  3. the first save of the session holds everything and leaves no recovery record;
//  4. no page or console errors.
const Q = '&simdev=1';
async function waitCity(page) {
  await page.waitForFunction(() => window.__ready === true && window.__metropolis?.city?.host?.state && window.__metropolis.city.entered, null, { timeout: 300000, polling: 250 });
  await page.waitForTimeout(1500);
}
const dryRect = (page, off) => page.evaluate((off) => {
  const st = window.__metropolis.city.host.state, N = st.size, mid = (N >> 1) + off;
  const free = (x0, z0) => { for (let z = z0; z < z0 + 4; z++) for (let x = x0; x < x0 + 6; x++) { const i = z * N + x; if (st.water[i] || st.network[i] || st.building[i] >= 0 || st.zone[i]) return false; } return true; };
  for (let r = 0; r < 24; r++) for (let z = mid - r; z <= mid + r; z++) for (let x = mid - r; x <= mid + r; x++) if (x > 2 && z > 2 && x + 6 < N - 2 && z + 4 < N - 2 && free(x, z)) return { x0: x, z0: z, x1: x + 6, z1: z + 4 };
  return null;
}, off);
const probe = (page, rects) => page.evaluate((rects) => {
  const c = window.__metropolis.city, h = c.host, st = h.state;
  const zoned = rects.map((r) => { let n = 0; for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) if (st.zone[z * st.size + x] === 1) n++; return n; });
  return { kind: h.kind, persistence: h.persistence, recovery: !!h.recovery, taxR1: st.budget.taxRates[0], fire: st.budget.funding.fire, police: st.budget.funding.police, zoned, day: st.day, changes: h.changes, pending: h.pending?.count ?? null, tile: c.tile.key, name: st.config.name };
}, rects);
const slot = (page) => page.evaluate(() => {
  const j = JSON.parse(localStorage.getItem('metropolis.recovery.journal') ?? 'null'), m = JSON.parse(localStorage.getItem('metropolis.recovery') ?? 'null');
  return { marker: m && { kind: m.kind, bytes: m.bytes, ls: m.ls, why: m.why }, journal: j && { base: j.base, ops: j.ops.map((e) => [e.seq, e.op]) } };
});
const idb = (page, store, key) => page.evaluate(([store, key]) => new Promise((resolve) => {
  const r = indexedDB.open('metropolis');
  r.onsuccess = () => {
    const q = r.result.transaction(store, 'readonly').objectStore(store).get(key);
    q.onsuccess = () => {
      const v = q.result;
      r.result.close();
      if (!v) return resolve(null);
      if (store === 'cities') return resolve({ savedAt: v.savedAt, taxR1: v.city.data.budget.taxRates[0], fire: v.city.data.budget.funding.fire });
      if (v.ops) return resolve({ base: v.base, fromCmd: v.fromCmd, ops: v.ops.map((e) => [e.seq, e.op]), info: v.info && { cityName: v.info.cityName, day: v.info.day, why: v.info.why } });
      resolve({ marker: { at: v.marker.at, baseSavedAt: v.marker.baseSavedAt, bytes: v.marker.bytes } });
    };
    q.onerror = () => resolve('error');
  };
  r.onerror = () => resolve('open error');
}), [store, key]);
const within = (p, ms) => Promise.race([p.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, ms))]);
/** Close the tab for real: the app's visibilitychange, beforeunload and pagehide handlers run (main.ts snapshotNow ->
 *  host.recovery.writeNow). The host's asynchronous snapshot is held, so the worker's own IndexedDB snapshot cannot
 *  stand in for the journal; only the synchronous writes can land. */
async function kill(page, log, last) {
  await page.evaluate(() => { window.__metropolis.city.host.snapshot = () => new Promise(() => {}); });
  // the edit in progress: posted, and the tab closes in the same breath
  const posted = last ? await page.evaluate(last) : null;
  // with runBeforeUnload, close() does not wait for the tab to go: its 'close' event says it has
  const closed = page.waitForEvent('close', { timeout: 10000 }).then(() => true, () => false);
  await within(page.close({ runBeforeUnload: true }), 10000);
  log('closed', await closed, page.isClosed(), 'the last edit when the tab closed', posted);
  if (!page.isClosed()) throw new Error('the tab did not close');
}

async function scenario({ browser, base, log, shot }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    try { const s = JSON.parse(localStorage.getItem('metropolis.settings') ?? '{}'); if (s.quality !== 'low') localStorage.setItem('metropolis.settings', JSON.stringify({ ...s, quality: 'low' })); } catch { /* storage blocked */ }
  });
  const errors = [], results = [];
  const watch = (page, tag) => { page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`)); page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); }); };
  const check = (name, ok, detail) => { results.push([name, ok]); log('CHECK', name, ok ? 'PASS' : 'FAIL', detail ?? ''); };
  const offer = async (page) => {
    await page.getByText('Recover unsaved progress?').waitFor({ timeout: 60000 }).catch(() => undefined);
    const dialog = await page.locator('.recover-body').innerText().catch(() => '');
    return { count: await page.getByText('Recover unsaved progress?').count(), text: dialog.replace(/\s+/g, ' ').trim() };
  };

  // ---- 1. a journal alone, the tab closed mid-edit
  const p1 = await context.newPage(); watch(p1, 'p1');
  await p1.goto(`${base}/?quickstart=1&size=small&seed=7&simworker=1${Q}`);
  await waitCity(p1);
  const r1 = await dryRect(p1, 0);
  const entry = await probe(p1, [r1]);
  const key = `quickstart:${entry.tile}`;
  const record0 = await idb(p1, 'cities', key);
  log('1 entered', entry, 'rect', r1, 'record', record0);
  check('1 the city runs on a worker with its own IndexedDB', entry.kind === 'worker' && entry.persistence === 'worker-idb' && entry.recovery, entry);
  // inside the app's 30 s periodic window (stamped), so that only the unload writes count
  await p1.evaluate(() => { window.__metropolis.city.lastSnap = Date.now(); const h = window.__metropolis.city.host; h.act('setTax', [0, 13]); h.act('setFunding', ['fire', 130]); });
  await p1.waitForTimeout(1500);
  await shot(p1, '11-journal-before-close');
  await kill(p1, log, `(() => { const h = window.__metropolis.city.host; h.act('zone', [${JSON.stringify(r1)}, 1]); return { pending: h.pending.count, zoned: (() => { const st = h.state, r = ${JSON.stringify(r1)}; let n = 0; for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) if (st.zone[z * st.size + x] === 1) n++; return n; })() }; })()`);

  const p2 = await context.newPage(); watch(p2, 'p2');
  await p2.goto(`${base}/?simworker=1${Q}`);
  await p2.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const o1 = await offer(p2);
  const j1 = await idb(p2, 'recovery', key + '#journal');
  log('1 title: dialog', o1, 'LS', await slot(p2), 'IDB journal', j1, 'IDB snapshot', await idb(p2, 'recovery', key));
  await shot(p2, '12-journal-offered');
  check('1 the title offers the journal', o1.count === 1 && /record of your edits since the last save/.test(o1.text) && j1?.ops?.filter((o) => (o?.op ?? o?.[1]) !== 'setOnboarding').length === 3 /* T037a: a guided city also journals its guide record */, { o1, j1 });
  await p2.getByRole('button', { name: 'Recover' }).click();
  await waitCity(p2);
  const back = await probe(p2, [r1]);
  const record1 = await idb(p2, 'cities', key), j1after = await idb(p2, 'recovery', key + '#journal');
  log('1 recovered', back, 'record', record1, 'IDB journal', j1after);
  await shot(p2, '13-journal-restored');
  check('1 the worker replays it: the edit made as the tab closed is back', back.taxR1 === 13 && back.fire === 130 && back.zoned[0] > 0, back);
  check('1 and saves before its Ready (the journal is gone, the city reads as saved)', back.persistence === 'worker-idb' && record1?.savedAt > record0.savedAt && record1.taxR1 === 13 && j1after === null && back.changes === 0, { record1, j1after, changes: back.changes });

  // ---- 2. a worker snapshot, then edits only the journal holds (the boot save left the city clean: an edit first)
  await p2.evaluate(() => { window.__metropolis.city.lastSnap = Date.now(); window.__metropolis.city.host.act('setFunding', ['police', 120]); });
  await p2.waitForTimeout(1500);
  await p2.evaluate(() => window.__metropolis.snapshotNow('hidden'));
  await p2.waitForTimeout(3000);
  const snapIdb = await idb(p2, 'recovery', key);
  log('2 after snapshot: LS', await slot(p2), 'IDB snapshot (the worker wrote it)', snapIdb);
  check('2 the worker stored its snapshot', snapIdb?.marker?.baseSavedAt === record1?.savedAt, snapIdb);
  const r2 = await dryRect(p2, 8);
  await p2.evaluate((r) => { window.__metropolis.city.lastSnap = Date.now(); const h = window.__metropolis.city.host; h.act('setTax', [0, 15]); h.act('zone', [r, 1]); }, r2);
  await p2.waitForTimeout(1500);
  const edited2 = await probe(p2, [r1, r2]);
  log('2 edited', edited2, 'rect', r2);
  await shot(p2, '21-snapshot-then-edited');
  await kill(p2, log);

  const p3 = await context.newPage(); watch(p3, 'p3');
  await p3.goto(`${base}/?simworker=1${Q}`);
  await p3.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const o2 = await offer(p3);
  log('2 title: dialog', o2, 'IDB journal', await idb(p3, 'recovery', key + '#journal'), 'IDB snapshot', await idb(p3, 'recovery', key));
  await shot(p3, '22-snapshot-offered');
  check('2 the snapshot is offered', o2.count === 1 && /recovery snapshot/.test(o2.text), o2);
  await p3.getByRole('button', { name: 'Recover' }).click();
  await waitCity(p3);
  const restored = await probe(p3, [r1, r2]);
  log('2 recovered', restored, 'record', await idb(p3, 'cities', key), 'IDB journal', await idb(p3, 'recovery', key + '#journal'));
  await shot(p3, '23-snapshot-recovered-journal-replayed');
  check('2 the snapshot restores and its re-bound journal replays in the worker', restored.taxR1 === 15 && restored.fire === 130 && restored.police === 120 && restored.zoned[0] === back.zoned[0] && restored.zoned[1] === edited2.zoned[1] && edited2.zoned[1] > 0, restored);

  // ---- 3. the first save of the session
  await p3.evaluate(() => window.__metropolis.city.scene.save(false));
  await p3.waitForTimeout(3000);
  const journalAfter = await idb(p3, 'recovery', key + '#journal'), snapAfter = await idb(p3, 'recovery', key), lsAfter = await slot(p3), rec = await idb(p3, 'cities', key);
  log('3 after save: IDB journal', journalAfter, 'IDB snapshot', snapAfter, 'LS', lsAfter, 'record', rec);
  await shot(p3, '31-saved');
  check('3 the first save holds the edits and leaves no recovery record', journalAfter === null && snapAfter === null && lsAfter.marker === null && rec?.taxR1 === 15, rec);

  log('page errors', errors);
  check('4 no page or console errors', errors.length === 0, errors);
  await context.close();
  if (results.some(([, ok]) => !ok)) throw new Error('failed: ' + results.filter(([, ok]) => !ok).map(([n]) => n).join('; '));
}

// ---- the runner
const opt = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const wt = process.cwd(), out = path.resolve(opt('out', 'shots/qa-journal/out')), portArg = opt('port', '5639');
const require = createRequire(path.join(wt, 'package.json'));
const { build, preview } = require('vite');
const { chromium } = require('playwright');
fs.mkdirSync(out, { recursive: true });
const port = Number(portArg ?? 5639);
const logFile = path.join(out, 'log.txt');
fs.writeFileSync(logFile, '');
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); console.log(s); fs.appendFileSync(logFile, s + '\n'); };
const work = path.dirname(path.resolve(out));
const outDir = path.join(work, 'dist'), cacheDir = path.join(work, 'vitecache');
let server, browser;
const cleanup = async () => { try { await browser?.close(); } catch {} try { await server?.close(); } catch {} };
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(143); });
const timer = setTimeout(async () => { log('HARNESS TIMEOUT'); await cleanup(); process.exit(124); }, Number(process.env.HARNESS_TIMEOUT_MS ?? 1500000));
try {
  if (!process.env.SKIP_BUILD) {
    const t0 = Date.now();
    await build({ root: wt, configFile: path.join(wt, 'vite.config.ts'), cacheDir, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
    log('built', outDir, `${Date.now() - t0} ms`);
  }
  server = await preview({ root: wt, configFile: path.join(wt, 'vite.config.ts'), cacheDir, logLevel: 'warn', build: { outDir },
    preview: { port, strictPort: true, host: '127.0.0.1' } });
  const base = `http://127.0.0.1:${port}`;
  log('server', base);
  browser = await chromium.launch();
  const shot = async (page, name) => { const f = path.join(out, name + '.png'); await page.screenshot({ path: f, timeout: 60000 }); log('shot', f); return f; };
  await scenario({ browser, base, out, log, shot });
  log('SCENARIO DONE');
} catch (e) {
  log('SCENARIO FAILED', String(e?.stack ?? e));
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await cleanup();
}
