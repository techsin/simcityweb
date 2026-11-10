/**
 * The city's firsts (POLISH_PLAN FEEL-07's producer, T096): what a city does for the first time is recorded with it
 * and announced once, for the spotlight camera (src/game/ShowCamera.ts) and anything else that marks the moment.
 *
 *  kinds    'stage:6' | 'stage:7' | 'stage:8'  the first completed growable of that stage or higher (the towers,
 *                                               skyscrapers and supertalls of tuning.ts STAGE_POP)
 *           'unique:<defId>'                    the first opening of a unique building (CityActions.plop)
 *           'neighbor'                          the first neighbour connection (CityActions.afterNetworkChange)
 *  record   state.systemData.firsts (FirstsData): kind -> { day, x, z, id? }, written when the first happens. Plain
 *           data: saved with the city and mirrored to the replica (SYSTEM_KEYS of src/worker/protocol.ts). It is
 *           ordinary systemData, not one of T057's continuity records (src/sim/persist.ts): no save hook writes it, a
 *           load cannot rebuild it, and a lean recovery snapshot keeps it.
 *  news     one news item announces a first and carries NewsItem.ref.first = its kind, at the first's place: the
 *           opening and the connection news CityActions already posts, and a new item for a stage first. A building
 *           that is the first of several stages at once (a stage 7 tower in a city without a stage 6 one) records
 *           them all and announces the highest.
 *  once     a kind in the record is never announced again: the record travels with the city through a save and load,
 *           a resync and a recovery. A city without the record (a new city; a save from before T096) gets it at init,
 *           with every first its map already shows marked as had before the record (day FIRST_BEFORE, no place),
 *           silently: a grown city does not replay its history. What such a save had and lost again (a demolished
 *           landmark) cannot be told from its map, and is announced if it comes back.
 *
 * Nothing in the simulation reads the record, and no random number is drawn: the game runs as it did. A simulation
 * without firstsSystem (bare tests and tools) keeps no record, and claimFirst then gives no ref. Headless.
 */
import { BF, type Building, type CityState, type NewsItem } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { getDef } from '../catalog';

/** the stages whose first building is a first, lowest first */
export const FIRST_STAGES: readonly number[] = [6, 7, 8];
const STAGE_KINDS: readonly string[] = FIRST_STAGES.map((s) => `stage:${s}`);
/** FirstRecord.day of a first the city had before it kept the record */
export const FIRST_BEFORE = -1;

export interface FirstRecord {
  /** the day it happened (CityState.day), or FIRST_BEFORE */
  day: number;
  /** its place: the building's centre cell, or the connection's cell at the map edge (none with FIRST_BEFORE) */
  x?: number;
  z?: number;
  /** the building (none for the neighbour connection, nor with FIRST_BEFORE) */
  id?: number;
}
/** state.systemData.firsts: first kind -> its record */
export type FirstsData = Record<string, FirstRecord>;

function data(st: CityState): FirstsData | undefined {
  const f = st.systemData.firsts;
  return f !== null && typeof f === 'object' && !Array.isArray(f) ? (f as FirstsData) : undefined;
}

/** the city's firsts so far, or undefined in a city that keeps no record. Read-only; a replica's state has it too */
export function firstsOf(st: CityState): Readonly<FirstsData> | undefined {
  return data(st);
}

/**
 * `kind` happens now at cell (x, z), at building `id` if it is one: the ref of the news item that announces it,
 * { first: kind }, the first time, with the record written before the item is posted. undefined once the city had the
 * kind, and in a city that keeps no record: the item then posts as it always did.
 */
export function claimFirst(st: CityState, kind: string, x?: number, z?: number, id?: number): NewsItem['ref'] {
  const f = data(st);
  if (!f || Object.hasOwn(f, kind)) return undefined;
  const r: FirstRecord = { day: st.day };
  if (x !== undefined && z !== undefined) { r.x = x; r.z = z; }
  if (id !== undefined) r.id = id;
  f[kind] = r;
  return { first: kind };
}

/** the record of a city that had none: every first its map shows today, as had before the record */
function seed(st: CityState): FirstsData {
  const f: FirstsData = {};
  let top = 0;
  for (const b of st.buildings.values()) {
    const def = getDef(b.def);
    if (!def) continue;
    if (b.flags & BF.Plopped) {
      if (def.unique) f[`unique:${def.id}`] = { day: FIRST_BEFORE };
    } else if (b.built >= 1 && (def.stage ?? 0) > top) top = def.stage ?? 0;
  }
  for (let k = 0; k < FIRST_STAGES.length; k++) if (FIRST_STAGES[k] <= top) f[STAGE_KINDS[k]] = { day: FIRST_BEFORE };
  if (st.neighborConnections.length > 0) f.neighbor = { day: FIRST_BEFORE };
  return f;
}

export function firstsSystem(): SimSystem {
  let sub: Simulation | null = null;
  let unsub: (() => void)[] = [];
  /** a building was added or changed: a completed growable of a stage in FIRST_STAGES may be a first */
  const onBuilding = (sim: Simulation, b: Building): void => {
    // (every building event of the game passes here; almost all of them end at one of these two tests)
    if (b.built < 1 || b.flags & (BF.Plopped | BF.Burnt)) return;
    const st = sim.state, f = data(st);
    if (!f || Object.hasOwn(f, STAGE_KINDS[STAGE_KINDS.length - 1])) return;
    const def = getDef(b.def);
    const stage = def?.stage ?? 0;
    if (!def || stage < FIRST_STAGES[0]) return;
    const x = b.x + (b.w >> 1), z = b.z + (b.d >> 1);
    let top = -1;
    for (let k = 0; k < FIRST_STAGES.length && FIRST_STAGES[k] <= stage; k++) if (claimFirst(st, STAGE_KINDS[k], x, z, b.id)) top = k;
    if (top < 0) return;
    sim.notify(`${st.config.name}'s first stage ${FIRST_STAGES[top]} building is complete: ${def.name}.`, 'good', x, z, 'news', { first: STAGE_KINDS[top] });
  };
  return {
    name: 'economy.firsts',
    init(sim) {
      if (sub !== sim) {
        for (const off of unsub) off();
        unsub = [
          sim.events.on('buildingChanged', (b) => onBuilding(sim, b)),
          sim.events.on('buildingAdded', (b) => onBuilding(sim, b)),
        ];
        sub = sim;
      }
      // a loaded record is kept as it is (the loaded game continues like the uninterrupted one, T057)
      const st = sim.state;
      if (!data(st)) st.systemData.firsts = seed(st);
    },
  };
}
