/**
 * Audited synchronous reads. Layer readers require their inputs to have been subscribed and delivered.
 * Not listed: approvalBreakdown. Its terms and values match on the replica, but its detail lines (noise, garbage,
 * outages, Easy's crime grace) read approval.ts's survey WeakMap, which only the authoritative residentSurvey fills.
 * Until the survey figures travel in the economy plain data or a query, the approval popover shows no detail lines
 * on a replica (a W1.1b follow-up).
 */
export const REPLICA_SAFE = [
  'listRewards', 'listOrdinances', 'loanOffer', 'maxLoanAmount', 'regionTerms',
  'serviceEffectiveness', 'onStrike', 'demandInfo', 'emptyZoneStatus', 'utilityReaches', 'infraFlags',
  'windVector', 'overlayLayer', 'overlayReadout', 'cityFingerprint',
  'zone', 'dezone', 'bulldoze', 'buildNetwork', 'buildPowerLine', 'buildSubway', 'plop', 'terraform', 'plantTrees',
  'setOrdinance', 'takeLoan', 'repayLoan',
] as const;
