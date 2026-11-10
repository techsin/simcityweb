/**
 * FH-12: "Start your first city" (POLISH_PLAN FH-12, §4.3 A1-A2). With no region saved, the title screen's primary
 * button makes, in one click and behind one loading screen:
 *  1. a new Greenvale Valley region with a unique id. It is a persistent region: never the fixed `quickstart` id, which
 *     that test path deletes and recreates, and never an id a saved region already has (`uniqueRegionId`), so an
 *     existing region is never overwritten;
 *  2. a city on FH-11's recommended tile, on Easy (FH-04: §250k, Disasters off), with Guided start (newCityPrefs.ts),
 *     founded on day 90 (FEEL-05) by main.ts's `startNewCity`;
 *  3. the paused city with the guide card: CityScene pauses a city founded just now, and the guide opens while its pref
 *     is not dismissed.
 * main.ts wires it (the title's `onFirstCity`, one LoadingScreen with `firstCityTips()` handed to `startNewCity`); the
 * texts are the guide's (`guideCopy.phaseA`).
 */
import { DIFFICULTY_FUNDS, type CityConfigData } from '../sim/config';
import { guideCopy, type WindStart } from '../ui/guide/copy';
import { openKV, saveRegion, setLastRegionId } from '../save';
import { createRegionData, newRegionId, type RegionModel } from './RegionModel';
import { rememberNewCity } from './newCityPrefs';
import { randomCityName, randomMayorName } from './names';
import type { RegionData, RegionPresetId, RegionTile } from './types';

/** the first city's region preset (§4.3 A2: "a Greenvale Valley region") */
export const FIRST_CITY_PRESET: RegionPresetId = 'greenvale';
/** the title sub-line's estimate (§4.3 A1: "your first road in about 2 minutes") */
export const FIRST_ROAD_MINUTES = 2;
/**
 * The founding guide's wind numbers (§4.4 step 3: 3 turbines, a teaching rate of 1 MW per 300 residents, rounded down
 * to 500), so the loading tip and the guide's step 3 agree ("about 2,500"). T037a's `src/ui/guide/founding.ts`
 * `WIND_START` holds the same values; once it is in dev this can point at it.
 */
export const FIRST_CITY_WIND: WindStart = { turbines: 3, residentsPerMW: 300, residentRounding: 500 };

/** the first-city loading screen's three tips (§4.3 A2), in the plan's order */
export function firstCityTips(): string[] {
  const a = guideCopy.phaseA;
  return [a.A2Wind(FIRST_CITY_WIND), a.A2Zones(), a.A2Play()];
}

/** a fresh region id that none of `taken` is: a new region never replaces a stored one */
export function uniqueRegionId(taken: Iterable<string>, make: () => string = newRegionId): string {
  const used = new Set(taken);
  let id = make();
  // newRegionId is time + random, so a clash is all but impossible; a generator that keeps clashing gets a suffix
  for (let n = 1; used.has(id); n++) id = n < 8 ? make() : `${id}-${n}`;
  return id;
}

export interface FirstCityPlan {
  data: RegionData;
  model: RegionModel;
  /** FH-11's recommended tile ("A good first city") */
  tile: RegionTile;
  /** Easy, Disasters off, region terrain (main.ts's startNewCity founds it on day 90) */
  cfg: CityConfigData;
}

/** the region and city config of a first city (pure: nothing is stored); `taken`: the ids of the saved regions */
export function planFirstCity(taken: Iterable<string>, opts: { seed?: number } = {}): FirstCityPlan {
  const { data, model } = createRegionData({ preset: FIRST_CITY_PRESET, id: uniqueRegionId(taken), seed: opts.seed });
  const tile = model.recommendedTile();
  if (!tile) throw new Error('The new region has no tile for a first city');
  const cfg = model.cityConfigFor(tile, {
    name: randomCityName(),
    mayor: randomMayorName(),
    difficulty: 'easy',
    startFunds: DIFFICULTY_FUNDS.easy,
    sandbox: false,
    // the plan names it for the first city, whatever Easy's default (FH-04's defaultDisasters) becomes
    disasters: false,
  });
  return { data, model, tile, cfg };
}

/** the ids of every saved region (IndexedDB, or this page's memory store when it is unavailable) */
export async function savedRegionIds(): Promise<string[]> {
  return (await openKV()).keys('regions');
}

/** a region is saved: the title screen offers Continue / New Region, not the first city */
export async function hasSavedRegion(): Promise<boolean> {
  return (await savedRegionIds()).length > 0;
}

/**
 * Make and store the first city's region (a unique id checked against the saved ones, saved before anything is
 * founded on it, and the last region from now on), and record Guided start and Easy as the profile's choices (FH-11's
 * newCityPrefs: the guide opens, later New City dialogs preselect Easy). `preview` draws the region's overview image.
 */
export async function createFirstCity(preview?: (model: RegionModel) => unknown): Promise<FirstCityPlan> {
  const plan = planFirstCity(await savedRegionIds());
  preview?.(plan.model);
  await saveRegion(plan.data);
  setLastRegionId(plan.data.id);
  rememberNewCity({ difficulty: 'easy', guided: true, veteran: false });
  return plan;
}

/**
 * The region's most recently played city tile, if any: Continue on a region the player left from its region screen
 * selects it there, so it returns to the city on its tile (FH-12's "Continue returns to it").
 */
export function lastCityTileKey(data: RegionData): string | undefined {
  let best: RegionTile | undefined;
  for (const t of data.tiles) if (t.city && (!best || (t.city.lastPlayed ?? 0) > (best.city!.lastPlayed ?? 0))) best = t;
  return best?.key;
}
