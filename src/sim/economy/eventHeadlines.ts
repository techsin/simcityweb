/** Event news has its own hash picks and saved queue; it never consumes the simulation's random stream. */
import type { Building, CityState, NewsItem } from '../CityState';
import { BF } from '../CityState';
import type { Simulation } from '../Simulation';
import { getDef } from '../catalog';
import { DevType } from '../../core/types';

export const EVENT_HEADLINES = {
  landmark: '{name} opens: the city has a new postcard view.',
  park: '{name} opens; the first picnic blanket is already down.',
  power: '{name} opens, bringing new power to the city.',
  water: '{name} opens; residents raise a glass of tap water.',
  garbage: '{name} opens; collection crews welcome the extra capacity.',
  police: '{name} opens its doors to the neighbourhood.',
  fire: '{name} opens; the crew takes its first group photograph.',
  health: '{name} welcomes its first patients.',
  education: '{name} opens; the first bell draws a cheer.',
  civic: '{name} opens with a queue around the block.',
  reward: '{name} opens; residents turn out for the ceremony.',
  transit: '{name} opens; commuters try a new way to work.',
  airport: '{name} opens; plane spotters claim the best seats.',
  harbour: '{name} opens; the harbour answers with a chorus of horns.',
  firstHome: 'The first home is ready: a family puts down roots.',
  firstShop: 'The first shop opens; the neighbourhood has somewhere to meet.',
  firstFactory: 'The first factory opens; the city clocks in for work.',
  firstTower: 'The first tower joins the skyline; everyone looks up.',
  blackout: 'After the blackout, neighbours remember the evening they shared their candles.',
  strike: 'Budget-cut strike brings workers and residents to the council steps.',
  strikeOver: 'Workers return after the strike; familiar services resume.',
  bankruptcy: 'Bankruptcy averted: the council finally puts away its red pens.',
  park100: 'The 100th park opens; residents propose a picnic in every one.',
  rescue: 'Emergency crews resolve the incident; neighbours line up to say thanks.',
  geraldRepair: 'Gerald the celebrity pothole is repaired; admirers request a commemorative plaque.',
  geraldPlaque: 'Gerald gets a plaque: the former pothole is officially a local institution.',
} as const;
export type EventHeadlineType = keyof typeof EVENT_HEADLINES;
interface PendingHeadline { type: EventHeadlineType; due: number; text: string; x?: number; z?: number }
export interface EventHeadlineData {
  pending: PendingHeadline[];
  triggered: Partial<Record<EventHeadlineType, number>>;
  shown: Partial<Record<EventHeadlineType, number>>;
  firsts: string[];
  parks: number;
}
export interface EventHeadlineStore { events?: EventHeadlineData; shown: Record<string, number> }

export function headlineHash(day: number, event: string, seed = 0): number {
  let h = (day ^ seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < event.length; i++) h = Math.imul(h ^ event.charCodeAt(i), 0x01000193) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  return (h ^ (h >>> 15)) >>> 0;
}

export const SIGHTING_INTERVAL = 6000;
export const SIGHTING_HEADLINES = {
  balloons: 'A rare balloon flotilla drifts over the city; residents wave from their gardens.',
  whale: 'A whale surfaces off the coast; the waterfront falls quiet to watch.',
  blimp: 'A visiting blimp crosses the skyline on its grand tour of the region.',
  observatory: 'The observatory sends a welcoming light into the sky.',
  gerald: 'Gerald the former pothole gets a ribbon cutting; the scissors are nearly as famous.',
} as const;
export type SightingKind = keyof typeof SIGHTING_HEADLINES;
export interface Sighting { kind: SightingKind; day: number; x: number; z: number; text: string }

/** More than 15 years apart, including across cycle boundaries: at most two in any rolling 30 years. */
export function sightingDay(seed: number, kind: SightingKind, cycle: number): number {
  const slot = (Object.keys(SIGHTING_HEADLINES) as SightingKind[]).indexOf(kind);
  return cycle * SIGHTING_INTERVAL + slot * 1200 + headlineHash(0, kind, seed) % 1200;
}

