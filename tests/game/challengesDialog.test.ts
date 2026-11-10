/**
 * LG-14: the Challenges menu and the Mayor's challenges, outside the city.
 * - The title screen's "Challenges" entry (when the app provides it), with the profile's medals as its sub-line.
 * - The Challenges dialog: the three scenarios, what each medal takes, the medal the profile holds; Start resolves it.
 * - Starting a scenario: Boomtown is a new region and a city config on the scenario land; Lights Out and Smog City are
 *   their bundled region files, stored through the save layer's own import under a new id. Every start gets a region of
 *   its own, an earlier region or attempt is never touched, and the guide's profile settings stay as they were.
 * - The New City dialog's Mayor's challenges: chips that end up in the city config (config.challenges), with Hard
 *   money's starting funds and Frequent disasters' switch.
 * - The badges on the region screen.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

const sounds = vi.hoisted(() => ({ played: [] as string[] }));
vi.mock('../../src/audio', () => ({ audio: { init: () => undefined, play: (s: string) => void sounds.played.push(s) } }));
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

import { BOOMTOWN, NEW_CITY_DAY, SCENARIOS, SCENARIO_LAND, recordScenarioRun, scenarioOf } from '../../src/game/scenarios';
import { cityBadges, importScenario, planScenarioCity, regionBadges, runChallenges, scenarioTips, startScenario, SCENARIO_REGION, type ScenarioApp } from '../../src/region/challenges';
import { openChallengesDialog, openNewCityDialog } from '../../src/region/NewCityDialog';
import type { RegionModel } from '../../src/region/RegionModel';
import type { RegionCitySummary, RegionData, RegionTile } from '../../src/region/types';
import { LoadingScreen } from '../../src/region/ui/LoadingScreen';
import { setUiRoot } from '../../src/region/ui/modal';
import { TitleScreen, type TitleScreenOptions } from '../../src/region/ui/TitleScreen';
import { MemoryKV, getLastRegionId, loadCity, loadRegion, saveRegion, setKV } from '../../src/save';
import { DIFFICULTY_FUNDS, defaultCityConfig, type CityConfigData } from '../../src/sim/config';
import { bundlePath } from '../../tools/scenarios';

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
  setKV(new MemoryKV());
  sounds.played = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** a bundle as the game's reader takes it, already unpacked (no browser stream in node) */
const bundle = (id: 'lights_out' | 'smog_city'): Uint8Array => new Uint8Array(gunzipSync(readFileSync(bundlePath(id))));

// ------------------------------------------------------------------------------------------------ title screen
function menu(o: Partial<TitleScreenOptions>) {
  const host = new FEl('div');
  const opts: TitleScreenOptions = { onNewRegion: () => undefined, onLoadRegion: () => undefined, onSettings: () => undefined, onCredits: () => undefined, ...o };
  new TitleScreen(host as unknown as HTMLElement, opts);
  return host.querySelectorAll('button.menu-item').map((b) => ({
    el: b, label: textOf(b.querySelector('.mi-text')!.children[0]), sub: b.querySelector('.mi-sub') ? textOf(b.querySelector('.mi-sub')!) : null,
  }));
}

