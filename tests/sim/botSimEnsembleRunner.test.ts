import { describe, expect, it } from 'vitest';
import { assertParsedBotArgs, compatibleCacheSource, ensembleMembers, memberCacheKey, parseOptions, requiredRuns, validateBotArgs } from '../../tools/simEnsemble.mjs';

const row = { size: 128, years: 15, seed: 7 };
const args = ['--size', '128', '--years', '15', '--seed', '7', '--out-dir', 'ensemble-out', '--quiet-gate', 'quietrun.mjs'];
const source = { commit: 'commit', simBlob: 'bot', srcTree: 'src', dependencies: 'lock', observer: 'observer' };

describe('bot: NOTE-062 ensemble collection contract', () => {
  it('uses the control and symmetric amounts at exactly the two protocol timings', () => {
    expect(ensembleMembers(100, 5)).toEqual([
      { id: 'control', nudge: 0, day: 1 }, { id: 'p100-d1', nudge: 100, day: 1 },
      { id: 'm100-d1', nudge: -100, day: 1 }, { id: 'p100-d1441', nudge: 100, day: 1441 },
      { id: 'm100-d1441', nudge: -100, day: 1441 },
    ]);
    const nine = ensembleMembers(100, 9);
    expect(nine.slice(0, 5)).toEqual(ensembleMembers(100, 5));
    expect(nine.slice(5).map(({ nudge, day }) => [nudge, day])).toEqual([[200, 1], [-200, 1], [200, 1441], [-200, 1441]]);
  });

  it('defaults base rows directly to nine members, 100 funds and three quiet-gated slots', () => {
    expect(parseOptions(args)).toMatchObject({ ...row, nudge: 100, runs: 9, jobs: 3, botArgs: [], importDirs: [], variant: false });
    expect(parseOptions([...args, '--nudge', '25', '--runs', '9', '--jobs', '1'])).toMatchObject({ nudge: 25, runs: 9, jobs: 1 });
    for (const value of ['0', '-1', 'Infinity', 'NaN']) expect(() => parseOptions([...args, '--nudge', value])).toThrow('--nudge');
    for (const value of ['0', '1.5', 'Infinity']) expect(() => parseOptions([...args, '--jobs', value])).toThrow('--jobs');
    expect(() => parseOptions([...args, '--runs', '7'])).toThrow('--runs');
    expect(() => ensembleMembers(Number.MAX_VALUE, 9)).toThrow('invalid');
  });

  it('requires nine directly for every base and long variant, with no third stage', () => {
    const long = ['--size', '256', '--years', '60', '--seed', '11', '--out-dir', 'out', '--quiet-gate', 'gate'];
    expect(requiredRuns(row, false)).toBe(9);
    expect(requiredRuns(row, true)).toBe(5);
    expect(requiredRuns({ size: 256, years: 60, seed: 7 }, true)).toBe(9);
    for (const selection of [args, long, [...long, '--', '--neglect']]) {
      expect(parseOptions(selection).runs).toBe(9);
    }
    expect(() => parseOptions([...args, '--runs', '5'])).toThrow('NOTE-062');
    expect(() => parseOptions([...long, '--runs', '5', '--', '--subway'])).toThrow('NOTE-062');
    expect(() => parseOptions([...args, '--variant', '--runs', '15'])).toThrow('no third stage');
    expect(parseOptions([...args, '--variant'])).toMatchObject({ variant: true, runs: 5, botArgs: [] });
    expect(parseOptions([...args, '--', '--skip', 'dirty'])).toMatchObject({ variant: true, runs: 5 });
    expect(parseOptions([...args, '--runs', '9', '--', '--skip', 'dirty'])).toMatchObject({ variant: true, runs: 9 });
    expect(parseOptions([...args, '--base', '--', '--difficulty', 'hard'])).toMatchObject({ variant: false, runs: 9 });
    expect(() => parseOptions([...args, '--base', '--variant'])).toThrow('mutually exclusive');
    expect(() => parseOptions([...args, '--base', '--runs', '5', '--', '--subway'])).toThrow('NOTE-062');
    expect(parseOptions([...args, '--members', 'control,p200-d1'])).toMatchObject({ runs: 9, members: ['control', 'p200-d1'] });
  });

  it('reuses existing five-member cache identities for nine runs and different job counts', () => {
    const five = parseOptions([...args, '--variant', '--runs', '5', '--jobs', '1']);
    const nine = parseOptions([...args, '--runs', '9', '--jobs', '3']);
    for (const member of ensembleMembers(100, 5)) {
      expect(memberCacheKey(source, five, member, [])).toBe(memberCacheKey(source, nine, member, []));
    }
    expect(memberCacheKey(source, five, { nudge: 0, day: 1 }, [])).toBe(
      memberCacheKey(source, parseOptions([...args, '--nudge', '1000']), { nudge: 0, day: 1 }, []));
  });

  it('reuses only the known read-only predecessor observer without weakening source identity', () => {
    const old = { ...source, observer: 'd521f1e3fbd7a0b4c03d37c356d798a87ad78e06461ba8fcd9bc217e1bf82270' };
    expect(compatibleCacheSource(source, source)).toBe(true);
    expect(compatibleCacheSource(old, source)).toBe(true);
    expect(compatibleCacheSource({ ...old, observer: 'arbitrary-other-observer' }, source)).toBe(false);
    for (const field of ['commit', 'simBlob', 'srcTree', 'dependencies'] as const) {
      expect(compatibleCacheSource({ ...old, [field]: 'other' }, source)).toBe(false);
    }
  });

  it('separates every scientific cache identity dimension', () => {
    const member = { nudge: 100, day: 1 }, key = memberCacheKey(source, row, member, []);
    for (const field of ['commit', 'simBlob', 'srcTree', 'dependencies', 'observer'] as const) {
      expect(memberCacheKey({ ...source, [field]: 'other' }, row, member, [])).not.toBe(key);
    }
    expect(memberCacheKey(source, { ...row, seed: 11 }, member, [])).not.toBe(key);
    expect(memberCacheKey(source, { ...row, years: 60 }, member, [])).not.toBe(key);
    expect(memberCacheKey(source, { ...row, size: 256 }, member, [])).not.toBe(key);
    expect(memberCacheKey(source, row, { nudge: -100, day: 1 }, [])).not.toBe(key);
    expect(memberCacheKey(source, row, { nudge: 100, day: 1441 }, [])).not.toBe(key);
    expect(memberCacheKey(source, row, member, ['--neglect'])).not.toBe(key);
  });

  it('allows report-only reuse and explicit legacy imports without changing variant identity', () => {
    const opts = parseOptions([...args, '--report-only', '--import-dir', 'old-a', '--import-dir', 'old-b', '--bot-args', '["--difficulty","hard"]']);
    expect(opts).toMatchObject({ reportOnly: true, botArgs: ['--difficulty', 'hard'] });
    expect(opts.importDirs).toHaveLength(2);
    expect(parseOptions([...args, '--', '--neglect', '--skip', 'transit']).botArgs).toEqual(['--neglect', '--skip', 'transit']);
    expect(() => parseOptions([...args, '--bot-args', '[]', '--', '--neglect'])).toThrow('either');
  });

  it('protects row, nudge and filesystem controls from variant argument overrides', () => {
    for (const botArgs of [['--seed', '11'], ['--size', '256'], ['--years', '1'], ['--aa-funds-nudge', '1'], ['--save-prefix', 'out']]) {
      expect(() => validateBotArgs(botArgs)).toThrow('unsupported');
    }
    expect(() => validateBotArgs(['--difficulty'])).toThrow('needs a value');
    expect(() => validateBotArgs(['--tax-start-year', '0'])).toThrow('positive integer');
    expect(validateBotArgs(['--tax=12', '--tax-start-year=21'])).toEqual(['--tax=12', '--tax-start-year=21']);
    expect(() => parseOptions([...args, '--members', 'control,control'])).toThrow('duplicate');
    expect(() => parseOptions([...args, '--members', 'p300-d1'])).toThrow('unknown');
  });

  it('rejects a variant silently ignored by an older selected bot parser', () => {
    expect(() => assertParsedBotArgs(['--tax-start-year', '21'], { tax: 12 })).toThrow('did not apply');
    expect(() => assertParsedBotArgs(['--neglect'], {})).toThrow('did not apply');
    expect(() => assertParsedBotArgs(['--tax=12', '--tax-start-year=21', '--skip', 'transit,dirty', '--no-infra'],
      { tax: 12, taxStartYear: 21, skip: ['transit', 'dirty'], noInfra: true })).not.toThrow();
  });
});
