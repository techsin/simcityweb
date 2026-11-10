/** NOTE-062: read-only ensemble diagnostics, kept outside the bot and saved city. */
import type { CityState } from '../src/sim/CityState';
import type { SimSystem } from '../src/sim/Simulation';
import type { CityActions } from '../src/sim/actions';

export interface BotObservationInputs {
  approvalEma: number;
  rewards: readonly { id: string; kind: string; defIds: readonly string[]; conds: readonly { label: string; need: number }[] }[];
  industrialStrategy?: (st: CityState) => Readonly<{ dirtyShare: number; retooledIM: number; retooledIHT: number }> | undefined;
}
export interface BotObservations {
  commuteTerm?: number;
  commuteTermRaw?: number;
  resCommute?: number;
  approvalNetCommute?: number;
  ihtDemandShareRaw?: number;
  ihtDemandShareCapped?: number;
  ihtDemandShare?: number;
  dirtyJobShare?: number;
  retooledIM?: number;
  retooledIHT?: number;
}
export interface ApprovalAction {
  day: number; date: string; year: number;
  action: 'rewardBought' | 'ordinanceEnacted'; id: string; defId?: string;
  approval: number; approvalThreshold?: number; approvalGate?: 'unlock' | 'bot';
}
interface Host {
  st: CityState;
  sim: { systems: SimSystem[] };
  A: Pick<CityActions, 'plop' | 'setOrdinance'>;
}
interface Economy {
  approvalTerms?: Record<string, number>;
  resCommute?: number;
  rawTarget?: number[];
  target?: number[];
  demandAbs?: number[];
}
interface IndustryTypes { IA?: number; ID: number; IM: number; IHT: number }
const ORDINANCE_APPROVAL: Record<string, number> = { youth_curfew: 55, parking_fines: 55, legalized_gambling: 60 };
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Raw/capped targets are stocks; positive demandAbs is the incremental opportunity gate (farms excluded). */
export function ihtDemandShare(values: readonly number[] | undefined, dev: IndustryTypes, positive = false): number | undefined {
  if (!values || ![dev.ID, dev.IM, dev.IHT].every((d) => finite(values[d]))) return undefined;
  const value = (d: number) => positive ? Math.max(0, values[d]) : values[d];
  const total = value(dev.ID) + value(dev.IM) + value(dev.IHT);
  return total > 0 ? value(dev.IHT) / total : 0;
}

/** Attach after SimBot construction (approval's first update is already complete), before setup/run. */
export function attachBotObservations(bot: Host, dev: IndustryTypes, inputs: BotObservationInputs) {
  if (!finite(inputs.approvalEma) || inputs.approvalEma < 0 || inputs.approvalEma > 1) throw new Error('invalid approval EMA');
  const economy = () => bot.st.systemData.economy as Economy | undefined;
  // Read the stored term, including its population fade; resCommute and avgCommute are not substitutes for it.
  const rawTerm = () => economy()?.approvalTerms?.commute;
  let smoothed = rawTerm();
  const approval = bot.sim.systems.find((s) => s.name === 'economy.approval');
  const monthly = approval?.monthly;
  const wrappedMonthly: SimSystem['monthly'] = monthly && function (sim) {
    monthly.call(approval, sim);
    const term = rawTerm();
    smoothed = finite(term) && finite(smoothed) ? smoothed + (term - smoothed) * inputs.approvalEma : undefined;
  };
  if (approval && wrappedMonthly) approval.monthly = wrappedMonthly;

  const approvalActions: ApprovalAction[] = [];
  const rewards = new Map(inputs.rewards.filter((r) => r.kind === 'reward' || r.kind === 'landmark')
    .flatMap((r) => r.defIds.map((def) => [def, r] as const)));
  const stamp = () => ({ day: bot.st.day, date: bot.st.dateLabel(), year: bot.st.year, approval: bot.st.stats.approval });
  const plop = bot.A.plop;
  const wrappedPlop: CityActions['plop'] = function (this: CityActions, ...args) {
    const reward = rewards.get(args[0]), at = reward && !args[4] ? stamp() : undefined;
    const result = plop.apply(this, args);
    if (result.ok && at && reward) {
      const threshold = reward.conds.find((c) => c.label === 'Approval')?.need;
      approvalActions.push({ ...at, action: 'rewardBought', id: reward.id, defId: args[0],
        ...(finite(threshold) ? { approvalThreshold: threshold, approvalGate: 'unlock' as const } : {}) });
    }
    return result;
  };
  bot.A.plop = wrappedPlop;
  const setOrdinance = bot.A.setOrdinance;
  const wrappedOrdinance: CityActions['setOrdinance'] = function (this: CityActions, ...args) {
    const at = args[1] && !bot.st.budget.ordinances.includes(args[0]) ? stamp() : undefined;
    const result = setOrdinance.apply(this, args);
    if (result.ok && at) {
      const threshold = ORDINANCE_APPROVAL[args[0]];
      approvalActions.push({ ...at, action: 'ordinanceEnacted', id: args[0],
        ...(finite(threshold) ? { approvalThreshold: threshold, approvalGate: 'bot' as const } : {}) });
    }
    return result;
  };
  bot.A.setOrdinance = wrappedOrdinance;

  return {
    approvalActions,
    annual(): BotObservations {
      const data = economy(), raw = rawTerm(), out: BotObservations = {};
      if (finite(raw)) out.commuteTermRaw = raw;
      if (finite(smoothed)) {
        out.commuteTerm = smoothed;
        out.approvalNetCommute = bot.st.stats.approval - smoothed;
      }
      if (finite(data?.resCommute)) out.resCommute = data.resCommute;
      for (const [key, values, positive] of [
        ['ihtDemandShareRaw', data?.rawTarget, false], ['ihtDemandShareCapped', data?.target, false],
        ['ihtDemandShare', data?.demandAbs, true],
      ] as const) {
        const share = ihtDemandShare(values, dev, positive);
        if (share !== undefined) out[key] = share;
      }
      const strategy = inputs.industrialStrategy?.(bot.st);
      if (strategy) {
        if (finite(strategy.dirtyShare)) out.dirtyJobShare = strategy.dirtyShare;
        if (finite(strategy.retooledIM)) out.retooledIM = strategy.retooledIM;
        if (finite(strategy.retooledIHT)) out.retooledIHT = strategy.retooledIHT;
      } else if (dev.IA !== undefined) {
        // Old dev has no retooling. Its filled dirty share is still observable, with the strategy's farm denominator.
        const jobs = bot.st.stats.jobsByDev;
        const types = [dev.IA, dev.ID, dev.IM, dev.IHT];
        if (types.every((d) => finite(jobs[d]))) {
          const total = types.reduce((sum, d) => sum + jobs[d], 0);
          out.dirtyJobShare = total > 0 ? jobs[dev.ID] / total : 0;
        }
      }
      return out;
    },
    dispose(): void {
      if (approval?.monthly === wrappedMonthly) approval.monthly = monthly;
      if (bot.A.plop === wrappedPlop) bot.A.plop = plop;
      if (bot.A.setOrdinance === wrappedOrdinance) bot.A.setOrdinance = setOrdinance;
    },
  };
}
