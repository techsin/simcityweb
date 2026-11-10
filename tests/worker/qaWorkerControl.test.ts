/**
 * T061 F3 (T034b's review): tools/qa-worker.mjs only logged a NOTE when its protector control was not observable (the
 * positive control did not deoptimize the probe), so a run whose "worker's probe intact" steps proved nothing still
 * passed. The control's verdicts (tools/qa-worker-control.mjs) now fail the run then.
 */
import { describe, expect, it } from 'vitest';
import { controlChecks } from '../../tools/qa-worker-control.mjs';

const works = { technique: true, made: true, before: true };
describe('qa-worker\'s protector control verdicts (T061 F3)', () => {
  it('a control that is not observable fails the run', () => {
    expect(controlChecks({ ...works, observable: true }).every((c) => c.ok)).toBe(true);
    const unobservable = controlChecks({ ...works, observable: false });
    expect(unobservable.filter((c) => !c.ok).map((c) => c.step)).toEqual([expect.stringMatching(/two views deoptimizes the probe/)]);
    // a control that never ran (its page failed: qa-worker's catch gives { observable: false, error })
    expect(controlChecks({ observable: false }).some((c) => !c.ok)).toBe(true);
    expect(controlChecks({ ...works, technique: false, observable: true }).some((c) => !c.ok)).toBe(true);
  });
});
