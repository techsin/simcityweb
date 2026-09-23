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

export interface CursorTipApi {
  show(html: string, kind?: 'ok' | 'bad' | 'info'): void;
  hide(): void;
  move(clientX: number, clientY: number): void;
}

export interface PanelsApi {
  open(id: string): void;
  close(id: string): void;
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
  sound(name: string): void;
  focusCell(x: number, z: number, distance?: number): void;
  showQuery(t: QueryTarget | null): void;
  applySettings(patch: Partial<GameSettings>): void;
  toast(text: string, kind?: string, cell?: { x: number; z: number }): void;
  save(): Promise<void>;
  exitToRegion(): Promise<void>;
  openPauseMenu(): void;
  /** is the sandbox / everything unlocked */
  sandbox(): boolean;
}
