/**
 * FH-11: the New City dialog and the region screen point a newcomer at a good start.
 * - The difficulty cards carry FH-04's one-line descriptions (difficultyRules().blurb).
 * - A profile's first city preselects Easy and Guided start; later dialogs the last choice (src/region/newCityPrefs.ts).
 * - Easy unticks Disasters, with a note on when disasters start; the player's own choice then sticks.
 * - A region with no city recommends one medium tile, scored like quickstart's pick plus its flat buildable land.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openNewCityDialog } from '../../src/region/NewCityDialog';
import { newCityDefaults, rememberNewCity } from '../../src/region/newCityPrefs';
import { createRegionData, type RegionModel } from '../../src/region/RegionModel';
import type { RegionTile } from '../../src/region/types';
import { defaultCityConfig, type CityConfigData } from '../../src/sim/config';
import { DISASTER_MIN_POP, difficultyRules } from '../../src/sim/economy/tuning';
import { setUiRoot } from '../../src/region/ui/modal';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

installFakeDom();
let store: Map<string, string>;
let root: FEl;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('Node', FNode);
  vi.stubGlobal('window', new FEl('window'));
  root = new FEl('div');
  setUiRoot(root as unknown as HTMLElement);
});
afterEach(() => vi.unstubAllGlobals());

const guidePref = () => JSON.parse(store.get('metropolis.ui.onboarding') ?? 'null') as Record<string, unknown> | null;

/** a region stand-in: a medium tile to found on, and `founded` tiles that already hold a city */
function region(founded = 0): RegionModel {
  const tile: RegionTile = { key: '6,6', x: 6, z: 6, size: 2 } as RegionTile;
  const tiles = [tile, ...Array.from({ length: founded }, (_, k) => ({ key: `${k},0`, x: k, z: 0, size: 1, city: { name: 'Old' } }) as unknown as RegionTile)];
  return { data: { name: 'Test Valley', tiles }, cityConfigFor: (_t: RegionTile, p: Partial<CityConfigData> = {}) => defaultCityConfig({ size: 128, terrain: 'region', ...p }) } as unknown as RegionModel;
}

/** open the dialog on the stand-in region; returns its parts and the promise of its result */
function open(founded = 0) {
  const m = region(founded);
  const result = openNewCityDialog({ region: m, tile: m.data.tiles[0] });
  const dlg = root.querySelector('.modal')!;
  const diff = dlg.querySelector('.nc-diff')!;
  const switchOf = (label: string) => dlg.querySelectorAll('label').find((l) => l.classList.contains('toggle') && textOf(l) === label)!.querySelector('input') as unknown as { checked: boolean; fire(t: string): void };
  const set = (label: string, on: boolean) => { const i = switchOf(label); i.checked = on; i.fire('change'); };
  const card = (title: string) => diff.querySelectorAll('.seg-item').find((b) => textOf(b.querySelector('.si-t')!) === title)!;
  const found = () => dlg.querySelectorAll('button').find((b) => textOf(b) === 'Found City')!.click();
  return { dlg, diff, switchOf, set, card, found, result };
}

describe('FH-11: the New City dialog on a fresh profile', () => {
  it('opens on Easy and Guided start, shows the four descriptions, and Disasters is off with its note', async () => {
    const d = open();
    expect(d.diff.querySelectorAll('.seg-item.on').map((b) => textOf(b.querySelector('.si-t')!))).toEqual(['Easy']);
    const subs = d.diff.querySelectorAll('.si-s').map((e) => textOf(e));
    expect(subs).toHaveLength(4);
    for (const [k, diff] of (['easy', 'medium', 'hard', 'sandbox'] as const).entries()) {
      const b = difficultyRules(diff).blurb;
      expect(subs[k]).toBe(b.charAt(0).toUpperCase() + b.slice(1));
    }
    expect(subs[0]).toBe('§250k, +20% taxes, forgiving first years · Recommended for your first city');
    expect(d.switchOf('Disasters').checked).toBe(false);
    expect(d.switchOf('Guided start').checked).toBe(true);
    expect(d.switchOf('I’ve played city builders before').checked).toBe(false);
    expect(textOf(d.dlg.querySelector('.nc-note')!)).toBe(`Tornadoes, quakes and meteors can hit your town from ${DISASTER_MIN_POP.toLocaleString('en-US')} residents. Off is fine for your first city.`);
    d.found();
    const cfg = (await d.result)!;
    expect(cfg).toMatchObject({ difficulty: 'easy', startFunds: 250_000, disasters: false, sandbox: false });
  });

  it('Disasters follows the difficulty until the player sets it', async () => {
    const d = open();
    d.card('Medium').click();
    expect(d.switchOf('Disasters').checked).toBe(true);
    d.card('Easy').click();
    expect(d.switchOf('Disasters').checked).toBe(false);
    d.set('Disasters', true);
    d.card('Hard').click();
    d.card('Easy').click();
    expect(d.switchOf('Disasters').checked).toBe(true);
    d.found();
    expect((await d.result)!).toMatchObject({ difficulty: 'easy', disasters: true, startFunds: 250_000 });
  });

  it('the veteran box and Guided start exclude each other; the choice reaches the guide', async () => {
    const d = open();
    d.set('I’ve played city builders before', true);
    expect(d.switchOf('Guided start').checked).toBe(false);
    d.found();
    await d.result;
    expect(guidePref()).toMatchObject({ dismissed: true, dismissedAll: true, veteran: true });
  });
});

