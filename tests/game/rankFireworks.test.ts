import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Emitter } from '../../src/core/events';
import type { GameContext } from '../../src/game/context';
import { NewYearCelebration } from '../../src/game/NewYear';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import { Fireworks, type FireworksStartOptions } from '../../src/render/city/effects/Fireworks';
import { CITY_RANKS } from '../../src/sim/economy/rewards';
import { RankFireworks } from '../../src/ui/rankFireworks';
import { newState } from '../infra/cityGen';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderer() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(300, 400, 600);
  const fw = new Fireworks({ camera, mapSize: 1024, getSites: () => [{ x: 512, y: 0, z: 512, kind: 'centre', weight: 1 }], groundAt: () => 0, quality: 'low' });
  cleanups.push(() => fw.dispose());
  return fw;
}

function setup(population = 0) {
  const state = newState(16), signal = new AbortController();
  state.stats.population = population;
  const events = new Emitter<Record<string, unknown>>(), ui = new Emitter<Record<string, unknown>>();
  const fw = { isRankBurst: false, start: vi.fn((_opts: FireworksStartOptions) => { fw.isRankBurst = true; }), stop: vi.fn(() => { fw.isRankBurst = false; }) };
  const host = { events, policy: { live: false } };
  const ctx = { state, signal: signal.signal, host, ui, settings: { ...DEFAULT_SETTINGS }, objects: { fireworks: fw } } as unknown as GameContext;
  let busy = false;
  const bursts = new RankFireworks(ctx, () => busy);
  cleanups.push(() => signal.abort());
  const start = (tier: number) => bursts.start(CITY_RANKS[tier], tier / (CITY_RANKS.length - 1));
  return { state, signal, host, ctx, fw, events, ui, bursts, start, busy: (on: boolean) => { busy = on; } };
}

describe('rank fireworks gating', () => {
  it('passes a deterministic seed and tier intensity, and starts at most once per rank', () => {
    const t = setup();
    t.start(1);
    t.start(1);
    t.start(2);
    t.start(1);
    expect(t.fw.start).toHaveBeenCalledTimes(2);
    expect(t.fw.start.mock.calls.map(([opts]) => [opts.population, opts.intensity])).toEqual([[1000, 1 / 11], [5000, 2 / 11]]);
    expect(t.fw.start).toHaveBeenLastCalledWith({ population: 5000, intensity: 2 / 11, duration: 8, rankBurst: true, seed: t.state.config.seed ^ 5000 });
  });

  it('skips the reached rank while New Year or LIVE is busy, then permits a later rank', () => {
    const t = setup();
    t.busy(true);
    t.start(1);
    t.busy(false);
    t.start(1);
    t.host.policy.live = true;
    t.start(2);
    t.host.policy.live = false;
    t.start(2);
    expect(t.fw.start).not.toHaveBeenCalled();
    t.start(3);
    expect(t.fw.start).toHaveBeenCalledTimes(1);
  });

  it.each(['reduced', 'system'] as const)('skips a rank when motion resolves to reduced (%s), without replaying it later', (motion) => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const t = setup();
    t.ctx.settings.motion = motion;
    t.start(1);
    t.ctx.settings.motion = 'full';
    t.start(1);
    expect(t.fw.start).not.toHaveBeenCalled();
    t.start(2);
    expect(t.fw.start).toHaveBeenCalledTimes(1);
  });

  it('honours full motion over the device preference and follows a full system preference', () => {
    let reduced = true;
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })));
    const t = setup();
    t.ctx.settings.motion = 'full';
    t.start(1);
    t.ctx.settings.motion = 'system';
    reduced = false;
    t.start(2);
    expect(t.fw.start).toHaveBeenCalledTimes(2);
  });

  it('cancels its burst when motion becomes reduced without stopping a New Year takeover', () => {
    let reduced = false;
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })));
    const t = setup();
    t.ctx.settings.motion = 'system';
    t.start(1);
    reduced = true;
    t.ui.emit('uiTick', undefined);
    expect(t.fw.stop).toHaveBeenCalledTimes(1);
    reduced = false;
    t.start(2);
    t.fw.isRankBurst = false;
    t.ctx.settings.motion = 'reduced';
    t.ui.emit('uiTick', undefined);
    t.signal.abort();
    expect(t.fw.stop).toHaveBeenCalledTimes(1);
  });

  it('initializes existing ranks silently and cancels a burst on reset and disposal', () => {
    const t = setup(300000);
    t.start(7);
    expect(t.fw.start).not.toHaveBeenCalled();
    t.start(8);
    t.state.stats.population = 750000;
    t.events.emit('reset', undefined);
    expect(t.fw.stop).toHaveBeenCalledTimes(1);
    t.start(9);
    expect(t.fw.start).toHaveBeenCalledTimes(1);
    t.start(10);
    t.signal.abort();
    expect(t.fw.stop).toHaveBeenCalledTimes(2);
    t.start(11);
    expect(t.fw.start).toHaveBeenCalledTimes(2);
  });

  it('clears a rank burst when LIVE begins, without stopping a New Year takeover', () => {
    const t = setup();
    t.start(1);
    t.host.policy.live = true;
    t.ui.emit('uiTick', undefined);
    expect(t.fw.stop).toHaveBeenCalledTimes(1);
    t.host.policy.live = false;
    t.start(2);
    t.fw.isRankBurst = false;
    t.host.policy.live = true;
    t.ui.emit('uiTick', undefined);
    t.signal.abort();
    expect(t.fw.stop).toHaveBeenCalledTimes(1);
  });
});

