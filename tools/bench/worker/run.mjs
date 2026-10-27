#!/usr/bin/env node
/** node tools/bench/worker/run.mjs --dense FILE --bot FILE [--days 120 --pairs 31 --json FILE] */
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));
const bundle = await rolldown({ input: fileURLToPath(new URL('./protocolBench.ts', import.meta.url)), platform: 'node' });
try {
  const result = await bundle.generate({ format: 'esm', codeSplitting: false });
  if (result.output.length !== 1 || result.output[0].type !== 'chunk') throw new Error('Expected one bench module');
  await import('data:text/javascript;base64,' + Buffer.from(result.output[0].code).toString('base64'));
} finally { await bundle.close(); }
