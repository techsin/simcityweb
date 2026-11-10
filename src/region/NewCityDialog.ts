/**
 * New City dialog: returns a CityConfigData (or null when cancelled).
 *   openNewCityDialog({ region, tile }) -> Promise<CityConfigData | null>
 * Live 2D preview (shaded relief) regenerated on every change from a low-res CityState (64^2, < 10 ms) using the
 * same terrain generator as the real city (region sampler, or preset with logicalSize = real size).
 * FH-11: each difficulty card carries its FH-04 blurb (difficultyRules); a profile's first city preselects Easy and
 * Guided start, later dialogs the last choice (newCityPrefs.ts); Disasters follows the difficulty's default until the
 * player sets it, with a note on when disasters start.
 * LG-12: founding a sister city (`sister`: the plan of regionEffects.ts) fills in the parent's mayor and adds the
 * endowment slider (endowmentField, in its own section below); "Found City" then asks once more, since the transfer
 * can't be undone, and writes the amount into the plan. Cancelling either dialog moves no money.
 */
import type { Climate, Difficulty, TerrainPreset } from '../core/types';
import { REGION_UNIT_CELLS } from '../core/constants';
import { DIFFICULTY_FUNDS, defaultCityConfig, type CityConfigData } from '../sim/config';
import { DISASTER_MIN_POP, difficultyRules } from '../sim/economy/tuning';
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
import { Modal, confirmDialog, segmented, slider, toggle } from './ui/modal';
import { button, formatMoney, h, icon } from './ui/dom';
import { formatMoney as exactMoney } from '../sim/economy/format';
import { ENDOWMENT_MAX, ENDOWMENT_SHARE, ENDOWMENT_YEARS, type SisterPlan } from './regionEffects';

