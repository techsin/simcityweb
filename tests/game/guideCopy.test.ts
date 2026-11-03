/** §4 copy contract. Verbose test names are the rendered examples: no snapshots or report files to update. */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createScanner, SyntaxKind } from 'typescript/unstable/ast';
import { CITY_SIZES, MONTHS_PER_YEAR } from '../../src/core/constants';
import { Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { WIND_SPACING } from '../../src/sim/actions';
import * as catalog from '../../src/sim/catalog';
import { DIFFICULTY_FUNDS } from '../../src/sim/config';
import { APPROVAL_LABELS } from '../../src/sim/economy/approval';
import { computeMonthlyBudget } from '../../src/sim/economy/budget';
import { CONN_MIN_CELLS, CONN_MIN_DEPTH } from '../../src/sim/economy/connections';
import { loanOffer, maxLoanAmount } from '../../src/sim/economy/loans';
import { ORDINANCES } from '../../src/sim/economy/ordinances';
import { REWARDS } from '../../src/sim/economy/rewards';
import * as tuning from '../../src/sim/economy/tuning';
import * as params from '../../src/sim/infra/params';
import { money, num } from '../../src/ui/format';
import { guideCopy, type WindStart, type ZoneTargets } from '../../src/ui/guide/copy';
import { place } from '../infra/cityGen';
import { makeCity } from '../sim/helpers';

const source = readFileSync(new URL('../../src/ui/guide/copy.ts', import.meta.url), 'utf8');
const fresh = makeCity({}, []).st;
const town = makeCity({}, []).st;
// Representative event inputs, starting from the standard fresh-city helper; no simulation ticks or browser.
town.stats.population = 600;
town.stats.residents = [town.stats.population, 0, 0];
town.stats.needs.elementary.unreached = 128;
town.stats.approval = 42;
town.stats.powerDemand = 10;
const start: WindStart = { turbines: 3, residentsPerMW: 300, residentRounding: 500 };
town.stats.powerSupply = start.turbines * catalog.getDef('util_wind_turbine')!.powerOut! * params.WIND_TURBINE_BASE;
town.budget.funding.fire = 110;
const station = place(town, 'civ_fire_station', 10, 10, { flags: BF.Plopped | BF.Powered });
place(town, 'civ_police_kiosk', 20, 10, { flags: BF.Plopped | BF.Powered });
const budget = computeMonthlyBudget(town, null);
const monthlyNet = budget.totalIncome - budget.totalExpense;
const taxPoints = 1, recoveryFunding = 90;
const originalRates = town.budget.taxRates;
town.budget.taxRates = originalRates.map((rate) => rate + taxPoints);
const taxGain = computeMonthlyBudget(town, null).totalIncome - budget.totalIncome;
town.budget.taxRates = originalRates;
const originalFunding = town.budget.funding.fire;
town.budget.funding.fire = recoveryFunding;
const serviceSaving = budget.totalExpense - computeMonthlyBudget(town, null).totalExpense;
town.budget.funding.fire = originalFunding;
const loanAmount = 10_000, offer = loanOffer(fresh, loanAmount);
const target: ZoneTargets = { R: 40, C: 8, I: 12 };
const smallTarget: ZoneTargets = {
  R: target.R * fresh.size / CITY_SIZES.medium,
  C: target.C * fresh.size / CITY_SIZES.medium,
  I: target.I * fresh.size / CITY_SIZES.medium,
};

const recovering = makeCity({}, []).st;
recovering.funds = -500;
recovering.stats.population = 3000;
recovering.stats.residents = [recovering.stats.population, 0, 0];
const recoveryBudget = computeMonthlyBudget(recovering, null);
const availableMonthly = recoveryBudget.totalIncome - recoveryBudget.totalExpense;
let recoveryAmount = maxLoanAmount(recovering);
while (recoveryAmount >= tuning.LOAN_MIN && loanOffer(recovering, recoveryAmount).monthlyPayment > availableMonthly) recoveryAmount -= 1000;
const recoveryOffer = loanOffer(recovering, recoveryAmount);

type ExampleArgs = {
  [Section in keyof typeof guideCopy]: {
    [Id in keyof (typeof guideCopy)[Section]]: (typeof guideCopy)[Section][Id] extends (...args: infer Args) => string ? Args : never;
  };
};

// This mapped type makes adding a text without a rendered example a type error.
const exampleArgs: ExampleArgs = {
  phaseA: {
    A1: [], A1Subtitle: [2], A1Region: [], A2Wind: [start], A2Zones: [], A2Play: [],
    A3Tile: [], A3Guided: [], A3Veteran: [], A3Easy: [], A3Medium: [], A3Hard: [], A3Sandbox: [], A3Disasters: [2000],
  },
  phaseB: {
    BTitle: [], BPaused: [], B1Title: [], B1: [], B1Hint: [], B2Title: [], B2: [smallTarget], B2Cost: [],
    B2RoadHint: [], B2CountHint: [smallTarget, 18], B3Title: [], B3: [start], B3Output: [start], B3Roads: [],
    B3Hint: [], B3FuelHint: ['util_coal_plant', start.residentsPerMW], B4Title: [], B4: [], B4Pipes: [], B4Hint: [],
    B5Title: [], B5: [], B5Locked: [], BSpend: [48_000, fresh.config.startFunds], BComplete: [], BCompleteFire: [],
  },
  phaseC: {
    CTitle: [], CProgress: [3, 10, guideCopy.phaseC.G2Title()], G1Title: [500], G1: [], G1Query: [], G2Title: [], G2: [3, 3],
    G3Title: [], G3: [], G4Title: [], G4: [], G5Title: [], G5: [taxGain], G6Title: [], G6: [town.stats],
    G7Title: [], G7: [], G8Title: [], G8: [], G9Title: [], G9: [], G9Next: [false],
    G10Title: [], G10: [town.stats], G10Wind: [], G10Gas: [], G10Siting: [], CComplete: [],
  },
  phaseD: {
    E1a: [station, 3.9], E1aLegend: [], E1b: [], E2: [], E3: [5.6, 5], E4: [monthlyNet, taxPoints, taxGain],
    E4Loan: [loanAmount, offer], E5: [], E5Taxes: [taxPoints, taxGain], E5Service: ['fire', recoveryFunding, serviceSaving],
    E5Loan: [recoveryAmount, recoveryOffer], E6Homes: [], E6Shops: [], E6Industry: [], E7Homes: [], E7Shops: [], E7Industry: [],
    E8: [town.stats.approval, { label: APPROVAL_LABELS.crime, value: -8 }], E8Risk: [], E9: ['civ_mayor_house'],
    E10: ['tornado', 'Riverside', 7], E10Clear: [], E11: [], E12: [town.stats], E12Fix: [],
  },
  phaseE: { Roads: [], Pipes: [], Region: [], Emergencies: [], Inspector: [], Taxes: [] },
  actions: {
    Road: [], Zones: [], Wind: [], Water: [], Play: [], Query: [], Landfill: [], Police: [], Fire: [], Taxes: [], Loans: [],
    Education: [], Views: [], Rewards: [], Power: [], SendNearest: [], EmergencyView: [], GotIt: [], Settings: [],
    Parks: [], FixApproval: ['police cover'], PlaceReward: ['civ_mayor_house'], Jump: [], Bulldoze: [], Ordinances: [],
    PowerView: [], GuidedStart: [],
  },
};

function renderExamples() {
  const args = exampleArgs as Record<string, Record<string, unknown[]>>;
  return Object.entries(guideCopy).flatMap(([section, texts]) => Object.entries(texts).map(([id, render]) => ({
    id: `${section}.${id}`, text: (render as (...values: unknown[]) => string)(...args[section][id]),
  })));
}

function words(text: string): number {
  return text.trim().split(/\s+/u).length;
}

function sentences(text: string): number {
  // Decimal points and the literal inspector control "Why?" are not sentence endings.
  return text.replace(/(?<=\d)\.(?=\d)/gu, '').replace(/\bWhy\?/gu, 'Why').split(/[.!?]+(?:\s+|$)/u).filter((s) => s.trim()).length;
}

function checkCopy(text: string): void {
  expect(text.trim()).not.toBe('');
  expect(words(text), text).toBeLessThanOrEqual(30);
  expect(sentences(text), text).toBeLessThanOrEqual(2);
  expect(text).not.toMatch(/undefined|NaN|Infinity|\[object Object\]/u);
  // Imperatives address "you" implicitly, including compact button labels and goal titles.
  expect(/\b(?:you|your|yours|yourself)\b/iu.test(text) || /^(?:Create|Connect|Zone|Press|Grow|Take|Ask|Add|Build|Open|Place|Play|Inspect|Explore|See|Send|Continue|Go|Clear)\b/u.test(text), text).toBe(true);
  const withoutWealthCodes = text.replace(/\((?:R|CS|CO)\${1,3}\)/gu, '');
  expect(withoutWealthCodes).not.toMatch(/[$€£¥]|\b(?:USD|EUR|GBP|dollars?|euros?)\b/iu);
  expect(text).not.toMatch(/\byou (?:failed|forgot|ignored|neglected)|\byour fault\b/iu);
  for (const match of text.matchAll(/\b(?:RCI|LIVE|R|C|I)\b/gu)) {
    expect(text.slice(match.index - 1, match.index + match[0].length + 1)).toBe(`(${match[0]})`);
    expect(text.slice(0, match.index - 1)).toMatch(/[a-z]/iu);
  }
}

/** The local TypeScript scanner handles quotes, escapes, comments and nested template substitutions. */
function scan(text: string) {
  const scanner = createScanner(true, undefined, text);
  const templates: number[] = [];
  let depth = 0;
  const tokens: { kind: SyntaxKind; text: string; value: string; interpolated: boolean }[] = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if (kind === SyntaxKind.CloseBraceToken && templates.at(-1) === depth) {
      kind = scanner.reScanTemplateToken(false);
      if (kind === SyntaxKind.TemplateTail) templates.pop();
    } else if (kind === SyntaxKind.OpenBraceToken) depth++;
    else if (kind === SyntaxKind.CloseBraceToken) depth--;
    if (kind === SyntaxKind.TemplateHead) templates.push(depth);
    tokens.push({ kind, text: scanner.getTokenText(), value: scanner.getTokenValue(), interpolated: templates.length > 0 });
  }
  return tokens;
}

