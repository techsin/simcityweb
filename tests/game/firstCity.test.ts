/**
 * FH-12: "Start your first city" on the title screen (POLISH_PLAN FH-12, §4.3 A1-A2).
 * - With no region saved, the title's primary button is "Start your first city" with its sub-line; New Region comes
 *   second, and the dead-end disabled Continue is gone. A saved region keeps today's menu.
 * - One click makes a Greenvale Valley region with a unique id (an existing region is never overwritten), and a city
 *   config on FH-11's recommended tile: Easy, Disasters off, region terrain, with Guided start recorded.
 * - The first-city loading screen rotates the three first-city tips, in order.
 * - Continue on a region left from its region screen selects its last-played city.
 * - main.ts's wiring, read from its source (App is not exported and main.ts boots on import, as playLoadTime.test.ts and
 *   graphicsFirstRun.test.ts read it): the title gets onFirstCity only with no region saved; one loading screen, with the
 *   first-city tips, is handed to startNewCity (which founds on day 90). The paused city with the guide card is in the
 *   report's Desktop QA list.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

const sounds = vi.hoisted(() => ({ played: [] as string[], inits: 0 }));
vi.mock('../../src/audio', () => ({
  audio: { init: () => void sounds.inits++, play: (s: string) => void sounds.played.push(s) },
}));
// the title's 3D background and music pill need WebGL and Web Audio: stand-ins
vi.mock('../../src/region/render/MenuBackground', () => ({
  MenuBackground: class {
    onFirstFrame: (() => void) | null = null;
    start(): void { this.onFirstFrame?.(); }
    dispose(): void {}
  },
}));
vi.mock('../../src/ui/MusicPlayer', () => ({
  MusicPlayer: class {
    el = document.createElement('div');
    dispose(): void {}
  },
}));

import { TitleScreen, type TitleScreenOptions } from '../../src/region/ui/TitleScreen';
import { LoadingScreen } from '../../src/region/ui/LoadingScreen';
import {
  FIRST_CITY_PRESET,
  createFirstCity,
  firstCityTips,
  hasSavedRegion,
  lastCityTileKey,
  planFirstCity,
  savedRegionIds,
  uniqueRegionId,
} from '../../src/region/firstCity';
import { createRegionData, newRegionId, PRESET_BY_ID } from '../../src/region/RegionModel';
import { newCityDefaults } from '../../src/region/newCityPrefs';
import type { RegionData } from '../../src/region/types';
import { MemoryKV, getLastSession, loadRegion, saveRegion, setKV } from '../../src/save';

installFakeDom();
// LoadingScreen swaps its tip with replaceChildren, which the shared fake DOM does not have
const proto = FEl.prototype as unknown as { replaceChildren?: (...cs: (FNode | string)[]) => void };
beforeAll(() => {
  proto.replaceChildren = function (this: FEl, ...cs: (FNode | string)[]) {
    this.textContent = '';
    this.append(...cs);
  };
});
afterAll(() => void delete proto.replaceChildren);

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('Node', FNode);
  sounds.played = [];
  sounds.inits = 0;
  setKV(new MemoryKV());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const WIND_TIP = 'Start small: 3 wind turbines power about 2,500 of your first residents.';
const ZONES_TIP = 'Your zones only grow next to roads.';
const PLAY_TIP = 'The game waits for you until you press Play.';

/** the title's menu: each item's label, sub-line, primary and disabled flags */
function menu(o: Partial<TitleScreenOptions>) {
  const root = new FEl('div');
  const calls: string[] = [];
  const opts: TitleScreenOptions = {
    onNewRegion: () => calls.push('new'),
    onLoadRegion: () => calls.push('load'),
    onSettings: () => calls.push('settings'),
    onCredits: () => calls.push('credits'),
    ...o,
  };
  new TitleScreen(root as unknown as HTMLElement, opts);
  const items = root.querySelectorAll('button.menu-item').map((b) => ({
    el: b,
    label: textOf(b.querySelector('.mi-text')!.children[0]),
    sub: b.querySelector('.mi-sub') ? textOf(b.querySelector('.mi-sub')!) : null,
    primary: b.classList.contains('primary'),
    // h() sets a true boolean as its attribute, as the DOM reads it
    disabled: b.disabled || b.getAttribute('disabled') !== null,
  }));
  return { items, calls };
}

