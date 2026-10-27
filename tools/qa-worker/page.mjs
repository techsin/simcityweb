/** Installed by page.evaluate, without source imports or simulation writes. */
export function installProbe({ dropAck = null } = {}) {
  window.__qaWorker?.dispose();
  const scene = window.__metropolis?.city?.scene;
  if (!scene?.host || !scene.ctx?.signal) throw new Error('W0 host/context debug seam is unavailable');
  const { host, ctx } = scene;
  const restores = [];
  const gestures = new WeakMap();
  let current = null, dropped = false, saving = null;
  const q = { commands: [], gestures: [], sounds: [], toasts: [], saves: [], freeze: null, disposed: false };
  const copy = (v) => {
    try { return v === undefined ? null : structuredClone(v); }
    catch { return { uncloneable: true, type: typeof v }; }
  };
  const patch = (obj, key, wrap) => {
    const own = Object.getOwnPropertyDescriptor(obj, key), original = obj[key];
    obj[key] = wrap(original);
    restores.push(() => { if (own) Object.defineProperty(obj, key, own); else delete obj[key]; });
  };
  patch(host, 'beginGesture', (original) => function (owner) {
    const g = original.call(this, owner);
    const row = { id: q.gestures.length + 1, owner: owner.id ?? owner.constructor.name, ended: false, settled: false, settledAt: null };
    gestures.set(g, row); q.gestures.push(row); current = g;
    patch(g, 'end', (end) => function () { row.ended = true; if (current === g) current = null; return end.call(this); });
    void g.settled.then(() => { if (!ctx.signal.aborted) { row.settled = true; row.settledAt = performance.now(); } });
    return g;
  });
  patch(host, 'act', (original) => function (op, args, opts = {}) {
    const g = gestures.get(opts.gesture ?? current);
    const tool = ctx.tools.active;
    const row = { op, tool: tool.id, gesture: g?.id ?? 0, owner: g?.owner ?? null,
      tagMatchesTool: opts.tag === tool, status: 'pending', at: performance.now(), save: saving };
    q.commands.push(row);
    let ticket;
    try { ticket = original.call(this, op, args, opts); }
    catch (e) { row.status = 'threw'; row.error = String(e); throw e; }
    row.args = copy(args);
    row.seq = ticket?.seq; row.exact = ticket?.exact;
    if (!ticket?.done || typeof ticket.done.then !== 'function') {
      row.status = 'invalid'; row.error = 'host did not return a ticket.done promise'; return ticket;
    }
    if (!dropped && op === dropAck) {
      dropped = true; row.dropped = true;
      ticket = { ...ticket, done: new Promise(() => {}) };
    }
    void ticket.done.then((r) => {
      if (ctx.signal.aborted || q.disposed) return;
      row.result = copy(r); row.status = 'resolved'; row.ackAt = performance.now();
    }, (e) => {
      if (ctx.signal.aborted || q.disposed) return;
      row.status = 'rejected'; row.error = String(e);
    });
    return ticket;
  });
  if (typeof scene.save === 'function') patch(scene, 'save', (original) => function (auto = false) {
    const row = { id: q.saves.length + 1, auto, at: performance.now(), status: 'pending' };
    q.saves.push(row);
    const previous = saving; saving = row.id;
    let out;
    try { out = original.call(this, auto); }
    finally { saving = previous; }
    void Promise.resolve(out).then(() => { row.status = 'resolved'; row.settledAt = performance.now(); }, (e) => { row.status = 'rejected'; row.error = String(e); });
    return out;
  });
  patch(ctx, 'sound', (original) => function (name, opts) {
    q.sounds.push({ name, opts: copy(opts), at: performance.now() }); return original.call(this, name, opts);
  });
  patch(ctx, 'toast', (original) => function (...args) {
    q.toasts.push({ args: copy(args), at: performance.now() }); return original.apply(this, args);
  });
  patch(host, 'frame', (original) => function (dt) {
    const out = original.call(this, dt), f = q.freeze;
    if (f) {
      f.frames++;
      if (f.frozenAt != null && f.resumedAt == null) f.framesDuringFreeze.push(performance.now());
      if (f.resumedAt != null && f.visibleAt != null && f.advancedAt == null && host.state.day > f.day) f.advancedAt = performance.now();
    }
    return out;
  });
  const armFreeze = () => {
    q.freeze = { day: host.state.day, requestedAt: performance.now(), frozenAt: null, resumedAt: null, visibleAt: null, advancedAt: null, frames: 0, framesDuringFreeze: [] };
    document.addEventListener('freeze', () => {
      q.freeze.frozenAt = performance.now(); q.freeze.framesAtFreeze = q.freeze.frames;
    }, { once: true, signal: ctx.signal });
    document.addEventListener('resume', () => {
      q.freeze.day = host.state.day; q.freeze.resumedAt = performance.now();
      q.freeze.framesAtResume = q.freeze.frames;
      q.freeze.visibilityAtResume = document.visibilityState;
      q.markVisible();
    }, { once: true, signal: ctx.signal });
    document.addEventListener('visibilitychange', () => q.markVisible(), { signal: ctx.signal });
  };
  q.markVisible = () => {
    const f = q.freeze;
    if (f?.resumedAt != null && f.visibleAt == null && document.visibilityState === 'visible') f.visibleAt = performance.now();
  };
  q.armFreeze = armFreeze;
  q.dispose = () => {
    if (q.disposed) return;
    q.disposed = true;
    // Plain diagnostics survive exit-to-region; no scene, listener or patch closure is retained.
    window.__qaWorkerArchive = { commands: copy(q.commands), gestures: copy(q.gestures) };
    for (const restore of restores.reverse()) restore();
    delete window.__qaWorker;
  };
  // No global DOM listener retains this city. The freeze listener above belongs to the city's signal.
  patch(host, 'dispose', (original) => function (...args) {
    q.dispose();
    try { return original.apply(this, args); }
    finally { window.__qaWorkerArchive.abortReason = ctx.signal.reason; }
  });
  window.__qaWorker = q;
}

