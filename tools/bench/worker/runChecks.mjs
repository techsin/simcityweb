#!/usr/bin/env node
/** In-process bundle + plain Node import: no Vite path probe, child process or heap override. */
import { mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));
const output = new URL('./.tmp/debugReplica.mjs', import.meta.url);
await mkdir(new URL('./.tmp/', import.meta.url), { recursive: true });
const bundle = await rolldown({ input: fileURLToPath(new URL('./debugReplica.ts', import.meta.url)), platform: 'node' });
try {
  await bundle.write({ file: fileURLToPath(output), format: 'esm', codeSplitting: false });
  await import(output.href);
} finally {
  await bundle.close();
  await unlink(output).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}
