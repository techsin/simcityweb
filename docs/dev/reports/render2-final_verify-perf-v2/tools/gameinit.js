// perfrev-v2 init script for the REAL game page (index.html): frame clock, scene hooks, scripted camera plan.
// Injected with page.addInitScript before any page script runs.
(() => {
  const W = window;
  // no-draw (window.__noDraw set by an init script before this one): WebGL draw calls and blits are not passed on, as
  // in the bench pages; everything else runs. Counted per frame.
  W.__glDraws = 0;
  // scissor mode (window.__scissor): every GL call goes through, draws included, but a 1 x 1 scissor box is forced on
  // every WebGL2 context, so the software GPU only does vertex work
  if (W.__scissor && typeof WebGL2RenderingContext !== 'undefined') {
    const P = WebGL2RenderingContext.prototype, sc = P.scissor, dis = P.disable, en = P.enable;
    P.scissor = function () { return sc.call(this, 0, 0, 1, 1); };
    P.disable = function (cap) { if (cap !== this.SCISSOR_TEST) return dis.call(this, cap); };
    const gc = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) {
      const c = gc.call(this, type, ...a);
      if (c && type === 'webgl2' && !c.__pwsc) { c.__pwsc = 1; en.call(c, c.SCISSOR_TEST); sc.call(c, 0, 0, 1, 1); }
      return c;
    };
  }
  if (W.__noDraw && typeof WebGL2RenderingContext !== 'undefined') {
    const P = WebGL2RenderingContext.prototype;
    for (const k of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'blitFramebuffer']) {
      const f = P[k];
      if (typeof f === 'function') P[k] = function (...a) { if (k !== 'blitFramebuffer') W.__glDraws++; if (W.__drawOn) return f.apply(this, a); };
    }
    const ge = P.getExtension;
    P.getExtension = function (name) {
      const e = ge.call(this, name);
      if (e && name === 'WEBGL_multi_draw' && !e.__pw) {
        e.__pw = 1;
        for (const k of ['multiDrawArraysWEBGL', 'multiDrawElementsWEBGL', 'multiDrawArraysInstancedWEBGL', 'multiDrawElementsInstancedWEBGL']) {
          const f = e[k];
          if (typeof f === 'function') e[k] = function (...a) { W.__glDraws++; if (W.__drawOn) return f.apply(e, a); };
        }
      }
      return e;
    };
  }
  const nowE = () => performance.timeOrigin + performance.now();
  const F = []; // frame start times (epoch ms), one per rAF frame (this callback is registered first, runs first)
  const R = []; // per-frame in-page timings once the city's real WorldView exists
  W.__frames = F;
  W.__frec = R;
  W.__veilGone = 0;
  W.__worldAt = -1;
  const H = { plan: [], segs: [], done: -1, poses: null, anchor: null };
  W.__gameHook = H;
  let cur = null;
  // the game (index.html: App.city.scene) or the ui page (demo-ui.html: window.__scene)
  const scene = () => { if (W.__scene) return W.__scene; const a = W.__metropolis; return a && a.city ? a.city.scene : null; };
  const wrap = (obj, name, slot) => {
    if (!obj) return;
    const f = obj[name];
    if (typeof f !== 'function' || f.__pw) return;
    const g = function (...a) {
      const t = performance.now();
      try { return f.apply(this, a); } finally {
        const e = performance.now();
        if (cur) { cur[slot] += e - t; if (R.length <= 4000) (cur.ts || (cur.ts = [])).push(slot, performance.timeOrigin + t, performance.timeOrigin + e); }
      }
    };
    g.__pw = 1;
    obj[name] = g;
  };
  const CELL = 16;
  let POSE = null;
  function setup(sc) {
    const st = sc.sim.state, N = st.size;
    let sx = 0, sz = 0, n = 0;
    for (const b of st.buildings.values()) { sx += b.x + b.w / 2; sz += b.z + b.d / 2; n++; }
    const ax = (n ? sx / n : N / 2) * CELL, az = (n ? sz / n : N / 2) * CELL, Y0 = 45, MAPW = N * CELL;
    H.anchor = [ax, az];
    POSE = {
      street: { x: ax, z: az, d: 150, tilt: 16, yaw: Y0 },
      default: { x: ax, z: az, d: 800, tilt: 50, yaw: Y0 },
      far: { x: ax, z: az, d: 4000, tilt: 75, yaw: Y0 },
      edgelow: { x: MAPW - 100, z: az, d: 200, tilt: 10, yaw: 90 },
      edget18: { x: MAPW - 150, z: az, d: 300, tilt: 18, yaw: 90 },
      edget25: { x: MAPW - 150, z: az, d: 400, tilt: 25, yaw: 90 },
    };
    const S = POSE, at = (p, yaw) => ({ ...p, yaw: yaw ?? p.yaw });
    const lerp = (a, b, t) => a + (b - a) * t, lerpLog = (a, b, t) => a * Math.pow(b / a, t);
    const right = (yaw) => { const y = (yaw * Math.PI) / 180; return [Math.cos(y), Math.sin(y)]; };
    const pan = (p, i, step) => { const [rx, rz] = right(p.yaw); return { ...p, x: p.x + rx * step * (i + 1), z: p.z + rz * step * (i + 1) }; };
    H.SEGS = {
      street: { n: 20, f: () => S.street },
      zoomout: { n: 90, f: (i) => { const t = (i + 1) / 90; return { ...S.street, d: lerpLog(S.street.d, S.far.d, t), tilt: lerp(S.street.tilt, S.far.tilt, t) }; } },
      farorbit: { n: 60, f: (i) => at(S.far, Y0 + (90 * (i + 1)) / 60) },
      default: { n: 20, f: () => at(S.default, Y0 + 90) },
      zoomin: { n: 60, f: (i) => { const t = (i + 1) / 60; return { ...S.default, yaw: Y0 + 90, d: lerpLog(S.default.d, S.street.d, t), tilt: lerp(S.default.tilt, S.street.tilt, t) }; } },
      streetpan: { n: 60, f: (i) => pan(at(S.street, Y0 + 90), i, 2) },
      streetfast: { n: 30, f: (i) => pan(at(S.street, Y0 + 90), i, 15) },
      pan: { n: 60, f: (i) => pan(at(S.default, Y0 + 90), i, 5) },
      fastpan: { n: 30, f: (i) => pan(at(S.default, Y0 + 90), i, 40) },
      cuts: { n: 20, f: (i) => [S.far, S.street, S.default, at(S.far, Y0 + 180)][Math.floor(i / 5)] },
      hold: { n: 10, f: () => null },
    };
  }
  function apply(w, p) { if (p) w.cameraController.setView(p.x, p.z, p.d, p.tilt, p.yaw); }
  /** queue segments (names): resolved by the frame loop; returns when the plan ran */
  H.run = (names) => new Promise((res) => {
    const sc = scene();
    if (sc && (!H.anchor || W.__reanchor)) setup(sc); // (the ui page builds its town after the views: anchor it now)
    for (const name of names) {
      const s = H.SEGS[name];
      for (let i = 0; i < s.n; i++) H.plan.push({ p: s.f(i), mark: i === 0 ? name : null });
    }
    H.plan.push({ p: null, mark: 'end' });
    H.resolve = res;
  });
  function tick() {
    requestAnimationFrame(tick);
    const t = nowE();
    F.push(t);
    const sc = scene();
    if (!sc) return;
    if (!W.__paused && sc.sim) { sc.sim.speed = 0; W.__paused = F.length - 1; }
    const w = sc.world;
    if (w && w.cameraController && !w.__pwcfg) {
      w.__pwcfg = 1;
      if ('dynamicResolution' in w) w.dynamicResolution = false;
      if ('renderScale' in w) w.renderScale = 1;
      W.__worldAt = F.length - 1;
      setup(sc);
      if (!W.__keepCamera) apply(w, POSE.default);
      wrap(w, 'update', 'wu'); wrap(w, 'render', 'wr'); wrap(sc.objects, 'update', 'ou'); wrap(sc.sim, 'update', 'su');
      // the scene's whole frame callback (re-read from the instance at every rAF registration)
      if (typeof sc.loop === 'function' && !sc.loop.__pw) {
        const f0 = sc.loop;
        const g = function (t) {
          const a = performance.now();
          try { return f0.call(this, t); } finally {
            const e = performance.now();
            if (cur) { cur.lp += e - a; if (R.length <= 4000) (cur.ts || (cur.ts = [])).push('lp', performance.timeOrigin + a, performance.timeOrigin + e); }
          }
        };
        g.__pw = 1;
        sc.loop = g;
      }
    }
    if (w && w.__pwcfg) {
      cur = { i: F.length - 1, wu: 0, wr: 0, ou: 0, su: 0, lp: 0, calls: 0, tris: 0 };
      R.push(cur);
      if (R.length > 1) { const prev = R[R.length - 2]; try { prev.calls = w.renderer.info.render.calls; prev.tris = w.renderer.info.render.triangles; } catch { /* */ } }
      if (H.plan.length) {
        const step = H.plan.shift();
        if (step.mark) H.segs.push({ name: step.mark, i: F.length - 1 });
        apply(w, step.p);
        if (!H.plan.length) { H.done = F.length - 1; const r = H.resolve; H.resolve = null; setTimeout(() => r && r(H.segs), 0); }
      }
    }
  }
  requestAnimationFrame(tick);
  // worker message handlers (the LOD proxy builder's results arrive this way): timed like the phases (slot 'wm')
  if (typeof Worker !== 'undefined') {
    const W0 = Worker;
    const timed = (fn) => function (...a) {
      const t = performance.now();
      try { return fn.apply(this, a); } finally {
        const e = performance.now();
        if (cur) { cur.wm = (cur.wm || 0) + (e - t); if (R.length <= 4000) (cur.ts || (cur.ts = [])).push('wm', performance.timeOrigin + t, performance.timeOrigin + e); }
      }
    };
    const PW = function (...a) {
      const w = new W0(...a);
      let h = null;
      Object.defineProperty(w, 'onmessage', { configurable: true, get: () => h, set: (fn) => { h = fn; W0.prototype.__lookupSetter__('onmessage').call(w, typeof fn === 'function' ? timed(fn) : fn); } });
      const ael = w.addEventListener.bind(w);
      w.addEventListener = (type, fn, o) => ael(type, type === 'message' && typeof fn === 'function' ? timed(fn) : fn, o);
      return w;
    };
    PW.prototype = W0.prototype;
    W.Worker = PW;
  }
  const mo = new MutationObserver(() => {
    if (W.__veilGone) return;
    const v = document.querySelector('.loading-veil');
    if (v && v.classList.contains('gone')) W.__veilGone = nowE();
  });
  const start = () => mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
})();
