#!/usr/bin/env node
/**
 * Browser exit-leak gate (close-out c4, T016): play a city, query one growable building, Esc, Save & exit to region,
 * then count the live CityScene / CityState objects after a forced GC. Both must be 0 at +3 s on every cycle.
 * See tools/leakprobe/README.md.
 *
 *   node tools/leakprobe/leakprobe.mjs --city <x.region.metropolis> [--mode fresh|persistent] [--cycles 3]
 *        [--size 1280x720] [--hostile] [--census] [--out result.json] [--port 5310]
 *
 * --mode fresh       one browser launched by Playwright for the run (a fresh profile)
 * --mode persistent  one Chromium started with a remote-debugging port and its own user-data dir, kept for the whole
 *                    run; every step connects over CDP and disconnects again (the T013 playtester's setup)
 * --hostile          run each cycle the way the T013 playtester's harness did (Playwright locator calls on the inspector's
 *                    WHY? header and the pause menu, a getByText exit): that harness keeps a node of the exited city's
 *                    DOM alive, and the city must still be freed (it was not before close-out c4)
 * --census           list the event listeners left on every detached DOM tree after each exit
 *
 * Input is real mouse / keyboard at coordinates (page.mouse / page.keyboard). page.evaluate only reads positions and
 * state (plain values). Counts come from CDP with an objectGroup on every call that returns objects, released after use
 * (a held handle would pin what it points to: the T013 audit's probe pitfall).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes(`--${k}`);
const CITY = arg('city');
const MODE = arg('mode', 'fresh');
const CYCLES = +arg('cycles', '3');
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const HOSTILE = flag('hostile');
const CENSUS = flag('census');
const OUT = arg('out');
const PORT = +arg('port', '5310');
const CDP_PORT = PORT + 1000;
const URL = `http://127.0.0.1:${PORT}/`;
const GPU = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'];
if (!CITY) { console.error('usage: node tools/leakprobe/leakprobe.mjs --city <x.region.metropolis> [--mode fresh|persistent] ...'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- dev server (its own, killed at the end)
async function startVite() {
  // (a server already on the port would be another tree's code: refuse it rather than measure the wrong build)
  try { await fetch(URL); throw new Error(`port ${PORT} is already in use: stop that server or pass --port`); } catch (e) { if (String(e.message).startsWith('port ')) throw e; }
  // (node runs vite directly: no shell or npx in between, so killing this pid stops the server)
  const p = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    if (p.exitCode !== null) throw new Error(`vite exited with ${p.exitCode}`);
    try { if ((await fetch(URL)).ok) return p; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('vite did not start');
}
function killTree(p) {
  if (!p || p.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/F', '/T', '/PID', String(p.pid)], { stdio: 'ignore' });
  else p.kill('SIGTERM');
}

// ---------------------------------------------------------------- browsers
let launched = null; // fresh: the Playwright browser; persistent: the spawned Chromium process
let profileDir = null;
async function openBrowser() {
  if (MODE === 'fresh') {
    launched = await chromium.launch({ headless: true, args: GPU });
    const page = await launched.newPage({ viewport: { width: W, height: H } });
    return { page, done: async () => {} };
  }
  if (!launched) {
    profileDir = mkdtempSync(join(tmpdir(), 'leakprobe-'));
    launched = spawn(chromium.executablePath(), ['--headless=new', ...GPU, `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
      `--window-size=${W},${H}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break; } catch { /* starting */ } await sleep(250); }
  }
  return connectStep();
}
/** persistent mode: connect for one step, disconnect afterwards (the browser and its page stay) */
async function connectStep() {
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const ctx = b.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith(URL)) ?? ctx.pages()[0] ?? (await ctx.newPage());
  return { page, done: async () => { await b.close(); } };
}