describe('FH-12: the title screen', () => {
  it('with no region saved leads with "Start your first city"; New Region comes second; no dead-end Continue', () => {
    let started = 0;
    const { items, calls } = menu({ continueInfo: null, onFirstCity: () => void started++ });
    expect(items.map((i) => i.label)).toEqual(['Start your first city', 'Create a new region', 'Load Region', 'Settings', 'Credits']);
    expect(items[0]).toMatchObject({ sub: 'Guided · your first road in about 2 minutes', primary: true, disabled: false });
    expect(items.filter((i) => i.primary)).toHaveLength(1);
    expect(items.some((i) => i.disabled)).toBe(false);
    // one click founds the first city, with the founding fanfare (the New City dialog's Found City sound)
    items[0].el.click();
    expect(started).toBe(1);
    expect(sounds.played).toEqual(['found']);
    items[1].el.click();
    expect(calls).toEqual(['new']);
  });

  it('a saved region keeps the menu as it was: Continue first and primary, then New Region', () => {
    let continued = 0;
    const { items } = menu({ continueInfo: { title: 'Riverside', sub: 'Greenvale Valley · 1,204 residents · 2 min ago' }, onContinue: () => void continued++ });
    expect(items.map((i) => i.label)).toEqual(['Continue', 'New Region', 'Load Region', 'Settings', 'Credits']);
    expect(items[0]).toMatchObject({ sub: 'Riverside · Greenvale Valley · 1,204 residents · 2 min ago', primary: true });
    expect(items[1].primary).toBe(false);
    items[0].el.click();
    expect(continued).toBe(1);
    expect(sounds.played).toEqual(['confirm']);
  });

  it('regions saved but no last session: the disabled Continue and a primary New Region, as before', () => {
    const { items } = menu({ continueInfo: null });
    expect(items.slice(0, 2).map((i) => [i.label, i.sub, i.primary, i.disabled])).toEqual([
      ['Continue', 'No saved region yet', false, true],
      ['New Region', null, true, false],
    ]);
  });
});

describe('FH-12: the first-city loading screen', () => {
  it('rotates the three first-city tips in order, every 5 s, and no general tip', () => {
    vi.useFakeTimers();
    expect(firstCityTips()).toEqual([WIND_TIP, ZONES_TIP, PLAY_TIP]);
    const root = new FEl('div');
    const ld = new LoadingScreen(root as unknown as HTMLElement, undefined, firstCityTips());
    // the tip's text after its "Tip" label
    const tip = () => textOf(root.querySelector('.ld-tip')!.childNodes.at(-1)!);
    const seen = [tip()];
    for (let k = 0; k < 4; k++) {
      vi.advanceTimersByTime(5000);
      seen.push(tip());
    }
    expect(seen).toEqual([WIND_TIP, ZONES_TIP, PLAY_TIP, WIND_TIP, ZONES_TIP]);
    ld.remove();
  });

  it('other loading screens keep the general tips', () => {
    const root = new FEl('div');
    const ld = new LoadingScreen(root as unknown as HTMLElement);
    const tip = root.querySelector('.ld-tip')!;
    expect(textOf(tip.querySelector('b')!)).toBe('Tip');
    const first = textOf(tip.childNodes.at(-1)!);
    expect(first.length).toBeGreaterThan(20);
    expect([WIND_TIP, ZONES_TIP, PLAY_TIP]).not.toContain(first);
    ld.remove();
  });
});

describe('FH-12: region ids (an existing region is never overwritten)', () => {
  it('a new id is none of the saved ids, even from a generator that keeps clashing', () => {
    const taken = ['r1', 'r2', 'quickstart'];
    let n = 0;
    const clash = () => taken[n++ % 2];
    const id = uniqueRegionId(taken, clash);
    expect(taken).not.toContain(id);
    expect(uniqueRegionId(taken, () => 'r1')).not.toBe('r1');
    // the game's own ids: time + random, never the quickstart path's fixed id
    for (let k = 0; k < 50; k++) {
      const fresh = uniqueRegionId(taken);
      expect(fresh).toMatch(/^r[0-9a-z]+$/);
      expect(taken).not.toContain(fresh);
    }
  });

  it('the first city never replaces a saved region, even when the generated id is already taken', async () => {
    // an existing region with a city, whose id the generator will produce again (time and randomness frozen)
    vi.spyOn(Date, 'now').mockReturnValue(1_799_000_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.4242);
    const clashing = newRegionId();
    const { data: old } = createRegionData({ seed: 99, preset: 'azure-coast', id: clashing, name: 'My Old Region' });
    old.tiles[0].city = { name: 'Oldtown', mayor: 'M', population: 12_345, r: 1, c: 2, i: 3, founded: 0, lastPlayed: 5, difficulty: 'medium' } as RegionData['tiles'][0]['city'];
    await saveRegion(old);
    const before = JSON.stringify(await loadRegion(clashing));
    expect(await hasSavedRegion()).toBe(true);

    const first = await createFirstCity();
    expect(first.data.id).not.toBe(clashing);
    expect(JSON.stringify(await loadRegion(clashing))).toBe(before);
    expect((await savedRegionIds()).sort()).toEqual([clashing, first.data.id].sort());
  });
});

