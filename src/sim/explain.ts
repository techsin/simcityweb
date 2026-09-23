/**
 * Shared "why?" explanation contract (SIM_DEPTH_SPEC Phase 0). Breakdown functions (conditionBreakdown,
 * approvalBreakdown, desirabilityBreakdown, landValueBreakdown, attractivenessBreakdown, ...) return FactorTerm lists
 * that the inspector / tooltips render generically. Headless: no DOM / three.js.
 */
export interface FactorTerm {
  /** stable id ('noise', 'elem', 'tax', ...) */
  id: string;
  /** short player-facing label */
  label: string;
  /** signed contribution in the breakdown's own units (desirability points, approval points, ...) */
  value: number;
  /** optional detail line ("Oak Elementary 92% full", "3 cells from a coal plant") */
  detail?: string;
}

/** sum of term values */
export function sumTerms(terms: readonly FactorTerm[]): number {
  let s = 0;
  for (const t of terms) s += t.value;
  return s;
}

/** the n terms with the largest |value| (stable for ties), for compact UI lists */
export function topTerms(terms: readonly FactorTerm[], n: number): FactorTerm[] {
  return terms
    .map((t, k) => ({ t, k }))
    .sort((a, b) => Math.abs(b.t.value) - Math.abs(a.t.value) || a.k - b.k)
    .slice(0, n)
    .map((e) => e.t);
}
