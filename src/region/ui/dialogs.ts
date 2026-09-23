/** Settings, Credits, New Region and Load Region dialogs. */
import { audio } from '../../audio';
import type { Climate } from '../../core/types';
import { RNG } from '../../core/rng';
import { loadSettings, saveSettings, type AppSettings } from '../settings';
import { REGION_PRESETS, RegionModel, createRegionData, generateRegionTerrain, type RegionPresetInfo } from '../RegionModel';
import type { RegionData, RegionPresetId } from '../types';
import { drawRegionMap } from '../mapPreview';
import { randomRegionName } from '../names';
import { Modal, segmented, slider, toggle, confirmDialog, toast } from './modal';
import { button, formatPop, h, icon, timeAgo } from './dom';
import { deleteRegion, downloadBlob, exportRegion, importRegion, listRegions, safeFileName } from '../../save';
import { EMBLEM_SVG } from './emblem';

// ------------------------------------------------------------------ settings
export function openSettings(onChange?: (s: AppSettings) => void): Modal {
  const s = loadSettings();
  const vol = (label: string, kind: 'master' | 'music' | 'sfx' | 'ambience', ic: string) =>
    slider({ label, icon: ic, value: audio.getVolume(kind), onInput: (v) => audio.setVolume(kind, v) }).el;
  const commit = () => {
    saveSettings(s);
    onChange?.(s);
  };
  const body = h(
    'div',
    {},
    h('div', { class: 'section-title' }, 'Audio'),
    vol('Master volume', 'master', 'volume'),
    vol('Music', 'music', 'music'),
    vol('Sound effects', 'sfx', 'sparkles'),
    vol('City ambience', 'ambience', 'building'),
    h('div', { style: 'display:flex; gap:24px; margin: 4px 0 10px' }, toggle('Play music', audio.musicEnabled, (v) => audio.setMusicEnabled(v)), toggle('Mute all', audio.muted, (v) => audio.setMuted(v))),
    h('div', { style: 'display:flex; gap:24px; margin: 0 0 18px' }, toggle('Interface sounds', audio.uiSounds, (v) => audio.setUiSounds(v)), toggle('Hover sounds', audio.hoverSounds, (v) => audio.setHoverSounds(v))),
    h('div', { class: 'section-title' }, 'Graphics'),
    h(
      'div',
      { class: 'field' },
      h('label', {}, 'Default quality'),
      segmented({
        items: [
          { value: 'low', title: 'Low', sub: 'Laptops' },
          { value: 'medium', title: 'Medium', sub: 'Balanced' },
          { value: 'high', title: 'High', sub: 'Recommended' },
          { value: 'ultra', title: 'Ultra', sub: 'Fast GPUs' },
        ],
        value: s.quality,
        cols: 4,
        onChange: (v) => {
          s.quality = v;
          commit();
        },
      }).el,
    ),
    h('div', { class: 'section-title' }, 'Gameplay'),
    h(
      'div',
      { class: 'field' },
      h('label', {}, 'Autosave · game time'),
      segmented({
        chips: true,
        items: [
          { value: 0, title: 'Off' },
          { value: 3, title: 'Every 3 months' },
          { value: 6, title: 'Every 6 months' },
          { value: 12, title: 'Every year' },
        ],
        value: s.autosaveMonths,
        onChange: (v) => {
          s.autosaveMonths = v;
          commit();
        },
      }).el,
    ),
    h(
      'div',
      { style: 'display:flex; gap:24px; margin-top: 4px' },
      toggle('Edge scrolling', s.edgeScroll, (v) => {
        s.edgeScroll = v;
        commit();
      }),
      toggle('Show FPS', s.showFps, (v) => {
        s.showFps = v;
        commit();
      }),
    ),
  );
  const m: Modal = new Modal({ title: 'Settings', subtitle: 'Saved automatically on this device', icon: 'settings', size: 'mid', body, footer: [h('div', { class: 'grow' }), button('Done', { cls: 'lg primary', onClick: () => m.close() })] });
  return m;
}

// ------------------------------------------------------------------ credits
export function openCredits(): Modal {
  const body = h(
    'div',
    { class: 'credits' },
    h('div', { html: EMBLEM_SVG, style: 'width:64px;height:64px;margin:0 auto 12px' }),
    h('div', { class: 'cr-logo' }, 'METROPOLIS'),
    h('div', { class: 'cr-sub' }, 'A browser city builder, in the spirit of SimCity 4'),
    h(
      'dl',
      {},
      ...[
        ['Simulation', 'sim-core · sim-infra'],
        ['World rendering', 'render-world'],
        ['City rendering', 'render-city'],
        ['Buildings & props', 'seven asset artists'],
        ['Game UI', 'ui-game'],
        ['Menus, regions, saves & audio', 'meta'],
      ].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))),
    ),
    h('p', { class: 'cr-note' }, 'Every model, texture, sound and note of music is generated procedurally at runtime.', h('br'), 'Built with three.js, TypeScript and Vite. Made with ', icon('heart', 12), ' for city builders everywhere.'),
  );
  const m: Modal = new Modal({ title: 'Credits', icon: 'info', body, footer: [h('div', { class: 'grow' }), button('Close', { cls: 'lg', onClick: () => m.close() })] });
  return m;
}

