import { assert, deadline, poll, sleep, withCleanup } from './harness.mjs';
import { owningLifecycleSession } from './lifecycle.mjs';
import { crashOverlays } from './page.mjs';

/** §5.4: no crash overlay may appear, including W1.2's worker crash dialog. */
export async function assertNoCrashOverlay(page, where) {
  const found = await page.evaluate(crashOverlays);
  assert(Array.isArray(found) && found.length === 0, `${where}: ${Array.isArray(found) ? found.join('; ') : 'overlay read failed'}`);
}

export function resumeDelay(f) {
  assert(Number.isFinite(f?.frozenAt) && Number.isFinite(f?.resumedAt), 'freeze/resume lifecycle timestamps were not observed');
  assert(Number.isFinite(f.visibleAt), 'page stayed hidden after active; no visible lifecycle timestamp');
  assert(f.framesDuringFreeze.length === 0, `simulation received ${f.framesDuringFreeze.length} frames while frozen`);
  assert(Number.isFinite(f.advancedAt), 'no sim-day advance after visible lifecycle resume');
  const elapsed = f.advancedAt - Math.max(f.resumedAt, f.visibleAt);
  assert(elapsed >= 0 && elapsed <= 1000, `simulation resumed after ${elapsed.toFixed(1)} ms from resume/visible (limit 1000 ms)`);
  return elapsed;
}

export async function hideForFreeze(page, cdp, timeout, evidence) {
  const { targetInfo } = await deadline(cdp.send('Target.getTargetInfo'), timeout, 'freeze: target lookup timed out');
  const { windowId } = await deadline(cdp.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId }), timeout, 'freeze: window lookup timed out');
  evidence.windowId = windowId;
  await deadline(cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } }), timeout, 'freeze: minimize timed out');
  await poll(() => page.evaluate(() => document.visibilityState), (v) => v === 'hidden', timeout,
    'freeze: page did not become hidden after disabling owning-session focus emulation and minimizing', 25);
  evidence.hiddenConfirmedUTC = new Date().toISOString();
}

export async function restoreVisibility(page, cdp, headed, timeout, evidence) {
  // active unfreezes Chromium but does not undo WasHidden(). These reads must not depend on rAF.
  evidence.visibilityAfterActive = await page.evaluate(() => document.visibilityState);
  if (evidence.visibilityAfterActive !== 'visible') {
    try {
      evidence.visibilityRestore = 'minimized → normal';
      let windowId = evidence.windowId;
      if (windowId == null) {
        const { targetInfo } = await deadline(cdp.send('Target.getTargetInfo'), timeout, 'freeze: target lookup timed out');
        ({ windowId } = await deadline(cdp.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId }), timeout, 'freeze: window lookup timed out'));
      }
      await deadline(cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }), timeout, 'freeze: normal restore timed out');
      if (headed) { evidence.visibilityRestore += ' / bringToFront'; await page.bringToFront(); }
    } catch (e) {
      if (await page.evaluate(() => document.visibilityState) !== 'visible') throw new Error(`page stayed hidden after active; visibility restoration failed: ${e.message}`);
      throw e;
    }
  }
  await poll(() => page.evaluate(() => document.visibilityState), (v) => v === 'visible', timeout,
    `page stayed hidden after active and ${evidence.visibilityRestore ?? 'visibility check'}; simulation cannot resume`, 25);
}

