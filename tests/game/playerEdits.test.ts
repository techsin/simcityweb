/**
 * WP5 review round 2: the Advisors panel runs a fresh openAdvice scan after the player's own edits only — the city's
 * growth (grown buildings, lot grading, trees) changes buildings every day and must not count (playerEditCounter).
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { lPath } from '../../src/sim/actions';
import { playerEditCounter } from '../../src/ui/playerEdits';
import { makeCity, road } from '../sim/helpers';

describe('playerEditCounter (Advisors panel refresh)', () => {
  it('counts zoning, roads, power lines and plopped buildings — not the buildings the city grows', () => {
    const { st, sim, A } = makeCity({ size: 64 });
    st.funds = 1e7;
    const edits = playerEditCounter(sim);
    expect(edits.count).toBe(0);
    road(A, 0, 31, 63, 31, Network.Avenue);
    for (let x = 4; x <= 58; x += 9) road(A, x, 4, x, 58);
    const afterRoads = edits.count;
    expect(afterRoads).toBeGreaterThan(0);
    A.zone({ x0: 5, z0: 5, x1: 30, z1: 30 }, Zone.ResLow);
    A.zone({ x0: 32, z0: 5, x1: 58, z1: 30 }, Zone.ComMed);
    expect(edits.count).toBe(afterRoads + 2);
    // a preview is not an edit
    A.zone({ x0: 5, z0: 33, x1: 20, z1: 40 }, Zone.ResLow, true);
    expect(edits.count).toBe(afterRoads + 2);
    // growth: many buildings added (and some replaced) over 90 days, no edit
    const before = edits.count, ids = st.nextBuildingId;
    sim.runDays(90);
    expect(st.nextBuildingId - ids).toBeGreaterThan(20);
    expect(edits.count).toBe(before);
    // plop + bulldoze a plopped building, a power line
    expect(A.plop('park_small', 10, 32, 0).ok).toBe(true);
    expect(edits.count).toBe(before + 1);
    expect(A.buildPowerLine(lPath({ x: 40, z: 40 }, { x: 50, z: 40 })).ok).toBe(true);
    expect(edits.count).toBe(before + 2);
    expect(A.bulldoze({ x0: 10, z0: 32, x1: 11, z1: 33 }).ok).toBe(true);
    expect(edits.count).toBeGreaterThanOrEqual(before + 3);
    edits.dispose();
    const n = edits.count;
    A.zone({ x0: 5, z0: 33, x1: 20, z1: 40 }, Zone.ResLow);
    expect(edits.count).toBe(n);
  });
});
