/** FEEL-09: real perspective projection and camera input, without WebGL. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE, SECONDS_PER_DAY } from '../../src/core/constants';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import { CameraController, type CameraFollowPosition } from '../../src/render/world/CameraController';
import { EMERG_DAYS_PER_MIN, NET_TIME } from '../../src/sim/infra/params';

const cleanup: (() => void)[] = [];
let now = 0;
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { activeElement: null });
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(distance = 800) {
  const dom = Object.assign(new EventTarget(), {
    clientWidth: 1280, clientHeight: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture() {}, releasePointerCapture() {},
  }) as unknown as HTMLElement;
  const view = new THREE.PerspectiveCamera(38, 1280 / 720, 1, 50000);
  const controls = new CameraController(view, dom, { mapSize: 12000, heightAt: () => 0 });
  controls.setView(1000, 2000, distance, 52, 45);
  cleanup.push(() => controls.dispose());
  const position: CameraFollowPosition = { x: 1000, y: 0, z: 2000, onScene: false };
  return { controls, dom, view, position };
}

function emit(target: EventTarget, type: string, init: Record<string, unknown> = {}): Event {
  const e = Object.assign(new Event(type, { cancelable: true }), {
    clientX: 640, clientY: 360, pointerId: 1, button: 0, shiftKey: false,
    ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...init,
  });
  target.dispatchEvent(e);
  return e;
}

function advance(c: CameraController, frames = 1): void {
  for (let frame = 0; frame < frames; frame++) {
    now += 1000 / 60;
    c.update(1 / 60);
  }
}

describe('emergency camera follow (FEEL-09)', () => {
  it('damps the rendered position with lambda 6 and eases distance to 260 while keeping yaw and base tilt', () => {
    const { controls: c, position } = setup();
    c.setView(1000, 2000, 800, 37, 123);
    const yaw = c.yawAngle, tilt = c.baseTilt;
    position.x += 36;
    position.y = 8;
    position.z += 48;
    c.follow(() => position);
    const e = Math.exp(-6 / 60);
    advance(c);
    expect(c.target.x).toBeCloseTo(position.x - 36 * e, 10);
    expect(c.target.y).toBeCloseTo(position.y * (1 - e), 10);
    expect(c.target.z).toBeCloseTo(position.z - 48 * e, 10);
    expect(c.distance).toBeCloseTo(Math.exp(Math.log(260) + (Math.log(800) - Math.log(260)) * e), 10);
    advance(c, 180);
    expect(c.distance).toBeCloseTo(260, 4);
    expect(c.yawAngle).toBe(yaw);
    expect(c.baseTilt).toBe(tilt);
  });

  it('keeps a straight free-flow road drive at default LIVE speed central with projected steps below 3 px at 60 fps', () => {
    const { controls: c, view, position } = setup();
    // Road speed and LIVE clock match the actual siren time model (16 m / 0.1 min / 1.5 real seconds).
    const metresPerSecond = CELL_SIZE / NET_TIME[2] / EMERG_DAYS_PER_MIN
      / (SECONDS_PER_DAY[1] * DEFAULT_SETTINGS.emergencyLiveSlowmo);
    c.follow(() => position);
    const projected = new THREE.Vector3();
    let prevX = 640, prevY = 360, maxStep = 0;
    for (let frame = 1; frame <= 600; frame++) {
      position.x = 1000 + metresPerSecond * frame / 60;
      advance(c);
      projected.set(position.x, position.y, position.z).project(view);
      const x = (projected.x + 1) * 640, y = (1 - projected.y) * 360;
      maxStep = Math.max(maxStep, Math.hypot(x - prevX, y - prevY));
      expect(Math.abs(projected.x)).toBeLessThan(0.3);
      expect(Math.abs(projected.y)).toBeLessThan(0.3);
      prevX = x;
      prevY = y;
    }
    expect(maxStep).toBeGreaterThan(0.1);
    expect(maxStep).toBeLessThan(3);
  });

  it.each([40, 800, 4000])('reduced motion omits zoom animation from %i m and the target never overshoots', (distance) => {
    const { controls: c, position } = setup(distance);
    position.x += 100;
    position.y = 10;
    position.z += 80;
    c.follow(() => position, { reducedMotion: true });
    expect(c.distance).toBe(260);
    let previous = c.target.clone();
    for (let frame = 0; frame < 180; frame++) {
      advance(c);
      expect(c.distance).toBeCloseTo(260, 10);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(c.target[axis]).toBeGreaterThanOrEqual(previous[axis]);
        expect(c.target[axis]).toBeLessThanOrEqual(position[axis]);
      }
      previous = c.target.clone();
    }
  });

  it('keeps a close skyline tilt while the follow distance increases', () => {
    const { controls: c, position } = setup(40);
    c.setView(1000, 2000, 40, 8, 123);
    const tilt = c.baseTilt;
    c.follow(() => position);
    advance(c, 180);
    expect(c.baseTilt).toBe(tilt);
    expect(c.distance).toBeCloseTo(260, 4);
  });

  it('releases exactly two real seconds after observing on-scene, even when frames are capped or paused', () => {
    const { controls: c, position } = setup();
    const ended = vi.fn();
    c.follow(() => position, { onEnd: ended });
    now = 1000;
    position.onScene = true;
    c.update(1 / 60);
    now = 2999;
    c.update(0);
    expect(c.following).toBe(true);
    expect(ended).not.toHaveBeenCalled();
    now = 3000;
    c.update(1 / 60);
    expect(c.following).toBe(false);
    expect(ended).toHaveBeenCalledExactlyOnceWith();
    advance(c, 60);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('holds the last scene position for the grace period if the unit returns or disappears', () => {
    const { controls: c, position } = setup();
    position.onScene = true;
    let source: CameraFollowPosition | null = position;
    c.follow(() => source);
    c.update(0);
    source = null;
    now = 1999;
    c.update(0.1);
    expect(c.following).toBe(true);
    now = 2000;
    c.update(0.1);
    expect(c.following).toBe(false);
  });

  it('cancels a vanished outbound unit and freezes the displayed target and distance without a residual chase', () => {
    const { controls: c, position } = setup();
    let source: CameraFollowPosition | null = position;
    const ended = vi.fn();
    position.x += 1000;
    c.follow(() => source, { onEnd: ended });
    advance(c);
    const target = c.target.clone(), distance = c.distance;
    source = null;
    advance(c, 180);
    expect(c.following).toBe(false);
    expect(c.target.toArray()).toEqual(target.toArray());
    expect(c.distance).toBeCloseTo(distance, 10);
    expect(ended).toHaveBeenCalledExactlyOnceWith();
  });

  it.each(['query pan', 'middle drag', 'shift-right drag', 'orbit', 'wheel', 'touch', 'key pan', 'key zoom', 'key tilt', 'rotate', 'edge', 'focus', 'setView'])('%s returns camera control immediately', (input) => {
    const { controls: c, dom, position } = setup();
    const ended = vi.fn();
    c.follow(() => position, { onEnd: ended });
    if (input === 'query pan') c.beginPan(640, 360);
    else if (input === 'middle drag') emit(dom, 'pointerdown', { button: 1 });
    else if (input === 'shift-right drag') emit(dom, 'pointerdown', { button: 2, shiftKey: true });
    else if (input === 'orbit') emit(dom, 'pointerdown', { button: 2 });
    else if (input === 'wheel') emit(dom, 'wheel', { deltaY: -20, deltaMode: 0 });
    else if (input === 'touch') emit(dom, 'touchstart', { touches: [{ identifier: 1, clientX: 640, clientY: 360 }] });
    else if (input === 'key pan') emit(window, 'keydown', { code: 'KeyW' });
    else if (input === 'key zoom') emit(window, 'keydown', { code: 'Equal' });
    else if (input === 'key tilt') emit(window, 'keydown', { code: 'PageUp' });
    else if (input === 'rotate') c.rotateStep(1);
    else if (input === 'edge') {
      c.edgeScroll = true;
      emit(dom, 'pointerenter');
      emit(window, 'pointermove', { clientX: 1 });
      advance(c);
    } else if (input === 'focus') c.focusOn(2000, 3000);
    else c.setView(2000, 3000, 800);
    expect(c.following).toBe(false);
    expect(ended).toHaveBeenCalledExactlyOnceWith();
  });

  it('ignores unrelated, consumed, modified and typing keys, and a primary click without a pan', () => {
    const { controls: c, dom, position } = setup();
    c.follow(() => position);
    emit(window, 'keydown', { code: 'Digit2' });
    emit(window, 'keydown', { code: 'Space' });
    emit(window, 'keydown', { code: 'KeyW', ctrlKey: true });
    const e = Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyW' });
    e.preventDefault();
    window.dispatchEvent(e);
    Object.assign(document, { activeElement: { tagName: 'INPUT' } });
    emit(window, 'keydown', { code: 'KeyW' });
    Object.assign(document, { activeElement: null });
    emit(dom, 'pointerdown');
    advance(c);
    expect(c.following).toBe(true);
  });

  it('ends the previous follow when replaced, and disposal releases the new one once', () => {
    const { controls: c, position } = setup();
    const first = vi.fn(), second = vi.fn();
    c.follow(() => position, { onEnd: first });
    c.follow(() => position, { onEnd: second });
    expect(first).toHaveBeenCalledExactlyOnceWith();
    expect(c.following).toBe(true);
    c.dispose();
    c.stopFollowing();
    expect(second).toHaveBeenCalledExactlyOnceWith();
    expect(c.following).toBe(false);
  });
});
