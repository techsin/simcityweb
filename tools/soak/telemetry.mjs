import { timeout, sleep } from './options.mjs';

// Serialized by addInitScript. All long-lived measurement state is scalar data,
// fixed-size histograms, or weak collections. Never retain a scene, event or node.
export function installTelemetry() {
  localStorage.setItem('metropolis.settings', JSON.stringify({ quality: 'ultra', edgeScroll: false, autosaveMonths: 3, v: 2 }));
  localStorage.setItem('metropolis.settings.v1', JSON.stringify({ quality: 'ultra', emergencyUncovered: 'ignore', edgeScroll: false, newYearCamera: false }));
  localStorage.setItem('metropolis.ui.onboarding', JSON.stringify({ dismissed: true }));

  // Playwright's server caches console argument handles even when the caller
  // only reads msg.text(). Keep native console arguments primitive from the
  // outset: no logged DOM node/Error/city graph can become a probe retainer.
  // Do not JSON.stringify arbitrary graphs or execute their toJSON methods.
  const consoleValue = value => {
    if (value === null || ['undefined', 'string', 'number', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'bigint' || typeof value === 'symbol') return String(value);
    try {
      if (typeof value.stack === 'string') return value.stack;
      if (typeof value.message === 'string') return value.message;
      return Object.prototype.toString.call(value);
    } catch { return '[unprintable console argument]'; }
  };
  for (const name of ['log', 'debug', 'info', 'warn', 'error', 'dir', 'dirxml', 'table', 'trace', 'group', 'groupCollapsed', 'count', 'countReset', 'time', 'timeLog', 'timeEnd', 'assert']) {
    const native = console[name];
    if (typeof native !== 'function') continue;
    console[name] = function (...args) {
      if (name === 'assert' && args.length) args[0] = Boolean(args[0]);
      return native.apply(console, args.map(consoleValue));
    };
  }

  const makeBucket = () => ({ bins: new Uint32Array(60_001), count: 0, maxMs: 0, totalMs: 0 });
  const frames = { city: makeBucket(), region: makeBucket() };
  let longTasks = { count: 0, totalMs: 0, maxMs: 0 };
  let losses = [], lossOverflow = 0, unexpectedLosses = 0;
  let lastFrame = null, lastKey = null, lastDay = null;
  let cityMs = 0, runningMs = 0, simDays = 0, since = performance.now();
  const recordFrame = (bucket, ms) => {
    bucket.bins[Math.min(60_000, Math.ceil(ms))]++;
    bucket.count++;
    bucket.totalMs += ms;
    bucket.maxMs = Math.max(bucket.maxMs, ms);
  };
  const drainBucket = bucket => {
    const quantile = q => {
      if (!bucket.count) return null;
      const target = Math.ceil(bucket.count * q);
      let n = 0;
      for (let i = 0; i < bucket.bins.length; i++) if ((n += bucket.bins[i]) >= target) return i;
      return null;
    };
    const result = { count: bucket.count, p50Ms: quantile(0.5), p99Ms: quantile(0.99), maxMs: bucket.maxMs, totalMs: bucket.totalMs, overflow60s: bucket.bins[60_000] };
    bucket.bins.fill(0); bucket.count = 0; bucket.maxMs = 0; bucket.totalMs = 0;
    return result;
  };
  let longTaskSupported = PerformanceObserver.supportedEntryTypes.includes('longtask');
  if (longTaskSupported) {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (entry.duration >= 50) {
        longTasks.count++;
        longTasks.totalMs += entry.duration;
        longTasks.maxMs = Math.max(longTasks.maxMs, entry.duration);
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  }

  // forceContextLoss is part of normal renderer disposal. Record it separately
  // from spontaneous loss, including when the canvas has already been detached.
  // three's renderer.forceContextLoss() calls the extension's loseContext(), so that is the method to mark.
  const watched = new WeakSet(), marked = new WeakSet(), wrapped = new WeakSet();
  const extensionCanvas = new WeakMap(), originalForce = new WeakMap();
  function forcedLoss(...args) {
    const canvas = extensionCanvas.get(this)?.deref();
    if (canvas) marked.add(canvas);
    return originalForce.get(this).apply(this, args);
  }
  function onLoss(event) {
    const intentional = marked.has(event.target);
    marked.delete(event.target);
    const row = { atMs: performance.now(), intentional, connected: event.target.isConnected, canvasClass: String(event.target.className), status: String(event.statusMessage ?? '') };
    if (!intentional) unexpectedLosses++;
    if (losses.length < 100) losses.push(row); else lossOverflow++;
  }
  for (const type of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
    if (!type) continue;
    const getExtension = type.prototype.getExtension;
    type.prototype.getExtension = function (name) {
      const ext = getExtension.call(this, name);
      if (ext && name.toLowerCase() === 'webgl_lose_context' && !wrapped.has(ext)) {
        wrapped.add(ext);
        extensionCanvas.set(ext, new WeakRef(this.canvas));
        originalForce.set(ext, ext.loseContext);
        ext.loseContext = forcedLoss;
      }
      return ext;
    };
  }
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const result = getContext.apply(this, args);
    if (result && /^(webgl2?|experimental-webgl)$/.test(args[0]) && !watched.has(this)) {
      watched.add(this);
      this.addEventListener('webglcontextlost', onLoss);
    }
    return result;
  };

  function frame(now) {
    // Do not close over sc/st in a future callback or keep them in telemetry.
    const sc = window.__metropolis?.city?.scene;
    const st = sc?.sim?.state;
    const key = st ? `${st.config.regionId}:${st.config.tileX}:${st.config.tileZ}` : null;
    if (lastFrame !== null) {
      const dt = now - lastFrame;
      recordFrame(frames[st ? 'city' : 'region'], dt);
      if (key !== null && key === lastKey) {
        cityMs += dt;
        if (sc.sim.speed > 0) runningMs += dt;
        if (st.day >= lastDay) simDays += st.day - lastDay;
      }
    }
    lastFrame = now; lastKey = key; lastDay = st?.day ?? null;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__soakTelemetry = {
    drain() {
      const now = performance.now(), sc = window.__metropolis?.city?.scene, st = sc?.sim?.state;
      const result = {
        fromPageMs: since, toPageMs: now, longTaskSupported,
        frames: { city: drainBucket(frames.city), region: drainBucket(frames.region) },
        longTasks, losses, lossOverflow, unexpectedLosses,
        sim: { days: simDays, citySeconds: cityMs / 1000, runningSeconds: runningMs / 1000, daysPerSecond: cityMs ? simDays / (cityMs / 1000) : null },
        state: st ? { day: st.day, population: st.stats.population, buildings: st.buildings.size, speed: sc.sim.speed, quality: sc.settings.quality } : null,
      };
      since = now; longTasks = { count: 0, totalMs: 0, maxMs: 0 };
      losses = []; lossOverflow = 0; unexpectedLosses = 0;
      cityMs = 0; runningMs = 0; simDays = 0;
      return result;
    },
  };
}

export class Probe {
  constructor(cdp) { this.cdp = cdp; this.sequence = 0; }
  async send(method, params = {}) {
    // These are the only remote-JS-object-producing methods used by this probe.
    if (['Runtime.evaluate', 'Runtime.queryObjects', 'Runtime.callFunctionOn'].includes(method) && !params.objectGroup) throw new Error(`Missing objectGroup for ${method}`);
    const result = await timeout(this.cdp.send(method, params), 30_000, method);
    if (result.exceptionDetails) throw new Error(`${method}: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ''}`);
    return result;
  }
  async grouped(fn) {
    const objectGroup = `soak-${++this.sequence}`;
    try { return await fn(objectGroup); }
    finally { await this.send('Runtime.releaseObjectGroup', { objectGroup }); }
  }
  async capturePrototypes() {
    await this.grouped(async objectGroup => {
      const { result } = await this.send('Runtime.evaluate', {
        objectGroup, returnByValue: true,
        expression: `(() => {
          const s = window.__metropolis.city.scene;
          const p = { CityScene: Object.getPrototypeOf(s), CityState: Object.getPrototypeOf(s.sim.state), WebGLRenderer: Object.getPrototypeOf(s.worldView.renderer) };
          if (window.__soakPrototypes && Object.keys(p).some(k => p[k] !== window.__soakPrototypes[k])) throw new Error('Prototype identity changed across visits');
          window.__soakPrototypes = p;
          return true;
        })()`,
      });
      if (result.value !== true) throw new Error('Could not capture production prototypes');
    });
  }
  async counts() {
    const counts = {};
    for (const name of ['CityScene', 'CityState', 'WebGLRenderer']) {
      counts[name] = await this.grouped(async objectGroup => {
        const { result: proto } = await this.send('Runtime.evaluate', { expression: `window.__soakPrototypes.${name}`, objectGroup });
        if (!proto.objectId) throw new Error(`No prototype for ${name}`);
        const { objects } = await this.send('Runtime.queryObjects', { prototypeObjectId: proto.objectId, objectGroup });
        if (!objects.objectId) throw new Error(`No queryObjects result for ${name}`);
        const { result } = await this.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.length; }', objectGroup, returnByValue: true });
        if (!Number.isInteger(result.value) || result.value < 0) throw new Error(`Invalid ${name} count`);
        return result.value;
      });
    }
    return counts;
  }
  async memory(gc = false) {
    if (gc) {
      // Console text is already copied to the Node log. Inspector console storage
      // must not become a retainer of objects logged by the application.
      await this.send('Runtime.discardConsoleEntries');
      for (let i = 0; i < 3; i++) { await this.send('HeapProfiler.collectGarbage'); await sleep(150); }
    }
    // Scalar protocol records, not Runtime.RemoteObjects: these commands have no
    // objectGroup parameter in CDP and create no remote handles to release.
    const heap = await this.send('Runtime.getHeapUsage');
    const dom = await this.send('Memory.getDOMCounters');
    return { heap, dom, forcedGc: gc };
  }
}

export function hardwareRenderer(renderer) {
  return typeof renderer === 'string' && renderer.length > 8 &&
    !/swiftshader|llvmpipe|softpipe|software|microsoft basic|\bwarp\b|lavapipe/i.test(renderer) &&
    /nvidia|geforce|quadro|radeon|\bamd\b|intel|apple|adreno|mali/i.test(renderer);
}
