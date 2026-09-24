/**
 * GameSounds — event-driven sounds for the city simulation (sim.events), budgeted so a busy city never nags
 * (checked with a SimBot replay at 1x / 2x / 3x: shots/audio/lt/eventrate.mjs):
 *
 *   news        a burst of news in one sim tick plays only its most important item (bad > warning > good > advisor >
 *               info), at most one news sound every NEWS_GAP ms plus a per-kind gap (NEWS); the same message (numbers
 *               ignored) sounds at most every REPEAT_MS; ticker-only items (headlines, routine advisor tips) get a rare,
 *               very soft bell. Population milestones
 *               1k/10k/50k/100k/250k/500k/1M -> 'milestone' (brighter for bigger ones); money trouble ("in the red",
 *               debt) -> soft 'bankrupt'; BANKRUPT -> 'bankrupt'; other disaster news -> 'alarm' unless a specific
 *               alarm just played
 *   disaster    active=true: 'tornado' (≥ 40 s; the sim re-emits per cell), 'quake', 'meteor', anything else 'alarm';
 *               panned toward the event on screen. Building fires: see emergency
 *   emergency   (WP8 dispatch) a major incident nobody can answer: fire -> 'fire' station bell (≥ 25 s), other
 *               kinds -> 'warning' (≥ 12 s). A routine fire the fire service already answers -> short soft 'fireBell'
 *               (≥ 60 s; the truck siren is the rest of the cue). Without the dispatch system every fire rings 'fire'.
 *   unlocked    'reward' fanfare (at most every 6 s: several rewards unlocking together celebrate once)
 *   month       budget tick: 'coin' when last month's net was positive, 'cashLow' when negative (≥ 90 s apart, ≥ 20 s
 *               when the sign flips; quiet, skipped in sandbox and when another event sound just played)
 *   building    construction finished -> 'built' (very quiet, on-screen only, spatial, ≥ 3 s apart, not when the
 *               camera is zoomed far out)
 *
 * The sound calls go through CityScene.sound (the optional audio module), so a missing audio engine is harmless.
 */
import * as THREE from 'three';
import { CELL_SIZE } from '../core/constants';
import type { NewsItem } from '../sim/CityState';
import type { EmergencyEvent, Simulation } from '../sim/Simulation';
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

/** news kind -> sound, priority within a burst, per-kind minimum gap (ms), volume */
const NEWS: Record<string, { name: string; prio: number; gap: number; vol?: number }> = {
  bad: { name: 'bad', prio: 4, gap: 10000 },
  warning: { name: 'warning', prio: 3, gap: 15000 },
  good: { name: 'good', prio: 2, gap: 12000 },
  advisor: { name: 'advisor', prio: 1, gap: 30000, vol: 0.85 },
  // headlines and routine advisor tips have no toast (ticker only): a rare, very soft bell
  info: { name: 'news', prio: 0, gap: 180000, vol: 0.55 },
};
/** minimum ms between any two news sounds */
const NEWS_GAP = 6000;
/** news that arrive within this window (one sim tick / month boundary) compete; the most important one sounds */
const BURST_MS = 120;
/** the same message (numbers ignored) sounds again only after this long: persistent conditions don't nag */
const REPEAT_MS = 180000;
/** advisor messages the toasts show (src/ui/Notifications.ts); the rest are ticker-only tips */
const URGENT = /!|urgent|critical|warning/i;

interface FireProbe {
  x: number;
  z: number;
  /** emergency event types seen for this fire right after it ignited */
  types: Set<string>;
}

export class GameSounds {
  private offs: (() => void)[] = [];
  /** last play time per key (per-sound gaps, 'anyNews' / 'anyEvent' budgets); tests clear it */
  private last = new Map<string, number>();
  private constructing = new Set<number>();
  private pending: { name: string; prio: number; gap: number; vol?: number; sig: string } | null = null;
  /** sign of the last month's net (a flip is news: the budget tick may play sooner) */
  private lastSign = 0;
  private flushT: ReturnType<typeof setTimeout> | null = null;
  private fire: FireProbe | null = null;
  private v = new THREE.Vector3();

