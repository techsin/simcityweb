/**
 * Weather is cosmetic, and this module is what it looks like: the particles, the real-time hold and easing, and the
 * rain and flash hooks. What the weather is on a game day is the simulation's calendar,
 * src/sim/economy/weatherCalendar.ts (NOTE-081), which the headlines read too. No runtime three import: three comes
 * in through the constructor.
 */
import type * as Three from 'three';
import type { CityState } from '../../sim/CityState';
import { headlineHash } from '../../sim/economy/eventHeadlines';
import { weather, type WeatherState } from '../../sim/economy/weatherCalendar';

/** The sim's calendar under the names this module had for it before the move: tests and QA page scripts ask here. */
export { weather, type WeatherState };
export interface WeatherAmounts { rain: number; snow: number; haze: number }
export const WEATHER_HOLD_SECONDS = 20;
export const WEATHER_EASE_SECONDS = 4;

const VERT = /* glsl */ `
attribute vec3 seed;
uniform float uTime;
uniform float uDistance;
uniform float uVolume;
uniform float uHeight;
uniform vec3 uAnchor;
varying float vAlpha;
varying float vSnow;
void main() {
  vSnow = step(0.5, fract(seed.x * 13.7 + seed.z * 31.1));
  float fall = mix(190.0, 12.0, vSnow);
  vec3 p = vec3((seed.x - 0.5) * uVolume, mod(seed.y * uHeight - uTime * fall, uHeight), (seed.z - 0.5) * uVolume);
  p.x += sin(uTime * 0.9 + seed.y * 31.0) * vSnow * 3.0;
  vec4 mv = viewMatrix * vec4(p + uAnchor, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(mix(8.0, 3.0, vSnow) * uDistance / max(40.0, -mv.z), 1.0, mix(12.0, 5.0, vSnow));
  vAlpha = smoothstep(0.0, uHeight * 0.04, p.y) * (1.0 - smoothstep(uHeight * 0.8, uHeight, p.y));
}`;
const FRAG = /* glsl */ `
uniform float uSnow;
uniform float uRain;
uniform float uLight;
uniform float uFarFade;
varying float vAlpha;
varying float vSnow;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float rain = (1.0 - smoothstep(0.025, 0.085, abs(p.x + p.y * 0.12))) * (1.0 - abs(p.y) * 2.0);
  float snow = 1.0 - smoothstep(0.15, 0.5, length(p));
  float a = mix(rain * 0.42 * uRain, snow * 0.8 * uSnow, vSnow) * vAlpha * uFarFade;
  if (a < 0.001) discard;
  gl_FragColor = vec4(mix(vec3(0.66, 0.77, 0.84), vec3(0.96, 0.98, 1.0), vSnow) * uLight, a);
}`;

export class Weather {
  readonly particles: Three.Points<Three.BufferGeometry, Three.ShaderMaterial>;
  readonly uniforms;
  current: WeatherState = { kind: 'clear', intensity: 0 };
  readonly shown: WeatherAmounts = { rain: 0, snow: 0, haze: 0 };
  private held: WeatherState = { kind: 'clear', intensity: 0 };
  private holdUntil = 0;
  private elapsed = 0;
  private initialized = false;
  private snowCue = 0;
  private newsTail: CityState['news'][number] | undefined;
  private day = -1;
  private state: CityState | null = null;

