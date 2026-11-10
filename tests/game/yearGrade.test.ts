import { describe, expect, it } from 'vitest';
import {
  approvalScore, environmentScore, financeScore, gradeLetter, growthScore, safetyScore, servicesScore,
  unemploymentScore, yearGrade, type YearGradeInput,
} from '../../src/ui/yearGrade';

const poor: YearGradeInput = {
  growth: -0.05, builtOut: false, unemployment: 0.12, approval: 30, funds: -1, monthlyExpense: 100,
  recurringNet: -100, incidents: 10, failed: 1, crime: 0, air: 0.3, noisyHomes: 0.2, services: 0.3,
};

describe('year grade anchors', () => {
  it('scores growth and built-out unemployment linearly and clamps beyond both anchors', () => {
    expect(growthScore(-0.05)).toBe(0);
    expect(growthScore(0.08)).toBe(100);
    expect(growthScore(0.015)).toBeCloseTo(50);
    expect(growthScore(-0.2)).toBe(0);
    expect(growthScore(0.2)).toBe(100);
    expect(unemploymentScore(0.12)).toBe(0);
    expect(unemploymentScore(0.04)).toBe(100);
    expect(unemploymentScore(0.08)).toBeCloseTo(50);
    expect(unemploymentScore(0.2)).toBe(0);
    expect(unemploymentScore(0)).toBe(100);
  });

  it('scores the annual approval mean, including 55 approval at exactly 50 points', () => {
    expect(approvalScore(30)).toBe(0);
    expect(approvalScore(55)).toBe(50);
    expect(approvalScore(80)).toBe(100);
    expect(approvalScore(0)).toBe(0);
    expect(approvalScore(100)).toBe(100);
  });

  it('scores reserves, applies the recurring deficit penalty and handles no expenses', () => {
    expect(financeScore(-1, 100, 100)).toBe(0);
    expect(financeScore(0, 100, 0)).toBe(30);
    expect(financeScore(150, 100, 0)).toBe(65);
    expect(financeScore(300, 100, 0)).toBe(100);
    expect(financeScore(600, 100, 0)).toBe(100);
    expect(financeScore(0, 100, -1)).toBe(15);
    expect(financeScore(300, 100, -1)).toBe(85);
    expect(financeScore(0, 0, 0)).toBe(100);
    expect(financeScore(0, 0, -1)).toBe(85);
    expect(financeScore(-1, 0, 0)).toBe(0);
  });

  it('scores failures and multiplies response quality by crime at homes', () => {
    expect(safetyScore(10, 1, 0)).toBe(0);
    expect(safetyScore(10, 2, 0)).toBe(0);
    expect(safetyScore(10, 0, 0)).toBe(100);
    expect(safetyScore(20, 1, 0)).toBe(50);
    expect(safetyScore(20, 1, 0.4)).toBe(40);
    expect(safetyScore(0, 0, 0)).toBe(100);
    expect(safetyScore(0, 0, 1)).toBe(50);
  });

  it('averages the independently clamped air and Noisy-home scores', () => {
    expect(environmentScore(0.3, 0.2)).toBe(0);
    expect(environmentScore(0.05, 0)).toBe(100);
    expect(environmentScore(0.3, 0)).toBe(50);
    expect(environmentScore(0.05, 0.2)).toBe(50);
    expect(environmentScore(0.175, 0.1)).toBeCloseTo(50);
    expect(environmentScore(1, 1)).toBe(0);
    expect(environmentScore(0, 0)).toBe(100);
  });

  it('scores mean coverage at homes and clamps both ends', () => {
    expect(servicesScore(0.3)).toBe(0);
    expect(servicesScore(0.9)).toBe(100);
    expect(servicesScore(0.6)).toBeCloseTo(50);
    expect(servicesScore(0)).toBe(0);
    expect(servicesScore(1)).toBe(100);
  });
});

describe('mayor grade', () => {
  it.each([
    [39.9, 'F'], [40, 'D'], [54.9, 'D'], [55, 'C'], [69.9, 'C'], [70, 'B'], [84.9, 'B'], [85, 'A'],
  ] as const)('maps %s points to %s', (score, letter) => {
    expect(gradeLetter(score)).toBe(letter);
  });

  it.each([
    ['growth', { growth: 0.08 }, 25],
    ['approval', { approval: 80 }, 20],
    ['finances', { funds: 300, recurringNet: 0 }, 15],
    ['safety', { failed: 0 }, 15],
    ['environment', { air: 0.05, noisyHomes: 0 }, 15],
    ['services', { services: 0.9 }, 10],
  ] as const)('gives %s its specified weight', (stat, values, weighted) => {
    const result = yearGrade({ ...poor, ...values });
    expect(result.scores[stat]).toBe(100);
    expect(result.score).toBe(weighted);
  });

  it('uses unemployment instead of growth only for a built-out city', () => {
    const input = { ...poor, growth: 0.08, unemployment: 0.12 };
    expect(yearGrade(input).scores.growth).toBe(100);
    expect(yearGrade({ ...input, builtOut: true }).scores.growth).toBe(0);
    expect(yearGrade({ ...input, builtOut: true, unemployment: 0.04 }).scores.growth).toBe(100);
  });

  it('grades a city in debt with approval 30 and 20% failed emergencies F', () => {
    const result = yearGrade({ ...poor, growth: -0.03, failed: 2, crime: 0.4, air: 0.25, noisyHomes: 0.15, services: 0.4 });
    expect(result.letter).toBe('F');
    expect(result.score).toBeLessThan(40);
    expect(result.scores.approval).toBe(0);
    expect(result.scores.finances).toBe(0);
    expect(result.scores.safety).toBe(0);
  });

  it('is deterministic without mutating its inputs', () => {
    const input = Object.freeze({ ...poor, growth: 0.08, approval: 80, funds: 300, recurringNet: 0, failed: 0, air: 0.05, noisyHomes: 0, services: 0.9 });
    expect(yearGrade(input)).toEqual(yearGrade(input));
    expect(yearGrade(input)).toMatchObject({ score: 100, letter: 'A' });
  });
});