describe('LG-14: the title screen\'s Challenges entry', () => {
  it('is in the menu when the app provides it: after Load Region, before Settings', () => {
    let opened = 0;
    const fresh = menu({ continueInfo: null, onFirstCity: () => undefined, onChallenges: () => void opened++ });
    expect(fresh.map((i) => i.label)).toEqual(['Start your first city', 'Create a new region', 'Load Region', 'Challenges', 'Settings', 'Credits']);
    const saved = menu({ continueInfo: { title: 'Riverside', sub: 'x' }, onContinue: () => undefined, onChallenges: () => void opened++ });
    expect(saved.map((i) => i.label)).toEqual(['Continue', 'New Region', 'Load Region', 'Challenges', 'Settings', 'Credits']);
    expect(saved[3].sub).toBe('3 scenarios · no medal yet');
    saved[3].el.click();
    expect(opened).toBe(1);
  });

  it('shows the profile\'s medals in its sub-line', () => {
    recordScenarioRun('r1:1_1', 'boomtown', { result: { medal: 'silver', month: 120 } });
    recordScenarioRun('r2:1_1', 'lights_out', { result: { medal: 'gold', month: 4 } });
    expect(menu({ onChallenges: () => undefined })[3].sub).toBe('3 scenarios · 2 medals');
  });

  it('without it the menu is the one it was', () => {
    expect(menu({ continueInfo: null, onFirstCity: () => undefined }).map((i) => i.label)).toEqual(['Start your first city', 'Create a new region', 'Load Region', 'Settings', 'Credits']);
    expect(menu({ continueInfo: { title: 'R', sub: 'x' }, onContinue: () => undefined }).map((i) => i.label)).toEqual(['Continue', 'New Region', 'Load Region', 'Settings', 'Credits']);
  });
});

// ------------------------------------------------------------------------------------------------ Challenges dialog
function challenges() {
  const result = openChallengesDialog();
  const dlg = root.querySelector('.modal')!;
  const items = () => dlg.querySelectorAll('.seg-item').map((b) => ({
    el: b, title: textOf(b.querySelector('.si-t')!.childNodes[0]), sub: textOf(b.querySelector('.si-s')!), on: b.classList.contains('on'),
    medal: b.querySelector('.ch-badge') ? textOf(b.querySelector('.ch-badge')!) : null,
  }));
  const detail = () => ({
    title: textOf(dlg.querySelector('h3')!),
    brief: textOf(dlg.querySelector('.ch-brief')!),
    goals: dlg.querySelectorAll('.ch-goal').map((g) => textOf(g)),
    best: textOf(dlg.querySelector('.ch-best')!),
  });
  const button = (label: string) => dlg.querySelectorAll('button').find((b) => textOf(b) === label)!;
  return { dlg, items, detail, button, result };
}

describe('LG-14: the Challenges dialog', () => {
  it('lists the three scenarios and shows the chosen one\'s briefing, its three medals and the profile\'s best', async () => {
    const d = challenges();
    expect(d.items().map((i) => [i.title, i.sub, i.on, i.medal])).toEqual([
      ['Boomtown', 'Empty land and §100k', true, null],
      ['Lights Out', 'A city of 71,000 has lost its power plant', false, null],
      ['Smog City', 'Clean the air of a city of 193,000', false, null],
    ]);
    expect(d.detail()).toEqual({
      title: 'Boomtown', brief: SCENARIOS.boomtown.brief,
      goals: ['Bronze50,000 residents by year 10', 'Silver100,000 residents', 'Gold150,000 residents'],
      best: 'Your best:No medal yet',
    });
    d.items()[1].el.click();
    expect(d.detail()).toMatchObject({ title: 'Lights Out', goals: ['BronzeWithin 12 months', 'SilverWithin 9 months', 'GoldWithin 6 months, without a new loan'] });
    expect(d.items().map((i) => i.on)).toEqual([false, true, false]);
    d.button('Start scenario').click();
    expect(await d.result).toBe('lights_out');
    expect(sounds.played).toContain('found');
  });

  it('Cancel starts nothing', async () => {
    const d = challenges();
    d.button('Cancel').click();
    expect(await d.result).toBeNull();
  });

  it('shows the medals the profile holds and opens on the first scenario without one', async () => {
    recordScenarioRun('r1:1_1', 'boomtown', { result: { medal: 'bronze', month: 120 } });
    recordScenarioRun('r2:1_1', 'lights_out', { result: { medal: 'gold', month: 4 } });
    const d = challenges();
    expect(d.items().map((i) => [i.title, i.on, i.medal])).toEqual([['Boomtown', false, 'Bronze'], ['Lights Out', false, 'Gold'], ['Smog City', true, null]]);
    expect(d.detail().title).toBe('Smog City');
    d.items()[1].el.click();
    expect(d.detail().best).toBe('Your best:Gold');
    d.button('Start scenario').click();
    expect(await d.result).toBe('lights_out');
  });
});

