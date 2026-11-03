#!/usr/bin/env node
/**
 * W1.2's browser acceptance (docs/WORKER_DESIGN.md §5.4 and §6 row W1.2): a real simulation worker in Playwright's
 * Chromium, against the production build by default. One browser and one server, both stopped on any exit.
 *
 *   node tools/qa-worker.mjs [--dev] [--port 5535] [--out <dir>] [--size 256] [--quality low] [--freeze-ms 15000]
 *                            [--soak-min 0] [--simwasm <flag>]
 *
 * Chromium runs with --js-flags=--allow-natives-syntax and every page with &simdev=1, so the worker isolate makes its
 * protector probe first thing (src/worker/protectorProbe.ts) and host.debugVerify() reads it. --simwasm wasm
 * adds &simwasm=wasm: the kernels then load in the worker (WASM_PLAN §7.8's worker mode), and boot checks they did.
 *
 * Steps, each logged PASS or FAIL (exit code 1 on any FAIL):
 *   control   the probe's positive and negative controls in this browser, in a bare module worker under a Chrome trace of
 *             V8.InvalidateProtector: the probe must deoptimize on a detach for its "intact" to mean anything. Where it
 *             does not (Chromium 153: its V8 has no ArrayBufferDetaching protector; a protector it does have, ArraySpecies,
 *             shows the technique works), each protector step checks that the worker made its probe and logs a NOTE
 *   boot      ?quickstart=1&simworker=1 reaches __ready on a worker host (the worker is its own script); the worker's
 *             protector probe is intact (§5.4); with --simwasm, blur runs on wasm in the worker and its memory never grew
 *   tools     through the real tools (pointer events on the canvas), each acked in the replica with nothing pending: a
 *             road, a zone, a power line, a park plopped, part of the zone dezoned, part of the road bulldozed, trees
 *             brushed, and a held level brush that reaches flat: one release sound, no error sound, no toast (§2.2, R4)
 *   play      days advance at speed 3
 *   verify    paused, the worker's exact digest equals the replica's (host.verify(): query 'verify')
 *   save      Ctrl+S, then the stored record holds the road and the zone
 *   load      a reload, the title's Continue: the same city on a new worker, which continues
 *   freeze    CDP Page.setWebLifecycleState frozen for 15 s, then active: no crash path, days advance (1 s: reported),
 *             the worker's protector still intact
 *   hidden    a hidden tab still saves (main acks outside ticks)
 *   crash     a fatal in the worker: the crash dialog; "Restart from autosave" boots a new worker from the save
 *   recover   an edit after the save, a worker snapshot (R14: stored by main), a fatal: "Recover unsaved progress"
 *             restores the snapshot and boots a new worker with the edit
 *   watchdog  a worker that stops posting: 10 visible seconds, the crash dialog; "Continue on the main thread"
 *   fallback  a worker script that fails to load: the city boots on the main thread, with one toast
 *   soak      (--soak-min N) N minutes at speed 3 after the freeze: the worker stays alive, the days keep coming, and its
 *             protector is intact at the end (§6 W1.2: after 10 min)
 *   region    ?newcity=1: the region screen prefetches the worker's chunk and pre-spawns one worker; Found City boots
 *             the new city on that worker (no second one), paused and saved, and its days advance (§4.1 step 1)
 *   console   no console errors outside the steps that crash on purpose
 * Measured, not gated: boot time, action latency (post to ack applied, p50 / p95 / p99), and the page's own protector
 * probe (lodBuilder's transfer list invalidates it until S0's J0 lands). Not covered: W1.3's journal check. WebGL runs on
 * SwiftShader: function, not GPU timings.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const DEV = flag('dev');
const PORT = Number(opt('port', 5535));
const OUT = path.resolve(opt('out', path.join(os.tmpdir(), 'qa-worker')));
const SIZE = opt('size', '256');
const SIMWASM = opt('simwasm', null);
/** every page: the worker's dev checks and its protector probe in the production build; the kernels' flag if given */
const Q = `&simdev=1${SIMWASM ? `&simwasm=${encodeURIComponent(SIMWASM)}` : ''}`;
const FREEZE_MS = Number(opt('freeze-ms', 15000));
const SOAK_MIN = Number(opt('soak-min', 0));
/** the app's graphics quality: SwiftShader draws 'high' at a frame every few seconds, and ticks follow rAF */
const QUALITY = opt('quality', 'low');
const READY_MS = 300000;

fs.mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, 'log.txt');
fs.writeFileSync(logFile, '');
const log = (...a) => {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log(s); fs.appendFileSync(logFile, s + '\n');
};
const results = [];
const check = (step, ok, detail = '') => { results.push({ step, ok }); log(ok ? 'PASS' : 'FAIL', step, detail); };

