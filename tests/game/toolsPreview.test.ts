/**
 * The tools' previews with a headless context (final fixes N1 / N3 / P3 / P8 / P14): what the cursor tip says and which
 * cells the preview tints, from the real actions on a small town.
 *  - N1: the bulldozer over the only road tile between a plant and the homes says it cuts their power (red tip, the
 *    homes tinted red) once the cursor rests (UI-5, tests/game/uiCutSettle.test.ts); a redundant tile says nothing; a
 *    road drag through a lot that bridged the grid says it too.
 *  - N3: dragging a zone one unzoned column off the road tints all of it red and says it will never develop.
 *  - P3 / P8 / P14: the plop tip's upkeep at the cursor; a staffed service without a road is a red tip; a shore
 *    building auto-faces the water and a manual turn away from it says "press R".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { CityActions } from '../../src/sim/actions';
import { getDef } from '../../src/sim/catalog';
import type { Simulation } from '../../src/sim/Simulation';
import type { GameContext } from '../../src/game/context';
import { queryHost } from './queryHost';
import { resultTip, type ToolPointer } from '../../src/game/tools/Tool';
import { CUT_SETTLE_MS, RectTool } from '../../src/game/tools/ZoneTool';
import { NetworkTool } from '../../src/game/tools/NetworkTool';
import { NO_ROAD_STAFFED, PlopTool } from '../../src/game/tools/PlopTool';
import { runQuery } from '../../src/worker/queries';
import { upkeepEstimate } from '../../src/ui/upkeepModel';
import { money } from '../../src/ui/format';
import { newSim, newState, place, roadLine, setRoad } from '../infra/cityGen';
import { makeCity } from '../sim/helpers';

type Cells = { x: number; z: number; ok: boolean }[] | null;

function fakeCtx(sim: Simulation) {
  const calls = { hl: [] as Cells[], tip: [] as { html: string; kind?: string }[], toasts: [] as string[] };
  const ctx = {
    state: sim.state,
    sim,
    host: queryHost(sim),
    signal: new AbortController().signal,
    actions: new CityActions(sim),
    world: { setHighlight: (c: Cells) => calls.hl.push(c), setHighlightRect: () => {} },
    objects: { setGhost: () => {}, setNetworkPreview: () => {} },
    tip: { show: (html: string, kind?: string) => calls.tip.push({ html, kind }), hide: () => {}, move: () => {} },
    sandbox: () => false,
    sound: () => {},
    toast: (t: string) => calls.toasts.push(t),
    tools: { active: null, refresh: () => {}, select: () => true },
    preferOverlayVariant: () => {},
  } as unknown as GameContext;
  return { ctx, calls, lastTip: () => calls.tip[calls.tip.length - 1], lastHl: () => calls.hl[calls.hl.length - 1] };
}

/** a pointer over cell (x, z) (point: the cell centre, or `px`, `pz` in cells) */
function at(x: number, z: number, px = x + 0.5, pz = z + 0.5): ToolPointer {
  return { clientX: 0, clientY: 0, hit: { x, z, point: { x: px * 16, y: 5, z: pz * 16 } } as unknown as ToolPointer['hit'], shift: false, ctrl: false, alt: false, down: false };
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, ' ').trim();

/** plant (2×2 at 2,10) — a single road tile (4,10) — a street x = 5 (z 4..20) with five homes at x = 6 (z 12..16) */
function town() {
  const st = newState(32);
  place(st, 't_coal', 2, 10, { flags: BF.Plopped });
  setRoad(st, 4, 10);
  roadLine(st, 5, 4, 5, 20, Network.Road);
  place(st, 't_pump', 6, 6, { flags: BF.Plopped });
  const homes: number[] = [];
  for (let z = 12; z <= 16; z++) {
    st.zone[st.idx(6, z)] = Zone.ResMed;
    homes.push(place(st, 't_r2', 6, z, { pop: 20 }).id);
  }
  st.funds = 1e6;
  const sim = newSim(st);
  return { st, sim, homes };
}

