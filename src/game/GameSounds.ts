/**
 * GameSounds — event-driven sounds for the city simulation (sim.events), rate-limited so a busy city never nags:
 *
 *   news        good 'good' (population milestones 1k/10k/50k/100k/250k/500k/1M -> 'milestone'), warning 'warning',
 *               bad 'bad', advisor 'advisor' (≥ 8 s apart), info headlines 'news' (≥ 20 s apart, quiet),
 *               disaster news -> 'bankrupt' for bankruptcy, else 'alarm' unless a disaster alarm just played
 *   disaster    active=true: 'fire' (≥ 25 s apart), 'tornado' (≥ 40 s; the sim re-emits per cell), 'quake', 'meteor',
 *               anything else 'alarm'; panned toward the event on screen
 *   unlocked    'reward' fanfare (once per 2.5 s even when several rewards unlock together)
 *   month       budget tick: 'coin' when last month's net was positive, 'cashLow' when negative (≥ 25 s apart, quiet,
 *               skipped in sandbox and when another event sound just played)
 *   building    construction finished -> 'built' (very quiet, on-screen only, spatial, ≥ 1.4 s apart)
 *
 * The sound calls go through CityScene.sound (the optional audio module), so a missing audio engine is harmless.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../core/constants';
import type { NewsItem } from '../sim/CityState';
import type { Simulation } from '../sim/Simulation';
import type { WorldViewApi } from '../render/contracts';
import type { SoundOpts } from './context';

export interface GameSoundsDeps {
  sim: Simulation;
  sound: (name: string, opts?: SoundOpts) => void;
  world: () => WorldViewApi;
  /** sandbox / unlimited money: no budget ticks */
  sandbox: () => boolean;
}

/** population milestones that get the celebratory sound */
export const POP_MILESTONES = [1000, 10000, 50000, 100000, 250000, 500000, 1000000];

export class GameSounds {
  private offs: (() => void)[] = [];
  private last = new Map<string, number>();
  private lastEvent = -1e9;
  private constructing = new Set<number>();
  private v = new THREE.Vector3();

  constructor(private d: GameSoundsDeps) {
    const ev = d.sim.events;
    this.offs.push(
      ev.on('news', (n) => this.onNews(n)),
      ev.on('disaster', (x) => this.onDisaster(x)),
      ev.on('unlocked', () => this.reward()),
      ev.on('month', () => this.onMonth()),
      ev.on('buildingAdded', (b) => {
        if (b.built < 1) this.constructing.add(b.id);
      }),
      ev.on('buildingChanged', (b) => {
        if (b.built < 1) this.constructing.add(b.id);
        else if (this.constructing.delete(b.id)) this.onBuilt(b.x + b.w / 2, b.z + b.d / 2);
      }),
      ev.on('buildingRemoved', (b) => void this.constructing.delete(b.id)),
      ev.on('reset', () => this.constructing.clear()),
    );
  }

  dispose(): void {
    for (const f of this.offs) f();
    this.offs = [];
  }

