/** Toolbar half of the GUIDE coach contract; split TopBar wiring remains with T037b. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext } from '../../src/game/context';
import { Toolbar } from '../../src/ui/Toolbar';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';

vi.mock('../../src/ui/thumbs', () => ({ thumbs: { cached: () => null } }));
installFakeDom();
const proto = FEl.prototype as unknown as { getBoundingClientRect?: () => DOMRect };
let hadRect: typeof proto.getBoundingClientRect;
beforeAll(() => {
  hadRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
});
afterAll(() => { proto.getBoundingClientRect = hadRect; });

it('pulses only exact tool ids across flyout/tab rebuilds and clears without changing category marks', () => {
  const abort = new AbortController();
  const ctx = {
    state: newState(32), signal: abort.signal, ui: new Emitter(), mods: {},
    tools: { activeId: null, select: () => true }, panels: { isOpen: () => false },
    overlay: 0, sandbox: () => false, sound: () => {},
  } as unknown as GameContext;
  const parent = document.createElement('div'), toolbar = new Toolbar(ctx, parent), root = parent as unknown as FEl;
  toolbar.setCoach(['utilities']);
  toolbar.setCoachItems(['plop:util_wind_turbine']);
  toolbar.openFlyout('utilities', 'Power');
  const coached = () => root.querySelectorAll('.fly-item.coach').map((e) => e.dataset.toolId);
  expect(coached()).toEqual(['plop:util_wind_turbine']);
  toolbar.openFlyout('utilities', 'Water');
  expect(coached()).toEqual([]);
  toolbar.openFlyout('utilities', 'Power');
  expect(coached()).toEqual(['plop:util_wind_turbine']);
  toolbar.setCoachItems(['plop:util_gas_plant']);
  expect(coached()).toEqual(['plop:util_gas_plant']);
  toolbar.setCoachItems([]);
  expect(coached()).toEqual([]);
  expect(root.querySelectorAll('.tb-btn.coach')).toHaveLength(1);
  abort.abort();
});
