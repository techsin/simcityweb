import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Weather, weather, WEATHER_HOLD_SECONDS } from '../../src/render/world/Weather';
import { WorldView } from '../../src/render/world/WorldView';
import { newState } from '../infra/cityGen';

function days() {
  const found = { clear: -1, rain: -1, snow: -1 };
  for (let day = 0; day < 360; day++) {
    const kind = weather(day, 7).kind;
    if (kind !== 'haze' && found[kind] < 0) found[kind] = day;
  }
  expect(Object.values(found).every((day) => day >= 0)).toBe(true);
  return found;
}

describe('FEEL-23 real-time weather presentation', () => {
  it('holds a spell for twenty real seconds despite ultra-speed calendar changes, then eases every amount', () => {
    const st = newState(64), renderer = new Weather(new THREE.Scene(), THREE), target = new THREE.Vector3();
    const d = days(); st.config.seed = 7; st.day = d.rain;
    renderer.update(st, target, 0, 0, 'high');
    const initial = renderer.rainAmount();
    for (let frame = 1; frame < WEATHER_HOLD_SECONDS * 60; frame++) {
      st.day = frame % 3 === 0 ? d.snow : d.clear;
      renderer.update(st, target, 0, 1 / 60, 'high');
      expect(renderer.shown).toEqual({ rain: initial, snow: 0, haze: 0 });
    }
    st.day = d.clear;
    for (let frame = 0; frame < 12 * 60; frame++) {
      const before = renderer.rainAmount();
      renderer.update(st, target, 0, 1 / 60, 'high');
      expect(renderer.rainAmount()).toBeLessThanOrEqual(before);
      expect(before - renderer.rainAmount()).toBeLessThan(0.005);
    }
    expect(renderer.rainAmount()).toBeLessThan(initial * 0.06);
    expect(renderer.isRaining()).toBe(false);
    renderer.dispose();
  });

  it.each([0.5, 0.2, 0.05])('bounds lighting changes with %s real seconds per game day', (secondsPerDay) => {
    const st = newState(64), renderer = new Weather(new THREE.Scene(), THREE), target = new THREE.Vector3();
    st.config.seed = 7;
    let luminance = 0, changes = 0;
    for (let frame = 0; frame < 90 * 60; frame++) {
      st.day = Math.floor(frame / 60 / secondsPerDay);
      renderer.update(st, target, 0, 1 / 60, 'high');
      const next = 1 - Math.min(1, renderer.shown.rain + renderer.shown.snow) * 0.45;
      if (frame > 0) {
        expect(Math.abs(next - luminance) / luminance).toBeLessThan(0.01);
        if (Math.abs(next - luminance) > 1e-7) changes++;
      }
      luminance = next;
    }
    expect(changes).toBeGreaterThan(0);
    renderer.dispose();
  });

  it('shows same-day headline flakes while the held lighting and rain continue smoothly', () => {
    const st = newState(64), renderer = new Weather(new THREE.Scene(), THREE), target = new THREE.Vector3();
    const d = days(); st.config.seed = 7; st.day = d.clear;
    renderer.update(st, target, 0, 0, 'high');
    st.day = d.snow;
    st.news.push({ day: st.day, text: 'Snow day! Children celebrate.', kind: 'info' });
    renderer.update(st, target, 0, 1 / 60, 'high');
    expect(renderer.current.kind).toBe('snow');
    expect(renderer.uniforms.uSnow.value).toBeGreaterThanOrEqual(0.08);
    expect(renderer.particles.visible).toBe(true);
    expect(renderer.shown).toEqual({ rain: 0, snow: 0, haze: 0 });
    for (let i = 0; i < 3 * 60; i++) renderer.update(st, target, 0, 1 / 60, 'high');
    expect(renderer.particles.visible).toBe(true);
    renderer.dispose();
  });

  it('keeps rain particles on the shared eased amount even when a rain headline arrives during a clear hold', () => {
    const st = newState(64), renderer = new Weather(new THREE.Scene(), THREE), target = new THREE.Vector3();
    const d = days(); st.config.seed = 7; st.day = d.clear;
    renderer.update(st, target, 0, 0, 'high');
    st.day = d.rain;
    st.news.push({ day: st.day, text: 'April showers: umbrellas brighten the streets.', kind: 'info' });
    renderer.update(st, target, 0, 1 / 60, 'high');
    expect(renderer.uniforms.uRain.value).toBe(0);
    expect(renderer.rainAmount()).toBe(0);
    for (let frame = 0; frame < 24 * 60; frame++) {
      renderer.update(st, target, 0, 1 / 60, 'high');
      expect(renderer.uniforms.uRain.value).toBe(renderer.rainAmount());
    }
    expect(renderer.rainAmount()).toBeGreaterThan(0.1);
    renderer.dispose();
  });

  it('scales the volume at close and middle zoom, caps it far out, and dims particles at night', () => {
    const st = newState(64), renderer = new Weather(new THREE.Scene(), THREE), target = new THREE.Vector3();
    st.config.seed = 7; st.day = days().rain;
    const geometry = renderer.particles.geometry;
    for (const distance of [120, 300, 1500, 2000, 2500]) {
      renderer.update(st, target, 0, 1 / 60, 'high', distance, 0);
      expect(renderer.uniforms.uVolume.value).toBeCloseTo(Math.min(1200, distance * 1.8));
      expect(renderer.uniforms.uHeight.value).toBeCloseTo(Math.min(500, distance * 0.8));
      expect(renderer.uniforms.uDistance.value).toBe(distance);
      expect(renderer.particles.visible).toBe(distance < 2500);
      expect(renderer.particles.geometry).toBe(geometry);
      expect(geometry.drawRange.count).toBe(768);
    }
    renderer.update(st, target, 0, 0, 'high', 300, 1);
    expect(renderer.uniforms.uLight.value).toBeCloseTo(0.08);
    expect(renderer.particles.material.vertexShader).toContain('/ max(40.0, -mv.z)');
    expect(renderer.flashAmount(0.8)).toBe(0.8);
    expect(renderer.flashAmount(2)).toBe(1);
    expect(renderer.flashAmount(-1)).toBe(0);
    expect(renderer.flashAmount(0.8, true)).toBe(0);
    renderer.dispose();
  });

  it('starts a loaded city on its own weather without replaying the old rain envelope or headlines', () => {
    const st = newState(64), renderer = new Weather(new THREE.Scene(), THREE), target = new THREE.Vector3();
    const d = days(); st.config.seed = 7; st.day = d.rain;
    renderer.update(st, target, 0, 0, 'high');
    expect(renderer.isRaining()).toBe(true);
    renderer.reset(); st.day = d.clear;
    st.news.push({ day: d.snow, text: 'Snow day! Children celebrate.', kind: 'info' });
    renderer.update(st, target, 0, 0, 'high');
    expect(renderer.rainAmount()).toBe(0);
    expect(renderer.particles.visible).toBe(false);
    renderer.dispose();
  });

  it('uses shown weather for surfaces and softer overcast lighting', () => {
    const view = {
      cameraController: { target: new THREE.Vector3() }, controls: { distance: 300 },
      state: newState(64), terrain: { worldHeight: () => 0 }, q: { level: 'high', shadowRadius: 2 },
      weather: { shown: { rain: 0.8, snow: 0, haze: 0 }, update() {} },
      sun: { intensity: 1, shadow: { radius: 2 } }, nightFill: { intensity: 0.1 },
      scene: { environmentIntensity: 1 },
      sky: { lighting: { night: 0, envIntensity: 1 }, uniforms: {
        uSkyExposure: { value: 1 }, uCloudCover: { value: 0 },
        uCloudLit: { value: new THREE.Color(1, 1, 1) }, uCloudAmb: { value: new THREE.Color(1, 1, 1) },
      } }, post: { fog: { uSkyExposure: { value: 1 }, uCloudCover: { value: 0 }, uHaze: { value: 0 } } },
    };
    const proto = WorldView.prototype as unknown as { updateWeather(this: object, dt: number): void };
    proto.updateWeather.call(view, 1 / 60);
    expect(view.sun.intensity).toBeCloseTo(0.64);
    expect(view.sun.shadow.radius).toBeCloseTo(5.2);
    expect(view.nightFill.intensity).toBeCloseTo(0.128);
    expect(view.scene.environmentIntensity).toBeCloseTo(0.904);
    view.weather.shown.rain = 0;
    proto.updateWeather.call(view, 0);
  });
});
