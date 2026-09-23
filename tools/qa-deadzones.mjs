#!/usr/bin/env node
/**
 * Regression sweep for UI "dead zones": INVISIBLE elements that swallow pointer input over the 3D view
 * (QA_REPORT_1 blockers: a closed .flyout / .rci-pop kept catching clicks, so placements silently failed).
 *
 * Usage:  node tools/qa-deadzones.mjs [--size small|medium] [--shot out.png] [--verbose]
 *
 * Self-contained like tools/shoot.mjs: starts its own Vite dev server (HMR off) on a free port, opens a quickstart
 * city at 1280x720 in headless Chromium (SwiftShader WebGL), then — with REAL mouse / keyboard input — opens and
 * closes every toolbar flyout, every top-bar / hotkey panel, the RCI popover, the pause menu, the onboarding pill and
 * a toast. After each step it sweeps document.elementFromPoint over a grid covering the canvas area and FAILS
 * (exit 1) if any hit lands on an element whose effective opacity is < 0.05 or that is visibility:hidden.
 * Fading-out elements are given time to finish (each check polls until clean, up to STEP_TIMEOUT_MS).
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const SIZE = arg('--size', 'small');
const SHOT = arg('--shot', null);
const VERBOSE = argv.includes('--verbose');
const W = 1280, H = 720;
const STEP_TIMEOUT_MS = 25000;

const log = (...a) => console.log('[deadzones]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'],
});

const failures = [];
let checks = 0;
try {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (VERBOSE && (m.type() === 'error' || m.type() === 'warning')) console.log(`  [console.${m.type()}] ${m.text().slice(0, 300)}`);
  });
  // low quality keeps SwiftShader frames short; fresh onboarding (not dismissed)
  await page.addInitScript(() => {
    try {
      localStorage.setItem('metropolis.settings', JSON.stringify({ quality: 'low' }));
      localStorage.setItem('metropolis.settings.v1', JSON.stringify({ quality: 'low' }));
    } catch {
      /* ignore */
    }
  });

  const t0 = Date.now();
  await page.goto(`${base}/index.html?quickstart=1&size=${SIZE}`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000, polling: 250 });
  await page.waitForFunction(() => {
    const sc = window.__metropolis?.city?.scene;
    return !!sc && sc.worldView && !sc.worldView.isNull && !document.querySelector('.loading-veil');
  }, null, { timeout: 400000, polling: 500 });
  log(`city ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  /** grid sweep over the canvas area; returns { root-class: {n, box} } of invisible hits */
  const sweep = () =>
    page.evaluate(([W, H]) => {
      const hits = {};
      const canvas = document.querySelector('canvas.mp-canvas');
      for (let y = 8; y < H - 4; y += 16) {
        for (let x = 8; x < W - 4; x += 16) {
          const e = document.elementFromPoint(x, y);
          if (!e || e === canvas) continue;
          let op = 1, hidden = false;
          for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
            const cs = getComputedStyle(n);
            op *= parseFloat(cs.opacity);
            if (cs.visibility === 'hidden' || cs.display === 'none') hidden = true;
          }
          if (op >= 0.05 && !hidden) continue;
          // mid-animation (a panel / modal fading IN, a toast sliding out) is transient, not a closed element at rest
          let animating = false;
          for (let n = e; n && n !== document.documentElement && !animating; n = n.parentElement) {
            if (n.getAnimations().some((a) => a.playState === 'running' && a.effect?.getTiming?.().iterations !== Infinity)) animating = true;
          }
          if (animating) continue;
          // an invisible part of VISIBLE, clickable UI is fine (e.g. a toolbar button's hover-only hotkey label):
          // absolved when a visible ancestor with pointer events covers the point — unless that ancestor is the
          // scene itself (anything containing the canvas = the map)
          let absolved = false;
          for (let p = e.parentElement; p && !p.contains(canvas); p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (cs.pointerEvents === 'none') continue;
            let pop = 1, phid = false;
            for (let n = p; n && n !== document.documentElement; n = n.parentElement) {
              const c2 = getComputedStyle(n);
              pop *= parseFloat(c2.opacity);
              if (c2.visibility === 'hidden') phid = true;
            }
            const r = p.getBoundingClientRect();
            if (pop >= 0.05 && !phid && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
              absolved = true;
              break;
            }
          }
          if (absolved) continue;
          // name the offending UI component (nearest ancestor with a known HUD class)
          let r = e;
          while (r.parentElement && !/(^|\s)(flyout|rci-pop|panel|toast|onboard|rich-tip|cursor-tip|minimap|modal|modal-back|tool-chip|legend-chip|save-pill|err-card|dev-badge|hud-[a-z]+)(\s|$)/.test(typeof r.className === 'string' ? r.className : '')) r = r.parentElement;
          const k = (typeof r.className === 'string' && r.className) || r.tagName.toLowerCase();
          const h = (hits[k] ??= { n: 0, x0: 1e9, y0: 1e9, x1: 0, y1: 0, op: +op.toFixed(3), hidden, sample: e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '') });
          h.n++;
          h.x0 = Math.min(h.x0, x); h.y0 = Math.min(h.y0, y); h.x1 = Math.max(h.x1, x); h.y1 = Math.max(h.y1, y);
        }
      }
      return hits;
    }, [W, H]);

  /** poll the sweep until clean (lets fade-outs finish); record a failure when invisible hits persist */
  const check = async (label) => {
    checks++;
    // let running (finite) animations settle first — bounded, frames can be very slow under SwiftShader
    await waitFor(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming?.().iterations === Infinity), null, 8000);
    const until = Date.now() + STEP_TIMEOUT_MS;
    let hits = await sweep();
    while (Object.keys(hits).length && Date.now() < until) {
      await sleep(500);
      hits = await sweep();
    }
    if (Object.keys(hits).length) {
      failures.push({ label, hits });
      log(`FAIL  ${label}: ${JSON.stringify(hits)}`);
    } else log(`ok    ${label}`);
  };

  const center = (sel) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, sel);
  /** real mouse click at an element's centre (no actionability waits: SwiftShader frames can be seconds long) */
  const clickSel = async (sel) => {
    const c = await center(sel);
    if (!c) return false;
    await page.mouse.move(c.x, c.y);
    await page.mouse.click(c.x, c.y);
    return true;
  };
  const waitFor = (fn, arg, ms = STEP_TIMEOUT_MS) => page.waitForFunction(fn, arg, { timeout: ms, polling: 200 }).then(() => true, () => false);
  const parkMouse = () => page.mouse.move(W / 2, H / 2 - 60);

  await parkMouse();
  await check('fresh city');

  // ---- RCI popover (top bar): open with a click, close with Esc and with an outside click
  if (await clickSel('.rci-seg')) {
    await waitFor(() => !!document.querySelector('.rci-pop.open'));
    await page.keyboard.press('Escape');
    await waitFor(() => !document.querySelector('.rci-pop.open'));
    await parkMouse();
    await check('RCI popover open -> Esc');
    await clickSel('.rci-seg');
    await waitFor(() => !!document.querySelector('.rci-pop.open'));
    await page.mouse.click(W / 2, H / 2);
    await waitFor(() => !document.querySelector('.rci-pop.open'));
    await check('RCI popover open -> outside click');
  } else {
    failures.push({ label: 'RCI popover', hits: { missing: '.rci-seg not found' } });
    log('FAIL  RCI popover: .rci-seg not found');
  }

  // ---- every toolbar category: flyouts (click to open, click again / Esc to close), tools (Esc), panels
  const cats = await page.evaluate(() => [...document.querySelectorAll('.toolbar .tb-btn')].map((b, i) => ({ i, label: b.querySelector('.tb-l')?.textContent ?? String(i) })));
  for (const c of cats) {
    const btnSel = await page.evaluate((i) => {
      const b = document.querySelectorAll('.toolbar .tb-btn')[i];
      b.setAttribute('data-qa-cat', String(i));
      return `.toolbar .tb-btn[data-qa-cat="${i}"]`;
    }, c.i);
    await clickSel(btnSel);
    // the click opens a flyout (button gets .open at once, the flyout .open on the next frame), selects a tool
    // (tool chip) or toggles a panel — frames can take seconds under SwiftShader, so wait generously
    await waitFor((s) => document.querySelector(s)?.classList.contains('open') || !!document.querySelector('.tool-chip.show') || !!document.querySelector('.panel-layer .panel:not(.closing)'), btnSel);
    const isFly = await page.evaluate((s) => !!document.querySelector(s)?.classList.contains('open'), btnSel);
    // (first open of a category renders its building thumbnails: that frame can take minutes under a loaded
    // SwiftShader; the button's .open proves the click registered — a slow reveal is only a warning here, the
    // close + sweep below still run)
    const opened = isFly && (await waitFor(() => !!document.querySelector('.flyout.open'), null, 180000));
    if (isFly && !opened) log(`WARN  flyout "${c.label}": not revealed within 180 s (slow frames) — checking the close anyway`);
    if (isFly) {
      // hover the first item (rich tooltip), then close by clicking the category again
      const item = await center('.flyout.open .fly-item');
      if (item) {
        await page.mouse.move(item.x, item.y);
        await sleep(300);
      }
      await clickSel(btnSel);
      await waitFor(() => !document.querySelector('.flyout.open'));
      await parkMouse();
      await check(`flyout "${c.label}" open -> close`);
      // re-open and close with Esc
      await clickSel(btnSel);
      await waitFor(() => !!document.querySelector('.flyout.open'));
      await page.keyboard.press('Escape');
      await waitFor(() => !document.querySelector('.flyout.open'));
      await parkMouse();
      await check(`flyout "${c.label}" open -> Esc`);
    } else if (!isFly) {
      // a tool (bulldoze) or a panel (data views): undo with Esc (tool) or a second click (panel); Query when the
      // query tool is already active changes nothing (and Esc would open the pause menu)
      const st = await page.evaluate(() => ({ panel: document.querySelectorAll('.panel-layer .panel').length > 0, chip: !!document.querySelector('.tool-chip.show') }));
      if (st.panel) await clickSel(btnSel);
      else if (st.chip) await page.keyboard.press('Escape');
      await waitFor(() => !document.querySelector('.panel-layer .panel') && !document.querySelector('.tool-chip.show'));
      await parkMouse();
      await check(`category "${c.label}" toggle`);
    }
  }

  // ---- open/close race: a close before the flyout's reveal frame (QA #8) must not leave it stuck open
  const stuck = await page.evaluate(async () => {
    const sc = window.__metropolis.city.scene;
    const out = [];
    for (const id of ['zones', 'transport', 'utilities']) {
      sc.openFlyout(id);
      sc.toolbar.closeFlyout();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (document.querySelector('.flyout.open')) out.push(id);
    }
    return out;
  });
  if (stuck.length) {
    failures.push({ label: 'flyout open+close race', hits: { stuckOpen: stuck } });
    log(`FAIL  flyout open+close race: stuck open ${stuck.join(', ')}`);
  }
  await check('flyout open+close within one frame');

  // ---- panels from the top bar buttons (click to open, click again to close) + hotkeys
  const panelBtns = await page.evaluate(() => [...document.querySelectorAll('.hud-top .icon-btn')].map((b, i) => {
    b.setAttribute('data-qa-top', String(i));
    return { sel: `.hud-top .icon-btn[data-qa-top="${i}"]`, title: b.getAttribute('title') ?? '' };
  }).filter((b) => !/menu/i.test(b.title)));
  for (const b of panelBtns) {
    await clickSel(b.sel);
    await waitFor(() => document.querySelectorAll('.panel-layer .panel:not(.closing)').length > 0);
    await clickSel(b.sel);
    await waitFor(() => !document.querySelector('.panel-layer .panel'));
    await parkMouse();
    await check(`top-bar "${b.title}" open -> close`);
  }
  for (const k of ['m', 'g', 'j', 'n', 'o', 'y', 'F1']) {
    await page.keyboard.press(k);
    await waitFor(() => document.querySelectorAll('.panel-layer .panel:not(.closing)').length > 0);
    await page.keyboard.press('Escape');
    await waitFor(() => !document.querySelector('.panel-layer .panel'));
    await check(`hotkey ${k} panel open -> Esc`);
  }

  // ---- pause menu (Esc with nothing open) -> Esc
  await page.keyboard.press('Escape');
  await waitFor(() => !!document.querySelector('.modal-back'));
  await page.keyboard.press('Escape');
  await waitFor(() => !document.querySelector('.modal-back'));
  await check('pause menu open -> Esc');

  // ---- onboarding card: minimise to the pill and expand again
  if (await clickSel('.onboard.show .ob-min')) {
    await waitFor(() => !!document.querySelector('.onboard.min'));
    await parkMouse();
    await check('onboarding minimised');
    await clickSel('.onboard.min .ob-pill');
    await waitFor(() => !document.querySelector('.onboard.min'));
    await parkMouse();
    await check('onboarding expanded');
  }

  // ---- a toast appears and expires
  await page.evaluate(() => window.__metropolis.city.scene.ctx.toast('QA dead-zone sweep toast', 'warning'));
  await waitFor(() => !!document.querySelector('.toast'));
  await waitFor(() => !document.querySelector('.toast'), null, 20000);
  await check('toast expired');

  if (SHOT) {
    const out = resolve(root, SHOT);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, timeout: 180000 });
    log('saved', out);
  }
  if (errors.length) log(`page errors (${errors.length}):`, errors.slice(0, 5).join(' | '));
  await context.close();
} catch (e) {
  failures.push({ label: 'script error', hits: { error: String(e?.stack ?? e) } });
  log('ERROR', e?.stack ?? e);
} finally {
  await browser.close();
  await server.close();
}

log(`${checks} checks, ${failures.length} failure(s)${failures.length ? ': ' + failures.map((f) => f.label).join('; ') : ''}`);
process.exit(failures.length ? 1 : 0);
