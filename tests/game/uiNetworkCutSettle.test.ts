/**
 * Final fixes r3 (lane ui, LD21c): a road / rail drag that demolishes buildings ran utilityCut's map-wide flood fill on
 * every path change (1.55 ms median, 46 ms max per change on the 1M save, against 0.10 / 3.4 ms for the local check) —
 * the pattern UI-5 fixed for the bulldozer (tests/game/uiCutSettle.test.ts). Now each change runs only the local detour
 * check (utilityCutQuick); the full fill waits until the path has rested CUT_SETTLE_MS, and the release's confirm
 * (sideDemolishRisks) runs it in full, so a real cut is never missed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirms: { title: string; items?: string[] }[] = [];
vi.mock('../../src/ui/Modals', () => ({
  confirmDialog: (_ctx: unknown, opts: { title: string; items?: string[] }) => {
    confirms.push(opts);
    return Promise.resolve(false);
  },
}));

import { Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { CityActions } from '../../src/sim/actions';
import type { Simulation } from '../../src/sim/Simulation';
import type { GameContext } from '../../src/game/context';
import type { ToolPointer } from '../../src/game/tools/Tool';
import { CUT_SETTLE_MS } from '../../src/game/tools/ZoneTool';
import { NetworkTool } from '../../src/game/tools/NetworkTool';
import { cutStats, utilityCut, utilityCutQuick } from '../../src/game/demolishRisk';
import { newSim, newState, place, roadLine } from '../infra/cityGen';

type Cells = { x: number; z: number; ok: boolean }[] | null;

function fakeCtx(sim: Simulation) {
  const calls = { hl: [] as Cells[], tip: [] as { html: string; kind?: string }[] };
  const ctx = {
    state: sim.state,
    sim,
    actions: new CityActions(sim),
    world: { setHighlight: (c: Cells) => calls.hl.push(c), setHighlightRect: () => {} },
    objects: { setGhost: () => {}, setNetworkPreview: () => {}, setUnderground: () => {} },
    tip: { show: (html: string, kind?: string) => calls.tip.push({ html, kind }), hide: () => {}, move: () => {} },
    sandbox: () => false,
    sound: () => {},
    toast: () => {},
    tools: { active: null, refresh: () => {}, select: () => true },
  } as unknown as GameContext;
  return { ctx, calls, lastTip: () => calls.tip[calls.tip.length - 1], lastHl: () => calls.hl[calls.hl.length - 1] };
}
const at = (x: number, z: number, down = false): ToolPointer =>
  ({ clientX: 0, clientY: 0, hit: { x, z, point: { x: (x + 0.5) * 16, y: 5, z: (z + 0.5) * 16 } } as unknown as ToolPointer['hit'], shift: false, ctrl: false, alt: false, down });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * plant (2×2 at 2,10) — a 2×2 tower (4,10) that bridges it to a street x = 6 (z 4..20) — five homes at x = 7
 * (z 12..16). A road drag down x = 5 from (5,10) demolishes the tower and lays road on one of its four cells only: the
 * plant is cut off, and the five homes with it.
 */
function town() {
  const st = newState(32);
  place(st, 't_coal', 2, 10, { flags: BF.Plopped });
  for (const [x, z] of [[4, 10], [5, 10], [4, 11], [5, 11]]) st.zone[st.idx(x, z)] = Zone.ResHigh;
  const tower = place(st, 't_r3', 4, 10, { pop: 40 });
  roadLine(st, 6, 4, 6, 20, Network.Road);
  for (let z = 12; z <= 16; z++) {
    st.zone[st.idx(7, z)] = Zone.ResMed;
    place(st, 't_r2', 7, z, { pop: 20 });
  }
  st.funds = 1e6;
  const sim = newSim(st);
  return { sim, st, tower };
}