/** Project a terrain point, then check it with the real picker before sending input. */
export function pointForCell([x, z]) {
  const s = window.__metropolis.city.scene, c = s.ctx, st = s.host.state;
  const ix = Math.floor(x + .5), iz = Math.floor(z + .5);
  const wx = (x + .5) * 16, wz = (z + .5) * 16;
  const v = c.world.controls.target.clone().set(wx, st.heightAt(wx, wz), wz).project(c.world.camera);
  const b = c.canvas.getBoundingClientRect();
  const clientX = b.x + (v.x + 1) * b.width / 2, clientY = b.y + (1 - v.y) * b.height / 2;
  const hit = c.world.pickCell(clientX, clientY);
  if (v.z < -1 || v.z > 1 || clientX < b.left || clientX >= b.right || clientY < b.top || clientY >= b.bottom || hit?.x !== ix || hit?.z !== iz) return null;
  return { clientX, clientY };
}

export function pointer({ type, point, shift = false }) {
  const canvas = window.__metropolis.city.scene.ctx.canvas;
  canvas.dispatchEvent(new PointerEvent(type, { ...point, bubbles: true, cancelable: true, pointerId: 1,
    pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, shiftKey: shift }));
}

/** Persistence markers only: not W1's exactDigest, and never serialize the replica. */
export function savedMarkers() {
  const st = window.__metropolis.city.scene.host.state;
  const hash = (a) => {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    let h = 2166136261;
    for (const b of bytes) h = Math.imul(h ^ b, 16777619);
    return h >>> 0;
  };
  return { seed: st.config.seed, size: st.size, name: st.config.name, day: st.day, funds: st.funds, nextBuildingId: st.nextBuildingId,
    camera: { ...st.systemData.camera },
    layers: Object.fromEntries(['heights', 'water', 'zone', 'network', 'netFlags', 'powerLines', 'subway'].map((k) => [k, hash(st[k])])),
    taxes: [...st.budget.taxRates], funding: { ...st.budget.funding }, ordinances: [...st.budget.ordinances],
    loans: st.budget.loans.map((l) => l.principal),
    historic: [...st.buildings.values()].filter((b) => b.flags & 64).map((b) => [b.id, b.def, b.x, b.z]),
    plopped: [...st.buildings.values()].filter((b) => b.flags & 256).map((b) => [b.id, b.def, b.x, b.z]),
  };
}
