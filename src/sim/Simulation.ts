/**
 * Simulation — owns CityState, runs systems on a calendar, emits events for renderers/UI.
 * Headless-safe (no DOM / three.js).
 */
import { Emitter, type CellRect } from '../core/events';
import { RNG } from '../core/rng';
import { SECONDS_PER_DAY, DAYS_PER_MONTH, MONTHS_PER_YEAR } from '../core/constants';
import type { Building, CityState, NewsItem } from './CityState';

export interface CityEvents extends Record<string, unknown> {
  buildingAdded: Building;
  buildingRemoved: Building;
  /** flags / pop / construction progress / abandonment changed (renderer may update tint, fire fx...) */
  buildingChanged: Building;
  networkChanged: CellRect;
  zoneChanged: CellRect;
  terrainChanged: CellRect;
  powerLinesChanged: CellRect;
  subwayChanged: CellRect;
  treesChanged: CellRect;
  day: number;
  month: number;
  year: number;
  news: NewsItem;
  /** a derived layer was recomputed: 'traffic' | 'pollution' | 'services' | 'landValue' | 'utilities' | 'desirability' | 'crime' */
  layerUpdated: string;
  disaster: { kind: string; x: number; z: number; active: boolean };
  unlocked: string;
  speedChanged: number;
  /** full reset (after load) — renderers should rebuild everything */
  reset: void;
}

export interface SimSystem {
  name: string;
  /** once after construction / load */
  init?(sim: Simulation): void;
  /** every simulated day */
  daily?(sim: Simulation): void;
  /** first day of each month (after all daily) */
  monthly?(sim: Simulation): void;
  /** first day of each year (after monthly) */
  yearly?(sim: Simulation): void;
  /** every rendered frame (real dt seconds), e.g. for time-sliced work */
  frame?(sim: Simulation, dt: number): void;
}

export class Simulation {
  state: CityState;
  readonly events = new Emitter<CityEvents>();
  readonly systems: SimSystem[] = [];
  rng: RNG;
  /** 0 paused, 1 normal, 2 fast, 3 ultra */
  private _speed = 1;
  private acc = 0;
  /** safety cap to avoid spiral of death */
  maxDaysPerFrame = 4;

  constructor(state: CityState, systems: SimSystem[] = []) {
    this.state = state;
    this.rng = new RNG((state.config.seed ^ 0x9e3779b9) >>> 0);
    for (const s of systems) this.systems.push(s);
    for (const s of this.systems) s.init?.(this);
  }

  get speed(): number {
    return this._speed;
  }
  set speed(v: number) {
    this._speed = Math.max(0, Math.min(3, v | 0));
    this.events.emit('speedChanged', this._speed);
  }

  /** call every frame with real elapsed seconds */
  update(dt: number): void {
    for (const s of this.systems) s.frame?.(this, dt);
    if (this._speed === 0) return;
    const spd = SECONDS_PER_DAY[this._speed];
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= spd && n < this.maxDaysPerFrame) {
      this.acc -= spd;
      this.advanceDay();
      n++;
    }
    if (n >= this.maxDaysPerFrame) this.acc = Math.min(this.acc, spd);
  }

  /** advance exactly one day (also used by headless tests) */
  advanceDay(): void {
    const st = this.state;
    st.day++;
    for (const s of this.systems) s.daily?.(this);
    if (st.day % DAYS_PER_MONTH === 0) {
      for (const s of this.systems) s.monthly?.(this);
      this.events.emit('month', st.monthIndex);
      if (st.day % (DAYS_PER_MONTH * MONTHS_PER_YEAR) === 0) {
        for (const s of this.systems) s.yearly?.(this);
        this.events.emit('year', st.year);
      }
    }
    this.events.emit('day', st.day);
  }

  /** run N days synchronously (headless) */
  runDays(n: number): void {
    for (let i = 0; i < n; i++) this.advanceDay();
  }

  notify(text: string, kind: NewsItem['kind'] = 'info', x?: number, z?: number, advisor?: string): void {
    const item = this.state.notify(text, kind, x, z, advisor);
    this.events.emit('news', item);
  }

  getSystem<T extends SimSystem>(name: string): T | undefined {
    return this.systems.find((s) => s.name === name) as T | undefined;
  }

  /** replace state (after load) and re-init systems */
  replaceState(state: CityState): void {
    this.state = state;
    this.acc = 0;
    for (const s of this.systems) s.init?.(this);
    this.events.emit('reset', undefined);
  }
}
