import { describe, expect, it } from 'vitest';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { loanOffer, maxLoanAmount } from '../../src/sim/economy/loans';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import { exactDigest } from '../../src/worker/queries';

function city(day: number, foundedDay?: number): CityState {
  const st = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', difficulty: 'expert', disasters: false }));
  st.day = day;
  if (foundedDay !== undefined) st.systemData.foundedDay = foundedDay;
  return st;
}

function expectLoanParity(loop: LoopbackCore, allowed: boolean): void {
  expect(loanOffer(loop.primary, 5000).ok).toBe(allowed);
  expect(loanOffer(loop.state, 5000)).toEqual(loanOffer(loop.primary, 5000));
  expect(maxLoanAmount(loop.state)).toBe(maxLoanAmount(loop.primary));
  expect(exactDigest(loop.state)).toBe(exactDigest(loop.primary));
}

describe('LG-09 Expert loan authority/replica parity', () => {
  it('keeps the authoritative cutoff at foundedDay plus five years', () => {
    const st = city(1889, 90);
    expect(loanOffer(st, 5000).ok).toBe(true);
    expect(maxLoanAmount(st)).toBeGreaterThan(0);
    st.day = 1890;
    expect(loanOffer(st, 5000)).toMatchObject({ ok: false, maxAmount: 0 });
    expect(maxLoanAmount(st)).toBe(0);
  });

  it('uses foundedDay from Ready across the day-zero and spring-start cutoff boundaries', () => {
    const loop = new LoopbackCore(city(1798, 90), { modules: {} });
    try {
      expect(loop.state.systemData.foundedDay).toBe(90);
      expectLoanParity(loop, true);
      for (const day of [1799, 1800, 1801, 1889, 1890, 1891]) {
        loop.primary.day = day;
        const packet = loop.flush(true);
        expect(packet?.clock.day).toBe(day);
        expect(loop.state.day).toBe(day);
        expectLoanParity(loop, day < 1890);
      }
    } finally { loop.dispose(); }
  });

  it('uses foundedDay changes delivered in an end-packet patch', () => {
    const loop = new LoopbackCore(city(1889), { modules: {} });
    try {
      expectLoanParity(loop, false);
      loop.primary.systemData.foundedDay = 90;
      expect(loop.flush(true)?.plain?.sys).toHaveProperty('foundedDay', 90);
      expect(loop.state.systemData.foundedDay).toBe(90);
      expectLoanParity(loop, true);

      loop.primary.systemData.foundedDay = 0;
      expect(loop.flush(true)?.plain?.sys).toHaveProperty('foundedDay', 0);
      expect(loop.state.systemData.foundedDay).toBe(0);
      expectLoanParity(loop, false);

      delete loop.primary.systemData.foundedDay;
      expect(loop.flush(true)?.plain?.sys).toHaveProperty('foundedDay', undefined);
      expect(loop.state.systemData).not.toHaveProperty('foundedDay');
      expectLoanParity(loop, false);
    } finally { loop.dispose(); }
  });

  it('keeps the day-zero legacy fallback identical when both states lack foundedDay', () => {
    const loop = new LoopbackCore(city(1798), { modules: {} });
    try {
      expect(loop.state.systemData).not.toHaveProperty('foundedDay');
      expectLoanParity(loop, true);
      for (const day of [1799, 1800]) {
        loop.primary.day = day;
        const packet = loop.flush(true);
        expect(packet?.clock.day).toBe(day);
        expectLoanParity(loop, day < 1800);
      }
    } finally { loop.dispose(); }
  });
});
