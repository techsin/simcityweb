/** FH-01: power choices show their scale, and a turbine previews the sim's exact square clearance. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { CELL_SIZE } from '../../src/core/constants';
import type { GameContext } from '../../src/game/context';
import { PlopTool } from '../../src/game/tools/PlopTool';
import type { ToolPointer } from '../../src/game/tools/Tool';
import { CityActions } from '../../src/sim/actions';
import { getDef } from '../../src/sim/catalog';
import { WIND_SPACING } from '../../src/sim/economy/tuning';
import { WIND_TURBINE_BASE, WIND_TURBINE_GAIN } from '../../src/sim/infra/params';
import { Simulation } from '../../src/sim/Simulation';
import { Toolbar } from '../../src/ui/Toolbar';
import { money } from '../../src/ui/format';
import { WIND_START } from '../../src/ui/guide/founding';
import { newState, place } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';
import { queryHost } from './queryHost';

vi.mock('../../src/ui/thumbs', () => ({ thumbs: { cached: () => null } }));
installFakeDom();
const proto = FEl.prototype as unknown as { getBoundingClientRect?: () => DOMRect };
let hadRect: typeof proto.getBoundingClientRect;
beforeAll(() => {
  hadRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
});
afterAll(() => { proto.getBoundingClientRect = hadRect; });

function context() {
  const st = newState(32), sim = new Simulation(st), abort = new AbortController();
  st.funds = 1e6;
  const ctx = {
    state: st, host: queryHost(sim), signal: abort.signal, ui: new Emitter(),
    actions: new CityActions(sim), mods: {}, tools: { activeId: null, active: null, select: () => true },
    panels: { isOpen: () => false }, overlay: 0, sandbox: () => false, sound: () => {},
  } as unknown as GameContext;
  return { st, ctx, abort };
}

describe('FH-01 power cards', () => {
  it('shows catalog and terrain output beside the price, with the shared resident estimate above the cards', () => {
    const { ctx, abort } = context(), parent = document.createElement('div');
    const toolbar = new Toolbar(ctx, parent);
    toolbar.openFlyout('utilities', 'Power');
    const root = parent as unknown as FEl;
    const card = (id: string) => root.querySelectorAll('.fly-item').find((el) => el.dataset.toolId === `plop:${id}`)!;
    const output = (id: string) => card(id).querySelector('.fly-cost')!.innerHTML;
    const wind = getDef('util_wind_turbine')!;
    const flat = wind.powerOut! * WIND_TURBINE_BASE, hills = wind.powerOut! * (WIND_TURBINE_BASE + WIND_TURBINE_GAIN);
    expect(output(wind.id)).toContain(`${flat} MW flat · up to ${hills} on hills`);
    expect(output(wind.id)).toContain(money(wind.cost!));
    expect(output(wind.id)).toContain('/mo');
    for (const id of ['util_gas_plant', 'util_coal_plant']) expect(output(id)).toContain(`${getDef(id)!.powerOut} MW`);
    expect(textOf(root.querySelector('.fly-power-need')!)).toBe(`Your town uses about 1 MW per ${WIND_START.residentsPerMW} residents`);
    toolbar.openFlyout('utilities', 'Water');
    expect(root.querySelector('.fly-power-need')).toBeNull();
    abort.abort();
  });
});

type Highlight = { x: number; z: number; ok: boolean };
function turbine() {
  const f = context(), highlights: (Highlight[] | null)[] = [], ghosts: unknown[][] = [], tips: string[] = [];
  Object.assign(f.ctx, {
    world: { setHighlight: (cells: Highlight[] | null) => highlights.push(cells) },
    objects: { setGhost: (...args: unknown[]) => ghosts.push(args) },
    tip: { show: (html: string) => tips.push(html), hide: () => {} },
  });
  const tool = new PlopTool(f.ctx, getDef('util_wind_turbine')!, 'wind');
  Object.assign(f.ctx.tools, { active: tool });
  tool.activate();
  return { ...f, tool, highlights, ghosts, tips };
}

function pointer(x: number, z: number): ToolPointer {
  return { clientX: 0, clientY: 0, hit: { x, z, point: { x: (x + 0.5) * CELL_SIZE, y: 5, z: (z + 0.5) * CELL_SIZE } } as ToolPointer['hit'], shift: false, ctrl: false, alt: false, down: false };
}

describe('FH-01 turbine spacing preview', () => {
  it('marks the Chebyshev clearance perimeter, including diagonal conflicting turbines, while preserving the footprint', () => {
    const f = turbine(), gap = WIND_SPACING - 1;
    place(f.st, 'util_wind_turbine', 10 - gap, 10 - gap);
    f.tool.move(pointer(10, 10));
    const cells = f.highlights.at(-1)!;
    expect(cells.some((c) => c.x === 10 && c.z === 10)).toBe(true);
    for (let z = 10 - gap; z <= 10 + gap; z++) for (let x = 10 - gap; x <= 10 + gap; x++) {
      if (Math.max(Math.abs(x - 10), Math.abs(z - 10)) === gap) expect(cells.some((c) => c.x === x && c.z === z)).toBe(true);
    }
    expect(cells.every((c) => Math.max(Math.abs(c.x - 10), Math.abs(c.z - 10)) <= gap)).toBe(true);
    expect(cells.find((c) => c.x === 10 - gap && c.z === 10 - gap)?.ok).toBe(false);
    expect(f.ghosts.at(-1)).toEqual(['util_wind_turbine', 10, 10, expect.any(Number), false]);
    expect(f.tips.at(-1)).toContain(`Keep ${gap} empty tiles between turbines`);
    f.tool.leave();
    expect(f.highlights.at(-1)).toBeNull();
    f.tool.deactivate();
    expect(f.ghosts.at(-1)).toEqual([null]);
    f.abort.abort();
  });

  it('allows a turbine just beyond the clearance and clips the ring at the map edge', () => {
    const f = turbine();
    place(f.st, 'util_wind_turbine', 10 + WIND_SPACING, 10);
    f.tool.move(pointer(10, 10));
    expect(f.ghosts.at(-1)?.[4]).toBe(true);
    f.tool.move(pointer(0, 0));
    expect(f.highlights.at(-1)!.every((c) => f.st.inBounds(c.x, c.z))).toBe(true);
    f.tool.deactivate();
    expect(f.highlights.at(-1)).toBeNull();
    f.abort.abort();
  });

  it('leaves other plop previews unchanged', () => {
    const f = turbine();
    f.tool.deactivate();
    const tower = new PlopTool(f.ctx, getDef('util_water_tower')!, 'water');
    Object.assign(f.ctx.tools, { active: tower });
    tower.activate();
    tower.move(pointer(10, 10));
    expect(f.highlights.at(-1)).toEqual([{ x: 10, z: 10, ok: true }]);
    expect(f.tips.at(-1)).not.toContain('marked ring');
    tower.deactivate();
    f.abort.abort();
  });
});
