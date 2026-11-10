/**
 * New City dialog: returns a CityConfigData (or null when cancelled).
 *   openNewCityDialog({ region, tile }) -> Promise<CityConfigData | null>
 * Live 2D preview (shaded relief) regenerated on every change from a low-res CityState (64^2, < 10 ms) using the
 * same terrain generator as the real city (region sampler, or preset with logicalSize = real size).
 * FH-11: each difficulty card carries its FH-04 blurb (difficultyRules); a profile's first city preselects Easy and
 * Guided start, later dialogs the last choice (newCityPrefs.ts); Disasters follows the difficulty's default until the
 * player sets it, with a note on when disasters start.
 * LG-14: the Mayor's challenges (challengePicker: chips under the options, saved as config.challenges through
 * applyChallenges), and the title screen's Challenges dialog (openChallengesDialog: the scenario choice).
 */
import './ui/challenges.css';
import type { Climate, Difficulty, TerrainPreset } from '../core/types';
import { REGION_UNIT_CELLS } from '../core/constants';
import { DIFFICULTY_FUNDS, defaultCityConfig, type CityConfigData } from '../sim/config';
import { DISASTER_MIN_POP, difficultyRules } from '../sim/economy/tuning';
import { MAYOR_CHALLENGES, type MayorChallenge } from '../sim/economy/challenges';
import {
  CHALLENGE_BADGE_NOTE, CHALLENGE_INFO, MEDALS, MEDAL_NAMES, SCENARIOS, SCENARIO_LIST, applyChallenges, loadMedals, type ScenarioId,
} from '../game/scenarios';
import { guideCopy } from '../ui/guide/copy';
import { newCityDefaults, rememberNewCity } from './newCityPrefs';
import { CityState } from '../sim/CityState';
import { generateTerrain, terrainStats, type TerrainOptions } from '../sim/terrainGen';
import { audio } from '../audio';
import type { RegionModel } from './RegionModel';
import type { RegionTile } from './types';
import { TILE_SIZE_LABEL } from './types';
import { drawCityMap } from './mapPreview';
import { randomCityName, randomMayorName } from './names';
import { Modal, segmented, slider, toggle } from './ui/modal';
import { button, h, icon } from './ui/dom';

