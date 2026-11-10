/** LG-09: a daily options watch may still hold free stations when a fractional Expert window expires. */
import { describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { DispatchTool } from '../../src/game/tools/DispatchTool';
import type { DispatchOption, Incident } from '../../src/sim/infra/emergency';
import { EmergencyBanner } from '../../src/ui/EmergencyBanner';
import { installFakeDom } from '../game/fakeDom';

installFakeDom();

describe('LG-09 cached dispatch controls', () => {
  it.each([undefined, 1, 0.75])('uses the continuous cutoff with incident multiplier %s despite an unchanged watch', (multiplier) => {
    let now = 22.4;
    const inc = {
      id: 1, kind: 'spill', start: 0, deadline: 30, manualDispatchWindowMultiplier: multiplier,
      state: 'uncovered', reason: 'outOfRange', manualPossible: true, canSend: true,
      need: { fire: 1 }, units: [], fires: [], lost: 0, deaths: 0, place: 'the highway', note: '',
    } as unknown as Incident;
    const option: DispatchOption = {
      stationId: 2, name: 'Fire Station', responder: 'fire', free: 1, total: 1, etaMin: 1, etaDays: 1, inRange: false,
    };
    const watch = { version: 1, value: [option], setArgs: vi.fn() };
    const ctx = {
      host: { simTime: () => now, emergency: { incident: () => inc, vehicles: () => [] } },
      // (FH-08's refresh reads the tips setting: unset here, so no teaching memory)
      settings: {},
      tip: { hide: vi.fn() },
    } as unknown as GameContext;
    const banner = Object.assign(Object.create(EmergencyBanner.prototype), { ctx, options: { get: () => watch }, followDispatches: new Map() }) as {
      refresh(b: unknown, inc: Incident): void;
    };
    const b = {
      title: document.createElement('div'), place: document.createElement('div'), note: document.createElement('div'),
      sub: document.createElement('div'), time: document.createElement('div'), el: document.createElement('div'),
      send: document.createElement('button'), choose: document.createElement('button'),
      sendLbl: document.createElement('span'), sendEta: document.createElement('span'), optsVersion: -1,
      follow: document.createElement('button'), // (T047: refresh() also refreshes the Follow button)
    };
    const tool = new DispatchTool(ctx) as unknown as {
      inc: number; optionsWatch: unknown; opts: DispatchOption[]; refreshOptions(): void;
      hoverStation: number | null; routeCells: unknown[];
    };
    tool.inc = inc.id;
    tool.optionsWatch = watch;
    banner.refresh(b, inc);
    tool.refreshOptions();
    expect(b.send.disabled).toBe(false);
    expect(b.choose.disabled).toBe(false);
    expect(tool.opts).toEqual([option]);
    tool.hoverStation = option.stationId;
    tool.routeCells = [{ x: 1, z: 1, ok: true }];
    for (now of [22.5 - 1e-6, 22.5, 22.6]) {
      banner.refresh(b, inc);
      tool.refreshOptions();
      const closed = multiplier === 0.75;
      expect(b.send.disabled).toBe(closed);
      expect(b.choose.disabled).toBe(closed);
      expect(tool.opts).toEqual(closed ? [] : [option]);
      if (closed) {
        expect(b.sendLbl.textContent).toBe('Window closed');
        expect(tool.hoverStation).toBeNull();
        expect(tool.routeCells).toEqual([]);
      }
      expect(watch.version).toBe(1);
      expect(watch.value).toEqual([option]);
      expect(inc.manualPossible).toBe(true);
    }
  });
});
