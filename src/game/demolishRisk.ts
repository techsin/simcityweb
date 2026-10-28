/**
 * Consequences of a demolition that deserve a confirmation (QA #11): removing the LAST power plant / water source,
 * a landmark or reward building, or anything costing more than CONFIRM_COST — player-placed buildings worth more than
 * that (with the fresh-building refund shown) or a demolition fee above it. Pure state reads.
 * Final fixes N1: cutting OCCUPIED buildings off the grid or the pipes (the only road between a plant and the homes, a
 * pump that bridged the grid) — utilityCut replays utilities.ts's connectivity without what the demolition removes:
 * power runs through network cells, power lines and building cells (4-connected, labelPower's rule) from the live
 * plants; water runs through the pipes under the roads from the producers (each feeds the road it touches first; a
 * pump needs power) to the buildings beside them (a building takes its water from the first road beside it:
 * utilities.ts adjacentComp). Supply shortages (brownouts) are not a cut: the grid still has a plant.
 * Road / rail drags and rezoning demolish growables on the way (plopped buildings block them; the tip only warns):
 * sideDemolishRisks asks first when their fees pass CONFIRM_COST, the buildings hold DISPLACE_CONFIRM residents + jobs,
 * or the demolitions cut occupied buildings off.
 */
import type { CellRect } from '../core/events';
import { zoneDensity } from '../core/types';
import { BF, type Building, type CityState } from '../sim/CityState';
import { getDef } from '../sim/catalog';
import type { BuildingDef } from '../sim/catalogTypes';
import { infraFlags } from '../sim/economy/runtime';
import { WATER_REQUIRED_STAGE } from '../sim/economy/tuning';
import { money, num } from '../ui/format';

/** demolishing buildings worth more than this after refunds, or paying a fee above it, asks first */
export const CONFIRM_COST = 20_000;
/** a road / rail drag or a rezoning whose side demolitions hold at least this many residents + jobs asks first */
export const DISPLACE_CONFIRM = 1_000;

export interface DemolishRisk {
  title: string;
  /** consequence bullets for the dialog */
  items: string[];
}

/** Plain preview data supplied by the action caller; risk reads never recompute refund rules. */
export interface DemolishRefund {
  refund?: number;
  refundNote?: 'built today' | 'under 30 days old';
}

function refundText({ refund = 0, refundNote }: DemolishRefund): string {
  return `Refund ${money(refund)}${refundNote ? ` (${refundNote})` : ''}`;
}

function buildingsIn(st: CityState, r: CellRect): Building[] {
  const ids = new Set<number>();
  const x0 = Math.max(0, r.x0), z0 = Math.max(0, r.z0), x1 = Math.min(st.size, r.x1), z1 = Math.min(st.size, r.z1);
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const id = st.building[z * st.size + x];
    if (id >= 0) ids.add(id);
  }
  const out: Building[] = [];
  for (const id of ids) {
    const b = st.buildings.get(id);
    if (b) out.push(b);
  }
  return out;
}

/** residents / jobs currently served by a utility flag (they lose it when the last producer goes) */
function served(st: CityState, flag: number): { res: number; jobs: number } {
  let res = 0, jobs = 0;
  for (const b of st.buildings.values()) {
    if (!(b.flags & flag)) continue;
    res += b.pop || 0;
    jobs += b.jobs || 0;
  }
  return { res, jobs };
}

function lossLine(what: string, total: number, s: { res: number; jobs: number }, verb: string): string {
  const only = total === 1 ? `Your only ${what}` : `All ${total} of your ${what}s`;
  if (!s.res && !s.jobs) return `${only} — no building will have ${verb} until you build another`;
  const parts = [s.res ? `${num(s.res)} residents` : '', s.jobs ? `${num(s.jobs)} jobs` : ''].filter(Boolean).join(' and ');
  return `${only} — ${parts} will lose ${verb}`;
}

// ------------------------------------------------------------------------------------------------ utility cuts
/** what a demolition takes away (utilityCut) */
export interface Removal {
  /** buildings it removes (ids) */
  buildings: Iterable<number>;
  /** cells whose roads / rail / power lines it clears (a bulldozed rect) */
  clear?: CellRect | null;
  /** cells it turns into network (a road / rail drag; `pipes`: roads carry water pipes, rail does not) */
  add?: { cells: readonly { x: number; z: number }[]; pipes: boolean } | null;
}

