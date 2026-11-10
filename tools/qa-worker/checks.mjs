import { assert, COMMANDS, PANELS, CHECKS, commandCheck, poll, withCleanup, validateSession } from './harness.mjs';
import { Driver } from './driver.mjs';
import { pointer, savedMarkers } from './page.mjs';
import { verifyReplica } from './w1.mjs';
import { assertNoCrashOverlay, freeze } from './freeze.mjs';

const W1 = 'local host: use --w1 to include the shared digest and protector gates';
export const BROWSER_CHECKS = [
  'host ready', ...COMMANDS.map(commandCheck),
  'fixture / grow a neighbourhood', 'save / reload / Continue', 'freeze 15 s / resume 1 s',
  ...PANELS.map((id) => `Appendix A / ${id} panel`), 'recovery journal', CHECKS.ghosts, CHECKS.packets, CHECKS.recovery,
  'protector at boot', 'protector after freeze', 'replica verify', 'protector at end', 'all command acknowledgements', 'no crash overlay',
  'other command acknowledgements',
  CHECKS.onboarding, CHECKS['speed-keys'], CHECKS['info-demolish'], CHECKS.exit, CHECKS['data-view'], 'Appendix A / error overlay Pause',
];

export async function runChecks(page, options, report, protectors, signal) {
  const d = new Driver(page, options);
  let growable, fixture, saved;
  await report.check('host ready', async () => {
    const q = new URLSearchParams({ quickstart: '1', size: '256', terrain: 'flat', difficulty: 'sandbox', seed: '7',
      simworker: { local: '0', loopback: 'loopback', worker: '1' }[options.host] });
    await page.goto(options.url + '?' + q, { waitUntil: 'load', timeout: options.bootTimeout });
    await d.ready();
    const state = await page.evaluate(() => {
      const s = window.__metropolis.city.scene;
      const gl = s.ctx.world.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { kind: s.host.kind, size: s.host.state.size, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    });
    report.details.graphics = state;
    assert(state.size === 256, `expected 256 cells, got ${state.size}`);
    if (!options.swiftshader) assert(!/swiftshader|llvmpipe|software|Microsoft Basic Render Driver|\bWARP\b/i.test(state.renderer), `real-GPU run got software renderer: ${state.renderer}`);
    return `__ready, ${state.kind}, 256 cells, real actions/views; ${state.renderer}`;
  });
  if (!report.passed('host ready')) {
    return;
  }
  const protector = async (name) => {
    if (!options.w1) report.add(name, 'SKIPPED', W1);
    else await report.check(name, () => protectors.check(options.host === 'worker'));
  };
  await protector('protector at boot');
  await report.check(CHECKS.onboarding, async () => {
    const rows = await d.onboardingPlay();
    assert(rows.some((r) => r.args[0] === 1 && r.args[1] === 'onboarding'), 'Onboarding Play lost its speed/source');
    await d.speed(0);
    return 'Onboarding Play sends setSpeed(1, onboarding) and acknowledges';
  });
  const onboard = page.locator('.onboard.show button[title="Dismiss"]');
  if (await onboard.count()) await onboard.click();

  await report.check('setSpeed', async () => {
    await d.speed(2);
    const rows = await d.command('setSpeed', () => page.keyboard.press('Space'));
    assert(rows.some((r) => r.args[0] === 0 && r.args[1] === 'keyboard'), 'Space did not send setSpeed(0, keyboard)');
    assert(await page.evaluate(() => window.__metropolis.city.scene.host.speed === 0), 'Space did not pause');
    return 'TopBar and keyboard tickets acknowledged; speed mirror follows';
  });
  await report.check(CHECKS['speed-keys'], async () => {
    await d.clean();
    for (const value of [1, 2, 3]) {
      const rows = await d.command('setSpeed', () => page.keyboard.press(String(value)));
      assert(rows.some((r) => r.args[0] === value && r.args[1] === 'keyboard'), `key ${value} lost its speed/source`);
      assert(await page.evaluate((v) => window.__metropolis.city.scene.host.speed === v, value), `key ${value} did not update the speed`);
    }
    await d.speed(0);
    return 'keys 1, 2 and 3 acknowledged and changed the speed mirror';
  });
  await report.check('resume', async () => {
    await d.clean(); await d.speed(2);
    await page.keyboard.press('Escape');
    await page.locator('.pause-menu').waitFor();
    const rows = await d.command('resume', () => page.locator('.pause-menu button').filter({ hasText: 'Resume' }).click());
    assert(rows[0].args[0] === 'pause', 'resume lost its source');
    assert(await page.evaluate(() => window.__metropolis.city.scene.host.speed === 2), 'PauseMenu did not restore fast speed');
    await d.speed(0);
    return 'PauseMenu resume(pause) acknowledged and restored speed 2';
  });

  await report.check('zone', async () => {
    await d.draw('zone', 'zone:1', [140, 140], [145, 143]);
    await checkRect(page, 'zone', [140, 140, 146, 144], 1);
    return 'drag committed residential zoning, with issuing-tool gesture and ack';
  });
  await report.check('dezone', async () => {
    await d.draw('dezone', 'dezone', [140, 140], [145, 143]);
    await checkRect(page, 'zone', [140, 140, 146, 144], 0);
    return 'same rectangle cleared after ack';
  }, ['zone']);
  if (options.host === 'local') report.add(CHECKS.ghosts, 'SKIPPED', 'LocalSimHost has no pending replica edits or ghosts');
  else await report.check(CHECKS.ghosts, async () => {
    await d.clean(); await d.speed(0); await d.select('zone:1'); await d.focus([142, 154], [144, 154]);
    const points = [await d.point([142, 154]), await d.point([144, 154])], start = await d.mark();
    // Both strokes use real canvas handlers in one task, before loopback/worker can replay either Ack.
    const pending = await page.evaluate((points) => {
      const s = window.__metropolis.city.scene;
      for (const point of points) for (const type of ['pointermove', 'pointerdown', 'pointerup']) {
        s.ctx.canvas.dispatchEvent(new PointerEvent(type, { ...point, bubbles: true, cancelable: true, pointerId: 1,
          pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      }
      return { count: s.host.pending.count, claim: s.host.pending.claims({ x0: 142, z0: 154, x1: 143, z1: 155 }) };
    }, points);
    assert(pending.count === 2 && pending.claim === 'waiting', `missing pending reservations/claims: ${JSON.stringify(pending)}`);
    const rows = await d.acks('zone', start, { gesture: true });
    assert(rows.length === 2 && rows[0].exact && !rows[1].exact && rows[1].predicted?.provisional, 'second stroke did not use a provisional prediction');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    const evidence = await page.evaluate((seqs) => {
      const q = window.__qaWorker, h = window.__metropolis.city.scene.host;
      return { ghosts: q.ghosts.filter((g) => seqs.includes(g.seq)), previews: q.previews, pending: h.pending.count,
        meshes: window.__metropolis.city.scene.ctx.world.pendingPreviews.size };
    }, rows.map((r) => r.seq));
    for (const row of rows) {
      const gs = evidence.ghosts.filter((g) => g.seq === row.seq);
      assert(gs.length === 2 && gs[0].geometry && gs[0].visible && gs[0].pending > 0, `ghost was not drawn for ${row.seq}`);
      assert(gs[1].geometry === null && gs[1].applied >= row.seq && !gs[1].visible, `ghost cleared before Ack replay for ${row.seq}`);
    }
    assert(evidence.previews.some((p) => p.pending > 0 && p.claim === 'waiting'), 'hover preview was suppressed while an edit was pending');
    assert(evidence.pending === 0 && evidence.meshes === 0, 'settled gestures left reservations or ghost meshes');
    await checkRect(page, 'zone', [142, 154, 143, 155], 1); await checkRect(page, 'zone', [144, 154, 145, 155], 1);
    report.details.pendingGhosts = { ...evidence, pendingDuringInput: pending, sequences: rows.map((r) => r.seq) };
    return '2 real strokes: exact then provisional; 2 visible ghosts retained through Ack; hover/claims active; 0 reservations/meshes after settlement';
  });
  for (const [op, id, layer, z, value] of [
    ['buildNetwork', 'net:2', 'network', 145, 2],
    ['buildPowerLine', 'power', 'powerLines', 147, 1],
    ['buildSubway', 'subway', 'subway', 149, 1],
  ]) await report.check(op, async () => {
    await d.draw(op, id, [140, z], [145, z]);
    await checkRect(page, layer, [140, z, 146, z + 1], value);
    return 'NetworkTool drag, gesture, ack and every path cell verified';
  });
  let park;
  await report.check('plop', async () => { park = await d.plop('park_small', 150, 140); return `PlopTool ack created building ${park.id}`; });
  await report.check('bulldoze', async () => {
    await d.draw('bulldoze', 'bulldoze', [park.x, park.z]);
    assert(await page.evaluate((id) => !window.__metropolis.city.scene.host.state.buildings.has(id), park.id), 'bulldoze ack left the park standing');
    return 'RectTool gesture acknowledged; park removed';
  }, ['plop']);
  await report.check(CHECKS['info-demolish'], async () => {
    const b = await d.plop('park_small', 152, 140);
    await d.query(b);
    const rows = await d.command('bulldoze', () => page.locator('.info-actions button').filter({ hasText: /^Demolish/ }).click());
    assert(rows[0].gesture > 0 && rows[0].owner === 'info', 'InfoPanel demolition lost its panel-owned gesture');
    const rect = rows[0].args[0];
    assert(rect.x0 === b.x && rect.z0 === b.z && rect.x1 === b.x + b.w && rect.z1 === b.z + b.d, 'InfoPanel demolished the wrong footprint');
    assert(await page.evaluate((id) => !window.__metropolis.city.scene.host.state.buildings.has(id), b.id), 'InfoPanel ack left the park standing');
    return 'QueryTool → InfoPanel Demolish: panel gesture, footprint, ack and removal verified';
  });
  await report.check('plantTrees', async () => {
    // Clear existing forest through the bulldozer so the trees command must do useful work.
    const clearing = await d.command('bulldoze', () => d.stroke('bulldoze', [158, 138], [165, 145]), { gesture: true, allowFailure: true });
    assert(clearing.every((r) => r.result.ok || r.result.reason === 'Nothing to bulldoze'), 'tree fixture could not be cleared');
    const rows = await d.command('plantTrees', () => d.stroke('trees', [162, 142], [162, 142], 150), { gesture: true, allowFailure: true });
    assert(rows.some((r) => r.result.ok) && rows.every((r) => r.result.ok || r.result.reason === 'No room for trees here'), 'tree stroke did not plant successfully');
    assert(await page.evaluate(() => window.__metropolis.city.scene.host.state.trees[142 * 256 + 162] >= 3), 'tree ack did not plant the centre');
    return 'BrushTool tree stroke acknowledged and planted trees';
  });
  await report.check('terraform / held brush reaches flat', async () => heldBrush(d));

  await report.check('setTax', async () => {
    await d.panel('budget');
    const slider = page.locator('.tax-row:not(.master) input[type=range]').first();
    await slider.focus();
    const rows = await d.command('setTax', () => page.keyboard.press('ArrowRight'));
    const [dev, value] = rows.at(-1).args;
    assert(await page.evaluate(([dev, value]) => window.__metropolis.city.scene.host.state.budget.taxRates[dev] === value, [dev, value]), 'tax mirror did not match the acked input');
    return `BudgetPanel input acknowledged: dev ${dev} = ${value}%`;
  });
  await report.check('setFunding', async () => {
    await d.panel('budget');
    await page.locator('.panel .tabs button').filter({ hasText: /^Services$/ }).click();
    await page.locator('.fund-row input[type=range]').first().focus();
    const rows = await d.command('setFunding', () => page.keyboard.press('ArrowRight'));
    const [service, value] = rows.at(-1).args;
    assert(await page.evaluate(([s, v]) => window.__metropolis.city.scene.host.state.budget.funding[s] === v, [service, value]), 'funding mirror did not match');
    return `BudgetPanel input acknowledged: ${service} = ${value}%`;
  });
  await report.check('takeLoan', async () => {
    await d.panel('budget');
    await page.locator('.panel .tabs button').filter({ hasText: /^Loans$/ }).click();
    const rows = await d.command('takeLoan', () => page.locator('.loan-actions button:not([disabled])').first().click());
    const amount = rows[0].args[0];
    assert(await page.evaluate((a) => window.__metropolis.city.scene.host.state.budget.loans.some((l) => l.principal === a), amount), 'loan ack did not add loan');
    return `BudgetPanel borrowed ${amount}; ack and loan list verified`;
  });
  await report.check('repayLoan', async () => {
    const rows = await d.command('repayLoan', () => page.locator('.loan-row button').first().click());
    const guard = rows[0].args[1];
    assert(Number.isFinite(guard?.principal) && Number.isFinite(guard?.monthsLeft), 'repayment did not carry its loan guard');
    assert(await page.evaluate(() => window.__metropolis.city.scene.host.state.budget.loans.length === 0), 'repayment ack left the loan');
    return 'guarded BudgetPanel repayment acknowledged; loan removed';
  }, ['takeLoan']);
  await report.check('setOrdinance', async () => {
    await d.panel('ordinances');
    const rows = await d.command('setOrdinance', () => page.locator('.panel .li:not(.locked) [role=switch]:not([disabled])').first().click());
    const [id, on] = rows[0].args;
    assert(await page.evaluate(([id, on]) => window.__metropolis.city.scene.host.state.budget.ordinances.includes(id) === on, [id, on]), 'ordinance ack did not update the list');
    return `OrdinancesPanel ${id} = ${on} acknowledged`;
  });
  await report.check('setSettings', async () => {
    await d.panel('settings');
    const row = page.locator('.set-row').filter({ has: page.locator('.sr-l').filter({ hasText: /^Emergency alerts$/ }) });
    const rows = await d.command('setSettings', () => row.locator('button').filter({ hasText: /^All$/ }).click());
    assert(rows.some((r) => r.args[0]?.emergencyAlerts === 'all'), 'Settings did not send the selected policy');
    assert(await page.evaluate(() => window.__metropolis.city.scene.host.pending.count === 0), 'settings incorrectly counted as a preview edit');
    return 'Settings → Emergency alerts All; setSettings void ticket acknowledged without a pending preview';
  });

  await report.check('fixture / grow a neighbourhood', async () => {
    await d.clean(); await d.speed(0);
    await d.road([0, 128], [138, 128]);
    await d.plop('util_wind_turbine', 50, 127);
    await d.plop('util_wind_turbine', 55, 127);
    await d.plop('util_water_tower', 60, 127);
    const station = await d.plop('civ_fire_station', 70, 126);
    await d.plop('civ_fire_station', 76, 126);
    // 4.5 / 5.3 road minutes from the nearest station: beyond auto range (3.9), inside the fire's six-day deadline.
    const fireSite = await d.plop('park_small', 122, 127);
    const secondSite = await d.plop('park_small', 130, 127);
    await d.draw('zone', 'zone:1', [84, 123], [103, 127]);
    await d.draw('zone', 'zone:4', [84, 129], [93, 132]);
    await d.draw('zone', 'zone:8', [106, 129], [115, 132]);
    growable = await d.grow(); fixture = { station, fireSite, secondSite };
    return `all construction through tools; simulation grew building ${growable.id}`;
  });
  await report.check('setHistoric', async () => {
    await d.query(growable);
    const rows = await d.command('setHistoric', () => page.locator('.info-actions button').filter({ hasText: 'Make historic' }).click());
    assert(rows[0].args[0] === growable.id && rows[0].args[1] === true, 'inspector targeted the wrong historic building');
    assert(await page.evaluate((id) => !!(window.__metropolis.city.scene.host.state.buildings.get(id)?.flags & 64), growable.id), 'historic bit was not set');
    return 'QueryTool → InfoPanel → idempotent setHistoric acknowledged';
  }, ['fixture / grow a neighbourhood']);

  if (options.host === 'local') report.add(CHECKS.recovery, 'SKIPPED', 'LocalSimHost uses snapshot recovery; the command journal belongs to packet hosts');
  else await report.check(CHECKS.recovery, async () => {
    const rows = await d.draw('zone', 'zone:1', [146, 154]);
    const journal = await page.evaluate(() => {
      const h = window.__metropolis.city.scene.host;
      if (!h.recovery) throw new Error('packet host RecoveryMirror is unavailable');
      // The real App lifecycle handler writes the encoded mirror; no city serialization or command bypass.
      try {
        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        return JSON.parse(localStorage.getItem('metropolis.recovery.journal'));
      } finally { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); }
    });
    assert(journal?.v === 1 && journal.ops.some((op) => op.seq === rows[0].seq && op.op === 'zone'), 'pagehide did not journal the UI edit');
    assert(journal.ops.every((op, i) => op.seq > journal.fromCmd && (!i || op.seq > journal.ops[i - 1].seq)), 'journal suffix has invalid watermarks/order');
    assert(!journal.ops.some((op) => ['setCamera', 'setSpeed', 'setSettings', 'triggerDisaster', 'dispatch'].includes(op.op)), 'journal retained an excluded command');
    report.details.recoveryJournal = journal;
    return `App pagehide wrote ${journal.ops.length} whitelisted edits bound to ${journal.base.kind}; UI zone seq ${rows[0].seq} retained`;
  }, ['zone']);

  await report.check('setCamera / Ctrl+S save', async () => {
    await d.clean(); await d.speed(0);
    await d.focus([168, 168]);
    const mark = await d.mark(), saveMark = await page.evaluate(() => window.__qaWorker.saves.length);
    const hostSaveMark = await page.evaluate(() => window.__qaWorker.hostSaves.length);
    await page.keyboard.press('Control+s');
    const save = await poll(() => page.evaluate((n) => window.__qaWorker.saves.slice(n).find((s) => !s.auto), saveMark), Boolean,
      options.ackTimeout, 'Ctrl+S did not call CityScene.save(false)');
    const rows = await d.acks('setCamera', mark, { save: save.id });
    assert(rows.some((r) => r.save === save.id), 'Ctrl+S did not issue setCamera inside its save call; periodic storeCamera does not count');
    await page.waitForFunction(() => {
      const a = window.__metropolis, s = a.city.scene;
      return !s.saving && !a.city.saving && !a.city.saveFailed && document.querySelector('.save-pill.done')?.textContent.includes('City saved');
    }, null, { timeout: options.bootTimeout });
    assert(rows.some((r) => r.args[0]?.distance > 0), 'save did not post a valid camera');
    const hostSave = await poll(() => page.evaluate((n) => window.__qaWorker.hostSaves.slice(n).find((s) => s.reason === 'manual'), hostSaveMark),
      (s) => s?.status === 'resolved', options.ackTimeout, 'Ctrl+S did not receive host.save(manual) acknowledgement');
    assert(hostSave.ack.cmd >= Math.max(...rows.map((r) => r.seq)), 'saved reply predates its camera command');
    if (options.host !== 'local') assert(hostSave.applied >= hostSave.ack.cmd, 'saved reply arrived before its commands replayed');
    saved = await page.evaluate(savedMarkers);
    report.details.savedMarkers = saved;
    report.details.ctrlSave = { ...await page.evaluate((id) => window.__qaWorker.saves.find((s) => s.id === id), save.id), hostSave, cameraSeqs: rows.map((r) => r.seq) };
    return 'Ctrl+S: its own camera ticket and host.save(manual) reply acknowledged in order; persistence completed';
  });
  await report.check('save / reload / Continue', async () => {
    // quickstart deletes the old region on boot. Reload the title route in the SAME storage context.
    await page.evaluate(() => {
      const url = new URL(location.href);
      for (const k of ['quickstart', 'size', 'terrain', 'difficulty', 'seed']) url.searchParams.delete(k);
      history.replaceState(null, '', url);
      window.__qaWorker.dispose();
    });
    await d.archive();
    if (protectors) await protectors.beforeReload(options.host === 'worker');
    await page.reload({ waitUntil: 'load', timeout: options.bootTimeout });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: options.bootTimeout });
    await page.evaluate(() => { window.__ready = false; });
    await page.locator('.menu-item').filter({ hasText: /^Continue/ }).click();
    await d.ready({ pauseOnArrival: true });
    const loaded = await page.evaluate(savedMarkers);
    report.details.loadedMarkers = loaded;
    assert(JSON.stringify(loaded) === JSON.stringify(saved), `saved player edits changed on Continue: ${JSON.stringify({ saved, loaded })}`);
    const view = await page.evaluate(() => {
      const c = window.__metropolis.city.scene.ctx.world.controls;
      return { x: c.target.x, z: c.target.z, distance: c.distance, yaw: c.yawAngle * 180 / Math.PI, tilt: c.baseTilt * 180 / Math.PI };
    });
    report.details.restoredCamera = view;
    for (const k of ['x', 'z', 'distance', 'yaw', 'tilt']) assert(Number.isFinite(view[k]) && Math.abs(view[k] - saved.camera[k]) <= (k === 'distance' ? 1 : .2), `restored camera ${k}: ${view[k]} != ${saved.camera[k]}`);
    const day = await page.evaluate(() => window.__metropolis.city.scene.host.state.day);
    await d.speed(3);
    await page.waitForFunction((day) => window.__metropolis.city.scene.host.state.day > day, day, { timeout: options.ackTimeout });
    await d.speed(0);
    return 'Continue waited for fresh views; day, funds, nextBuildingId, camera, layers and player edits preserved; sim advanced';
  }, ['setCamera / Ctrl+S save']);

  await report.check(CHECKS.exit, async () => {
    await d.clean(); await d.speed(0); await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__ready = false; });
    const rows = await d.command('setSpeed', () => page.locator('.pause-menu button').filter({ hasText: 'Save & exit to region' }).click());
    assert(rows.some((r) => r.args[0] === 0 && r.args[1] === 'exit'), 'exit did not acknowledge setSpeed(0, exit)');
    await page.waitForFunction(() => !window.__metropolis.city, null, { timeout: options.bootTimeout });
    await page.locator('.rc-item').first().waitFor();
    await page.waitForFunction(() => window.__ready === true, null, { timeout: options.bootTimeout });
    assert(await page.evaluate(() => window.__qaWorkerArchive?.abortReason === 'dispose'), 'exited city did not abort(dispose)');
    const teardown = await page.evaluate(() => window.__qaWorkerArchive.teardown);
    assert(teardown.aborted && teardown.pending === 0 && teardown.ghosts === 0, `city teardown retained pending work: ${JSON.stringify(teardown)}`);
    report.details.teardown = teardown;
    await d.archive();
    await page.evaluate(() => { window.__ready = false; });
    await page.locator('.rc-item').first().dblclick();
    await d.ready({ pauseOnArrival: true });
    return 'PauseMenu saved and exited to region; old city aborted; region city double-click returned to playable views';
  });
  if (!options.w1) report.add('replica verify', 'SKIPPED', W1);
  else await report.check('replica verify', async () => {
    await d.clean(); await d.speed(0);
    await drain(page, options.ackTimeout);
    return verifyReplica(page, options.digestAsset ? new URL(options.digestAsset, options.url).href : null, options.ackTimeout);
  });

  await report.check('triggerDisaster', async () => {
    await d.clean(); await d.speed(0);
    const b = fixture.fireSite;
    const rows = await d.command('triggerDisaster', () => d.stroke('disaster:fire', [b.x, b.z]));
    assert(rows[0].result === true, 'DisasterTool fire did not start');
    assert(await page.evaluate((id) => !!(window.__metropolis.city.scene.host.state.buildings.get(id)?.flags & 8), b.id), 'fire ack did not mark the building');
    fixture.incident = await incidentFor(page, b.id);
    return 'DisasterTool fire ticket resolved true; site is on fire';
  }, ['fixture / grow a neighbourhood']);
  await report.check('dismissAlert', async () => {
    // Exercise a separate site's close button while the stations still have free units for its alert.
    const b = await d.plop('park_small', 135, 127);
    await d.command('triggerDisaster', () => d.stroke('disaster:fire', [b.x, b.z]));
    const incident = await incidentFor(page, b.id);
    assert(incident !== fixture.incident, 'dismissal fire clustered into the first incident');
    fixture.dismissIncident = incident;
    const rows = await d.command('dismissAlert', () => d.banner(incident, 'dismiss'));
    assert(rows[0].args[0] === incident, 'Dismiss targeted the wrong alert');
    assert(await page.evaluate((id) => !window.__metropolis.city.scene.host.policy.alerts.some((a) => a.id === id), incident), 'dismissed alert returned after Ack');
    return 'separate fire banner close button acknowledged dismissAlert; alert absent after replay';
  }, ['triggerDisaster']);
  await report.check('dispatch', async () => {
    await d.banner(fixture.incident, 'choose');
    await poll(() => page.evaluate(() => {
      const t = window.__metropolis.city.scene.tools.active;
      return { id: t.id, incident: t.inc };
    }), (t) => t.id === 'dispatch' && t.incident === fixture.incident, options.ackTimeout, 'Choose station did not activate DispatchTool for the banner incident');
    const b = fixture.station;
    report.details.dispatchReady = await d.waitForDispatch(fixture.incident, b.id);
    const rows = await d.command('dispatch', () => d.strokeActive([b.x, b.z]), { tag: true });
    assert(rows[0].args[0] === fixture.incident, 'DispatchTool sent to the wrong incident');
    assert(rows[0].result.sent > 0 && Number.isFinite(rows[0].result.etaMin), 'dispatch ack did not send a unit on a route');
    return 'banner Choose station → DispatchTool pointer; issuing tag preserved, sent/ETA ack verified';
  }, ['triggerDisaster']);
  await report.check('dispatchBest', async () => {
    const b = fixture.secondSite;
    await d.clean(); await d.speed(0);
    await d.command('triggerDisaster', () => d.stroke('disaster:fire', [b.x, b.z]));
    const incident = await incidentFor(page, b.id);
    assert(incident !== fixture.incident && incident !== fixture.dismissIncident, 'Send nearest fire reused another incident');
    fixture.secondIncident = incident;
    const rows = await d.command('dispatchBest', () => d.banner(incident, 'send'));
    assert(rows[0].args[0] === incident, `Send nearest targeted ${rows[0].args[0]}, expected second fire ${incident}`);
    assert(rows[0].result.sent > 0 && Number.isFinite(rows[0].result.etaMin), 'Send nearest ack did not send a unit');
    return 'EmergencyBanner Send nearest acknowledged; sent/ETA verified';
  }, ['dispatch']);
  await report.check(CHECKS.packets, async () => {
    await drain(page, options.ackTimeout);
    const evidence = await page.evaluate(() => ({ events: window.__qaWorker.events, packets: window.__qaWorker.packets, commands: window.__qaWorker.commands }));
    const dispatch = evidence.commands.find((r) => r.op === 'dispatch' && r.status === 'resolved');
    assert(dispatch && evidence.events.some((e) => e.type === 'emergency' && e.event.type === 'dispatched' && e.seq === dispatch.seq && e.tagMatches), 'dispatch cause did not replay with the issuing tool tag');
    assert(await page.evaluate(() => window.__metropolis.city.scene.host.cause === null), 'cause leaked outside command replay');
    if (options.host !== 'local') {
      const replies = evidence.packets.flatMap((p) => p.replies ?? []);
      assert(replies.some((r) => r.t === 'qres'), 'no query reply observed inside a packet');
      assert(evidence.packets.every((p) => p.causeCleared !== false && (p.replies ?? []).every((r) => r.cmd <= p.applied)), 'reply arrived ahead of the replica or cause leaked');
      assert(!evidence.packets.some((p) => p.resync), 'unexpected resync during healthy acceptance');
    }
    report.details.packetEvidence = evidence;
    return 'dispatch event has the original seq/tag; cause cleared; packet reply watermarks never exceed applied commands; 0 unexpected resyncs';
  }, ['dispatch']);

  for (const id of PANELS) {
    await report.check(`Appendix A / ${id} panel`, async () => {
      await d.panel(id);
      const text = await page.locator('.panel:visible .panel-body').innerText();
      assert(text.trim().length > 0 || await page.locator('.panel:visible canvas, .panel:visible svg').count() > 0, 'empty panel');
      return 'toolbar/TopBar click opens the real panel and renders content';
    });
  }
  await report.check(CHECKS['data-view'], async () => {
    await d.panel('dataviews');
    await page.locator('.dv-btn').filter({ hasText: /^None$/ }).click();
    await page.locator('.dv-btn').filter({ hasText: /^Power$/ }).click();
    assert(await page.evaluate(() => window.__metropolis.city.scene.ctx.overlay !== 0), 'Power data view did not change the overlay');
    assert(await page.locator('.dv-btn.on').filter({ hasText: /^Power$/ }).count() === 1, 'Power data-view button is not selected');
    await page.locator('.dv-btn').filter({ hasText: /^None$/ }).click();
    assert(await page.evaluate(() => window.__metropolis.city.scene.ctx.overlay === 0), 'None did not clear the data view');
    return 'Data toolbar → Power view → None; overlay state and selected view verified';
  });
  report.add('Appendix A / error overlay Pause', 'SKIPPED', 'healthy production fixture has no error card; injecting an app error would violate the zero-console-errors gate; exercise this path in a separate error fixture');
  report.add('recovery journal', 'SKIPPED', 'close-page worker journal restore is the W1.3/T039 browser gate; current loopback mirror write is checked separately');
  await protector('protector at end');
  await report.check('all command acknowledgements', async () => {
    await drain(page, options.ackTimeout);
    const current = await page.evaluate(() => window.__qaWorker.commands);
    const rows = [...d.sessions.flat(), ...current];
    report.details.commands = rows;
    const missing = COMMANDS.filter((op) => !rows.some((r) => r.op === op && r.seq > 0 && r.status === 'resolved'));
    assert(missing.length === 0, `commands without an ack: ${missing.join(', ')}`);
    assert(rows.every((r) => r.status === 'resolved'), `unsettled or rejected tickets: ${JSON.stringify(rows.filter((r) => r.status !== 'resolved'))}`);
    for (const session of [...d.sessions, current]) validateSession(session);
    const gestures = [...d.archives.flatMap((a) => a.gestures ?? []), ...await page.evaluate(() => window.__qaWorker.gestures)];
    assert(gestures.every((g) => g.settled && g.failures <= 1), 'gesture did not settle or issued more than one failure correction');
    report.details.gestures = gestures;
    if (options.dropAck) assert(rows.some((r) => r.dropped), `negative control ${options.dropAck} was never exercised`);
    return `all ${COMMANDS.length} UI commands have transported acknowledgements; exact refusals classified separately; only slider coalescing shares seqs; ${gestures.length} gestures settled with at most one failure each`;
  });
  await report.check('no crash overlay', async () => {
    await assertNoCrashOverlay(page, 'crash overlay');
    return 'no error cards, crash dialog or crashed city';
  });
  if (options.breakAck) await report.check('other command acknowledgements', async () => {
    const rows = await poll(async () => [...d.sessions.flat(), ...await page.evaluate(() => window.__qaWorker.commands)].filter((r) => r.op !== options.breakAck),
      (rows) => rows.every((r) => r.status !== 'pending'), options.ackTimeout, 'a different command also has a missing acknowledgement');
    assert(rows.every((r) => r.status === 'resolved'), `other command failed: ${JSON.stringify(rows.filter((r) => r.status !== 'resolved'))}`);
    return `all ${rows.length} observed tickets outside ${options.breakAck} resolved`;
  });
  else report.add('other command acknowledgements', 'SKIPPED', 'separate isolation check used only by --break-ack; full runs use all command acknowledgements');
  // Freeze is the last behavioural check; a failed thaw cannot cascade into unrelated UI gates.
  await report.check(CHECKS.freeze, () => freeze(d, report, signal));
  if (options.w1 && !report.passed(CHECKS.freeze)) report.add('protector after freeze', 'SKIPPED', 'freeze did not pass or was not selected');
  else await protector('protector after freeze');
  // Preserve diagnostics even when an acknowledgement gate failed.
  report.details.commands = [...d.sessions.flat(), ...await page.evaluate(() => window.__qaWorker?.commands ?? [])];
  report.details.sessions = d.archives;
  report.details.cleanupErrors = d.cleanupErrors;
}

