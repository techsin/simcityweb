/**
 * New City dialog: returns a CityConfigData (or null when cancelled).
 *   openNewCityDialog({ region, tile }) -> Promise<CityConfigData | null>
 * Live 2D preview (shaded relief) regenerated on every change from a low-res CityState (64^2, < 10 ms) using the
 * same terrain generator as the real city (region sampler, or preset with logicalSize = real size).
 * FH-11: each difficulty card carries its one-line description (FH-04's difficultyRules), Disasters has a note, and
 * "Guided start" sets CityConfigData.guided. A profile's first city opens on Easy with the guide and no disasters; later
 * dialogs open on the last choice ('metropolis.ui.newCity').
 */
import type { Climate, Difficulty, TerrainPreset } from '../core/types';
import { REGION_UNIT_CELLS } from '../core/constants';
import { DIFFICULTY_FUNDS, defaultCityConfig, type CityConfigData } from '../sim/config';
import { CityState } from '../sim/CityState';
import { difficultyRules } from '../sim/economy/tuning';
import { generateTerrain, terrainStats, type TerrainOptions } from '../sim/terrainGen';
import { loadPref, savePref } from '../game/settings';
import { audio } from '../audio';
import type { RegionModel } from './RegionModel';
import type { RegionTile } from './types';
import { TILE_SIZE_LABEL } from './types';
import { drawCityMap } from './mapPreview';
import { randomCityName, randomMayorName } from './names';
import { Modal, segmented, slider, toggle } from './ui/modal';
import { button, h, icon, formatNumber } from './ui/dom';

export interface NewCityDialogOptions {
  region?: RegionModel;
  tile?: RegionTile;
  /** city size (cells) when there is no tile */
  size?: number;
  defaults?: Partial<CityConfigData>;
  /** FH-11: the profile has founded no city yet (main checks its saved regions): Easy, the guide, no disasters */
  firstCity?: boolean;
}

/** what the dialog returns: the city's config, with the "Guided start" choice in it */
export type NewCityConfig = CityConfigData & { guided: boolean };

/**
 * FH-11's texts (§4.3 A3), worded as the guide's copy module words them (guideCopy.phaseA; a test keeps them equal). The
 * dialog does not import that module: it would pull the catalog and most of the sim into the title screen's bundle.
 */
export const NEW_CITY_TEXT = {
  guided: 'Guide your first steps',
  veteran: 'Skip to your veteran briefing',
  disasters: (minPopulation: number) => `Tornadoes, quakes and meteors can hit your town from ${formatNumber(minPopulation)} residents. Off is fine for your first city.`,
};
/** disasters strike from this many residents: src/sim/infra/disasters.ts's gate, which exports no constant (a test checks it) */
export const DISASTER_MIN_POP = 2000;
/**
 * "I've played city builders before" (FH-18: the veteran briefing). Built, and hidden until FH-18 wires the briefing
 * (NOTE-042: a control that changes nothing reads as broken). It is the guide's per-profile `veteran` flag.
 */
const SHOW_VETERAN = false;

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'sandbox'];
const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', sandbox: 'Sandbox' };

/** the New City choices later dialogs open on (FH-11) */
export interface NewCityChoice {
  difficulty: Difficulty;
  disasters: boolean;
  /** "Guided start" (CityConfigData.guided) */
  guided: boolean;
}
const CHOICE_PREF = 'newCity';
/** a profile's first city (§4.3 A3): Easy, the guide, and Easy's disasters default (off) */
const FIRST_CITY: NewCityChoice = { difficulty: 'easy', disasters: difficultyRules('easy').defaultDisasters, guided: true };

/** the choice the last New City dialog founded with (null: none yet, or not a valid one) */
export function loadNewCityChoice(): NewCityChoice | null {
  const v = loadPref<unknown>(CHOICE_PREF, null) as Partial<Record<keyof NewCityChoice, unknown>> | null;
  if (!v || typeof v !== 'object' || !DIFFICULTIES.includes(v.difficulty as Difficulty)) return null;
  if (typeof v.disasters !== 'boolean' || typeof v.guided !== 'boolean') return null;
  return { difficulty: v.difficulty as Difficulty, disasters: v.disasters, guided: v.guided };
}

