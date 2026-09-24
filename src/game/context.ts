/**
 * GameContext — everything tools and UI components need, provided by CityScene.
 * `world` / `objects` are swapped from null placeholders to the real views once they have loaded.
 */
import type { Emitter } from '../core/events';
import type { Overlay } from '../core/types';
import type { CityObjectsViewApi, WorldViewApi } from '../render/contracts';
import type { CityActionsApi } from '../sim/actions';
import type { CityState } from '../sim/CityState';
import type { Simulation } from '../sim/Simulation';
import type { GameModules } from './modules';
import type { GameSettings } from './settings';
import type { ToolController } from './tools/ToolController';

export interface QueryTarget {
  buildingId?: number | null;
  x: number;
  z: number;
}

export interface UIEvents extends Record<string, unknown> {
  tool: string | null;
  overlay: Overlay;
  settings: GameSettings;
  panel: { id: string; open: boolean };
  query: QueryTarget | null;
  /** views finished loading */
  viewsReady: void;
  /** the main loop ticks the UI (≈5 Hz) */
  uiTick: void;
}

/** options for GameContext.sound */
export interface SoundOpts {
  /** 0..2 gain multiplier */
  volume?: number;
  /** pitch multiplier */
  pitch?: number;
  /** -1..1 stereo position (default: game-action sounds follow the cursor's screen x) */
  pan?: number;
  /** 0..1 how big the action was (drag length, amount demolished) */
  intensity?: number;
}

export interface CursorTipApi {
  show(html: string, kind?: 'ok' | 'bad' | 'info'): void;
  hide(): void;
  move(clientX: number, clientY: number): void;
}

export interface PanelsApi {
  /** opts.silent: no panel sound (the action that opened / closed it already made one) */
  open(id: string, opts?: { silent?: boolean }): void;
  close(id: string, opts?: { silent?: boolean }): void;
  toggle(id: string): void;
  isOpen(id: string): boolean;
}

export interface GameContext {
  readonly state: CityState;
  readonly sim: Simulation;
  readonly actions: CityActionsApi;
  world: WorldViewApi;
  objects: CityObjectsViewApi;
  readonly canvas: HTMLCanvasElement;
  readonly root: HTMLElement;
  settings: GameSettings;
  mods: GameModules;
  readonly ui: Emitter<UIEvents>;
  /** aborted when the scene is disposed (use for window/document listeners) */
  readonly signal: AbortSignal;
  tools: ToolController;
  panels: PanelsApi;
  tip: CursorTipApi;
  overlay: Overlay;
  /** true when using stand-in views / actions (dev) */
  degraded: { world: boolean; objects: boolean; actions: boolean };
  setOverlay(o: Overlay): void;
  /** play a UI / game sound (src/audio/sfx.ts names; a few aliases in CityScene's SOUND_MAP). Build sounds pan from the cursor. */
  sound(name: string, opts?: SoundOpts): void;
  focusCell(x: number, z: number, distance?: number): void;
  /** open the inspector on a target (null closes it); opts.silent: the caller already played its own sound */
  showQuery(t: QueryTarget | null, opts?: { silent?: boolean }): void;
  applySettings(patch: Partial<GameSettings>): void;
  toast(text: string, kind?: string, cell?: { x: number; z: number }, title?: string): void;
  /** open a toolbar category flyout (e.g. 'parks') */
  openFlyout?(categoryId: string, tab?: string): void;
  /** show the getting-started card again */
  showOnboarding?(): void;
  save(): Promise<void>;
  exitToRegion(): Promise<void>;
  openPauseMenu(): void;
  /** is the sandbox / everything unlocked */
  sandbox(): boolean;
}
