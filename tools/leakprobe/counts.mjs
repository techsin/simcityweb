/** CDP measurements share one path in the city and after exit; no object handle survives a call. */
export async function measure(cdp, { sceneModule = '/src/game/CityScene.ts', stateModule = '/src/sim/CityState.ts', dom = false } = {}) {
  const G = 'leakprobe';
  try {
    await cdp.send('Runtime.enable');
    for (let i = 0; i < 3; i++) {
      await cdp.send('Runtime.discardConsoleEntries');
      await cdp.send('HeapProfiler.collectGarbage');
    }
    const prototypes = [
      ['CityScene', `import(${JSON.stringify(sceneModule)}).then((m) => m.CityScene.prototype)`],
      ['CityState', `import(${JSON.stringify(stateModule)}).then((m) => m.CityState.prototype)`],
      ['HTMLCanvasElement', 'HTMLCanvasElement.prototype'],
    ];
    if (dom) prototypes.push(['HTMLInputElement', 'HTMLInputElement.prototype']);
    const out = {};
    for (const [name, expression] of prototypes) {
      const r = await cdp.send('Runtime.evaluate', { expression, objectGroup: G, awaitPromise: true });
      if (r.exceptionDetails || !r.result?.objectId) throw new Error(`cannot resolve ${name} prototype: ${expression}`);
      const q = await cdp.send('Runtime.queryObjects', { prototypeObjectId: r.result.objectId, objectGroup: G });
      const n = await cdp.send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true, objectGroup: G });
      if (n.exceptionDetails || !Number.isInteger(n.result?.value) || n.result.value < 0) throw new Error(`invalid ${name} count`);
      out[name] = n.result.value;
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup: G });
    }
    const hu = await cdp.send('Runtime.getHeapUsage');
    out.heapMB = +(hu.usedSize / 1048576).toFixed(1);
    if (dom) Object.assign(out, await cdp.send('Memory.getDOMCounters'));
    return out;
  } finally {
    // a dropped connection must not replace the error that ended the count
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: G }).catch(() => {});
  }
}

export function assertInCity(counts) {
  for (const name of ['CityScene', 'CityState']) {
    if (!Number.isInteger(counts[name]) || counts[name] < 1) throw new Error(`in-city positive control failed: ${name} = ${counts[name]} (wrong module instance?)`);
  }
}

export function assertFlat(baseline, sample) {
  for (const name of ['HTMLInputElement', 'nodes']) {
    const a = baseline[name], b = sample[name];
    if (!Number.isInteger(a) || a < 1 || !Number.isInteger(b) || b < 1) throw new Error(`invalid Budget ${name} count: ${a} -> ${b}`);
    if (Math.abs(b - a) > a * 0.05) throw new Error(`Budget ${name} outside +/-5%: ${a} -> ${b} (${((b / a - 1) * 100).toFixed(1)}%)`);
  }
}
