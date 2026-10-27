/** Audited synchronous reads. Layer readers require their inputs to have been subscribed and delivered. */
export const REPLICA_SAFE = [
  'listRewards', 'listOrdinances', 'loanOffer', 'maxLoanAmount', 'approvalBreakdown', 'regionTerms',
  'serviceEffectiveness', 'onStrike', 'demandInfo', 'emptyZoneStatus', 'utilityReaches', 'infraFlags',
  'windVector', 'overlayLayer', 'overlayReadout', 'cityFingerprint',
  'zone', 'dezone', 'bulldoze', 'buildNetwork', 'buildPowerLine', 'buildSubway', 'plop', 'terraform', 'plantTrees',
  'setOrdinance', 'takeLoan', 'repayLoan',
] as const;