describe('FH-11: later dialogs remember the last choice', () => {
  it('the next dialog preselects the last difficulty, and Guided start as left', async () => {
    const d = open();
    d.card('Hard').click();
    d.set('Guided start', false);
    d.found();
    await d.result;
    expect(guidePref()).toMatchObject({ dismissed: true, veteran: false });
    root = new FEl('div');
    setUiRoot(root as unknown as HTMLElement);
    const next = open(1);
    expect(next.diff.querySelectorAll('.seg-item.on').map((b) => textOf(b.querySelector('.si-t')!))).toEqual(['Hard']);
    expect(next.switchOf('Guided start').checked).toBe(false);
    expect(next.switchOf('Disasters').checked).toBe(true);
    // ticking Guided start again opens the founding steps in the next city (the guide's dismissal is cleared)
    next.set('Guided start', true);
    next.found();
    await next.result;
    expect(guidePref()).toMatchObject({ dismissed: false, dismissedAll: false, veteran: false });
  });

  it('a profile that founded cities before FH-11 keeps Medium in a region with cities; a dismissed guide is not preselected', () => {
    store.set('metropolis.ui.onboarding', JSON.stringify({ dismissed: true, min: true }));
    expect(newCityDefaults(true)).toEqual({ difficulty: 'medium', guided: false, veteran: false });
    expect(newCityDefaults(false).difficulty).toBe('easy');
    rememberNewCity({ difficulty: 'sandbox', guided: true, veteran: false });
    expect(newCityDefaults(true)).toEqual({ difficulty: 'sandbox', guided: true, veteran: false });
    // the guide's own keys stay (minimised card)
    expect(guidePref()).toMatchObject({ min: true, dismissed: false });
  });
});

describe('FH-11: the recommended first-city tile', () => {
  const { model } = createRegionData({ seed: 4242, preset: 'greenvale', id: 'fh11' });

  it('is one medium tile, scored like quickstart\'s pick plus its flat buildable land', () => {
    const rec = model.recommendedTile()!;
    expect(rec.size).toBe(2);
    expect(model.recommendedTile()).toBe(rec);
    const plain = model.pickNiceTile(2);
    const score = (t: RegionTile, flat: boolean) => {
      const w = model.tileWaterFraction(t);
      return -Math.abs(w - 0.12) - (w > 0.4 ? 1 : 0) - Math.hypot(t.x + t.size / 2 - 8, t.z + t.size / 2 - 8) * 0.01 + (flat ? model.tileFlatFraction(t) : 0);
    };
    for (const t of model.data.tiles.filter((x) => x.size === 2)) expect(score(t, true)).toBeLessThanOrEqual(score(rec, true) + 1e-12);
    expect(model.tileFlatFraction(rec)).toBeGreaterThanOrEqual(model.tileFlatFraction(plain));
    expect(model.tileFlatFraction(rec)).toBeGreaterThan(0.5);
  });

  it('goes away once the region has a city, and comes back when it has none again', () => {
    const t = model.data.tiles.find((x) => x.size === 1)!;
    t.city = { name: 'First' } as RegionTile['city'];
    expect(model.recommendedTile()).toBeNull();
    t.city = undefined;
    expect(model.recommendedTile()?.size).toBe(2);
  });
});
