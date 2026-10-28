/**
 * WORKER_DESIGN §1.5 / S1 / R10: keep detaching APIs out of sim isolates and their node harnesses.
 * Later migration gates have real scans, but stay explicitly skipped until the named step lands.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, importGraph, scan, scanFiles, sourceFiles, staticImportGraph } from './hygieneScan';

describe('S1 isolate hygiene', () => {
  it('sim, city persistence and node harnesses contain no detaching APIs', () => {
    const files = [...sourceFiles('src/sim'), ...sourceFiles('src/save').filter((p) => !['src/save/index.ts', 'src/save/bundle.ts'].includes(p)),
      ...sourceFiles('tests/perf'), ...sourceFiles('tests/worker')];
    const violations = scanFiles(files);
    // Exactly these two operations are intentional. Do not exclude the control file or a whole directory:
    // another detach, even in this helper, must fail this assertion.
    expect(violations.map(({ file, rule, code }) => ({ file, rule, code }))).toEqual([
      { file: 'tests/worker/protectorFaults.ts', rule: 'transfer list', code: 'port.postMessage({ t: \'control\', buffer }, [buffer])' },
      { file: 'tests/worker/protectorFaults.ts', rule: 'memory.grow', code: 'memory.grow(1)' },
    ]);
  });

  it('finds transfer lists, bodies and growth even across comments, newlines and computed properties', () => {
    const forbidden = [
      'port.postMessage(\n { day: 1 }, /* detach */ [buf]);',
      'postMessage(packet, { transfer: buffers });',
      'structuredClone(packet, options);',
      'globalThis.structuredClone(packet, { transfer: [buf] });',
      'port["postMessage"](packet, buffers);',
      'port.postMessage(...args);',
      'new Worker(url, { transferList: buffers });',
      'buf.transfer();', 'buf["transferToFixedLength"]();',
      'new CompressionStream("gzip");', 'new DecompressionStream("gzip");',
      'new Blob([bytes]);', 'new globalThis.Blob([bytes]);', 'new Response(bytes);',
      'body.stream();', 'await body.arrayBuffer();', 'await body.text();',
      'wasm.memory.grow(1);', 'mem["grow"](0);', 'wasm.heap.reserve(4096);',
    ];
    for (const source of forbidden) expect(scan('sample.ts', source), source).not.toEqual([]);
    expect(scan('sample.ts', 'memory.grow(1);')[0]).toMatchObject({ line: 1, rule: 'memory.grow' });
  });

  it('allows clone-only messages, buffer reads, JS heap reserves and inert comments / strings', () => {
    expect(scan('sample.ts', `
      // port.postMessage(x, [buf]); memory.grow(1); new Blob([]);
      const note = 'new Response(x).arrayBuffer();';
      port.postMessage({ bytes: bytes.slice() });
      structuredClone(packet);
      const size = memory.buffer.byteLength;
      this.reserve(1024); // the JS priority queue, src/sim/infra/heap.ts
    `)).toEqual([]);
  });

  it('finds system imports with aliases and method/array references on sim chains', () => {
    for (const source of [
      'import { emergencyOf as em } from "../sim/infra/emergency";',
      'import { getSystem as lookup } from "./systems";',
      'import { emergencyOf } from "../sim/infra/emergency";',
      'import emergencyOf from "./systems";',
      'const lookup = ctx.sim.getSystem;', 'const lookup = host["sim"]?.["getSystem"];',
      'const list = (sim as Simulation).systems;', 'const list = this.ctx.sim["systems"];',
      'ctx.sim.facade().systems;', 'ctx.sim.getSystem("crime");',
    ]) expect(scan('src/ui/sample.ts', source, 'systems'), source).toHaveLength(1);
  });

  it('allows host views, sim events and unrelated systems properties', () => {
    expect(scan('src/game/sample.ts', `
      import type { EmergencySystem } from '../sim/infra/emergency';
      const events = ctx.sim.events;
      const state = ctx.sim.state;
      const options = host.query('dispatchOptions', { incidentId: 1 });
      const list = catalog.systems;
      // const forbidden = sim.systems;
      const note = 'emergencyOf(sim)';
    `, 'systems')).toEqual([]);
  });

  it('the later writer, reach-in and replica checks already detect their prohibited operations', () => {
    expect(scan('sample.ts', 'ctx.sim.speed = 3;', 'speed')).toHaveLength(1);
    expect(scan('sample.ts', 'sim["liveSlowdown"]++;', 'liveSlowdown')).toHaveLength(1);
    expect(scan('sample.ts', 'emergencyOf(sim); ctx.sim.getSystem("crime");', 'systems')).toHaveLength(2);
    expect(scan('sample.ts', 'const st = ctx.state; const b = st.budget; b.taxRates[0] = 8;', 'replica')).toHaveLength(1);
    expect(scan('sample.ts', 'host.state.trees.fill(0); delete ctx.state.systemData.camera; b.flags ^= 1;', 'replica')).toHaveLength(3);
    expect(scan('sample.ts', 'const speed = ctx.sim.speed; const b = ctx.state.budget; show(b.funds);', 'replica')).toEqual([]);
    expect(scan('sample.ts', 'const st = ctx.state; for (const b of st.buildings.values()) b.flags = 0;', 'replica')).toHaveLength(1);
    expect(scan('sample.ts', 'function mark(b) { b.flags |= BF.Plopped; }', 'replica')).toHaveLength(1);
  });

  it('the replica check resolves aliases through scopes and ignores copies and local flags', () => {
    // the alias `z` of one function is not the loop counter `z` of another; a parameter shadows an outer alias
    expect(scan('sample.ts', `
      function a(ctx) { const z = ctx.state.size; return z; }
      function b() { for (let z = 0; z < 3; z++) use(z); }
      function d() { const z = {}; z.x = 1; }
      const st = ctx.state;
      function c(st) { st.day = 1; }
    `, 'replica')).toEqual([]);
    expect(scan('sample.ts', 'const st = ctx.state; show(st.news.slice().reverse()); let n = 0; n++;', 'replica')).toEqual([]);
    expect(scan('sample.ts', 'function place(bi, flags) { bi.flags = flags; }', 'replica')).toEqual([]);
    expect(scan('sample.ts', 'const st = ctx.state; function c() { st.day = 1; }', 'replica')).toHaveLength(1);
  });
});

