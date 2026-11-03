/** FH-02: the inspector acknowledges an actual expanded Why? report, after host data arrives. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { BF, type Building } from '../../src/sim/CityState';
import { loadPref } from '../../src/game/settings';
import { InfoPanel } from '../../src/ui/panels/InfoPanel';
import { thumbs } from '../../src/ui/thumbs';
import type { InspectBuilding, InspectBuildingArgs } from '../../src/worker/inspect';
import { newState, place } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const lifetimes: AbortController[] = [];
beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  vi.spyOn(thumbs, 'cached').mockReturnValue(null);
});
afterEach(() => {
  for (const abort of lifetimes.splice(0)) abort.abort();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function report(b: Building): InspectBuilding {
  return { building: { ...b }, facility: null, waterRequired: false, needsExpectation: 1,
    condition: null, desirability: null, growth: null, landValue: 0.5, desirabilityValue: null,
    commute: 0, route: null, workerAccess: -1, jobFill: -1, customers: 0, freightAccess: -1,
    needs: [], providers: [], cohorts: [], landValueTerms: [], crime: null, environment: null };
}

function setup() {
  const st = newState(64), abort = new AbortController();
  lifetimes.push(abort);
  const home = place(st, 't_r1', 10, 10, { flags: BF.Powered });
  const turbine = place(st, 'util_wind_turbine', 20, 20, { flags: BF.Plopped });
  let args: InspectBuildingArgs, ready = false, version = 0;
  const setArgs = vi.fn((value: InspectBuildingArgs) => { args = value; });
  const host = { state: st, watch: vi.fn((_name: string, value: InspectBuildingArgs) => {
    args = value;
    return { get value() { return ready && st.buildings.has(args.id) ? report(st.buildings.get(args.id)!) : undefined; },
      get version() { return version; }, error: undefined, setArgs, subscribe: () => () => {}, dispose() {} };
  }) };
  const ctx = { host, state: st, signal: abort.signal, actions: { bulldoze: () => ({ ok: true, cost: 0 }) },
    objects: { setSelected() {} }, sound() {}, focusCell() {}, panels: { close() {} } } as unknown as GameContext;
  const panel = new InfoPanel(ctx);
  panel.mount(() => {}, () => {}, () => {});
  const body = panel.body as unknown as FEl;
  const why = () => body.querySelectorAll('.ins-sec').find((section) => textOf(section.querySelector('.ins-sec-t')!) === 'Why?');
  const show = (b: Building) => { panel.isOpen = true; panel.show({ buildingId: b.id, x: b.x, z: b.z }); };
  return { panel, abort, st, home, turbine, setArgs, why, show, body,
    ready: () => { ready = true; version++; panel.update(); } };
}

describe('guided inspector Why?', () => {
  it('opens before requesting the report and acknowledges once the expanded section exists', () => {
    const f = setup(), expanded = vi.fn(() => {
      expect(f.why()?.classList.contains('open')).toBe(true);
      expect(f.why()?.querySelector('.ins-sec-b')).toBeTruthy();
    });
    f.panel.guideWhy(expanded);
    f.show(f.home);
    expect(f.setArgs.mock.calls.at(-1)?.[0].sections).toContain('why');
    expect(f.why()).toBeUndefined();
    expect(expanded).not.toHaveBeenCalled();
    f.ready();
    expect(expanded).toHaveBeenCalledExactlyOnceWith(f.home.id);
    expect(f.why()?.classList.contains('guide-why')).toBe(true);
    expect(f.why()?.style.animation).toBe('pulse 1.6s ease-in-out 2');
    f.panel.update();
    expect(expanded).toHaveBeenCalledTimes(1);
  });

  it('can expand the current growable and leaves the saved collapse preference intact', () => {
    const f = setup(), expanded = vi.fn();
    f.show(f.home); f.ready();
    expect(f.why()?.classList.contains('open')).toBe(false);
    localStorage.setItem('metropolis.ui.inspector.sec.why', 'false');
    f.panel.guideWhy(expanded);
    expect(f.setArgs.mock.calls.at(-1)?.[0].sections).toContain('why');
    expect(expanded).toHaveBeenCalledExactlyOnceWith(f.home.id);
    expect(loadPref('inspector.sec.why', true)).toBe(false);
    f.why()!.querySelector('.ins-sec-h')!.click();
    expect(f.why()?.classList.contains('open')).toBe(false);
    f.show(f.home);
    expect(f.why()?.classList.contains('open')).toBe(false);
  });

  it('waits through a facility query for the next growable', () => {
    const f = setup(), expanded = vi.fn();
    f.panel.guideWhy(expanded);
    f.show(f.turbine); f.ready();
    expect(f.why()).toBeUndefined();
    expect(expanded).not.toHaveBeenCalled();
    f.show(f.home);
    expect(expanded).toHaveBeenCalledExactlyOnceWith(f.home.id);
  });

  it('does not acknowledge a retained target while the inspector is closed', () => {
    const f = setup(), expanded = vi.fn();
    f.show(f.home); f.ready();
    f.panel.isOpen = false; f.panel.onClose();
    f.panel.guideWhy(expanded);
    expect(expanded).not.toHaveBeenCalled();
    expect(f.why()?.classList.contains('open')).toBe(false);
    f.show(f.home);
    expect(expanded).toHaveBeenCalledExactlyOnceWith(f.home.id);
  });

  it('releases a pending callback on abort and ignores later arming', () => {
    const f = setup(), expanded = vi.fn(), later = vi.fn();
    f.panel.guideWhy(expanded); f.show(f.home);
    f.abort.abort();
    f.ready();
    f.panel.guideWhy(later);
    expect(expanded).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
  });
});