/** occupied buildings a demolition cuts off the grid / the pipes (utilityCut) */
export interface UtilityCut {
  /** ids of the buildings that lose power / water */
  power: number[];
  water: number[];
  /** both lists together (distinct ids) and their residents / jobs */
  ids: number[];
  res: number;
  jobs: number;
  /** "Cuts power and water to 2 buildings (83 residents)" */
  text: string;
}

/** per-cell scratch (module-level: the UI and the sim share one thread) */
let cap = 0;
/** 1: the demolition removes this conductor (a cleared network / power-line cell, a removed building's cell) */
let dead = new Uint8Array(0);
/** a drag adds network here: 1 = conducts power, 3 = also a pipe */
let added = new Uint8Array(0);
/** the full flood fills' view of the city after the demolition: 1 = conducts power, 2 = a pipe (bits) */
let cond = new Uint8Array(0);
let pReach = new Uint8Array(0);
let wReach = new Uint8Array(0);
let queue = new Int32Array(0);
/** visit stamps of the local detour checks */
let seen = new Int32Array(0);
let stamp = 0;
function ensure(C: number): void {
  if (cap === C) return;
  cap = C;
  dead = new Uint8Array(C);
  added = new Uint8Array(C);
  cond = new Uint8Array(C);
  pReach = new Uint8Array(C);
  wReach = new Uint8Array(C);
  queue = new Int32Array(C);
  seen = new Int32Array(C);
  stamp = 0;
}
function nextStamp(): number {
  if (++stamp >= 0x7ffffff0) { seen.fill(0); stamp = 1; }
  return stamp;
}

/** power plants / water producers of a city (by def; flags are read at use), cached while its buildings don't change */
const prodCache = new WeakMap<CityState, { size: number; next: number; power: Building[]; water: Building[] }>();
function producers(st: CityState): { power: Building[]; water: Building[] } {
  const c = prodCache.get(st);
  if (c && c.size === st.buildings.size && c.next === st.nextBuildingId) return c;
  const power: Building[] = [], water: Building[] = [];
  for (const b of st.buildings.values()) {
    const d = getDef(b.def);
    if (!d) continue;
    if ((d.powerOut ?? 0) > 0) power.push(b);
    if ((d.waterOut ?? 0) > 0) water.push(b);
  }
  const e = { size: st.buildings.size, next: st.nextBuildingId, power, water };
  prodCache.set(st, e);
  return e;
}

/** a building needs piped water: utilities.ts needsWater (growables from WATER_REQUIRED_STAGE or on a medium / high
 *  density zone, plopped buildings whose def uses water) */