const literalKinds = new Set([SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral, SyntaxKind.TemplateHead, SyntaxKind.TemplateMiddle, SyntaxKind.TemplateTail]);
function typedNumbers(text: string): string[] {
  return scan(text).filter((t) => (literalKinds.has(t.kind) && /\d/u.test(t.value)) || (t.interpolated && t.kind === SyntaxKind.NumericLiteral)).map((t) => t.text);
}

describe('guide copy: rendered examples (use --reporter=verbose to quote these)', () => {
  it.each(renderExamples())('$id: $text', ({ text }) => checkCopy(text));

  it('keeps all six veteran bullets, including their buttons, within the briefing word budget', () => {
    const briefing = Object.values(guideCopy.phaseE).map((render) => render());
    briefing.push(guideCopy.actions.GotIt(), guideCopy.actions.GuidedStart());
    expect(words(briefing.join(' '))).toBeLessThanOrEqual(90);
  });

  it('covers the shore reward, selected gas plant and scaled zoning variants', () => {
    [guideCopy.phaseC.G9Next(true), guideCopy.phaseB.B3FuelHint('util_gas_plant', start.residentsPerMW),
      guideCopy.phaseB.B2(target), guideCopy.phaseB.B2CountHint(target, 18)].forEach(checkCopy);
    expect(guideCopy.phaseC.G9Next(true)).toContain(catalog.getDef('lm_lighthouse')!.name);
    expect(guideCopy.phaseC.G9Next(false)).toContain(catalog.getDef('lm_clock_tower')!.name);
    expect(guideCopy.phaseC.G9Next(false)).not.toContain(catalog.getDef('lm_lighthouse')!.name);
  });
});

