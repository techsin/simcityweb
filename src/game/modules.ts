/**
 * Optional-module loader. Several modules (renderers, rewards, ordinances, disasters, audio) are built concurrently
 * by other agents; they may be missing or broken at any time. We discover them with import.meta.glob (which yields an
 * empty map for files that don't exist) and import them lazily inside try/catch so the UI keeps working.
 */
import type { CityObjectsViewApi, WorldViewApi, QualityLevel } from '../render/contracts';
import type { CityState } from '../sim/CityState';
import type { Simulation, CityEvents } from '../sim/Simulation';
import type { Emitter } from '../core/events';
import type { Overlay } from '../core/types';
import type * as THREE from 'three';

const LAZY = import.meta.glob([
  '../render/world/WorldView.ts',
  '../render/world/overlays.ts',
  '../render/city/CityObjectsView.ts',
  '../sim/economy/rewards.ts',
  '../sim/economy/ordinances.ts',
  '../sim/infra/disasters.ts',
  '../audio/*.ts',
]);

export type WorldViewCtor = new (canvas: HTMLCanvasElement, state: CityState, events: Emitter<CityEvents>, opts: { quality: QualityLevel }) => WorldViewApi;
export type CityObjectsViewCtor = new (
  state: CityState,
  events: Emitter<CityEvents>,
  opts: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; canvas: HTMLCanvasElement; getTrafficRoutes?: (max: number) => unknown },
) => CityObjectsViewApi;

/** Shapes we accept from sim-core's reward / ordinance listings (normalized below). */
export interface RewardInfo {
  id: string;
  name: string;
  description: string;
  unlocked: boolean;
  /** 0..1 */
  progress: number;
  requirement: string;
  /** building def unlocked by this reward (for "place" button) */
  defId?: string;
  category?: string;
}

export interface OrdinanceInfo {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  available: boolean;
  /** monthly cost (positive) or income (negative) */
  monthlyCost: number;
  effects: string[];
  requirement?: string;
  category?: string;
}

export interface AudioLike {
  play(name: string, opts?: unknown): void;
  setVolume?(channel: string, v: number): void;
  [k: string]: unknown;
}

export interface GameModules {
  WorldView?: WorldViewCtor;
  overlayLegend?: (o: Overlay) => unknown;
  CityObjectsView?: CityObjectsViewCtor;
  listRewards?: (state: CityState) => RewardInfo[];
  listOrdinances?: (state: CityState) => OrdinanceInfo[];
  triggerDisaster?: (sim: Simulation, kind: string, x: number, z: number) => unknown;
  disasterKinds?: { id: string; name: string }[];
  audio?: AudioLike;
  /** module-load problems, for the dev console / error overlay */
  errors: string[];
}

async function load(path: string, errors: string[]): Promise<Record<string, unknown> | null> {
  const f = LAZY[path];
  if (!f) return null;
  try {
    return (await f()) as Record<string, unknown>;
  } catch (e) {
    errors.push(`${path}: ${(e as Error)?.message ?? e}`);
    console.warn('[game] failed to load', path, e);
    return null;
  }
}

function str(v: unknown, fb = ''): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fb;
}
function numOr(v: unknown, fb = 0): number {
  return typeof v === 'number' && isFinite(v) ? v : fb;
}

export function normalizeReward(r: any): RewardInfo {
  const progress = numOr(r?.progress, r?.unlocked ? 1 : 0);
  return {
    id: str(r?.id, '?'),
    name: str(r?.name ?? r?.title ?? r?.label, str(r?.id, 'Reward')),
    description: str(r?.description ?? r?.desc ?? r?.effect),
    unlocked: !!(r?.unlocked ?? r?.available ?? r?.done ?? progress >= 1),
    progress: Math.max(0, Math.min(1, progress > 1 ? progress / 100 : progress)),
    requirement: str(r?.requirement ?? r?.condition ?? r?.requirementText ?? r?.hint ?? r?.unlockText),
    defId: str(r?.defId ?? r?.def ?? r?.building ?? r?.unlocks) || undefined,
    category: str(r?.category ?? r?.kind) || undefined,
  };
}

