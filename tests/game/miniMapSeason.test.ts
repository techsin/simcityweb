/**
 * FEEL-05: the minimap follows the season. Natural land blends toward the renderer's dry-foliage hue by uFoliageDry (set
 * from the month by setFoliageSeason), through a land mask composited at draw time: a month changes one draw, and no
 * month tick repaints the base (paintBase's cell loop).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Network, Overlay, Zone } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import { Simulation } from '../../src/sim/Simulation';
import { MiniMap } from '../../src/ui/MiniMap';
import { setFoliageSeason, sharedUniforms } from '../../src/assets/materials';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();
afterEach(() => {
  vi.restoreAllMocks();
  sharedUniforms.uFoliageDry.value = 0;
});

interface Draw { src: unknown; op: string; alpha: number }

function fixture(size = 16) {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const puts: { ctx: number; data: Uint8ClampedArray }[] = [], draws: Draw[] = [];
  const canvases: Canvas[] = [];
  const makeCtx = (id: number) => {
    const g = {
      globalCompositeOperation: 'source-over', globalAlpha: 1, stack: [] as [string, number][],
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img: ImageData) => puts.push({ ctx: id, data: img.data.slice() }),
      drawImage: (src: unknown) => draws.push({ src, op: g.globalCompositeOperation, alpha: g.globalAlpha }),
      save() { g.stack.push([g.globalCompositeOperation, g.globalAlpha]); },
      restore() { const t = g.stack.pop(); if (t) [g.globalCompositeOperation, g.globalAlpha] = t; },
      clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}, arc() {},
    };
    return g;
  };
  class Canvas extends FEl {
    width = 300;
    height = 150;
    g = makeCtx(canvases.length);
    getContext() { return this.g; }
    getBoundingClientRect() { throw new Error('layout read in a frame'); }
    override setAttribute(k: string, v: string): void {
      super.setAttribute(k, v);
      if (k === 'width') this.width = +v;
      if (k === 'height') this.height = +v;
    }
  }
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return new FEl(tag);
    const c = new Canvas(tag);
    canvases.push(c);
    return c;
  }) as typeof document.createElement);
  const st = newState(size);
  // a little town on natural ground: a road, a zone, the rest grass at 5 m
  st.heights.fill(5);
  for (let x = 0; x < size; x++) st.network[st.idx(x, 4)] = Network.Road;
  st.zone[st.idx(3, 5)] = Zone.ResLow;
  const sim = new Simulation(st, []), abort = new AbortController();
  const camera = new THREE.PerspectiveCamera(45, 1.5, 1, 10000);
  const target = new THREE.Vector3(128, 0, 128);
  camera.position.set(128, 800, 900);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  const ctx = { get state() { return sim.state; }, sim, signal: abort.signal, overlay: Overlay.None, world: { camera, controls: { target } }, sound() {} } as unknown as GameContext;
  const paint = vi.spyOn(MiniMap.prototype as unknown as { paintBase(): boolean }, 'paintBase');
  const map = new MiniMap(ctx, new FEl('div') as unknown as HTMLElement);
  const frame = (dt: number) => { now += dt * 1000; return map.frame(dt); };
  // canvases: [0] the visible map, [1] the cached base, [2] the season mask
  return { map, sim, st, abort, puts, draws, canvases, paint, frame };
}

/** the season layer's draws onto the visible map (the mask, composited with 'color') */
const seasonDraws = (f: ReturnType<typeof fixture>) => f.draws.filter((d) => d.src === f.canvases[2]);

describe('FEEL-05: a seasonal minimap', () => {
  it('January and July differ: winter blends the land toward straw, summer leaves the base as painted', () => {
    const f = fixture();
    setFoliageSeason(6, 'temperate');
    f.frame(0); f.frame(0.2);
    expect(f.draws.length).toBeGreaterThan(0);
    expect(seasonDraws(f)).toEqual([]);
    setFoliageSeason(0, 'temperate');
    f.frame(0.2);
    const winter = seasonDraws(f);
    expect(winter).toHaveLength(1);
    expect(winter[0].op).toBe('color');
    expect(winter[0].alpha).toBeCloseTo(sharedUniforms.uFoliageDry.value);
    expect(winter[0].alpha).toBeGreaterThan(0.5);
    f.abort.abort('dispose'); f.map.dispose();
  });

  it('the mask covers natural ground only (not roads, zones, water, beach or snow), in the dry-foliage hue', () => {
    const f = fixture();
    const st = f.st;
    st.water[st.idx(8, 8)] = 1;
    setFoliageSeason(0, 'temperate');
    f.frame(0); f.frame(0.2);
    const mask = f.puts.find((p) => p.ctx === 2)!.data;
    const a = (x: number, z: number) => mask[st.idx(x, z) * 4 + 3];
    expect(a(10, 10)).toBe(255);
    expect(a(2, 4)).toBe(0); // road
    expect(a(3, 5)).toBe(0); // zoned lot
    expect(a(8, 8)).toBe(0); // water
    expect([...mask.slice(st.idx(10, 10) * 4, st.idx(10, 10) * 4 + 3)]).toEqual([255, 220, 147]);
    f.abort.abort('dispose'); f.map.dispose();
  });

  it('a month tick adds no paintBase call: twelve months of seasons redraw, never repaint', () => {
    const f = fixture();
    setFoliageSeason(3, 'temperate');
    for (let i = 0; i < 10; i++) f.frame(0.2);
    const paints = f.paint.mock.calls.length, draws = f.draws.length, puts = f.puts.length;
    expect(paints).toBeGreaterThan(0);
    for (let m = 4; m < 16; m++) {
      setFoliageSeason(m, 'temperate');
      f.st.day = m * 30;
      f.sim.events.emit('month', m);
      for (let i = 0; i < 10; i++) f.frame(0.2);
    }
    expect(f.paint.mock.calls.length).toBe(paints);
    expect(f.draws.length).toBeGreaterThan(draws);
    // the mask is uploaded once (the first dry month), then only composited
    expect(f.puts.filter((p) => p.ctx === 2)).toHaveLength(1);
    expect(f.puts.length).toBe(puts + 1);
    f.abort.abort('dispose'); f.map.dispose();
  });
});
