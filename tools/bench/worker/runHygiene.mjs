#!/usr/bin/env node
/** Run the actual S1 scanner / graph walker without Vite's config loader. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const root = new URL('../../../', import.meta.url);
const bundle = await rolldown({ input: fileURLToPath(new URL('../../../tests/worker/hygieneScan.ts', import.meta.url)), platform: 'node',
  external: ['rolldown', 'rolldown/utils'], plugins: [{ name: 'scanner-root', transform(code, id) {
    if (!id.endsWith('hygieneScan.ts')) return null;
    return code.replace("new URL('../../', import.meta.url)", JSON.stringify(root.href));
  } }] });
const output = new URL('./.tmp/hygieneScan.mjs', import.meta.url);
try {
  await bundle.write({ file: fileURLToPath(output), format: 'esm', codeSplitting: false });
  const { importGraph, scanFiles, sourceFiles } = await import(output.href);
  const files = [...sourceFiles('src/sim'), ...sourceFiles('src/save').filter((p) => !['src/save/index.ts', 'src/save/bundle.ts'].includes(p)),
    ...sourceFiles('src/worker'), ...sourceFiles('tests/worker'), ...sourceFiles('tests/perf'), ...sourceFiles('tools/bench/worker').filter((p) => !p.includes('/.tmp/'))];
  const found = scanFiles(files).map(({ file, rule, code }) => ({ file, rule, code }));
  assert.deepEqual(found, [
    { file: 'tests/worker/protectorFaults.ts', rule: 'transfer list', code: "port.postMessage({ t: 'control', buffer }, [buffer])" },
    { file: 'tests/worker/protectorFaults.ts', rule: 'memory.grow', code: 'memory.grow(1)' },
  ]);
  for (const entry of ['src/worker/SimCore.ts', 'src/worker/simWorker.ts']) {
    const graph = await importGraph(entry);
    assert.ok(graph.includes(entry));
    assert.deepEqual(graph.filter((p) => ['src/save/bundle.ts', 'src/save/index.ts', 'src/save/recoveryLs.ts'].includes(p)), []);
  }
  console.log('S1 isolate scan and both worker import graphs: passed');
} finally { await bundle.close(); }
