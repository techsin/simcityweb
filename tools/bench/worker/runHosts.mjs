#!/usr/bin/env node
/** Plain-node preflight; no Vite config or child-process path probe. */
import { rolldown } from 'rolldown';
import { fileURLToPath } from 'node:url';
import { buildWorkerTest, hostPlugins } from './buildTests.mjs';

process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));
const worker = await buildWorkerTest();
const output = new URL('./.tmp/hostChecks.mjs', import.meta.url);
const bundle = await rolldown({ input: fileURLToPath(new URL('./hostChecks.ts', import.meta.url)), platform: 'node', plugins: hostPlugins });
try {
  await bundle.write({ file: fileURLToPath(output), format: 'esm', codeSplitting: false });
  const checks = await import(output.href);
  for (const name of ['hostParity', 'crossHostSaves', 'workerBoundaries', 'saveFailureChecks']) {
    await checks[name](worker); console.log(`${name}: passed`);
  }
} finally { await bundle.close(); }

const transportOutput = new URL('./.tmp/transportChecks.mjs', import.meta.url);
const transport = await rolldown({ input: fileURLToPath(new URL('./transportChecks.ts', import.meta.url)), platform: 'node', plugins: hostPlugins });
try {
  await transport.write({ file: fileURLToPath(transportOutput), format: 'esm', codeSplitting: false });
  const checks = await import(transportOutput.href);
  for (const name of ['livenessChecks', 'unitChecks', 'resyncAndCrash', 'bootFailures', 'explicitLiveChecks']) {
    await checks[name](worker); console.log(`${name}: passed`);
  }
} finally { await transport.close(); }
