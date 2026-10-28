import { timeout, sleep } from './options.mjs';

export const PANEL_IDS = ['advisors', 'budget', 'dataviews', 'demographics', 'emergencies', 'graphs', 'help', 'info', 'ordinances', 'rewards', 'settings', 'stats'];
export const CYCLE_STEPS = ['inspect-growable', 'inspect-service', 'panels-and-data', 'zone-road-bulldoze', 'save', 'exit', 'retention', 'reenter', 'quality-low-high-ultra'];

// Everything returned by this evaluator is JSON data. No locator, JSHandle,
// ElementHandle, programmatic click, dispatched DOM event, or app mutator is used.
export function targetPoint(spec) {
  const scope = spec.panel ? window.__metropolis?.city?.scene?.panels.get(spec.panel)?.el : document;
  if (!scope) return null;
  const nodes = [...scope.querySelectorAll(spec.selector)];
  for (const el of nodes) {
    const label = (spec.labelSelector ? el.querySelector(spec.labelSelector)?.textContent : el.textContent)?.trim() ?? '';
    if (spec.text !== undefined && label !== spec.text) continue;
    if (spec.contains !== undefined && !label.includes(spec.contains)) continue;
    if (el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let hidden = false;
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.1) hidden = true;
    }
    if (hidden) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit))) return { x, y, visible: true };
    // Scroll with the mouse too. Reading scroll positions is safe; mutating them
    // with evaluate would bypass the input path the soak is intended to exercise.
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(p).overflowY) || p.scrollHeight <= p.clientHeight) continue;
      const pr = p.getBoundingClientRect();
      if (y < pr.top + 8 || y > pr.bottom - 8) return {
        visible: false, scroll: { x: pr.left + pr.width / 2, y: Math.max(80, Math.min(innerHeight - 80, pr.top + pr.height / 2)), dy: y < pr.top + 8 ? -300 : 300 },
      };
    }
  }
  return null;
}

