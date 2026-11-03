/** T025: browser-free checks of the CDP gate, including its wrong-module positive control. */
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
// @ts-expect-error — plain .mjs browser harness (no type declarations)
import { assertFlat, assertInCity, measure } from '../../tools/leakprobe/counts.mjs';

function cdpWith(counts: Record<string, number> = {}) {
  const values = { CityScene: 1, CityState: 1, HTMLCanvasElement: 3, HTMLInputElement: 20, ...counts };
  return { send: vi.fn(async (method: string, p: Record<string, string> = {}): Promise<unknown> => {
    if (method === 'Runtime.evaluate') return { result: { objectId: /(?:CityScene|CityState|HTMLCanvasElement|HTMLInputElement)(?=\.prototype)/.exec(p.expression)![0] } };
    if (method === 'Runtime.queryObjects') return { objects: { objectId: p.prototypeObjectId } };
    if (method === 'Runtime.callFunctionOn') return { result: { value: values[p.objectId as keyof typeof values] } };
    if (method === 'Runtime.getHeapUsage') return { usedSize: 1048576 };
    if (method === 'Memory.getDOMCounters') return { nodes: 1000, documents: 1, jsEventListeners: 200 };
    return {};
  }) };
}

describe('leakprobe measurements', () => {
  it('discards console entries before every GC and releases all object groups', async () => {
    const cdp = cdpWith();
    const counts = await measure(cdp, { dom: true });
    expect(counts).toEqual({ CityScene: 1, CityState: 1, HTMLCanvasElement: 3, HTMLInputElement: 20, heapMB: 1, nodes: 1000, documents: 1, jsEventListeners: 200 });
    const methods = cdp.send.mock.calls.map(([method]) => method);
    const gc = methods.flatMap((method, i) => method === 'HeapProfiler.collectGarbage' ? [i] : []);
    expect(gc).toHaveLength(3);
    for (const i of gc) expect(methods[i - 1]).toBe('Runtime.discardConsoleEntries');
    expect(methods.filter((method) => method === 'Runtime.releaseObjectGroup')).toHaveLength(5);
    for (const [method, p = {}] of cdp.send.mock.calls) {
      if (['Runtime.evaluate', 'Runtime.queryObjects', 'Runtime.callFunctionOn'].includes(method)) expect(p.objectGroup).toBe('leakprobe');
    }
    expect(() => assertInCity(counts)).not.toThrow();
  });

  it.each(['CityScene', 'CityState'])('rejects a wrong %s module even if its post-exit count would be zero', async (name) => {
    const cdp = cdpWith({ [name]: 0 });
    const option = name === 'CityScene' ? 'sceneModule' : 'stateModule';
    const counts = await measure(cdp, { [option]: '/wrong-instance.ts?probe=1' });
    expect(cdp.send.mock.calls.some(([method, p = {}]) => method === 'Runtime.evaluate' && p.expression.includes('/wrong-instance.ts?probe=1'))).toBe(true);
    expect(() => assertInCity(counts)).toThrow(`positive control failed: ${name} = 0`);
  });

  it('accepts more than one live city object but rejects missing or invalid counts', () => {
    expect(() => assertInCity({ CityScene: 2, CityState: 3 })).not.toThrow();
    for (const CityScene of [undefined, -1, NaN, Infinity]) expect(() => assertInCity({ CityScene, CityState: 1 })).toThrow('positive control failed');
  });

  it('a failed prototype import still releases its handles', async () => {
    const cdp = cdpWith();
    cdp.send.mockImplementation(async (method) => method === 'Runtime.evaluate' ? { exceptionDetails: { text: 'missing export' }, result: {} } : {});
    await expect(measure(cdp)).rejects.toThrow('cannot resolve CityScene prototype');
    expect(cdp.send).toHaveBeenLastCalledWith('Runtime.releaseObjectGroup', { objectGroup: 'leakprobe' });
  });

  it('a failed query still releases its handles', async () => {
    const cdp = cdpWith(), send = cdp.send.getMockImplementation()!;
    cdp.send.mockImplementation(async (method, p) => {
      if (method === 'Runtime.queryObjects') throw new Error('query failed');
      return send(method, p);
    });
    await expect(measure(cdp)).rejects.toThrow('query failed');
    expect(cdp.send).toHaveBeenLastCalledWith('Runtime.releaseObjectGroup', { objectGroup: 'leakprobe' });
  });
});

describe('Budget growth gate', () => {
  const baseline = { HTMLInputElement: 100, nodes: 1000 };
  it('accepts flat counts including either 5% boundary', () => {
    for (const sample of [baseline, { HTMLInputElement: 105, nodes: 950 }, { HTMLInputElement: 95, nodes: 1050 }]) {
      expect(() => assertFlat(baseline, sample)).not.toThrow();
    }
  });
  it('rejects growth or shrinkage outside 5% in either count', () => {
    for (const sample of [{ HTMLInputElement: 106, nodes: 1000 }, { HTMLInputElement: 94, nodes: 1000 }, { HTMLInputElement: 100, nodes: 1051 }, { HTMLInputElement: 100, nodes: 949 }]) {
      expect(() => assertFlat(baseline, sample)).toThrow('outside +/-5%');
    }
  });
  it('cannot pass with missing or zero DOM measurements', () => {
    expect(() => assertFlat({ HTMLInputElement: 0, nodes: 0 }, { HTMLInputElement: 0, nodes: 0 })).toThrow('invalid Budget');
    expect(() => assertFlat(baseline, { HTMLInputElement: 100 })).toThrow('invalid Budget nodes');
  });
});

it.each([{ args: [] }, { args: ['--mode', 'budget'] }])('leakprobe --help needs neither a city nor a browser ($args)', ({ args }) => {
  const out = execFileSync(process.execPath, [resolve('tools/leakprobe/leakprobe.mjs'), ...args, '--help'], {
    encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: resolve('tests/__no_browser__') },
  });
  expect(out).toContain('--mode fresh|persistent|budget');
  expect(out).toContain('--scene-module');
  expect(out).toContain('--months');
});
