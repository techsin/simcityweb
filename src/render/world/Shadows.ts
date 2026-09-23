/**
 * Sun shadows.
 *
 * `CitySun` is a THREE.DirectionalLight (API-compatible: position / target / color / intensity) that can switch into
 * three r186's built-in 2-cascade "SunLight" code path (WebGLLights handles `isSunLight` before `isDirectionalLight`,
 * both use identical uniform layouts). In that mode its `shadow` is a `CityCascadeShadow` whose splits are fitted
 * to the visible ground (not the camera near plane) and quantized, with texel snapping (from SunLightShadow) so
 * panning / rotating never shimmers.
 *
 * Low quality uses a single DirectionalLightShadow fitted around the camera target with manual texel snapping.
 *
 * Direction convention: `sun.position - sun.target.position` points TO the light in both modes.
 */
import * as THREE from 'three';
import { SunLightShadow } from 'three/examples/jsm/lights/SunLightShadow.js';

const _lightOrientationMatrix = new THREE.Matrix4();
const _viewToLightMatrix = new THREE.Matrix4();
const _lightDirection = new THREE.Vector3();
const _up = new THREE.Vector3();
const _center = new THREE.Vector3();
const _near = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _far = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const CASCADES = 2;
const FADE = 0.12;

/** SunLightShadow with explicit (ground fitted) split depths. */
export class CityCascadeShadow extends SunLightShadow {
  /** view-space depths [start, split, end] (set every frame by the controller) */
  splits = [1, 300, 1500];

  override updateMatrices(light: THREE.Light, viewCamera?: THREE.Camera): void {
    if (!viewCamera) return;
    const self = this as any;
    const cams: THREE.OrthographicCamera[] = self._cameras;
    const mats: THREE.Matrix4[] = self._matrices;
    const frus: THREE.Frustum[] = self._frustums;
    const vps: THREE.Vector4[] = self._viewports;
    const cdata: THREE.Vector4[] = self._cascadeData;
    const insetX = Math.min(0.25, (Math.ceil(this.radius) + 1) / this.mapSize.x);
    const insetY = Math.min(0.25, (Math.ceil(this.radius) + 1) / this.mapSize.y);
    for (let i = 0; i < CASCADES; i++) vps[i].set(i + insetX, insetY, 1 - 2 * insetX, 1 - 2 * insetY);
    const resX = this.mapSize.x * (1 - 2 * insetX);
    const resY = this.mapSize.y * (1 - 2 * insetY);
    const res = Math.min(resX, resY);
    const vc = viewCamera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const camNear = vc.near;
    const s0 = Math.max(camNear, this.splits[0]);
    const s2 = Math.max(s0 + 1, Math.min(this.splits[2], vc.far));
    const s1 = THREE.MathUtils.clamp(this.splits[1], s0 + 0.5, s2 - 0.5);
    const splits = [s0, s1, s2];

    _lightDirection.setFromMatrixPosition(light.matrixWorld).negate().normalize();
    _up.set(0, 1, 0);
    if (Math.abs(_up.dot(_lightDirection)) > 0.99) _up.set(0, 0, 1);
    _lightOrientationMatrix.lookAt(_center.set(0, 0, 0), _lightDirection, _up);
    _viewToLightMatrix.copy(_lightOrientationMatrix).transpose().multiply(vc.matrixWorld);
    const inv = vc.projectionMatrixInverse;
    const persp = (vc as THREE.PerspectiveCamera).isPerspectiveCamera === true;
    let maxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      const x = i === 0 || i === 1 ? 1 : -1;
      const y = i === 0 || i === 3 ? 1 : -1;
      const n = _near[i].set(x, y, -1).applyMatrix4(inv); // at view depth camNear
      const f = _far[i];
      if (persp) {
        f.copy(n).multiplyScalar(s2 / camNear);
        n.multiplyScalar(s0 / camNear);
      } else {
        f.set(n.x, n.y, -s2);
        n.set(n.x, n.y, -s0);
      }
      n.applyMatrix4(_viewToLightMatrix);
      f.applyMatrix4(_viewToLightMatrix);
      maxZ = Math.max(maxZ, n.z, f.z);
    }
    // raise the caster ceiling so tall buildings / hills outside the view still cast into it
    maxZ += Math.min(s2, 2500);
    const shadowNear = this.camera.near;
    for (let i = 0; i < CASCADES; i++) {
      const cNear = i === 0 ? splits[0] : cdata[i - 1].z;
      const cFar = splits[i + 1];
      const fadeStart = cFar - FADE * (cFar - splits[i]);
      cdata[i].set(i === 0 ? -1e10 : cNear, cFar, fadeStart, 0);
      const na = (cNear - s0) / (s2 - s0), fa = (cFar - s0) / (s2 - s0);
      _center.set(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        _corners[j * 2].lerpVectors(_near[j], _far[j], na);
        _corners[j * 2 + 1].lerpVectors(_near[j], _far[j], fa);
        _center.add(_corners[j * 2]).add(_corners[j * 2 + 1]);
      }
      _center.multiplyScalar(1 / 8);
      let r2 = 0, minZ = Infinity;
      for (let j = 0; j < 8; j++) {
        r2 = Math.max(r2, _corners[j].distanceToSquared(_center));
        minZ = Math.min(minZ, _corners[j].z);
      }
      // quantize the radius (log steps) so zooming only re-snaps occasionally
      let radius = Math.sqrt(r2);
      radius = Math.pow(2, Math.ceil(Math.log2(radius) * 8) / 8);
      if (res > 1) {
        radius /= 1 - 1 / res;
        const tx = (2 * radius) / resX, ty = (2 * radius) / resY;
        _center.x = Math.round(_center.x / tx) * tx;
        _center.y = Math.round(_center.y / ty) * ty;
      }
      _center.z = maxZ + shadowNear;
      _center.applyMatrix4(_lightOrientationMatrix);
      const cc = cams[i];
      cc.position.copy(_center);
      cc.quaternion.setFromRotationMatrix(_lightOrientationMatrix);
      cc.left = -radius;
      cc.right = radius;
      cc.top = radius;
      cc.bottom = -radius;
      cc.near = shadowNear;
      cc.far = maxZ - minZ + 2 * shadowNear;
      cc.updateProjectionMatrix();
      cc.updateMatrixWorld();
      self._updateMatrix(cc, mats[i], frus[i], vps[i]);
    }
    this.lastTexel = [(2 * cams[0].right) / resX, (2 * cams[1].right) / resX];
  }
  /** world size of a shadow texel per cascade (after last update) */
  lastTexel = [0.2, 1];
}

