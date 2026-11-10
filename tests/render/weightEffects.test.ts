/** FEEL-14 feedback shares the existing smoke draw and has a separate one-shot clock. */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Effects } from '../../src/render/city/effects/Effects';
import { sharedUniforms } from '../../src/assets/materials';

const lot = (cx = 300, cz = 0, sw = 32, sd = 32) => ({ cx, cz, sw, sd, baseY: 0 });
const geometry = (fx: Effects) => fx.smoke.geometry as THREE.InstancedBufferGeometry;
const material = (fx: Effects) => fx.smoke.material as THREE.ShaderMaterial;
const feedback = (fx: Effects) => {
  const g = geometry(fx), E = g.getAttribute('aEmit'), P = g.getAttribute('aP'), B = g.getAttribute('aBirth');
  const out: { x: number; y: number; z: number; kind: number; life: number; birth: number }[] = [];
  for (let i = 0; i < g.instanceCount; i++) if (P.getX(i) >= 6) {
    out.push({ x: E.getX(i), y: E.getY(i), z: E.getZ(i), kind: P.getX(i), life: P.getY(i), birth: B.getX(i) });
  }
  return out;
};
const rig = () => {
  const fx = new Effects();
  fx.setFeedbackCamera(new THREE.Vector3());
  return fx;
};

