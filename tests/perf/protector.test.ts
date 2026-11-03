/**
 * WORKER_DESIGN S1 / R10: 60 headless days, clone-only results, two independently probed isolates per kernel mode.
 * Negative controls also run below. To make the positive gate fail deliberately:
 *   S1_PROTECTOR_FAULT=transfer npx vitest run tests/perf/protector.test.ts -t 'SIM_WASM=js'
 *   S1_PROTECTOR_FAULT=grow npx vitest run tests/perf/protector.test.ts -t 'SIM_WASM=wasm'
 *   (PowerShell: $env:S1_PROTECTOR_FAULT='transfer'; ... ; Remove-Item Env:S1_PROTECTOR_FAULT)
 * No timing assertions or source aliases: forced wasm exercises the blur drop-in alongside the Simulation.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { rolldown } from 'rolldown';
import { protectorFailures, type Fault, type ProtectorReport, type Run } from './protectorResult';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TIMEOUT = 180000;
const REPORT = 'S1_PROTECTOR_REPORT=';
let source: string;

beforeAll(async () => {
  const bundle = await rolldown({ input: fileURLToPath(new URL('./protectorChild.ts', import.meta.url)), platform: 'node' });
  try {
    const result = await bundle.generate({ format: 'esm', codeSplitting: false });
    if (result.output.length !== 1 || result.output[0].type !== 'chunk') throw new Error('expected one self-contained child bundle');
    source = result.output[0].code;
  } finally { await bundle.close(); }
}, 30000);

function runChild(mode: 'js' | 'wasm', fault: Fault = 'none'): Promise<Run> {
  // Pipe the bundle instead of writing build files or exceeding Windows' command-line length limit.
  const bootstrap = `
    const source = require('node:fs').readFileSync(0, 'utf8');
    globalThis.__s1Source = source;
    import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
      .catch(e => { console.error(e.message); process.exitCode = 1; });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--allow-natives-syntax', '--trace-protector-invalidation', '--eval', bootstrap], {
      cwd: ROOT, windowsHide: true,
      env: { ...process.env, SIM_WASM: mode, SIM_WASM_PATH: join(ROOT, 'src/wasm/sim_kernels.wasm'), S1_PROTECTOR_FAULT: fault },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`protector child timed out (${mode}, ${fault})`)); }, TIMEOUT - 5000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.stdin.on('error', (e) => { child.kill(); clearTimeout(timer); reject(e); });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (s: string) => { stdout += s; });
    child.stderr.on('data', (s: string) => { stderr += s; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      try {
        const output = `${stdout}\n${stderr}`;
        if (code !== 0) throw new Error(`protector child failed (${mode}, ${fault}, code=${code}, signal=${signal}):\n${output}`);
        const lines = stdout.split(/\r?\n/).filter((line) => line.startsWith(REPORT));
        if (lines.length !== 1) throw new Error(`expected one child report:\n${output}`);
        const report = JSON.parse(lines[0].slice(REPORT.length)) as ProtectorReport;
        if (report.worker.mode !== mode) throw new Error(`child ran the wrong kernel mode: ${report.worker.mode}`);
        resolve({ report,
          trace: output.split(/\r?\n/).filter((line) => /Invalidating protector cell/i.test(line)) });
      } catch (e) { reject(e); }
    });
    child.stdin.end(source);
  });
}

describe('S1 ArrayBuffer-detaching protector', () => {
  for (const mode of ['js', 'wasm'] as const) {
    it(`SIM_WASM=${mode}: both isolates stay intact through 60 days and clone-only results`, { timeout: TIMEOUT }, async () => {
      const run = await runChild(mode, (process.env.S1_PROTECTOR_FAULT ?? 'none') as Fault);
      expect(protectorFailures(run), JSON.stringify(run.report)).toEqual([]);
    });
  }

  it('negative control: one worker transfer fails the same protector gate, only in the sender', { timeout: TIMEOUT }, async () => {
    const run = await runChild('js', 'transfer');
    expect(run.report.main).toEqual({ initial: true, intact: true });
    expect(run.report.worker).toMatchObject({ initial: true, afterBoot: true, intact: false, days: 60 });
    expect(protectorFailures(run)).toContain('worker protector invalidated');
    expect(run.trace.join('\n')).toMatch(/Invalidating protector cell.*ArrayBufferDetaching/);
    console.log('[protector negative control] one transfer: worker invalidated, main intact; trace detected');
  });

  it('negative control: one memory.grow fails the protector and memory-size gates', { timeout: TIMEOUT }, async () => {
    const run = await runChild('wasm', 'grow');
    expect(run.report.main).toEqual({ initial: true, intact: true });
    expect(run.report.worker).toMatchObject({ initial: true, afterBoot: true, intact: false, days: 60, memoryStable: false });
    expect(run.report.worker.memoryAfter! - run.report.worker.memoryBefore!).toBe(65536);
    expect(protectorFailures(run)).toContain('worker protector invalidated');
    expect(protectorFailures(run)).toContain('wasm memory grew');
    expect(run.trace.join('\n')).toMatch(/Invalidating protector cell.*ArrayBufferDetaching/);
    console.log('[protector negative control] one grow: worker invalidated, main intact; size changed by one page; trace detected');
  });
});