/** DirectionalLight that can run through three's cascaded SunLight path. */
export class CitySun extends THREE.DirectionalLight {
  readonly dirShadow: THREE.DirectionalLightShadow;
  readonly cascadeShadow: CityCascadeShadow;
  private _cascaded = false;

  constructor(color: THREE.ColorRepresentation = 0xffffff, intensity = 3) {
    super(color, intensity);
    this.name = 'sun';
    this.dirShadow = this.shadow;
    this.cascadeShadow = new CityCascadeShadow();
  }

  get cascaded(): boolean {
    return this._cascaded;
  }

  /** switch between the single fitted map and 2 cascades (forces a shader recompile of lit materials) */
  setCascaded(on: boolean) {
    this._cascaded = on;
    const self = this as any;
    self.isSunLight = on;
    self.type = on ? 'SunLight' : 'DirectionalLight';
    self.shadow = on ? this.cascadeShadow : this.dirShadow;
  }
}

const _basisX = new THREE.Vector3();
const _basisY = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export interface ShadowFit {
  /** camera target on the ground */
  target: THREE.Vector3;
  /** camera distance to target */
  distance: number;
  /** quality: shadow range multiplier */
  rangeMul: number;
  /** direction TO the light (unit) */
  lightDir: THREE.Vector3;
  /** highest terrain point (for caster ceiling) */
  maxHeight: number;
}

/**
 * Position the light / fit the shadow frustum for this frame.
 * Cascaded: split depths from the ground footprint; single: ortho box around the target, texel snapped.
 */
export function fitSunShadow(sun: CitySun, camera: THREE.PerspectiveCamera, f: ShadowFit) {
  const d = f.distance;
  if (sun.cascaded) {
    sun.position.copy(f.lightDir);
    sun.target.position.set(0, 0, 0);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    const sh = sun.cascadeShadow;
    // view depth of the target
    _tmp.copy(f.target).applyMatrix4(camera.matrixWorldInverse);
    const tDepth = Math.max(camera.near * 2, -_tmp.z);
    // nearest visible ground: bottom of the frustum hits the ground roughly at tDepth * k (depends on tilt);
    // use a conservative fraction and let the first cascade start there
    const start = Math.max(camera.near, tDepth * 0.35 - 60);
    const end = Math.min(camera.far, Math.max(tDepth * f.rangeMul, tDepth + 600));
    const split = THREE.MathUtils.clamp(tDepth * 1.25, start + (end - start) * 0.12, start + (end - start) * 0.55);
    const q = (v: number) => Math.pow(2, Math.round(Math.log2(Math.max(v, 1)) * 6) / 6);
    sh.splits[0] = q(start);
    sh.splits[1] = q(split);
    sh.splits[2] = q(end);
    sh.camera.near = 1;
    const t0 = sh.lastTexel[0];
    sh.normalBias = THREE.MathUtils.clamp(t0 * 1.2, 0.05, 1.5);
    sh.bias = -0.00015;
    return;
  }
  // single map: square around the target (covers the visible neighbourhood), snapped to texels in light space
  const sh = sun.dirShadow;
  const radius = Math.pow(2, Math.ceil(Math.log2(Math.max(120, d * f.rangeMul * 0.62)) * 6) / 6);
  const size = sh.mapSize.x;
  const texel = (2 * radius) / size;
  const L = f.lightDir;
  _up.set(0, 1, 0);
  if (Math.abs(L.y) > 0.99) _up.set(0, 0, 1);
  _basisX.crossVectors(_up, L).normalize();
  _basisY.crossVectors(L, _basisX).normalize();
  const cx = Math.round(f.target.dot(_basisX) / texel) * texel;
  const cy = Math.round(f.target.dot(_basisY) / texel) * texel;
  const cz = f.target.dot(L);
  _center.copy(_basisX).multiplyScalar(cx).addScaledVector(_basisY, cy).addScaledVector(L, cz);
  const back = Math.max(600, radius * 2 + f.maxHeight * 2);
  sun.target.position.copy(_center);
  sun.position.copy(_center).addScaledVector(L, back);
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  const cam = sh.camera as THREE.OrthographicCamera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = 1;
  cam.far = back + radius * 1.5 + 200;
  cam.updateProjectionMatrix();
  sh.normalBias = THREE.MathUtils.clamp(texel * 1.4, 0.05, 2);
  sh.bias = -0.0002;
}
