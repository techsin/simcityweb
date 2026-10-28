/** §5.3: every declared synchronous read, at ten checkpoints on both city sizes. */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEV_TYPE_COUNT, Network, Overlay, Zone } from '../../src/core/types';
import { CityActions } from '../../src/sim/actions';
import type { CityState } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { approvalBreakdown } from '../../src/sim/economy/approval';
import { demandInfo, econData, infraFlags, listOrdinances, listRewards, loanOffer, maxLoanAmount, onStrike, serviceEffectiveness } from '../../src/sim/economy';
import { ORDINANCES } from '../../src/sim/economy/ordinances';
import { windVector } from '../../src/sim/infra/wind';
import { overlayLayer, overlayReadout, overlayVariantCount } from '../../src/sim/infra/overlays';
import { emptyZoneStatus, utilityReaches } from '../../src/ui/zoneStatus';
import { cityFingerprint } from '../../src/save/fingerprint';
import { LoopbackCore, SeededLag } from '../../src/worker/loopbackCore';
import { viewLayers, workerRaster } from '../../src/worker/recorder';
import { exactDigest } from '../../src/worker/queries';
import { REPLICA_SAFE } from '../../src/worker/replicaSafe';
import { grownFixture, loadFixture } from '../../tools/bench/worker/fixtures';
import { newState, stressCity } from '../infra/cityGen';

const fail = (): never => { throw new Error('Preview used simulation internals'); };
function previews(st: CityState): CityActions {
  return new CityActions({ state: st, get rng() { return fail(); }, get events() { return fail(); }, notify: fail, getSystem: fail } as unknown as Simulation);
}
/** The base has no policy preview flag: run its real validation on a private budget/funds copy. */
function policyPreview(st: CityState): CityActions {
  const copy = Object.assign(Object.create(st) as CityState, { budget: structuredClone(st.budget), funds: st.funds });
  return new CityActions({ state: copy, get rng() { return fail(); }, get events() { return fail(); }, notify: fail, getSystem: () => undefined } as unknown as Simulation);
}

