/**
 * Close-out c1 (lane ui): a build card that does not select — the ruined Missile Test Range's "In ruins — bulldoze its
 * ruins first" (final fixes r4 U2), "Already built (one per city)", a locked card — still ended its tooltip with "Click
 * to select · R rotates while placing", though a click only shakes the card. Such a card gets no footer; a placeable one
 * keeps it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import type { GameContext } from '../../src/game/context';
import { UNIQUE_BUILT_TEXT, UNIQUE_RUINS_TEXT, findToolSpec, type ToolSpec } from '../../src/game/toolCatalog';
import { Toolbar, specTipFooter } from '../../src/ui/Toolbar';
import { newState, place, roadLine } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
// (the tooltip is placed next to its card: a zero rect is enough here)
const proto = FEl.prototype as unknown as { getBoundingClientRect?: () => DOMRect };
let hadRect: typeof proto.getBoundingClientRect;
beforeAll(() => {
  hadRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
});
afterAll(() => {
  proto.getBoundingClientRect = hadRect;
});

describe('build card tooltips: no "Click to select" under a card that does not select (close-out c1)', () => {
  const def = getDef('rw_missile_range')!;
  const spec = (o: Partial<ToolSpec>): ToolSpec => ({ id: 'plop:rw_missile_range', label: def.name, icon: 'x', def, create: () => { throw new Error('unused'); }, ...o });

  it('the footer: a placeable card, a hotkey tool; none when disabled or locked', () => {
    expect(specTipFooter(spec({}))).toBe('<div class="rt-key">Click to select · <kbd>R</kbd> rotates while placing</div>');
    expect(specTipFooter(spec({ disabled: UNIQUE_RUINS_TEXT }))).toBe('');
    expect(specTipFooter(spec({ disabled: UNIQUE_BUILT_TEXT }))).toBe('');
    expect(specTipFooter(spec({ locked: { hint: 'Reach 2,000 residents', progress: 0.4 } }))).toBe('');
    expect(specTipFooter({ id: 'zone:res_low', hotkey: 'Z' })).toBe('<div class="rt-key">Hotkey <kbd>Z</kbd> (press again to cycle)</div>');
    expect(specTipFooter({ id: 'zone:res_low', hotkey: 'Z', locked: { hint: 'x' } })).toBe('');
    expect(specTipFooter({ id: 'bulldoze' })).toBe('');
  });

  it('the rendered tooltip of a ruined Missile Test Range: its reason, no footer; the standing card says why too; placeable again: the footer', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 61, 20, Network.Road);
    place(st, 't_coal', 2, 18, { flags: BF.Plopped });
    const range = place(st, 'rw_missile_range', 20, 21, { flags: BF.Plopped | BF.Powered | BF.Watered });
    st.milestones.rw_missile_range = 1;
    st.unlocked.add('missile_range');
    st.funds = 1e6;
    const sim = new Simulation(st, createSystems());
    const ctx = {
      get state() { return sim.state; },
      sim,
      signal: new AbortController().signal,
      ui: { on: () => () => undefined },
      tools: { activeId: null, select: () => true },
      panels: { isOpen: () => false },
      overlay: 0,
      sandbox: () => false,
      sound: () => undefined,
    } as unknown as GameContext;
    const parent = document.createElement('div') as unknown as HTMLElement;
    const bar = new Toolbar(ctx, parent);
    const tip = (parent as unknown as FEl).children.find((e) => e.classList.contains('rich-tip'))!;
    const show = (s: ToolSpec) => {
      (bar as unknown as { showSpecTip(s: ToolSpec, a: HTMLElement): void }).showSpecTip(s, document.createElement('div') as unknown as HTMLElement);
      return tip.innerHTML;
    };
    // standing: "Already built (one per city)", no footer
    let html = show(findToolSpec(ctx, 'plop:rw_missile_range')!);
    expect(textOf(tip)).toContain(UNIQUE_BUILT_TEXT);
    expect(html).not.toContain('Click to select');
    // in ruins: the r4 reason, no footer
    range.flags |= BF.Burnt;
    html = show(findToolSpec(ctx, 'plop:rw_missile_range')!);
    expect(textOf(tip)).toContain(UNIQUE_RUINS_TEXT);
    expect(html).not.toContain('Click to select');
    expect(html).not.toContain('rt-key');
    // a placeable card keeps its footer
    html = show(findToolSpec(ctx, 'plop:civ_clinic')!);
    expect(html).toContain('Click to select · <kbd>R</kbd> rotates while placing');
  });
});
