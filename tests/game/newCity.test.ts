/**
 * FH-11: the New City dialog and the region screen point a newcomer at a good start. The difficulty cards carry FH-04's
 * one-line descriptions, a profile's first city opens on Easy with the guide and no disasters (later dialogs on the last
 * choice), Disasters has its note, and a region with no cities outlines and labels one recommended medium tile.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Difficulty } from '../../src/core/types';
import { defaultCityConfig, type CityConfigData } from '../../src/sim/config';
import { DIFFICULTY_RULES } from '../../src/sim/economy/tuning';
import { guideCopy } from '../../src/ui/guide/copy';
import { DISASTER_MIN_POP, NEW_CITY_TEXT, loadNewCityChoice, openNewCityDialog, type NewCityConfig, type NewCityDialogOptions } from '../../src/region/NewCityDialog';
import { createRegionData, generateRegionTerrain, type RegionModel } from '../../src/region/RegionModel';
import { GOOD_FIRST_CITY, RegionScreen } from '../../src/region/RegionScreen';
import type { RegionTile } from '../../src/region/types';
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

// ------------------------------------------------------------------ the dialog
const TILE: RegionTile = { key: '4_4', x: 4, z: 4, size: 2 };
/** the dialog reads only these of a region (the preview, drawn on a frame the fake DOM never runs, reads more) */
const REGION = {
  data: { name: 'Greenvale Valley' },
  cityConfigFor: (t: RegionTile, partial: Partial<CityConfigData> = {}) => defaultCityConfig({ size: t.size * 64, seed: 11, terrain: 'region', ...partial }),
} as unknown as RegionModel;

