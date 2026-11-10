/**
 * LG-14, the region side: starting a scenario from the title screen's Challenges menu, and the badges a scenario or a
 * Mayor's challenge shows on the region screen. (The scenarios themselves: src/game/scenarios.ts; the dialogs:
 * NewCityDialog.ts openChallengesDialog and its Mayor's-challenge chips.)
 *
 * A scenario is always played in a region of its own with a unique id (never one a saved region has: firstCity.ts
 * uniqueRegionId), so starting one, or the same one again, never touches another region or an earlier attempt:
 *  - Boomtown ('found'): a new region whose recommended medium tile is founded with boomtownConfig(), on SCENARIO_LAND.
 *    The App founds it like any new city (day 90, FEEL-05 / D11).
 *  - Lights Out and Smog City ('bundle'): the bundled one-city region file (src/game/scenarioBundles/, written by
 *    tools/scenarios.ts) is fetched, given its id, and imported through the save layer's own importRegion; the App then
 *    opens the stored city as it opens any saved one, in whichever host runs the simulation. A bundled city keeps its
 *    own date (D11).
 * A scenario start never changes the guide's profile settings (newCityPrefs.ts): the guide decides for itself, as in any
 * city, whether it opens.
 *
 * main.ts wires it: the title's `onChallenges` calls runChallenges() with its two entries (ScenarioApp).
 */
import './ui/challenges.css';
import lightsOutUrl from '../game/scenarioBundles/lights_out.metropolis?url';
import smogCityUrl from '../game/scenarioBundles/smog_city.metropolis?url';
import {
  CHALLENGE_INFO, MEDAL_NAMES, SCENARIOS, boomtownConfig, loadScenarioRun, scenarioOf, type Medal, type ScenarioId,
} from '../game/scenarios';
import { importRegion, packFile, readRegionFile, saveRegion, setLastRegionId } from '../save';
import { requestPersistentStorage } from '../save/db';
import type { CityConfigData } from '../sim/config';
import { MAYOR_CHALLENGES, type MayorChallenge } from '../sim/economy/challenges';
import { savedRegionIds, uniqueRegionId } from './firstCity';
import { randomMayorName } from './names';
import { openChallengesDialog } from './NewCityDialog';
import { createRegionData, type RegionModel } from './RegionModel';
import type { RegionData, RegionPresetId, RegionTile } from './types';
import { h, icon, paint } from './ui/dom';
import { LoadingScreen } from './ui/LoadingScreen';
import { toast, uiRoot } from './ui/modal';

/** the region a founded scenario gets: the same seeded valley every time, so its recommended tile is the same too */
export const SCENARIO_REGION: { preset: RegionPresetId; seed: number } = { preset: 'greenvale', seed: 7 };

const BUNDLE_URL: Partial<Record<ScenarioId, string>> = { lights_out: lightsOutUrl, smog_city: smogCityUrl };

/** what the App provides (main.ts) */
export interface ScenarioApp {
  /** found a new city on a tile of a new, saved region and enter it (startNewCity); `ld`: the loading screen already up,
   *  which the App takes over; `t0`: when the player asked for the scenario (performance.now(); FH-21's load time) */
  found(model: RegionModel, tile: RegionTile, cfg: CityConfigData, ld: LoadingScreen, t0: number): Promise<void>;
  /** enter a stored city of a stored region (continueInCity) */
  open(region: RegionData, tileKey: string): Promise<void>;
}

export interface ScenarioCityPlan {
  data: RegionData;
  model: RegionModel;
  tile: RegionTile;
  cfg: CityConfigData;
}

/** the region and city config of a founded scenario (pure: nothing is stored); `taken`: the ids of the saved regions */
export function planScenarioCity(id: ScenarioId, taken: Iterable<string>, mayor: string = randomMayorName()): ScenarioCityPlan {
  if (id !== 'boomtown') throw new Error(`${SCENARIOS[id].title} starts from its bundled city`);
  const { data, model } = createRegionData({ ...SCENARIO_REGION, id: uniqueRegionId(taken), name: SCENARIOS[id].title });
  const tile = model.recommendedTile();
  if (!tile) throw new Error('The scenario region has no tile for the city');
  return { data, model, tile, cfg: model.cityConfigFor(tile, { ...boomtownConfig(), mayor }) };
}

/**
 * Store a bundled scenario as a region of its own: the file's region gets a unique id (so importRegion neither renames
 * nor replaces anything), today's dates and the mayor's name. Returns the stored region and its city's tile.
 */
export async function importScenario(id: ScenarioId, bytes: Uint8Array, taken: Iterable<string>, mayor: string = randomMayorName()): Promise<{ region: RegionData; tileKey: string }> {
  const file = await readRegionFile(bytes);
  const tileKey = Object.keys(file.cities ?? {})[0];
  const tile = file.region.tiles.find((t) => t.key === tileKey);
  const city = tileKey ? file.cities[tileKey] : undefined;
  if (!tile?.city || !city || scenarioOf(city.config)?.id !== id) throw new Error(`The ${SCENARIOS[id].title} file does not hold its city`);
  const now = Date.now();
  file.region.id = uniqueRegionId(taken);
  file.region.name = SCENARIOS[id].title;
  file.region.created = now;
  city.config = { ...city.config, mayor };
  tile.city = { ...tile.city, mayor, founded: now, lastPlayed: now };
  // (stored by the save layer's own import; an uncompressed re-pack, since the id is part of the file)
  return { region: await importRegion(await packFile(file, false)), tileKey };
}