// ------------------------------------------------------------------ new region
export interface NewRegionChoice {
  name: string;
  seed: number;
  preset: RegionPresetId;
  climate?: Climate;
}

const BLANK_IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const previewCache = new Map<string, string>();
function presetPreview(p: RegionPresetInfo, seed: number): string {
  const key = `${p.id}:${seed}`;
  const hit = previewCache.get(key);
  if (hit) return hit;
  const terrain = generateRegionTerrain(seed, p.id, { samplesPerUnit: 6 });
  const { data } = createRegionData({ seed, preset: p.id, terrain });
  const model = new RegionModel(data, terrain);
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 150;
  drawRegionMap(c, model);
  const url = c.toDataURL('image/jpeg', 0.85);
  previewCache.set(key, url);
  return url;
}

export function openNewRegion(): Promise<NewRegionChoice | null> {
  return new Promise((resolve) => {
    let result: NewRegionChoice | null = null;
    let seed = Math.floor(Math.random() * 1e6);
    let preset: RegionPresetId = 'greenvale';
    let climate: Climate | 'auto' = 'auto';
    const nameInput = h('input', { type: 'text', value: REGION_PRESETS[0].name, maxlength: '40', spellcheck: 'false' }) as HTMLInputElement;
    let nameTouched = false;
    nameInput.addEventListener('input', () => (nameTouched = true));
    const seedInput = h('input', { type: 'number', value: String(seed), min: '0', max: '999999999' }) as HTMLInputElement;
    const cards: HTMLButtonElement[] = [];
    const imgs: HTMLImageElement[] = [];
    const grid = h('div', { class: 'preset-grid' });
    const refreshImages = () => {
      // generate previews progressively so the dialog opens instantly
      let k = 0;
      const next = () => {
        if (k >= REGION_PRESETS.length || !m.isOpen) return;
        const p = REGION_PRESETS[k];
        imgs[k].classList.add('loading-img');
        imgs[k].src = presetPreview(p, seed);
        k++;
        setTimeout(next, 0);
      };
      setTimeout(next, 30);
    };
    REGION_PRESETS.forEach((p) => {
      const img = h('img', { alt: '', src: BLANK_IMG, class: 'loading-img' }) as HTMLImageElement;
      img.addEventListener('load', () => img.src !== BLANK_IMG && img.classList.remove('loading-img'));
      imgs.push(img);
      const card = h(
        'button',
        { class: 'preset-card', type: 'button' },
        img,
        h('div', { class: 'pc-body' }, h('div', { class: 'pc-name' }, p.name, h('span', { class: `climate-tag ${p.id === 'random' ? '' : p.climate}` }, p.id === 'random' ? 'any' : p.climate)), h('div', { class: 'pc-blurb' }, p.blurb)),
      ) as HTMLButtonElement;
      card.addEventListener('click', () => {
        audio.play('tab');
        preset = p.id;
        cards.forEach((c) => c.classList.toggle('on', c === card));
        if (!nameTouched) nameInput.value = p.id === 'random' ? randomRegionName(new RNG(seed)) : p.name;
      });
      cards.push(card);
      grid.appendChild(card);
    });
    cards[0].classList.add('on');
    const dice = button('', {
      icon: 'dice',
      cls: 'sq-btn',
      title: 'Random seed',
      sound: 'shuffle',
      onClick: () => {
        seed = Math.floor(Math.random() * 1e6);
        seedInput.value = String(seed);
        refreshImages();
      },
    });
    seedInput.addEventListener('change', () => {
      seed = Math.max(0, Math.floor(+seedInput.value || 0));
      refreshImages();
    });
    const nameDice = button('', { icon: 'dice', cls: 'sq-btn', title: 'Random name', sound: 'shuffle', onClick: () => ((nameInput.value = randomRegionName()), (nameTouched = true)) });
    const body = h(
      'div',
      {},
      h('div', { class: 'field' }, h('label', {}, 'Landscape'), grid),
      h(
        'div',
        { style: 'display:grid; grid-template-columns: 1.4fr 0.8fr 1.2fr; gap: 14px' },
        h('div', { class: 'field' }, h('label', {}, 'Region name'), h('div', { class: 'input-row' }, nameInput, nameDice)),
        h('div', { class: 'field' }, h('label', {}, 'Seed'), h('div', { class: 'input-row' }, seedInput, dice)),
        h(
          'div',
          { class: 'field' },
          h('label', {}, 'Climate'),
          segmented<Climate | 'auto'>({
            chips: true,
            items: [
              { value: 'auto', title: 'Auto' },
              { value: 'temperate', title: 'Temperate' },
              { value: 'desert', title: 'Desert' },
              { value: 'tropical', title: 'Tropical' },
              { value: 'alpine', title: 'Alpine' },
            ],
            value: 'auto',
            onChange: (v) => (climate = v),
          }).el,
        ),
      ),
    );
    const create = button('Create Region', {
      icon: 'sparkles',
      cls: 'lg primary',
      sound: 'confirm',
      onClick: () => {
        result = { name: nameInput.value.trim() || 'New Region', seed, preset, climate: climate === 'auto' ? undefined : climate };
        m.close(true);
      },
    });
    const m: Modal = new Modal({
      title: 'New Region',
      subtitle: 'A 16 × 16 km landscape of small, medium and large city tiles',
      icon: 'globe',
      size: 'wide',
      body,
      footer: [h('div', { class: 'grow' }), button('Cancel', { cls: 'lg ghost', onClick: () => m.close() }), create],
      onEnter: () => create.click(),
      onClose: () => resolve(result),
    });
    refreshImages();
  });
}

