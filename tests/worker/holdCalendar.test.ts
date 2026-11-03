/** NOTE-041: the New Year date hold is a host command, so every host's clock holds the same way (a main-thread write
 *  into `sim` never reaches a worker's clock). */
import { describe, expect, it } from 'vitest';
import { LocalSimHost } from '../../src/worker/SimHost';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { newState } from '../infra/cityGen';

describe('holdCalendar (NOTE-041)', () => {
  it('LocalSimHost: no day passes while held, the cap comes back on release, and both directions are idempotent', async () => {
    const st = newState(16), host = new LocalSimHost(st, { initialSpeed: 3 });
    await host.start();
    try {
      const cap = host.sim.maxDaysPerFrame, day = st.day;
      host.act('holdCalendar', [true]); host.act('holdCalendar', [true]);
      for (let i = 0; i < 20; i++) host.frame(0.25);
      expect(st.day).toBe(day);
      expect(host.speed).toBe(3); // the player's speed is untouched
      host.act('holdCalendar', [false]); host.act('holdCalendar', [false]);
      expect(host.sim.maxDaysPerFrame).toBe(cap);
      for (let i = 0; i < 20; i++) host.frame(0.25);
      expect(st.day).toBeGreaterThan(day);
    } finally { await host.dispose(); }
  });

  it('LoopbackSimHost: the core holds, and the replica\'s clock with it', async () => {
    const host = new LoopbackSimHost(newState(16), { initialSpeed: 3 });
    await host.start();
    try {
      const core = host.harness, day = core.primary.day;
      host.act('holdCalendar', [true]);
      for (let i = 0; i < 20; i++) host.frame(0.25);
      await host.drain();
      expect(core.primary.day).toBe(day); expect(host.state.day).toBe(day);
      host.act('holdCalendar', [false]);
      for (let i = 0; i < 20; i++) host.frame(0.25);
      await host.drain();
      expect(core.primary.day).toBeGreaterThan(day); expect(host.state.day).toBe(core.primary.day);
    } finally { await host.dispose(); }
  });
});
