/**
 * Rendering contracts consumed by the game/UI layer (src/game, src/ui).
 *  - WorldView  (owned by render-world agent): renderer, camera, sky/day-night, post FX, terrain, water, trees.
 *  - CityObjectsView (owned by render-city agent): roads/rails/power lines, buildings, vehicles, effects, previews.
 * Concrete classes: src/render/world/WorldView.ts and src/render/city/CityObjectsView.ts implement these.
 */
import type * as THREE from 'three';
import type { Overlay, Network } from '../core/types';
import type { CellRect } from '../core/events';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface CellHit {
  x: number;
  z: number;
  /** world position of the hit on terrain */
  point: THREE.Vector3;
}

export interface CameraControllerApi {
  /** enable / disable user input (e.g. while a modal is open) */
  enabled: boolean;
  /** smoothly move focus to world position */
  focusOn(worldX: number, worldZ: number, distance?: number): void;
  /** current focus point on the ground (world) */
  readonly target: THREE.Vector3;
  /** current distance / zoom (meters) */
  readonly distance: number;
  /** rotate by 90° steps (SC4 style) */
  rotateStep(dir: 1 | -1): void;
}

export interface WorldViewApi {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: CameraControllerApi;
  /** call every frame */
  update(dt: number): void;
  /** draws the frame (post processing included) */
  render(): void;
  resize(width: number, height: number): void;
  setQuality(q: QualityLevel): void;
  /** hours 0..24; with autoTime=true time advances with the simulation / real time */
  timeOfDay: number;
  autoTime: boolean;
  /** data view overlay drawn on the terrain */
  setOverlay(o: Overlay): void;
  /** show the cell grid (while a zoning / building tool is active) */
  setGridVisible(v: boolean): void;
  /** highlight cells (tool previews). Pass null to clear. color: css color / hex */
  setHighlight(cells: { x: number; z: number; ok: boolean }[] | null): void;
  /** highlight a rect (zoning drag). */
  setHighlightRect(rect: CellRect | null, color: number): void;
  /** circular brush for terraform / trees (world units). null to hide */
  setBrush(center: { x: number; z: number } | null, radiusCells: number): void;
  /** screen position (pixels relative to canvas) -> terrain cell */
  pickCell(clientX: number, clientY: number): CellHit | null;
  /** grab current frame as data URL (for region thumbnails / screenshots) */
  capture(width?: number, height?: number, topDown?: boolean): string;
  dispose(): void;
}

export interface CityObjectsViewApi {
  update(dt: number): void;
  /** ghost of a ploppable/growable model at a lot (min corner x,z, rotation) tinted green/red; null clears */
  setGhost(defId: string | null, x?: number, z?: number, rot?: 0 | 1 | 2 | 3, ok?: boolean): void;
  /** ghost of a network path being dragged */
  setNetworkPreview(path: { x: number; z: number }[] | null, type?: Network | 'power' | 'subway', ok?: boolean): void;
  /** underground view: show subway tunnels, hide/fade buildings */
  setUnderground(on: boolean): void;
  /** data view active: buildings slightly desaturated / transparent */
  setOverlayMode(o: Overlay): void;
  /** building id under screen point (or null) */
  pickBuilding(clientX: number, clientY: number): number | null;
  /** highlight a building (query tool hover) */
  setSelected(buildingId: number | null): void;
  dispose(): void;
}