describe('REPLICA_SAFE', () => {
  it('documents the inherited emptyZoneStatus subscription requirement', () => {
    const st = newState(16), x = 4, z = 4;
    st.zone[st.idx(x, z)] = Zone.ResLow; st.stats.demand.fill(1);
    for (const a of st.desirability) a.fill(-1);
    const loop = new LoopbackCore(st, { modules: {} });
    try {
      // desirability and land value are saved layers, so Ready carries them; a silent write on the authoritative side
      // after Ready (as the systems' band writes are) leaves the replica's copy behind until the views are subscribed
      for (const a of loop.primary.desirability) a.fill(1);
      expect(emptyZoneStatus(loop.state, x, z)).not.toEqual(emptyZoneStatus(loop.primary, x, z));
      for (let variant = 0; variant < DEV_TYPE_COUNT; variant++) {
        loop.setView({ overlay: Overlay.Desirability, variant, panels: [], focus: [] }); loop.flush(true);
      }
      loop.setView({ overlay: Overlay.LandValue, variant: 0, panels: [], focus: [] }); loop.flush(true);
      expect(emptyZoneStatus(loop.state, x, z)).toEqual(emptyZoneStatus(loop.primary, x, z));
    } finally { loop.dispose(); }
  });
  for (const [name, create, present] of [
    ['generated 128²', () => stressCity(128).st, true],
    ['grown fixture', () => loadFixture(grownFixture()), existsSync(grownFixture())],
  ] as const) it.skipIf(!present)(`${name}: all reads and random previews agree at ten checkpoints across 120 days`, { timeout: 300000 }, () => {
    const loop = new LoopbackCore(create()), seen = new Set<string>();
    const rng = new SeededLag({ seed: 32 });
    const compare = (name: typeof REPLICA_SAFE[number], fn: (st: CityState) => unknown, detail = '') => {
      seen.add(name);
      // against the authoritative state as delivered: a utilities pass in flight has written powered / watered
      // without announcing them yet (F6), so the replica holds the last sent copies
      expect(fn(loop.state), `${name}${detail}, day ${loop.primary.day}`).toEqual(fn(loop.delivered));
    };
    try {
      for (let checkpoint = 0; checkpoint < 10; checkpoint++) {
        loop.runDays(12); loop.forceRollingRound();
        // emptyZoneStatus reads all desirability variants plus land value (see report).
        const views: [Overlay, number][] = [];
        for (const overlay of Object.values(Overlay).filter((o): o is Overlay => typeof o === 'number')) {
          for (let variant = 0; variant < overlayVariantCount(overlay); variant++) {
            const view = { overlay, variant, panels: [], focus: [] };
            if (!workerRaster(view) && viewLayers(view).length && overlay !== Overlay.Nimby && overlay !== Overlay.Emergency) views.push([overlay, variant]);
          }
        }
        for (const [overlay, variant] of views) { loop.setView({ overlay, variant, panels: [], focus: [] }); loop.flush(true); }
        const before = exactDigest(loop.state), liveBefore = exactDigest(loop.primary), simRng = loop.core.sim.rng.state;
        compare('listRewards', listRewards); compare('listOrdinances', listOrdinances);
        compare('maxLoanAmount', maxLoanAmount);
        // approvalBreakdown is not replica-safe: its detail lines read approval.ts's survey WeakMap, which only the
        // authoritative residentSurvey fills (see replicaSafe.ts); its terms and values are compared here
        expect(approvalBreakdown(loop.state).map(({ id, value }) => [id, value]), `approvalBreakdown terms, day ${loop.primary.day}`)
          .toEqual(approvalBreakdown(loop.primary).map(({ id, value }) => [id, value]));
        compare('regionTerms', (s) => econData(s).regionTerms); compare('demandInfo', demandInfo);
        compare('infraFlags', infraFlags); compare('windVector', windVector); compare('cityFingerprint', cityFingerprint);
        for (const service of ['education', 'health', 'fire', 'police', 'parks', 'transit', 'utilities'] as const) {
          compare('serviceEffectiveness', (s) => serviceEffectiveness(s, service)); compare('onStrike', (s) => onStrike(s, service));
        }
        for (const amount of [0, 1000, 10000, maxLoanAmount(loop.primary), maxLoanAmount(loop.primary) + 1000]) {
          compare('loanOffer', (s) => loanOffer(s, amount)); compare('takeLoan', (s) => policyPreview(s).takeLoan(amount));
        }
        for (let i = -1; i <= loop.primary.budget.loans.length; i++) compare('repayLoan', (s) => policyPreview(s).repayLoan(i));
        for (const o of ORDINANCES) for (const enabled of [false, true]) for (const confirm of [false, true]) {
          compare('setOrdinance', (s) => policyPreview(s).setOrdinance(o.id, enabled, { confirm }));
        }
        for (let sample = 0; sample < 20; sample++) {
          const x = Math.floor(rng.random() * (loop.state.size - 5)), z = Math.floor(rng.random() * (loop.state.size - 5));
          const rect = { x0: x, z0: z, x1: x + 1 + sample % 4, z1: z + 1 + sample % 3 };
          const path = Array.from({ length: 1 + sample % 5 }, (_, i) => ({ x: x + i, z }));
          compare('emptyZoneStatus', (s) => emptyZoneStatus(s, x, z));
          compare('utilityReaches', (s) => [utilityReaches(s, s.powered, s.idx(x, z), 'power'), utilityReaches(s, s.watered, s.idx(x, z), 'water')]);
          compare('zone', (s) => previews(s).zone(rect, Zone.ResLow, true));
          compare('dezone', (s) => previews(s).dezone(rect, true));
          compare('bulldoze', (s) => previews(s).bulldoze(rect, true));
          compare('buildNetwork', (s) => previews(s).buildNetwork(path, sample % 2 ? Network.Road : Network.Rail, true));
          compare('buildPowerLine', (s) => previews(s).buildPowerLine(path, true));
          compare('buildSubway', (s) => previews(s).buildSubway(path, true));
          compare('plop', (s) => previews(s).plop(sample % 2 ? 'park_small' : 'civ_elementary_school', x, z, (sample % 4) as 0 | 1 | 2 | 3, true));
          compare('terraform', (s) => previews(s).terraform((['raise', 'lower', 'level', 'smooth'] as const)[sample % 4], x, z, 2, 0.5, true));
          compare('plantTrees', (s) => previews(s).plantTrees(rect, true));
        }
        for (const [overlay, variant] of [[Overlay.Power, 0], [Overlay.Traffic, 0], ...views]) {
          compare('overlayLayer', (s) => overlayLayer(s, overlay, variant), ` ${Overlay[overlay]}:${variant}`);
          compare('overlayReadout', (s) => overlayReadout(s, overlay, 5, 5, variant), ` ${Overlay[overlay]}:${variant}`);
        }
        expect(exactDigest(loop.state)).toBe(before); expect(exactDigest(loop.primary)).toBe(liveBefore);
        expect(loop.core.sim.rng.state).toBe(simRng);
      }
      expect([...seen].sort()).toEqual([...REPLICA_SAFE].sort());
    } finally { loop.dispose(); }
  });
});