// ---------------------------------------------------------------- CDP counts (raw socket: no Playwright session involved)
async function pageSocket() {
  const port = MODE === 'fresh' ? null : CDP_PORT;
  if (port === null) return null;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const t = list.find((x) => x.type === 'page' && x.url.startsWith(URL));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  return { send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }), close: () => ws.close() };
}
async function counts(page) {
  // fresh mode: a Playwright CDP session (objectGroup on every call, released); persistent: a raw socket
  let cdp = await pageSocket(), session = null;
  if (!cdp) { session = await page.context().newCDPSession(page); cdp = { send: (m, p) => session.send(m, p), close: () => session.detach().catch(() => {}) }; }
  const G = 'leakprobe';
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
    const out = {};
    for (const [name, expr] of [['CityScene', "import('/src/game/CityScene.ts').then((m) => m.CityScene.prototype)"], ['CityState', "import('/src/sim/CityState.ts').then((m) => m.CityState.prototype)"], ['HTMLCanvasElement', 'HTMLCanvasElement.prototype']]) {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, objectGroup: G, awaitPromise: true });
      const q = await cdp.send('Runtime.queryObjects', { prototypeObjectId: r.result.objectId, objectGroup: G });
      const n = await cdp.send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true, objectGroup: G });
      out[name] = n.result.value;
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup: G });
    }
    const hu = await cdp.send('Runtime.getHeapUsage');
    out.heapMB = +(hu.usedSize / 1048576).toFixed(1);
    if (CENSUS) out.detached = await census(cdp, G);
    return out;
  } finally {
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: G }).catch(() => {});
    cdp.close();
  }
}
/** listeners left on each detached DOM tree (by type), and how many nodes JS still retains in it */
async function census(cdp, G) {
  await cdp.send('DOM.enable');
  const det = await cdp.send('DOM.getDetachedDomNodes').catch(() => ({ detachedNodes: [] }));
  const trees = [];
  for (const d of det.detachedNodes ?? []) {
    let types = {};
    try {
      const r = await cdp.send('DOM.resolveNode', { backendNodeId: d.treeNode.backendNodeId, objectGroup: G });
      const l = await cdp.send('DOMDebugger.getEventListeners', { objectId: r.object.objectId, depth: -1, pierce: true });
      for (const x of l.listeners) types[x.type] = (types[x.type] ?? 0) + 1;
    } catch (e) { types = { error: String(e.message).slice(0, 60) }; }
    trees.push({ root: `${d.treeNode.nodeName.toLowerCase()}.${(d.treeNode.attributes ?? []).join(' ').slice(0, 40)}`, retained: (d.retainedNodeIds ?? []).length, listeners: types });
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: G });
  return trees;
}

