/** The Gazette's resident change uses the population graph's actual 1Y header interval. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CityState, HISTORY_KEYS } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { buildYearReview } from '../../src/ui/YearReview';
import { GRAPHS, GraphsPanel } from '../../src/ui/panels/GraphsPanel';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();

function city(first: number, last: number): CityState {
  const state = new CityState(defaultCityConfig({ startYear: 2000 }));
  for (let t = first; t <= last; t++) {
    for (const key of HISTORY_KEYS) state.history[key].push(0);
    const i = state.history.t.length - 1;
    state.history.t[i] = t;
    state.history.pop[i] = 1000 + 10 * t;
  }
  state.day = last * 30;
  return state;
}

function graphChange(state: CityState): number {
  const title = new FEl('h4');
  const context = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }) }, {
    get: (target, key) => Reflect.get(target, key) ?? (() => undefined),
  });
  const graph = Object.assign(Object.create(GraphsPanel.prototype), {
    ctx: { state }, cur: GRAPHS[0], range: 12, titleH: title, legend: new FEl('div'), listBtns: new Map(),
    canvas: { clientWidth: 540, clientHeight: 280, width: 540, height: 280, getContext: () => context },
    hover: new FEl('div'), hoverX: null,
  }) as GraphsPanel;
  graph.draw();
  const trend = title.querySelector('.gt-d');
  expect(trend).not.toBeNull();
  return Number(textOf(trend!).replace(/[^0-9.]/g, ''));
}

describe('year review population matches Graphs 1Y', () => {
  beforeEach(() => vi.stubGlobal('window', { devicePixelRatio: 1 }));
  afterEach(() => vi.unstubAllGlobals());

  it('prints the graph delta of 110 beside a true twelve-month increase of 120', () => {
    const state = city(0, 24), report = buildYearReview(state, 2002)!;
    const annual = state.history.pop[24] - state.history.pop[12];
    expect({ graphs: graphChange(state), card: report.populationChange, annual }).toEqual({ graphs: 110, card: 110, annual: 120 });
    expect(report.growth).toBeCloseTo(110 / 1130, 12);
  });

  it('uses the same twelve samples after the history cap drops earlier months', () => {
    const state = city(121, 720), report = buildYearReview(state, 2060)!;
    expect(state.history.t).toHaveLength(600);
    expect({ graphs: graphChange(state), card: report.populationChange }).toEqual({ graphs: 110, card: 110 });
  });

  it('uses all available samples when fewer than twelve have been recorded', () => {
    const state = city(19, 24), report = buildYearReview(state, 2002)!;
    expect({ graphs: graphChange(state), card: report.populationChange }).toEqual({ graphs: 50, card: 50 });
    expect(report.growth).toBeCloseTo(50 / 1190, 12);
  });
});