describe('bounded rank bursts in the shared renderer', () => {
  it.each([6, 8, 10])('includes all sparks and smoke in a %i second rank moment', (duration) => {
    const fw = renderer();
    fw.start({ population: 10000, intensity: 3 / 11, duration, rankBurst: true, seed: 7 });
    fw.update(1 / 30);
    expect(fw.liveCount).toBeGreaterThan(0);
    expect(fw.isRankBurst).toBe(true);
    fw.fastForward(duration - 0.1 - 1 / 30);
    expect(fw.active).toBe(true);
    fw.fastForward(0.2);
    expect(fw.active).toBe(false);
    expect(fw.liveCount).toBe(0);
    expect(fw.drawCalls).toBe(0);
  });

  it('lets New Year take over a rank burst without its short deadline ending the full show', () => {
    const fw = renderer();
    fw.start({ population: 10000, intensity: 3 / 11, duration: 8, rankBurst: true, seed: 7 });
    fw.fastForward(3);
    fw.start({ population: 10000, duration: 20, seed: 7 });
    expect(fw.isRankBurst).toBe(false);
    expect(fw.isRunning).toBe(true);
    fw.fastForward(8);
    expect(fw.active).toBe(true);
    expect(fw.isRunning).toBe(true);
  });

  it('ends after eight real seconds even when sparse frames or a paused renderer advance little show time', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const fw = renderer();
    fw.start({ population: 10000, duration: 8, rankBurst: true, seed: 7 });
    now += 4000;
    fw.update(0.1);
    expect(fw.active).toBe(true);
    fw.timeScale = 0;
    now += 4000;
    fw.update(0.1);
    expect(fw.active).toBe(false);
    expect(fw.drawCalls).toBe(0);
  });

  it('does not make an idle New Year controller busy through its retained renderer reference', () => {
    const fw = renderer(), state = newState(16), events = new Emitter<Record<string, unknown>>();
    state.stats.population = 10000;
    const ny = new NewYearCelebration({
      sim: { state, events } as unknown as GameContext['sim'], world: () => ({}) as GameContext['world'],
      objects: () => ({ fireworks: fw }) as unknown as GameContext['objects'], settings: () => DEFAULT_SETTINGS,
      toast: () => {},
    });
    cleanups.push(() => ny.dispose());
    ny.celebrate({ mode: 'fireworks', duration: 6, quiet: true, seed: 7 });
    ny.cancel();
    expect(ny.busy).toBe(false);
    fw.start({ population: 10000, duration: 8, rankBurst: true, seed: 7 });
    expect(fw.active).toBe(true);
    expect(ny.busy).toBe(false);
    expect(ny.celebrate({ mode: 'fireworks', duration: 20, quiet: true, seed: 7 })).toBe(true);
    expect(ny.busy).toBe(true);
    fw.fastForward(9);
    expect(fw.active).toBe(true);
  });
});
