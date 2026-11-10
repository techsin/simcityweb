/**
 * Polish FH-16: one shared glossary of the city's codes — the twelve development types (R$ … I-HT) and the two
 * quotients (EQ, HQ). The tax tab and the ledger show a type's plain name under its code and its entry on hover; Stats,
 * Advisors, Demographics and Graphs show the EQ / HQ entries on hover. (The RCI popover is guide2b's file: t064-fh23 or a
 * follow-up hooks it up — POLISH_PLAN §7.3, docs/dev/queue/T064-guide-r2-cloud.md.)
 *  - codes: DEV_TYPE_LABELS (src/core/types.ts); plain names: the RCI segment's DEV_NAMES, by import, so the names keep
 *    one source;
 *  - what a type wants: the desirability terms it weighs most (DESIR_WEIGHTS, src/sim/economy/tuning.ts), named in the
 *    order of their weights (tests/game/glossary.test.ts checks every named term's sign against the weights), plus what
 *    the demand code ties to EQ (src/sim/economy/demand.ts: office demand and the CO$$$ share grow with EQ, high-tech
 *    demand starts above IHT_EQ_START, dirty industry's share falls above ID_EQ_START);
 *  - every number comes from tuning, never typed into a string: the EQ / HQ scales (their floor plus their span:
 *    demographics.ts clamps both to that), IHT_EQ_START, ID_EQ_START and the approval term's HQ reference.
 */
import { DEV_TYPE_COUNT, DEV_TYPE_LABELS, DevType } from '../core/types';
import {
  APPROVAL_TERMS, DESIR_WEIGHTS, EQ_FLOOR, EQ_SPAN_STOCK, HQ_FLOOR, HQ_SPAN_ACCESS, ID_EQ_START, IHT_EQ_START, type DesirWeights,
} from '../sim/economy/tuning';
import { DEV_NAMES } from './topbar/rciSegment';

export interface GlossaryEntry {
  /** the code the panels show: 'R$', 'I-D', 'EQ' */
  code: string;
  /** its plain name: 'Low-wealth residents', 'Education quotient' */
  name: string;
  /** what the type wants, or what the quotient measures ("wants low rent, short commutes …") */
  about: string;
  /** the hover text: "R$ · Low-wealth residents — wants low rent, …" */
  tip: string;
}

/** a desirability term a type can want, in the player's words; `less`: the type wants less of it (a negative weight:
 *  clean air is less air pollution) */
export const WANT_WORDS: Readonly<Partial<Record<keyof DesirWeights, { words: string; less?: true }>>> = {
  lv: { words: 'high land value' },
  air: { words: 'clean air', less: true },
  water: { words: 'clean water', less: true },
  crime: { words: 'low crime', less: true },
  commute: { words: 'short commutes' },
  transit: { words: 'transit' },
  shops: { words: 'shops nearby' },
  rent: { words: 'low rent', less: true },
  elem: { words: 'schools' },
  green: { words: 'parks' },
  popNear: { words: 'customers nearby' },
  traffic: { words: 'passing traffic' },
  visitors: { words: 'tourists' },
  skill: { words: 'skilled workers' },
  campus: { words: 'a college nearby' },
  freight: { words: 'freight access' },
  slope: { words: 'flat land', less: true },
  soil: { words: 'clean soil', less: true },
};

/** the terms each type's entry names (by DevType): picked from its strongest weights; wantTerms orders them by weight */
const WANTS: readonly (readonly (keyof DesirWeights)[])[] = [
  ['rent', 'commute', 'transit', 'shops'], // R$
  ['air', 'crime', 'green', 'elem'], // R$$
  ['lv', 'air', 'crime', 'green'], // R$$$
  ['popNear', 'traffic'], // CS$
  ['crime', 'popNear', 'traffic', 'visitors'], // CS$$
  ['lv', 'crime', 'popNear', 'visitors'], // CS$$$
  ['commute', 'crime', 'skill'], // CO$$
  ['lv', 'commute', 'crime', 'skill'], // CO$$$
  ['slope', 'air', 'water', 'soil'], // I-Ag
  ['freight', 'rent'], // I-D
  ['freight', 'commute'], // I-M
  ['air', 'lv', 'skill', 'campus'], // I-HT
];