function needsWater(st: CityState, b: Building, def: BuildingDef): boolean {
  if (def.category !== 'growable') return (def.waterUse ?? 0) > 0;
  return (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(st.zone[b.z * st.size + b.x]) >= 2;
}

function who(n: number, res: number, jobs: number): string {
  const p = [res >= 0.5 ? `${num(res)} resident${Math.round(res) === 1 ? '' : 's'}` : '', jobs >= 0.5 ? `${num(jobs)} job${Math.round(jobs) === 1 ? '' : 's'}` : '']
    .filter(Boolean).join(', ');
  return `${num(n)} building${n === 1 ? '' : 's'}${p ? ` (${p})` : ''}`;
}

/** the line for a cut: "Cuts power and water to 2 buildings (83 residents)" ('' when both lists are empty) */
export function cutText(st: CityState, power: readonly number[], water: readonly number[]): string {
  const sum = (ids: readonly number[]) => {
    let res = 0, jobs = 0;
    for (const id of ids) {
      const b = st.buildings.get(id);
      if (b) { res += b.pop || 0; jobs += b.jobs || 0; }
    }
    return { res, jobs };
  };
  if (!power.length && !water.length) return '';
  const same = power.length === water.length && power.every((id, k) => water[k] === id);
  if (same) { const s = sum(power); return `Cuts power and water to ${who(power.length, s.res, s.jobs)}`; }
  const p = sum(power), w = sum(water);
  if (power.length && water.length) return `Cuts power to ${who(power.length, p.res, p.jobs)} and water to ${who(water.length, w.res, w.jobs)}`;
  return power.length ? `Cuts power to ${who(power.length, p.res, p.jobs)}` : `Cuts water to ${who(water.length, w.res, w.jobs)}`;
}

/** cells around the removal searched for a detour (a block or two; longer detours take the full flood fill) */
const DETOUR_MARGIN = 16;

/**
 * Every route through the removed cells `gone` has a detour: the cells next to them that still carry the utility
 * (`ok`) are all connected to each other within DETOUR_MARGIN cells of the removal's bounds (bx0..bz1) — then the
 * removal cuts nobody off. Returns the stamp of the detour search (> 0: the cells it reached have seen[j] === stamp),
 * a negative stamp when at most one such cell is left (no route ran through the removed cells: no search), 0 when
 * there may be no detour (the caller floods the whole map).
 */
function detoured(N: number, gone: readonly number[], ok: (j: number) => boolean, bx0: number, bz0: number, bx1: number, bz1: number): number {
  // the cells next to the removal that still carry the utility
  const sb = nextStamp();
  const bound: number[] = [];
  for (const i of gone) {
    const x = i % N;
    if (x > 0 && seen[i - 1] !== sb && ok(i - 1)) { seen[i - 1] = sb; bound.push(i - 1); }
    if (x < N - 1 && seen[i + 1] !== sb && ok(i + 1)) { seen[i + 1] = sb; bound.push(i + 1); }
    if (i >= N && seen[i - N] !== sb && ok(i - N)) { seen[i - N] = sb; bound.push(i - N); }
    if (i + N < N * N && seen[i + N] !== sb && ok(i + N)) { seen[i + N] = sb; bound.push(i + N); }
  }
  if (bound.length <= 1) return -sb; // nothing (or a single cell) hung on the removed cells: no route ran through them
  const x0 = Math.max(0, bx0 - DETOUR_MARGIN), x1 = Math.min(N - 1, bx1 + DETOUR_MARGIN);
  const z0 = Math.max(0, bz0 - DETOUR_MARGIN), z1 = Math.min(N - 1, bz1 + DETOUR_MARGIN);
  const sv = nextStamp();
  let qh = 0, qt = 0, found = 0;
  queue[qt++] = bound[0];
  seen[bound[0]] = sv;
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % N, z = (i - x) / N;
    if (x > x0) { const j = i - 1; if (seen[j] !== sv && ok(j)) { seen[j] = sv; queue[qt++] = j; } }
    if (x < x1) { const j = i + 1; if (seen[j] !== sv && ok(j)) { seen[j] = sv; queue[qt++] = j; } }
    if (z > z0) { const j = i - N; if (seen[j] !== sv && ok(j)) { seen[j] = sv; queue[qt++] = j; } }
    if (z < z1) { const j = i + N; if (seen[j] !== sv && ok(j)) { seen[j] = sv; queue[qt++] = j; } }
  }
  for (const j of bound) if (seen[j] === sv) found++;
  return found === bound.length ? sv : 0;
}

/**
 * Occupied buildings (residents or jobs, not abandoned / burnt) that have power / water now and would lose it because
 * the demolition `rm` cuts them off every live plant / producer; null when none would (or the city does not simulate
 * utilities). Usually a local detour check around the removal settles it (a few hundred cells); otherwise one flood
 * fill per utility over the map (about a millisecond on the 256² stress city, 1.5-37 ms for a rect that cuts occupied
 * buildings in a 1M city). `exhaustive` (tests): always flood.
 */
export function utilityCut(st: CityState, rm: Removal, exhaustive = false): UtilityCut | null {
  const r = cutOf(st, rm, exhaustive ? 2 : 0);
  return r === 'flood' ? null : r;
}

/**
 * The per-move check of a preview (final fixes UI-5): utilityCut's local detour checks only — null when they settle it
 * (nothing is cut off), 'flood' when only the map-wide fill can tell; the tool runs utilityCut once the rectangle rests,
 * and the confirm (demolishRisks / sideDemolishRisks) always runs it before a click acts.
 */
