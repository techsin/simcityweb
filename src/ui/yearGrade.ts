/** LG-21: deterministic mayor's grade; fractions are 0..1, approval is 0..100. */
export interface YearGradeInput {
  growth: number;
  builtOut: boolean;
  unemployment: number;
  approval: number;
  funds: number;
  monthlyExpense: number;
  recurringNet: number;
  incidents: number;
  failed: number;
  crime: number;
  air: number;
  noisyHomes: number;
  services: number;
}

export type YearGradeLetter = 'A' | 'B' | 'C' | 'D' | 'F';
export type YearGradeScores = Record<'growth' | 'approval' | 'finances' | 'safety' | 'environment' | 'services', number>;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const points = (v: number, zero: number, full: number) => clamp(100 * (v - zero) / (full - zero), 0, 100);

export const growthScore = (growth: number): number => points(growth, -0.05, 0.08);
export const unemploymentScore = (rate: number): number => points(rate, 0.12, 0.04);
export const approvalScore = (approval: number): number => points(approval, 30, 80);

export function financeScore(funds: number, monthlyExpense: number, recurringNet: number): number {
  if (funds < 0) return 0;
  const reserve = monthlyExpense > 0 ? 30 + 70 * clamp(funds / monthlyExpense / 3, 0, 1) : 100;
  return clamp(reserve - (recurringNet < 0 ? 15 : 0), 0, 100);
}

export function safetyScore(incidents: number, failed: number, crime: number): number {
  const response = incidents > 0 ? points(failed / incidents, 0.1, 0) : 100;
  return response * (1 - 0.5 * clamp(crime, 0, 1));
}

export function environmentScore(air: number, noisyHomes: number): number {
  return (points(air, 0.3, 0.05) + points(noisyHomes, 0.2, 0)) / 2;
}

export const servicesScore = (services: number): number => points(services, 0.3, 0.9);

export function gradeLetter(score: number): YearGradeLetter {
  return score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
}

export function yearGrade(input: YearGradeInput): { score: number; letter: YearGradeLetter; scores: YearGradeScores } {
  const scores: YearGradeScores = {
    growth: input.builtOut ? unemploymentScore(input.unemployment) : growthScore(input.growth),
    approval: approvalScore(input.approval),
    finances: financeScore(input.funds, input.monthlyExpense, input.recurringNet),
    safety: safetyScore(input.incidents, input.failed, input.crime),
    environment: environmentScore(input.air, input.noisyHomes),
    services: servicesScore(input.services),
  };
  const score = scores.growth * 0.25 + scores.approval * 0.2 + scores.finances * 0.15
    + scores.safety * 0.15 + scores.environment * 0.15 + scores.services * 0.1;
  return { score, letter: gradeLetter(score), scores };
}