let server, browser;
const cleanup = async () => {
  try { await browser?.close(); } catch { /* closed */ }
  try { await server?.close?.(); } catch { /* closed */ }
};
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(143); });
const timer = setTimeout(async () => { log('QA TIMEOUT'); await cleanup(); process.exit(124); }, Number(process.env.QA_TIMEOUT_MS ?? (90 + SOAK_MIN) * 60000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(page, name) {
  const f = path.join(OUT, `${name}.png`);
  // a 256² city on SwiftShader can take tens of seconds for the frame a screenshot waits for
  try { await page.screenshot({ path: f, timeout: 180000 }); log('shot', f); } catch (e) { log('shot failed', name, String(e).slice(0, 200)); }
  return f;
}

// ---- page helpers (all run in the page: window.__metropolis is the App)
const hostInfo = (page) => page.evaluate(() => {
  const c = window.__metropolis.city, h = c?.host;
  if (!h) return null;
  const st = h.state;
  let roads = 0, zoned = 0;
  for (let i = 0; i < st.network.length; i++) { if (st.network[i]) roads++; if (st.zone[i]) zoned++; }
  return { kind: h.kind, disposed: !!h.isDisposed, day: st.day, speed: h.speed, roads, zoned, funds: st.funds,
    applied: h.replica?.applied ?? null, pending: h.pending?.count ?? 0, crashed: !!c.crashed };
});
const waitHost = (page, test, arg, ms = 60000) => page.waitForFunction(test, arg, { timeout: ms, polling: 100 });
const crashDialog = (page) => page.evaluate(() => [...document.querySelectorAll('.modal h2')].some((e) => e.textContent === 'The simulation stopped'));
/** the crash dialog has finished fading in (SwiftShader composites slowly): no animation left on it or its backdrop */
async function settleDialog(page) {
  await page.waitForFunction(() => {
    const m = [...document.querySelectorAll('.modal')].find((e) => e.querySelector('h2')?.textContent === 'The simulation stopped');
    if (!m) return false;
    const busy = document.getAnimations().some((a) => { const t = a.effect?.target; return t instanceof Element && (t.contains(m) || m.contains(t)); });
    return !busy && Number(getComputedStyle(m).opacity) === 1;
  }, null, { timeout: 30000, polling: 250 }).catch(() => log('the crash dialog was still animating after 30 s'));
  await sleep(500);
}
/**
 * The probe's controls (risk 7), in a bare module worker: the probe made as src/worker/protectorProbe.ts makes it, read
 * twice (negative control), then a buffer detached (positive control); beside it, a TurboFan function that depends on the
 * ArraySpecies protector, which is then invalidated (the technique itself). Chrome's trace records V8.InvalidateProtector
 * on the thread that invalidated one, so it shows which protectors this V8 has.
 */
const CONTROL_WORKER = `
  const tf = new Function('f', 'return %ActiveTierIsTurbofan(f);');
  let fin = null;
  try { fin = new Function('%FinalizeOptimization();'); } catch { /* calls alone */ }
  const warm = (f, a) => { for (let i = 0; i < 1 << 20 && !tf(f); i++) { f(a); if ((i & 1023) === 1023 && fin) fin(); } return tf(f); };
  const ta = new Float32Array(64);
  const probe = new Function('a', 'let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s;');
  const made = warm(probe, ta);
  for (let i = 0; i < 1000; i++) probe(ta);
  const before = tf(probe);
  const b = new ArrayBuffer(8); structuredClone(b, { transfer: [b] });
  probe(ta);
  const afterDetach = tf(probe);
  const arr = [1, 2, 3, 4];
  const mapper = new Function('a', 'return a.map((x) => x + 1).length;');
  const mapperMade = warm(mapper, arr);
  Object.defineProperty(Array.prototype, 'constructor', { value: function NotArray() {}, configurable: true, writable: true });
  mapper(arr);
  postMessage({ made, before, detached: b.byteLength === 0, afterDetach, mapperMade, mapperAfterSpecies: tf(mapper) });`;
let control = { observable: false };
async function protectorControl() {
  const page = await browser.newPage();
  try {
    await page.route('http://qa-control.test/**', (route) => (new URL(route.request().url()).pathname === '/w.js'
      ? route.fulfill({ contentType: 'text/javascript', body: CONTROL_WORKER })
      : route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>protector control</title>' })));
    await page.goto('http://qa-control.test/');
    await browser.startTracing(page, { categories: ['v8', '__metadata'] });
    const w = await page.evaluate(() => new Promise((ok) => {
      const w = new Worker('/w.js', { type: 'module', name: 'protector-control' });
      w.onmessage = (e) => { ok(e.data); w.terminate(); };
      w.onerror = (e) => ok({ error: e.message || 'error event' });
      setTimeout(() => ok({ error: 'timeout' }), 60000);
    }));
    const trace = JSON.parse((await browser.stopTracing()).toString());
    const events = trace.traceEvents ?? trace, threads = new Map();
    for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args?.name);
    const invalidated = events.filter((e) => e.name === 'V8.InvalidateProtector').map((e) => `${e.args?.['protector-name']} (${threads.get(`${e.pid}:${e.tid}`) ?? 'thread?'})`);
    return { ...w, invalidated, technique: w.mapperMade === true && w.mapperAfterSpecies === false,
      observable: w.made === true && w.before === true && w.detached === true && w.afterDetach === false };
  } finally { await page.close(); }
}
/** the worker isolate's protector probe and kernels (debug.verify), and the page's own probe (reported only) */
async function protector(page, when) {
  const r = await page.evaluate(async () => {
    const w = await window.__metropolis.city.host.debugVerify();
    return { ...w, page: window.__qaPageProbe ? window.__qaPageProbe() : null };
  }).catch((e) => ({ error: String(e) }));
  if (control.observable) check(`protector: the worker's probe intact ${when}`, r.protector === true, JSON.stringify(r));
  else {
    // the control: a detach deoptimizes nothing in this V8, so the probe reads intact whatever ran. What is checked is
    // that the worker isolate made its probe (natives syntax reached it, the dev flag did, and it took TurboFan code)
    check(`protector: the worker made its probe ${when}`, r.protector === true || r.protector === false, JSON.stringify(r));
    log('NOTE', `protector ${when}: not observable in this browser (the control: a detach does not deoptimize the probe), so ${JSON.stringify(r.protector)} is not evidence`);
  }
  return r;
}
/** counts in the replica: what the tools change */
const counts = (page) => page.evaluate(() => {
  const st = window.__metropolis.city.host.state, h = window.__metropolis.city.host;
  let roads = 0, zoned = 0, power = 0, trees = 0;
  for (let i = 0; i < st.network.length; i++) { if (st.network[i]) roads++; if (st.zone[i]) zoned++; if (st.powerLines[i]) power++; trees += st.trees[i]; }
  let parks = 0;
  for (const b of st.buildings.values()) if (b.defId === 'park_small') parks++;
  return { roads, zoned, power, trees, parks, buildings: st.buildings.size, pending: h.pending?.count ?? 0 };
});
/** acked: the replica's count moved the expected way and nothing is pending */
const settled = (page, key, from, dir) => waitHost(page, ([k, n, d]) => {
  const st = window.__metropolis.city.host.state, h = window.__metropolis.city.host;
  let v = 0;
  if (k === 'parks') { for (const b of st.buildings.values()) if (b.defId === 'park_small') v++; }
  else { const a = k === 'roads' ? st.network : k === 'zoned' ? st.zone : k === 'power' ? st.powerLines : st.trees; for (let i = 0; i < a.length; i++) v += k === 'trees' ? a[i] : a[i] ? 1 : 0; }
  return (d > 0 ? v > n : v < n) && (h.pending?.count ?? 0) === 0;
}, [key, from, dir], 60000).then(() => true, () => false);

/** screen points of the canvas whose picked cells are buildable: a row for the road, a rectangle below it to zone */
async function dragPlan(page) {
  return page.evaluate(() => {
    const scene = window.__metropolis.city.scene, w = scene.world, canvas = scene.canvas, r = canvas.getBoundingClientRect();
    const st = scene.host.state, cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pick = (x, y) => { const c = w.pickCell(x, y); return c ? { x: c.x, z: c.z } : null; };
    return { a: [cx - 160, cy - 40], b: [cx + 160, cy - 40], z0: [cx - 120, cy + 10], z1: [cx + 100, cy + 70],
      cells: [pick(cx - 160, cy - 40), pick(cx + 160, cy - 40)], size: st.size };
  });
}
async function drag(page, from, to) {
  await page.mouse.move(from[0], from[1], { steps: 4 });
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 });
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await sleep(150);
  await page.mouse.up();
}
async function selectTool(page, id) {
  const ok = await page.evaluate((tool) => window.__metropolis.city.scene.tools.select(tool), id);
  if (!ok) throw new Error(`tool ${id} not selected`);
}
/** the App's city is up: its scene's views are ready and the save indicator runs (the end of App.enterCity) */
const cityUp = (page, kind) => page.waitForFunction((k) => {
  const c = window.__metropolis.city;
  return !!c?.scene && !!c.status && !c.crashed && !c.host.isDisposed && (!k || c.host.kind === k);
}, kind ?? null, { timeout: READY_MS, polling: 250 });
async function enterCity(page, url, what) {
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: READY_MS, polling: 250 });
  await cityUp(page);
  log(what, 'ready after', Date.now() - t0, 'ms');
  return Date.now() - t0;
}
async function continueFromTitle(page, base) {
  const t0 = Date.now();
  await page.goto(`${base}/?simworker=1${Q}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: READY_MS, polling: 250 });
  await page.getByText('Continue', { exact: true }).first().click();
  await cityUp(page);
  log('continue: city after', Date.now() - t0, 'ms');
}
/** an unexpected crash dialog during the normal steps: what the watchdog saw, then stop (the later steps need a city) */
async function noCrash(page, step) {
  if (!(await crashDialog(page))) return;
  const diag = await page.evaluate(() => ({ long: window.__qaLong, life: (() => { const l = window.__metropolis.city?.host?.link?.life; return l ? { phase: l.phase, elapsed: l.elapsed } : null; })() }));
  throw new Error(`the crash dialog opened during ${step}: ${JSON.stringify(diag)}`);
}
async function setSpeed(page, n) {
  await page.keyboard.press(`Digit${n}`);
}

/** §5.4: each command through the real tools (synthetic pointer events), checked by its effect in the replica */
async function tools(page) {
  // every command the tools post, with its ack (the FAIL lines show what the worker said)
  await page.evaluate(() => {
    const h = window.__metropolis.city.host, post = h.post.bind(h);
    window.__qaAcks = [];
    h.post = (op, args, o) => {
      const t = post(op, args, o), e = { op, args: JSON.stringify(args).slice(0, 80) };
      window.__qaAcks.push(e);
      t.done.then((r) => { e.ok = r?.ok ?? true; if (r?.reason) e.reason = r.reason; if (r?.cost) e.cost = r.cost; }, (err) => { e.error = String(err).slice(0, 120); });
      return t;
    };
  });
  const plan = await dragPlan(page);
  log('drag plan', plan);
  const [cx, cy] = [(plan.a[0] + plan.b[0]) / 2, plan.a[1] + 40];
  const step = async (name, tool, key, dir, act) => {
    const before = await counts(page), from = await page.evaluate(() => window.__qaAcks.length);
    await selectTool(page, tool);
    await act();
    const ok = await settled(page, key, before[key], dir);
    await page.keyboard.press('Escape');
    const after = await counts(page), acks = await page.evaluate((n) => window.__qaAcks.slice(n, n + 6), from);
    await noCrash(page, `tools: ${name}`);
    check(`tools: ${name}`, ok && after.pending === 0, JSON.stringify({ [key]: [before[key], after[key]], pending: after.pending, acks }));
    return after;
  };
  await step('a road drag', 'net:2', 'roads', 1, () => drag(page, plan.a, plan.b));
  await step('a zone drag', 'zone:1', 'zoned', 1, () => drag(page, plan.z0, plan.z1));
  await step('a power line drag', 'power', 'power', 1, () => drag(page, [cx - 120, cy - 150], [cx + 120, cy - 150]));
  await step('a park plopped where its preview is ok', 'plop:park_small', 'parks', 1, async () => {
    // the tool's own preview (PlopTool.res) on hover picks the spot: the plop is checked, not the search. Moves are
    // coalesced into the next frame (seconds apart on SwiftShader), so each candidate waits until the preview was made
    // for that very pointer; the candidates keep off the road, the zone, the power line and the brushes' ground
    let found = null;
    for (const [dx, dy] of [[-220, 40], [-200, 110], [-260, -20], [-180, 150], [-60, 150], [0, 160], [-240, -100], [-100, -100], [-300, 60], [60, 170]]) {
      const [x, y] = [cx + dx, cy + dy];
      await page.mouse.move(x, y, { steps: 3 });
      const res = await page.waitForFunction(([px, py]) => {
        const t = window.__metropolis.city.scene.tools.current, lp = t.lastPointer;
        return lp && lp.clientX === px && lp.clientY === py && t.res ? { ok: t.res.ok, reason: t.res.reason ?? null } : null;
      }, [x, y], { timeout: 60000, polling: 100 }).then((h) => h.jsonValue(), () => null);
      if (res?.ok) { found = [dx, dy]; break; }
      log('plop candidate', [dx, dy], res);
    }
    log('plop spot', found);
    await page.mouse.down(); await sleep(120); await page.mouse.up();
  });
  await step('part of the zone dezoned', 'dezone', 'zoned', -1, () => drag(page, plan.z0, [plan.z0[0] + 60, plan.z0[1] + 30]));
  await step('part of the road bulldozed', 'bulldoze', 'roads', -1, () => drag(page, [plan.b[0] - 40, plan.b[1]], plan.b));
  await step('trees brushed', 'trees', 'trees', 1, async () => {
    await page.mouse.move(cx + 230, cy + 120, { steps: 4 }); await page.mouse.down(); await sleep(1500); await page.mouse.up();
  });
  await heldBrush(page, cx, cy);
  log('long tasks so far', await page.evaluate(() => window.__qaLong));
  await shot(page, '02-tools');
}

/** §5.4 / R4: a held level brush on a slope until it reaches flat ("Nothing to change" acks after applied ones): one
 *  release sound, after the gesture settles, no error sound and no toast */
async function heldBrush(page, cx, cy) {
  // radius 1 (from 3): four corners, so the hold reaches flat in a few seconds of SwiftShader frames
  await selectTool(page, 'terra:raise');
  for (let i = 0; i < 4; i++) await page.keyboard.press('BracketLeft');
  /** a free cell's corners: Σ|h − mean| (level's target is the mean), and what its first application costs: cost rounds
   *  Σ|Δh| × 5.12, so a gentle slope levels for free, and a stroke with nothing spent ends on the error sound */
  const cellInfo = (c) => page.evaluate(([x, z]) => {
    const st = window.__metropolis.city.host.state, N1 = st.size + 1, H = st.heights, i = z * N1 + x;
    const hs = [H[i], H[i + 1], H[i + N1], H[i + N1 + 1]], mean = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
    const dev = hs.reduce((a, h) => a + Math.abs(h - mean), 0);
    return { dev, firstCost: Math.round(dev * 0.1035 * 256 * 0.02) };
  }, [c.x, c.z]);
  // a free cell C (nothing within a cell of it or of its east neighbour) and the screen points of C and of C + (1, 0)
  const spot = await page.evaluate(([x0, y0]) => {
    const scene = window.__metropolis.city.scene, st = scene.host.state, N = st.size;
    const free = (x, z) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 2; dx++) { const i = (z + dz) * N + x + dx; if (st.building[i] >= 0 || st.network[i] || st.water[i] || st.zone[i]) return false; } return true; };
    const at = new Map();
    for (let dy = 0; dy <= 220; dy += 4) for (let dx = 0; dx <= 280; dx += 4) {
      const px = x0 + dx, py = y0 - 160 + dy, c = scene.world.pickCell(px, py);
      if (c && !at.has(`${c.x},${c.z}`)) at.set(`${c.x},${c.z}`, [px, py]);
    }
    for (const [k, p] of at) {
      const [x, z] = k.split(',').map(Number), east = at.get(`${x + 1},${z}`);
      if (east && x > 2 && z > 2 && x < N - 4 && z < N - 3 && free(x, z)) return { cell: { x, z }, px: p[0], py: p[1], east };
    }
    return null;
  }, [cx + 140, cy]);
  if (!spot) { check('tools: a held level brush reaches flat: one release sound, no error, no toast', false, 'no free cell under the canvas'); return; }
  // tilt C: raise its east neighbour until C's first level application costs money (its two shared corners rise)
  let tilt = await cellInfo(spot.cell);
  if (tilt.firstCost < 1) {
    await page.mouse.move(spot.east[0], spot.east[1], { steps: 4 });
    await sleep(300);
    await page.mouse.down();
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && (tilt = await cellInfo(spot.cell)).firstCost < 1) await sleep(150);
    await page.mouse.up();
    await waitHost(page, () => (window.__metropolis.city.host.pending?.count ?? 0) === 0, null, 30000).catch(() => undefined);
    await sleep(1500);
    tilt = await cellInfo(spot.cell);
  }
  spot.tilt = tilt;
  await page.keyboard.press('Escape');
  await selectTool(page, 'terra:level');
  await page.mouse.move(spot.px, spot.py, { steps: 4 });
  await sleep(400);
  const tip = await page.evaluate(() => document.querySelector('.cursor-tip')?.textContent ?? null);
  const before = await page.evaluate(() => {
    const scene = window.__metropolis.city.scene, ctx = scene.ctx;
    window.__qaSounds = []; window.__qaUp = false; window.__qaToastsAt = window.__qaToasts.length;
    if (!ctx.__qaWrapped) {
      const sound = ctx.sound;
      ctx.sound = (n, o) => { window.__qaSounds.push({ n, o: o ?? null, up: window.__qaUp }); return sound(n, o); };
      ctx.__qaWrapped = true;
    }
    return { funds: scene.host.state.funds };
  });
  const t0 = Date.now(), ackFrom = await page.evaluate(() => window.__qaAcks.length);
  await page.mouse.down();
  // hold until an application was refused after applied ones: the brush reached flat (one application per frame at
  // most, and a 256² city on SwiftShader draws a frame every few seconds)
  const flat = await page.waitForFunction(() => { const t = window.__metropolis.city.scene.tools.current; return t.stroke?.spent > 0 && t.stroke?.failed; },
    null, { timeout: 240000, polling: 200 }).then(() => true, () => false);
  const held = Date.now() - t0;
  await page.evaluate(() => { window.__qaUp = true; });
  await page.mouse.up();
  await waitHost(page, () => (window.__metropolis.city.host.pending?.count ?? 0) === 0, null, 30000).catch(() => undefined);
  await sleep(2000); // the release sound waits for gesture.settled
  const r = await page.evaluate(() => {
    const t = window.__metropolis.city.scene.tools.current, sounds = window.__qaSounds;
    return { stroke: t.stroke, holdSounds: sounds.filter((s) => !s.up).length, release: sounds.filter((s) => s.up && !s.o).map((s) => s.n),
      toasts: window.__qaToasts.slice(window.__qaToastsAt), pending: window.__metropolis.city.host.pending?.count ?? 0, funds: window.__metropolis.city.host.state.funds };
  });
  await page.keyboard.press('Escape');
  for (let i = 0; i < 2; i++) await page.keyboard.press('BracketRight');
  const applied = await page.evaluate((n) => { const a = window.__qaAcks.slice(n).filter((e) => e.op === 'terraform'); return { n: a.length, last: a.slice(-2) }; }, ackFrom);
  const detail = JSON.stringify({ spot, tip, heldMs: held, spent: before.funds - r.funds, applications: applied, ...r });
  check('tools: a held level brush reaches flat: one release sound, no error, no toast', flat && r.release.length === 1 && r.release[0] === 'terraform' && r.toasts.length === 0 && r.pending === 0, detail);
}

async function main() {
  const vite = require('vite');
  const { chromium } = require('playwright');
  const cacheDir = path.join(OUT, 'vitecache');
  if (DEV) {
    server = await vite.createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir, logLevel: 'warn',
      server: { port: PORT, strictPort: true, host: '127.0.0.1', hmr: false } });
    await server.listen();
  } else {
    const outDir = path.join(OUT, 'dist'), t0 = Date.now();
    await vite.build({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
    const worker = fs.readdirSync(path.join(outDir, 'assets')).filter((f) => /^simWorker-.*\.js$/.test(f));
    const bytes = worker.length ? fs.statSync(path.join(outDir, 'assets', worker[0])).size : 0;
    log('build', Date.now() - t0, 'ms; worker chunk', worker[0] ?? 'missing', bytes, 'bytes');
    check('build: the worker is its own chunk', worker.length === 1, worker.join(','));
    server = await vite.preview({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir, logLevel: 'warn',
      build: { outDir }, preview: { port: PORT, strictPort: true, host: '127.0.0.1' } });
  }
  const base = `http://127.0.0.1:${PORT}`;
  log('server', base, DEV ? '(dev)' : '(production build)');
  // natives syntax: the protector probes (the worker's src/worker/protectorProbe.ts, the page's below); V8 flags reach
  // every isolate of the renderer, the worker's included
  // --trace-protector-invalidation: V8 records each protector it invalidates (the control's Chrome trace reads them)
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--allow-natives-syntax --trace-protector-invalidation'] });
  log('browser', browser.version());
  control = await protectorControl().catch((e) => ({ observable: false, error: String(e).slice(0, 200) }));
  check('control: the probe technique works in this browser (TurboFan code that depends on a protector deoptimizes when it goes)', control.technique === true && control.made === true && control.before === true, JSON.stringify(control));
  log(control.observable ? 'PASS' : 'NOTE', `control: a detach deoptimizes the probe (the worker's probe is evidence): ${control.observable}`, JSON.stringify({ invalidated: control.invalidated }));

  /** the simulation worker's script throws on load (other workers, such as the LOD builder's, are left alone) */
  const failingWorker = () => {
    const W = window.Worker;
    window.Worker = class extends W {
      constructor(url, o) { super(/simWorker/.test(String(url)) ? 'data:text/javascript,throw new Error("qa-worker: the script failed")' : url, o); }
    };
  };
  /** the App's toasts (src/region/ui/modal.ts) last a few seconds: collect each as it appears */
  const toastLog = () => {
    window.__qaToasts = [];
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('toast')) window.__qaToasts.push(n.textContent);
      }).observe(document.body, { childList: true, subtree: true });
    });
  };
  const lowQuality = (q) => {
    try { const s = JSON.parse(localStorage.getItem('metropolis.settings') ?? '{}'); if (!s.quality || s.quality !== q) localStorage.setItem('metropolis.settings', JSON.stringify({ ...s, quality: q })); } catch { /* storage blocked */ }
  };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(lowQuality, QUALITY);
  // the page's own protector probe, first thing in the page (reported, not gated: lodBuilder's transfer list, J0)
  await ctx.addInitScript(() => {
    try {
      const ta = new Float32Array(64);
      const probe = new Function('a', 'let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s;');
      // as src/worker/protectorProbe.ts: warmed up until TurboFan code takes the loop, which deoptimizes on a detach
      const turbofan = new Function('f', 'return %ActiveTierIsTurbofan(f);'), finalize = new Function('%FinalizeOptimization();');
      for (let i = 0; i < 1 << 20 && !turbofan(probe); i++) { probe(ta); if ((i & 1023) === 1023) finalize(); }
      if (!turbofan(probe)) return; // no probe: reported as null
      let intact = true;
      window.__qaPageProbe = () => { probe(ta); intact = intact && turbofan(probe); return intact; };
      setInterval(() => window.__qaPageProbe(), 1000);
    } catch { /* no natives syntax */ }
  });
  await ctx.addInitScript(toastLog);
  // main-thread long tasks (SwiftShader's blocking readbacks among them): the watchdog must not read them as a dead worker
  await ctx.addInitScript(() => {
    window.__qaLong = { n: 0, over1s: 0, max: 0 };
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { const q = window.__qaLong; q.n++; if (e.duration > 1000) q.over1s++; q.max = Math.max(q.max, e.duration); } })
        .observe({ type: 'longtask', buffered: true });
    } catch { /* no longtask timing */ }
  });
  const page = await ctx.newPage();
  // a navigation away from a city waits for the frame in progress (seconds on SwiftShader) and the unload handlers
  page.setDefaultNavigationTimeout(READY_MS);
  let expectErrors = false;
  const errors = [], workers = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (!expectErrors) errors.push(m.text());
    log(expectErrors ? 'console error (expected)' : 'console error', m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => { if (!expectErrors) errors.push(String(e)); log('pageerror', String(e).slice(0, 300)); });
  page.on('worker', (w) => { workers.push(w.url()); log('worker', w.url().split('/').pop()); });

  // ---- boot
  const bootMs = await enterCity(page, `${base}/?quickstart=1&size=${SIZE}&seed=7&simworker=1${Q}`, 'quickstart');
  let info = await hostInfo(page);
  check('boot: a worker host', info?.kind === 'worker' && workers.some((u) => /simWorker/.test(u)), JSON.stringify({ info, workers: workers.length, bootMs }));
  check('boot: a new city starts paused (the scene\'s rule, applied to the booted host)', info?.speed === 0, `speed ${info?.speed}`);
  const booted = await protector(page, 'after boot');
  if (SIMWASM) check('boot: the kernels on wasm in the worker, its memory never grown (WASM_PLAN §7.8)', booted.wasm?.state === 'ready' && booted.wasm.blur === true && booted.wasm.grows === 0, JSON.stringify(booted.wasm));
  await shot(page, '01-boot');

  // ---- tools: each command through the real tools, acked in the replica
  await tools(page);

  // ---- play
  await setSpeed(page, 3);
  const day0 = (await hostInfo(page)).day;
  await waitHost(page, (d) => window.__metropolis.city.host.state.day >= d + 40, day0, 120000).catch(() => undefined);
  info = await hostInfo(page);
  await noCrash(page, 'play');
  check('play: days advance at speed 3', info.day >= day0 + 40 && info.speed === 3, JSON.stringify({ from: day0, to: info.day, speed: info.speed }));

  // ---- latency (measured, not gated): post to ack applied, on a running city
  const lat = await page.evaluate(async () => {
    const h = window.__metropolis.city.host, out = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      const t = h.post('setTax', [0, 9 + (i % 2) * 0.5]); h.flushCommands();
      await t.done; out.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 25));
    }
    out.sort((a, b) => a - b);
    const q = (p) => out[Math.min(out.length - 1, Math.floor(p * out.length))];
    return { n: out.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: out.at(-1) };
  });
  log('latency (post to ack applied, ms, SwiftShader, not gated)', lat);

  // ---- verify on a paused city
  await setSpeed(page, 1); await page.keyboard.press('Space');
  await waitHost(page, () => window.__metropolis.city.host.speed === 0, null, 10000).catch(() => undefined);
  await sleep(1500);
  const v1 = await page.evaluate(() => window.__metropolis.city.host.verify());
  await sleep(500);
  const v2 = await page.evaluate(() => window.__metropolis.city.host.verify());
  check('verify: worker digest equals the replica\'s (paused)', v1.worker === v1.replica && v2.worker === v2.replica, JSON.stringify({ v1, v2 }));

  // ---- save
  const saveFrom = await hostInfo(page);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => /City saved/.test(document.querySelector('.save-pill')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => undefined);
  const savedRec = await page.evaluate(async () => {
    const app = window.__metropolis, c = app.city;
    return { lastSave: c.lastSave, dirty: app.isDirty(), pill: document.querySelector('.save-pill')?.textContent };
  });
  check('save: Ctrl+S through the worker, stored by main', /City saved/.test(savedRec.pill ?? '') && savedRec.dirty === false, JSON.stringify(savedRec));
  await shot(page, '03-saved');

  // ---- hidden tab: no ticks; main acks outside them, so the save still replies
  await page.evaluate(() => window.__metropolis.city.host.setSpeed(1, 'topbar'));
  await sleep(800);
  const hidden = await page.evaluate(async () => {
    const c = window.__metropolis.city, h = c.host, s = c.scene;
    // a hidden tab posts no ticks (no rAF) and no pings (the watchdog stops on visibilitychange)
    cancelAnimationFrame(s.raf);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const t0 = performance.now();
    try { const ack = await Promise.race([h.save('hidden'), new Promise((_, no) => setTimeout(() => no(new Error('no reply in 20 s')), 20000))]); return { ok: true, ms: performance.now() - t0, cmd: ack.cmd }; }
    catch (e) { return { ok: false, error: String(e) }; }
    finally {
      delete document.visibilityState; delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
      s.last = performance.now(); s.raf = requestAnimationFrame(s.loop);
    }
  });
  check('hidden: a save replies with the tab hidden', hidden.ok, JSON.stringify(hidden));
  await page.keyboard.press('Space');
  await waitHost(page, () => window.__metropolis.city.host.speed === 0, null, 10000).catch(() => undefined);
  await page.keyboard.press('Control+s');
  await sleep(2000);
  const kept = await hostInfo(page);

  // ---- load: reload into the title, Continue
  await continueFromTitle(page, base);
  info = await hostInfo(page);
  check('load: the saved city on a new worker', info?.kind === 'worker' && info.roads === kept.roads && info.zoned === kept.zoned && info.day >= saveFrom.day,
    JSON.stringify({ saved: { day: kept.day, roads: kept.roads, zoned: kept.zoned }, loaded: info }));
  await shot(page, '04-loaded');
  check('load: a saved city starts running', info?.speed === 1, `speed ${info?.speed}`);
  await setSpeed(page, 3);
  const loadDay = info.day;
  await waitHost(page, (d) => window.__metropolis.city.host.state.day >= d + 20, loadDay, 120000).catch(() => undefined);
  info = await hostInfo(page);
  check('load: it continues', info.day >= loadDay + 20, JSON.stringify({ from: loadDay, to: info.day }));

  // ---- freeze (R16): frozen for 15 s, then active. The design's 1 s is wall time on a real GPU; here a frame can take
  // seconds (SwiftShader), and days come with frames, so the time to the first day is reported with the frames between
  const cdp = await ctx.newCDPSession(page);
  const frozenAt = (await hostInfo(page)).day;
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await sleep(FREEZE_MS);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  const resumed = await page.evaluate(async () => {
    const h = window.__metropolis.city.host, d0 = h.state.day, t0 = performance.now();
    let frames = 0, firstFrame = null;
    const count = () => { frames++; firstFrame ??= performance.now() - t0; if (performance.now() - t0 < 30000) requestAnimationFrame(count); };
    requestAnimationFrame(count);
    while (performance.now() - t0 < 30000 && h.state.day === d0) await new Promise((r) => setTimeout(r, 20));
    return { d0, d1: h.state.day, ms: Math.round(performance.now() - t0), framesBefore: frames, firstFrameMs: firstFrame && Math.round(firstFrame), disposed: !!h.isDisposed };
  });
  const crashedAfterFreeze = await crashDialog(page);
  log('long tasks so far', await page.evaluate(() => window.__qaLong));
  const freezeInfo = JSON.stringify({ frozenAt, ...resumed, crashDialog: crashedAfterFreeze });
  check('freeze: frozen 15 s, then no crash path and the days resume', !crashedAfterFreeze && !resumed.disposed && resumed.d1 > resumed.d0, freezeInfo);
  log(resumed.ms <= 1000 ? 'PASS' : 'NOTE', 'freeze: the first day within 1 s of resume (wall time, SwiftShader; not gated here)', freezeInfo);
  await protector(page, 'after the freeze');
  await shot(page, '05-after-freeze');
  if (SOAK_MIN > 0) {
    await setSpeed(page, 3);
    const samples = [], end = Date.now() + SOAK_MIN * 60000;
    while (Date.now() < end) {
      await sleep(Math.min(30000, Math.max(0, end - Date.now())));
      const s = await page.evaluate(() => ({ day: window.__metropolis.city.host.state.day, disposed: !!window.__metropolis.city.host.isDisposed,
        heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576) }));
      samples.push({ t: Math.round((SOAK_MIN * 60000 - (end - Date.now())) / 1000), ...s }); log('soak', samples.at(-1));
    }
    const rising = samples.every((x, i) => i === 0 || x.day > samples[i - 1].day);
    check(`soak: ${SOAK_MIN} min at speed 3, alive and advancing`, rising && !samples.some((x) => x.disposed) && !(await crashDialog(page)), JSON.stringify({ first: samples[0], last: samples.at(-1) }));
    const soaked = await protector(page, `after ${SOAK_MIN} min`);
    // the one detach the worker could cause by itself: a wasm memory.grow (risk 7)
    if (SIMWASM) check(`soak: after ${SOAK_MIN} min the kernels still run on wasm in the worker, its memory never grown`, soaked.wasm?.state === 'ready' && soaked.wasm.blur === true && soaked.wasm.grows === 0, JSON.stringify(soaked.wasm));
    await shot(page, '05b-after-soak');
  }
  check('console: no errors in normal play', errors.length === 0, errors.slice(0, 5).join(' | '));

  // ---- crash: a fatal in the worker, then Restart from autosave
  expectErrors = true;
  await page.keyboard.press('Space');
  await page.evaluate(() => { const h = window.__metropolis.city.host; h.link.post({ t: 'tick', seq: 0, dt: -1, ack: 0 }); });
  await page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((e) => e.textContent === 'The simulation stopped'), null, { timeout: 30000 }).catch(() => undefined);
  const dialog = await crashDialog(page);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.err-stack .err-card')].map((c) => c.textContent.slice(0, 80)));
  check('crash: a fatal opens the crash dialog, and no second error card under it (§4.4)', dialog && cards.length === 0, JSON.stringify({ cards }));
  await settleDialog(page);
  await shot(page, '06-crash-dialog');
  if (dialog) {
    await page.getByText('Restart from autosave', { exact: true }).click();
    await cityUp(page, 'worker').catch(() => undefined);
    info = await hostInfo(page);
    check('crash: Restart from autosave boots a new worker on the save', info?.kind === 'worker' && !info.disposed && info.roads === kept.roads, JSON.stringify(info));
    await shot(page, '07-restarted');
  }

  // ---- recover: an edit after the save, a worker snapshot stored by main, then a fatal
  const snap = await page.evaluate(async () => {
    const h = window.__metropolis.city.host;
    await h.post('setTax', [0, 13.5]).done;
    const s = await h.snapshot('hidden');
    return { ok: !!s?.ok, idb: s?.idb, base: s?.marker.baseSavedAt, cmd: s?.cmd };
  });
  log('snapshot before the second crash', snap);
  await page.evaluate(() => { const h = window.__metropolis.city.host; h.link.post({ t: 'tick', seq: 0, dt: -1, ack: 0 }); });
  await page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((e) => e.textContent === 'The simulation stopped'), null, { timeout: 30000 }).catch(() => undefined);
  const offer = await page.evaluate(() => [...document.querySelectorAll('.modal button')].map((b) => b.textContent.trim()));
  check('recover: the crash dialog offers the snapshot', offer.includes('Recover unsaved progress'), JSON.stringify(offer));
  if (offer.includes('Recover unsaved progress')) {
    await settleDialog(page);
    await shot(page, '07c-crash-dialog-recoverable');
    await page.getByText('Recover unsaved progress', { exact: true }).click();
    await cityUp(page, 'worker').catch(() => undefined);
    const tax = await page.evaluate(() => window.__metropolis.city.host.state.budget.taxRates[0]);
    info = await hostInfo(page);
    check('recover: the snapshot restored on a new worker, with the edit', info?.kind === 'worker' && tax === 13.5 && info.roads === kept.roads, JSON.stringify({ tax, info }));
    await shot(page, '07d-recovered');
  }

  // ---- watchdog: the worker stops posting; 10 visible seconds, then Continue on the main thread
  await page.evaluate(() => { const h = window.__metropolis.city.host; h.link.port.terminate(); });
  const t0 = Date.now();
  await page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((e) => e.textContent === 'The simulation stopped'), null, { timeout: 40000 }).catch(() => undefined);
  const watchdog = await crashDialog(page), after = Date.now() - t0;
  check('watchdog: 10 visible seconds without a packet open the crash dialog', watchdog && after >= 9000, `${after} ms`);
  await settleDialog(page);
  await shot(page, '07b-watchdog-dialog');
  if (watchdog) {
    await page.getByText('Continue on the main thread', { exact: true }).click();
    await cityUp(page, 'local').catch(() => undefined);
    info = await hostInfo(page);
    check('watchdog: Continue on the main thread runs the save on a local host', info?.kind === 'local' && info.roads === kept.roads, JSON.stringify(info));
    await shot(page, '08-main-thread');
  }
  expectErrors = false;
  await page.close();

  // ---- fallback: a worker script that fails to load
  const fctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await fctx.addInitScript(lowQuality, QUALITY);
  await fctx.addInitScript(failingWorker);
  await fctx.addInitScript(toastLog);
  const fpage = await fctx.newPage();
  fpage.setDefaultNavigationTimeout(READY_MS);
  await enterCity(fpage, `${base}/?quickstart=1&size=${SIZE}&seed=7&simworker=1${Q}`, 'fallback');
  const finfo = await hostInfo(fpage);
  const toasts = await fpage.evaluate(() => window.__qaToasts);
  const workerToasts = toasts.filter((t) => /simulation worker/i.test(t));
  check('fallback: a failed worker script boots the city on the main thread, with one toast', finfo?.kind === 'local' && workerToasts.length === 1, JSON.stringify({ kind: finfo?.kind, toasts }));
  await shot(fpage, '09-fallback');
  await fctx.close();

  // ---- region: the region screen prefetches and pre-spawns the next city's worker; Found City boots on it
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await rctx.addInitScript(lowQuality, QUALITY);
  const rpage = await rctx.newPage();
  rpage.setDefaultNavigationTimeout(READY_MS);
  const rworkers = [], rerrors = [];
  rpage.on('worker', (w) => { if (/simWorker/.test(w.url())) rworkers.push(w.url().split('/').pop()); });
  rpage.on('console', (m) => { if (m.type() === 'error') { rerrors.push(m.text()); log('console error', m.text().slice(0, 300)); } });
  rpage.on('pageerror', (e) => { rerrors.push(String(e)); log('pageerror', String(e).slice(0, 300)); });
  await rpage.goto(`${base}/?newcity=1&seed=7&simworker=1${Q}`);
  await rpage.waitForFunction(() => window.__ready === true, null, { timeout: READY_MS, polling: 250 });
  await rpage.getByText('Found City', { exact: true }).waitFor({ timeout: 60000 });
  await waitHost(rpage, () => !!document.querySelector('link[rel=prefetch][href*="simWorker"]'), null, 30000).catch(() => undefined);
  const deadline = Date.now() + 30000;
  while (!rworkers.length && Date.now() < deadline) await sleep(250);
  const onRegion = { workers: rworkers.length, prefetch: await rpage.evaluate(() => document.querySelector('link[rel=prefetch][href*="simWorker"]')?.getAttribute('href') ?? null) };
  await shot(rpage, '10-region-prespawned');
  check('region: the worker chunk prefetched and one worker pre-spawned on the region screen', onRegion.workers === 1 && !!onRegion.prefetch, JSON.stringify(onRegion));
  await rpage.getByText('Found City', { exact: true }).click();
  await cityUp(rpage, 'worker');
  await sleep(2000);
  const founded = await rpage.evaluate(() => { const app = window.__metropolis, c = app.city; return { kind: c.host.kind, speed: c.host.speed, day: c.host.state.day, dirty: app.isDirty(),
    indicator: document.querySelector('.save-status')?.textContent ?? null, sceneOnReplica: c.scene.opts?.state === c.host.state }; });
  check('region: Found City boots on the pre-spawned worker, paused and saved, the scene on the replica (O6)', founded.kind === 'worker' && rworkers.length === 1 && founded.speed === 0 && !founded.dirty && founded.sceneOnReplica,
    JSON.stringify({ ...founded, workers: rworkers.length }));
  await protector(rpage, 'in the founded city');
  await setSpeed(rpage, 3);
  await waitHost(rpage, (d) => window.__metropolis.city.host.state.day >= d + 10, founded.day, 120000).catch(() => undefined);
  const rday = await rpage.evaluate(() => window.__metropolis.city.host.state.day);
  check('region: the founded city runs', rday >= founded.day + 10 && rerrors.length === 0, JSON.stringify({ from: founded.day, to: rday, errors: rerrors.slice(0, 3) }));
  await shot(rpage, '11-region-founded');
  await rctx.close();

  // ---- region fallback: the pre-spawned worker's script fails while the region screen shows; its queued error reaches
  // the host inside listen() at Found City, and the city boots on the main thread with one toast (G4 with R11)
  const pctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await pctx.addInitScript(lowQuality, QUALITY);
  await pctx.addInitScript(failingWorker);
  await pctx.addInitScript(toastLog);
  const ppage = await pctx.newPage();
  ppage.setDefaultNavigationTimeout(READY_MS);
  const perrors = [];
  ppage.on('pageerror', (e) => { perrors.push(String(e)); log('pageerror', String(e).slice(0, 300)); });
  await ppage.goto(`${base}/?newcity=1&seed=7&simworker=1${Q}`);
  await ppage.waitForFunction(() => window.__ready === true, null, { timeout: READY_MS, polling: 250 });
  await ppage.getByText('Found City', { exact: true }).waitFor({ timeout: 60000 });
  await sleep(4000); // the spawn, and its load error, while the dialog shows
  await ppage.getByText('Found City', { exact: true }).click();
  await cityUp(ppage);
  const pinfo = await hostInfo(ppage), ptoasts = (await ppage.evaluate(() => window.__qaToasts)).filter((t) => /simulation worker/i.test(t));
  check('region fallback: a pre-spawned worker that failed to load: the founded city runs on the main thread, one toast',
    pinfo?.kind === 'local' && ptoasts.length === 1 && perrors.length === 0, JSON.stringify({ kind: pinfo?.kind, toasts: ptoasts, pageErrors: perrors }));
  await shot(ppage, '12-region-fallback');
  await pctx.close();
}

try {
  await main();
} catch (e) {
  log('QA FAILED', String(e?.stack ?? e));
  results.push({ step: 'harness', ok: false });
} finally {
  clearTimeout(timer);
  await cleanup();
  const failed = results.filter((r) => !r.ok);
  log(`${results.length - failed.length} of ${results.length} passed${failed.length ? `; failed: ${failed.map((r) => r.step).join(', ')}` : ''}`);
  process.exitCode = failed.length ? 1 : 0;
}
