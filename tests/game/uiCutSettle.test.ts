/**
 * Final fixes UI-5 (lane ui): the bulldoze / rezone preview ran utilityCut's map-wide flood fill on every rectangle
 * change (1.5 ms median, 9 ms p95, 37 ms max for 1-8 × 1-8 rects of a 1.05M city — once per cell step of a drag). Now
 * each change runs only the local detour check (utilityCutQuick); the full fill waits until the rectangle has rested
 * CUT_SETTLE_MS, and the release's confirm runs it in full, so a real cut is never missed.
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
import { queryHost } from './queryHost';
import type { ToolPointer } from '../../src/game/tools/Tool';
import { CUT_SETTLE_MS, RectTool } from '../../src/game/tools/ZoneTool';
import { bulldozeRemoval, cutStats, utilityCutQuick } from '../../src/game/demolishRisk';
import { newSim, newState, place, roadLine, setRoad } from '../infra/cityGen';

type Cells = { x: number; z: number; ok: boolean }[] | null;

function fakeCtx(sim: Simulation) {
  const calls = { hl: [] as Cells[], tip: [] as { html: string; kind?: string }[] };
  const ctx = {
    state: sim.state,
    sim,
    host: queryHost(sim),
    actions: new CityActions(sim),
    world: { setHighlight: (c: Cells) => calls.hl.push(c), setHighlightRect: () => {} },
    objects: { setGhost: () => {}, setNetworkPreview: () => {} },
    tip: { show: (html: string, kind?: string) => calls.tip.push({ html, kind }), hide: () => {}, move: () => {} },
    sandbox: () => false,
    signal: new AbortController().signal,
    sound: () => {},
    toast: () => {},
    tools: { active: null, refresh: () => {}, select: () => true },
  } as unknown as GameContext;
  return { ctx, calls, lastTip: () => calls.tip[calls.tip.length - 1], lastHl: () => calls.hl[calls.hl.length - 1] };
}
const at = (x: number, z: number, down = false): ToolPointer =>
  ({ clientX: 0, clientY: 0, hit: { x, z, point: { x: (x + 0.5) * 16, y: 5, z: (z + 0.5) * 16 } } as unknown as ToolPointer['hit'], shift: false, ctrl: false, alt: false, down });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** plant (2×2 at 2,10) — a single road tile (4,10) — a street x = 5 (z 4..20) with five homes at x = 6 (z 12..16) */
function town() {
  const st = newState(32);
  place(st, 't_coal', 2, 10, { flags: BF.Plopped });
  setRoad(st, 4, 10);
  roadLine(st, 5, 4, 5, 20, Network.Road);
  place(st, 't_pump', 6, 6, { flags: BF.Plopped });
  for (let z = 12; z <= 16; z++) {
    st.zone[st.idx(6, z)] = Zone.ResMed;
    place(st, 't_r2', 6, z, { pop: 20 });
  }
  st.funds = 1e6;
  return newSim(st);
}

