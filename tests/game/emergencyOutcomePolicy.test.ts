/** The real LIVE policy restores speed before firefighters finish extinguishing the incident. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { Network } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import { GameSounds } from '../../src/game/GameSounds';
import { FOLLOW_GRACE } from '../../src/game/emergencyPolicy';
import { getFire } from '../../src/sim/systems/infra';
import { EmergencyBanner } from '../../src/ui/EmergencyBanner';
import { setGuideTips } from '../../src/ui/guide/tips';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState, place, roadLine } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();

describe('emergency outcome through the LIVE policy', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    setGuideTips(false);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('restores after arrival, then resolves with exactly one saved sting and no good chime', async () => {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    place(st, 't_fire', 4, 19);
    const factory = place(st, 't_im', 46, 21, { jobs: 150 });
    st.stats.population = 5000;
    const host = new LocalSimHost(st, { initialSpeed: 3 }), abort = new AbortController();
    await host.start();
    getFire(host.sim)!.riskBoost = 0;
    const ui = new Emitter<UIEvents>(), root = new FEl('div');
    const plays: string[] = [], stages: string[] = [];
    const sound = (name: string) => { plays.push(name); };
    const sounds = new GameSounds({ sim: host.sim, host, signal: abort.signal, sound, world: () => ({ camera: null }) as never, sandbox: () => true });
    const toast = vi.fn((_text: string, kind?: string, _cell?: unknown, _title?: string, opts?: { silent?: boolean }) => {
      stages.push('restore');
      if (!opts?.silent) sound(kind === 'good' ? 'good' : 'notify');
    });
    const ctx = {
      host, state: st, ui, root, signal: abort.signal, sound, toast,
      settings: { emergencyUncovered: 'live', emergencyLiveSlowmo: 3, emergencyAlerts: 'major' },
      panels: { isOpen: () => false, open() {} },
    } as unknown as GameContext;
    const banner = new EmergencyBanner(ctx, root as unknown as HTMLElement);
    const tick = () => { host.frame(0); ui.emit('uiTick', undefined); };
    let restoredWhileOnScene = false;
    const off = host.events.on('emergency', (e) => {
      if (e.type === 'arrived' || e.type === 'resolved') stages.push(e.type);
    });
    try {
      expect(host.act('triggerDisaster', ['fire', factory.x, factory.z], { tag: {} }).predicted).toBe(true);
      const inc = host.emergency.incidents()[0];
      expect(inc.state).toBe('uncovered');
      expect(inc.manualPossible).toBe(true);
      tick();
      expect(host.policy.alerts.map((alert) => alert.id)).toContain(inc.id);
      expect(host.policy.live).toBe(true);
      expect(host.act('dispatchBest', [inc.id], { tag: {} }).predicted?.ok).toBe(true);
      expect(inc.answered).toBe(2);
      expect(inc.state).toBe('dispatched');
      for (let day = 0; day < 20 && host.emergency.incident(inc.id); day++) {
        host.sim.runDays(1);
        tick();
        if (toast.mock.calls.length && !restoredWhileOnScene) {
          expect(host.policy.live).toBe(false);
          expect(host.speed).toBe(3);
          expect(inc.state).toBe('onScene');
          expect(host.simTime() - inc.firstAt.fire!).toBeGreaterThanOrEqual(FOLLOW_GRACE);
          expect(plays).not.toContain('saved');
          restoredWhileOnScene = true;
        }
      }
      expect(restoredWhileOnScene).toBe(true);
      expect(stages).toEqual(['arrived', 'restore', 'resolved']);
      expect(inc.state).toBe('resolved');
      expect(inc.lost).toBe(0);
      expect(inc.deaths).toBe(0);
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith('Emergencies handled — back to ultra speed', 'good', undefined, 'Emergency', { silent: true });
      vi.advanceTimersByTime(500);
      expect(plays.filter((name) => name === 'saved' || name === 'lost' || name === 'good')).toEqual(['saved']);
    } finally {
      off(); abort.abort(); sounds.dispose(); banner.dispose(); await host.dispose();
    }
  });
});
