import { assert, poll, sleep, waitForAcks, withCleanup } from './harness.mjs';
import { installProbe, pointForCell, pointer } from './page.mjs';

export class Driver {
  constructor(page, options) { this.page = page; this.options = options; this.sessions = []; this.dropAckUsed = false; this.cleanupErrors = []; }
  async ready({ pauseOnArrival = false } = {}) {
    await this.page.waitForFunction(() => window.__metropolis?.city?.scene?.host && window.__metropolis.city.scene.ctx,
      null, { timeout: this.options.bootTimeout, polling: 25 });
    await this.page.evaluate(installProbe, { dropAck: this.dropAckUsed ? null : this.options.dropAck });
    if (pauseOnArrival && await this.page.evaluate(() => window.__metropolis.city.scene.host.speed !== 0)) {
      await this.command('setSpeed', () => this.page.keyboard.press('Space'));
    }
    await this.page.waitForFunction(() => {
      const s = window.__metropolis?.city?.scene;
      return window.__ready === true && s?.host && s.ctx?.world && s.ctx.objects && !s.ctx.world.isNull && !s.ctx.objects.isNull
        && !s.ctx.degraded.actions && !s.ctx.degraded.world && !s.ctx.degraded.objects;
    }, null, { timeout: this.options.bootTimeout });
    const kind = await this.page.evaluate(() => window.__metropolis.city.scene.host.kind);
    assert(kind === this.options.host, `requested ${this.options.host}, got ${kind}; fallback is not acceptance`);
  }
  async archive() {
    const rows = await this.page.evaluate(() => (window.__qaWorker ?? window.__qaWorkerArchive).commands);
    this.sessions.push(rows);
    this.dropAckUsed ||= rows.some((r) => r.dropped);
  }
  mark() { return this.page.evaluate(() => window.__qaWorker.commands.length); }
  rows(op, start) { return this.page.evaluate(({ op, start }) => (window.__qaWorker ?? window.__qaWorkerArchive).commands.slice(start).filter((r) => r.op === op), { op, start }); }
  acks(op, start, opts = {}) {
    return waitForAcks(async () => {
      const rows = await this.rows(op, start);
      return opts.save === undefined ? rows : rows.filter((r) => r.save === opts.save);
    }, op, this.options.ackTimeout, opts);
  }
  async command(op, input, opts) {
    const start = await this.mark();
    await input();
    return this.acks(op, start, opts);
  }
  async clean() {
    await this.page.evaluate(() => {
      const s = window.__metropolis.city.scene;
      const p = { clientX: 500, clientY: 400, pointerId: 1, button: 0, buttons: 0, bubbles: true };
      s.ctx.canvas.dispatchEvent(new PointerEvent('pointercancel', p));
      s.ctx.tools.select(null);
      s.ctx.panels.closeAll();
      s.toolbar.closeFlyout();
      if (s.pause.isOpen) s.pause.close();
      s.ctx.canvas.focus();
    });
    await this.page.waitForFunction(() => !document.querySelector('.panel.closing, .modal-back.closing'));
  }
  async select(id) {
    if (await this.page.evaluate((id) => window.__metropolis.city.scene.tools.activeId === id, id)) return;
    const routes = {
      'zone:1': ['Zones', 'Residential', 'Low density'], 'zone:4': ['Zones', 'Commercial', 'Low density'],
      'zone:8': ['Zones', 'Industrial', 'Medium density'], dezone: ['Zones', 'Other', 'De-zone'],
      'net:2': ['Transport', 'Roads', 'Road'], power: ['Utilities', 'Power', 'Power line'], subway: ['Transport', 'Rail & transit', 'Subway'],
      'terra:raise': ['Terrain', 'Terraform', 'Raise'], 'terra:level': ['Terrain', 'Terraform', 'Level'],
      trees: ['Terrain', 'Nature', 'Plant trees'], 'disaster:fire': ['Terrain', 'Disasters', 'Fire'],
      'plop:park_small': ['Parks', 'Parks & recreation', 'Small Park'],
      'plop:util_wind_turbine': ['Utilities', 'Power', 'Wind Turbine'], 'plop:util_water_tower': ['Utilities', 'Water', 'Water Tower'],
      'plop:civ_fire_station': ['Civic', 'Fire', 'Fire Station'], bulldoze: ['Bulldoze'], query: ['Query'],
    };
    const route = routes[id]; assert(route, `no reviewed toolbar route for ${id}`);
    await this.clean();
    const [category, group, label] = route, p = this.page;
    const exact = (text) => new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
    await p.locator('.tb-btn').filter({ has: p.locator('.tb-l').filter({ hasText: exact(category) }) }).click();
    if (label) {
      let scope = p.locator('.flyout.open');
      if (await scope.locator('.fly-tabs button').count()) {
        await scope.locator('.fly-tabs button').filter({ has: p.locator('span').filter({ hasText: exact(group) }) }).click();
      } else if (await scope.locator('.fly-group .sec-title').count()) {
        scope = scope.locator('.fly-group').filter({ has: p.locator('.sec-title').filter({ hasText: exact(group) }) });
      }
      await scope.locator('.fly-item').filter({ has: p.locator('.fly-name').filter({ hasText: exact(label) }) }).click();
    }
    assert(await p.evaluate((id) => window.__metropolis.city.scene.tools.activeId === id, id), `toolbar did not select ${id}`);
    await p.locator('.mp-canvas').focus();
  }
  async speed(value) {
    const title = ['Pause (Space)', 'Normal speed (1)', 'Fast (2)', 'Ultra (3)'][value];
    const rows = await this.command('setSpeed', () => this.page.locator(`.speed button[title="${title}"]`).click());
    assert(rows.some((r) => r.args[0] === value && r.args[1] === 'topbar'), `setSpeed did not carry ${value}, topbar`);
    await this.page.waitForFunction((v) => window.__metropolis.city.scene.host.speed === v, value);
  }
  async panel(id) {
    await this.clean();
    if (id === 'dataviews') await this.page.locator('.tb-btn').filter({ has: this.page.locator('.tb-l').filter({ hasText: /^Data$/ }) }).click();
    else await this.page.locator(`button[data-panel="${id}"]`).click();
    await this.page.locator('.panel:visible').waitFor();
    assert(await this.page.evaluate((id) => window.__metropolis.city.scene.panels.isOpen(id), id), `UI did not open ${id}`);
  }
  async focus(a, b = a) {
    const x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2;
    const distance = Math.max(520, Math.hypot(a[0] - b[0], a[1] - b[1]) * 16 * 2.8 + 300);
    await this.page.evaluate(({ x, z, distance }) => window.__metropolis.city.scene.ctx.focusCell(x, z, distance), { x, z, distance });
    await this.page.waitForFunction(({ x, z, distance }) => {
      const c = window.__metropolis.city.scene.ctx.world.controls;
      return Math.hypot(c.target.x - (x + .5) * 16, c.target.z - (z + .5) * 16) < .5 && Math.abs(c.distance - distance) < 2;
    }, { x, z, distance }, { timeout: this.options.bootTimeout });
  }
  point(cell) { return poll(() => this.page.evaluate(pointForCell, cell), Boolean, this.options.ackTimeout, `cannot project/pick cell ${cell}`); }
  async stroke(id, a, b = a, hold = 0) {
    await this.select(id);
    return this.strokeActive(a, b, hold);
  }
  async strokeActive(a, b = a, hold = 0) {
    await this.focus(a, b);
    const from = await this.point(a), to = await this.point(b);
    await this.page.evaluate(pointer, { type: 'pointermove', point: from });
    await this.page.evaluate(pointer, { type: 'pointerdown', point: from });
    return withCleanup(async () => {
      if (typeof hold === 'function') await hold();
      else if (hold) await sleep(hold);
      await this.page.evaluate(pointer, { type: 'pointermove', point: to });
    }, () => this.page.evaluate(pointer, { type: 'pointerup', point: to }), (e) => this.cleanupErrors.push(e.message));
  }
  async draw(op, id, a, b = a, hold = 0) {
    return this.command(op, () => this.stroke(id, a, b, hold), { gesture: true });
  }
  async plop(def, x, z) {
    await this.select('plop:' + def);
    const size = await this.page.evaluate(() => [...window.__metropolis.city.scene.tools.active.def.footprint]);
    const p = [x + (size[0] - 1) / 2 - .1, z + (size[1] - 1) / 2 - .1];
    const rows = await this.draw('plop', 'plop:' + def, p);
    const args = rows[0].args;
    assert(args[0] === def && args[1] === x && args[2] === z, `plop origin changed: ${JSON.stringify(args)}`);
    const b = await this.page.evaluate(([x, z]) => {
      const b = window.__metropolis.city.scene.host.state.buildingAt(x, z);
      return b && { id: b.id, x: b.x, z: b.z, w: b.w, d: b.d, def: b.def };
    }, [x, z]);
    assert(b?.def === def, `${def} ack did not appear at ${x},${z}`);
    return b;
  }
  async road(a, b) {
    assert(a[1] === b[1], 'fixture road must be horizontal');
    for (let x = a[0]; x < b[0]; x += 24) await this.draw('buildNetwork', 'net:2', [x, a[1]], [Math.min(x + 24, b[0]), a[1]]);
  }
  async grow() {
    await this.speed(3);
    return withCleanup(async () => {
      return await poll(() => this.page.evaluate(() => {
        const b = [...window.__metropolis.city.scene.host.state.buildings.values()].find((b) => !(b.flags & (256 | 16)) && b.built >= 1);
        return b ? { id: b.id, x: b.x, z: b.z, w: b.w, d: b.d } : null;
      }), Boolean, this.options.bootTimeout, 'no completed growable appeared from the UI-built fixture', 250);
    }, () => this.speed(0), (e) => this.cleanupErrors.push(e.message));
  }
  async banner(id, action) {
    const point = await poll(() => this.page.evaluate(({ id, action }) => {
      const b = window.__metropolis.city.scene.emgBanner.banners.get(id);
      if (!b || performance.now() <= b.settleUntil) return null;
      const button = b[action], rect = button.getBoundingClientRect();
      if (button.disabled || rect.width === 0 || rect.height === 0) return null;
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }, { id, action }), Boolean, this.options.ackTimeout, `incident ${id}: banner ${action} never settled/available`);
    await this.page.mouse.click(point.x, point.y);
  }
  async query(b) {
    await this.clean(); await this.select('query');
    const cell = [b.x + (b.w - 1) / 2 - .1, b.z + (b.d - 1) / 2 - .1];
    await this.focus(cell);
    const ground = await this.point(cell);
    const point = await this.page.evaluate(({ ground, id }) => {
      const s = window.__metropolis.city.scene;
      // A neighbour's roof may occlude the projected ground point. Use the same object/terrain picks as QueryTool.
      for (let dy = 0; dy >= -120; dy -= 6) for (let dx = -60; dx <= 60; dx += 6) {
        const clientX = ground.clientX + dx, clientY = ground.clientY + dy;
        let picked = s.ctx.objects.pickBuilding(clientX, clientY);
        if (picked === null) {
          const hit = s.ctx.world.pickCell(clientX, clientY);
          if (hit) picked = s.host.state.buildingAt(hit.x, hit.z)?.id ?? null;
        }
        if (picked === id) return { clientX, clientY };
      }
      return null;
    }, { ground, id: b.id });
    assert(point, `grown building ${b.id} is not pickable by QueryTool`);
    for (const type of ['pointermove', 'pointerdown', 'pointerup']) await this.page.evaluate(pointer, { type, point });
    await this.page.locator('.info-actions').waitFor();
  }
}
