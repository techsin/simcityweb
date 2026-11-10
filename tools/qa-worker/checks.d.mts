/** The rows of checks.mjs that run without a browser in tests/worker/qaWorkerJournal.test.ts. */
import type { Report } from './harness.mjs';

/** what the recovery-mirror row uses of the harness's Driver */
export interface RecoveryDriver {
  page: { evaluate(fn: (arg: any) => unknown, arg?: unknown): Promise<any> };
  options: { host: string; ackTimeout: number };
  /** a real UI stroke with `tool` at `cell`; resolves to the acknowledged command rows */
  draw(op: string, tool: string, cell: number[]): Promise<{ seq: number }[]>;
}
export const BROWSER_CHECKS: string[];
export function recoveryMirror(d: RecoveryDriver, report: Report): Promise<void>;