async function fetchBundle(id: ScenarioId): Promise<Uint8Array> {
  const url = BUNDLE_URL[id];
  if (!url) throw new Error(`${SCENARIOS[id].title} has no bundled city`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`the scenario file could not be loaded (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** the loading screen's lines for a scenario: what it asks, medal by medal */
export function scenarioTips(id: ScenarioId): string[] {
  const s = SCENARIOS[id];
  return [`${s.title}: ${s.tagline}.`, ...(['bronze', 'silver', 'gold'] as const).map((m) => `${MEDAL_NAMES[m]}: ${s.goals[m]}.`)];
}

let starting = false;

/**
 * Start a scenario: prepare its region and city behind one loading screen, then hand over to the App. Resolves true
 * when the city was entered; a failure is reported in a toast and leaves the title screen as it was.
 */
export async function startScenario(id: ScenarioId, app: ScenarioApp, root: HTMLElement = uiRoot()): Promise<boolean> {
  if (starting) return false;
  starting = true;
  const t0 = performance.now();
  // NEW-04: founding a city asks for persistent storage, inside the player's click
  void requestPersistentStorage();
  const def = SCENARIOS[id];
  const ld = new LoadingScreen(root, undefined, scenarioTips(id));
  try {
    ld.set(`Preparing ${def.title}…`, 0.05);
    await paint();
    const taken = await savedRegionIds();
    if (def.start === 'found') {
      const plan = planScenarioCity(id, taken);
      await saveRegion(plan.data);
      setLastRegionId(plan.data.id);
      // the App founds the city behind this same loading screen, and hides it
      await app.found(plan.model, plan.tile, plan.cfg, ld, t0);
      return true;
    }
    const { region, tileKey } = await importScenario(id, await fetchBundle(id), taken);
    ld.set(`Opening ${def.city}…`, 0.2);
    // (the App's own loading screen covers this one from here on)
    await app.open(region, tileKey);
    ld.remove();
    return true;
  } catch (e) {
    console.error('[challenges] failed to start the scenario', id, e);
    toast(`Could not start ${def.title}: ${(e as Error).message}`, 'bad', 6000);
    ld.remove();
    return false;
  } finally {
    starting = false;
  }
}

/** the title screen's Challenges entry: choose a scenario, then start it */
export async function runChallenges(app: ScenarioApp): Promise<void> {
  const id = await openChallengesDialog();
  if (id) await startScenario(id, app);
}

// ------------------------------------------------------------------------------------------------ region screen badges
const isChallenge = (v: unknown): v is MayorChallenge => (MAYOR_CHALLENGES as readonly unknown[]).includes(v);

function badge(text: string, cls: string, title: string): HTMLElement {
  return h('span', { class: `ch-badge ${cls}`, title }, text);
}

/** a medal's badge ("Gold"), with the scenario it was won in as its tooltip */
export function medalBadge(medal: Medal, title: string): HTMLElement {
  return h('span', { class: `ch-badge medal ${medal}`, title }, icon('star', 11), MEDAL_NAMES[medal]);
}

/**
 * The badges of one city for its tile card: its scenario with the medal this profile won there, and its Mayor's
 * challenges, lit once earned (RegionCitySummary.badges). null for a city with neither.
 */
export function cityBadges(regionId: string, tile: Pick<RegionTile, 'key' | 'city'>): HTMLElement | null {
  const c = tile.city;
  if (!c) return null;
  const out: HTMLElement[] = [];
  const scenario = c.scenario && Object.hasOwn(SCENARIOS, c.scenario) ? SCENARIOS[c.scenario as ScenarioId] : null;
  if (scenario) {
    const result = loadScenarioRun(`${regionId}:${tile.key}`)?.result;
    out.push(badge(scenario.title, 'scenario', `Scenario: ${scenario.tagline}`));
    if (result?.medal) out.push(medalBadge(result.medal, `${MEDAL_NAMES[result.medal]} medal in ${scenario.title}`));
  }
  const earned = new Set(c.badges ?? []);
  for (const id of (c.challenges ?? []).filter(isChallenge)) {
    const info = CHALLENGE_INFO[id];
    out.push(badge(info.name, earned.has(id) ? 'earned' : 'open', `${info.rule}${earned.has(id) ? ' Badge earned.' : ''}`));
  }
  return out.length ? h('div', { class: 'ch-badges' }, ...out) : null;
}

/**
 * The region card's badge row: every Mayor's-challenge badge the region's cities have earned (each kind once, with the
 * cities that hold it as its tooltip). An empty list while there is none: the card then gets no row.
 */
export function regionBadges(data: Pick<RegionData, 'tiles'>): HTMLElement[] {
  const holders = new Map<MayorChallenge, string[]>();
  for (const t of data.tiles) for (const id of (t.city?.badges ?? []).filter(isChallenge)) holders.set(id, [...(holders.get(id) ?? []), t.city!.name]);
  const out = MAYOR_CHALLENGES.filter((id) => holders.has(id)).map((id) => badge(CHALLENGE_INFO[id].name, 'earned', `Earned by ${holders.get(id)!.join(', ')}`));
  return out.length ? [h('div', { class: 'ch-badges' }, ...out)] : [];
}