// ------------------------------------------------------------------------------------------------ starting a scenario
/** the App's two entries, recorded; the loading screen handed over is removed, as the App's founding ends */
function fakeApp() {
  const found: { model: RegionModel; tile: RegionTile; cfg: CityConfigData; ld: LoadingScreen; t0: number }[] = [];
  const opened: { region: RegionData; tileKey: string }[] = [];
  const app: ScenarioApp = {
    found: async (model, tile, cfg, ld, t0) => { found.push({ model, tile, cfg, ld, t0 }); ld.remove(); },
    open: async (region, tileKey) => { opened.push({ region, tileKey }); },
  };
  return { app, found, opened };
}
/** the start flow paints its loading screen before the heavy work: its frames must come */
const frames = () => vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 1; });
const serve = (bytes: Uint8Array | null, status = 200) => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(String(url));
    if (!bytes) throw new TypeError('Failed to fetch');
    return { ok: status === 200, status, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  });
  return urls;
};

describe('LG-14: starting Boomtown', () => {
  beforeEach(frames);

  it('plans a region of its own and a city on the scenario land with the scenario\'s money', () => {
    const plan = planScenarioCity('boomtown', ['r-old'], 'Mayor Ada');
    expect(plan.data).toMatchObject({ name: 'Boomtown', preset: SCENARIO_REGION.preset, seed: SCENARIO_REGION.seed });
    expect(plan.data.id).not.toBe('r-old');
    expect(plan.tile.size).toBe(2);
    expect(plan.tile.city).toBeUndefined();
    expect(plan.cfg).toMatchObject({
      ...SCENARIO_LAND, name: 'Boomtown', mayor: 'Mayor Ada', difficulty: 'medium', startFunds: BOOMTOWN.funds, sandbox: false, disasters: false,
      regionId: plan.data.id, tileX: plan.tile.x, tileZ: plan.tile.z, scenario: { id: 'boomtown', startDay: NEW_CITY_DAY },
    });
    expect(plan.cfg.challenges).toBeUndefined();
    // the same valley and tile every time; a new id every time
    const again = planScenarioCity('boomtown', [plan.data.id]);
    expect(again.tile.key).toBe(plan.tile.key);
    expect(again.data.id).not.toBe(plan.data.id);
    // the bundled scenarios are not founded
    expect(() => planScenarioCity('smog_city', [])).toThrow(/bundled city/);
  });

  it('saves the region and hands the city to the App behind one loading screen; the guide\'s settings are untouched', async () => {
    const { app, found, opened } = fakeApp();
    await saveRegion({ ...planScenarioCity('boomtown', []).data, id: 'r-mine', name: 'My valley' });
    // (when the loading screen asks for its first frame: the start flow has only just begun)
    let firstFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { firstFrame ||= performance.now(); setTimeout(() => cb(0), 0); return 1; });
    const asked = performance.now();
    expect(await startScenario('boomtown', app, root as unknown as HTMLElement)).toBe(true);
    expect(opened).toEqual([]);
    expect(found).toHaveLength(1);
    const f = found[0];
    expect(f.cfg.scenario).toEqual({ id: 'boomtown', startDay: NEW_CITY_DAY });
    expect(f.ld).toBeInstanceOf(LoadingScreen);
    // the load is timed from the player's click, not from the founding (FH-21)
    expect(f.t0).toBeGreaterThanOrEqual(asked);
    expect(firstFrame).toBeGreaterThan(0);
    expect(f.t0).toBeLessThanOrEqual(firstFrame);
    // the region is stored before anything is founded on it, and is the last region
    const stored = await loadRegion(f.model.data.id);
    expect(stored).toMatchObject({ name: 'Boomtown' });
    expect(getLastRegionId()).toBe(f.model.data.id);
    // the player's own region is still there, as it was
    expect(await loadRegion('r-mine')).toMatchObject({ name: 'My valley' });
    // neither the guide's profile pref nor the New City dialog's remembered choice was written
    expect(store.has('metropolis.ui.onboarding')).toBe(false);
    expect(store.has('metropolis.ui.newCity')).toBe(false);
  });

  it('the loading screen names the scenario and what each medal takes', () => {
    expect(scenarioTips('boomtown')).toEqual([
      'Boomtown: Empty land and §100k.', 'Bronze: 50,000 residents by year 10.', 'Silver: 100,000 residents.', 'Gold: 150,000 residents.',
    ]);
  });
});