const uiAndGame = () => [...sourceFiles('src/ui'), ...sourceFiles('src/game')];
const outsideCore = () => sourceFiles('src').filter((p) => !/^src\/(worker|sim)\//.test(p));
async function expectCleanGraph(entry: string): Promise<void> {
  const graph = await importGraph(entry);
  expect(graph).toContain(entry); // missing entry / empty graphs must never pass when this gate is enabled
  expect(graph.filter((p) => ['src/save/bundle.ts', 'src/save/index.ts', 'src/save/recoveryLs.ts'].includes(p))).toEqual([]);
}

/** the UI and render demo pages build and fill their own city state; they never see the game's replica */
const DEMO_STATES = ['src/ui/demo.ts', 'src/render/city/demoCity.ts'];

/** `.speed` writes that are not the simulation's: a vehicle's own speed in the traffic renderer */
const NOT_SIM_SPEED = [{ file: 'src/render/city/vehicles/VehicleRenderer.ts', code: /^tr\.speed \+= / }];

describe('worker migration hygiene gates', () => {
  it('W0.2: speed writers live only in src/worker or src/sim', () => {
    const found = scanFiles(outsideCore(), 'speed');
    const exempt = found.filter((v) => NOT_SIM_SPEED.some((e) => e.file === v.file && e.code.test(v.code)));
    expect(exempt).toHaveLength(NOT_SIM_SPEED.length); // each exemption still matches exactly one write
    expect(found.filter((v) => !exempt.includes(v))).toEqual([]);
  });
  it('W0.4: liveSlowdown writers live only in src/worker or src/sim', () => {
    expect(scanFiles(outsideCore(), 'liveSlowdown')).toEqual([]);
  });
  it('W0.3b: src/ui and src/game no longer call emergencyOf or getSystem', () => {
    expect(scanFiles(uiAndGame(), 'systems')).toEqual([]);
  });
  it('W0.5: CityScene reads system views through the host', () => {
    expect(scanFiles(['src/game/CityScene.ts'], 'systems')).toEqual([]);
  });
  it('FH-07a: CityScene reaches SimHost and demolition reads without statically loading actions', () => {
    const graph = staticImportGraph('src/game/CityScene.ts');
    expect(graph).toEqual(expect.arrayContaining(['src/game/CityScene.ts', 'src/worker/SimHost.ts', 'src/game/demolishRisk.ts']));
    expect(graph).not.toContain('src/sim/actions.ts');
  });
  it('W0.6: UI, game and render never write into the replica outside src/worker', () => {
    const files = [...uiAndGame(), ...sourceFiles('src/render')]
      .filter((p) => !p.startsWith('src/game/fallback/') && !DEMO_STATES.includes(p));
    // each exemption still names an existing file
    expect(DEMO_STATES.filter((p) => !sourceFiles(p.slice(0, p.lastIndexOf('/'))).includes(p))).toEqual([]);
    expect(scanFiles(files, 'replica')).toEqual([]);
  });
  it('W0.6: the save layer sits below src/worker: no runtime import from it (NOTE-036)', () => {
    // type-only imports (the recovery journal's shape) are erased and allowed
    const up = sourceFiles('src/save').filter((p) => readFileSync(join(ROOT, p), 'utf8').split('\n')
      .some((l) => /['"]\.\.\/worker\//.test(l) && !/^\s*(import|export) type /.test(l)));
    expect(up).toEqual([]);
  });
  it('W0.6: SimCore import graph excludes bundle.ts, save/index.ts and recoveryLs.ts', async () => {
    await expectCleanGraph('src/worker/SimCore.ts');
  });
  it.skip('W1.2: simWorker import graph excludes bundle.ts, save/index.ts and recoveryLs.ts', async () => {
    await expectCleanGraph('src/worker/simWorker.ts');
  });
});