describe('bulldoze preview: the full utility-cut fill waits for the rectangle to rest (final fixes UI-5)', () => {
  beforeEach(() => { vi.useFakeTimers(); confirms.length = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('the local check settles a harmless tile at once; a cut needs the fill — shown once the cursor rests', () => {
    const sim = town();
    const st = sim.state;
    // (the quick check alone: a dead-end street tile is no cut; the plant's only link needs the map-wide fill)
    expect(utilityCutQuick(st, bulldozeRemoval(st, { x0: 5, z0: 20, x1: 6, z1: 21 }))).toBeNull();
    expect(utilityCutQuick(st, bulldozeRemoval(st, { x0: 4, z0: 10, x1: 5, z1: 11 }))).toBe('flood');
    const f = fakeCtx(sim);
    const tool = new RectTool(f.ctx, { kind: 'bulldoze' }, 'bulldoze', 'Bulldoze', 'bulldoze');
    tool.activate();
    const fills = cutStats.fills;
    tool.move(at(4, 10));
    // no fill yet, no red line yet
    expect(cutStats.fills).toBe(fills);
    expect(text(f.lastTip().html)).not.toContain('Cuts');
    vi.advanceTimersByTime(CUT_SETTLE_MS - 1);
    expect(cutStats.fills).toBe(fills);
    vi.advanceTimersByTime(1);
    // rested: one fill, the red line and the homes tinted red
    expect(cutStats.fills).toBe(fills + 1);
    const t = f.lastTip();
    expect(text(t.html)).toContain('Cuts power to 5 buildings (100 residents)');
    expect(t.kind).toBe('bad');
    expect(f.lastHl()!.some((c) => c.x === 6 && c.z === 12 && !c.ok)).toBe(true);
    // resting longer: no second fill
    vi.advanceTimersByTime(10 * CUT_SETTLE_MS);
    expect(cutStats.fills).toBe(fills + 1);
    tool.deactivate();
  });

  it('a drag over the cut and on: no fill per cell step; the rectangle it rests on gets one', () => {
    const sim = town();
    const f = fakeCtx(sim);
    const tool = new RectTool(f.ctx, { kind: 'bulldoze' }, 'bulldoze', 'Bulldoze', 'bulldoze');
    tool.activate();
    const fills = cutStats.fills;
    tool.down(at(3, 9, true));
    for (let z = 9; z <= 13; z++) { tool.move(at(4, z, true)); vi.advanceTimersByTime(16); }
    expect(cutStats.fills).toBe(fills);
    expect(text(f.lastTip().html)).not.toContain('Cuts');
    vi.advanceTimersByTime(CUT_SETTLE_MS);
    expect(cutStats.fills).toBe(fills + 1);
    expect(text(f.lastTip().html)).toContain('Cuts power');
    tool.cancel();
    // a cancelled drag leaves nothing pending
    vi.advanceTimersByTime(10 * CUT_SETTLE_MS);
    expect(cutStats.fills).toBe(fills + 1);
  });

  it('an immediate release (no rest) still asks first: the confirm runs the full check', async () => {
    const sim = town();
    const f = fakeCtx(sim);
    const tool = new RectTool(f.ctx, { kind: 'bulldoze' }, 'bulldoze', 'Bulldoze', 'bulldoze');
    tool.activate();
    tool.move(at(4, 10));
    tool.down(at(4, 10, true));
    (f.ctx.tools as unknown as { active: RectTool }).active = tool;
    tool.up(at(4, 10));
    await Promise.resolve();
    expect(confirms.length).toBe(1);
    expect(confirms[0].items).toContain('Cuts power to 5 buildings (100 residents)');
    await Promise.resolve();
    // (cancelled: the road tile stays, and no stale preview fill fires afterwards)
    expect(sim.state.network[sim.state.idx(4, 10)]).toBe(Network.Road);
    const fills = cutStats.fills;
    vi.advanceTimersByTime(10 * CUT_SETTLE_MS);
    expect(cutStats.fills).toBe(fills);
  });

  it('a rezoning that demolishes the bridging home: the same deferral, and the confirm still names the cut', async () => {
    const st = newState(32);
    place(st, 't_coal', 2, 10, { flags: BF.Plopped });
    st.zone[st.idx(4, 10)] = Zone.ResLow;
    place(st, 't_r1', 4, 10, { pop: 4 });
    roadLine(st, 5, 4, 5, 20, Network.Road);
    for (let z = 12; z <= 14; z++) { st.zone[st.idx(6, z)] = Zone.ResLow; place(st, 't_r1', 6, z, { pop: 8 }); }
    st.funds = 1e6;
    const sim = newSim(st);
    const f = fakeCtx(sim);
    const zone = new RectTool(f.ctx, { kind: 'zone', zone: Zone.ComLow }, 'zone:4', 'Commercial', 'zone');
    zone.move(at(4, 10));
    expect(text(f.lastTip().html)).not.toContain('Cuts');
    vi.advanceTimersByTime(CUT_SETTLE_MS);
    expect(text(f.lastTip().html)).toContain('Cuts power to 3 buildings (24 residents)');
    zone.down(at(4, 10, true));
    (f.ctx.tools as unknown as { active: RectTool }).active = zone;
    zone.up(at(4, 10));
    await Promise.resolve();
    expect(confirms.length).toBe(1);
    expect(confirms[0].items?.some((t) => t.includes('Cuts power to 3 buildings'))).toBe(true);
  });
});
