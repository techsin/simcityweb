/** No-op view implementations used before the real views finish loading (or if nothing can render). */
import * as THREE from 'three';
import type { CameraControllerApi, CellHit, CityObjectsViewApi, QualityLevel, WorldViewApi } from '../../render/contracts';
import type { Overlay } from '../../core/types';

class NullCamera implements CameraControllerApi {
  enabled = true;
  readonly target = new THREE.Vector3();
  readonly distance = 800;
  focusOn(x: number, z: number): void {
    this.target.set(x, 0, z);
  }
  rotateStep(): void {}
}

export class NullWorldView implements WorldViewApi {
  readonly isNull = true;
  readonly renderer = null as unknown as THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera();
  readonly controls = new NullCamera();
  timeOfDay = 12;
  autoTime = true;
  update(): void {}
  render(): void {}
  resize(): void {}
  setQuality(_q: QualityLevel): void {}
  setOverlay(_o: Overlay): void {}
  setGridVisible(): void {}
  setHighlight(): void {}
  setHighlightRect(): void {}
  setBrush(): void {}
  pickCell(): CellHit | null {
    return null;
  }
  capture(): string {
    return '';
  }
  dispose(): void {}
}

export class NullObjectsView implements CityObjectsViewApi {
  readonly isNull = true;
  update(): void {}
  setGhost(): void {}
  setNetworkPreview(): void {}
  setUnderground(): void {}
  setOverlayMode(): void {}
  pickBuilding(): number | null {
    return null;
  }
  setSelected(): void {}
  dispose(): void {}
}