function effectList(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${typeof x === 'number' ? (x > 0 ? '+' : '') + x : String(x)}`);
  return [];
}

export function normalizeOrdinance(o: any): OrdinanceInfo {
  const income = numOr(o?.income ?? o?.monthlyIncome, 0);
  const cost = numOr(o?.monthlyCost ?? o?.monthly ?? o?.cost ?? o?.costPerMonth ?? o?.upkeep, 0);
  return {
    id: str(o?.id, '?'),
    name: str(o?.name ?? o?.title, str(o?.id, 'Ordinance')),
    description: str(o?.description ?? o?.desc),
    enabled: !!(o?.enabled ?? o?.active ?? o?.on),
    available: o?.available ?? o?.unlocked ?? true,
    monthlyCost: cost - income,
    effects: effectList(o?.effects ?? o?.effect ?? o?.effectText),
    requirement: str(o?.requirement ?? o?.requires ?? o?.unlockText) || undefined,
    category: str(o?.category) || undefined,
  };
}

function findAudio(mods: Record<string, unknown>[]): AudioLike | undefined {
  for (const m of mods) {
    const cands: unknown[] = [m.default, m.audio, m.sound, m.sfx, m.Audio, m.audioManager, m.AudioManager];
    for (const k of Object.keys(m)) cands.push(m[k]);
    for (const c of cands) {
      if (c && typeof c === 'object' && typeof (c as AudioLike).play === 'function') return c as AudioLike;
    }
    for (const k of ['getAudio', 'audio', 'getSound']) {
      const f = m[k];
      if (typeof f === 'function' && f.length === 0 && !/^[A-Z]/.test(k)) {
        try {
          const inst = (f as () => unknown)();
          if (inst && typeof (inst as AudioLike).play === 'function') return inst as AudioLike;
        } catch {
          /* ignore */
        }
      }
    }
    if (typeof m.play === 'function') {
      const fns = m as Record<string, unknown>;
      return {
        play: (n: string, o?: unknown) => (fns.play as (n: string, o?: unknown) => void)(n, o),
        setVolume: typeof fns.setVolume === 'function' ? (fns.setVolume as (c: string, v: number) => void) : undefined,
      };
    }
  }
  return undefined;
}

const DEFAULT_DISASTERS = [
  { id: 'fire', name: 'Fire' },
  { id: 'tornado', name: 'Tornado' },
  { id: 'earthquake', name: 'Earthquake' },
  { id: 'meteor', name: 'Meteor strike' },
];

export async function loadGameModules(): Promise<GameModules> {
  const errors: string[] = [];
  const out: GameModules = { errors };
  const [wv, ov, rw, od, ds] = await Promise.all([
    load('../render/world/WorldView.ts', errors),
    load('../render/city/CityObjectsView.ts', errors),
    load('../sim/economy/rewards.ts', errors),
    load('../sim/economy/ordinances.ts', errors),
    load('../sim/infra/disasters.ts', errors),
  ]);
  if (wv) {
    if (typeof wv.WorldView === 'function') out.WorldView = wv.WorldView as WorldViewCtor;
    else if (typeof wv.default === 'function') out.WorldView = wv.default as WorldViewCtor;
    if (typeof wv.overlayLegend === 'function') out.overlayLegend = wv.overlayLegend as (o: Overlay) => unknown;
  }
  if (!out.overlayLegend) {
    const ol = await load('../render/world/overlays.ts', errors);
    if (ol && typeof ol.overlayLegend === 'function') out.overlayLegend = ol.overlayLegend as (o: Overlay) => unknown;
  }
  if (ov) {
    if (typeof ov.CityObjectsView === 'function') out.CityObjectsView = ov.CityObjectsView as CityObjectsViewCtor;
    else if (typeof ov.default === 'function') out.CityObjectsView = ov.default as CityObjectsViewCtor;
  }
  if (rw && typeof rw.listRewards === 'function') {
    const f = rw.listRewards as (s: CityState) => unknown[];
    out.listRewards = (s) => {
      const r = f(s);
      return Array.isArray(r) ? r.map(normalizeReward) : [];
    };
  }
  if (od && typeof od.listOrdinances === 'function') {
    const f = od.listOrdinances as (s: CityState) => unknown[];
    out.listOrdinances = (s) => {
      const r = f(s);
      return Array.isArray(r) ? r.map(normalizeOrdinance) : [];
    };
  }
  if (ds && typeof ds.triggerDisaster === 'function') {
    out.triggerDisaster = ds.triggerDisaster as GameModules['triggerDisaster'];
    const kinds = (ds.DISASTER_KINDS ?? ds.disasterKinds ?? ds.DISASTERS ?? ds.KINDS) as unknown;
    if (Array.isArray(kinds) && kinds.length) {
      out.disasterKinds = kinds.map((k: any) => (typeof k === 'string' ? { id: k, name: k.replace(/^\w/, (c) => c.toUpperCase()) } : { id: str(k?.id ?? k?.kind), name: str(k?.name ?? k?.label ?? k?.id) }));
    } else if (kinds && typeof kinds === 'object') {
      out.disasterKinds = Object.entries(kinds as Record<string, any>).map(([id, v]) => ({ id, name: str(v?.name ?? v?.label, id.replace(/^\w/, (c) => c.toUpperCase())) }));
    } else out.disasterKinds = DEFAULT_DISASTERS;
  }
  // audio: prefer index.ts
  const audioPaths = Object.keys(LAZY).filter((p) => p.startsWith('../audio/')).sort((a, b) => (a.endsWith('/index.ts') ? -1 : b.endsWith('/index.ts') ? 1 : a.localeCompare(b)));
  const audioMods: Record<string, unknown>[] = [];
  for (const p of audioPaths) {
    const m = await load(p, errors);
    if (m) audioMods.push(m);
  }
  out.audio = findAudio(audioMods);
  return out;
}
