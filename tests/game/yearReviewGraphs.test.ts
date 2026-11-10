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

function graphChange(state: CityState, range = 12): { change: number; from: string; to: string } {
  const title = new FEl('h4');
  const hover = new FEl('div');
  const context = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }) }, {
    get: (target, key) => Reflect.get(target, key) ?? (() => undefined),
  });
  const graph = Object.assign(Object.create(GraphsPanel.prototype), {
    ctx: { state }, cur: GRAPHS[0], range, titleH: title, legend: new FEl('div'), listBtns: new Map(),
    canvas: { clientWidth: 540, clientHeight: 280, width: 540, height: 280, getContext: () => context },
    hover, hoverX: 52,
  }) as GraphsPanel;
  graph.draw();
  const from = textOf(hover);
  Object.assign(graph, { hoverX: 528 });
  graph.draw();
  const trend = title.querySelector('.gt-d');
  expect(trend).not.toBeNull();
  return { change: Number(textOf(trend!).replace(/[^0-9.]/g, '')), from, to: textOf(hover) };
}

describe('year review population matches Graphs 1Y', () => {
  beforeEach(() => vi.stubGlobal('window', { devicePixelRatio: 1 }));
  afterEach(() => vi.unstubAllGlobals());

  it('prints the same twelve-month increase of 120 in the graph and card', () => {
    const state = city(0, 24), report = buildYearReview(state, 2002)!;
    const annual = state.history.pop[24] - state.history.pop[12];
    const graph = graphChange(state);
    expect({ graphs: graph.change, card: report.populationChange, annual }).toEqual({ graphs: 120, card: 120, annual: 120 });
    expect({ from: graph.from, to: graph.to }).toEqual({ from: 'Jan 2001 Population1,120', to: 'Jan 2002 Population1,240' });
    expect(report.growth).toBeCloseTo(120 / 1120, 12);
  });

  it('uses the same thirteen samples after the history cap drops earlier months', () => {
    const state = city(121, 720), report = buildYearReview(state, 2060)!;
    expect(state.history.t).toHaveLength(600);
    const graph = graphChange(state);
    expect({ graphs: graph.change, card: report.populationChange }).toEqual({ graphs: 120, card: 120 });
    expect({ from: graph.from, to: graph.to }).toEqual({ from: 'Jan 2059 Population8,080', to: 'Jan 2060 Population8,200' });
  });

  it('uses all available samples when fewer than thirteen have been recorded', () => {
    const state = city(19, 24), report = buildYearReview(state, 2002)!;
    const graph = graphChange(state);
    expect({ graphs: graph.change, card: report.populationChange }).toEqual({ graphs: 50, card: 50 });
    expect({ from: graph.from, to: graph.to }).toEqual({ from: 'Aug 2001 Population1,190', to: 'Jan 2002 Population1,240' });
    expect(report.growth).toBeCloseTo(50 / 1190, 12);
  });

  it('preserves the existing 5Y, 10Y and All intervals', () => {
    const state = city(0, 120);
    expect([60, 120, 0].map((range) => graphChange(state, range).change)).toEqual([590, 1190, 1200]);
  });
});