  constructor(private d: GameSoundsDeps) {
    const ev = d.sim.events;
    this.offs.push(
      ev.on('news', (n) => this.onNews(n)),
      ev.on('disaster', (x) => this.onDisaster(x)),
      // registered before the emergency banner (CityScene order): an unanswered fire's bell wins its alert slot
      ev.on('emergency', (e) => this.onEmergency(e)),
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
    if (this.flushT) clearTimeout(this.flushT);
    this.flushT = null;
  }

  private since(key: string): number {
    return performance.now() - (this.last.get(key) ?? -1e9);
  }

  /** true (and marks it) when `key` has not fired within `ms` */
  private ready(key: string, ms: number): boolean {
    if (this.since(key) < ms) return false;
    this.last.set(key, performance.now());
    return true;
  }

  /** play an event sound; `news` = also counts against the news budget (nothing else chimes right after it) */
  private play(name: string, opts?: SoundOpts, news = true): void {
    const now = performance.now();
    this.last.set('anyEvent', now);
    if (news) this.last.set('anyNews', now);
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

  // ------------------------------------------------------------------ news
  private onNews(n: NewsItem): void {
    switch (n.kind) {
      case 'good': {
        const m = /reaches ([\d,.]+) residents/i.exec(n.text);
        const pop = m ? Number(m[1].replace(/[,.]/g, '')) : 0;
        if (pop && POP_MILESTONES.includes(pop)) {
          // bigger milestones sound a little brighter (up to +4 semitones at 250k+)
          const tier = POP_MILESTONES.indexOf(pop);
          if (this.ready('milestone', 1500)) this.play('milestone', { pitch: Math.pow(2, Math.min(4, Math.floor(tier / 2) * 2) / 12) });
        } else this.queueNews('good', n.text);
        return;
      }
      case 'warning':
        // money trouble ("in the red", months of debt) gets the bankruptcy warning tone, softer
        if (/in the red|debt|bankrupt/i.test(n.text)) {
          if (this.ready('bankrupt', 10000)) this.play('bankrupt', { volume: 0.75 });
        } else this.queueNews('warning', n.text);
        return;
      case 'bad':
      case 'info':
        this.queueNews(n.kind, n.text);
        return;
      case 'advisor':
        this.queueNews(URGENT.test(n.text) ? 'advisor' : 'info', n.text);
        return;
      case 'reward':
        this.reward();
        return;
      case 'disaster': {
        if (/bankrupt/i.test(n.text)) {
          if (this.ready('bankrupt', 10000)) this.play('bankrupt');
          return;
        }
        // an unanswered emergency (WP8) posts its news right after the 'uncovered' event, which already sounded
        if (this.since('uncovered') < 100) return;
        // the sim emits the 'disaster' event right before or after its news: give it a moment to play the specific alarm
        setTimeout(() => {
          if (this.since('disasterAny') < 1500) return;
          if (this.ready('alarm', 20000)) this.play('alarm');
        }, 60);
        return;
      }
    }
  }

  /** news sounds compete within a burst and share one budget (NEWS_GAP); repeated messages stay quiet (REPEAT_MS) */
  private queueNews(kind: string, text: string): void {
    const c = NEWS[kind];
    if (!c) return;
    const sig = 'sig:' + kind + ':' + text.replace(/[\d.,]+/g, '#').slice(0, 90);
    if (this.since(sig) < REPEAT_MS) return;
    if (!this.pending || c.prio > this.pending.prio) this.pending = { ...c, sig };
    if (!this.flushT) this.flushT = setTimeout(() => this.flushNews(), BURST_MS);
  }

  private flushNews(): void {
    this.flushT = null;
    const c = this.pending;
    this.pending = null;
    if (!c) return;
    if (this.since('anyNews') < NEWS_GAP || this.since('anyEvent') < 800) return;
    if (!this.ready('news:' + c.name, c.gap)) return;
    const now = performance.now();
    this.last.set(c.sig, now);
    // forget old message signatures (bounded memory in long sessions)
    if (this.last.size > 400) for (const [k, t] of this.last) if (k.startsWith('sig:') && now - t > REPEAT_MS) this.last.delete(k);
    this.play(c.name, c.vol ? { volume: c.vol } : undefined);
  }

  // ------------------------------------------------------------------ disasters + emergencies
  private onDisaster(x: { kind: string; x: number; z: number; active: boolean }): void {
    if (!x.active) return;
    this.last.set('disasterAny', performance.now());
    if (x.kind === 'fire') {
      // decide once the emergency system has reacted to this fire (it emits synchronously right after)
      const probe: FireProbe = { x: x.x, z: x.z, types: new Set() };
      this.fire = probe;
      setTimeout(() => this.decideFire(probe), 50);
      return;
    }
    const kinds: Record<string, [string, number]> = { tornado: ['tornado', 40000], earthquake: ['quake', 8000], meteor: ['meteor', 2500] };
    const [name, gap] = kinds[x.kind] ?? ['alarm', 20000];
    // a tornado re-emits every cell it moves: only its first sighting counts (the gap covers the rest)
    if (!this.ready('d:' + x.kind, gap)) return;
    const s = this.screenOf(x.x, x.z);
    this.play(name, { pan: s?.pan ?? 0 });
  }

  private decideFire(p: FireProbe): void {
    if (this.fire === p) this.fire = null;
    // unanswered: onEmergency rang the full bell
    if (p.types.has('uncovered')) return;
    const s = this.screenOf(p.x, p.z);
    if (!p.types.size) {
      // no dispatch system: every fire is the player's business
      if (this.ready('fire', 25000)) this.play('fire', { pan: s?.pan ?? 0 });
      this.last.set('disasterAny', performance.now());
      return;
    }
    // a new fire the fire service answers on its own (spreading within a known incident stays quiet)
    if (p.types.has('new') && this.ready('fireBell', 60000)) this.play('fireBell', { pan: s?.pan ?? 0, volume: s?.onScreen ? 1 : 0.7 }, false);
  }

  private onEmergency(e: EmergencyEvent): void {
    if (e.kind === 'fire' && this.fire) this.fire.types.add(e.type);
    if (e.type !== 'uncovered') return;
    this.last.set('uncovered', performance.now());
    if (!e.major) return;
    const s = this.screenOf(e.x, e.z);
    if (e.kind === 'fire') {
      if (this.ready('fire', 25000)) this.play('fire', { pan: s?.pan ?? 0 });
    } else if (this.ready('incident', 12000)) this.play('warning', { pan: (s?.pan ?? 0) * 0.5 });
  }

  private reward(): void {
    if (this.ready('reward', 6000)) this.play('reward');
  }

  // ------------------------------------------------------------------ budget + construction
  private onMonth(): void {
    if (this.d.sandbox()) return;
    const b = this.d.sim.state.budget;
    let net = 0;
    // recurring net only (loan proceeds, construction and other 'oneoff:*' entries are not the month's result)
    for (const k in b.lastIncome) if (!k.startsWith('oneoff:')) net += b.lastIncome[k] || 0;
    for (const k in b.lastExpense) if (!k.startsWith('oneoff:')) net -= b.lastExpense[k] || 0;
    if (!net) return;
    const sign = net > 0 ? 1 : -1;
    const flip = this.lastSign !== 0 && sign !== this.lastSign;
    this.lastSign = sign;
    // let the month's news (bankruptcy warnings...) speak first; never stack on top of another event sound. At most
    // every 90 s (1x: every ~6th month), sooner when the budget just went from black to red or back
    setTimeout(() => {
      if (this.since('anyEvent') < 1500) return;
      if (!this.ready('month', flip ? 20000 : 90000)) return;
      this.play(sign > 0 ? 'coin' : 'cashLow', { volume: 0.8 }, false);
    }, 250);
  }

  private onBuilt(x: number, z: number): void {
    if (this.since('built') < 3000) return;
    const s = this.screenOf(x, z);
    if (!s?.onScreen) return;
    let dist = 800;
    try {
      dist = this.d.world().controls.distance || 800;
    } catch {
      /* ignore */
    }
    // zoomed far out (whole districts finish at once): the ambience's construction layer is enough
    if (dist > 2200) return;
    // close-up: audible; zoomed out: barely
    const vol = Math.max(0.35, Math.min(1, 520 / Math.max(260, dist)));
    this.last.set('built', performance.now());
    this.d.sound('built', { pan: s.pan, volume: vol });
  }
}