/** the terms type `d`'s entry names, strongest weight first (ties keep the list's order) */
export function wantTerms(d: DevType): (keyof DesirWeights)[] {
  const w = DESIR_WEIGHTS[d];
  return [...WANTS[d]].sort((a, b) => Math.abs(w[b]) - Math.abs(w[a]));
}

/** "a, b and c" */
function list(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** what the demand code ties to EQ for type `d` (demand.ts targets; '' for the types EQ does not steer) */
function eqNote(d: DevType): string {
  if (d === DevType.CO2) return ' Office demand grows with EQ.';
  if (d === DevType.CO3) return ' Its share of office demand grows with EQ.';
  if (d === DevType.ID) return ` Its share of industry shrinks once EQ passes ${ID_EQ_START}.`;
  if (d === DevType.IHT) return ` Demand starts once EQ passes ${IHT_EQ_START}.`;
  return '';
}

function devEntry(d: DevType): GlossaryEntry {
  const code = DEV_TYPE_LABELS[d], name = DEV_NAMES[d];
  // (a type that weighs no air pollution at all says so: dirty industry)
  const tolerant = DESIR_WEIGHTS[d].air === 0 ? ', and pollution does not bother it' : '';
  const about = `wants ${list(wantTerms(d).map((t) => WANT_WORDS[t]!.words))}${tolerant}.${eqNote(d)}`;
  return { code, name, about, tip: `${code} · ${name} — ${about}` };
}

/** the top of the EQ scale: demographics.ts clamps EQ = EQ_FLOOR + EQ_SPAN_STOCK × education (0..1) to it */
export const EQ_SCALE_MAX = EQ_FLOOR + EQ_SPAN_STOCK;
/** the top of the HQ scale: HQ = (HQ_FLOOR + HQ_SPAN_ACCESS × health access) × environment × medicine, each factor ≤ 1 */
export const HQ_SCALE_MAX = HQ_FLOOR + HQ_SPAN_ACCESS;

function quotient(code: string, name: string, about: string): GlossaryEntry {
  return { code, name, about, tip: `${code} · ${name} — ${about}` };
}

/** one entry per development type, indexed by DevType */
export const DEV_GLOSSARY: readonly GlossaryEntry[] = Array.from({ length: DEV_TYPE_COUNT }, (_, d) => devEntry(d));

/** EQ: what the demand code does with it (high-tech above IHT_EQ_START, offices grow with it) and what raises it */
export const EQ_GLOSSARY: GlossaryEntry = quotient('EQ', 'Education quotient',
  `how educated your workers are (0–${EQ_SCALE_MAX}); high-tech industry wants ${IHT_EQ_START}+ and offices grow with it. Schools raise it.`);

/** HQ: the approval term around APPROVAL_TERMS.hqRef, and what HQ's target reads (health access, air, noise, tap water) */
export const HQ_GLOSSARY: GlossaryEntry = quotient('HQ', 'Health quotient',
  `how healthy your residents are (0–${HQ_SCALE_MAX}); above ${APPROVAL_TERMS.hqRef} it wins you approval, below it costs some. Clinics, hospitals, clean air and safe tap water raise it.`);

/** the entry of a code as the panels show it ('R$$', 'I-HT', 'EQ', 'HQ'); undefined for any other text */
export function glossaryOf(code: string): GlossaryEntry | undefined {
  if (code === EQ_GLOSSARY.code) return EQ_GLOSSARY;
  if (code === HQ_GLOSSARY.code) return HQ_GLOSSARY;
  const d = DEV_TYPE_LABELS.indexOf(code);
  return d >= 0 ? DEV_GLOSSARY[d] : undefined;
}