describe('bulldoze / rezone / road previews: utility cuts (N1)', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('the only road tile between the plant and the homes: a red tip line and the homes tinted red', () => {
    vi.useFakeTimers();
    const { sim, homes, st } = town();
    for (const id of homes) expect(st.buildings.get(id)!.flags & BF.Powered).toBeTruthy();
    const f = fakeCtx(sim);
    const tool = new RectTool(f.ctx, { kind: 'bulldoze' }, 'bulldoze', 'Bulldoze', 'bulldoze');
    tool.activate();
    tool.move(at(4, 10));
    // (final fixes UI-5: the map-wide fill runs once the cursor rests)
    vi.advanceTimersByTime(CUT_SETTLE_MS);
    const t = f.lastTip();
    expect(text(t.html)).toContain('Cuts power to 5 buildings (100 residents)');
    expect(t.kind).toBe('bad');
    const hl = f.lastHl()!;
    expect(hl).not.toBeNull();
    for (const id of homes) {
      const b = st.buildings.get(id)!;
      expect(hl.some((c) => c.x === b.x && c.z === b.z && !c.ok)).toBe(true);
    }
    // a street tile at the far end: nothing hangs on it — no line, the tint is cleared
    tool.move(at(5, 20));
    expect(text(f.lastTip().html)).not.toContain('Cuts');
    expect(f.lastTip().kind).toBe('ok');
    expect(f.lastHl()).toBeNull();
    tool.deactivate();
  });

  it('a road drag through a home that bridged the grid: the new road conducts in its place (no cut)', () => {
    vi.useFakeTimers();
    const st = newState(32);
    place(st, 't_coal', 2, 10, { flags: BF.Plopped });
    st.zone[st.idx(4, 10)] = Zone.ResLow;
    place(st, 't_r1', 4, 10, { pop: 4 });
    roadLine(st, 5, 4, 5, 20, Network.Road);
    for (let z = 12; z <= 14; z++) { st.zone[st.idx(6, z)] = Zone.ResLow; place(st, 't_r1', 6, z, { pop: 8 }); }
    st.funds = 1e6;
    const sim = newSim(st);
    const f = fakeCtx(sim);
    // a power line drag can't cross it, a road drag replaces it: the road keeps the homes on the grid
    const road = new NetworkTool(f.ctx, Network.Road, 'net:2', 'road');
    road.move(at(4, 10));
    expect(text(f.lastTip().html)).toMatch(/Demolishes 1 building/);
    expect(text(f.lastTip().html)).not.toContain('Cuts');
    // rezoning it to commercial demolishes it without a road in its place: that cuts the street off
    const zone = new RectTool(f.ctx, { kind: 'zone', zone: Zone.ComLow }, 'zone:4', 'Commercial', 'zone');
    zone.move(at(4, 10));
    vi.advanceTimersByTime(CUT_SETTLE_MS);
    expect(text(f.lastTip().html)).toContain('Cuts power to 3 buildings (24 residents)');
  });
});