  constructor(scene: Three.Scene, three: typeof Three) {
    this.uniforms = {
      uTime: { value: 0 }, uSnow: { value: 0 }, uRain: { value: 0 }, uLight: { value: 1 },
      uFarFade: { value: 1 }, uDistance: { value: 300 }, uVolume: { value: 540 }, uHeight: { value: 240 },
      uAnchor: { value: new three.Vector3() },
    };
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

  /** The same eased rain drives wet roads, ambience and the future pedestrian getRain callback. */
  rainAmount(): number { return this.shown.rain; }
  isRaining(): boolean { return this.rainAmount() > 0.05; }

  /** Single gate for any future lightning/flash contribution; weather currently requests no flashes. */
  flashAmount(strength = 0, reducedFlashing = false): number {
    return reducedFlashing ? 0 : Math.max(0, Math.min(1, strength));
  }

  reset(): void {
    this.initialized = false; this.elapsed = 0; this.holdUntil = 0;
    this.snowCue = 0; this.newsTail = undefined;
    this.shown.rain = this.shown.snow = this.shown.haze = 0;
    this.state = null; this.day = -1;
  }

  update(st: CityState, target: Three.Vector3, ground: number, dt: number, quality: string, distance = 300, night = 0): WeatherState {
    dt = Math.max(0, Math.min(dt, 0.25));
    this.elapsed += dt;
    if (this.state !== st || this.day !== st.day) {
      this.state = st; this.day = st.day;
      this.current = weather(st.day, st.config.seed, st.config.climate);
    }
    const w = this.current;
    if (!this.initialized) {
      this.initialized = true;
      this.held = w;
      this.holdUntil = this.elapsed + WEATHER_HOLD_SECONDS;
      this.shown.rain = w.kind === 'rain' ? w.intensity : 0;
      this.shown.snow = w.kind === 'snow' ? w.intensity : 0;
      this.shown.haze = w.kind === 'haze' ? w.intensity : 0;
      this.newsTail = st.news[st.news.length - 1];
    } else if (this.elapsed >= this.holdUntil) {
      this.held = w;
      this.holdUntil = this.elapsed + WEATHER_HOLD_SECONDS;
    }
    const blend = 1 - Math.exp(-dt / WEATHER_EASE_SECONDS);
    this.shown.rain += ((this.held.kind === 'rain' ? this.held.intensity : 0) - this.shown.rain) * blend;
    this.shown.snow += ((this.held.kind === 'snow' ? this.held.intensity : 0) - this.shown.snow) * blend;
    this.shown.haze += ((this.held.kind === 'haze' ? this.held.intensity : 0) - this.shown.haze) * blend;
    this.snowCue = Math.max(0, this.snowCue - dt * 0.02);
    // Rare same-day news gets a small particle cue while the large lighting/audio envelope keeps easing.
    const tail = st.news[st.news.length - 1];
    if (tail !== this.newsTail) {
      for (let i = st.news.length - 1; i >= 0; i--) {
        const n = st.news[i];
        if (n === this.newsTail || n.day < st.day) break;
        if (n.day !== st.day) continue;
        if (w.kind === 'snow' && /^(Snowfall turns|Snow day!)/.test(n.text)) this.snowCue = 0.08;
      }
      this.newsTail = tail;
    }
    const d = Math.max(40, distance);
    this.uniforms.uTime.value += dt;
    this.uniforms.uRain.value = this.shown.rain;
    this.uniforms.uSnow.value = Math.max(this.shown.snow, this.snowCue);
    this.uniforms.uLight.value = 1 - Math.max(0, Math.min(1, night)) * 0.92;
    this.uniforms.uFarFade.value = Math.max(0, Math.min(1, (2500 - d) / 1000));
    this.uniforms.uDistance.value = d;
    this.uniforms.uVolume.value = Math.max(120, Math.min(1200, d * 1.8));
    this.uniforms.uHeight.value = Math.max(80, Math.min(500, d * 0.8));
    this.uniforms.uAnchor.value.set(target.x, Math.max(ground, 0), target.z);
    this.particles.visible = this.uniforms.uFarFade.value > 0 && (this.uniforms.uRain.value > 0.001 || this.uniforms.uSnow.value > 0.001);
    this.particles.geometry.setDrawRange(0, quality === 'low' ? 256 : quality === 'medium' ? 512 : quality === 'high' ? 768 : 1024);
    return w;
  }

  dispose(): void {
    this.particles.removeFromParent();
    this.particles.geometry.dispose(); this.particles.material.dispose();
    this.state = null;
  }
}