/** the guide's per-profile pref ('metropolis.ui.onboarding', GuideProfile): read for its dismissal, written for `veteran` */
function guidePref(): Record<string, unknown> {
  const v = loadPref<unknown>('onboarding', {});
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const PRESETS: { id: Exclude<TerrainPreset, 'region'>; label: string; icon: string }[] = [
  { id: 'flat', label: 'Flat', icon: 'map' },
  { id: 'plains', label: 'Plains', icon: 'map' },
  { id: 'hills', label: 'Hills', icon: 'mountain' },
  { id: 'mountains', label: 'Mountains', icon: 'mountain' },
  { id: 'river', label: 'River', icon: 'droplet' },
  { id: 'coast', label: 'Coast', icon: 'droplet' },
  { id: 'islands', label: 'Islands', icon: 'droplet' },
  { id: 'lakes', label: 'Lakes', icon: 'droplet' },
];

const PREVIEW_RES = 96;

/**
 * FEEL-05: a player's new city is founded on 1 April (day 90), in spring, so its first view is green; its first New Year
 * is 1 January of the next year. main.ts calls startInSpring right after it creates the state. The CityState constructor
 * keeps day 0, so the bot, the tests and the baselines found on day 0 as before, and a loaded save keeps its own day.
 */
export const FOUNDING_DAY = 90;
export function startInSpring(st: CityState): void {
  st.day = FOUNDING_DAY;
  st.systemData.foundedDay = FOUNDING_DAY;
}

/** terrain options (sampler etc.) for a config on a region tile — also used by main to generate the real city */
export function terrainOptionsFor(cfg: CityConfigData, region?: RegionModel, tile?: RegionTile): TerrainOptions {
  if (cfg.terrain === 'region' && region && tile) return { sampler: region.samplerForTile(tile), forestSampler: forestWithDensity(region, tile, cfg.treeDensity) };
  return {};
}

/** region forest field modulated by the chosen tree density (0.5 = region default) */
function forestWithDensity(region: RegionModel, tile: RegionTile, density: number): (u: number, v: number) => number {
  const f = region.forestSamplerForTile(tile);
  const k = density / 0.5;
  return (u, v) => Math.min(1, f(u, v) * k + Math.max(0, density - 0.6) * 0.5);
}

export function openNewCityDialog(o: NewCityDialogOptions = {}): Promise<NewCityConfig | null> {
  return new Promise((resolve) => {
    const size = o.tile ? o.tile.size * REGION_UNIT_CELLS : o.size ?? 128;
    const hasRegion = !!(o.region && o.tile);
    const base = o.region && o.tile ? o.region.cityConfigFor(o.tile, o.defaults) : defaultCityConfig({ size, ...o.defaults });
    const cfg: CityConfigData = { ...base, name: o.defaults?.name ?? randomCityName(), mayor: o.defaults?.mayor ?? randomMayorName() };
    if (!hasRegion && cfg.terrain === 'region') cfg.terrain = 'hills';
    let customPreset: Exclude<TerrainPreset, 'region'> = cfg.terrain === 'region' ? 'hills' : cfg.terrain;
    let result: NewCityConfig | null = null;
    const pickDifficulty = (d: Difficulty) => {
      cfg.difficulty = d;
      cfg.startFunds = DIFFICULTY_FUNDS[d];
      cfg.sandbox = d === 'sandbox';
    };
    // FH-11: the last choice; else a profile's first city; else (a profile from before FH-11) today's defaults, with the
    // guide on unless the profile dismissed it. Explicit `defaults` win.
    const guide = guidePref();
    const start = loadNewCityChoice() ?? (o.firstCity ? FIRST_CITY : { difficulty: base.difficulty, disasters: base.disasters, guided: guide.dismissed !== true && guide.dismissedAll !== true });
    if (o.defaults?.difficulty === undefined) {
      pickDifficulty(start.difficulty);
      if (o.defaults?.disasters === undefined) cfg.disasters = start.disasters;
    }
    let guided = start.guided;
    let veteran = guide.veteran === true;

    // ---------------------------------------------------------------- preview
    const canvas = h('canvas', { width: '380', height: '380' }) as HTMLCanvasElement;
    const badge = h('div', { class: 'pv-badge' });
    const statW = h('div', { class: 'v' }, '–'), statB = h('div', { class: 'v' }, '–'), statF = h('div', { class: 'v' }, '–');
    const stat = (v: HTMLElement, k: string, color: string) => h('div', { class: 'nc-stat' }, v, h('div', { class: 'k' }, h('i', { style: `background:${color}` }), k));
    let pending = false;
    const redraw = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const pcfg: CityConfigData = { ...cfg, size: PREVIEW_RES };
        const st = new CityState(pcfg);
        const topts = cfg.terrain === 'region' ? terrainOptionsFor(cfg, o.region, o.tile) : { logicalSize: size };
        generateTerrain(st, { ...topts, logicalSize: size });
        drawCityMap(canvas, st, { relief: size / PREVIEW_RES });
        const s = terrainStats(st, 2.5 * (size / PREVIEW_RES));
        statW.textContent = `${Math.round(s.water * 100)}%`;
        statB.textContent = `${Math.round(s.buildable * 100)}%`;
        statF.textContent = `${Math.round(s.forest * 100)}%`;
        badge.textContent = cfg.terrain === 'region' ? 'REGION TERRAIN' : customPreset.toUpperCase();
      });
    };

    // ---------------------------------------------------------------- form
    const nameInput = h('input', { type: 'text', value: cfg.name, maxlength: '32', spellcheck: 'false' }) as HTMLInputElement;
    nameInput.addEventListener('input', () => (cfg.name = nameInput.value));
    const mayorInput = h('input', { type: 'text', value: cfg.mayor, maxlength: '32', spellcheck: 'false' }) as HTMLInputElement;
    mayorInput.addEventListener('input', () => (cfg.mayor = mayorInput.value));
    const diceName = button('', { icon: 'dice', cls: 'sq-btn', title: 'Random name', sound: 'shuffle', onClick: () => ((nameInput.value = cfg.name = randomCityName()), nameInput.focus()) });
    const diceMayor = button('', { icon: 'dice', cls: 'sq-btn', title: 'Random name', sound: 'shuffle', onClick: () => (mayorInput.value = cfg.mayor = randomMayorName()) });

    // FH-11: each card carries its difficulty's one-line description (FH-04's blurb, which names the starting funds)
    const diff = segmented<Difficulty>({
      cols: 2,
      items: DIFFICULTIES.map((d) => {
        const blurb = difficultyRules(d).blurb;
        return { value: d, title: DIFFICULTY_NAMES[d], sub: blurb.charAt(0).toUpperCase() + blurb.slice(1) };
      }),
      value: cfg.difficulty,
      onChange: (v) => {
        pickDifficulty(v);
        // Easy unticks Disasters; the other modes tick it again (each difficulty's default), and the player can still change it
        cfg.disasters = difficultyRules(v).defaultDisasters;
        disastersInput.checked = cfg.disasters;
      },
    });

    const hill = slider({ label: 'Hilliness', icon: 'mountain', value: cfg.hilliness, onInput: (v) => ((cfg.hilliness = v), redraw()) });
    const water = slider({ label: 'Water', icon: 'droplet', value: cfg.waterAmount, onInput: (v) => ((cfg.waterAmount = v), redraw()) });
    const trees = slider({ label: 'Trees', icon: 'tree', value: cfg.treeDensity, onInput: (v) => ((cfg.treeDensity = v), redraw()) });
    const presetChips = segmented<Exclude<TerrainPreset, 'region'>>({
      chips: true,
      items: PRESETS.map((p) => ({ value: p.id, title: p.label, icon: p.icon })),
      value: customPreset,
      onChange: (v) => {
        customPreset = v;
        cfg.terrain = v;
        redraw();
      },
    });
    const randomize = button('Randomize', {
      icon: 'refresh',
      cls: '',
      sound: 'shuffle',
      onClick: () => {
        cfg.seed = Math.floor(Math.random() * 2 ** 31);
        redraw();
      },
    });
    const custom = h(
      'div',
      { class: 'nc-custom', style: 'max-height: 400px' },
      h('div', { class: 'field' }, h('label', {}, 'Landscape', h('span', { style: 'margin-left:auto' }, randomize)), presetChips.el),
      h('div', { class: 'nc-row2' }, hill.el, water.el),
    );
    const setSource = (src: 'region' | 'custom') => {
      cfg.terrain = src === 'region' ? 'region' : customPreset;
      custom.classList.toggle('hidden', src === 'region');
      redraw();
    };
    const source = segmented<'region' | 'custom'>({
      cols: 2,
      items: [
        { value: 'region', title: 'Region terrain', sub: hasRegion ? 'Matches the neighbouring cities' : 'Not available', icon: 'globe', disabled: !hasRegion },
        { value: 'custom', title: 'Custom terrain', sub: 'Pick a landscape preset', icon: 'mountain' },
      ],
      value: cfg.terrain === 'region' ? 'region' : 'custom',
      onChange: (v) => setSource(v),
    });

    const climate = segmented<Climate>({
      chips: true,
      items: [
        { value: 'temperate', title: 'Temperate', icon: 'tree' },
        { value: 'desert', title: 'Desert', icon: 'sun' },
        { value: 'tropical', title: 'Tropical', icon: 'droplet' },
        { value: 'alpine', title: 'Alpine', icon: 'mountain' },
      ],
      value: cfg.climate,
      onChange: (v) => ((cfg.climate = v), redraw()),
    });
    const yearInput = h('input', { type: 'number', value: String(cfg.startYear), min: '1800', max: '2200', step: '1' }) as HTMLInputElement;
    yearInput.addEventListener('change', () => (cfg.startYear = Math.max(1800, Math.min(2200, Math.floor(+yearInput.value || 2000)))));

    const disasters = toggle('Disasters', cfg.disasters, (v) => (cfg.disasters = v));
    const disastersInput = disasters.querySelector('input') as HTMLInputElement;
    // FH-11's start toggles sit by Found City: "Guided start", and the veteran briefing once FH-18 shows it
    const guidedToggle = toggle(NEW_CITY_TEXT.guided, guided, (v) => (guided = v));
    const veteranToggle = SHOW_VETERAN ? toggle(NEW_CITY_TEXT.veteran, veteran, (v) => (veteran = v)) : null;

    const km = Math.round((size * 16) / 100) / 10;
    const sizeLabel = `${TILE_SIZE_LABEL[(size / REGION_UNIT_CELLS) as 1 | 2 | 4] ?? 'Custom'} tile · ${km} × ${km} km · ${size} × ${size} cells`;
    const form = h(
      'div',
      {},
      h('div', { class: 'nc-row2' }, h('div', { class: 'field' }, h('label', {}, 'City name'), h('div', { class: 'input-row' }, nameInput, diceName)), h('div', { class: 'field' }, h('label', {}, 'Mayor'), h('div', { class: 'input-row' }, mayorInput, diceMayor))),
      h('div', { class: 'field nc-diff' }, h('label', {}, 'Difficulty · starting funds'), diff.el),
      h('div', { class: 'field' }, h('label', {}, 'Terrain'), source.el),
      custom,
      trees.el,
      h('div', { class: 'field' }, h('label', {}, 'Climate'), climate.el),
      h('div', { style: 'display:flex; align-items:center; gap: 22px; margin-top: 2px' }, disasters, h('div', { class: 'field', style: 'margin:0; flex-direction:row; align-items:center; gap:10px' }, h('label', {}, 'Starting year'), yearInput)),
      h('div', { class: 'kbd-hint nc-note' }, NEW_CITY_TEXT.disasters(DISASTER_MIN_POP)),
    );
    const body = h(
      'div',
      { class: 'nc-grid' },
      h(
        'div',
        { class: 'nc-preview-wrap' },
        h('div', { class: 'nc-preview' }, canvas, badge, h('div', { class: 'pv-compass', title: 'North' }, 'N')),
        h('div', { class: 'nc-stats' }, stat(statW, 'Water', '#3ea5ae'), stat(statB, 'Buildable', '#8aa650'), stat(statF, 'Forest', '#2c5528')),
      ),
      form,
    );
    const found = button('Found City', {
      icon: 'building',
      cls: 'lg warm',
      sound: 'none',
      onClick: () => {
        cfg.name = nameInput.value.trim() || randomCityName();
        cfg.mayor = mayorInput.value.trim() || randomMayorName();
        // city founded: short celebratory fanfare (plays over the loading screen)
        audio.play('found');
        // FH-11: later dialogs open on this choice; the veteran flag is the guide's, per profile
        savePref(CHOICE_PREF, { difficulty: cfg.difficulty, disasters: cfg.disasters, guided } satisfies NewCityChoice);
        if (veteranToggle) savePref('onboarding', { ...guidePref(), veteran });
        result = { ...cfg, size, guided };
        m.close(true);
      },
    });
    const m: Modal = new Modal({
      title: 'Found a New City',
      subtitle: h('span', {}, icon('map', 12), ' ', sizeLabel, o.region ? ` · ${o.region.data.name}` : ''),
      icon: 'building',
      size: 'wide',
      body,
      footer: [guidedToggle, veteranToggle, h('span', { class: 'kbd-hint' }, 'The city size is fixed by the region tile.'), h('div', { class: 'grow' }), button('Cancel', { cls: 'lg ghost', onClick: () => m.close() }), found].filter((n): n is HTMLElement => !!n),
      onEnter: () => found.click(),
      onClose: () => resolve(result),
    });
    setSource(cfg.terrain === 'region' ? 'region' : 'custom');
  });
}