describe('building weight effects', () => {
  it('keeps a 300 m house dust burst for 2.5 seconds without looping or per-frame buffer rebuilds', () => {
    const fx = rig();
    try {
      fx.update(7);
      fx.impact(lot(), 'dust'); fx.update(0);
      const particles = feedback(fx);
      expect(particles.length).toBeGreaterThanOrEqual(16);
      expect(particles.length).toBeLessThanOrEqual(40);
      expect(particles.every((p) => p.kind === 6 && p.life === 2.5 && p.birth === 7)).toBe(true);
      const attr = geometry(fx).getAttribute('aEmit') as THREE.InstancedBufferAttribute;
      const version = attr.version;
      fx.update(1.5);
      expect(feedback(fx)).toEqual(particles);
      expect(attr.version).toBe(version);
      expect(material(fx).uniforms.uFeedbackTime.value).toBe(8.5);
      fx.update(0.999);
      expect(feedback(fx)).toEqual(particles);
      fx.update(0.002);
      expect(feedback(fx)).toHaveLength(0);
      expect(fx.particleCount).toBe(0);
      fx.update(20);
      expect(fx.smoke.visible).toBe(false);
    } finally { fx.dispose(); }
  });

  it('merges a 200-building drag into one bounded cloud spanning the removed lots', () => {
    const fx = rig();
    try {
      for (let i = 0; i < 200; i++) fx.impact(lot(100 + i * 4, 200, 16, 16), 'dust');
      expect(fx.particleCount).toBe(0);
      fx.update(0);
      const particles = feedback(fx);
      expect(particles).toHaveLength(600);
      expect(particles.every((p) => p.kind === 6 && p.life === 2.5 && p.birth === 0)).toBe(true);
      expect(Math.min(...particles.map((p) => p.x))).toBeGreaterThanOrEqual(92);
      expect(Math.min(...particles.map((p) => p.x))).toBeLessThan(115);
      expect(Math.max(...particles.map((p) => p.x))).toBeGreaterThan(875);
      expect(Math.max(...particles.map((p) => p.x))).toBeLessThanOrEqual(904);
      expect(new Set(particles.map((p) => Math.floor(p.x / 16))).size).toBeGreaterThan(40);
      expect((fx as unknown as { impacts: unknown[] }).impacts).toHaveLength(1);
      expect(geometry(fx).getAttribute('aEmit').count).toBe(7000);
      expect(fx.flames.visible).toBe(false);
    } finally { fx.dispose(); }
  });

  it('keeps 30 individual clouds within the cap and merges the 31st', () => {
    const fx = rig();
    try {
      for (let i = 0; i < 30; i++) fx.impact(lot(200 + i * 8, 0, 80, 80), 'dust');
      fx.update(0);
      expect(feedback(fx)).toHaveLength(600);
      const impacts = (fx as unknown as { impacts: { count: number }[] }).impacts;
      expect(impacts).toHaveLength(30);
      expect(impacts.every((p) => p.count >= 16 && p.count <= 40)).toBe(true);
      fx.clear(); fx.update(0);
      for (let i = 0; i < 31; i++) fx.impact(lot(200 + i * 8), 'dust');
      fx.update(0);
      expect((fx as unknown as { impacts: unknown[] }).impacts).toHaveLength(1);
      expect(feedback(fx).length).toBeLessThanOrEqual(600);
    } finally { fx.dispose(); }
  });

  it('caps overlapping waves, ash and landing rings together', () => {
    const fx = rig();
    try {
      for (let wave = 0; wave < 8; wave++) {
        for (let i = 0; i < 29; i++) fx.impact(lot(200 + i * 8), wave % 2 ? 'ash' : 'dust');
        for (let i = 0; i < 50; i++) fx.impact(lot(250 + i * 8), 'landing');
        fx.update(0.1);
        expect(feedback(fx).length).toBeLessThanOrEqual(600);
      }
      fx.update(2.6);
      expect(fx.particleCount).toBe(0);
    } finally { fx.dispose(); }
  });

  it('trims a full cloud only by a new house burst while preserving its prefix and original expiry', () => {
    const fx = rig();
    try {
      fx.update(7);
      for (let i = 0; i < 38; i++) fx.impact(lot(100 + i * 4, 200, 16, 16), 'dust');
      fx.update(0);
      const original = feedback(fx);
      const attributes = ['aEmit', 'aP', 'aBirth'].map((name) => Array.from(geometry(fx).getAttribute(name).array));
      expect(original).toHaveLength(600);
      fx.update(0.5);
      fx.impact(lot(1000), 'dust'); fx.update(0);
      expect(feedback(fx)).toHaveLength(600);
      expect(feedback(fx).slice(0, 568)).toEqual(original.slice(0, 568));
      expect(feedback(fx).slice(568).every((p) => p.kind === 6 && p.life === 2.5 && p.birth === 7.5)).toBe(true);
      for (const [i, name] of ['aEmit', 'aP', 'aBirth'].entries()) {
        const n = 568 * (name === 'aBirth' ? 1 : 4);
        expect(Array.from(geometry(fx).getAttribute(name).array).slice(0, n)).toEqual(attributes[i].slice(0, n));
      }
      fx.update(1.999);
      expect(feedback(fx)).toHaveLength(600);
      fx.update(0.002);
      expect(feedback(fx)).toHaveLength(32);
      expect(feedback(fx).every((p) => p.birth === 7.5)).toBe(true);
      fx.update(0.5);
      expect(feedback(fx)).toHaveLength(0);
    } finally { fx.dispose(); }
  });

  it.each([['landing', 1], ['ash', 16]] as const)('trims only the %s feedback share from a full cloud', (kind, count) => {
    const fx = rig();
    try {
      for (let i = 0; i < 38; i++) fx.impact(lot(100 + i * 4, 200, 16, 16), 'dust');
      fx.update(0);
      const original = feedback(fx);
      fx.update(0.5);
      fx.impact(lot(1000), kind); fx.update(0);
      const particles = feedback(fx);
      expect(particles).toHaveLength(600);
      expect(particles.slice(0, 600 - count)).toEqual(original.slice(0, 600 - count));
      expect(particles.slice(600 - count).every((p) => p.kind === (kind === 'landing' ? 8 : 7) && p.birth === 0.5)).toBe(true);
    } finally { fx.dispose(); }
  });

  it('trims multiple oldest impacts in order and keeps the combined feedback cap exact', () => {
    const fx = rig();
    try {
      for (let i = 0; i < 30; i++) fx.impact(lot(100 + i * 32), 'dust');
      fx.update(0);
      const original = feedback(fx);
      const impacts = () => (fx as unknown as { impacts: { count: number }[] }).impacts;
      expect(impacts().map((p) => p.count)).toEqual(Array(30).fill(20));
      fx.update(0.1);
      fx.impact(lot(1500), 'dust'); fx.update(0);
      expect(impacts().map((p) => p.count)).toEqual([8, ...Array(28).fill(20), 32]);
      expect(feedback(fx).slice(0, 568)).toEqual([...original.slice(20, 28), ...original.slice(40)]);
      fx.impact(lot(1600), 'ash'); fx.impact(lot(1700), 'landing'); fx.update(0);
      const particles = feedback(fx);
      expect(particles).toHaveLength(600);
      expect(impacts().map((p) => p.count)).toEqual([11, ...Array(27).fill(20), 32, 16, 1]);
      expect(particles.slice(0, 551)).toEqual([...original.slice(40, 51), ...original.slice(60)]);
      expect(particles.filter((p) => p.kind === 7)).toHaveLength(16);
      expect(particles.filter((p) => p.kind === 8)).toHaveLength(1);
    } finally { fx.dispose(); }
  });

  it('gives a landing ring 1.2 seconds and an ash puff its own smaller grey kind', () => {
    const fx = rig();
    try {
      fx.impact(lot(), 'landing'); fx.impact(lot(400), 'ash'); fx.update(0);
      expect(feedback(fx).filter((p) => p.kind === 8)).toHaveLength(1);
      expect(feedback(fx).filter((p) => p.kind === 7)).toHaveLength(16);
      expect(feedback(fx).find((p) => p.kind === 8)?.life).toBeCloseTo(1.2);
      fx.update(1.21);
      expect(feedback(fx).every((p) => p.kind === 7)).toBe(true);
      expect(feedback(fx)).toHaveLength(16);
      fx.update(0.3);
      expect(feedback(fx)).toHaveLength(0);
      expect(material(fx).vertexShader).toContain('vec3(position.x, 0.0, -position.y)');
      expect(material(fx).fragmentShader).toContain('float ring =');
      expect(material(fx).fragmentShader).toContain('vec3(0.38, 0.37, 0.35)');
    } finally { fx.dispose(); }
  });

  it('rejects distant and unknown-camera events and clips active feedback when the camera moves', () => {
    const fx = new Effects();
    try {
      fx.impact(lot(), 'dust'); fx.update(0);
      expect(feedback(fx)).toHaveLength(0);
      fx.setFeedbackCamera(new THREE.Vector3());
      for (const kind of ['dust', 'ash', 'landing'] as const) fx.impact(lot(2201), kind);
      fx.update(0);
      expect(feedback(fx)).toHaveLength(0);
      fx.impact(lot(2199), 'dust'); fx.update(0);
      expect(feedback(fx).length).toBeGreaterThan(0);
      const version = (geometry(fx).getAttribute('aEmit') as THREE.InstancedBufferAttribute).version;
      fx.setFeedbackCamera(new THREE.Vector3(-5000, 0, 0)); fx.update(0.1);
      expect(material(fx).uniforms.uFeedbackCamera.value.toArray()).toEqual([-5000, 0, 0]);
      expect((geometry(fx).getAttribute('aEmit') as THREE.InstancedBufferAttribute).version).toBe(version);
      expect(material(fx).vertexShader).toContain('distance(p, uFeedbackCamera) > 2200.0');
      expect(material(fx).vertexShader).toContain('(uFeedbackTime - aBirth) / life');
      expect(material(fx).uniforms.uTime).toBe(sharedUniforms.uTime);
      expect(material(fx).uniforms.uFeedbackTime).not.toBe(sharedUniforms.uTime);
    } finally { fx.dispose(); }
  });

  it('reserves feedback space in the existing full smoke pool and preserves flame seeds', () => {
    const base = rig(), fx = rig();
    try {
      for (const e of [base, fx]) e.setExtra('busy', [
        { x: 50, y: 7, z: 80, kind: 0, size: 4.5, count: 7000, life: 8 },
        { x: 60, y: 8, z: 90, kind: 2, size: 3, count: 14, life: 1.2 },
      ]);
      fx.impact(lot(), 'dust'); base.update(0); fx.update(0);
      expect(geometry(fx).instanceCount).toBe(7000);
      expect(feedback(fx).length).toBeGreaterThanOrEqual(16);
      for (const name of ['aEmit', 'aP']) {
        const b = base.flames.geometry.getAttribute(name).array;
        expect(fx.flames.geometry.getAttribute(name).array).toEqual(b);
        const old = geometry(base).getAttribute(name).array;
        const current = geometry(fx).getAttribute(name).array;
        expect(Array.from(current).slice(0, 6800 * 4)).toEqual(Array.from(old).slice(0, 6800 * 4));
      }
      fx.update(2.5);
      for (const name of ['aEmit', 'aP']) expect(geometry(fx).getAttribute(name).array).toEqual(geometry(base).getAttribute(name).array);
      expect(feedback(fx)).toHaveLength(0);
    } finally { base.dispose(); fx.dispose(); }
  });

  it('retains the continuous emitter byte sequence when no feedback plays', () => {
    const fx = rig();
    try {
      fx.setExtra('fixture', [{ x: 50, y: 7, z: 80, kind: 0, size: 4.5, count: 2, life: 8 }]); fx.update(0);
      const g = geometry(fx);
      expect(Array.from(g.getAttribute('aEmit').array).slice(0, 8)).toEqual([
        49.712242126464844, 7, 79.70993041992188, 0.5431557893753052,
        49.76747512817383, 7, 79.9975357055664, 0.5483488440513611,
      ]);
      expect(Array.from(g.getAttribute('aP').array).slice(0, 8)).toEqual([
        0, 8.323769569396973, 4.5, 0.036401182413101196,
        0, 8.230640411376953, 4.5, 0.5313380360603333,
      ]);
      expect(Array.from(g.getAttribute('aBirth').array).slice(0, 2)).toEqual([-1, -1]);
    } finally { fx.dispose(); }
  });

  it('clears queued and active feedback and disposes its existing resources', () => {
    const fx = rig();
    fx.impact(lot(), 'dust'); fx.update(0);
    fx.impact(lot(), 'landing');
    fx.clear(); fx.update(0);
    expect(feedback(fx)).toHaveLength(0);
    fx.update(3);
    expect(fx.particleCount).toBe(0);
    const dispose = vi.fn();
    geometry(fx).addEventListener('dispose', dispose);
    fx.impact(lot(), 'ash'); fx.update(0); fx.impact(lot(), 'dust');
    fx.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    const internals = fx as unknown as { impacts: unknown[]; pendingImpacts: unknown[]; pendingCloud: unknown };
    expect(internals.impacts).toHaveLength(0);
    expect(internals.pendingImpacts).toHaveLength(0);
    expect(internals.pendingCloud).toBeNull();
  });
});
