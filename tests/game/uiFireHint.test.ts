/**
 * Final fixes r3 (lane ui): the industrial-accident window read "within 3 days" in the inspector's Fire row hint (its own
 * "…sent within ${EMERG_GRACE.industrial} days…") while the banner counts "3.0 min left to send a truck". The hint now
 * takes that clause from the Fire view's hover sentence (overlays.FIRE_TOO_FAR_TEXT → inspectorModel FIRE_FAR_NOTE →
 * farClause), so it carries no number or unit of its own: when the render-handoff patch switches the hover's unit to
 * emergency minutes, the hover, the inspector note, this hint and the legend change together.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import { FIRE_TOO_FAR_TEXT } from '../../src/sim/infra/overlays';
import { EMERG_GRACE } from '../../src/sim/infra/params';
import type { GameContext } from '../../src/game/context';
import { queryHost } from './queryHost';
import { InfoPanel } from '../../src/ui/panels/InfoPanel';
import { FIRE_FAR_NOTE, farClause, fireResponseHint } from '../../src/ui/inspectorModel';
import { newState, place, roadLine } from '../infra/cityGen';
import { type FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();

describe('the Fire row hint: its industrial-accident clause is the hover\'s', () => {
  it('cut from the hover\'s sentence: the same words, number and unit', () => {
    const clause = farClause(FIRE_FAR_NOTE);
    // (whatever unit the hover uses — days today, emergency minutes after the render-handoff patch)
    expect(clause.startsWith('an industrial accident there is still saved by a fire truck sent within ')).toBe(true);
    expect(clause).toContain(String(EMERG_GRACE.industrial));
    expect(clause).not.toMatch(/build a fire station/);
    expect(FIRE_TOO_FAR_TEXT).toContain(clause.replace(' there ', ' here '));
    const hint = fireResponseHint();
    expect(hint.endsWith(`, but ${clause}`)).toBe(true);
    // nothing of its own: without the clause, no number and no unit
    expect(hint.slice(0, -clause.length)).not.toMatch(/\d|\bdays?\b|\bmin\b/);
  });

  it('the hover in emergency minutes (the render-handoff patch): the hint follows', () => {
    const note = 'An industrial accident here is still saved by a fire truck sent within 3.0 min, however long the drive — build a fire station closer';
    expect(farClause(note)).toBe('an industrial accident there is still saved by a fire truck sent within 3.0 min, however long the drive');
    expect(fireResponseHint(note)).toMatch(/, but an industrial accident there is still saved by a fire truck sent within 3\.0 min, however long the drive$/);
    expect(fireResponseHint(note)).not.toMatch(/days/);
  });

  it('the inspector\'s Fire response row carries that hint (InfoPanel, Environment section)', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 61, 20, Network.Road);
    const home = place(st, 't_r2', 30, 21, { pop: 20, flags: BF.Powered });
    const sim = new Simulation(st, createSystems());
    const ctx = {
      host: queryHost(sim), signal: new AbortController().signal,
      get state() { return sim.state; }, sim, mods: {}, actions: { bulldoze: () => ({ ok: true, cost: 0 }) }, objects: { setSelected: () => undefined },
      panels: { close: () => undefined }, sandbox: () => false, sound: () => undefined, toast: () => undefined,
    } as unknown as GameContext;
    const panel = new InfoPanel(ctx);
    panel.mount(() => undefined, () => undefined, () => undefined);
    panel.show({ buildingId: home.id, x: home.x, z: home.z });
    const body = panel.body as unknown as FEl;
    const env = body.querySelectorAll('button.ins-sec-h').find((b) => textOf(b).startsWith('Environment'))!;
    expect(env).toBeDefined();
    env.click();
    const row = body.querySelectorAll('span').find((s) => textOf(s) === 'Fire response');
    expect(row, 'the Fire response row').toBeDefined();
    expect(row!.title).toBe(fireResponseHint());
  });
});
