/** Read-only actions over the current replica, including after a fresh-state adopt. */
import type { CellRect } from '../core/events';
import type { DevType, Network, Zone } from '../core/types';
import { CityActions, type ActionResult, type Cell, type CityActionsApi, type TerraformKind } from '../sim/actions';
import type { CityState } from '../sim/CityState';
import type { ServiceKind } from '../sim/catalogTypes';
import type { Simulation } from '../sim/Simulation';
import { formatMoney } from '../sim/economy/format';
import { loanOffer } from '../sim/economy/loans';
import { getOrdinance, setOrdinanceEnabled } from '../sim/economy/ordinances';
import type { Command, LoanGuard } from './SimHost';

const fail = (reason: string, cost = 0): ActionResult => ({ ok: false, cost, reason, affected: 0 });
const readonly = (): never => { throw new Error('Preview actions are read-only'); };

export class PreviewActions implements CityActionsApi {
  private actions: CityActions;
  constructor(private state: () => CityState) {
    this.actions = new CityActions({
      get state() { return state(); },
      get rng() { return readonly(); },
      get events() { return readonly(); },
      notify: readonly, getSystem: readonly,
    } as unknown as Simulation);
  }

  zone(rect: CellRect, zone: Zone, _preview = true): ActionResult { return this.actions.zone(rect, zone, true); }
  dezone(rect: CellRect, _preview = true): ActionResult { return this.actions.dezone(rect, true); }
  bulldoze(rect: CellRect, _preview = true): ActionResult { return this.actions.bulldoze(rect, true); }
  buildNetwork(path: Cell[], type: Network, _preview = true): ActionResult { return this.actions.buildNetwork(path, type, true); }
  buildPowerLine(path: Cell[], _preview = true): ActionResult { return this.actions.buildPowerLine(path, true); }
  buildSubway(path: Cell[], _preview = true): ActionResult { return this.actions.buildSubway(path, true); }
  plop(id: string, x: number, z: number, rot: 0 | 1 | 2 | 3, _preview = true): ActionResult { return this.actions.plop(id, x, z, rot, true); }
  terraform(kind: TerraformKind, x: number, z: number, radius: number, strength: number, _preview = true): ActionResult { return this.actions.terraform(kind, x, z, radius, strength, true); }
  plantTrees(rect: CellRect, _preview = true): ActionResult { return this.actions.plantTrees(rect, true); }
  setTax(_dev: DevType, _value: number): void { readonly(); }
  setFunding(_service: ServiceKind, _value: number): void { readonly(); }
  toggleHistoric(_id: number): void { readonly(); }

  setOrdinance(id: string, enabled: boolean, opts: { confirm?: boolean } = {}): ActionResult & { needsConfirm?: boolean } {
    const st = this.state(), o = getOrdinance(id);
    if (!o) return fail(`Unknown ordinance "${id}"`);
    // The rule has no preview flag; only its ordinance list is writable, on this private budget copy.
    const copy = Object.assign(Object.create(st) as CityState, { budget: { ...st.budget, ordinances: [...st.budget.ordinances] } });
    const r = setOrdinanceEnabled(copy, id, enabled, opts);
    if (!r.ok) return r.needsConfirm ? { ...fail(r.reason ?? 'Refused', r.monthly), needsConfirm: true } : fail(r.reason ?? 'Refused', r.monthly);
    return { ok: true, cost: r.monthly, affected: 1, reason: enabled ? `${o.name} enacted` : `${o.name} repealed` };
  }

  takeLoan(amount: number): ActionResult {
    const rounded = Math.round(amount), o = loanOffer(this.state(), rounded);
    if (!o.ok) return fail(o.reason ?? 'Loan refused');
    return { ok: true, cost: -rounded, affected: 1, reason: `${(o.rate * 100).toFixed(1)}% for ${o.termMonths / 12} years: ${formatMoney(o.monthlyPayment)}/month` };
  }

  repayLoan(index: number, guard?: LoanGuard): ActionResult {
    const st = this.state(), loan = st.budget.loans[index];
    if (loan && guard && (loan.principal !== guard.principal || loan.monthsLeft !== guard.monthsLeft)) {
      return { ok: false, cost: 0, reason: 'Loan changed — refresh and try again' };
    }
    if (!loan) return fail('No such loan');
    const cost = Math.ceil(loan.remaining);
    if (!st.config.sandbox && st.config.difficulty !== 'sandbox' && cost > 0 && st.funds < cost) return fail(`Not enough money (${formatMoney(cost)})`, cost);
    return { ok: true, cost, affected: 1 };
  }

  predict(cmd: Command): (ActionResult & { needsConfirm?: boolean }) | undefined {
    switch (cmd.op) {
      case 'zone': return this.zone(...cmd.args);
      case 'dezone': return this.dezone(...cmd.args);
      case 'bulldoze': return this.bulldoze(...cmd.args);
      case 'buildNetwork': return this.buildNetwork(...cmd.args);
      case 'buildPowerLine': return this.buildPowerLine(...cmd.args);
      case 'buildSubway': return this.buildSubway(...cmd.args);
      case 'plop': return this.plop(...cmd.args);
      case 'terraform': return this.terraform(...cmd.args);
      case 'plantTrees': return this.plantTrees(...cmd.args);
      case 'setOrdinance': return this.setOrdinance(...cmd.args);
      case 'takeLoan': return this.takeLoan(...cmd.args);
      case 'repayLoan': return this.repayLoan(...cmd.args);
      default: return undefined;
    }
  }
}