async function incidentFor(page, buildingId) {
  const id = await poll(() => page.evaluate((id) => window.__metropolis.city.scene.host.emergency.incidents().find((i) => i.buildingId === id)?.id, buildingId),
    Number.isSafeInteger, 8000, `fire at building ${buildingId} has no mirrored incident`);
  assert(Number.isSafeInteger(id), `fire at building ${buildingId} has no incident`);
  return id;
}

async function checkRect(page, layer, rect, value) {
  const bad = await page.evaluate(({ layer, rect: [x0, z0, x1, z1], value }) => {
    const st = window.__metropolis.city.scene.host.state;
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (st[layer][z * st.size + x] !== value) return { x, z, got: st[layer][z * st.size + x] };
    return null;
  }, { layer, rect, value });
  assert(!bad, `${layer} state mismatch: ${JSON.stringify(bad)} (expected ${value})`);
}

async function drain(page, timeout) {
  await poll(() => page.evaluate(() => window.__qaWorker.commands.filter((r) => r.status === 'pending').map((r) => ({ op: r.op, seq: r.seq }))),
    (xs) => xs.length === 0, timeout, 'commands still awaiting acknowledgements');
}

async function heldBrush(d) {
  const { page, options } = d;
  await d.clean(); await d.speed(0); await d.select('terra:raise');
  // Use the real options sliders, not the BrushTool's module variables.
  const sliders = page.locator('.tool-opts input[type=range]');
  await sliders.nth(0).focus(); await page.keyboard.press('Home');
  await sliders.nth(1).focus(); await page.keyboard.press('End');
  const raised = await d.mark();
  await d.stroke('terra:raise', [176, 146], [176, 146], async () => {
    // Wait for paid mutations, not a frame-rate-dependent pointer duration.
    try {
      await poll(() => d.rows('terraform', raised), (rows) => rows.filter((r) => r.status === 'resolved' && r.result?.ok).length >= 3,
        options.ackTimeout, 'raise fixture did not acknowledge three applications');
    } catch (e) { await d.acks('terraform', raised, { gesture: true }); throw e; }
  });
  await d.acks('terraform', raised, { gesture: true });
  await d.select('terra:level'); await d.focus([177, 146]);
  const point = await d.point([177, 146]);
  const mark = await page.evaluate(() => ({ commands: window.__qaWorker.commands.length, sounds: window.__qaWorker.sounds.length, toasts: window.__qaWorker.toasts.length }));
  await page.evaluate(pointer, { type: 'pointerdown', point });
  await withCleanup(async () => {
    await poll(() => d.rows('terraform', mark.commands), (rows) => rows.some((r) => r.result?.ok && r.result.cost > 0) && rows.filter((r) => r.result?.reason === 'Nothing to change').length >= 2,
      Math.max(20000, options.ackTimeout), 'held Level brush never reached flat', 100);
    const releases = await page.evaluate((n) => window.__qaWorker.sounds.slice(n).filter((s) => ['terraform', 'error'].includes(s.name) && !s.opts).length, mark.sounds);
    assert(releases === 0, 'brush played its release sound before pointerup');
  }, () => page.evaluate(pointer, { type: 'pointerup', point }), (e) => d.cleanupErrors.push(e.message));
  const rows = await d.acks('terraform', mark.commands, { gesture: true, allowFailure: true });
  const ids = new Set(rows.map((r) => r.gesture));
  assert(ids.size === 1, 'held brush applications used different gestures');
  assert(rows.every((r) => r.result?.ok || r.result?.reason === 'Nothing to change'), 'brush failed for a reason other than reaching flat');
  await page.waitForFunction((id) => window.__qaWorker.gestures.find((g) => g.id === id)?.settled, rows[0].gesture);
  // Let the issuing tool's settled callback run before inspecting feedback.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const feedback = await page.evaluate((m) => ({ sounds: window.__qaWorker.sounds.slice(m.sounds), toasts: window.__qaWorker.toasts.slice(m.toasts) }), mark);
  const final = feedback.sounds.filter((s) => ['terraform', 'error'].includes(s.name) && !s.opts);
  assert(final.length === 1 && final[0].name === 'terraform', `expected one successful release sound, got ${JSON.stringify(final)}`);
  const settledAt = await page.evaluate((id) => window.__qaWorker.gestures.find((g) => g.id === id).settledAt, rows[0].gesture);
  assert(Number.isFinite(settledAt) && final[0].at >= settledAt, `release sound at ${final[0].at} preceded gesture settlement at ${settledAt}`);
  assert(feedback.toasts.length === 0, `held brush toasted: ${JSON.stringify(feedback.toasts)}`);
  return `${rows.length} acknowledged applications in one settled gesture; reached Nothing to change, one release sound, zero toasts`;
}