export function utilityCutQuick(st: CityState, rm: Removal): 'flood' | null {
  return cutOf(st, rm, 1) === 'flood' ? 'flood' : null;
}

/** map-wide flood fills run by utilityCut (tests and benches count them) */
export const cutStats = { fills: 0 };

/** utilityCut's body; mode 0 = local checks then the fill when needed, 1 = local checks only ('flood' = undecided),
 *  2 = always the fill */
function cutOf(st: CityState, rm: Removal, mode: 0 | 1 | 2): UtilityCut | null | 'flood' {
  if (!infraFlags(st).utilities) return null;
  const exhaustive = mode === 2, quick = mode === 1;
  const N = st.size, C = st.cells;
  const net = st.network, lines = st.powerLines, bld = st.building;
  ensure(C);
  dead.fill(0);
  let anyAdded = false;
  /** removed conductor cells and their bounds */
  const gone: number[] = [];
  let bx0 = N, bz0 = N, bx1 = -1, bz1 = -1;
  const mark = (i: number) => {
    if (dead[i]) return;
    dead[i] = 1;
    gone.push(i);
    const x = i % N, z = (i - x) / N;
    if (x < bx0) bx0 = x;
    if (x > bx1) bx1 = x;
    if (z < bz0) bz0 = z;
    if (z > bz1) bz1 = z;
  };
  const removed = new Set<number>();
  for (const id of rm.buildings) {
    const b = st.buildings.get(id);
    if (!b || removed.has(id)) continue;
    removed.add(id);
    for (let z = Math.max(0, b.z); z < Math.min(N, b.z + b.d); z++) for (let x = Math.max(0, b.x); x < Math.min(N, b.x + b.w); x++) {
      const i = z * N + x;
      if (bld[i] === id) mark(i);
    }
  }
  const r = rm.clear;
  if (r) {
    for (let z = Math.max(0, r.z0); z < Math.min(N, r.z1); z++) for (let x = Math.max(0, r.x0); x < Math.min(N, r.x1); x++) {
      const i = z * N + x;
      if (net[i] !== 0 || lines[i] !== 0) mark(i);
    }
  }
  if (!gone.length) return null;
  if (rm.add?.cells.length) {
    added.fill(0);
    anyAdded = true;
    const v = rm.add.pipes ? 3 : 1;
    for (const c of rm.add.cells) if (c.x >= 0 && c.z >= 0 && c.x < N && c.z < N) added[c.z * N + c.x] = v;
  }
  const conducts = (j: number) => (anyAdded && added[j] !== 0) || (dead[j] === 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0));
  const pipe = (j: number) => (anyAdded && added[j] === 3) || (dead[j] === 0 && net[j] >= 1 && net[j] <= 5);
  /** the road a building takes its water from / a producer feeds: the first pipe beside it (adjacentComp's order) */
  const firstPipe = (b: Building, isPipe: (j: number) => boolean): number => {
    for (let x = b.x; x < b.x + b.w; x++) {
      if (x < 0 || x >= N) continue;
      if (b.z > 0) { const j = (b.z - 1) * N + x; if (isPipe(j)) return j; }
      if (b.z + b.d < N) { const j = (b.z + b.d) * N + x; if (isPipe(j)) return j; }
    }
    for (let z = b.z; z < b.z + b.d; z++) {
      if (z < 0 || z >= N) continue;
      if (b.x > 0) { const j = z * N + b.x - 1; if (isPipe(j)) return j; }
      if (b.x + b.w < N) { const j = z * N + b.x + b.w; if (isPipe(j)) return j; }
    }
    return -1;
  };
  const live = (b: Building) => b.built >= 1 && (b.flags & (BF.Burnt | BF.Abandoned)) === 0;
  const prod = producers(st);

  // ---- power: unchanged when no live plant goes and the removed conductors have a local detour; else flood the
  // conductors from every live plant that feeds a grid now (a plant on a dead grid feeds nothing)
  let powerSame = !exhaustive && !prod.power.some((b) => removed.has(b.id) && live(b));
  if (powerSame) {
    const goneP = anyAdded ? gone.filter((i) => added[i] === 0) : gone;
    powerSame = goneP.length === 0 || detoured(N, goneP, conducts, bx0, bz0, bx1, bz1) !== 0;
  }
  if (quick && !powerSame) return 'flood';
  let condReady = false;
  /** the city after the demolition as bits per cell (the full flood fills read it: no per-cell closures) */
  const buildCond = () => {
    if (condReady) return;
    condReady = true;
    for (let i = 0; i < C; i++) {
      const n = net[i];
      cond[i] = (n !== 0 || lines[i] !== 0 || bld[i] >= 0 ? 1 : 0) | (n >= 1 && n <= 5 ? 2 : 0);
    }
    for (const i of gone) cond[i] = 0;
    if (anyAdded && rm.add) for (const c of rm.add.cells) if (c.x >= 0 && c.z >= 0 && c.x < N && c.z < N) cond[c.z * N + c.x] = added[c.z * N + c.x];
  };
  /** flood `bit` cells from the queued seeds into `reach` */
  const flood = (reach: Uint8Array, bit: number, qt: number) => {
    let qh = 0;
    while (qh < qt) {
      const i = queue[qh++];
      const x = i % N;
      let j = i - 1;
      if (x > 0 && reach[j] === 0 && (cond[j] & bit) !== 0) { reach[j] = 1; queue[qt++] = j; }
      j = i + 1;
      if (x < N - 1 && reach[j] === 0 && (cond[j] & bit) !== 0) { reach[j] = 1; queue[qt++] = j; }
      j = i - N;
      if (j >= 0 && reach[j] === 0 && (cond[j] & bit) !== 0) { reach[j] = 1; queue[qt++] = j; }
      j = i + N;
      if (j < C && reach[j] === 0 && (cond[j] & bit) !== 0) { reach[j] = 1; queue[qt++] = j; }
    }
  };
  if (!powerSame) {
    buildCond();
    pReach.fill(0);
    let qt = 0;
    for (const b of prod.power) {
      if (removed.has(b.id) || !(b.flags & BF.Powered) || !live(b)) continue;
      const i = b.z * N + b.x;
      if (i < 0 || i >= C || pReach[i] || !(cond[i] & 1)) continue;
      pReach[i] = 1;
      queue[qt++] = i;
    }
    flood(pReach, 1, qt);
  }
  /** a water producer delivers now and still would (a pump needs power) */
  const pumping = (b: Building, d: BuildingDef | undefined): boolean => {
    if (removed.has(b.id) || !live(b)) return false;
    if (!((d?.powerUse ?? 0) > 0)) return true;
    return (b.flags & BF.Powered) !== 0 && (powerSame || pReach[b.z * N + b.x] === 1);
  };

  // ---- water: unchanged when no producer stops and the removed pipes have a local detour that also keeps every
  // building beside them on its network; else flood the pipes from every producer. (A road drag's new pipes can
  // become a building's first pipe: always flooded — the preview runs once per path.)
  const deliversNow = (b: Building, d: BuildingDef | undefined) => live(b) && (!((d?.powerUse ?? 0) > 0) || (b.flags & BF.Powered) !== 0);
  let waterSame = !exhaustive && !(anyAdded && rm.add?.pipes) && prod.water.every((b) => { const d = getDef(b.def); return !deliversNow(b, d) || pumping(b, d); });
  const goneW = gone.filter((i) => net[i] >= 1 && net[i] <= 5 && !(anyAdded && added[i] === 3));
  if (waterSame && goneW.length) {
    const sv = detoured(N, goneW, pipe, bx0, bz0, bx1, bz1);
    waterSame = sv !== 0;
    if (waterSame) {
      // a building whose first pipe goes takes the next one beside it: still on the same network?
      const was = (j: number) => net[j] >= 1 && net[j] <= 5;
      const checked = new Set<number>();
      for (const i of goneW) {
        const x = i % N;
        for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, i - N, i + N]) {
          if (j < 0 || j >= C) continue;
          const id = bld[j];
          if (id < 0 || checked.has(id) || removed.has(id)) continue;
          checked.add(id);
          const b = st.buildings.get(id);
          if (!b || !dead[firstPipe(b, was)]) continue;
          // (its next pipe is on its old network when the detour search reached it; unsure otherwise: flood the map)
          const now = firstPipe(b, pipe);
          if (now < 0 || sv < 0 || seen[now] !== sv) { waterSame = false; break; }
        }
        if (!waterSame) break;
      }
    }
  }
  if (quick) return waterSame ? null : 'flood';
  if (powerSame && waterSame) return null;
  cutStats.fills++;
  const pipeBit = (j: number) => (cond[j] & 2) !== 0;
  if (!waterSame) {
    buildCond();
    wReach.fill(0);
    let qt = 0;
    for (const b of prod.water) {
      if (!pumping(b, getDef(b.def))) continue;
      const s = firstPipe(b, pipeBit);
      if (s < 0 || wReach[s]) continue;
      wReach[s] = 1;
      queue[qt++] = s;
    }
    flood(wReach, 2, qt);
  }

  // ---- the occupied buildings that have the utility now and would not
  const power: number[] = [], water: number[] = [], ids: number[] = [];
  let res = 0, jobs = 0;
  for (const b of st.buildings.values()) {
    const f = b.flags;
    if (!(f & (BF.Powered | BF.Watered)) || (f & (BF.Abandoned | BF.Burnt)) || !(b.pop > 0 || b.jobs > 0) || removed.has(b.id)) continue;
    const offP = !powerSame && (f & BF.Powered) !== 0 && !pReach[b.z * N + b.x];
    let offW = false;
    if (!waterSame && (f & BF.Watered) !== 0) { const s = firstPipe(b, pipeBit); offW = s < 0 || !wReach[s]; }
    if (!offP && !offW) continue;
    const d = getDef(b.def);
    if (!d) continue;
    const lostP = offP && !((d.powerOut ?? 0) > 0);
    const lostW = offW && !((d.waterOut ?? 0) > 0) && needsWater(st, b, d);
    if (lostP) power.push(b.id);
    if (lostW) water.push(b.id);
    if (lostP || lostW) { ids.push(b.id); res += b.pop || 0; jobs += b.jobs || 0; }
  }
  if (!ids.length) return null;
  return { power, water, ids, res, jobs, text: cutText(st, power, water) };
}