function open(o: Partial<NewCityDialogOptions> = {}) {
  root = new FEl('div');
  setUiRoot(root as unknown as HTMLElement);
  const result = openNewCityDialog({ region: REGION, tile: TILE, ...o });
  const cards = () => root.querySelector('.nc-diff')!.querySelectorAll('.seg-item');
  const card = (title: string) => cards().find((c) => textOf(c.querySelector('.si-t')!) === title)!;
  const toggles = () => root.querySelectorAll('.toggle');
  const input = (label: string) => toggles().find((t) => textOf(t) === label)?.querySelector('input') as (FEl & { checked: boolean }) | undefined;
  const tick = (label: string, on: boolean) => {
    const i = input(label)!;
    i.checked = on;
    i.fire('change');
  };
  const found = async (): Promise<NewCityConfig> => {
    root.querySelectorAll('button').find((b) => textOf(b) === 'Found City')!.click();
    const cfg = await result;
    if (!cfg) throw new Error('no city');
    return cfg;
  };
  const selected = () => cards().filter((c) => c.classList.contains('on')).map((c) => textOf(c.querySelector('.si-t')!));
  return { result, cards, card, input, tick, found, selected };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const stored = (k: string) => JSON.parse(store.get(`metropolis.ui.${k}`) ?? 'null') as Record<string, unknown> | null;

describe('FH-11 New City dialog', () => {
  it("a profile's first city opens on Easy and Guided start with the four descriptions and Disasters off", async () => {
    const d = open({ firstCity: true });
    expect(d.selected()).toEqual(['Easy']);
    expect(d.cards().map((c) => [textOf(c.querySelector('.si-t')!), textOf(c.querySelector('.si-s')!)])).toEqual(
      (['easy', 'medium', 'hard', 'sandbox'] as Difficulty[]).map((k) => [cap(k), cap(DIFFICULTY_RULES[k].blurb)]),
    );
    expect(textOf(d.card('Easy').querySelector('.si-s')!)).toBe('§250k, +20% taxes, forgiving first years · Recommended for your first city');
    expect(d.input('Disasters')!.checked).toBe(false);
    expect(d.input(NEW_CITY_TEXT.guided)!.checked).toBe(true);
    expect(textOf(root.querySelector('.nc-note')!)).toBe('Tornadoes, quakes and meteors can hit your town from 2,000 residents. Off is fine for your first city.');
    // the veteran briefing's toggle stays hidden until FH-18 wires it (NOTE-042)
    expect(d.input(NEW_CITY_TEXT.veteran)).toBeUndefined();
    const cfg = await d.found();
    expect(cfg).toMatchObject({ difficulty: 'easy', startFunds: 250_000, sandbox: false, disasters: false, guided: true, size: 128 });
  });

  it('Easy unticks Disasters, the other modes tick it again, and the player still decides', async () => {
    const d = open({ firstCity: true });
    d.card('Medium').click();
    expect(d.input('Disasters')!.checked).toBe(true);
    d.card('Easy').click();
    expect(d.input('Disasters')!.checked).toBe(false);
    d.card('Sandbox').click();
    expect(d.input('Disasters')!.checked).toBe(true);
    d.tick('Disasters', false);
    expect(await d.found()).toMatchObject({ difficulty: 'sandbox', sandbox: true, startFunds: 10_000_000, disasters: false });
  });

  it('later dialogs open on the last choice, whatever the profile', async () => {
    const a = open({ firstCity: true });
    a.card('Hard').click();
    a.tick(NEW_CITY_TEXT.guided, false);
    expect(await a.found()).toMatchObject({ difficulty: 'hard', disasters: true, guided: false });
    expect(stored('newCity')).toEqual({ difficulty: 'hard', disasters: true, guided: false });
    expect(loadNewCityChoice()).toEqual({ difficulty: 'hard', disasters: true, guided: false });
    for (const firstCity of [true, false]) {
      const b = open({ firstCity });
      expect(b.selected()).toEqual(['Hard']);
      expect(b.input('Disasters')!.checked).toBe(true);
      expect(b.input(NEW_CITY_TEXT.guided)!.checked).toBe(false);
    }
    // the guide's profile pref is not written while the veteran toggle is hidden
    expect(store.has('metropolis.ui.onboarding')).toBe(false);
  });

  it("a profile from before FH-11 opens on today's defaults, with the guide as the profile left it", async () => {
    const d = open({ firstCity: false });
    expect(d.selected()).toEqual(['Medium']);
    expect(d.input('Disasters')!.checked).toBe(true);
    expect(d.input(NEW_CITY_TEXT.guided)!.checked).toBe(true);
    store.set('metropolis.ui.onboarding', JSON.stringify({ dismissed: true, min: true }));
    expect(open({ firstCity: false }).input(NEW_CITY_TEXT.guided)!.checked).toBe(false);
    store.set('metropolis.ui.onboarding', JSON.stringify({ version: 1, dismissedAll: true }));
    expect(open({ firstCity: false }).input(NEW_CITY_TEXT.guided)!.checked).toBe(false);
  });

  it('explicit defaults win over the remembered choice; an invalid stored choice is ignored', () => {
    store.set('metropolis.ui.newCity', JSON.stringify({ difficulty: 'easy', disasters: false, guided: true }));
    const d = open({ defaults: { difficulty: 'hard' } });
    expect(d.selected()).toEqual(['Hard']);
    expect(d.input('Disasters')!.checked).toBe(true);
    for (const bad of [{ difficulty: 'expert', disasters: false, guided: true }, { difficulty: 'easy', disasters: 'no', guided: true }, ['easy']]) {
      store.set('metropolis.ui.newCity', JSON.stringify(bad));
      expect(loadNewCityChoice()).toBeNull();
      expect(open({ firstCity: false }).selected()).toEqual(['Medium']);
    }
  });

  it("words its texts as the guide's copy module does, and the disasters note names disasters.ts's threshold", () => {
    const a = guideCopy.phaseA;
    expect(NEW_CITY_TEXT.guided).toBe(a.A3Guided());
    expect(NEW_CITY_TEXT.veteran).toBe(a.A3Veteran());
    expect(NEW_CITY_TEXT.disasters(DISASTER_MIN_POP)).toBe(a.A3Disasters(DISASTER_MIN_POP));
    expect(GOOD_FIRST_CITY).toBe(a.A3Tile());
    const disasters = readFileSync(new URL('../../src/sim/infra/disasters.ts', import.meta.url), 'utf8');
    expect(disasters).toContain(`st.stats.population < ${DISASTER_MIN_POP})`);
  });
});

// ------------------------------------------------------------------ the recommended tile
/** quickstart's pickNiceTile as main.ts had it (FH-11 moved it to RegionModel.niceTile) */
function pickNiceTileOriginal(model: RegionModel, size: 1 | 2 | 4): RegionTile {
  const cands = model.data.tiles.filter((t) => t.size === size);
  const pool = cands.length ? cands : model.data.tiles;
  let best = pool[0], bestScore = -1e9;
  for (const t of pool) {
    const w = model.tileWaterFraction(t);
    const score = -Math.abs(w - 0.12) - (w > 0.4 ? 1 : 0) - Math.hypot(t.x + t.size / 2 - 8, t.z + t.size / 2 - 8) * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}
function region(seed: number, preset: 'greenvale' | 'highlands' | 'archipelago' = 'greenvale') {
  return createRegionData({ seed, preset, terrain: generateRegionTerrain(seed, preset, { samplesPerUnit: 8 }) }).model;
}

describe('FH-11 recommended first tile', () => {
  it.each([[4242, 'greenvale'], [7, 'highlands'], [99, 'archipelago']] as const)('region %i (%s): one medium tile, best by the quickstart score plus flat land; quickstart keeps its tile', (seed, preset) => {
    const model = region(seed, preset);
    for (const size of [1, 2, 4] as const) expect(model.niceTile(size)).toBe(pickNiceTileOriginal(model, size));
    const rec = model.recommendedTile()!;
    expect(rec.size).toBe(2);
    const score = (t: RegionTile) => {
      const w = model.tileWaterFraction(t);
      return -Math.abs(w - 0.12) - (w > 0.4 ? 1 : 0) - Math.hypot(t.x + t.size / 2 - 8, t.z + t.size / 2 - 8) * 0.01 + model.tileFlatFraction(t);
    };
    for (const t of model.data.tiles) if (t.size === 2) expect(score(t)).toBeLessThanOrEqual(score(rec));
    for (const t of model.data.tiles) {
      const f = model.tileFlatFraction(t);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    // the same region recommends the same tile every time
    expect(region(seed, preset).recommendedTile()!.key).toBe(rec.key);
  });

  it('a region with any city recommends nothing', () => {
    const model = region(4242);
    const t = model.data.tiles.find((x) => x.size === 1)!;
    t.city = { name: 'Riverton', mayor: 'M', population: 0, r: 0, c: 0, i: 0, funds: 0, lastPlayed: 0, founded: 0, difficulty: 'easy' };
    expect(model.recommendedTile()).toBeNull();
  });
});

// ------------------------------------------------------------------ the region screen
type ScreenInternals = { setRecommended(t: RegionTile | null): void; updateLabels(force?: boolean): void; recommended: RegionTile | null };
class ListEl extends FEl {
  replaceChildren(...children: (FNode | string)[]): void { this.textContent = ''; this.append(...children); }
}

/** RegionScreen's real label, list and outline code on stand-ins for its WebGL view (as tests/game/labelFrame.test.ts) */
function screenWith(tiles: RegionTile[]) {
  const camera = new THREE.PerspectiveCamera(40, 800 / 600, 1, 100000);
  camera.position.set(8000, 9000, 16000);
  camera.lookAt(8000, 0, 8000);
  camera.updateMatrixWorld();
  const terrain = { setRecommended: vi.fn() };
  const view = { camera, terrain, selectedTile: null, tileCenter: (t: RegionTile) => new THREE.Vector3((t.x + t.size / 2) * 1024, 260, (t.z + t.size / 2) * 1024) };
  const layer = new FEl('div'), list = new ListEl('div');
  const screen = Object.assign(Object.create(RegionScreen.prototype), {
    view, model: { data: { tiles } }, labels: new Map(), labelLayer: layer, list,
    labelView: new THREE.Matrix4(), labelProjection: new THREE.Matrix4(), labelsMoving: false,
    labelsDisposed: false, lastLabels: -Infinity, labelWidth: 800, labelHeight: 600,
  }) as ScreenInternals;
  return { screen, layer, list, terrain };
}

describe('FH-11 region screen: "A good first city for you"', () => {
  it('outlines the tile, labels it above its centre and points the empty city list at it; none once it is gone', () => {
    const tiles: RegionTile[] = [{ key: '0_0', x: 0, z: 0, size: 4 }, { key: '6_6', x: 6, z: 6, size: 2 }];
    const f = screenWith(tiles);
    f.screen.setRecommended(tiles[1]);
    expect(f.terrain.setRecommended).toHaveBeenLastCalledWith(tiles[1]);
    const labels = f.layer.querySelectorAll('.city-label');
    expect(labels).toHaveLength(1);
    expect(labels[0].classList.contains('recommend')).toBe(true);
    expect(textOf(labels[0])).toBe('A good first city for you');
    expect(labels[0].style.opacity).toBe('1');
    expect(labels[0].style.transform).toMatch(/^translate\([\d.]+px, [\d.]+px\) translate\(-50%, -100%\)$/);
    expect(textOf(f.list)).toBe('No cities yet. Click the tile marked “A good first city for you”, then Found New City.');
    f.screen.setRecommended(null);
    expect(f.terrain.setRecommended).toHaveBeenLastCalledWith(null);
    expect(f.layer.querySelectorAll('.city-label')).toHaveLength(0);
    expect(textOf(f.list)).toBe('No cities yet. Click any tile on the map, then Found New City to start building.');
  });
});
