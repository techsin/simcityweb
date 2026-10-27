import { assert, deadline, poll, sleep, withCleanup } from './harness.mjs';

export function resumeDelay(f) {
  assert(Number.isFinite(f?.frozenAt) && Number.isFinite(f?.resumedAt), 'freeze/resume lifecycle timestamps were not observed');
  assert(Number.isFinite(f.visibleAt), 'page stayed hidden after active; no visible lifecycle timestamp');
  assert(f.framesDuringFreeze.length === 0, `simulation received ${f.framesDuringFreeze.length} frames while frozen`);
  assert(Number.isFinite(f.advancedAt), 'no sim-day advance after visible lifecycle resume');
  const elapsed = f.advancedAt - Math.max(f.resumedAt, f.visibleAt);
  assert(elapsed >= 0 && elapsed <= 1000, `simulation resumed after ${elapsed.toFixed(1)} ms from resume/visible (limit 1000 ms)`);
  return elapsed;
}

export async function restoreVisibility(page, cdp, headed, timeout, evidence) {
  // active unfreezes Chromium but does not undo WasHidden(). None of these reads may depend on rAF.
  evidence.visibilityAfterActive = await page.evaluate(() => document.visibilityState);
  if (evidence.visibilityAfterActive !== 'visible') {
    try {
      if (headed) { evidence.visibilityRestore = 'bringToFront'; await page.bringToFront(); }
      else {
        evidence.visibilityRestore = 'minimized → normal';
        const { targetInfo } = await deadline(cdp.send('Target.getTargetInfo'), timeout, 'freeze: target lookup timed out');
        const { windowId } = await deadline(cdp.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId }), timeout, 'freeze: window lookup timed out');
        for (const windowState of ['minimized', 'normal']) {
          await deadline(cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState } }), timeout, `freeze: ${windowState} restore timed out`);
        }
      }
    } catch (e) {
      if (await page.evaluate(() => document.visibilityState) !== 'visible') throw new Error(`page stayed hidden after active; visibility restoration failed: ${e.message}`);
      throw e;
    }
  }
  await poll(() => page.evaluate(() => document.visibilityState), (v) => v === 'visible', timeout,
    `page stayed hidden after active and ${evidence.visibilityRestore ?? 'visibility check'}; simulation cannot resume`, 25);
  await page.evaluate(() => window.__qaWorker.markVisible());
}

export async function freeze(d, report, signal) {
  const { page, options } = d;
  const evidence = { cleanupErrors: [] };
  report.details.freeze = evidence;
  await d.clean(); await d.speed(3);
  const day = await page.evaluate(() => window.__metropolis.city.scene.host.state.day);
  await poll(() => page.evaluate(() => window.__metropolis.city.scene.host.state.day), (now) => now > day,
    options.ackTimeout, 'simulation did not run before freeze');
  const cdp = await page.context().newCDPSession(page);
  const send = (method, args) => deadline(cdp.send(method, args), options.ackTimeout, `${method} timed out`);
  let frozen = false;
  return withCleanup(async () => {
    await send('Page.enable');
    await page.evaluate(() => window.__qaWorker.armFreeze());
    evidence.freezeRequestedUTC = new Date().toISOString();
    frozen = true;
    await send('Page.setWebLifecycleState', { state: 'frozen' });
    evidence.freezeConfirmedUTC = new Date().toISOString();
    const start = performance.now();
    await withCleanup(async () => { await sleep(15000, signal); }, async () => {
      evidence.frozenForMs = performance.now() - start;
      evidence.resumeRequestedUTC = new Date().toISOString();
      await send('Page.setWebLifecycleState', { state: 'active' });
      frozen = false;
      evidence.resumeConfirmedUTC = new Date().toISOString();
    }, (e) => evidence.cleanupErrors.push(e.message));
    await restoreVisibility(page, cdp, options.headed, options.ackTimeout, evidence);
    evidence.visibleConfirmedUTC = new Date().toISOString();
    const f = await poll(() => page.evaluate(() => window.__qaWorker.freeze), (f) => f?.advancedAt != null,
      Math.max(3000, options.ackTimeout), 'no sim-day advance after page became visible', 25);
    evidence.lifecycle = f;
    const elapsed = resumeDelay(f);
    assert(evidence.frozenForMs >= 15000, `freeze lasted only ${evidence.frozenForMs} ms`);
    assert(await page.locator('.err-card, vite-error-overlay, [data-sim-crash]').count() === 0, 'crash overlay after freeze');
    return `frozen ${evidence.frozenForMs.toFixed(0)} ms; ${f.framesDuringFreeze.length} frames while frozen; day advanced ${elapsed.toFixed(1)} ms after later of resume/visible; page-clock freeze/resume/visible = ${[f.frozenAt, f.resumedAt, f.visibleAt].map((t) => t.toFixed(1)).join('/')} ms`;
  }, async () => {
    const failures = [];
    const attempt = async (fn) => { try { await fn(); } catch (e) { failures.push(e.message); } };
    if (frozen) await attempt(() => send('Page.setWebLifecycleState', { state: 'active' }));
    if (!page.isClosed()) {
      await attempt(async () => { evidence.lifecycle = await page.evaluate(() => window.__qaWorker?.freeze); });
      await attempt(async () => {
        if (await page.evaluate(() => document.visibilityState) === 'visible') await d.speed(0);
        else evidence.cleanupSkipped = 'speed button: page is hidden; do not wait for rAF-based click stability';
      });
    }
    await attempt(() => cdp.detach());
    evidence.cleanupErrors.push(...failures);
    assert(!failures.length, `freeze cleanup: ${failures.join('; ')}`);
  }, (e) => d.cleanupErrors.push(e.message));
}