  /** true (and marks it) when `key` has not fired within `ms` */
  private ready(key: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.last.get(key) ?? -1e9) < ms) return false;
    this.last.set(key, now);
    return true;
  }

  private play(name: string, opts?: SoundOpts): void {
    this.lastEvent = performance.now();
    this.d.sound(name, opts);
  }

  /** screen-space stereo position of a cell (null when off-screen / behind the camera) */
  private screenOf(x: number, z: number): { pan: number; onScreen: boolean } | null {
    try {
      const cam = this.d.world().camera;
      if (!cam) return null;
      this.v.set(x * CELL_SIZE, 0, z * CELL_SIZE).project(cam);
      if (!Number.isFinite(this.v.x) || this.v.z > 1) return { pan: 0, onScreen: false };
      const onScreen = Math.abs(this.v.x) <= 1.05 && Math.abs(this.v.y) <= 1.05;
      return { pan: Math.max(-1, Math.min(1, this.v.x)) * 0.6, onScreen };
    } catch {
      return null;
    }
  }

  private onNews(n: NewsItem): void {
    switch (n.kind) {
      case 'good': {
        const m = /reaches ([\d,.]+) residents/i.exec(n.text);
        const pop = m ? Number(m[1].replace(/[,.]/g, '')) : 0;
        if (pop && POP_MILESTONES.includes(pop)) {
          // bigger milestones sound a little brighter (up to +4 semitones at 1M)
          const tier = POP_MILESTONES.indexOf(pop);
          if (this.ready('milestone', 1500)) this.play('milestone', { pitch: Math.pow(2, Math.min(4, Math.floor(tier / 2) * 2) / 12) });
        } else if (this.ready('good', 3000)) this.play('good');
        return;
      }
      case 'warning':
        // money trouble ("in the red", months of debt) gets the bankruptcy warning tone, softer
        if (/in the red|debt|bankrupt/i.test(n.text)) {
          if (this.ready('bankrupt', 10000)) this.play('bankrupt', { volume: 0.75 });
        } else if (this.ready('warning', 3500)) this.play('warning');
        return;
      case 'bad':
        if (this.ready('bad', 3500)) this.play('bad');
        return;
      case 'advisor':
        if (this.ready('advisor', 8000)) this.play('advisor', { volume: 0.85 });
        return;
      case 'info':
        if (this.ready('news', 20000)) this.play('news', { volume: 0.7 });
        return;
      case 'reward':
        this.reward();
        return;
      case 'disaster': {
        if (/bankrupt/i.test(n.text)) {
          if (this.ready('bankrupt', 10000)) this.play('bankrupt');
          return;
        }
        // the sim emits the 'disaster' event right before or after its news: give it a moment to play the specific alarm
        setTimeout(() => {
          if (performance.now() - (this.last.get('disasterAny') ?? -1e9) < 1500) return;
          if (this.ready('alarm', 20000)) this.play('alarm');
        }, 60);
        return;
      }
    }
  }

  private onDisaster(x: { kind: string; x: number; z: number; active: boolean }): void {
    if (!x.active) return;
    const kinds: Record<string, [string, number]> = { fire: ['fire', 25000], tornado: ['tornado', 40000], earthquake: ['quake', 8000], meteor: ['meteor', 2500] };
    const [name, gap] = kinds[x.kind] ?? ['alarm', 20000];
    // a tornado re-emits every cell it moves: only its first sighting counts (the gap covers the rest)
    if (!this.ready('d:' + x.kind, gap)) {
      this.last.set('disasterAny', performance.now());
      return;
    }
    this.last.set('disasterAny', performance.now());
    const s = this.screenOf(x.x, x.z);
    this.play(name, { pan: s?.pan ?? 0 });
  }

  private reward(): void {
    if (this.ready('reward', 2500)) this.play('reward');
  }

  private onMonth(): void {
    if (this.d.sandbox()) return;
    const b = this.d.sim.state.budget;
    let net = 0;
    for (const k in b.lastIncome) net += b.lastIncome[k] || 0;
    for (const k in b.lastExpense) net -= b.lastExpense[k] || 0;
    if (!net) return;
    // let the month's news (bankruptcy warnings...) speak first; never stack on top of another event sound
    setTimeout(() => {
      if (performance.now() - this.lastEvent < 600) return;
      if (!this.ready('month', 25000)) return;
      this.play(net > 0 ? 'coin' : 'cashLow', { volume: 0.8 });
    }, 250);
  }

  private onBuilt(x: number, z: number): void {
    const s = this.screenOf(x, z);
    if (!s?.onScreen) return;
    let dist = 800;
    try {
      dist = this.d.world().controls.distance || 800;
    } catch {
      /* ignore */
    }
    // close-up: audible; zoomed far out: barely (many buildings finish at once)
    const vol = Math.max(0.35, Math.min(1, 520 / Math.max(260, dist)));
    if (this.ready('built', 1400)) this.play('built', { pan: s.pan, volume: vol });
  }
}
