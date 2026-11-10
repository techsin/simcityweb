/**
 * T028b: the acceptance harness's own selftest (tools/qa-worker/selftest.mjs, node:test: the ack oracle, the two-row
 * protector gate, the recovery-mirror row, the options, and the seams it pins in src/) also runs under vitest. Neither
 * vitest nor tsc loads tools/qa-worker/*.mjs, so without this a change that breaks the harness would first show at the
 * next real-GPU run. It starts no build and no browser.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

it('tools/qa-worker/selftest.mjs passes', { timeout: 180000 }, async ({ skip }) => {
  const run = await new Promise<{ code: number | null; output: string } | NodeJS.ErrnoException>((resolve) => {
    const child = spawn(process.execPath, ['tools/qa-worker/selftest.mjs'], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (s: string) => { output += s; });
    child.stderr.setEncoding('utf8').on('data', (s: string) => { output += s; });
    child.on('error', resolve);
    child.on('close', (code) => resolve({ code, output }));
  });
  if (run instanceof Error) {
    // a sandbox that cannot start a process cannot run it: say so rather than fail
    if (run.code === 'EPERM' || run.code === 'EACCES') skip(`this environment cannot start node (${run.code})`);
    throw run;
  }
  // node:test's TAP lines: one "not ok" per failed case, then the totals
  const failed = run.output.split(/\r?\n/).filter((line) => line.startsWith('not ok'));
  expect(failed, run.output.slice(-6000)).toEqual([]);
  expect(run.code, run.output.slice(-6000)).toBe(0);
  expect(run.output).toMatch(/^# fail 0$/m);
  // a run that found its cases (65 when this was written), not an empty one
  expect(Number(/^# pass (\d+)$/m.exec(run.output)?.[1])).toBeGreaterThanOrEqual(60);
});