describe('FH-12: one click makes the first city', () => {
  it('plans a Greenvale Valley region and a city on its recommended tile: Easy, Disasters off, region terrain', () => {
    const plan = planFirstCity(['quickstart'], { seed: 7 });
    expect(plan.data).toMatchObject({ preset: FIRST_CITY_PRESET, name: PRESET_BY_ID.greenvale.name, seed: 7 });
    expect(plan.data.name).toBe('Greenvale Valley');
    expect(plan.data.id).not.toBe('quickstart');
    expect(plan.data.tiles.some((t) => t.city)).toBe(false);
    // FH-11's "A good first city": the same medium tile the region screen outlines
    expect(plan.tile).toBe(plan.model.recommendedTile());
    expect(plan.tile.size).toBe(2);
    expect(plan.cfg).toMatchObject({
      difficulty: 'easy', startFunds: 250_000, disasters: false, sandbox: false, terrain: 'region',
      regionId: plan.data.id, tileX: plan.tile.x, tileZ: plan.tile.z, size: 128, climate: plan.data.climate,
    });
    expect(plan.cfg.name.length).toBeGreaterThan(0);
    expect(plan.cfg.mayor.length).toBeGreaterThan(0);
  });

  it('stores the region before anything is founded, makes it the last region, and records Guided start and Easy', async () => {
    // a profile that once dismissed the guide and founded on Hard: the first city still opens guided, on Easy
    store.set('metropolis.ui.onboarding', JSON.stringify({ dismissed: true, dismissedAll: true, veteran: true }));
    store.set('metropolis.ui.newCity', JSON.stringify({ difficulty: 'hard' }));
    expect(await hasSavedRegion()).toBe(false);
    const drawn: string[] = [];
    const first = await createFirstCity((m) => drawn.push(m.data.id));
    expect(drawn).toEqual([first.data.id]);
    const saved = await loadRegion(first.data.id);
    expect(saved?.name).toBe('Greenvale Valley');
    expect(saved?.tiles.some((t) => t.city)).toBe(false);
    expect(await hasSavedRegion()).toBe(true);
    expect(store.get('metropolis.lastRegion')).toBe(first.data.id);
    expect(getLastSession()).toMatchObject({ regionId: first.data.id });
    expect(getLastSession()?.tileKey).toBeUndefined();
    expect(newCityDefaults(false)).toEqual({ difficulty: 'easy', guided: true, veteran: false });
    expect(JSON.parse(store.get('metropolis.ui.onboarding')!)).toMatchObject({ dismissed: false, dismissedAll: false, veteran: false });
  });
});

describe('FH-12: Continue returns to the city', () => {
  it('a region left from its region screen opens with its last-played city selected', () => {
    const { data } = createRegionData({ seed: 3, preset: 'greenvale' });
    expect(lastCityTileKey(data)).toBeUndefined();
    const city = (lastPlayed: number) => ({ name: 'C', mayor: 'M', population: 1, r: 0, c: 0, i: 0, founded: 0, lastPlayed, difficulty: 'easy' }) as RegionData['tiles'][0]['city'];
    data.tiles[2].city = city(100);
    data.tiles[5].city = city(300);
    data.tiles[7].city = city(200);
    expect(lastCityTileKey(data)).toBe(data.tiles[5].key);
  });
});

describe('FH-12: main.ts wiring (source)', () => {
  const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
  /** the body of App method `name` (from its signature to the first line that closes it at two spaces) */
  const method = (sig: string) => {
    const start = main.indexOf(sig);
    expect(start, sig).toBeGreaterThan(-1);
    return main.slice(start, main.indexOf('\n  }\n', start));
  };

  it('the title offers the first city only when no region is saved', () => {
    const title = method('  async showTitle(');
    expect(title).toMatch(/const firstRun = !last && !\(await hasSavedRegion\(\)/);
    expect(title).toMatch(/onFirstCity: firstRun \? \(\) => void this\.startFirstCity\(\) : undefined/);
    // Continue on a region left from its region screen selects its last-played city
    expect(title).toMatch(/this\.openRegion\(last!, lastCityTileKey\(last!\)\)/);
  });

  it('one click: one loading screen with the first-city tips, the first city made, then founded on that same screen', () => {
    const first = method('  private async startFirstCity(');
    expect(first.match(/new LoadingScreen\(/g)).toHaveLength(1);
    expect(first).toMatch(/const ld = new LoadingScreen\(this\.root, undefined, firstCityTips\(\)\)/);
    expect(first).toMatch(/await createFirstCity\(/);
    expect(first).toMatch(/this\.region = first\.model;/);
    expect(first).toMatch(/await this\.startNewCity\(first\.model, first\.tile, first\.cfg, t0, ld\)/);
    // a second click (Enter on the focused button under the loading screen) makes no second region
    expect(first.indexOf('if (this.busy) return;')).toBeGreaterThan(-1);
    expect(first.indexOf('if (this.busy) return;')).toBeLessThan(first.indexOf('new LoadingScreen('));
    // startNewCity keeps a loading screen it is handed (no second one), and founds on day 90 (FEEL-05)
    const found = method('  private async startNewCity(');
    expect(found).toMatch(/existing\?: LoadingScreen/);
    expect(found).toMatch(/const ld = existing \?\? new LoadingScreen\(this\.root\)/);
    expect(found).toMatch(/st\.day = FOUNDING_DAY;/);
  });
});
