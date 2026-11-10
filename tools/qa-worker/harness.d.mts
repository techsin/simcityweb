/** The part of harness.mjs the vitest-side tests of the acceptance harness use (tests/worker/qaWorkerJournal.test.ts). */
export interface ReportCheck { name: string; status: 'PASS' | 'FAIL' | 'SKIPPED'; reason: string }
export class Skipped {
  constructor(reason: string);
  reason: string;
}
export class Report {
  checks: ReportCheck[];
  details: Record<string, any>;
  readonly failed: boolean;
  readonly exitCode: number;
  add(name: string, status: ReportCheck['status'], reason: string): void;
  passed(name: string): boolean;
  check(name: string, fn: () => unknown, dependencies?: string[]): Promise<void>;
}
