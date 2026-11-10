/**
 * LG-14 "Mayor's challenges": optional rules a city is founded with (the New City dialog's toggles). They live in
 * `config.challenges`, so they are saved with the city and are the same in every host. Each one is a rule of the
 * simulation, read through this module; a city without challenges takes none of these branches and runs exactly as
 * before (no extra random draw in any case).
 *
 *   noLoans            the bank lends nothing (loans.ts: maxLoanAmount, loanOffer)
 *   noDirtyIndustry    dirty industry (I-D) gets no growth allowance, so none ever opens (growth.ts computeAllowance);
 *                      farms, manufacturing and high-tech grow as usual
 *   frequentDisasters  the monthly disaster draw is FREQUENT_DISASTERS times as likely (disasters.ts). This is LG-15's
 *                      "Frequent ×2": its per-city `disasterRate` takes disasterRate() over when it lands
 *   hardMoney          ALL of Hard's money rules on any difficulty (the lead, NOTE-104): Hard's starting funds (set by the
 *                      dialog), its tax income ×0.85 and its 12-month bankruptcy removal (budget.ts), and LG-09's
 *                      running costs ×1.15 (opex.ts, and fullUseUpkeep in infra/facilities.ts). Each reads
 *                      difficultyRules(moneyDifficulty(config)). Hard's tax-approval cost, disasters and dispatch are
 *                      not money: they stay with config.difficulty (and so does Expert's loan cutoff)
 *
 * A challenge earns its badge on the region card once the city has reached the CHALLENGE_BADGE_RANK rank (rewards.ts
 * keeps the reached ranks in systemData.cityRanks; src/region/citySummary.ts writes the badges into the tile summary).
 */
import type { CityState } from '../CityState';

export const MAYOR_CHALLENGES = ['noLoans', 'noDirtyIndustry', 'frequentDisasters', 'hardMoney'] as const;
export type MayorChallenge = (typeof MAYOR_CHALLENGES)[number];

/** the part of a city config the rules read (CityConfigData, or a stand-in in tests) */
interface ChallengeConfig {
  challenges?: readonly string[];
}

export function hasChallenge(config: ChallengeConfig, id: MayorChallenge): boolean {
  return config.challenges?.includes(id) ?? false;
}

/** a config's challenges as the game uses them: known ids only, once each, in MAYOR_CHALLENGES order */
export function cityChallenges(config: ChallengeConfig): MayorChallenge[] {
  const list = config.challenges;
  return list?.length ? MAYOR_CHALLENGES.filter((id) => list.includes(id)) : [];
}

/** "Frequent disasters": how many times as likely the monthly disaster draw is (LG-15's Frequent) */
export const FREQUENT_DISASTERS = 2;
/** the multiplier on a city's monthly disaster chance (1 without the challenge) */
export function disasterRate(config: ChallengeConfig): number {
  return hasChallenge(config, 'frequentDisasters') ? FREQUENT_DISASTERS : 1;
}

/** the difficulty whose MONEY rules a city follows (difficultyRules: income, opexMultiplier, bankruptRemovalMonths):
 *  Hard under "Hard money", else its own */
export function moneyDifficulty(config: ChallengeConfig & { difficulty: string }): string {
  return hasChallenge(config, 'hardMoney') ? 'hard' : config.difficulty;
}

/** what the bank answers under "No loans" (the Budget panel shows it in place of the loan terms) */
export const NO_LOANS_REASON = 'No loans: this city runs under the “No loans” Mayor’s challenge.';

/** the rank at which a city's challenges earn their badges ("City"), and its population (CITY_RANKS, rewards.ts) */
export const CHALLENGE_BADGE_RANK = 'city';
export const CHALLENGE_BADGE_POP = 25_000;

/**
 * The challenges whose badge the city has earned: all of them once it reached CHALLENGE_BADGE_RANK. Reached ranks
 * survive a later drop in population (systemData.cityRanks); a state no reward system ran on yet counts its residents.
 */
export function earnedChallenges(st: Pick<CityState, 'config' | 'stats' | 'systemData'>): MayorChallenge[] {
  const ranks = st.systemData.cityRanks as Record<string, boolean> | undefined;
  return ranks?.[CHALLENGE_BADGE_RANK] === true || st.stats.population >= CHALLENGE_BADGE_POP ? cityChallenges(st.config) : [];
}