// ---------------------------------------------------------------- real input helpers (positions read as plain values)
async function centreOf(page, sel, text) {
  return page.evaluate(([sel, text]) => {
    const e = [...document.querySelectorAll(sel)].find((x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (!text || (x.textContent ?? '').trim().startsWith(text)); });
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return [b.x + b.width / 2, b.y + b.height / 2];
  }, [sel, text]);
}
async function clickAt(page, p) { await page.mouse.move(p[0], p[1], { steps: 4 }); await page.mouse.down(); await sleep(60); await page.mouse.up(); }
async function clickText(page, sel, text, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    const p = await centreOf(page, sel, text);
    if (p) { await clickAt(page, p); return; }
    if (Date.now() - t0 > timeout) throw new Error(`no visible ${sel} "${text}"`);
    await sleep(250);
  }
}
const inCity = (page) => page.evaluate(() => { const a = window.__metropolis; return !!(a && a.city && a.city.scene && a.city.scene.worldView && !a.city.scene.worldView.isNull); });
const atRegion = (page) => page.evaluate(() => !window.__metropolis?.city && !!document.querySelector('.rc-item'));
async function until(page, fn, ms, what) { const t0 = Date.now(); while (!(await fn(page))) { if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`); await sleep(300); } }

// ---------------------------------------------------------------- steps
async function importAndPlay(page) {
  await page.goto(URL);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await clickText(page, 'button', 'Load Region');
  await sleep(600);
  const fc = page.waitForEvent('filechooser');
  await clickText(page, 'button', 'Import file');
  await (await fc).setFiles(resolve(CITY));
  await until(page, async (p) => !!(await centreOf(p, '.region-row button', 'Open')), 60000, 'region list');
  await clickText(page, '.region-row button', 'Open');
  await until(page, async (p) => !!(await centreOf(p, '.rc-item')), 60000, 'region screen');
  await play(page);
}
async function play(page) {
  await clickText(page, '.rc-item');
  await sleep(600);
  await clickText(page, 'button', 'Play');
  await until(page, inCity, 180000, 'city view');
  await sleep(3000);
}
async function queryGrowable(page) {
  await page.mouse.move(W / 2, H / 2);
  await page.keyboard.press('v');
  await sleep(300);
  // a growable building's screen position, read with the scene's own pick (plain numbers come back)
  const t = await page.evaluate(async ([W, H]) => {
    const cat = await import('/src/sim/catalog.ts');
    const sc = window.__metropolis.city.scene, S = sc.sim.state;
    for (let y = 120; y < H - 160; y += 23) for (let x = 60; x < W - 280; x += 23) {
      let id = null; try { id = sc.objects.pickBuilding(x, y); } catch { /* none */ }
      const b = id == null ? null : S.buildings.get(id);
      const d = b && b.built >= 1 ? cat.getDef(b.def) : null;
      if (d && d.category === 'growable') return { x, y, name: d.name };
    }
    return null;
  }, [W, H]);
  if (!t) throw new Error('no growable building on screen');
  await clickAt(page, [t.x, t.y]);
  await sleep(900);
  await page.keyboard.press('Escape');
  await sleep(300);
  return t.name;
}
/**
 * --hostile: the T013 playtester's cycle (s02_cycle.js, ACT=q, one growable) step for step, on one connection: the game
 * paused for the session, Playwright locator calls on the inspector (its section count, the WHY? header: count,
 * getAttribute, boundingBox), a screenshot, locator-checked Escapes, then unpause and a getByText exit. A harness like
 * this keeps a node of the city's DOM alive; the city must still be freed.
 */
async function hostileCycle(page) {
  await page.mouse.move(W / 2, H / 2);
  await page.keyboard.press(' ');
  await sleep(500);
  await page.keyboard.press('v');
  await sleep(300);
  // (its target: the middle one of the first residential growable group seen on screen, as that script chose)
  const t = await page.evaluate(async ([W, H]) => {
    const cat = await import('/src/sim/catalog.ts');
    const sc = window.__metropolis.city.scene, S = sc.sim.state;
    const found = {};
    for (let y = 90; y < H - 120; y += 23) for (let x = 40; x < W - 220; x += 23) {
      let id = null; try { id = sc.objects.pickBuilding(x, y); } catch { /* none */ }
      const b = id == null ? null : S.buildings.get(id);
      const d = b && b.built >= 1 ? cat.getDef(b.def) : null;
      if (!d || d.category !== 'growable') continue;
      (found['growable:' + (d.zones ? d.zones[0] : '')] ??= []).push({ x, y, name: d.name });
    }
    const k = Object.keys(found).find((key) => /^growable:[123]$/.test(key)) ?? Object.keys(found)[0];
    return k ? found[k][Math.floor(found[k].length / 2)] : null;
  }, [W, H]);
  if (!t) throw new Error('no growable building on screen');
  await clickAt(page, [t.x, t.y]);
  await sleep(900);
  await page.locator('.panel .ins-sec-h').count();
  const why = page.locator('.ins-sec-h', { hasText: 'Why?' }).filter({ visible: true }).first();
  if (await why.count()) {
    if ((await why.getAttribute('aria-expanded')) !== 'true') { const b = await why.boundingBox(); await clickAt(page, [b.x + b.width / 2, b.y + b.height / 2]); await sleep(500); }
  }
  await page.screenshot();
  for (let i = 0; i < 2; i++) {
    if (await page.locator('text=Save & exit to region').isVisible().catch(() => false)) { await page.keyboard.press('Escape'); break; }
    await page.keyboard.press('Escape');
    await sleep(150);
  }
  await page.keyboard.press(' ');
  await sleep(1500);
  await page.mouse.move(W / 2, H / 2);
  await page.keyboard.press('Escape');
  await sleep(600);
  if (!(await page.locator('text=Save & exit to region').isVisible())) { await page.keyboard.press('Escape'); await sleep(600); }
  const ib = await page.getByText('Save & exit to region', { exact: true }).first().boundingBox();
  await clickAt(page, [ib.x + ib.width / 2, ib.y + ib.height / 2]);
  await page.waitForFunction(() => !window.__metropolis.city, null, { timeout: 120000 });
  await page.locator('.rc-item').first().waitFor({ timeout: 60000 });
  await sleep(2500);
  await page.screenshot();
  return t.name;
}
async function saveAndExit(page) {
  await page.mouse.move(W / 2, H / 2);
  for (let i = 0; i < 4 && !(await centreOf(page, 'button, .pm-item, [role=menuitem], div', 'Save & exit to region')); i++) { await page.keyboard.press('Escape'); await sleep(500); }
  const p = await page.evaluate(() => {
    const e = [...document.querySelectorAll('button, .pm-item, [role=menuitem], div')].find((x) => x.children.length < 4 && /^\s*Save & exit to region/.test(x.textContent ?? '') && x.getBoundingClientRect().width > 0 && x.getBoundingClientRect().width < 600);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return [b.x + b.width / 2, b.y + b.height / 2];
  });
  if (!p) throw new Error('no Save & exit to region');
  await clickAt(page, p);
  await until(page, atRegion, 120000, 'region screen after exit');
}

// ---------------------------------------------------------------- run
const result = { city: CITY, mode: MODE, hostile: HOSTILE, size: [W, H], cycles: [], pass: false };
let vite = null;
try {
  vite = await startVite();
  log('vite', URL, 'mode', MODE, HOSTILE ? '(hostile)' : '');
  let step = await openBrowser();
  result.browser = MODE === 'fresh' ? launched.version() : (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()).Browser;
  await importAndPlay(step.page);
  for (let c = 1; c <= CYCLES; c++) {
    if (c > 1) { if (MODE === 'persistent') { await step.done(); step = await connectStep(); } await play(step.page); }
    if (MODE === 'persistent') { await step.done(); step = await connectStep(); }
    let queried;
    if (HOSTILE) queried = await hostileCycle(step.page);
    else {
      queried = await queryGrowable(step.page);
      if (MODE === 'persistent') { await step.done(); step = await connectStep(); }
      await saveAndExit(step.page);
    }
    if (MODE === 'persistent') await step.done();
    await sleep(3000);
    const at3 = await counts(step.page);
    log(`cycle ${c}: queried ${queried}; at +3 s CityScene ${at3.CityScene}, CityState ${at3.CityState}, canvases ${at3.HTMLCanvasElement}, heap ${at3.heapMB} MB`);
    result.cycles.push({ c, queried, at3 });
    if (MODE === 'persistent') step = await connectStep();
  }
  result.pass = result.cycles.length === CYCLES && result.cycles.every((x) => x.at3.CityScene === 0 && x.at3.CityState === 0);
} catch (e) {
  result.error = String(e?.stack ?? e);
  log('ERROR', result.error);
} finally {
  if (MODE === 'fresh') await launched?.close().catch(() => {});
  else killTree(launched);
  killTree(vite);
  if (profileDir) { await sleep(1000); try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* still locked */ } }
}
if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 1));
log(result.pass ? 'PASS' : 'FAIL', JSON.stringify(result.cycles.map((x) => [x.at3.CityScene, x.at3.CityState])));
process.exit(result.pass ? 0 : 1);
