/**
 * City loans (bonds): 5–10% annual interest (rises with the number of loans and when broke), 10-year term,
 * max outstanding principal relative to population. Payments are charged monthly by the budget ('loan').
 */
import type { CityState, Loan } from '../CityState';
import {
  LOAN_MAX_BASE, LOAN_MAX_COUNT, LOAN_MAX_PER_CAPITA, LOAN_MIN, LOAN_RATE_MAX, LOAN_RATE_MIN, LOAN_RATE_NEG_FUNDS,
  LOAN_RATE_PER_LOAN, LOAN_TERM_MONTHS,
} from './tuning';
import { formatMoney } from './format';

export interface LoanOffer {
  ok: boolean;
  reason?: string;
  /** annual interest rate */
  rate: number;
  monthlyPayment: number;
  termMonths: number;
  /** largest amount that can be borrowed right now */
  maxAmount: number;
}

export function outstandingDebt(st: CityState): number {
  let s = 0;
  for (const l of st.budget.loans) s += l.remaining;
  return s;
}

export function loanRate(st: CityState): number {
  let r = LOAN_RATE_MIN + LOAN_RATE_PER_LOAN * st.budget.loans.length;
  if (st.funds < 0) r += LOAN_RATE_NEG_FUNDS;
  return Math.min(LOAN_RATE_MAX, r);
}

export function maxLoanAmount(st: CityState): number {
  if (st.budget.loans.length >= LOAN_MAX_COUNT) return 0;
  const cap = LOAN_MAX_BASE + LOAN_MAX_PER_CAPITA * st.stats.population;
  return Math.max(0, Math.floor((cap - outstandingDebt(st)) / 1000) * 1000);
}

export function amortizedPayment(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  if (r <= 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

/** Terms for borrowing `amount` now (does not mutate). */
export function loanOffer(st: CityState, amount: number): LoanOffer {
  const rate = loanRate(st);
  const maxAmount = maxLoanAmount(st);
  const monthlyPayment = amortizedPayment(Math.max(0, amount), rate, LOAN_TERM_MONTHS);
  const base = { rate, monthlyPayment, termMonths: LOAN_TERM_MONTHS, maxAmount };
  if (st.budget.loans.length >= LOAN_MAX_COUNT) return { ok: false, reason: `At most ${LOAN_MAX_COUNT} loans at a time`, ...base };
  if (!(amount >= LOAN_MIN)) return { ok: false, reason: `Minimum loan is ${formatMoney(LOAN_MIN)}`, ...base };
  if (amount > maxAmount) return { ok: false, reason: `The bank will lend at most ${formatMoney(maxAmount)}`, ...base };
  return { ok: true, ...base };
}

/** Take a loan: funds += amount. */
export function takeLoanNow(st: CityState, amount: number): LoanOffer {
  const o = loanOffer(st, amount);
  if (!o.ok) return o;
  const loan: Loan = { principal: amount, remaining: amount, rate: o.rate, monthlyPayment: o.monthlyPayment, monthsLeft: LOAN_TERM_MONTHS };
  st.budget.loans.push(loan);
  st.funds += amount;
  st.budget.curIncome['oneoff:loan'] = (st.budget.curIncome['oneoff:loan'] ?? 0) + amount;
  return o;
}

/** Monthly amortization step for all loans; returns total paid this month. */
export function payLoansMonthly(st: CityState): number {
  let paid = 0;
  const loans = st.budget.loans;
  for (let k = loans.length - 1; k >= 0; k--) {
    const l = loans[k];
    const interest = l.remaining * (l.rate / 12);
    const pay = Math.min(l.monthlyPayment, l.remaining + interest);
    l.remaining = Math.max(0, l.remaining + interest - pay);
    l.monthsLeft--;
    paid += pay;
    if (l.monthsLeft <= 0 || l.remaining < 1) loans.splice(k, 1);
  }
  return paid;
}
