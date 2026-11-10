import { assert } from './harness.mjs';

export const PROTECTOR_V8_FLAGS = ['--allow-natives-syntax', '--no-maglev', '--no-optimize-on-next-call-optimizes-to-maglev'];

/** TurboFan typed-array dependency probe. Installed before application code; status bits are diagnostic only. */
export function installProtector() {
  if (typeof globalThis.__qaProtector === 'function') return;
  try {
    const a = new Float32Array(64);
    const loop = new Function('a', 'let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s;');
    const prepare = new Function('f', '%PrepareFunctionForOptimization(f);');
    const optimize = new Function('f', 'a', '%OptimizeFunctionOnNextCall(f); f(a);');
    const status = new Function('f', 'return %GetOptimizationStatus(f);');
    const turbofan = new Function('f', 'return %ActiveTierIsTurbofan(f);');
    prepare(loop);
    // Chromium's cold worker contexts may need more feedback than the child-process test's two calls. Do this
    // synchronously before imports: waiting until application code runs would establish a possibly invalid baseline.
    const attempts = [];
    let initial;
    for (const calls of [2, 32, 256, 2048]) {
      for (let i = 0; i < calls; i++) loop(a);
      optimize(loop, a);
      const s = status(loop); attempts.push(s);
      if (turbofan(loop)) { initial = s; break; }
    }
    if (initial === undefined) throw new Error(`typed-array probe did not reach TurboFan after warm-up (V8 statuses: ${attempts.join(', ')}); check recorded v8Flags and enable TurboFan`);
    let intact = true;
    globalThis.__qaProtector = () => {
      loop(a);
      const current = status(loop), active = turbofan(loop);
      intact = intact && active;
      return { intact, turbofan: active, initial, status: current };
    };
  } catch (e) { globalThis.__qaProtector = () => ({ intact: false, error: String(e) }); }
}

/** The protector gate's two rows at one point of the run ('at boot', 'at end', 'after freeze'): one per isolate, so a
 *  failure in one never hides the other's state (T028b; the real-GPU run's finding B3). */
export const protectorRows = (when) => [`protector ${when} / main isolate`, `protector ${when} / sim worker`];

