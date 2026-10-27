import { assert } from './harness.mjs';

/** Same optimized typed-array loop as tests/perf/protectorChild.ts. Installed before application code. */
export function installProtector() {
  try {
    const a = new Float32Array(64);
    const loop = new Function('a', 'let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s;');
    const prepare = new Function('f', 'a', '%PrepareFunctionForOptimization(f); f(a); f(a); %OptimizeFunctionOnNextCall(f); f(a);');
    const status = new Function('f', 'return %GetOptimizationStatus(f);');
    prepare(loop, a);
    const initial = status(loop);
    if (!(initial & 16)) throw new Error('typed-array probe did not optimize');
    let intact = true;
    globalThis.__qaProtector = () => { loop(a); intact = intact && status(loop) === initial; return { intact }; };
  } catch (e) { globalThis.__qaProtector = () => ({ intact: false, error: String(e) }); }
}

/** Pause each dedicated worker at birth, including the sim worker, before its first import executes. */
export async function watchProtectors(page) {
  await page.addInitScript(installProtector);
  const cdp = await page.context().newCDPSession(page);
  const pending = new Map(), workers = new Map(), failures = [];
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
        const r = await send(sessionId, 'Runtime.evaluate', {
          expression: `(${installProtector.toString()})(); ({name: self.name, probe: self.__qaProtector()})`, returnByValue: true,
        });
        assert(!r.exceptionDetails && r.result?.value?.probe?.intact, `worker protector could not initialize: ${JSON.stringify(r)}`);
        workers.set(sessionId, { name: r.result.value.name, url: targetInfo.url });
      } catch (e) { failures.push(e.message); }
      finally { await send(sessionId, 'Runtime.runIfWaitingForDebugger').catch((e) => failures.push(e.message)); }
    })();
    jobs.add(job); void job.finally(() => jobs.delete(job));
  };
  cdp.on('Target.receivedMessageFromTarget', received);
  cdp.on('Target.attachedToTarget', attached);
  cdp.on('Target.detachedFromTarget', ({ sessionId }) => workers.delete(sessionId));
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
  return {
    async check(requireWorker) {
      await Promise.all([...jobs]);
      assert(!failures.length, failures.join('; '));
      const main = await page.evaluate(() => window.__qaProtector?.());
      assert(main?.intact === true, `main protector unavailable/invalidated: ${JSON.stringify(main)}`);
      const sims = [...workers.entries()].filter(([, w]) => w.name === 'sim');
      if (requireWorker) assert(sims.length === 1, `expected one dedicated worker named sim; found ${JSON.stringify([...workers.values()])}`);
      for (const [session] of sims) {
        const r = await send(session, 'Runtime.evaluate', { expression: 'self.__qaProtector()', returnByValue: true });
        assert(!r.exceptionDetails && r.result?.value?.intact === true, `sim worker protector invalidated: ${JSON.stringify(r)}`);
      }
      return `main intact${sims.length ? '; sim worker intact' : '; no separate sim isolate for this host'}`;
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
  assert(digestUrl, 'W1 exactDigest export does not exist at this base; supply --digest-module when W1.1b lands (no substitute hash)');
  const result = await page.evaluate(async ({ url, timeout }) => {
    const h = window.__metropolis.city.scene.host;
    if (typeof h.query !== 'function') throw new Error('host.query is unavailable until W0.3/W1.1b');
    if (h.speed !== 0) throw new Error('verify requires a paused, drained host');
    const { exactDigest } = await import(url);
    if (typeof exactDigest !== 'function') throw new Error('digest module must export exactDigest(state)');
    let timer;
    try {
      const primary = await Promise.race([h.query('verify'), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('host.query(verify) timed out')), timeout);
      })]);
      return { primary, replica: exactDigest(h.state) };
    } finally { clearTimeout(timer); }
  }, { url: digestUrl, timeout });
  assert(typeof result.primary === 'number' && Number.isFinite(result.primary), `verify reply must be the design's numeric exactDigest: ${JSON.stringify(result.primary)}`);
  assert(result.primary === result.replica, `exact digest mismatch: ${JSON.stringify(result)}`);
  return `authoritative = replica = ${result.primary}`;
}