// ------------------------------------------------------------------ load region
export function openLoadRegion(onOpen: (r: RegionData) => void): Modal {
  const list = h('div', { class: 'region-list' });
  const fileInput = h('input', { type: 'file', accept: '.metropolis,application/octet-stream', style: 'display:none' }) as HTMLInputElement;
  const render = async () => {
    list.replaceChildren(h('div', { class: 'empty-state' }, 'Loading…'));
    const regions = await listRegions();
    if (!regions.length) {
      list.replaceChildren(h('div', { class: 'empty-state' }, icon('map', 40), h('div', {}, 'No saved regions yet.'), h('div', { class: 'kbd-hint', style: 'margin-top:6px' }, 'Create a new region or import a .metropolis file.')));
      return;
    }
    list.replaceChildren(
      ...regions.map((r) => {
        const img = h('img', { class: 'rr-img', src: r.preview ?? '', alt: '' });
        const row = h(
          'div',
          { class: 'region-row' },
          img,
          h(
            'div',
            {},
            h('div', { class: 'rr-name' }, r.name, h('span', { class: `climate-tag ${r.climate}` }, r.climate)),
            h(
              'div',
              { class: 'rr-meta' },
              h('span', {}, icon('users', 14), `${formatPop(r.totals?.population ?? 0)} residents`),
              h('span', {}, icon('building', 14), `${r.totals?.cities ?? 0} of ${r.tiles.length} tiles founded`),
              h('span', {}, icon('calendar', 14), timeAgo(r.lastPlayed)),
            ),
          ),
          h(
            'div',
            { class: 'rr-actions' },
            button('', {
              icon: 'download',
              title: 'Export .metropolis file',
              onClick: async () => {
                try {
                  downloadBlob(await exportRegion(r.id), safeFileName(r.name));
                  toast('Region exported', 'good');
                } catch (e) {
                  toast(`Export failed: ${(e as Error).message}`, 'bad');
                }
              },
            }),
            button('', {
              icon: 'trash',
              cls: 'danger',
              title: 'Delete region',
              onClick: async () => {
                if (await confirmDialog({ title: 'Delete region?', message: `“${r.name}” and all of its cities will be permanently deleted.`, confirm: 'Delete', danger: true })) {
                  await deleteRegion(r.id);
                  audio.play('bulldoze');
                  render();
                }
              },
            }),
            button('Open', {
              icon: 'play',
              cls: 'primary',
              sound: 'confirm',
              onClick: () => {
                m.close(true);
                onOpen(r);
              },
            }),
          ),
        );
        return row;
      }),
    );
  };
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const r = await importRegion(f);
      toast(`Imported “${r.name}”`, 'good');
      audio.play('confirm');
      render();
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, 'bad');
    }
  });
  const m: Modal = new Modal({
    title: 'Load Region',
    subtitle: 'Regions are saved in this browser',
    icon: 'folder',
    size: 'mid',
    body: h('div', {}, list, fileInput),
    footer: [button('Import file…', { icon: 'upload', cls: 'lg', onClick: () => fileInput.click() }), h('div', { class: 'grow' }), button('Close', { cls: 'lg ghost', onClick: () => m.close() })],
  });
  render();
  return m;
}