/** The largest water body connected to a map edge; a whale needs open water and a visible shore, not an inland pond. */
function whalePlace(st: CityState, start: number): { x: number; z: number } | undefined {
  const N = st.size, labels = new Int32Array(st.cells), queue = new Int32Array(st.cells);
  let label = 0, coast = 0, largest = 0;
  for (let i = 0; i < st.cells; i++) {
    const x = i % N, z = Math.floor(i / N);
    if ((x !== 0 && z !== 0 && x !== N - 1 && z !== N - 1) || !st.water[i] || labels[i]) continue;
    let head = 0, tail = 1;
    queue[0] = i; labels[i] = ++label;
    while (head < tail) {
      const cell = queue[head++], cx = cell % N, cz = Math.floor(cell / N);
      for (let d = 0; d < 4; d++) {
        if ((d === 0 && cx === 0) || (d === 1 && cx === N - 1) || (d === 2 && cz === 0) || (d === 3 && cz === N - 1)) continue;
        const next = cell + (d === 0 ? -1 : d === 1 ? 1 : d === 2 ? -N : N);
        if (!st.water[next] || labels[next]) continue;
        labels[next] = label; queue[tail++] = next;
      }
    }
    if (tail > largest) { largest = tail; coast = label; }
  }
  if (largest < 64) return;
  for (let k = 0; k < st.cells; k++) {
    const i = (start + k) % st.cells, x = i % N, z = Math.floor(i / N);
    if (labels[i] !== coast || x < 2 || z < 2 || x >= N - 2 || z >= N - 2) continue;
    let room = true, shore = false;
    for (let dz = -2; dz <= 2 && room; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (labels[(z + dz) * N + x + dx] !== coast) { room = false; break; }
    }
    if (!room) continue;
    for (let d = 3; d <= 8 && !shore; d++) {
      shore = (x >= d && !st.water[i - d]) || (x + d < N && !st.water[i + d])
        || (z >= d && !st.water[i - d * N]) || (z + d < N && !st.water[i + d * N]);
    }
    if (shore) return { x, z };
  }
}

export function sightingsOnDay(st: CityState): Sighting[] {
  const out: Sighting[] = [];
  for (const kind of Object.keys(SIGHTING_HEADLINES) as SightingKind[]) {
    if (st.day !== sightingDay(st.config.seed, kind, Math.floor(st.day / SIGHTING_INTERVAL))) continue;
    let x = Math.floor(st.size / 2), z = x;
    if (kind === 'observatory') {
      const b = [...st.buildings.values()].find((b) => b.def === 'lm_observatory' && b.built >= 1 && !(b.flags & BF.Burnt));
      if (!b) continue;
      x = b.x + (b.w >> 1); z = b.z + (b.d >> 1);
    } else if (kind === 'whale') {
      const place = whalePlace(st, headlineHash(st.day, kind, st.config.seed) % st.cells);
      if (!place) continue;
      x = place.x; z = place.z;
    } else if (kind === 'gerald') {
      let found = false;
      const start = headlineHash(st.day, kind, st.config.seed) % st.cells;
      for (let k = 0; k < st.cells; k++) {
        const i = (start + k) % st.cells, cx = i % st.size, cz = Math.floor(i / st.size);
        if (st.network[i] < 1 || st.network[i] > 5 || st.water[i]) continue;
        x = cx; z = cz; found = true; break;
      }
      if (!found) continue;
    }
    out.push({ kind, day: st.day, x, z, text: SIGHTING_HEADLINES[kind] });
  }
  return out;
}

export function postSightingHeadlines(sim: Simulation, store: EventHeadlineStore): void {
  for (const s of sightingsOnDay(sim.state)) {
    const id = `sighting:${s.kind}`;
    if (store.shown[id] !== undefined && s.day - store.shown[id] < SIGHTING_INTERVAL) continue;
    store.shown[id] = s.day;
    sim.notify(s.text, 'info', s.x, s.z, 'news');
  }
}

export function queueEventHeadline(data: EventHeadlineData, day: number, seed: number, type: EventHeadlineType,
  name = '', x?: number, z?: number): void {
  const last = data.triggered[type];
  if (last !== undefined && day - last < 360) return;
  if (data.pending.some((p) => p.type === type)) return;
  data.triggered[type] = day;
  data.pending.push({ type, due: day + 1 + headlineHash(day, type, seed) % 10,
    text: EVENT_HEADLINES[type].replace('{name}', name), x, z });
}