export interface NewCityDialogOptions {
  region?: RegionModel;
  tile?: RegionTile;
  /** city size (cells) when there is no tile */
  size?: number;
  defaults?: Partial<CityConfigData>;
  /** Runs inside the player's Found click (before the dialog promise resolves). */
  onFound?: () => void;
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

/** a labelled switch (modal.ts's toggle) that can also be set from code */
function toggleControl(label: string, checked: boolean, onChange: (v: boolean) => void): { el: HTMLElement; set(v: boolean): void } {
  const el = toggle(label, checked, onChange);
  const input = el.querySelector('input') as HTMLInputElement;
  return { el, set: (v) => void (input.checked = v) };
}

export function openNewCityDialog(o: NewCityDialogOptions = {}): Promise<CityConfigData | null> {
  return new Promise((resolve) => {
    const size = o.tile ? o.tile.size * REGION_UNIT_CELLS : o.size ?? 128;
    const hasRegion = !!(o.region && o.tile);
    const pick = newCityDefaults(!!o.region?.data.tiles.some((t) => t.city));
    const startDifficulty = o.defaults?.difficulty ?? pick.difficulty;
    const withDifficulty: Partial<CityConfigData> = { difficulty: startDifficulty, startFunds: DIFFICULTY_FUNDS[startDifficulty], sandbox: startDifficulty === 'sandbox', ...o.defaults };
    const base = o.region && o.tile ? o.region.cityConfigFor(o.tile, withDifficulty) : defaultCityConfig({ size, ...withDifficulty });
    const cfg: CityConfigData = { ...base, name: o.defaults?.name ?? randomCityName(), mayor: o.defaults?.mayor ?? randomMayorName() };
    if (!hasRegion && cfg.terrain === 'region') cfg.terrain = 'hills';
    let customPreset: Exclude<TerrainPreset, 'region'> = cfg.terrain === 'region' ? 'hills' : cfg.terrain;
    let result: CityConfigData | null = null;

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

    // FH-11: the one-line descriptions come from FH-04's rules (they name the money, so no separate amount)
    const blurb = (d: Difficulty) => { const b = difficultyRules(d).blurb; return b.charAt(0).toUpperCase() + b.slice(1); };
    let disastersTouched = false;
    const diff = segmented<Difficulty>({
      cols: 2,
      items: (['easy', 'medium', 'hard', 'sandbox'] as const).map((d) => ({ value: d, title: d.charAt(0).toUpperCase() + d.slice(1), sub: blurb(d) })),
      value: cfg.difficulty,
      onChange: (v) => {
        cfg.difficulty = v;
        cfg.startFunds = DIFFICULTY_FUNDS[v];
        cfg.sandbox = v === 'sandbox';
        // Easy unticks Disasters; the others tick it again, until the player sets the toggle themselves
        if (!disastersTouched) disasters.set((cfg.disasters = difficultyRules(v).defaultDisasters));
        challenges.setSandbox(cfg.sandbox);
      },
    });
    diff.el.classList.add('nc-diff');
    const disasters = toggleControl('Disasters', cfg.disasters, (v) => {
      disastersTouched = true;
      cfg.disasters = v;
      // (LG-14: "Frequent disasters" needs disasters)
      if (!v) challenges.set('frequentDisasters', false);
    });
    let guided = pick.guided, veteran = pick.veteran;
    const guide = toggleControl('Guided start', guided, (v) => {
      guided = v;
      if (v && veteran) veteranSw.set((veteran = false));
    });
    const veteranSw = toggleControl('I\u2019ve played city builders before', veteran, (v) => {
      veteran = v;
      if (v && guided) guide.set((guided = false));
    });
    // LG-14: the Mayor's challenges; "Frequent disasters" switches Disasters on with it
    const challenges = challengePicker(!!cfg.sandbox, (id, on) => {
      if (id === 'frequentDisasters' && on) disasters.set((cfg.disasters = true));
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

    const km = Math.round((size * 16) / 100) / 10;
    const sizeLabel = `${TILE_SIZE_LABEL[(size / REGION_UNIT_CELLS) as 1 | 2 | 4] ?? 'Custom'} tile · ${km} × ${km} km · ${size} × ${size} cells`;
    const form = h(
      'div',
      {},
      h('div', { class: 'nc-row2' }, h('div', { class: 'field' }, h('label', {}, 'City name'), h('div', { class: 'input-row' }, nameInput, diceName)), h('div', { class: 'field' }, h('label', {}, 'Mayor'), h('div', { class: 'input-row' }, mayorInput, diceMayor))),
      h('div', { class: 'field' }, h('label', {}, 'Difficulty · starting funds'), diff.el),
      h('div', { class: 'field' }, h('label', {}, 'Terrain'), source.el),
      custom,
      trees.el,
      h('div', { class: 'field' }, h('label', {}, 'Climate'), climate.el),
      h(
        'div',
        { class: 'nc-opts' },
        h('div', { class: 'nc-opt' }, disasters.el, h('div', { class: 'nc-note' }, guideCopy.phaseA.A3Disasters(DISASTER_MIN_POP))),
        h('div', { class: 'nc-opt' }, guide.el, veteranSw.el, h('div', { class: 'field nc-year' }, h('label', {}, 'Starting year'), yearInput)),
      ),
      challenges.el,
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
        if (result) return;
        o.onFound?.();
        cfg.name = nameInput.value.trim() || randomCityName();
        cfg.mayor = mayorInput.value.trim() || randomMayorName();
        // city founded: short celebratory fanfare (plays over the loading screen)
        audio.play('found');
        rememberNewCity({ difficulty: cfg.difficulty, guided, veteran });
        result = applyChallenges({ ...cfg, size }, challenges.picks());
        m.close(true);
      },
    });
    const m: Modal = new Modal({
      title: 'Found a New City',
      subtitle: h('span', {}, icon('map', 12), ' ', sizeLabel, o.region ? ` · ${o.region.data.name}` : ''),
      icon: 'building',
      size: 'wide',
      body,
      footer: [h('span', { class: 'kbd-hint' }, 'The city size is fixed by the region tile.'), h('div', { class: 'grow' }), button('Cancel', { cls: 'lg ghost', onClick: () => m.close() }), found],
      onEnter: () => found.click(),
      onClose: () => resolve(result),
    });
    setSource(cfg.terrain === 'region' ? 'region' : 'custom');
  });
}

// ---------------------------------------------------------------------------------------------------------------
// LG-14: Mayor's challenges and the Challenges dialog
// ---------------------------------------------------------------------------------------------------------------
/**
 * The Mayor's challenges of the New City dialog: one chip per challenge, each switched on and off on its own, with the
 * rules of the chosen ones underneath (none chosen: how a challenge earns its badge). Sandbox has none.
 * `onPick`: the player switched a chip, or (on = true) a chosen challenge still holds after the difficulty changed.
 */
function challengePicker(sandbox: boolean, onPick: (id: MayorChallenge, on: boolean) => void): {
  el: HTMLElement;
  /** the chosen challenges, in MAYOR_CHALLENGES order */
  picks(): MayorChallenge[];
  set(id: MayorChallenge, on: boolean): void;
  /** the dialog's difficulty changed: Sandbox clears and disables the chips */
  setSandbox(on: boolean): void;
} {
  const picked = new Set<MayorChallenge>();
  const chips = new Map<MayorChallenge, HTMLButtonElement>();
  const note = h('div', { class: 'nc-note' });
  const picks = () => MAYOR_CHALLENGES.filter((id) => picked.has(id));
  const paintNote = () => {
    note.textContent = '';
    if (sandbox) note.append('Not in Sandbox: unlimited money leaves nothing to challenge.');
    else {
      for (const id of picks()) note.append(h('div', {}, h('b', {}, `${CHALLENGE_INFO[id].name}: `), CHALLENGE_INFO[id].rule));
      note.append(h('div', {}, CHALLENGE_BADGE_NOTE));
    }
  };
  const set = (id: MayorChallenge, on: boolean) => {
    if (on) picked.add(id);
    else picked.delete(id);
    const chip = chips.get(id)!;
    chip.classList.toggle('on', on);
    chip.setAttribute('aria-pressed', String(on));
    paintNote();
  };
  const row = h('div', { class: 'chips' });
  for (const id of MAYOR_CHALLENGES) {
    const chip = h('button', { class: 'chip', type: 'button', title: CHALLENGE_INFO[id].rule, 'aria-pressed': 'false', 'data-sfx': 'none' }, CHALLENGE_INFO[id].name) as HTMLButtonElement;
    chip.addEventListener('click', () => {
      const on = !picked.has(id);
      audio.play(on ? 'toggleOn' : 'toggleOff');
      set(id, on);
      onPick(id, on);
    });
    chips.set(id, chip);
    row.appendChild(chip);
  }
  const setSandbox = (on: boolean) => {
    sandbox = on;
    for (const [id, chip] of chips) {
      chip.disabled = on;
      if (on && picked.has(id)) set(id, false);
    }
    paintNote();
    // the difficulty just changed, and with it the dialog's switches: a chosen challenge states its needs again
    for (const id of picks()) onPick(id, true);
  };
  setSandbox(sandbox);
  return { el: h('div', { class: 'field ch-picker' }, h('label', {}, 'Mayor’s challenges · optional'), row, note), picks, set, setSandbox };
}

/** a medal as a small badge (the same look as on the region screen: ui/challenges.css) */
function medalChip(medal: (typeof MEDALS)[number]): HTMLElement {
  return h('span', { class: `ch-badge medal ${medal}` }, MEDAL_NAMES[medal]);
}

/**
 * The title screen's Challenges dialog: the scenarios with what each medal takes and the medal this profile holds.
 * Resolves the scenario to start, or null when the dialog was closed.
 */
export function openChallengesDialog(): Promise<ScenarioId | null> {
  return new Promise((resolve) => {
    const medals = loadMedals();
    // opens on the first scenario without a medal
    let pick: ScenarioId = (SCENARIO_LIST.find((s) => !medals[s.id]) ?? SCENARIO_LIST[0]).id;
    let result: ScenarioId | null = null;
    const detail = h('div', { class: 'ch-detail' });
    const show = (id: ScenarioId) => {
      pick = id;
      const s = SCENARIOS[id], best = medals[id];
      detail.textContent = '';
      detail.append(
        h('h3', {}, s.title),
        h('p', { class: 'ch-brief' }, s.brief),
        h('div', { class: 'ch-goals' }, ...MEDALS.map((m) => h('div', { class: 'ch-goal' }, medalChip(m), h('span', {}, s.goals[m])))),
        h('div', { class: 'ch-best' }, 'Your best:', best ? medalChip(best.medal) : h('span', { class: 'ch-badge none' }, 'No medal yet')),
      );
    };
    const list = segmented<ScenarioId>({
      items: SCENARIO_LIST.map((s) => ({ value: s.id, title: s.title, sub: s.tagline })),
      value: pick,
      onChange: show,
    });
    list.el.classList.add('ch-list');
    // each scenario's medal beside its title
    list.el.querySelectorAll('.seg-item').forEach((item, k) => {
      const best = medals[SCENARIO_LIST[k].id];
      if (best) item.querySelector('.si-t')?.append(medalChip(best.medal));
    });
    show(pick);
    const start = button('Start scenario', {
      icon: 'play',
      cls: 'lg warm',
      sound: 'none',
      onClick: () => {
        if (result) return;
        audio.play('found');
        result = pick;
        m.close(true);
      },
    });
    const m: Modal = new Modal({
      title: 'Challenges',
      subtitle: 'Scenarios with a goal and three medals. Your medals are kept with your profile.',
      icon: 'star',
      size: 'mid',
      body: h('div', { class: 'ch-grid' }, list.el, detail),
      footer: [
        h('span', { class: 'kbd-hint' }, 'Rules of your own? Found any city with Mayor’s challenges.'),
        h('div', { class: 'grow' }),
        button('Cancel', { cls: 'lg ghost', onClick: () => m.close() }),
        start,
      ],
      onEnter: () => start.click(),
      onClose: () => resolve(result),
    });
  });
}
