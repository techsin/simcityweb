#!/usr/bin/env node
/**
 * FEEL-01's browser checks (POLISH_PLAN FEEL-01, T060): the news ticker shows the newest headline first as one readable
 * clause. On the UI dev page (demo-ui.html, a 64-tile town, the sim paused so only the injected news arrives) at
 * 1280x720:
 *   A. within 1 s of a notify, the first 20 characters of the item are inside .tk-view (from the idle rotation, from a
 *      long rotation item mid-scroll, and right after a new item's hold);
 *   B. a 200-character item shows at most 91 characters, and its tooltip (title) has the full text;
 *   C. each of 10 consecutive flavour headlines (the 10 longest real texts from advisors.ts), arriving every 8 s (the
 *      sim's shortest headline gap at 2x: 40 days x 0.2 s), is fully visible within 15 s of arriving; the same at
 *      ultra's shortest gap (2 s) is reported only (more than one line can show: tests/game/tickerProbe.test.ts);
 *   D. widths are cached: no layout read from Notifications.ts while an item scrolls, and the page's layout count while
 *      it scrolls is no higher than while it rests;
 *   E. hover pauses it (the transform holds, a new item waits) and it resumes on leave;
 *   F. flavour headlines carry the Gazette label; the welcome tip is FEEL-01's.
 *
 * Usage:  node tools/qa-ticker.mjs [--shots <dir>] [--cache <vite cache dir>]
 * Its own Vite dev server (HMR off) on a free port, headless Chromium (SwiftShader). Exit 1 on any failed check.
 * SwiftShader draws this page at about a frame a second, which says nothing about a DOM ticker's timing: the checks
 * switch the 3D view's per-frame update and draw off (the canvas keeps its last frame) and report the frame rate both
 * ways. Rects are screen px (the HUD is zoomed): the view's 16 / 24 css px fades are scaled by the zoom.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const SHOTS = arg('--shots', join(tmpdir(), 'metropolis-qa-ticker'));
const CACHE = arg('--cache', join(tmpdir(), 'metropolis-qa-ticker-vite'));
const log = (...a) => console.log('[ticker]', ...a);
mkdirSync(SHOTS, { recursive: true });

// the real flavour headlines (advisors.ts HEADLINES), filled for the demo town; the 10 longest
const src = readFileSync(join(root, 'src/sim/economy/advisors.ts'), 'utf8');
const block = src.slice(src.indexOf('const HEADLINES'), src.indexOf('const HEADLINE_BY_ID'));
const fill = (t) => t.replaceAll('{city}', 'Riverton').replaceAll('{mayor}', 'Avery').replaceAll('{year}', '2003').replaceAll('{pop}', '4,812');
const headlines = [...block.matchAll(/text: '((?:[^'\\]|\\.)*)'/g)].map((m) => fill(m[1].replace(/\\'/g, "'")));
const longest = [...headlines].sort((a, b) => b.length - a.length).slice(0, 10);

const server = await createServer({ root, cacheDir: CACHE, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
const failures = [];
const results = {};
const check = (name, ok, detail) => {
  log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail));
  results[name] = { ok, detail };
  if (!ok) failures.push(name);
};
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // the layout reads made from Notifications.ts (a stack check on every layout getter / method)
  await page.addInitScript(() => {
    const w = window;
    w.__tkReads = 0;
    const wrapGet = (proto, k) => {
      const d = Object.getOwnPropertyDescriptor(proto, k);
      if (!d?.get) return;
      Object.defineProperty(proto, k, { ...d, get() { if (w.__tkCount && /Notifications\.ts/.test(new Error().stack)) w.__tkReads++; return d.get.call(this); } });
    };
    const wrapFn = (proto, k) => {
      const f = proto[k];
      proto[k] = function (...a) { if (w.__tkCount && /Notifications\.ts/.test(new Error().stack)) w.__tkReads++; return f.apply(this, a); };
    };
    for (const k of ['scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight', 'scrollLeft', 'scrollTop']) wrapGet(Element.prototype, k);
    for (const k of ['offsetWidth', 'offsetHeight', 'offsetLeft', 'offsetTop']) wrapGet(HTMLElement.prototype, k);
    for (const k of ['getBoundingClientRect', 'getClientRects']) wrapFn(Element.prototype, k);
    wrapFn(window, 'getComputedStyle');
  });
  const t0 = Date.now();
  await page.goto(`${base}/demo-ui.html?size=64&town=1&speed=0&onboard=0&seed=4242`, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000, polling: 250 });
  log(`ready in ${Date.now() - t0} ms`);
  // in-page helpers: a per-frame sampler of what the ticker shows and where its text is
  await page.evaluate(() => {
    const w = window;
    const scene = w.__scene;
    w.__tk = scene.ticker;
    w.__notify = (text, kind = 'info', advisor) => scene.sim.notify(text, kind, undefined, undefined, advisor);
    const view = document.querySelector('.ticker .tk-view');
    // the 3D view off / on (its update and draw; the ticker is DOM and runs in the same frame loop)
    const keep = { wr: scene.world.render, wu: scene.world.update, ou: scene.objects.update };
    w.__lite = (on) => {
      if (on) { scene.world.render = () => {}; scene.world.update = () => {}; scene.objects.update = () => {}; }
      else { delete scene.world.render; delete scene.world.update; delete scene.objects.update; Object.assign(scene.world, { render: keep.wr, update: keep.wu }); scene.objects.update = keep.ou; }
    };
    w.__fps = () => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => (++n, performance.now() - t0 < 3000 ? requestAnimationFrame(f) : res(+(n / ((performance.now() - t0) / 1000)).toFixed(1))); requestAnimationFrame(f); });
    w.__geom = () => {
      const v = view.getBoundingClientRect();
      // screen px per css px (the HUD's zoom)
      const z = v.width / view.clientWidth;
      const item = view.querySelector('.tk-item');
      const tx = item?.querySelector('.tk-text');
      const node = tx?.firstChild;
      if (!node) return null;
      const all = tx.getBoundingClientRect();
      const r = document.createRange();
      r.setStart(node, 0);
      r.setEnd(node, Math.min(20, node.length));
      const head = r.getBoundingClientRect();
      // the view's opaque part: past the 16 px left fade, before the 24 px right fade (hud.css .tk-view mask)
      const lo = v.left + 16 * z - 0.5, hi = v.right - 24 * z + 0.5;
      const wOf = (e) => (e ? +e.getBoundingClientRect().width.toFixed(1) : 0);
      return {
        text: tx.textContent, title: item.getAttribute('title'), textW: wOf(tx), dateW: wOf(item.querySelector('.d')), tagW: wOf(item.querySelector('.tk-tag')), itemW: wOf(item),
        head20In: head.left >= v.left && head.right <= v.right, head20Opaque: head.left >= lo && head.right <= hi,
        startIn: all.left >= lo && all.left <= hi, endIn: all.right <= hi && all.right >= lo,
        transform: view.querySelector('.tk-track').style.transform,
      };
    };
    w.__samples = [];
    w.__sampling = false;
    const loop = (ts) => {
      if (w.__sampling) w.__samples.push({ t: performance.now(), g: w.__geom() });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const sleep = (ms) => page.waitForTimeout(ms);
  const layout = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) }; };
    return { zoom: getComputedStyle(document.querySelector('.mp-ui')).zoom, hudBl: r('.hud-bl'), ticker: r('.ticker'), view: r('.ticker .tk-view'), viewCss: document.querySelector('.ticker .tk-view').clientWidth, toolbar: r('.toolbar'), minimap: r('.minimap') };
  });
  log('layout at 1280x720', JSON.stringify(layout));
  results.layout = layout;
  // (dev's .hud-bl width, unchanged here: room to widen the ticker at this size?)
  log('room between the ticker and the toolbar (screen px):', layout.toolbar.left - layout.ticker.right);
  results.fps = { normal: await page.evaluate(() => window.__fps()) };
  await page.evaluate(() => window.__lite(true));
  results.fps.lite = await page.evaluate(() => window.__fps());
  log('frames a second: 3D view on', results.fps.normal, '/ off (the checks)', results.fps.lite);

  // F. the welcome items of a fresh town (no news yet)
  const welcome = await page.evaluate(() => [...window.__tk.list].map((n) => n.text));
  check('F1 the welcome tip is FEEL-01\'s and never says to connect a plant "with power lines"',
    welcome.includes('Tip: roads and power lines carry electricity from your plant to your zones.') && !welcome.some((t) => /connect[^.!?]*with power lines/i.test(t)), welcome);
  await page.screenshot({ path: join(SHOTS, 'f01-00-welcome.png') });

  /** time (s) from a notify until the first 20 characters of the item are inside .tk-view */
  const timeTo20 = async (text, kind = 'info', advisor) => page.evaluate(async ([text, kind, advisor]) => {
    const w = window;
    w.__notify(text, kind, advisor);
    const t0 = performance.now();
    const want = text.slice(0, 20);
    return await new Promise((res) => {
      const f = () => {
        const g = w.__geom();
        const dt = (performance.now() - t0) / 1000;
        if (g && g.text.startsWith(want) && g.head20In && g.head20Opaque) return res({ s: +dt.toFixed(3), transform: g.transform });
        if (dt > 5) return res({ s: Infinity, g });
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
  }, [text, kind, advisor]);

  // A. within 1 s of a notify (from the rotation, mid-scroll of a long rotation item, and right after a new item's hold)
  await sleep(6000);
  const a1 = await timeTo20('Water main repaired on Elm Street after a long night of work.', 'good');
  await sleep(300);
  await page.screenshot({ path: join(SHOTS, 'f01-01-new-item.png') });
  await sleep(5600); // its hold ends: the rotation
  const long = 'Commuters praise the new crosstown avenue as average trips fall to eighteen minutes across the whole of Riverton';
  const a2pre = await timeTo20(long, 'good');
  // wait for the rotation to bring the long item back and scroll it; then a new one arrives mid-scroll
  await page.waitForFunction((t) => window.__tk.current?.text === t && /translateX\(-/.test(window.__geom()?.transform ?? ''), long, { timeout: 60000, polling: 'raf' });
  const rot = await page.evaluate(() => window.__tk.current?.text);
  const mid = await page.evaluate(() => window.__geom().transform);
  const a2 = await timeTo20('Power plant output steady after the evening peak.', 'info');
  const a3pre = await timeTo20('Library extends its opening hours on weekends.', 'good');
  await sleep(5300); // hold over (5 s): the rotation shows, then a new one
  const a3 = await timeTo20('Recycling center reaches a record month.', 'good');
  check('A within 1 s of a notify the first 20 characters are inside .tk-view', [a1, a2pre, a2, a3pre, a3].every((r) => r.s <= 1),
    { idle: a1.s, longNew: a2pre.s, midScrollOf: rot?.slice(0, 30), midTransform: mid, midScroll: a2.s, next: a3pre.s, afterHold: a3.s });

  // B. a 200-character item: at most 91 characters, the tooltip has the full text
  await sleep(5500);
  const t200 = ('The regional transit authority has approved a sweeping plan that would connect every neighbourhood of Riverton '
    + 'with frequent buses and new light rail lines over the coming years, pending a vote').slice(0, 200);
  const b = await timeTo20(t200, 'info');
  await sleep(400);
  const bg = await page.evaluate(() => window.__geom());
  await page.screenshot({ path: join(SHOTS, 'f01-02-200-chars.png') });
  check('B a 200-character item shows at most 91 characters, with the full text in its tooltip',
    t200.length === 200 && bg.text.length <= 91 && bg.title === t200 && b.s <= 1, { shown: bg.text, chars: bg.text.length, titleFull: bg.title === t200 });
  // let it scroll: mid-scroll and end shots
  await sleep(2600);
  await page.screenshot({ path: join(SHOTS, 'f01-03-200-scrolling.png') });
  await sleep(3500);
  const bEnd = await page.evaluate(() => window.__geom());
  await page.screenshot({ path: join(SHOTS, 'f01-04-200-end.png') });
  check('B2 a long item scrolls through once: its end comes into view', bEnd.text === bg.text ? bEnd.endIn : true, { end: bEnd.transform, endIn: bEnd.endIn, text: bEnd.text.slice(0, 30) });

  // D. widths cached: no layout read from Notifications.ts while an item scrolls; layouts while scrolling vs resting
  await sleep(4000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const frames = () => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => (++n, performance.now() - t0 < 3000 ? requestAnimationFrame(f) : res(n)); requestAnimationFrame(f); }));
  const window3s = async () => {
    await page.evaluate(() => { window.__tkReads = 0; window.__tkCount = true; });
    const m0 = await metric();
    const n = await frames();
    const m1 = await metric();
    const reads = await page.evaluate(() => { window.__tkCount = false; return window.__tkReads; });
    return { frames: n, layouts: m1.LayoutCount - m0.LayoutCount, styles: m1.RecalcStyleCount - m0.RecalcStyleCount, tickerReads: reads };
  };
  await timeTo20('Short news item at rest.', 'good');
  await sleep(600);
  const rest = await window3s();
  await timeTo20(t200.replace('regional', 'county'), 'info');
  await sleep(1500); // past its entry and lead: it scrolls
  const tr0 = await page.evaluate(() => window.__geom().transform);
  const scroll = await window3s();
  const tr1 = await page.evaluate(() => window.__geom().transform);
  check('D widths are cached: no layout read from the ticker while it scrolls, no more layouts than at rest',
    scroll.tickerReads === 0 && rest.tickerReads === 0 && tr0 !== tr1 && scroll.layouts <= rest.layouts + 2, { rest, scroll, transforms: [tr0, tr1] });

  // E. hover pauses: the transform holds and a new item waits; leaving resumes
  await sleep(6500);
  await timeTo20(t200.replace('regional', 'state'), 'info');
  await sleep(1800);
  const tk = await page.locator('.ticker .tk-view').boundingBox();
  await page.mouse.move(tk.x + tk.width / 2, tk.y + tk.height / 2);
  await sleep(300);
  const h0 = await page.evaluate(() => ({ g: window.__geom(), cur: window.__tk.current.text }));
  await page.evaluate(() => window.__notify('Arrived while hovered.', 'good'));
  await sleep(2500);
  const h1 = await page.evaluate(() => ({ g: window.__geom(), cur: window.__tk.current.text, waiting: window.__tk.waiting }));
  await page.screenshot({ path: join(SHOTS, 'f01-05-hover.png') });
  await page.mouse.move(640, 300);
  const resume = await page.evaluate(async () => {
    const t0 = performance.now();
    return await new Promise((res) => {
      const f = () => {
        const g = window.__geom();
        if (g && g.text.startsWith('Arrived while hovered') && g.head20Opaque) return res((performance.now() - t0) / 1000);
        if (performance.now() - t0 > 12000) return res(Infinity);
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
  });
  check('E hover pauses the ticker (transform held, the new item waits); it resumes on leave',
    h0.g.transform === h1.g.transform && h1.cur === h0.cur && h1.waiting === 1 && resume < 12, { held: [h0.g.transform, h1.g.transform], waiting: h1.waiting, resumeS: +resume.toFixed(2) });

  // F. a flavour headline carries the Gazette label
  await sleep(1000);
  await page.evaluate((t) => window.__notify(t, 'info', 'news'), headlines[0]);
  await page.waitForFunction((t) => window.__tk.current?.text === t, headlines[0], { timeout: 20000, polling: 'raf' });
  await sleep(800);
  const gz = await page.evaluate(() => { const it = document.querySelector('.ticker .tk-item'); return { tag: it.querySelector('.tk-tag')?.textContent ?? null, cls: it.className }; });
  const gzg = await page.evaluate(() => window.__geom());
  await page.screenshot({ path: join(SHOTS, 'f01-06-gazette.png') });
  await page.screenshot({ path: join(SHOTS, 'f01-06-gazette-zoom.png'), clip: { x: 0, y: 660, width: 480, height: 60 } });
  await page.evaluate(() => window.__notify('Fire station opens downtown.', 'good'));
  await page.waitForFunction(() => window.__tk.current?.text === 'Fire station opens downtown.', null, { timeout: 20000, polling: 'raf' });
  await sleep(700);
  const ng = await page.evaluate(() => document.querySelector('.ticker .tk-item .tk-tag')?.textContent ?? null);
  results.calibration = { charW: +(bg.textW / bg.text.length).toFixed(2), clauseChars: bg.text.length, clauseW: bg.textW, dateW: bg.dateW, tagW: gzg.tagW, viewW: layout.view.width };
  log('calibration', JSON.stringify(results.calibration));
  check('F2 flavour headlines carry the Gazette label, other news does not', gz.tag === 'Gazette' && ng === null, { gz, other: ng });

  // C. 10 consecutive headlines, every 8 s (and every 2 s, reported): each fully visible within 15 s of arriving
  await sleep(4000);
  const burst = (gapS) => page.evaluate(async ([texts, gapS]) => {
    const w = window;
    const out = texts.map((t) => ({ t, at: 0, head: Infinity, tail: Infinity, clause: '' }));
    const t0 = performance.now();
    let k = 0;
    return await new Promise((res) => {
      const f = () => {
        const now = performance.now();
        while (k < texts.length && now - t0 >= k * gapS * 1000) {
          out[k].at = (now - t0) / 1000;
          w.__notify(texts[k], 'info', 'news');
          k++;
        }
        const g = w.__geom();
        const cur = w.__tk.current;
        const i = out.findIndex((o) => o.t === cur?.text);
        if (g && i >= 0) {
          const o = out[i];
          o.clause = g.text;
          const s = (now - t0) / 1000;
          if (g.startIn && o.head === Infinity) o.head = s;
          if (g.endIn && o.head !== Infinity && o.tail === Infinity) o.tail = s;
        }
        if (now - t0 > texts.length * gapS * 1000 + 40000 || out.every((o) => o.tail !== Infinity)) return res(out.map((o) => ({ at: +o.at.toFixed(2), fullyVisibleAfter: +(Math.max(o.head, o.tail) - o.at).toFixed(2), chars: o.clause.length, clause: o.clause })));
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
  }, [longest, gapS]);
  const c = await burst(8);
  for (const r of c) log(`  +${r.at}s  visible after ${r.fullyVisibleAfter}s  (${r.chars} ch) ${r.clause}`);
  check('C each of 10 consecutive headlines (the 10 longest, every 8 s) is fully visible within 15 s', c.every((r) => r.fullyVisibleAfter <= 15), c.map((r) => r.fullyVisibleAfter));
  await page.screenshot({ path: join(SHOTS, 'f01-07-after-headlines.png') });
  await sleep(6000);
  const c2 = await burst(2);
  results.ultraPace = c2.map((r) => r.fullyVisibleAfter);
  log('C2 (reported) the 10 longest every 2 s (ultra\'s pace): visible after', JSON.stringify(results.ultraPace));
  check('no page errors', errors.length === 0, errors.slice(0, 5));
  await context.close();
} finally {
  await browser.close();
  await server.close();
}
console.log(JSON.stringify({ results }, null, 1));
log(failures.length ? `FAILED: ${failures.join(', ')}` : 'all checks passed');
process.exit(failures.length ? 1 : 0);