/** what bulldozing `rect` removes: its buildings, and its roads / rail / power lines */
export function bulldozeRemoval(st: CityState, rect: CellRect): Removal {
  return { buildings: buildingsIn(st, rect).map((b) => b.id), clear: rect };
}

/** the cut of bulldozing `rect` (its buildings go, its roads / rail / power lines are cleared) */
export function bulldozeCut(st: CityState, rect: CellRect): UtilityCut | null {
  return utilityCut(st, bulldozeRemoval(st, rect));
}

/** footprint cells of buildings (preview highlight of the buildings a demolition cuts off) */
export function buildingCells(st: CityState, ids: readonly number[], ok = false): { x: number; z: number; ok: boolean }[] {
  const out: { x: number; z: number; ok: boolean }[] = [];
  for (const id of ids) {
    const b = st.buildings.get(id);
    if (b) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) out.push({ x, z, ok });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ dialogs
/**
 * Risks of bulldozing `rect` (cost = the preview's cost, > 0 = the player pays). null when nothing needs confirming.
 */
export function demolishRisks(st: CityState, rect: CellRect, cost: number, opts: DemolishRefund & { sandbox?: boolean } = {}): DemolishRisk | null {
  const hit = buildingsIn(st, rect);
  const lead: string[] = [];
  const items: string[] = [];
  const names: string[] = [];
  let powerHit = 0, waterHit = 0;
  // build value at risk after the preview's refund
  let value = 0;
  const valued: string[] = [];
  for (const b of hit) {
    const d = getDef(b.def);
    if (!d) continue;
    // rubble (burnt out) has no utility or bonuses left to lose
    const live = !(b.flags & BF.Burnt);
    if (live && d.powerOut && d.powerOut > 0) powerHit++;
    if (live && d.waterOut && d.waterOut > 0) waterHit++;
    // (a ruined landmark / reward has no bonuses left to lose — clearing it is how it gets rebuilt: final fixes r4, a lone
    // ruin asked "its bonuses will be lost" before a §180 rubble fee)
    if (live && d.category === 'landmark') items.push(`${d.name} is a landmark — its tourism and land-value bonuses will be lost`);
    else if (live && d.category === 'reward') items.push(`${d.name} is a reward building — its bonuses will be lost`);
    if (d.category !== 'growable') {
      names.push(d.name);
      if (live && d.cost && d.cost > 0) {
        value += d.cost;
        valued.push(d.name);
      }
    }
  }
  let lastPower = false, lastWater = false;
  if (powerHit || waterHit) {
    let powerAll = 0, waterAll = 0;
    for (const b of st.buildings.values()) {
      const d = getDef(b.def);
      if (!d || b.flags & BF.Burnt) continue;
      if (d.powerOut && d.powerOut > 0) powerAll++;
      if (d.waterOut && d.waterOut > 0) waterAll++;
    }
    lastPower = powerHit > 0 && powerHit >= powerAll;
    lastWater = waterHit > 0 && waterHit >= waterAll;
    if (lastWater) lead.push(lossLine('water source', waterAll, served(st, BF.Watered), 'water'));
    if (lastPower) lead.push(lossLine('power plant', powerAll, served(st, BF.Powered), 'power'));
  }
  // final fixes N1: occupied buildings cut off the grid / the pipes (the last plant / water source lines above
  // already say that everything loses it)
  const cut = utilityCut(st, { buildings: hit.map((b) => b.id), clear: rect });
  if (cut) {
    const line = cutText(st, lastPower ? [] : cut.power, lastWater ? [] : cut.water);
    if (line) lead.push(line);
  }
  // "anything costing > §20k": unrecovered build value and what the demolition itself costs
  if (value - (opts.refund ?? 0) > CONFIRM_COST && !opts.sandbox) {
    items.push(valued.length === 1 ? `${valued[0]} cost ${money(value)} to build` : `${valued.length} buildings worth ${money(value)} (${valued.slice(0, 3).join(', ')}${valued.length > 3 ? '…' : ''})`);
  }
  if (cost > CONFIRM_COST && !opts.sandbox) items.push(`Demolition costs ${money(cost)}`);
  items.unshift(...lead);
  if (!items.length) return null;
  if (opts.refund && !opts.sandbox) items.push(refundText(opts));
  const title = names.length === 1 ? `Demolish ${names[0]}?` : names.length > 1 ? `Demolish ${names.length} buildings?` : 'Demolish this area?';
  return { title, items };
}

/**
 * Side demolitions of a road / rail drag or a rezoning (ActionResult.demolished / demolishFee of its preview): null
 * unless the fees pass CONFIRM_COST (not in sandbox), the buildings hold DISPLACE_CONFIRM residents + jobs, or they cut
 * occupied buildings off the grid / the pipes (final fixes N1; `add`: the cells a drag turns into road / rail, which
 * conduct — and, roads, carry pipes — in their place).
 */
export function sideDemolishRisks(
  st: CityState, ids: readonly number[] | undefined, fee: number, opts: DemolishRefund & { sandbox?: boolean; add?: Removal['add'] } = {},
): DemolishRisk | null {
  if (!ids?.length) return null;
  let n = 0, res = 0, jobs = 0;
  for (const id of ids) {
    const b = st.buildings.get(id);
    if (!b) continue;
    n++;
    res += b.pop || 0;
    jobs += b.jobs || 0;
  }
  if (!n) return null;
  const costly = fee > CONFIRM_COST && !opts.sandbox;
  const cut = utilityCut(st, { buildings: ids, add: opts.add });
  if (!costly && !cut && res + jobs < DISPLACE_CONFIRM) return null;
  const what = n === 1 ? '1 building' : `${num(n)} buildings`;
  const people = [res ? `${num(res)} residents` : '', jobs ? `${num(jobs)} jobs` : ''].filter(Boolean).join(' and ');
  const items = [`${what} will be demolished${people ? ` — ${people} will be lost` : ''}`];
  if (cut) items.push(cut.text);
  if (costly) items.push(`Demolition costs ${money(fee)}`);
  if (opts.refund && !opts.sandbox) items.push(refundText(opts));
  return { title: `Demolish ${what}?`, items };
}