describe('road drag preview: the full utility-cut fill waits for the path to rest (final fixes r3, LD21c)', () => {
  beforeEach(() => { vi.useFakeTimers(); confirms.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('the town: the drag\'s removal needs the map-wide fill, and that fill finds the cut', () => {
    const { sim, st, tower } = town();
    for (let z = 12; z <= 16; z++) expect(st.buildings.get(st.building[st.idx(7, z)])!.flags & BF.Powered).toBeTruthy();
    const path = [{ x: 5, z: 10 }, { x: 5, z: 9 }, { x: 5, z: 8 }];
    const rm = { buildings: [tower.id], add: { cells: path, pipes: true } };
    expect(utilityCutQuick(st, rm)).toBe('flood');
    expect(utilityCut(st, rm)?.text).toBe('Cuts power to 5 buildings (100 residents)');
    void sim;
  });

  it('a drag through the tower: no fill per path change; the path it rests on gets one, with the red line and tint', () => {
    const { sim } = town();
    const f = fakeCtx(sim);
    const road = new NetworkTool(f.ctx, Network.Road, 'net:2', 'road');
    road.activate();
    const fills = cutStats.fills;
    road.down(at(5, 10, true));
    for (const z of [9, 8, 9, 8]) { vi.advanceTimersByTime(16); road.move(at(5, z, true)); }
    expect(cutStats.fills).toBe(fills);
    expect(text(f.lastTip().html)).toMatch(/Demolishes 1 building/);
    expect(text(f.lastTip().html)).not.toContain('Cuts');
    vi.advanceTimersByTime(CUT_SETTLE_MS - 1);
    expect(cutStats.fills).toBe(fills);
    vi.advanceTimersByTime(1);
    // rested: one fill, the red line, the homes tinted red
    expect(cutStats.fills).toBe(fills + 1);
    const t = f.lastTip();
    expect(text(t.html)).toContain('Cuts power to 5 buildings (100 residents)');
    expect(text(t.html)).toMatch(/3 tiles/);
    expect(t.kind).toBe('bad');
    expect(f.lastHl()!.some((c) => c.x === 7 && c.z === 12 && !c.ok)).toBe(true);
    // resting longer: no second fill; moving on clears the line until the next rest
    vi.advanceTimersByTime(10 * CUT_SETTLE_MS);
    expect(cutStats.fills).toBe(fills + 1);
    road.move(at(5, 7, true));
    expect(text(f.lastTip().html)).not.toContain('Cuts');
    road.cancel();
    // a cancelled drag leaves nothing pending
    vi.advanceTimersByTime(10 * CUT_SETTLE_MS);
    expect(cutStats.fills).toBe(fills + 1);
    road.deactivate();
  });

  it('an immediate release (no rest) still asks first: the confirm runs the full check', async () => {
    const { sim, st } = town();
    const f = fakeCtx(sim);
    const road = new NetworkTool(f.ctx, Network.Road, 'net:2', 'road');
    road.down(at(5, 10, true));
    road.move(at(5, 8, true));
    road.up(at(5, 8));
    expect(confirms.length).toBe(1);
    expect(confirms[0].items?.some((s) => s.includes('Cuts power to 5 buildings (100 residents)'))).toBe(true);
    await Promise.resolve();
    // (cancelled: the tower stands, and no stale preview fill fires afterwards)
    expect(st.network[st.idx(5, 9)]).toBe(Network.None);
    const fills = cutStats.fills;
    vi.advanceTimersByTime(10 * CUT_SETTLE_MS);
    expect(cutStats.fills).toBe(fills);
  });

  it('a removal the local check settles needs no fill at all; leaving the map drops a pending one', () => {
    const { sim, st } = town();
    const f = fakeCtx(sim);
    // rail over the last home of the row: nothing hangs on it (rail carries no pipes: the local check decides)
    const rail = new NetworkTool(f.ctx, Network.Rail, 'net:6', 'rail');
    const home = st.building[st.idx(7, 16)];
    expect(utilityCutQuick(st, { buildings: [home], add: { cells: [{ x: 7, z: 16 }], pipes: false } })).toBeNull();
    const fills = cutStats.fills;
    rail.move(at(7, 16));
    expect(text(f.lastTip().html)).toMatch(/Demolishes 1 building/);
    vi.advanceTimersByTime(10 * CUT_SETTLE_MS);
    expect(cutStats.fills).toBe(fills);
    // a road hover over the tower: deferred; the pointer leaves the map before it rests: no fill, no tip
    const road = new NetworkTool(f.ctx, Network.Road, 'net:2', 'road');
    road.move(at(5, 10));
    const tips = f.calls.tip.length;
    road.leave();
    vi.advanceTimersByTime(10 * CUT_SETTLE_MS);
    expect(cutStats.fills).toBe(fills);
    expect(f.calls.tip.length).toBe(tips);
  });
});