/** Pause dedicated workers at birth; only the simulation isolate belongs to this protector gate. */
export async function watchProtectors(page) {
  await page.addInitScript(installProtector);
  const cdp = await page.context().newCDPSession(page);
  const pending = new Map(), workers = new Map();
  // What an earlier point of the run found, per isolate. A reload gives the page a fresh isolate and every city session
  // a fresh worker: neither may erase its predecessor's failure. A worker that could not be probed at birth counts here
  // too, as nothing later can establish its baseline.
  const earlier = { main: [], sim: [] };
  let next = 0;
  const send = (sessionId, method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`worker CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch((e) => {
      clearTimeout(timer); pending.delete(id); reject(e);
    });
  });
  const received = ({ message }) => {
    const m = JSON.parse(message), p = pending.get(m.id);
    if (!p) return;
    clearTimeout(p.timer); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  };
  const jobs = new Set();
  const attached = ({ sessionId, targetInfo, waitingForDebugger }) => {
    const job = (async () => {
      try {
        if (targetInfo.type !== 'worker') return;
        assert(waitingForDebugger, 'worker was not paused at startup; cannot establish an initial protector baseline');
        await send(sessionId, 'Runtime.enable');
        const identity = await send(sessionId, 'Runtime.evaluate', { expression: 'self.name', returnByValue: true });
        assert(!identity.exceptionDetails && typeof identity.result?.value === 'string', `worker identity unavailable: ${JSON.stringify(identity)}`);
        // The LOD pool is an independent rendering pipeline. Its workers transfer geometry by design; requiring
        // their probe to stay intact would fail the sim gate even for LocalSimHost.
        if (identity.result.value !== 'sim') return;
        const r = await send(sessionId, 'Runtime.evaluate', {
          expression: `(${installProtector.toString()})(); ({name: self.name, probe: self.__qaProtector()})`, returnByValue: true,
        });
        assert(!r.exceptionDetails && r.result?.value?.probe?.intact, `worker protector could not initialize: ${JSON.stringify(r)}`);
        workers.set(sessionId, { name: r.result.value.name, url: targetInfo.url });
      } catch (e) { earlier.sim.push(e.message); }
      finally { await send(sessionId, 'Runtime.runIfWaitingForDebugger').catch((e) => earlier.sim.push(e.message)); }
    })();
    jobs.add(job); void job.finally(() => jobs.delete(job));
  };
  cdp.on('Target.receivedMessageFromTarget', received);
  cdp.on('Target.attachedToTarget', attached);
  cdp.on('Target.detachedFromTarget', ({ sessionId }) => workers.delete(sessionId));
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
  /** The main isolate now, read on its own. A failed read is its finding, not an exception. */
  const observeMain = async () => {
    let probe;
    try { probe = await page.evaluate(() => window.__qaProtector?.()); }
    catch (e) { return { probe: null, issues: [`main isolate probe unreadable: ${e.message}`] }; }
    return { probe, issues: probe?.intact === true ? [] : [`main protector unavailable/invalidated: ${JSON.stringify(probe)}`] };
  };
  /** Every live worker named sim now, each on its own session, whatever the main isolate showed. */
  const observeSim = async (expectSim) => {
    const sims = [...workers.entries()].filter(([, w]) => w.name === 'sim'), probes = [], issues = [];
    for (const [session] of sims) {
      try {
        const r = await send(session, 'Runtime.evaluate', { expression: 'self.__qaProtector()', returnByValue: true });
        if (!r.exceptionDetails && r.result?.value?.intact === true) probes.push(r.result.value);
        else issues.push(`sim worker protector invalidated: ${JSON.stringify(r.exceptionDetails ? r : r.result?.value)}`);
      } catch (e) { issues.push(`sim worker probe unreadable: ${e.message}`); }
    }
    if (expectSim && sims.length !== 1) issues.push(`expected one dedicated worker named sim; found ${JSON.stringify(sims.map(([, w]) => w))}`);
    return { count: sims.length, probes, issues };
  };
  return {
    /**
     * Both isolates at one point of the run, each with its own verdict {status, reason, probe}: PASS, FAIL, or (the
     * sim row on a host that runs the simulation in the main isolate) SKIPPED. It never throws, and neither isolate's
     * failure ends the other's read. An earlier failure of the same isolate keeps its rows failing; the row then also
     * says what the current isolate reads.
     */
    async read(expectSim) {
      await Promise.all([...jobs]);
      const main = await observeMain(), sim = await observeSim(expectSim);
      // `before`: this isolate's earlier findings; `now`: the current read's; `probe`: what the current isolate reads
      const verdict = (name, before, now, probe, pass) => {
        if (!before.length && !now.length) return { status: 'PASS', reason: pass, probe };
        const current = !now.length && probe ? `; the current ${name} reads intact: ${JSON.stringify(probe)}` : '';
        return { status: 'FAIL', reason: [...before, ...now].join('; ') + current, probe };
      };
      const mainRow = verdict('main isolate', earlier.main, main.issues, main.probe, `intact: ${JSON.stringify(main.probe)}`);
      if (!expectSim && !sim.count && !earlier.sim.length) {
        return { main: mainRow, sim: { status: 'SKIPPED', probe: null,
          reason: 'no dedicated sim worker on this host: the simulation runs in the main isolate, which has its own row' } };
      }
      const simPass = `intact: ${sim.probes.map((p) => JSON.stringify(p)).join(', ')}${expectSim ? '' : ' (a worker named sim, which this host does not require)'}`;
      return { main: mainRow, sim: verdict('sim worker', earlier.sim, sim.issues, sim.probes[0] ?? null, simPass) };
    },
    /**
     * Before an isolate goes away: a reload replaces the page's and ends the city's worker, and exit to region ends
     * the worker alone. What the departing isolates show is kept for their later rows, under `label`, without
     * throwing into the UI check that is running.
     */
    async checkpoint(label, expectSim, isolates = ['main', 'sim']) {
      await Promise.all([...jobs]);
      if (isolates.includes('main')) for (const issue of (await observeMain()).issues) earlier.main.push(`${label}: ${issue}`);
      if (isolates.includes('sim')) for (const issue of (await observeSim(expectSim)).issues) earlier.sim.push(`${label}: ${issue}`);
    },
    async dispose() {
      await Promise.all([...jobs]);
      await cdp.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: false });
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('protector session closed')); }
      pending.clear(); await cdp.detach();
    },
  };
}

export async function verifyReplica(page, digestUrl, timeout) {
  assert(digestUrl, 'shared exactDigest entry was not emitted; use src/worker/queries.ts or --digest-module');
  const result = await page.evaluate(async ({ url, timeout }) => {
    const h = window.__metropolis.city.scene.host;
    if (typeof h.query !== 'function') throw new Error('host.query is unavailable');
    if (h.speed !== 0) throw new Error('verify requires a paused, drained host');
    const { exactDigest } = await import(url);
    if (typeof exactDigest !== 'function') throw new Error('digest module must export exactDigest(state)');
    let timer;
    try {
      const primary = await Promise.race([h.query('verify', {}), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('host.query(verify) timed out')), timeout);
      })]);
      return { primary, replica: exactDigest(h.state) };
    } finally { clearTimeout(timer); }
  }, { url: digestUrl, timeout });
  assert(typeof result.primary === 'number' && Number.isFinite(result.primary), `verify reply must be the design's numeric exactDigest: ${JSON.stringify(result.primary)}`);
  assert(result.primary === result.replica, `exact digest mismatch: ${JSON.stringify(result)}`);
  return `authoritative = replica = ${result.primary}`;
}