describe('LG-14: starting a bundled scenario', () => {
  beforeEach(frames);

  it('stores the bundled city as a region of its own, through the save layer', { timeout: 120_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { region, tileKey } = await importScenario('smog_city', bundle('smog_city'), ['scenario-smog_city'], 'Mayor Ada');
    expect(region.id).not.toBe('scenario-smog_city');
    expect(region.name).toBe('Smog City');
    const tile = region.tiles.find((t) => t.key === tileKey)!;
    expect(tile.city).toMatchObject({ name: 'Coalbrook', mayor: 'Mayor Ada', scenario: 'smog_city' });
    // founded now, not at the bundle's fixed time stamp
    expect(Math.abs(tile.city!.founded - Date.now())).toBeLessThan(120_000);
    expect(await loadRegion(region.id)).toMatchObject({ id: region.id, name: 'Smog City' });
    const st = (await loadCity(region.id, tileKey))!;
    expect(st.config).toMatchObject({ name: 'Coalbrook', mayor: 'Mayor Ada', regionId: region.id });
    expect(scenarioOf(st.config)).toMatchObject({ id: 'smog_city', startDay: 5400 });
    expect(st.stats.population).toBeGreaterThan(180_000);
    // a second start is a second region: the first attempt is not touched
    const second = await importScenario('smog_city', bundle('smog_city'), [region.id]);
    expect(second.region.id).not.toBe(region.id);
    expect(second.region.name).toBe('Smog City');
    expect(await loadRegion(region.id)).toMatchObject({ name: 'Smog City' });
    expect((await loadCity(second.region.id, second.tileKey))!.config.regionId).toBe(second.region.id);
  });

  it('refuses a file that does not hold the scenario\'s city', async () => {
    await expect(importScenario('smog_city', bundle('lights_out'), [])).rejects.toThrow('The Smog City file does not hold its city');
  });

  it('fetches the bundle, imports it and opens its city through the App', { timeout: 120_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const urls = serve(bundle('lights_out'));
    const { app, found, opened } = fakeApp();
    expect(await startScenario('lights_out', app, root as unknown as HTMLElement)).toBe(true);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/lights_out\.metropolis/);
    expect(found).toEqual([]);
    expect(opened).toHaveLength(1);
    const { region, tileKey } = opened[0];
    expect(region.name).toBe('Lights Out');
    expect(scenarioOf((await loadCity(region.id, tileKey))!.config)!.id).toBe('lights_out');
    // its own loading screen is gone once the App has the city
    expect(root.querySelector('.loading')).toBeNull();
    expect(store.has('metropolis.ui.onboarding')).toBe(false);
  });

  it('a bundle that cannot be loaded is reported and leaves nothing behind; the next start works', { timeout: 120_000 }, async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { app, opened } = fakeApp();
    serve(null);
    expect(await startScenario('smog_city', app, root as unknown as HTMLElement)).toBe(false);
    serve(bundle('smog_city'), 404);
    expect(await startScenario('smog_city', app, root as unknown as HTMLElement)).toBe(false);
    expect(opened).toEqual([]);
    expect(root.querySelector('.loading')).toBeNull();
    expect(root.querySelectorAll('.toast').map((t) => textOf(t))).toEqual([
      'Could not start Smog City: Failed to fetch', 'Could not start Smog City: the scenario file could not be loaded (404)',
    ]);
    serve(bundle('smog_city'));
    expect(await startScenario('smog_city', app, root as unknown as HTMLElement)).toBe(true);
    expect(opened).toHaveLength(1);
  });

  it('the Challenges entry runs the dialog, then the start', { timeout: 120_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    serve(bundle('smog_city'));
    const { app, found, opened } = fakeApp();
    const done = runChallenges(app);
    const dlg = root.querySelector('.modal')!;
    dlg.querySelectorAll('.seg-item')[2].click();
    dlg.querySelectorAll('button').find((b) => textOf(b) === 'Start scenario')!.click();
    await done;
    expect(found).toEqual([]);
    expect(opened.map((o) => o.region.name)).toEqual(['Smog City']);
    // closing the dialog starts nothing
    const none = runChallenges(app);
    root.querySelectorAll('.modal').at(-1)!.querySelectorAll('button').find((b) => textOf(b) === 'Cancel')!.click();
    await none;
    expect(opened).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------ New City dialog
function newCity(defaults: Partial<CityConfigData> = {}) {
  const tile = { key: '6_6', x: 6, z: 6, size: 2 } as RegionTile;
  const region = { data: { name: 'Test Valley', tiles: [tile] }, cityConfigFor: (_t: RegionTile, p: Partial<CityConfigData> = {}) => defaultCityConfig({ size: 128, terrain: 'region', ...p }) } as unknown as RegionModel;
  const result = openNewCityDialog({ region, tile, defaults });
  const dlg = root.querySelector('.modal')!;
  const picker = dlg.querySelector('.ch-picker')!;
  const chip = (name: string) => picker.querySelectorAll('.chip').find((c) => textOf(c) === name)!;
  const note = () => picker.querySelector('.nc-note')!.children.map((c) => textOf(c));
  const switchOf = (label: string) => dlg.querySelectorAll('label').find((l) => l.classList.contains('toggle') && textOf(l) === label)!.querySelector('input') as unknown as { checked: boolean; fire(t: string): void };
  const card = (title: string) => dlg.querySelector('.nc-diff')!.querySelectorAll('.seg-item').find((b) => textOf(b.querySelector('.si-t')!) === title)!;
  const found = () => dlg.querySelectorAll('button').find((b) => textOf(b) === 'Found City')!.click();
  return { dlg, picker, chip, note, switchOf, card, found, result };
}

describe('LG-14: Mayor\'s challenges in the New City dialog', () => {
  it('offers the four challenges, none chosen; a city founded without any has no challenge in its config', async () => {
    const d = newCity();
    expect(textOf(d.picker.querySelector('label')!)).toBe('Mayor’s challenges · optional');
    expect(d.picker.querySelectorAll('.chip').map((c) => [textOf(c), c.classList.contains('on'), c.getAttribute('aria-pressed')])).toEqual([
      ['No loans', false, 'false'], ['No dirty industry', false, 'false'], ['Frequent disasters', false, 'false'], ['Hard money', false, 'false'],
    ]);
    expect(d.note()).toEqual(['Each challenge earns its badge on the region card once the city reaches 25,000 residents.']);
    d.found();
    const cfg = (await d.result)!;
    expect(Object.hasOwn(cfg, 'challenges')).toBe(false);
    expect(cfg.startFunds).toBe(DIFFICULTY_FUNDS.easy);
  });

  it('the chosen challenges are the city\'s rules: in its config, with their rules spelled out', async () => {
    const d = newCity();
    d.chip('Hard money').click();
    d.chip('No loans').click();
    expect(d.chip('Hard money').classList.contains('on')).toBe(true);
    expect(d.chip('Hard money').getAttribute('aria-pressed')).toBe('true');
    expect(d.note()).toEqual([
      'No loans: The bank lends nothing: the city lives on what it earns.',
      'Hard money: Hard\'s money on any difficulty: §40k to start and 15% less tax income.',
      'Each challenge earns its badge on the region card once the city reaches 25,000 residents.',
    ]);
    d.found();
    const cfg = (await d.result)!;
    expect(cfg.challenges).toEqual(['noLoans', 'hardMoney']);
    // Hard's starting funds on the Easy city
    expect(cfg).toMatchObject({ difficulty: 'easy', startFunds: DIFFICULTY_FUNDS.hard, sandbox: false });
  });

  it('a chip switches off again; the funds are then the difficulty\'s', async () => {
    const d = newCity();
    d.chip('Hard money').click();
    d.chip('Hard money').click();
    expect(d.chip('Hard money').classList.contains('on')).toBe(false);
    d.card('Medium').click();
    d.found();
    const cfg = (await d.result)!;
    expect(Object.hasOwn(cfg, 'challenges')).toBe(false);
    expect(cfg.startFunds).toBe(DIFFICULTY_FUNDS.medium);
  });

  it('Frequent disasters switches Disasters on; switching Disasters off drops the challenge', async () => {
    const d = newCity();
    expect(d.switchOf('Disasters').checked).toBe(false);
    d.chip('Frequent disasters').click();
    expect(d.switchOf('Disasters').checked).toBe(true);
    // a difficulty whose default is no disasters (Easy) does not switch them off under the challenge
    d.card('Medium').click();
    d.card('Easy').click();
    expect(d.switchOf('Disasters').checked).toBe(true);
    expect(d.chip('Frequent disasters').classList.contains('on')).toBe(true);
    const sw = d.switchOf('Disasters');
    sw.checked = false;
    sw.fire('change');
    expect(d.chip('Frequent disasters').classList.contains('on')).toBe(false);
    d.chip('Frequent disasters').click();
    d.found();
    expect(await d.result).toMatchObject({ challenges: ['frequentDisasters'], disasters: true });
  });

  it('Sandbox has no challenges: the chips are cleared and disabled, and come back with another difficulty', async () => {
    const d = newCity();
    d.chip('No loans').click();
    d.card('Sandbox').click();
    expect(d.picker.querySelectorAll('.chip').map((c) => [c.classList.contains('on'), c.disabled])).toEqual([[false, true], [false, true], [false, true], [false, true]]);
    expect(textOf(d.picker.querySelector('.nc-note')!)).toBe('Not in Sandbox: unlimited money leaves nothing to challenge.');
    d.card('Hard').click();
    expect(d.picker.querySelectorAll('.chip').every((c) => !c.disabled)).toBe(true);
    d.card('Sandbox').click();
    d.found();
    const cfg = (await d.result)!;
    expect(cfg.sandbox).toBe(true);
    expect(Object.hasOwn(cfg, 'challenges')).toBe(false);
    expect(cfg.startFunds).toBe(DIFFICULTY_FUNDS.sandbox);
  });
});

// ------------------------------------------------------------------------------------------------ region screen badges
describe('LG-14: badges on the region screen', () => {
  const city = (o: Partial<RegionCitySummary>): RegionCitySummary => ({ name: 'Ashbury', mayor: 'M', population: 1, r: 1, c: 0, i: 0, funds: 0, lastPlayed: 0, founded: 0, difficulty: 'medium', ...o });
  const texts = (el: HTMLElement | null) => (el as unknown as FEl | null)?.querySelectorAll('.ch-badge').map((b) => [textOf(b), b.className.replace('ch-badge ', '')]) ?? null;

  it('a city\'s card shows its challenges, lit once their badges are earned; a plain city shows nothing', () => {
    expect(cityBadges('r1', { key: '1_1', city: city({}) })).toBeNull();
    expect(cityBadges('r1', { key: '1_1' })).toBeNull();
    expect(texts(cityBadges('r1', { key: '1_1', city: city({ challenges: ['noLoans', 'hardMoney'], badges: [] }) }))).toEqual([['No loans', 'open'], ['Hard money', 'open']]);
    expect(texts(cityBadges('r1', { key: '1_1', city: city({ challenges: ['noLoans', 'hardMoney'], badges: ['noLoans', 'hardMoney'] }) }))).toEqual([['No loans', 'earned'], ['Hard money', 'earned']]);
    // an id this build does not know is left out
    expect(texts(cityBadges('r1', { key: '1_1', city: city({ challenges: ['noLoans', 'laterRule'], badges: ['laterRule'] }) }))).toEqual([['No loans', 'open']]);
  });

  it('a scenario city shows its scenario and the medal this profile won in it', () => {
    const tile = { key: '6_6', city: city({ scenario: 'smog_city' }) };
    expect(texts(cityBadges('r1', tile))).toEqual([['Smog City', 'scenario']]);
    recordScenarioRun('r1:6_6', 'smog_city', { result: { medal: 'silver', month: 40 } });
    expect(texts(cityBadges('r1', tile))).toEqual([['Smog City', 'scenario'], ['Silver', 'medal silver']]);
    // another region's city of the same tile key has its own outcome
    expect(texts(cityBadges('r2', tile))).toEqual([['Smog City', 'scenario']]);
    expect(texts(cityBadges('r1', { key: '6_6', city: city({ scenario: 'gridlock' }) }))).toBeNull();
  });

  it('the region card lists every badge its cities have earned, each kind once, with the cities that hold it', () => {
    const tiles = [
      { key: 'a', x: 0, z: 0, size: 1, city: city({ name: 'Ashbury', challenges: ['noLoans', 'hardMoney'], badges: ['noLoans', 'hardMoney'] }) },
      { key: 'b', x: 1, z: 0, size: 1, city: city({ name: 'Birchfield', challenges: ['noLoans', 'frequentDisasters'], badges: [] }) },
      { key: 'c', x: 2, z: 0, size: 1, city: city({ name: 'Cedarholm', challenges: ['noLoans'], badges: ['noLoans'] }) },
      { key: 'd', x: 3, z: 0, size: 1 },
    ] as RegionTile[];
    const row = regionBadges({ tiles }) as unknown as FEl[];
    expect(row).toHaveLength(1);
    expect(row[0].querySelectorAll('.ch-badge').map((b) => [textOf(b), b.title])).toEqual([
      ['No loans', 'Earned by Ashbury, Cedarholm'], ['Hard money', 'Earned by Ashbury'],
    ]);
    expect(regionBadges({ tiles: tiles.slice(1, 2) })).toEqual([]);
    expect(regionBadges({ tiles: [] })).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ the App's wiring
/**
 * main.ts is held by the cloud's Worker lanes, so its one hunk is a request to the lead (the T092 report gives it): the
 * title's `onChallenges` runs runChallenges with the App's own founding and opening paths. The App is not exported and
 * boots on import, so its source is read (as firstCity.test.ts reads it); the check starts once the hunk is in.
 */
describe('LG-14: main.ts wires the Challenges entry', () => {
  const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
  it.skipIf(!src.includes('onChallenges'))('the title founds through startNewCity and opens through continueInCity', () => {
    expect(src).toMatch(/import \{ runChallenges \} from '\.\/region\/challenges';/);
    const call = /onChallenges: \(\) => void runChallenges\(\{([\s\S]*?)\}\),\n/.exec(src)?.[1] ?? '';
    // the new region is the App's region before its city is founded (startNewCity persists this.region), behind the
    // loading screen the start already shows
    expect(call).toMatch(/found: \(model, tile, cfg, ld, t0\) => \{ this\.region = model; return this\.startNewCity\(model, tile, cfg, t0, ld\); \}/);
    // a freshly imported city has no unsaved progress to ask about
    expect(call).toMatch(/open: \(region, tileKey\) => this\.continueInCity\(region, tileKey, false\)/);
  });
});
