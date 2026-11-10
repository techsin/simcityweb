/** T058 (FH-21 bug 4): Play's load time starts after the "Recover unsaved progress?" dialog, not before it. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');

describe("Play's load time (T058)", () => {
  it('takes t0 after the recovery gate and passes that t0 to enterCity (which records lastLoadMs from it)', () => {
    // App is not exported and main.ts boots on import, so this reads playCity's source, as graphicsFirstRun does for the ctor
    const start = main.indexOf('  async playCity(');
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf('\n  }\n', start));
    const gate = body.indexOf('await this.recoveryGate(');
    const t0 = body.indexOf('const t0 = performance.now();');
    expect(gate).toBeGreaterThan(-1);
    expect(t0).toBeGreaterThan(gate);
    expect(body).toMatch(/await this\.enterCity\([^)]*\bt0\)/);
  });
});