describe('bulldoze refund tips (FH-07a)', () => {
  it.each([
    [0, 'Refund §25,000 (built today)'],
    [20, 'Refund §12,500 (under 30 days old)'],
    [31, null],
  ] as const)('renders a plop at age %i in resultTip and the bulldoze tool', (days, refund) => {
    const { st, sim } = makeCity();
    const f = fakeCtx(sim), tool = new RectTool(f.ctx, { kind: 'bulldoze' }, 'bulldoze', 'Bulldoze', 'bulldoze');
    f.ctx.actions.plop('util_coal_plant', 10, 10, 0);
    sim.runDays(days);
    expect(st.buildingAt(10, 10)!.age).toBe(days);
    const pre = f.ctx.actions.bulldoze({ x0: 10, z0: 10, x1: 11, z1: 11 }, true);
    tool.move(at(10, 10));
    for (const html of [resultTip('Bulldoze', pre).html, f.lastTip().html]) {
      if (refund) expect(text(html)).toContain(refund);
      else expect(text(html)).not.toContain('Refund');
    }
    tool.deactivate();
  });

  it('refreshes an unmoved bulldoze preview across days, including both refund boundaries', () => {
    const { sim } = makeCity();
    const f = fakeCtx(sim), tool = new RectTool(f.ctx, { kind: 'bulldoze' }, 'bulldoze', 'Bulldoze', 'bulldoze');
    f.ctx.actions.plop('util_coal_plant', 10, 10, 0);
    const preview = vi.spyOn(f.ctx.actions, 'bulldoze');
    tool.move(at(10, 10));
    tool.move(at(10, 10));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(text(f.lastTip().html)).toContain('Refund §25,000 (built today)');
    sim.advanceDay();
    tool.move(at(10, 10));
    expect(preview).toHaveBeenCalledTimes(2);
    expect(text(f.lastTip().html)).toContain('Refund §12,500 (under 30 days old)');
    sim.runDays(29);
    tool.move(at(10, 10));
    expect(preview).toHaveBeenCalledTimes(3);
    expect(text(f.lastTip().html)).not.toContain('Refund');
    tool.deactivate();
  });
});

describe('zone preview: no road access (N3)', () => {
  it('a 3×3 zone one unzoned column off the road is tinted red and flagged; against the road it is not', () => {
    const st = newState(32);
    roadLine(st, 4, 6, 4, 20, Network.Road);
    st.funds = 1e6;
    const sim = newSim(st);
    const f = fakeCtx(sim);
    const tool = new RectTool(f.ctx, { kind: 'zone', zone: Zone.ComLow }, 'zone:4', 'Commercial · Low density', 'zone');
    tool.down(at(6, 10));
    tool.move(at(8, 12));
    const t = f.lastTip();
    expect(text(t.html)).toContain('All 9 tiles have no road access and will never develop');
    expect(t.kind).toBe('ok'); // a warning, not a block
    const hl = f.lastHl()!;
    expect(hl.length).toBe(9);
    expect(hl.every((c) => !c.ok && c.x >= 6 && c.x <= 8 && c.z >= 10 && c.z <= 12)).toBe(true);
    tool.cancel();
    // the same drag against the road: no warning, no tint
    tool.down(at(5, 10));
    tool.move(at(7, 12));
    expect(text(f.lastTip().html)).not.toContain('road access');
    expect(f.lastHl()).toBeNull();
    // a deep drag: only the tiles beyond the reach are flagged
    tool.move(at(13, 11));
    expect(text(f.lastTip().html)).toMatch(/^Commercial · Low density .*6 of 18 tiles have no road access/);
    tool.cancel();
  });
});