export class Driver {
  constructor(page, { catalog, cellSize, pulse, checkStop, event }) {
    Object.assign(this, { page, catalog, cellSize, pulse, checkStop, event });
  }
  async read(fn, arg) {
    this.checkStop();
    return timeout(this.page.evaluate(fn, arg), 45_000, 'plain-value page.evaluate');
  }
  async delay(ms) {
    const end = performance.now() + ms;
    do { this.checkStop(); await this.pulse(); await sleep(Math.min(250, Math.max(1, end - performance.now()))); } while (performance.now() < end);
  }
  async wait(label, fn, arg, limit = 30_000) {
    const end = performance.now() + limit;
    do {
      const value = await this.read(fn, arg);
      if (value) return value;
      await this.delay(250);
    } while (performance.now() < end);
    throw new Error(`Timed out: ${label}`);
  }
  async click(spec) {
    const end = performance.now() + 30_000;
    do {
      const p = await this.read(targetPoint, spec);
      if (p?.visible) {
        await this.page.mouse.click(p.x, p.y);
        await this.delay(250);
        return;
      }
      if (p?.scroll) {
        await this.page.mouse.move(p.scroll.x, p.scroll.y);
        await this.page.mouse.wheel(0, p.scroll.dy);
      }
      await this.delay(250);
    } while (performance.now() < end);
    throw new Error(`No unobscured click target: ${JSON.stringify(spec)}`);
  }
  async clear() {
    for (let i = 0; i < 20; i++) {
      const dirty = await this.read(() => {
        const s = window.__metropolis?.city?.scene;
        return !!s && (s.pause.isOpen || s.toolbar.flyoutOpen || s.panels.order.length > 0 || s.tools.activeId !== null);
      });
      if (!dirty) return;
      await this.page.keyboard.press('Escape');
      await this.delay(200);
    }
    throw new Error('Could not close city panels/tools');
  }
  async readyCity() {
    await this.wait('fully initialized city', () => {
      const a = window.__metropolis, s = a?.city?.scene;
      return !!(window.__ready && s?.simReady && !a.busy && !s.worldView.isNull && s.worldView.renderer && !document.querySelector('.loading-veil, .loading'));
    }, null, 240_000);
    const state = await this.read(() => {
      const s = window.__metropolis.city.scene, st = s.sim.state;
      return { size: st.size, population: st.stats.population, buildings: st.buildings.size, day: st.day, quality: s.settings.quality, degraded: Object.entries(s.degraded).filter(([, v]) => v).map(([k]) => k), panels: [...s.panels.panels.keys()].sort(), tileKey: window.__metropolis.city.tile.key };
    });
    if (state.degraded.length) throw new Error(`Fallback modules active: ${state.degraded.join(', ')}`);
    if (JSON.stringify(state.panels) !== JSON.stringify(PANEL_IDS)) throw new Error(`Panel inventory changed: ${state.panels.join(', ')}`);
    return state;
  }
  async enter() {
    await this.click({ selector: '.rc-item' });
    await this.click({ selector: '.tc-actions button', text: 'Play' });
    return this.readyCity();
  }
  async pause() {
    await this.click({ selector: '.speed button[title="Pause (Space)"]' });
    await this.wait('simulation paused', () => window.__metropolis.city.scene.sim.speed === 0);
  }
  async play() {
    await this.clear();
    await this.page.keyboard.press('3');
    await this.wait('ultra simulation speed', () => window.__metropolis.city.scene.sim.speed === 3);
  }
  async tool(id, key) {
    await this.clear();
    await this.page.keyboard.press(key);
    await this.wait(`tool ${id}`, expected => (window.__metropolis.city.scene.tools.activeId ?? 'query') === expected, id);
  }
  async focus(x, z, distance = 500) {
    const p = await this.read(({ x, z }) => {
      const s = window.__metropolis.city.scene, r = document.querySelector('.minimap canvas').getBoundingClientRect();
      return { x: r.left + ((x + 0.5) / s.sim.state.size) * r.width, y: r.top + ((z + 0.5) / s.sim.state.size) * r.height };
    }, { x, z });
    await this.page.mouse.click(p.x, p.y);
    await this.delay(800);
    for (let i = 0; i < 14; i++) {
      const view = await this.read(() => {
        const s = window.__metropolis.city.scene, r = s.canvas.getBoundingClientRect();
        return { distance: s.worldView.controls.distance, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (Math.abs(Math.log(distance / view.distance)) < 0.05) break;
      await this.page.mouse.move(view.x, view.y);
      await this.page.mouse.wheel(0, Math.max(-400, Math.min(400, Math.log(distance / view.distance) / 0.0014)));
      await this.delay(550);
    }
    // Wheel zoom is cursor-anchored; finish by centering the requested cell again.
    await this.page.mouse.click(p.x, p.y);
    await this.delay(900);
  }
  async ground(x, z) {
    const result = await this.read(({ x, z, cellSize }) => {
      const s = window.__metropolis.city.scene, st = s.sim.state, w = s.worldView;
      const r = s.canvas.getBoundingClientRect();
      const p = w.camera.position.clone().set((x + 0.5) * cellSize, st.cellHeight(Math.floor(x), Math.floor(z)) + 0.05, (z + 0.5) * cellSize).project(w.camera);
      const sx = r.left + (p.x + 1) * r.width / 2, sy = r.top + (1 - p.y) * r.height / 2;
      const hit = w.pickCell(sx, sy);
      return { x: sx, y: sy, canvas: document.elementFromPoint(sx, sy) === s.canvas, hit: hit ? { x: hit.x, z: hit.z } : null };
    }, { x, z, cellSize: this.cellSize });
    if (!result.canvas || !result.hit || Math.abs(result.hit.x - (x + 0.5)) > 1 || Math.abs(result.hit.z - (z + 0.5)) > 1) throw new Error(`Ground projection failed at ${x},${z}: ${JSON.stringify(result)}`);
    return result;
  }
  async drag(x0, z0, x1, z1) {
    await this.focus((x0 + x1) / 2, (z0 + z1) / 2, Math.max(500, Math.hypot(x1 - x0, z1 - z0) * this.cellSize * 2));
    const a = await this.ground(x0, z0), b = await this.ground(x1, z1);
    await this.page.mouse.move(a.x, a.y);
    await this.delay(150);
    await this.page.mouse.down();
    try {
      await this.page.mouse.move(b.x, b.y, { steps: Math.max(6, Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2)) });
      await this.delay(250);
    } finally { await this.page.mouse.up(); }
    await this.delay(300);
    if (await this.read(() => !!document.querySelector('.confirm-dialog'))) await this.click({ selector: '.confirm-dialog .cf-actions .danger' });
  }
  async layerRect(layer, value, x0, z0, x1, z1) {
    await this.wait(`${layer}=${value} at ${x0},${z0}..${x1},${z1}`, p => {
      const st = window.__metropolis.city.scene.sim.state;
      for (let z = p.z0; z <= p.z1; z++) for (let x = p.x0; x <= p.x1; x++) if (st[p.layer][z * st.size + x] !== p.value) return false;
      return true;
    }, { layer, value, x0, z0, x1, z1 });
  }
  async road(x0, z0, x1, z1) {
    await this.tool('net:2', 't');
    await this.drag(x0, z0, x1, z1);
    await this.layerRect('network', 2, Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
  }
  async zone(key, value, x0, z0, x1, z1) {
    await this.tool(`zone:${value}`, key);
    await this.drag(x0, z0, x1, z1);
    await this.layerRect('zone', value, x0, z0, x1, z1);
  }
  async patch(width, depth) {
    const patch = await this.read(({ width, depth }) => {
      const st = window.__metropolis.city.scene.sim.state;
      let best = null, bestScore = Infinity;
      for (let z = 0; z <= st.size - depth; z++) for (let x = 0; x <= st.size - width; x++) {
        let ok = true, lo = Infinity, hi = -Infinity;
        for (let dz = 0; dz < depth && ok; dz++) for (let dx = 0; dx < width; dx++) {
          const i = (z + dz) * st.size + x + dx;
          if (st.water[i] || st.network[i] || st.zone[i] || st.building[i] >= 0 || st.powerLines[i] || st.subway[i]) { ok = false; break; }
          const h = st.cellHeight(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h);
        }
        const score = Math.hypot(x + width / 2 - st.size / 2, z + depth / 2 - st.size / 2);
        if (ok && hi - lo < 2 && score < bestScore) { bestScore = score; best = { x, z }; }
      }
      return best;
    }, { width, depth });
    if (!patch) throw new Error(`No empty dry ${width}x${depth} action site; no action was skipped`);
    return patch;
  }
  async plop(defId, category, group, x, z) {
    const def = this.catalog[defId];
    if (!def) throw new Error(`Unknown bootstrap definition ${defId}`);
    await this.clear();
    await this.click({ selector: '.tb-btn', labelSelector: '.tb-l', text: category });
    // Wide flyouts use tabs; Utilities may show all three groups at once.
    if (await this.read(s => [...document.querySelectorAll('.fly-tabs button')].some(e => e.querySelector('span')?.textContent === s), group)) {
      await this.click({ selector: '.fly-tabs button', labelSelector: 'span', text: group });
    }
    await this.click({ selector: '.fly-item', labelSelector: '.fly-name', text: def.name });
    await this.wait(`plop tool ${defId}`, id => window.__metropolis.city.scene.tools.activeId === `plop:${id}`, defId);
    const cx = x + def.footprint[0] / 2 - 0.5, cz = z + def.footprint[1] / 2 - 0.5;
    await this.focus(cx, cz);
    const p = await this.ground(cx, cz);
    await this.page.mouse.move(p.x, p.y);
    await this.delay(300);
    await this.page.mouse.click(p.x, p.y);
    await this.wait(`placed ${defId}`, ({ defId, x, z }) => {
      const b = window.__metropolis.city.scene.sim.state.buildingAt(x, z);
      return b?.def === defId;
    }, { defId, x, z });
  }
  async foundSmall() {
    const initial = await this.readyCity();
    if (initial.size !== 64 || initial.buildings !== 0) throw new Error('Small scenario must begin as an empty, newly founded 64x64 city');
    this.event('small-founded', initial);
    await this.pause();
    const { x, z } = await this.patch(24, 22);
    await this.road(0, z + 7, x + 21, z + 7); // neighbor connection
    await this.road(x + 2, z + 7, x + 2, z + 15);
    await this.road(x + 2, z + 15, x + 21, z + 15);
    await this.plop('util_wind_turbine', 'Utilities', 'Power', x + 4, z + 6);
    await this.plop('util_wind_turbine', 'Utilities', 'Power', x + 8, z + 6);
    await this.plop('util_water_tower', 'Utilities', 'Water', x + 16, z + 6);
    await this.plop('civ_clinic', 'Civic', 'Health', x + 11, z + 5);
    // fire cover: without it the clinic, the only clickable service building, burnt down 15 minutes into an ultra run
    await this.plop('civ_fire_station', 'Civic', 'Fire', x + 16, z + 13);
    await this.zone('r', 1, x + 4, z + 8, x + 13, z + 10);
    await this.zone('c', 4, x + 15, z + 8, x + 20, z + 10);
    await this.zone('i', 8, x + 4, z + 16, x + 13, z + 18);
    await this.play();
    await this.wait('small city to grow a real occupied growable', defs => {
      const st = window.__metropolis.city.scene.sim.state;
      return [...st.buildings.values()].some(b => defs[b.def]?.category === 'growable' && b.pop > 0 && !(b.flags & 16));
    }, this.catalog, 180_000);
    this.event('small-established', await this.read(() => {
      const st = window.__metropolis.city.scene.sim.state;
      return { day: st.day, population: st.stats.population, buildings: st.buildings.size };
    }));
  }
  async inspect(kind) {
    await this.clear();
    const candidates = await this.read(({ defs, kind }) => {
      const st = window.__metropolis.city.scene.sim.state;
      return [...st.buildings.values()].filter(b => !(b.flags & 16) && (kind === 'growable' ? defs[b.def]?.category === 'growable' : ['health', 'fire', 'police', 'education'].includes(defs[b.def]?.category)))
        .sort((a, b) => (a.w * a.d - b.w * b.d) || Math.hypot(a.x - st.size / 2, a.z - st.size / 2) - Math.hypot(b.x - st.size / 2, b.z - st.size / 2))
        .slice(0, 12).map(b => ({ id: b.id, def: b.def, x: b.x, z: b.z, w: b.w, d: b.d }));
    }, { defs: this.catalog, kind });
    const misses = [];
    for (const b of candidates) {
      await this.focus(b.x + b.w / 2 - 0.5, b.z + b.d / 2 - 0.5, 400);
      const p = await this.read(({ id, cellSize }) => {
        const s = window.__metropolis.city.scene, b = s.sim.state.buildings.get(id);
        if (!b) return { miss: 'gone' };
        const r = s.canvas.getBoundingClientRect(), camera = s.worldView.camera, t = s.worldView.controls.target;
        const seen = [];
        for (const h of [2, 8, 20, 40, 80, 120, 200]) for (const fraction of [0.5, 0.25, 0.75]) {
          const v = camera.position.clone().set((b.x + b.w * fraction) * cellSize, b.baseY + h, (b.z + b.d * fraction) * cellSize).project(camera);
          const x = r.left + (v.x + 1) * r.width / 2, y = r.top + (1 - v.y) * r.height / 2;
          const top = document.elementFromPoint(x, y), picked = s.objects.pickBuilding(x, y);
          if (top === s.canvas && picked === id) return { x, y };
          if (seen.length < 3) seen.push(`${h}m:${top === s.canvas ? 'canvas' : top ? top.tagName.toLowerCase() : 'none'}:${picked ?? 'no pick'}`);
        }
        // plain values only: why this candidate was not clickable (camera target in cells, first projections)
        return { miss: `target ${(t.x / cellSize).toFixed(1)},${(t.z / cellSize).toFixed(1)} d ${s.worldView.controls.distance.toFixed(0)}; ${seen.join(' ')}` };
      }, { id: b.id, cellSize: this.cellSize });
      if (p.miss !== undefined) { misses.push(`${b.id}@${b.x},${b.z}: ${p.miss}`); continue; }
      return this.select(kind, b, p, 'candidate');
    }
    // In a dense core every small growable can sit behind taller neighbours: the pick then returns the neighbour. Fall
    // back to the buildings of this kind that the scene's own pick reports on screen around the map centre.
    const centre = await this.read(() => window.__metropolis.city.scene.sim.state.size / 2);
    await this.focus(centre, centre, 700);
    const hit = await this.read(({ defs, kind }) => {
      const s = window.__metropolis.city.scene, st = s.sim.state, r = s.canvas.getBoundingClientRect();
      for (let y = r.top + r.height * 0.2; y < r.top + r.height * 0.8; y += 23) for (let x = r.left + r.width * 0.2; x < r.left + r.width * 0.8; x += 23) {
        if (document.elementFromPoint(x, y) !== s.canvas) continue;
        const id = s.objects.pickBuilding(x, y), b = id == null ? null : st.buildings.get(id);
        if (!b || b.flags & 16) continue;
        const category = defs[b.def]?.category;
        if (kind === 'growable' ? category === 'growable' : ['health', 'fire', 'police', 'education'].includes(category)) return { x, y, b: { id: b.id, def: b.def, x: b.x, z: b.z, w: b.w, d: b.d } };
      }
      return null;
    }, { defs: this.catalog, kind });
    if (hit) return this.select(kind, hit.b, hit, 'screen scan');
    throw new Error(`No clickable ${kind} building; inspection was not skipped. ${misses.slice(0, 4).join(' | ')}`);
  }
  /** click the building at screen point p and verify the inspector shows it (and its WHY section for a growable) */
  async select(kind, b, p, how) {
    await this.page.mouse.click(p.x, p.y);
    await this.wait(`inspector selected ${kind} ${b.id}`, id => {
      const p = window.__metropolis.city.scene.panels.get('info');
      return p.isOpen && p.target?.buildingId === id;
    }, b.id);
    if (kind === 'growable') {
      const open = await this.read(() => window.__metropolis.city.scene.panels.get('info').open.why);
      if (!open) await this.click({ panel: 'info', selector: '.ins-sec-h', labelSelector: '.ins-sec-t', text: 'Why?' });
      await this.wait('WHY section open', () => window.__metropolis.city.scene.panels.get('info').open.why === true);
    }
    await this.delay(1000);
    this.event('inspected', { kind, how, ...b });
    await this.clear();
  }
  async panels() {
    const keys = { budget: 'm', graphs: 'g', stats: 'j', demographics: 'p', advisors: 'n', ordinances: 'y', dataviews: 'o', help: 'F1' };
    for (const id of PANEL_IDS.filter(id => id !== 'info')) {
      await this.clear();
      if (keys[id]) await this.page.keyboard.press(keys[id]);
      else await this.click({ selector: `.hud-top button[data-panel="${id}"]` });
      await this.wait(`panel ${id} open`, id => window.__metropolis.city.scene.panels.isOpen(id), id);
      await this.delay(700);
      this.event('panel-opened', { id });
      if (id === 'dataviews') {
        for (const [text, value] of [['Zones', 1], ['Desirability', 14], ['Traffic', 2], ['Power', 12], ['None', 0]]) {
          await this.click({ panel: id, selector: '.dv-btn', labelSelector: 'span', text });
          await this.wait(`overlay ${text}`, value => window.__metropolis.city.scene.ctx.overlay === value, value);
          await this.delay(700);
          this.event('overlay-selected', { text, value });
        }
      }
    }
    await this.clear();
  }
  async edits() {
    const { x, z } = await this.patch(3, 2);
    await this.zone('r', 1, x, z, x + 2, z);
    await this.road(x, z + 1, x + 2, z + 1);
    await this.tool('bulldoze', 'b');
    await this.drag(x, z + 1, x + 2, z + 1);
    await this.layerRect('network', 0, x, z + 1, x + 2, z + 1);
    // Bulldoze leaves the zone designation. Remove the temporary zone explicitly
    // so subsequent cycles can reuse the same empty patch without altering growth.
    await this.tool('dezone', 'x');
    await this.drag(x, z, x + 2, z);
    await this.layerRect('zone', 0, x, z, x + 2, z);
    await this.clear();
    return { x, z, roadCells: 3, zonedCells: 3, bulldozedCells: 3, dezonedCells: 3 };
  }
  async save() {
    await this.clear();
    await this.pause();
    const before = await this.read(() => window.__metropolis.city.lastSave);
    await this.page.keyboard.press('Control+s');
    await this.wait('completed successful save', before => {
      const c = window.__metropolis.city;
      return c.lastSave > before && c.saving === 0 && !c.saveFailed && c.scene.saving === null;
    }, before, 120_000);
    return this.read(() => {
      const c = window.__metropolis.city;
      return { lastSave: c.lastSave, day: c.state.day, buildings: c.state.buildings.size, tileKey: c.tile.key };
    });
  }
  async exit() {
    await this.clear();
    await this.click({ selector: '.hud-top button[title="Menu (Esc)"]' });
    await this.click({ selector: '.pause-menu button', text: 'Save & exit to region' });
    await this.wait('city exited to region', () => window.__metropolis?.city === null && !!window.__metropolis.regionScreen && !!document.querySelector('.rc-item'), null, 180_000);
    // End hover/PointerEvent paths on the region UI using real input too.
    await this.page.mouse.move(960, 100);
  }
  async quality() {
    await this.clear();
    await this.click({ selector: '.hud-top button[data-panel="settings"]' });
    for (const quality of ['low', 'high', 'ultra']) {
      await this.click({ panel: 'settings', selector: '.set-row .ui-seg button', text: quality[0].toUpperCase() + quality.slice(1) });
      await this.wait(`quality ${quality}`, q => window.__metropolis.city.scene.settings.quality === q, quality);
      await this.delay(2000);
      this.event('quality-selected', { quality });
    }
    await this.clear();
    await this.play();
  }
}
