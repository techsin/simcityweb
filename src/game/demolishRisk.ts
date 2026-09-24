/**
 * Consequences of a demolition that deserve a confirmation (QA #11): removing the LAST power plant / water source,
 * a landmark or reward building, or anything costing more than CONFIRM_COST — player-placed buildings worth more than
 * that (they are removed for free but nothing is refunded) or a demolition fee above it. Pure state reads.
 */
import type { CellRect } from '../core/events';
import { BF, type Building, type CityState } from '../sim/CityState';
import { getDef } from '../sim/catalog';
import { money, num } from '../ui/format';

/** demolishing buildings worth more than this (build cost), or paying a fee above it, asks first */
export const CONFIRM_COST = 20_000;

export interface DemolishRisk {
  title: string;
  /** consequence bullets for the dialog */
  items: string[];
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

/**
 * Risks of bulldozing `rect` (cost = the preview's cost, > 0 = the player pays). null when nothing needs confirming.
 */
export function demolishRisks(st: CityState, rect: CellRect, cost: number, opts: { sandbox?: boolean } = {}): DemolishRisk | null {
  const hit = buildingsIn(st, rect);
  const items: string[] = [];
  const names: string[] = [];
  let powerHit = 0, waterHit = 0;
  // build value of the player-placed buildings in the area (demolishing them is free but refunds nothing)
  let value = 0;
  const valued: string[] = [];
  for (const b of hit) {
    const d = getDef(b.def);
    if (!d) continue;
    // rubble (burnt out) produces nothing and is worth nothing
    const live = !(b.flags & BF.Burnt);
    if (live && d.powerOut && d.powerOut > 0) powerHit++;
    if (live && d.waterOut && d.waterOut > 0) waterHit++;
    if (d.category === 'landmark') items.push(`${d.name} is a landmark — its tourism and land-value bonuses will be lost`);
    else if (d.category === 'reward') items.push(`${d.name} is a reward building — its bonuses will be lost`);
    if (d.category !== 'growable') {
      names.push(d.name);
      if (live && d.cost && d.cost > 0) {
        value += d.cost;
        valued.push(d.name);
      }
    }
  }
  if (powerHit || waterHit) {
    let powerAll = 0, waterAll = 0;
    for (const b of st.buildings.values()) {
      const d = getDef(b.def);
      if (!d || b.flags & BF.Burnt) continue;
      if (d.powerOut && d.powerOut > 0) powerAll++;
      if (d.waterOut && d.waterOut > 0) waterAll++;
    }
    if (powerHit && powerHit >= powerAll) items.unshift(lossLine('power plant', powerAll, served(st, BF.Powered), 'power'));
    if (waterHit && waterHit >= waterAll) items.unshift(lossLine('water source', waterAll, served(st, BF.Watered), 'water'));
  }
  // "anything costing > §20k": what is being destroyed (build cost) and what the demolition itself costs
  if (value > CONFIRM_COST && !opts.sandbox) {
    items.push(valued.length === 1 ? `${valued[0]} cost ${money(value)} to build` : `${valued.length} buildings worth ${money(value)} (${valued.slice(0, 3).join(', ')}${valued.length > 3 ? '…' : ''})`);
  }
  if (cost > CONFIRM_COST && !opts.sandbox) items.push(`Demolition costs ${money(cost)}`);
  if (!items.length) return null;
  const title = names.length === 1 ? `Demolish ${names[0]}?` : names.length > 1 ? `Demolish ${names.length} buildings?` : 'Demolish this area?';
  return { title, items };
}