export async function freeze(d, report, signal) {
  const { page, options } = d;
  const evidence = { cleanupErrors: [], lifecycleEvents: [], cdpLifecycleEvents: [] };
  report.details.freeze = evidence;
  await d.clean(); await d.speed(3);
  const day = await page.evaluate(() => window.__metropolis.city.scene.host.state.day);
  evidence.preFreezeDay = day;
  evidence.runningDay = await poll(() => page.evaluate(() => window.__metropolis.city.scene.host.state.day), (now) => now > day,
    options.ackTimeout, 'simulation did not run before freeze');
  evidence.runningConfirmedUTC = new Date().toISOString();
  const owner = owningLifecycleSession(page);
  const cdp = await page.context().newCDPSession(page);
  const send = (method, args) => deadline(cdp.send(method, args), options.ackTimeout, `${method} timed out`);
  const focus = (enabled) => deadline(owner.send('Emulation.setFocusEmulationEnabled', { enabled }), options.ackTimeout, 'freeze: owning-session focus emulation timed out');
  const bindingName = '__qaWorkerLifecycle';
  const onBinding = (event) => {
    if (event.name !== bindingName) return;
    try { evidence.lifecycleEvents.push(JSON.parse(event.payload)); }
    catch (e) { evidence.bindingError = e.message; }
  };
  const onLifecycle = (event) => evidence.cdpLifecycleEvents.push(event);
  cdp.on('Runtime.bindingCalled', onBinding);
  cdp.on('Page.lifecycleEvent', onLifecycle);
  const observed = (type) => poll(() => evidence.lifecycleEvents.find((e) => e.type === type), (e) => !!e,
    options.ackTimeout, `freeze: browser did not emit a real document ${type} event`, 25);
  let frozen = false, focusDisabled = false, hidden = false, bindingInstalled = false;
  return withCleanup(async () => {
    await send('Page.enable');
    await send('Page.setLifecycleEventsEnabled', { enabled: true });
    await send('Runtime.enable');
    await send('Runtime.addBinding', { name: bindingName });
    bindingInstalled = true;
    await page.evaluate((bindingName) => window.__qaWorker.armFreeze({ bindingName }), bindingName);
    // Playwright's owner session holds a stay-visible capture handle. Another CDP session cannot release it.
    focusDisabled = true;
    await focus(false);
    hidden = true;
    await hideForFreeze(page, cdp, options.ackTimeout, evidence);
    evidence.freezeRequestedUTC = new Date().toISOString();
    frozen = true;
    await send('Page.setWebLifecycleState', { state: 'frozen' });
    const froze = await observed('freeze');
    assert(froze.trusted === true && froze.visibility === 'hidden', 'freeze: expected a trusted document freeze event while hidden');
    evidence.freezeConfirmedUTC = new Date().toISOString();
    const start = performance.now();
    await withCleanup(async () => { await sleep(15000, signal); }, async () => {
      evidence.frozenForMs = performance.now() - start;
      evidence.resumeRequestedUTC = new Date().toISOString();
      await send('Page.setWebLifecycleState', { state: 'active' });
      frozen = false;
      evidence.resumeConfirmedUTC = new Date().toISOString();
    }, (e) => evidence.cleanupErrors.push(e.message));
    const resumed = await observed('resume');
    assert(resumed.trusted === true, 'freeze: expected a trusted document resume event');
    await restoreVisibility(page, cdp, options.headed, options.ackTimeout, evidence);
    hidden = false;
    evidence.visibleConfirmedUTC = new Date().toISOString();
    const f = await poll(() => page.evaluate(() => window.__qaWorker.freeze), (f) => f?.advancedAt != null,
      Math.max(3000, options.ackTimeout), 'no sim-day advance after page became visible', 25);
    evidence.lifecycle = f;
    const elapsed = resumeDelay(f);
    assert(evidence.frozenForMs >= 15000, `freeze lasted only ${evidence.frozenForMs} ms`);
    assert(f.resumedAt - f.frozenAt >= 15000, `document lifecycle freeze lasted only ${f.resumedAt - f.frozenAt} ms`);
    await assertNoCrashOverlay(page, 'crash overlay after freeze');
    return `frozen ${evidence.frozenForMs.toFixed(0)} ms; ${f.framesDuringFreeze.length} frames while frozen; day advanced ${elapsed.toFixed(1)} ms after later of resume/visible; page-clock freeze/resume/visible = ${[f.frozenAt, f.resumedAt, f.visibleAt].map((t) => t.toFixed(1)).join('/')} ms`;
  }, async () => {
    const failures = [];
    const attempt = async (fn) => { try { await fn(); } catch (e) { failures.push(e.message); } };
    if (frozen) await attempt(() => send('Page.setWebLifecycleState', { state: 'active' }));
    if (!page.isClosed()) {
      if (hidden) await attempt(() => restoreVisibility(page, cdp, options.headed, options.ackTimeout, evidence));
      await attempt(async () => { evidence.lifecycle = await page.evaluate(() => window.__qaWorker?.freeze); });
      await attempt(async () => {
        if (await page.evaluate(() => document.visibilityState) === 'visible') await d.speed(0);
        else evidence.cleanupSkipped = 'speed button: page is hidden; do not wait for rAF-based click stability';
      });
    }
    if (bindingInstalled) await attempt(() => send('Runtime.removeBinding', { name: bindingName }));
    cdp.off('Runtime.bindingCalled', onBinding);
    cdp.off('Page.lifecycleEvent', onLifecycle);
    if (focusDisabled && !page.isClosed()) await attempt(async () => { await focus(true); evidence.focusEmulationRestored = true; });
    await attempt(() => cdp.detach());
    evidence.cleanupErrors.push(...failures);
    assert(!failures.length, `freeze cleanup: ${failures.join('; ')}`);
  }, (e) => d.cleanupErrors.push(e.message));
}