export interface NewCityDialogOptions {
  region?: RegionModel;
  tile?: RegionTile;
  /** city size (cells) when there is no tile */
  size?: number;
  defaults?: Partial<CityConfigData>;
  /** Runs inside the player's Found click (before the dialog promise resolves). */
  onFound?: () => void;
  /** LG-12: the city is founded as a sister city: its parent's mayor is filled in, the parent's endowment is offered,
   *  and the amount the player confirms is written into the plan (`sister.amount`; 0 when the dialog is cancelled) */
  sister?: SisterPlan;
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

// ---------------------------------------------------------------------------------------------------------------
// LG-12: a sister city's endowment. Its own section: openNewCityDialog only places the field, tells it when the
// difficulty changes and asks it before founding.
// ---------------------------------------------------------------------------------------------------------------
interface EndowmentField {
  el: HTMLElement;
  /** the difficulty changed: the start funds in the note, and no endowment for a sandbox city */
  refresh(): void;
  /**
   * "Found City" was pressed. true: the founding goes on, and the plan holds the amount — 0 for none, or what the
   * player has just agreed to. false: the confirmation is open (the transfer can't be undone); agreeing calls `again`
   * (press Found once more), declining returns to the form.
   */
  confirmed(city: string, again: () => void): boolean;
}

/** the slider (0 … the plan's limit) with a note on the rule and on what the new city starts with; a parent that can
 *  give nothing now gets the reason instead (the 10-year rule names the date it can endow again) */
function endowmentField(plan: SisterPlan, cfg: CityConfigData): EndowmentField {
  const p = plan.parent;
  const note = h('div', { class: 'nc-note' });
  plan.amount = 0;
  if (plan.blocked || plan.limit <= 0) {
    note.textContent = plan.blocked ?? `${p.name} has too little money to endow a sister city.`;
    return { el: h('div', { class: 'field nc-endow' }, h('label', {}, `Endowment from ${p.name}`), note), refresh: () => undefined, confirmed: () => true };
  }
  let chosen = 0, agreed = false, asking = false;
  const amount = () => (cfg.sandbox ? 0 : chosen);
  const refresh = () => {
    sl.setDisabled(!!cfg.sandbox);
    const give = amount();
    note.textContent = cfg.sandbox
      ? 'A sandbox city has unlimited money: no endowment is sent.'
      : give > 0
        ? `The new city starts with ${exactMoney(cfg.startFunds + give)} (${exactMoney(cfg.startFunds)} + ${exactMoney(give)}). ${p.name} pays it once, on its budget line “Sister city endowment”.`
        : `${p.name} can give up to ${exactMoney(plan.limit)}: ${Math.round(ENDOWMENT_SHARE * 100)}% of its ${exactMoney(p.funds)}, at most ${exactMoney(ENDOWMENT_MAX)}, once every ${ENDOWMENT_YEARS} years.`;
  };
  const sl = slider({ label: `Endowment from ${p.name}`, icon: 'coins', value: 0, min: 0, max: plan.limit, step: plan.step, format: (v) => formatMoney(v), onInput: (v) => ((chosen = Math.max(0, Math.min(plan.limit, v))), refresh()) });
  // (a field like the others: the note sits under the slider, at the form's own spacing, also in the compact layout)
  sl.el.style.marginBottom = '0';
  refresh();
  const confirmed = (city: string, again: () => void): boolean => {
    const give = amount();
    if (give <= 0 || agreed) {
      plan.amount = give;
      return true;
    }
    if (asking) return false;
    asking = true;
    void confirmDialog({
      title: `Give ${exactMoney(give)} to ${city || 'the new city'}?`,
      message: `${p.name} pays ${exactMoney(give)} from its treasury when the city is founded. This transfer can’t be undone, and ${p.name} can’t endow another sister city for ${ENDOWMENT_YEARS} years.`,
      confirm: 'Found and give',
      icon: 'coins',
    }).then((ok) => {
      asking = false;
      if (!ok) return;
      agreed = true;
      again();
    });
    return false;
  };
  return { el: h('div', { class: 'field nc-endow' }, sl.el, note), refresh, confirmed };
}

export function openNewCityDialog(o: NewCityDialogOptions = {}): Promise<CityConfigData | null> {
  return new Promise((resolve) => {
    const size = o.tile ? o.tile.size * REGION_UNIT_CELLS : o.size ?? 128;
    const hasRegion = !!(o.region && o.tile);
    const pick = newCityDefaults(!!o.region?.data.tiles.some((t) => t.city));
    const startDifficulty = o.defaults?.difficulty ?? pick.difficulty;
    const withDifficulty: Partial<CityConfigData> = { difficulty: startDifficulty, startFunds: DIFFICULTY_FUNDS[startDifficulty], sandbox: startDifficulty === 'sandbox', ...o.defaults };
    const base = o.region && o.tile ? o.region.cityConfigFor(o.tile, withDifficulty) : defaultCityConfig({ size, ...withDifficulty });
    const cfg: CityConfigData = { ...base, name: o.defaults?.name ?? randomCityName(), mayor: o.defaults?.mayor ?? o.sister?.parent.mayor ?? randomMayorName() };
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
        endow?.refresh();
      },
    });
    diff.el.classList.add('nc-diff');
    // LG-12: the parent's endowment, under the starting funds it adds to
    const endow = o.sister ? endowmentField(o.sister, cfg) : null;
    const disasters = toggleControl('Disasters', cfg.disasters, (v) => {
      disastersTouched = true;
      cfg.disasters = v;
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
      endow?.el,
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
        // LG-12: an endowment is confirmed first; "Found and give" presses Found again, declining returns to the form
        if (endow && !endow.confirmed(nameInput.value.trim(), () => found.click())) return;
        cfg.name = nameInput.value.trim() || randomCityName();
        cfg.mayor = mayorInput.value.trim() || randomMayorName();
        // city founded: short celebratory fanfare (plays over the loading screen)
        audio.play('found');
        rememberNewCity({ difficulty: cfg.difficulty, guided, veteran });
        result = { ...cfg, size };
        m.close(true);
      },
    });
    const m: Modal = new Modal({
      title: o.sister ? 'Found a Sister City' : 'Found a New City',
      subtitle: h('span', {}, icon('map', 12), ' ', sizeLabel, o.region ? ` · ${o.region.data.name}` : '', o.sister ? ` · sister city of ${o.sister.parent.name}` : ''),
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