describe('plop tool tip (P3 / P8 / P14)', () => {
  it('a school beside the homes: the upkeep here and at full use; away from every road: the red staffed line', async () => {
    const { sim } = town();
    const f = fakeCtx(sim);
    const tool = new PlopTool(f.ctx, getDef('civ_elementary_school')!, 'school');
    Object.assign(f.ctx.tools, { active: tool });
    tool.activate();
    // on the street's west side (4, 18), a walk from the homes
    tool.move(at(4, 18));
    await Promise.resolve();
    let t = text(f.lastTip().html);
    expect(t).toMatch(/Upkeep here ≈§[\d,]+\/mo now · up to §[\d,]+ at full use/);
    expect(t).not.toContain(NO_ROAD_STAFFED);
    // open land with no road beside it
    tool.move(at(20, 25));
    await Promise.resolve();
    const tip = f.lastTip();
    t = text(tip.html);
    expect(t).toContain(NO_ROAD_STAFFED);
    expect(t).not.toContain('Warning: no road access');
    expect(tip.kind).toBe('bad');
    // (only the building share there: nobody to serve without a road)
    expect(t).toMatch(/Upkeep here ≈§72\/mo now/);
    // a park without a road keeps the plain warning
    const park = new PlopTool(f.ctx, getDef('park_small')!, 'park');
    park.move(at(20, 25));
    expect(text(f.lastTip().html)).not.toContain(NO_ROAD_STAFFED);
  });

  it('final fixes UI-1: the tip quotes upkeepHere; past the full-use figure (a fire station in a big unserved district) no "up to" the same number', async () => {
    // a dense town: streets every 5 tiles, full 2×2 towers (400) on both sides, no fire station anywhere
    const st = newState(64);
    st.funds = 1e7;
    roadLine(st, 2, 1, 62, 1, Network.Road);
    for (let x = 2; x <= 62; x += 5) roadLine(st, x, 1, x, 62, Network.Road);
    for (let x = 2; x + 5 <= 62; x += 5) for (let z = 3; z + 2 <= 60; z += 2) for (const bx of [x + 1, x + 3]) {
      for (let k = 0; k < 4; k++) st.zone[st.idx(bx + (k & 1), z + (k >> 1))] = Zone.ResHigh;
      place(st, 't_r3', bx, z, { pop: 400 });
    }
    // (the station's own lot cleared)
    for (const b of [...st.buildings.values()]) if (b.x >= 28 && b.x <= 29 && b.z >= 29 && b.z <= 32) { st.buildings.delete(b.id); for (let k = 0; k < 4; k++) st.building[st.idx(b.x + (k & 1), b.z + (k >> 1))] = -1; }
    const sim = newSim(st);
    const def = getDef('civ_fire_station')!;
    const f = fakeCtx(sim);
    const tool = new PlopTool(f.ctx, def, 'fire');
    Object.assign(f.ctx.tools, { active: tool });
    tool.activate();
    // (the cursor at the lot's centre: origin (28, 30), beside the street x = 27)
    tool.move(at(28, 30, 29, 31));
    await Promise.resolve();
    const t = text(f.lastTip().html);
    const here = runQuery(sim, 'upkeepContext', { defId: def.id, x: 28, z: 30, w: 2, d: 2 }).here!;
    const full = upkeepEstimate(st, def)!.full;
    expect(here).toBeGreaterThan(full);
    expect(t).toContain(`Upkeep here ≈${money(here)}/mo now`);
    expect(t).not.toContain('at full use');
  });

  it('a ferry terminal on the shore auto-faces the water; turned away by hand it says how to fix it', () => {
    const st = newState(32);
    for (let z = 0; z < 32; z++) for (let x = 20; x < 32; x++) st.water[st.idx(x, z)] = 1;
    roadLine(st, 17, 0, 17, 31, Network.Road);
    st.funds = 1e6;
    st.config.sandbox = true; // (unlocks)
    const sim = newSim(st);
    const f = fakeCtx(sim);
    const tool = new PlopTool(f.ctx, getDef('tr_ferry_terminal')!, 'ferry');
    tool.activate();
    // the cursor at (19, 16): a 2×2 lot at (18, 15), road behind (x = 17), water in front (x = 20)
    tool.move(at(19, 16, 19, 16));
    let t = text(f.lastTip().html);
    expect(t).not.toContain('Must be placed on the shore');
    expect(t).toContain('Auto-facing water');
    // R turns it by hand (rot 2): no longer facing the water — the fix is named
    tool.key({ type: 'keydown', key: 'r', ctrlKey: false, metaKey: false, shiftKey: false } as KeyboardEvent, at(19, 16, 19, 16));
    t = text(f.lastTip().html);
    expect(t).toContain('Must be placed on the shore with its front facing water — press R to face the water');
    // inland nothing faces water: say where to put it, once (final fixes UI-4: the tip read "... front facing water —
    // place it on the water's edge, its front facing the water")
    tool.move(at(6, 6, 6, 6));
    t = text(f.lastTip().html);
    expect(t).toContain("Must be placed on the shore with its front facing water — move it onto the water's edge");
    expect(t.match(/facing (the )?water/g)?.length).toBe(1);
  });
});
