#!/usr/bin/env node
/** Build first with buildTests.mjs --protector; run this entry in a fresh process with S1's V8 flags. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));
process.env.SIM_WASM = process.argv[2] ?? 'js';
process.env.SIM_WASM_PATH = fileURLToPath(new URL('../../../src/wasm/sim_kernels.wasm', import.meta.url));
process.env.S1_PROTECTOR_FAULT = process.argv[3] ?? 'none';
const source = readFileSync(new URL('./.tmp/protectorChild.mjs', import.meta.url), 'utf8');
globalThis.__s1Source = source;
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