const openingType = (b: Building): EventHeadlineType | undefined => {
  const def = getDef(b.def);
  if (!def || def.category === 'growable') return undefined;
  if (/airport/.test(def.id)) return 'airport';
  if (/seaport|ferry|harbour/.test(def.id)) return 'harbour';
  return def.category === 'transport' ? 'transit' : def.category;
};
const firstTypes = (b: Building): EventHeadlineType[] => {
  const def = getDef(b.def);
  if (def?.category !== 'growable') return [];
  const first = b.def.startsWith('res_') || def.model.startsWith('res_') ? 'firstHome'
    : def.model.startsWith('com_') ? 'firstShop' : def.model.startsWith('ind_') ? 'firstFactory' : undefined;
  if (!first) return [];
  if (first === 'firstFactory' && def.devType === DevType.IA) return [];
  return first !== 'firstFactory' && /tower|highrise|skyscraper|supertall/.test(def.model) ? [first, 'firstTower'] : [first];
};

/** Building events make openings cheap; init takes a silent baseline so loading never reopens an old landmark. */
export class EventHeadlineFeed {
  private complete = new Set<number>();
  private fresh: EventHeadlineData = { pending: [], triggered: {}, shown: {}, firsts: [], parks: 0 };
  private unsub: (() => void)[] = [];

  init(sim: Simulation): void {
    for (const off of this.unsub) off();
    this.complete.clear();
    const st = sim.state;
    const saved = (st.systemData.advisors as Partial<EventHeadlineStore> | undefined)?.events;
    this.fresh = saved ?? { pending: [], triggered: {}, shown: {}, firsts: [], parks: 0 };
    for (const b of st.buildings.values()) if (b.built >= 1) {
      this.complete.add(b.id);
      if (!saved && getDef(b.def)?.category === 'park') this.fresh.parks++;
      if (!saved) for (const first of firstTypes(b)) if (!this.fresh.firsts.includes(first)) this.fresh.firsts.push(first);
    }
    const data = () => {
      // Before the first daily pass there is no headline schedule yet. Keep only this optional envelope: advisors
      // creates its normal schedule on that pass, while init can restore these events from an earlier paused save.
      const store = (sim.state.systemData.advisors ??= {}) as Partial<EventHeadlineStore>;
      return store.events ??= this.fresh;
    };
    const queue = (type: EventHeadlineType, name = '', x?: number, z?: number) =>
      queueEventHeadline(data(), sim.state.day, sim.state.config.seed, type, name, x, z);
    const opened = (b: Building) => {
      if (b.built < 1 || b.flags & BF.Burnt || this.complete.has(b.id)) return;
      this.complete.add(b.id);
      const def = getDef(b.def), type = openingType(b);
      const x = b.x + (b.w >> 1), z = b.z + (b.d >> 1);
      if (type) queue(type, def!.name, x, z);
      for (const first of firstTypes(b)) if (!data().firsts.includes(first)) { data().firsts.push(first); queue(first, '', x, z); }
      if (def?.category === 'park' && ++data().parks === 100) queue('park100', '', x, z);
    };
    const news = (n: NewsItem) => {
      if (n.advisor === 'news') return;
      if (/^Blackout:/.test(n.text)) queue('blackout', '', n.x, n.z);
      else if (/workers are on strike/.test(n.text)) queue('strike');
      else if (/strike is over/.test(n.text)) queue('strikeOver');
      else if (/Bankruptcy averted!/.test(n.text)) queue('bankruptcy');
    };
    this.unsub = [
      sim.events.on('buildingAdded', opened), sim.events.on('buildingChanged', opened),
      sim.events.on('news', news),
      sim.events.on('emergency', (e) => { if (e.type === 'resolved') queue('rescue', '', e.x, e.z); }),
      sim.events.on('networkChanged', () => {
        const a = sim.state.systemData.advisors as Partial<EventHeadlineStore> | undefined;
        if (a?.shown?.gerald !== undefined && data().triggered.geraldRepair === undefined) queue('geraldRepair');
      }),
    ];
  }

  daily(sim: Simulation, store: EventHeadlineStore): void {
    const data = store.events ??= this.fresh;
    const day = sim.state.day;
    for (let i = 0; i < data.pending.length;) {
      const p = data.pending[i];
      if (p.due > day) { i++; continue; }
      data.pending.splice(i, 1);
      const last = data.shown[p.type];
      if (last !== undefined && day - last < 360) continue;
      data.shown[p.type] = day;
      sim.notify(p.text, 'info', p.x, p.z, 'news');
      if (p.type === 'geraldRepair') queueEventHeadline(data, day, sim.state.config.seed, 'geraldPlaque');
    }
  }
}
