/**
 * New City dialog: returns a CityConfigData (or null when cancelled).
 *   openNewCityDialog({ region, tile }) -> Promise<CityConfigData | null>
 * Live 2D preview (shaded relief) regenerated on every change from a low-res CityState (64^2, < 10 ms) using the
 * same terrain generator as the real city (region sampler, or preset with logicalSize = real size).
 */
import type { Climate, Difficulty, TerrainPreset } from '../core/types';
import { REGION_UNIT_CELLS } from '../core/constants';
import { DIFFICULTY_FUNDS, defaultCityConfig, type CityConfigData } from '../sim/config';
import { CityState } from '../sim/CityState';
import { generateTerrain, terrainStats, type TerrainOptions } from '../sim/terrainGen';
import { audio } from '../audio';
import type { RegionModel } from './RegionModel';
import type { RegionTile } from './types';
import { TILE_SIZE_LABEL } from './types';
import { drawCityMap } from './mapPreview';
import { randomCityName, randomMayorName } from './names';
import { Modal, segmented, slider, toggle } from './ui/modal';
import { button, h, icon, formatMoney } from './ui/dom';

export interface NewCityDialogOptions {
  region?: RegionModel;
  tile?: RegionTile;
  /** city size (cells) when there is no tile */
  size?: number;
  defaults?: Partial<CityConfigData>;
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

const PREVIEW_RES = 64;

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

export function openNewCityDialog(o: NewCityDialogOptions = {}): Promise<CityConfigData | null> {
  return new Promise((resolve) => {
    const size = o.tile ? o.tile.size * REGION_UNIT_CELLS : o.size ?? 128;
    const hasRegion = !!(o.region && o.tile);
    const base = o.region && o.tile ? o.region.cityConfigFor(o.tile, o.defaults) : defaultCityConfig({ size, ...o.defaults });
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
    const diceName = button('', { icon: 'dice', cls: 'sq-btn', title: 'Random name', onClick: () => ((nameInput.value = cfg.name = randomCityName()), nameInput.focus()) });
    const diceMayor = button('', { icon: 'dice', cls: 'sq-btn', title: 'Random name', onClick: () => (mayorInput.value = cfg.mayor = randomMayorName()) });

    const diff = segmented<Difficulty>({
      cols: 4,
      items: [
        { value: 'easy', title: 'Easy', sub: formatMoney(DIFFICULTY_FUNDS.easy) },
        { value: 'medium', title: 'Medium', sub: formatMoney(DIFFICULTY_FUNDS.medium) },
        { value: 'hard', title: 'Hard', sub: formatMoney(DIFFICULTY_FUNDS.hard) },
        { value: 'sandbox', title: 'Sandbox', sub: 'Unlimited' },
      ],
      value: cfg.difficulty,
      onChange: (v) => {
        cfg.difficulty = v;
        cfg.startFunds = DIFFICULTY_FUNDS[v];
        cfg.sandbox = v === 'sandbox';
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

    const sizeLabel = `${TILE_SIZE_LABEL[(size / REGION_UNIT_CELLS) as 1 | 2 | 4] ?? 'Custom'} · ${(size * 16) / 1000} × ${(size * 16) / 1000} km`;
    const form = h(
      'div',
      {},
      h('div', { class: 'nc-row2' }, h('div', { class: 'field' }, h('label', {}, 'City name'), h('div', { class: 'input-row' }, nameInput, diceName)), h('div', { class: 'field' }, h('label', {}, 'Mayor'), h('div', { class: 'input-row' }, mayorInput, diceMayor))),
      h('div', { class: 'field' }, h('label', {}, 'Difficulty · starting funds'), diff.el),
      h('div', { class: 'field' }, h('label', {}, 'Terrain'), source.el),
      custom,
      trees.el,
      h('div', { class: 'field' }, h('label', {}, 'Climate'), climate.el),
      h('div', { style: 'display:flex; align-items:center; gap: 22px; margin-top: 2px' }, toggle('Disasters', cfg.disasters, (v) => (cfg.disasters = v)), h('div', { class: 'field', style: 'margin:0; flex-direction:row; align-items:center; gap:10px' }, h('label', {}, 'Starting year'), yearInput)),
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
        audio.play('reward');
        result = { ...cfg, size };
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
