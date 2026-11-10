import { describe, expect, it } from 'vitest';
import { USAGE, parseArgs } from '../../tools/simbot';

describe('bot: LG-09 difficulty options', () => {
  it('accepts Expert without changing the competent mayor defaults', () => {
    expect(parseArgs(['--difficulty', 'expert'])).toEqual({ ...parseArgs([]), difficulty: 'expert' });
    expect(parseArgs([]).difficulty).toBe('medium');
    expect(parseArgs(['--difficulty', 'expert', '--quiet'])).toMatchObject({ difficulty: 'expert', quiet: true });
  });

  it('lists Expert among the available difficulties', () => {
    expect(USAGE).toContain('easy | medium | hard | expert | sandbox (medium)');
  });
});
