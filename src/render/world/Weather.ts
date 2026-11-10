/** Weather is cosmetic. This module has no runtime three import: the simulation can use the same pure calendar. */
import type * as Three from 'three';
import type { Climate } from '../../core/types';
import type { CityState } from '../../sim/CityState';
import { headlineHash } from '../../sim/economy/eventHeadlines';

export interface WeatherState { kind: 'clear' | 'rain' | 'snow' | 'haze'; intensity: number }

/** Three-day spells, using the city's 360-day year and a hash separate from the simulation RNG. */
export function weather(day: number, seed: number, climate: Climate = 'temperate'): WeatherState {
  const d = Math.max(0, Math.floor(day));
  const month = Math.floor(d / 30) % 12;
  const h = headlineHash(Math.floor(d / 3), 'weather', seed);
  const intensity = 0.55 + ((h >>> 8) % 46) / 100;
  if (climate === 'desert') return { kind: h % 100 < 40 ? 'haze' : 'clear', intensity: h % 100 < 40 ? intensity : 0 };
  const winter = month === 11 || month <= 1;
  const wetSeason = month >= 2 && month <= 4 || month >= 8 && month <= 10;
  const chance = wetSeason ? 60 : winter ? 35 : climate === 'tropical' ? 40 : 15;
  if (h % 100 >= chance) return { kind: 'clear', intensity: 0 };
  return { kind: winter && climate !== 'tropical' ? 'snow' : 'rain', intensity };
}

const VERT = /* glsl */ `
attribute vec3 seed;
uniform float uTime;
uniform float uSnow;
uniform vec3 uAnchor;
varying float vAlpha;
void main() {
  float fall = mix(190.0, 12.0, uSnow);
  vec3 p = vec3((seed.x - 0.5) * 1200.0, mod(seed.y * 420.0 - uTime * fall, 420.0), (seed.z - 0.5) * 1200.0);
  p.x += sin(uTime * 0.9 + seed.y * 31.0) * uSnow * 6.0;
  vec4 mv = viewMatrix * vec4(p + uAnchor, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = mix(14.0, 3.5, uSnow);
  vAlpha = smoothstep(0.0, 15.0, p.y) * (1.0 - smoothstep(320.0, 420.0, p.y));
}`;
const FRAG = /* glsl */ `
uniform float uSnow;
uniform float uAmount;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float rain = (1.0 - smoothstep(0.025, 0.085, abs(p.x + p.y * 0.12))) * (1.0 - abs(p.y) * 2.0);
  float snow = 1.0 - smoothstep(0.15, 0.5, length(p));
  float a = mix(rain * 0.42, snow * 0.8, uSnow) * uAmount * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vec3(0.66, 0.77, 0.84), vec3(0.96, 0.98, 1.0), uSnow), a);
}`;

export class Weather {
  readonly particles: Three.Points<Three.BufferGeometry, Three.ShaderMaterial>;
  readonly uniforms: { uTime: { value: number }; uSnow: { value: number }; uAmount: { value: number }; uAnchor: { value: Three.Vector3 } };
  current: WeatherState = { kind: 'clear', intensity: 0 };
  private day = -1;
  private state: CityState | null = null;

  constructor(scene: Three.Scene, three: typeof Three) {
    this.uniforms = { uTime: { value: 0 }, uSnow: { value: 0 }, uAmount: { value: 0 }, uAnchor: { value: new three.Vector3() } };
    const seeds = new Float32Array(1024 * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = headlineHash(i, 'weather-particle') / 4294967296;
    const geometry = new three.BufferGeometry();
    geometry.setAttribute('position', new three.BufferAttribute(new Float32Array(seeds.length), 3));
    geometry.setAttribute('seed', new three.BufferAttribute(seeds, 3));
    const material = new three.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
    this.particles = new three.Points(geometry, material);
    this.particles.name = 'weather'; this.particles.frustumCulled = false;
    scene.add(this.particles);
  }

  update(st: CityState, target: Three.Vector3, ground: number, dt: number, quality: string): WeatherState {
    if (this.state !== st || this.day !== st.day) {
      this.state = st; this.day = st.day;
      this.current = weather(st.day, st.config.seed, st.config.climate);
    }
    const w = this.current;
    this.uniforms.uTime.value += Math.max(0, dt);
    this.uniforms.uSnow.value = w.kind === 'snow' ? 1 : 0;
    this.uniforms.uAmount.value = w.intensity;
    this.uniforms.uAnchor.value.set(target.x, Math.max(ground, 0), target.z);
    this.particles.visible = w.kind === 'snow' || w.kind === 'rain';
    this.particles.geometry.setDrawRange(0, quality === 'low' ? 256 : quality === 'medium' ? 512 : quality === 'high' ? 768 : 1024);
    return w;
  }

  dispose(): void {
    this.particles.removeFromParent();
    this.particles.geometry.dispose(); this.particles.material.dispose();
    this.state = null;
  }
}
