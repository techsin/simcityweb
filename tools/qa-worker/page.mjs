/** Installed by page.evaluate, without source imports or simulation writes. */
export function installProbe({ dropAck = null } = {}) {
  window.__qaWorker?.dispose();
  const scene = window.__metropolis?.city?.scene;
  if (!scene?.host || !scene.ctx?.signal) throw new Error('W0 host/context debug seam is unavailable');
  const { host, ctx } = scene;
  const world = ctx.world;
  const restores = [];
  const gestures = new WeakMap(), tickets = new WeakMap(), tags = new Map();
  let current = null, dropped = false, saving = null, postingTag = null, ticketId = 0;
  const q = { commands: [], gestures: [], sounds: [], toasts: [], saves: [], hostSaves: [], ghosts: [], previews: [], events: [], packets: [], freeze: null, disposed: false };
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
    const row = { id: q.gestures.length + 1, owner: owner.id ?? owner.constructor.name, ended: false, settled: false, settledAt: null, failures: 0 };
    gestures.set(g, row); q.gestures.push(row); current = g;
    patch(g, 'end', (end) => function () { row.ended = true; if (current === g) current = null; return end.call(this); });
    if (typeof g.fail === 'function') patch(g, 'fail', (fail) => function (report) {
      return fail.call(this, () => { row.failures++; return report(); });
    });
    void g.settled.then(() => { if (!ctx.signal.aborted) { row.settled = true; row.settledAt = performance.now(); row.mismatch = g.mismatch; } });
    return g;
  });
  patch(host, 'act', (original) => function (op, args, opts = {}) {
    const g = gestures.get(opts.gesture ?? current);
    const tool = ctx.tools.active;
    const row = { op, tool: tool.id, gesture: g?.id ?? 0, owner: g?.owner ?? null,
      tagMatchesTool: opts.tag === tool, status: 'pending', at: performance.now(), save: saving, pendingBefore: host.pending?.count ?? 0 };
    q.commands.push(row);
    let ticket;
    const previousTag = postingTag; postingTag = opts.tag ?? null;
    try { ticket = original.call(this, op, args, opts); }
    catch (e) { row.status = 'threw'; row.error = String(e); throw e; }
    finally { postingTag = previousTag; }
    row.args = copy(args);
    row.seq = ticket?.seq; row.exact = ticket?.exact;
    row.predicted = copy(ticket?.predicted); row.pendingAfter = host.pending?.count ?? 0;
    if (row.seq > 0) tags.set(row.seq, opts.tag ?? null);
    if (!ticket?.done || typeof ticket.done.then !== 'function') {
      row.status = 'invalid'; row.error = 'host did not return a ticket.done promise'; return ticket;
    }
    if (!tickets.has(ticket.done)) tickets.set(ticket.done, ++ticketId);
    row.ticketId = tickets.get(ticket.done);
    if (!dropped && row.seq > 0 && op === dropAck) {
      dropped = true; row.dropped = true;
      ticket = { ...ticket, done: new Promise(() => {}) };
    }
    void ticket.done.then((r) => {
      if (ctx.signal.aborted || q.disposed) return;
      row.result = copy(r); row.status = 'resolved'; row.ackAt = performance.now(); row.applied = host.replica?.applied ?? null;
    }, (e) => {
      if (ctx.signal.aborted || q.disposed) return;
      row.status = 'rejected'; row.error = String(e);
    });
    return ticket;
  });
  for (const type of ['zoneChanged', 'networkChanged', 'buildingAdded', 'buildingRemoved', 'terrainChanged', 'emergency']) {
    const off = host.events?.on(type, (event) => {
      const cause = host.cause;
      if (!cause) return;
      q.events.push({ type, event: type === 'emergency' ? copy(event) : null, seq: cause.seq,
        tagMatches: cause.tag != null && cause.tag === (tags.get(cause.seq) ?? postingTag), at: performance.now() });
    });
    if (off) restores.push(off);
  }
  if (typeof host.receive === 'function') patch(host, 'receive', (original) => function (message) {
    const out = original.call(this, message);
    if (message.t === 'pkt') q.packets.push({ seq: message.p.seq, cmd: message.p.cmd, applied: host.replica.applied,
      replies: (message.p.replies ?? []).map((r) => ({ t: r.t, cmd: r.cmd })), causeCleared: host.cause === null });
    else if (message.t === 'ready') q.packets.push({ resync: true, cmd: message.cmd, applied: host.replica.applied });
    return out;
  });
  if (typeof ctx.world?.setPendingPreview === 'function') patch(ctx.world, 'setPendingPreview', (original) => function (seq, geometry) {
    const out = original.call(this, seq, geometry);
    const mesh = this.pendingPreviews?.get(seq);
    q.ghosts.push({ seq, geometry: copy(geometry), at: performance.now(), pending: host.pending?.count ?? 0,
      visible: !!mesh && mesh.visible && mesh.parent === this.scene, applied: host.replica?.applied ?? null,
      remaining: this.pendingPreviews?.size ?? null });
    return out;
  });
  if (typeof ctx.world?.setHighlightRect === 'function') patch(ctx.world, 'setHighlightRect', (original) => function (rect, color) {
    if (rect && host.pending?.count) q.previews.push({ rect: copy(rect), pending: host.pending.count, claim: host.pending.claims(rect) });
    return original.call(this, rect, color);
  });
  if (typeof host.save === 'function') patch(host, 'save', (original) => function (reason) {
    const row = { reason, save: saving, status: 'pending', at: performance.now() }; q.hostSaves.push(row);
    const out = original.call(this, reason);
    void out.then((ack) => { row.status = 'resolved'; row.ack = copy(ack); row.applied = host.replica?.applied ?? null; },
      (e) => { row.status = 'rejected'; row.error = String(e); });
    return out;
  });
  if (typeof scene.save === 'function') patch(scene, 'save', (original) => function (...args) {
    const row = { id: q.saves.length + 1, auto: args[0] ?? false, reason: args[1] ?? null, at: performance.now(), status: 'pending' };
    q.saves.push(row);
    const previous = saving; saving = row.id;
    let out;
    try { out = original.apply(this, args); }
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
    window.__qaWorkerArchive = Object.fromEntries(['commands', 'gestures', 'ghosts', 'events', 'packets', 'hostSaves'].map((k) => [k, copy(q[k])]));
    window.__qaWorkerArchive.teardown = { disposed: true, aborted: ctx.signal.aborted, pending: host.pending?.count ?? 0,
      ghosts: world?.pendingPreviews?.size ?? 0 };
    window.__qaWorkerArchive.abortReason = ctx.signal.reason;
    const archive = window.__qaWorkerArchive;
    // Abort listeners and the scene's synchronous dispose finish before these final resource counts are read.
    queueMicrotask(() => { archive.teardown.pending = host.pending?.count ?? 0; archive.teardown.ghosts = world?.pendingPreviews?.size ?? 0; });
    for (const restore of restores.reverse()) restore();
    delete window.__qaWorker;
    tags.clear();
  };
  // No global DOM listener retains this city. The freeze listener above belongs to the city's signal.
  patch(host, 'dispose', (original) => function (...args) {
    try { return original.apply(this, args); }
    finally { q.dispose(); window.__qaWorkerArchive.abortReason = ctx.signal.reason; }
  });
  const onAbort = () => q.dispose();
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  restores.push(() => ctx.signal.removeEventListener('abort', onAbort));
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
