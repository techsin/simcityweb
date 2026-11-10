/**
 * tools/qa-nightfall.mjs's page-side probe and its verdicts (T084), apart from the browser so a unit test reads them:
 * tests/render/nightfall.test.ts runs the probe on a real WorldView without a GL context, as the game is and as it was
 * while it still hid the sun light.
 */

/** 18.8333 -> "18:50" */
export function hhmm(h) {
  const m = Math.round((((h % 24) + 24) % 24) * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "18:50-20:10,05:00-06:30" -> [{ name, from, to }] (hours of the view's clock; a window may cross midnight) */
export function parseWindows(text) {
  const hour = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m || +m[1] > 24 || +m[2] > 59) throw new Error(`not a time of day (HH:MM): "${s}"`);
    return (+m[1] + +m[2] / 60) % 24;
  };
  return text.split(',').map((span) => {
    const ends = span.split('-');
    if (ends.length !== 2) throw new Error(`not a window (HH:MM-HH:MM): "${span}"`);
    const from = hour(ends[0]), to = hour(ends[1]);
    return { name: `${from >= 12 ? 'dusk' : 'dawn'} ${hhmm(from)}-${hhmm(to)}`, from, to };
  });
}

/**
 * Page side: page.evaluate(installNightfallProbe) serializes this function into the page, so it refers to nothing
 * outside itself. It installs window.__nightfall on the city's world view (window.__metropolis.city.scene.world; the UI
 * dev page's window.__scene.world):
 *   state()   the view's hour, three's program count and the sun light's state, now
 *   run(win)  win = { name, from, to, timeScale?, maxFrameMs?, timeoutS? }. Sets the view's clock to `from` (the
 *             timeOfDay setter, as any jump of the clock does) and lets it run (autoTime, at timeScale game minutes a
 *             second: the game's own is 2) until it has passed `to`; one sample per animation frame. Resolves with the
 *             window's report: every frame's length and hour, the longest frame, the frames over maxFrameMs, every
 *             change of renderer.info.programs.length and of the light's state, and the frames in which the direct
 *             light was off (Sky.lightRig's intensity at or under WorldView's 0.002) or the sun light hidden.
 */
export function installNightfallProbe() {
  const scene = (window.__metropolis && window.__metropolis.city && window.__metropolis.city.scene) || window.__scene;
  const world = scene && scene.world;
  if (!world || world.isNull || !world.sky || !world.sun || !world.renderer) throw new Error('no real world view (window.__metropolis.city.scene.world)');
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const state = () => {
    const L = world.sky.lighting, sun = world.sun, r = world.renderer;
    return {
      tod: world.timeOfDay,
      // (WorldView's threshold: the direct light is on above it)
      lit: L.lightIntensity > 0.002,
      rigIntensity: L.lightIntensity,
      night: L.night,
      sunVisible: sun.visible,
      sunIntensity: sun.intensity,
      castShadow: sun.castShadow,
      shadowMapEnabled: r.shadowMap.enabled,
      programs: r.info && r.info.programs ? r.info.programs.length : -1,
    };
  };
  const run = (win) => new Promise((resolve) => {
    const span = ((win.to - win.from + 24) % 24) || 24;
    const maxFrameMs = win.maxFrameMs > 0 ? win.maxFrameMs : 250;
    const timeoutMs = (win.timeoutS > 0 ? win.timeoutS : 900) * 1000;
    const keep = { autoTime: world.autoTime, timeScale: world.timeScale };
    const before = state();
    world.autoTime = true;
    if (win.timeScale > 0) world.timeScale = win.timeScale;
    world.timeOfDay = win.from;
    const rep = {
      name: win.name, from: win.from, to: win.to, timeScale: world.timeScale, maxFrameMs,
      before, after: null, timedOut: false, seconds: 0,
      frames: 0, ms: [], tod: [], maxMs: 0, maxAt: null, maxStep: 0, longFrames: 0, long: [],
      programs: { start: before.programs, end: before.programs, changes: [] },
      light: { litAtStart: null, litAtEnd: null, changes: [], unlit: { frames: 0, first: null, last: null }, hidden: { frames: 0, first: null, last: null }, onWhileOff: 0 },
    };
    const t0 = performance.now();
    let last = t0, prev = before, ran = 0, lastTod = win.from;
    const tick = () => {
      const now = performance.now(), ms = now - last;
      last = now;
      const s = state();
      // game hours the clock moved in this frame
      const step = (s.tod - lastTod + 24) % 24;
      lastTod = s.tod;
      if (step < 12) ran += step;
      if (step < 12 && step * 60 > rep.maxStep) rep.maxStep = r3(step * 60);
      rep.frames++;
      rep.ms.push(Math.round(ms * 10) / 10);
      rep.tod.push(Math.round(s.tod * 1e4) / 1e4);
      if (ms > rep.maxMs) { rep.maxMs = Math.round(ms * 10) / 10; rep.maxAt = s.tod; }
      // (the first 100 in full: with software GL every frame is one)
      if (ms > maxFrameMs && rep.longFrames++ < 100) rep.long.push({ ms: Math.round(ms * 10) / 10, tod: s.tod, lit: s.lit, sunVisible: s.sunVisible, programs: [prev.programs, s.programs] });
      if (s.programs !== prev.programs) rep.programs.changes.push({ tod: s.tod, from: prev.programs, to: s.programs, ms: Math.round(ms * 10) / 10 });
      for (const k of ['lit', 'sunVisible', 'castShadow', 'shadowMapEnabled']) {
        // (the jump to `from` may turn the direct light on or off: not a change inside the window)
        if (k === 'lit' && rep.frames === 1) continue;
        if (s[k] !== prev[k]) rep.light.changes.push({ tod: s.tod, what: k, to: s[k], ms: Math.round(ms * 10) / 10 });
      }
      if (rep.light.litAtStart === null) rep.light.litAtStart = s.lit;
      rep.light.litAtEnd = s.lit;
      if (!s.lit) {
        const u = rep.light.unlit;
        u.frames++;
        if (u.first === null) u.first = s.tod;
        u.last = s.tod;
        if (s.sunVisible && s.sunIntensity !== 0) rep.light.onWhileOff++;
      }
      if (!s.sunVisible) {
        const h = rep.light.hidden;
        h.frames++;
        if (h.first === null) h.first = s.tod;
        h.last = s.tod;
      }
      prev = s;
      rep.programs.end = s.programs;
      const late = now - t0 > timeoutMs;
      if (ran >= span || late) {
        rep.timedOut = ran < span;
        rep.seconds = Math.round((now - t0) / 100) / 10;
        rep.after = s;
        world.timeScale = keep.timeScale;
        world.autoTime = keep.autoTime;
        resolve(rep);
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  window.__nightfall = { state, run };
  return state();
}

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (a, q) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/** one line a window: its frames, the largest frame and the program counts */
export function describeWindow(w) {
  const u = w.light.unlit;
  return `${w.name}: ${w.frames} frames in ${w.seconds} s (${w.timeScale} game min/s), median ${median(w.ms).toFixed(1)} ms, p99 ${quantile(w.ms, 0.99).toFixed(1)} ms, `
    + `largest ${w.maxMs} ms at ${w.maxAt === null ? '-' : hhmm(w.maxAt)}; programs ${w.programs.start} -> ${w.programs.end}`
    + `${w.programs.changes.length ? ` (${w.programs.changes.map((c) => `${c.from}->${c.to} at ${hhmm(c.tod)} in a ${c.ms} ms frame`).join(', ')})` : ''}; `
    + (u.frames ? `direct light off ${hhmm(u.first)}-${hhmm(u.last)} (${u.frames} frames)` : 'direct light never off')
    + (w.light.hidden.frames ? `; SUN LIGHT HIDDEN ${hhmm(w.light.hidden.first)}-${hhmm(w.light.hidden.last)} (${w.light.hidden.frames} frames)` : '');
}

/**
 * The verdicts over a run: { windows: [run(win) reports], before, after } with before / after the probe's state() ahead
 * of the first window and behind the last. `enforceFrames` false (software GL, where every frame is slow) reports the
 * frame lengths without judging them (`skipped`). Returns [{ name, ok, skipped?, detail }].
 */
export function nightfallChecks(run, { maxFrameMs = 250, enforceFrames = true } = {}) {
  const checks = [];
  const add = (name, ok, detail, skipped = false) => checks.push(skipped ? { name, ok: true, skipped: true, detail } : { name, ok: !!ok, detail });
  for (const w of run.windows) {
    const u = w.light.unlit, h = w.light.hidden;
    add(`${w.name}: the view's clock ran through it`, !w.timedOut && w.frames > 1, { frames: w.frames, seconds: w.seconds, timedOut: w.timedOut, reached: w.after ? hhmm(w.after.tod) : null });
    // (else the window proves nothing: the wrong hours for this day of the year, or a time scale that steps over it)
    add(`${w.name}: the handover is inside it (the direct light goes off and comes back on)`, w.light.litAtStart === true && u.frames > 0 && w.light.litAtEnd === true,
      { litAtStart: w.light.litAtStart, offFrames: u.frames, off: u.frames ? `${hhmm(u.first)}-${hhmm(u.last)}` : null, litAtEnd: w.light.litAtEnd, largestClockStepGameMin: w.maxStep });
    const long = w.long.filter((f) => f.ms > maxFrameMs).map((f) => ({ ms: f.ms, at: hhmm(f.tod), lightOff: !f.lit, sunHidden: !f.sunVisible, programs: f.programs }));
    add(`${w.name}: no frame over ${maxFrameMs} ms`, w.maxMs <= maxFrameMs,
      { largest: w.maxMs, at: w.maxAt === null ? null : hhmm(w.maxAt), medianMs: +median(w.ms).toFixed(1), p99Ms: +quantile(w.ms, 0.99).toFixed(1), framesOver: w.ms.filter((ms) => ms > maxFrameMs).length, over: long.slice(0, 10) }, !enforceFrames);
    add(`${w.name}: renderer.info.programs.length does not change`, w.programs.start > 0 && w.programs.end === w.programs.start && w.programs.changes.length === 0,
      { start: w.programs.start, end: w.programs.end, changes: w.programs.changes.map((c) => ({ at: hhmm(c.tod), from: c.from, to: c.to, frameMs: c.ms })) });
    const flips = w.light.changes.filter((c) => c.what !== 'lit');
    add(`${w.name}: the sun light stays in three's light state (visible, castShadow and shadowMap.enabled as before; intensity 0 while it is off)`,
      h.frames === 0 && flips.length === 0 && w.light.onWhileOff === 0 && w.before.sunVisible === true,
      { hiddenFrames: h.frames, hidden: h.frames ? `${hhmm(h.first)}-${hhmm(h.last)}` : null, flips: flips.map((c) => ({ at: hhmm(c.tod), what: c.what, to: c.to })), offFramesWithIntensity: w.light.onWhileOff });
  }
  add('the program count is the same before the first window and after the last', run.before.programs > 0 && run.after.programs === run.before.programs, { before: run.before.programs, after: run.after.programs });
  return checks;
}