describe('guide copy: sources stay authoritative', () => {
  it('has no typed-in digits in string literals or template substitutions', () => {
    expect(typedNumbers(source)).toEqual([]);
  });

  it('checks template tails, escaped digits, nested templates and literal substitutions, without scanning comments as copy', () => {
    expect(typedNumbers("// §4.4 FH-01\nconst text = `Your ${count} turbines cost ${money(cost)} each.`;")).toEqual([]);
    for (const invalid of ["'Your 3 turbines'", "`Your ${count} turbines cost §800.`", "`Your ${800} cost`",
      "`Your ${money(800)} cost`", "'Your \\u0033 turbines'", '`Your ${flag ? `3 turbines` : "4 towers"}`']) {
      expect(typedNumbers(invalid), invalid).not.toEqual([]);
    }
    expect(sentences('Your response takes 3.9 min. Open Why? for details.')).toBe(2);
    expect(sentences('Your first sentence. Your next sentence! Your last sentence')).toBe(3);
  });

  it('documents the plan section and consuming item next to every text id', () => {
    for (const texts of Object.values(guideCopy)) for (const id of Object.keys(texts)) {
      expect(source, id).toMatch(new RegExp(`// §4\\.[3-7][^\\n]*(?:FH|FEEL|LG)-\\d+[^\\n]*\\n\\s+${id}:`));
    }
  });

  it('resolves every catalog id and every definition field actually read, including dynamic ids', () => {
    const realGetDef = catalog.getDef;
    const reads = new Set<string>();
    function checked<T extends object>(value: T, path: string): T {
      return new Proxy(value, {
        get(target, key, receiver) {
          const child = Reflect.get(target, key, receiver);
          expect(child, `${path}.${String(key)}`).not.toBeUndefined();
          return child && typeof child === 'object' ? checked(child, `${path}.${String(key)}`) : child;
        },
      });
    }
    const spy = vi.spyOn(catalog, 'getDef').mockImplementation((id) => {
      const def = realGetDef(id);
      expect(def, id).toBeDefined();
      reads.add(id);
      return checked(def!, id);
    });
    try {
      renderExamples();
      guideCopy.phaseC.G9Next(true);
      guideCopy.phaseB.B3FuelHint('util_gas_plant', start.residentsPerMW);
      for (const match of source.matchAll(/building\('([^']+)'\)/gu)) expect(reads.has(match[1]), match[1]).toBe(true);
      for (const id of ['civ_mayor_house', 'lm_lighthouse', 'lm_clock_tower']) {
        expect(REWARDS.find((r) => r.defIds.includes(id))?.conds.find((c) => c.label === 'Population')?.need, id).toBeTypeOf('number');
      }
      expect(ORDINANCES.find((o) => o.id === 'rubble_cleanup')?.name).toBeTypeOf('string');
    } finally {
      spy.mockRestore();
    }
  });

  it('resolves every tuning/params key and indexed zone cost named by the source', () => {
    const roots: Record<string, unknown> = { tuning, params, DIFFICULTY_FUNDS };
    const tokens = scan(source);
    const seen = new Set<string>();
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].kind !== SyntaxKind.Identifier || !Object.hasOwn(roots, tokens[i].text) || tokens[i + 1]?.text !== '.') continue;
      let value = roots[tokens[i].text];
      let path = tokens[i].text;
      let j = i + 1;
      while (tokens[j]?.text === '.') {
        const key = tokens[j + 1].text;
        value = (value as Record<string, unknown>)[key];
        path += `.${key}`;
        expect(value, path).not.toBeUndefined();
        seen.add(path);
        j += 2;
      }
      if (tokens[j]?.text === '[' && tokens[j + 1]?.text === 'Zone') {
        const key = tokens[j + 3].text as keyof typeof Zone;
        const index = Zone[key];
        expect(index, key).toBeTypeOf('number');
        expect((value as number[])[index], `${path}[Zone.${key}]`).toBeTypeOf('number');
      }
    }
    expect(seen.has('tuning.APPROVAL.taxPerPoint')).toBe(true);
    expect(seen.has('params.WIND_TURBINE_BASE')).toBe(true);
    expect([CONN_MIN_CELLS, CONN_MIN_DEPTH, WIND_SPACING, MONTHS_PER_YEAR].every(Number.isFinite)).toBe(true);
  });

  it('recomputes catalog names, prices and capacities at render time', () => {
    const realGetDef = catalog.getDef;
    const spy = vi.spyOn(catalog, 'getDef').mockImplementation((id) => {
      const def = realGetDef(id);
      return def && { ...def, name: `Updated ${def.name}`, cost: (def.cost ?? 0) + 137,
        powerOut: def.powerOut === undefined ? undefined : def.powerOut * 2,
        waterOut: def.waterOut === undefined ? undefined : def.waterOut * 2,
        coverage: def.coverage && { ...def.coverage, capacity: (def.coverage.capacity ?? 0) * 2 },
      };
    });
    try {
      const wind = realGetDef('util_wind_turbine')!;
      expect(guideCopy.phaseB.B3(start)).toContain(`updated ${wind.name.toLowerCase()}`);
      expect(guideCopy.phaseB.B3(start)).toContain(money(wind.cost! + 137));
      expect(guideCopy.phaseB.B3Output(start)).toContain(`${wind.powerOut! * 2 * params.WIND_TURBINE_BASE} MW`);
      expect(guideCopy.phaseB.B4()).toContain(num(realGetDef('util_water_tower')!.waterOut! * 2));
      expect(guideCopy.phaseC.G6(town.stats)).toContain(num(realGetDef('civ_elementary_school')!.coverage!.capacity! * 2));
    } finally {
      spy.mockRestore();
    }
  });

  it('uses catalog and params for both wind bounds, spacing, population estimates and zone costs', () => {
    const wind = catalog.getDef('util_wind_turbine')!;
    const flat = wind.powerOut! * params.WIND_TURBINE_BASE;
    const hill = wind.powerOut! * (params.WIND_TURBINE_BASE + params.WIND_TURBINE_GAIN);
    const residents = Math.floor(start.turbines * flat * start.residentsPerMW / start.residentRounding) * start.residentRounding;
    const output = guideCopy.phaseB.B3Output(start);
    expect(output).toContain(`${flat} MW`);
    expect(output).toContain(`up to ${hill}`);
    expect(output).toContain(num(residents));
    expect(guideCopy.phaseA.A2Wind(start)).toContain(num(residents));
    expect(guideCopy.phaseB.B3(start)).toContain(`${WIND_SPACING - 1} empty tiles`);
    expect(guideCopy.phaseB.B2Cost()).toContain(money(tuning.ZONE_COST[Zone.ResLow]));
    expect(guideCopy.phaseB.B2Cost()).toContain(money(tuning.ZONE_COST[Zone.IndMed]));
    expect(guideCopy.phaseC.G2(3, 3)).toContain(money(tuning.ZONE_COST[Zone.Landfill]));
    const changed = { turbines: 4, residentsPerMW: 280, residentRounding: 100 };
    expect(guideCopy.phaseB.B3(changed)).toContain(num(changed.turbines));
    expect(guideCopy.phaseB.B3Output(changed)).toContain(num(Math.floor(changed.turbines * flat * changed.residentsPerMW / changed.residentRounding) * changed.residentRounding));
  });

  it('uses real budget deltas and loan offers, with loan proceeds separate from recurring income', () => {
    expect(monthlyNet).toBeLessThan(0);
    expect(taxGain).toBeGreaterThan(0);
    expect(serviceSaving).toBeGreaterThan(0);
    expect(offer.ok).toBe(true);
    expect(recoveryOffer.ok).toBe(true);
    expect(recoveryOffer.monthlyPayment).toBeLessThanOrEqual(availableMonthly);
    expect(guideCopy.phaseD.E4(monthlyNet, taxPoints, taxGain)).toContain(money(-monthlyNet));
    expect(guideCopy.phaseC.G5(taxGain)).toContain(money(taxGain));
    expect(guideCopy.phaseD.E4Loan(loanAmount, offer)).toContain(money(offer.monthlyPayment));
    expect(guideCopy.phaseD.E4Loan(loanAmount, offer)).toContain(`${offer.termMonths / MONTHS_PER_YEAR} years`);
    const recovery = guideCopy.phaseD.E5Loan(recoveryAmount, recoveryOffer);
    expect(recovery).toContain(`receive ${money(recoveryAmount)} now`);
    expect(recovery).toContain(`pay ${money(recoveryOffer.monthlyPayment)} monthly`);
  });

  it('uses city and event values as they change, without changing the supplied state', () => {
    const before = structuredClone(town.stats);
    const stats = { ...town.stats, powerDemand: 17.5, powerSupply: 12.5 };
    for (const text of [guideCopy.phaseC.G10(stats), guideCopy.phaseD.E12(stats)]) {
      expect(text).toContain('17.5 MW');
      expect(text).toContain('12.5 MW');
      checkCopy(text);
    }
    expect(guideCopy.phaseD.E1a({ ...station, id: 23 }, 4.7)).toContain('#23 (4.7 min)');
    expect(guideCopy.phaseD.E3(6.2, 4.5)).toContain('6.2 min; this fire burned out in 4.5');
    expect(guideCopy.phaseB.B2CountHint(target, 27)).toContain('you have 27');
    expect(town.stats).toEqual(before);
    expect(guideCopy.phaseB.B3Roads()).toContain('roads carry power');
    expect(renderExamples().map((e) => e.text).join('\n')).not.toMatch(/connect[^.!?]*with power lines/iu);
  });
});
