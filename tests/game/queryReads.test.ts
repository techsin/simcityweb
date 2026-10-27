/** W0.3: headers are immediate; late reports cannot paint another target or commit an abandoned edit. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { RectTool } from '../../src/game/tools/ZoneTool';
import { PlopTool } from '../../src/game/tools/PlopTool';
import { DispatchTool } from '../../src/game/tools/DispatchTool';
import type { Tool, ToolPointer } from '../../src/game/tools/Tool';
import { getDef } from '../../src/sim/catalog';
import type { Incident } from '../../src/sim/infra/emergency';
import { InfoPanel } from '../../src/ui/panels/InfoPanel';
import { LocalSimHost } from '../../src/worker/SimHost';
import type { QueryResult } from '../../src/worker/queries';
import { QUERY_HANDLERS } from '../../src/worker/queries';
import { newState, place } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

vi.mock('../../src/ui/Modals', () => ({ confirmDialog: vi.fn(() => Promise.resolve(false)) }));
vi.mock('../../src/ui/thumbs', () => ({ thumbs: { cached: () => null } }));
installFakeDom();
afterEach(() => vi.restoreAllMocks());
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const at = (x: number, z: number): ToolPointer => ({ clientX: 0, clientY: 0, hit: { x, z, point: { x: (x + 0.5) * 16, y: 5, z: (z + 0.5) * 16 } } as ToolPointer['hit'], down: false, shift: false, ctrl: false, alt: false });

function fixture() {
  let now = 0;
  const st = newState(32), a = place(st, 't_r1', 4, 4, { pop: 8 }), b = place(st, 't_r2', 9, 9, { pop: 40 });
  const host = new LocalSimHost(st, { now: () => now }), abort = new AbortController();
  const tools = { active: null as Tool | null, refresh: vi.fn(), select: vi.fn() };
  const ctx = {
    state: st, sim: host.sim, host, signal: abort.signal, actions: host.actions, mods: {},
    objects: { setSelected: vi.fn(), setGhost: vi.fn(), setNetworkPreview: vi.fn() },
    world: { setHighlight: vi.fn(), setHighlightRect: vi.fn() },
    tip: { show: vi.fn(), hide: vi.fn(), move: vi.fn() }, panels: { close: vi.fn() },
    sound: vi.fn(), toast: vi.fn(), sandbox: () => false, tools, preferOverlayVariant: vi.fn(),
  } as unknown as GameContext;
  return { host, ctx, tools, a, b, abort, time: (v: number) => { now = v; } };
}

describe('query consumers', () => {
  it('shows a new inspector header immediately and never shows the old target report while throttled', async () => {
    const f = fixture(), panel = new InfoPanel(f.ctx);
    panel.mount(() => {}, () => {}, () => {});
    panel.show({ buildingId: f.a.id, x: f.a.x, z: f.a.z });
    expect(textOf(panel.body as unknown as FEl)).toContain('Land value');
    panel.show({ buildingId: f.b.id, x: f.b.x, z: f.b.z });
    const pending = textOf(panel.body as unknown as FEl);
    expect(pending).toContain('R$$ apt');
    expect(pending).toContain('Loading…');
    expect(pending).not.toContain('Land value');
    expect(pending).not.toContain('R$ house');
    f.b.pop = 41;
    panel.update();
    expect(textOf(panel.body as unknown as FEl)).toContain('41');
    f.time(200); panel.update();
    expect(textOf(panel.body as unknown as FEl)).toContain('Land value');
    expect(textOf(panel.body as unknown as FEl)).not.toContain('Loading…');
    // An empty-cell watch has its own keys as well.
    panel.show({ x: 20, z: 20 });
    panel.show({ x: 21, z: 21 });
    expect(textOf(panel.body as unknown as FEl)).toContain('Loading…');
    f.time(400); panel.update();
    expect(textOf(panel.body as unknown as FEl)).not.toContain('Loading…');
    panel.onClose(); f.abort.abort('dispose'); await f.host.dispose();
  });

  it.each(['close', 'target', 'abort'] as const)('ignores an inspector demolition report after %s', async (exit) => {
    const f = fixture(), panel = new InfoPanel(f.ctx);
    let resolve!: (r: QueryResult<'demolishRisks'>) => void;
    vi.spyOn(f.host, 'query').mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const act = vi.spyOn(f.host, 'act');
    panel.mount(() => {}, () => {}, () => {});
    panel.show({ buildingId: f.a.id, x: f.a.x, z: f.a.z });
    const demo = (panel.body as unknown as FEl).all().find((e) => e.tagName === 'button' && textOf(e).startsWith('Demolish'))!;
    demo.click();
    if (exit === 'close') panel.onClose();
    else if (exit === 'abort') f.abort.abort('dispose');
    else panel.show({ buildingId: f.b.id, x: f.b.x, z: f.b.z });
    resolve(null); await flush();
    expect(act).not.toHaveBeenCalled();
    panel.onClose(); f.abort.abort('dispose'); await f.host.dispose();
  });

  it('keeps the released gesture alive until a demolition query and its acknowledgement finish', async () => {
    const f = fixture(), tool = new RectTool(f.ctx, { kind: 'bulldoze' }, 'bulldoze', 'Bulldoze', 'bulldoze');
    let resolve!: (r: QueryResult<'demolishRisks'>) => void;
    vi.spyOn(f.host, 'query').mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const begin = vi.spyOn(f.host, 'beginGesture'), act = vi.spyOn(f.host, 'act');
    f.tools.active = tool;
    tool.beginGesture(); tool.down(at(4, 4)); tool.up(at(4, 4)); tool.endGesture();
    const gesture = begin.mock.results[0].value;
    const settled = vi.fn(); void gesture.settled.then(settled);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    expect(act).not.toHaveBeenCalled();
    resolve(null); await gesture.settled; await flush();
    expect(act).toHaveBeenCalledWith('bulldoze', [expect.any(Object)], { gesture });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(f.host.state.buildings.has(f.a.id)).toBe(false);
    tool.deactivate(); f.abort.abort('dispose'); await f.host.dispose();
  });

  it('cancels a released demolition while its query is still pending', async () => {
    const f = fixture(), tool = new RectTool(f.ctx, { kind: 'bulldoze' }, 'bulldoze', 'Bulldoze', 'bulldoze');
    let resolve!: (r: QueryResult<'demolishRisks'>) => void;
    vi.spyOn(f.host, 'query').mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const act = vi.spyOn(f.host, 'act');
    f.tools.active = tool;
    tool.down(at(4, 4)); tool.up(at(4, 4));
    expect(tool.cancel()).toBe(true);
    resolve(null); await flush();
    expect(act).not.toHaveBeenCalled();
    tool.deactivate(); f.abort.abort('dispose'); await f.host.dispose();
  });

  it('deduplicates placement reads per key and ignores a reply for an earlier placement', async () => {
    const f = fixture(), tool = new PlopTool(f.ctx, getDef('tr_parking_garage')!, 'parking');
    const pending: ((r: QueryResult<'stopsNear'>) => void)[] = [];
    const query = vi.spyOn(f.host, 'query').mockImplementation(() => new Promise((r) => { pending.push(r); }) as never);
    f.tools.active = tool;
    tool.move(at(20, 20)); tool.move(at(20, 20)); tool.move(at(24, 20));
    expect(query).toHaveBeenCalledTimes(2);
    pending[0]([{ id: 100, name: 'Old stop', mode: 'bus', dist: 1 }]); await flush();
    expect(vi.mocked(f.ctx.tip.show).mock.calls.at(-1)?.[0]).not.toContain('Old stop');
    pending[1]([{ id: 101, name: 'Current stop', mode: 'bus', dist: 2 }]); await flush();
    expect(vi.mocked(f.ctx.tip.show).mock.calls.at(-1)?.[0]).toContain('Current stop');
    tool.move(at(20, 20)); await flush();
    expect(query).toHaveBeenCalledTimes(2);
    expect(vi.mocked(f.ctx.tip.show).mock.calls.at(-1)?.[0]).toContain('Old stop');
    tool.deactivate(); f.abort.abort('dispose'); await f.host.dispose();
  });

  it('keeps upkeep per footprint and repaints the current spot after a paused funding command', async () => {
    const f = fixture();
    f.ctx.state.systemData.infraVersion = 1;
    const read = vi.spyOn(QUERY_HANDLERS, 'upkeepContext').mockReturnValueOnce({ here: 132 }).mockReturnValueOnce({ here: 72 }).mockReturnValue({ here: 84 });
    const tool = new PlopTool(f.ctx, getDef('civ_elementary_school')!, 'school');
    f.tools.active = tool;
    const tip = () => vi.mocked(f.ctx.tip.show).mock.calls.at(-1)?.[0] ?? '';
    try {
      tool.activate(); tool.move(at(20, 20)); tool.move(at(20, 20));
      expect(tip()).toContain('Upkeep here ≈§132/mo now');
      expect(read).toHaveBeenCalledTimes(1);
      tool.move(at(24, 20));
      expect(tip()).not.toContain('Upkeep here'); // the new key never inherits the previous spot's price
      f.time(200); f.host.frame(0);
      expect(tip()).toContain('Upkeep here ≈§72/mo now');
      f.time(400); tool.move(at(20, 20));
      expect(tip()).toContain('Upkeep here ≈§132/mo now');
      expect(read).toHaveBeenCalledTimes(2);
      f.host.act('setFunding', ['education', 50]);
      f.time(600); f.host.frame(0);
      expect(tip()).toContain('Upkeep here ≈§84/mo now');
      expect(f.ctx.state.day).toBe(0);
    } finally { tool.deactivate(); f.abort.abort('dispose'); await f.host.dispose(); }
  });

  it.each(['leave', 'deactivate', 'abort'] as const)('disposes upkeep reads and stops repainting on %s', async (exit) => {
    const f = fixture();
    f.ctx.state.systemData.infraVersion = 1;
    const read = vi.spyOn(QUERY_HANDLERS, 'upkeepContext').mockReturnValue({ here: 132 });
    const tool = new PlopTool(f.ctx, getDef('civ_elementary_school')!, 'school');
    f.tools.active = tool;
    try {
      tool.activate(); tool.move(at(20, 20));
      if (exit === 'abort') f.abort.abort('dispose');
      else tool[exit]();
      vi.mocked(f.ctx.tip.show).mockClear();
      f.ctx.state.day++;
      f.time(200); f.host.frame(0);
      expect(read).toHaveBeenCalledTimes(1);
      expect(f.ctx.tip.show).not.toHaveBeenCalled();
      if (exit !== 'abort') {
        tool.activate(); tool.move(at(20, 20));
        expect(read).toHaveBeenCalledTimes(2);
        expect(vi.mocked(f.ctx.tip.show).mock.calls.at(-1)?.[0]).toContain('Upkeep here ≈§132/mo now');
      }
    } finally { tool.deactivate(); f.abort.abort('dispose'); await f.host.dispose(); }
  });

  it('ignores routes and clicked incident reports after DispatchTool changes target', async () => {
    const f = fixture(), tool = new DispatchTool(f.ctx);
    f.tools.active = tool;
    const incident = (id: number) => ({ id, kind: 'medical', buildingId: f.b.id, place: 'Test home', x: f.b.x, z: f.b.z, fires: [], units: [], need: { medical: 1 }, state: 'uncovered', major: true } as unknown as Incident);
    vi.spyOn(f.host.emergency, 'incident').mockImplementation(incident);
    vi.spyOn(QUERY_HANDLERS, 'dispatchOptions').mockReturnValue([
      { stationId: f.a.id, name: 'Clinic', responder: 'medical', free: 1, total: 1, etaMin: 1, etaDays: 0.1, inRange: true },
    ]);
    let route!: (r: number[]) => void;
    const query = vi.spyOn(f.host, 'query').mockReturnValue(new Promise((r) => { route = r; }) as never);
    tool.target(1);
    tool.move(at(f.a.x, f.a.z));
    expect(query).toHaveBeenCalledExactlyOnceWith('routePreview', { incidentId: 1, stationId: f.a.id });
    tool.target(2);
    vi.mocked(f.ctx.world.setHighlight).mockClear();
    route([1, 2, 3]); await flush();
    expect(f.ctx.world.setHighlight).not.toHaveBeenCalled();
    let report!: (r: Incident) => void;
    query.mockReturnValue(new Promise((r) => { report = r; }) as never);
    const clicking = tool.down(at(27, 27));
    tool.target(3);
    const target = vi.spyOn(tool, 'target');
    report(incident(4)); await clicking;
    expect(target).not.toHaveBeenCalled();
    tool.deactivate(); f.abort.abort('dispose'); await f.host.dispose();
  });
});
