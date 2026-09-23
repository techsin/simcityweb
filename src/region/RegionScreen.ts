/**
 * RegionScreen — RegionView + HUD overlay: region card (name, totals, RCI), toolbar (menu, rename, export, import,
 * music, settings), founded-cities list, hover tooltip, floating city labels and the selected-tile card
 * (Found new city / Play / Delete city).
 */
import { audio } from '../audio';
import type { QualityLevel } from '../render/contracts';
import { PRESET_BY_ID, type RegionModel } from './RegionModel';
import { RegionView } from './RegionView';
import { TILE_SIZE_LABEL, type RegionData, type RegionTile } from './types';
import { button, formatMoney, formatPop, h, icon, timeAgo, withSounds } from './ui/dom';
import { confirmDialog, promptDialog, toast } from './ui/modal';
import { downloadBlob, exportRegion, importRegion, safeFileName } from '../save';

export interface RegionScreenCallbacks {
  onPlay(tile: RegionTile): void;
  onFound(tile: RegionTile): void;
  onMenu(): void;
  onSettings(): void;
  /** region data changed (rename, delete city...) -> persist */
  onChanged(): void | Promise<void>;
  onDeleteCity(tile: RegionTile): Promise<void>;
  /** a region file was imported from this screen */
  onImported?(region: RegionData): void;
}

export class RegionScreen {
  readonly el: HTMLElement;
  readonly view: RegionView;
  readonly ready: Promise<void>;
  private host: HTMLElement;
  private card!: HTMLElement;
  private list!: HTMLElement;
  private tip: HTMLElement;
  private tileCard: HTMLElement | null = null;
  private labels = new Map<string, HTMLElement>();
  private labelLayer: HTMLElement;
  private musicBtn!: HTMLButtonElement;
  private offAudio: () => void;
  private fileInput: HTMLInputElement;

  constructor(root: HTMLElement, readonly model: RegionModel, private cb: RegionScreenCallbacks, opts: { quality?: QualityLevel } = {}) {
    this.host = h('div', { class: 'meta-layer region-host', style: 'background: radial-gradient(ellipse 90% 80% at 50% 38%, #2a3a52 0%, #141c2a 55%, #090d14 100%)' });
    root.appendChild(this.host);
    this.view = new RegionView(this.host, model, { quality: opts.quality });
    let resolveReady!: () => void;
    this.ready = new Promise((r) => (resolveReady = r));
    this.view.onFirstFrame = () => resolveReady();
    this.labelLayer = h('div', { class: 'meta-layer', style: 'pointer-events:none; overflow:hidden' });
    this.tip = h('div', { class: 'region-tip', style: 'opacity:0' });
    this.fileInput = h('input', { type: 'file', accept: '.metropolis,application/octet-stream', style: 'display:none' }) as HTMLInputElement;
    this.fileInput.addEventListener('change', () => this.importFile());
    this.el = h('div', { class: 'region-hud' });
    root.append(this.labelLayer, this.el, this.tip);
    this.buildHud();
    this.offAudio = audio.onChange(() => this.syncMusic());

    this.view.onHover = (tile, x, y) => this.showTip(tile, x, y);
    this.view.onClick = (tile) => {
      if (tile) audio.play('click');
      this.selectTile(tile);
    };
    this.view.onDoubleClick = (tile) => (tile.city ? cb.onPlay(tile) : cb.onFound(tile));
    this.view.onFrame = () => this.updateLabels();
    void this.view.refreshCities();
    this.view.start();
  }

  // ------------------------------------------------------------------ HUD
  private buildHud(): void {
    const d = this.model.data;
    const rename = h('button', { class: 'icon-btn sq rename', title: 'Rename region', style: 'width:30px;height:30px;border:0;background:transparent' }, icon('edit', 15)) as HTMLButtonElement;
    withSounds(rename);
    rename.addEventListener('click', () => this.rename());
    this.card = h('div', { class: 'rh-card glass' });
    this.list = h('div', { class: 'rc-list scroll' });
    const cities = h('div', { class: 'rh-cities glass' }, h('div', { class: 'rc-head' }, icon('building', 14), 'Cities'), this.list);
    this.musicBtn = h('button', { class: 'icon-btn', title: 'Music on / off' }) as HTMLButtonElement;
    withSounds(this.musicBtn);
    this.musicBtn.addEventListener('click', () => audio.toggleMusic());
    this.syncMusic();
    const tbtn = (ic: string, title: string, fn: () => void) => {
      const b = h('button', { class: 'icon-btn', title }, icon(ic, 17)) as HTMLButtonElement;
      withSounds(b);
      b.addEventListener('click', fn);
      return b;
    };
    const top = h(
      'div',
      { class: 'rh-top-right' },
      tbtn('download', 'Export region (.metropolis)', () => this.exportFile()),
      tbtn('upload', 'Import region file', () => this.fileInput.click()),
      this.musicBtn,
      tbtn('settings', 'Settings', () => this.cb.onSettings()),
      tbtn('home', 'Main menu', () => this.cb.onMenu()),
    );
    const hint = h(
      'div',
      { class: 'rh-hint glass' },
      h('span', {}, h('kbd', {}, 'Click'), 'select'),
      h('span', {}, h('kbd', {}, 'Drag'), 'pan'),
      h('span', {}, h('kbd', {}, 'Right-drag'), 'rotate'),
      h('span', {}, h('kbd', {}, 'Wheel'), 'zoom'),
      h('span', {}, h('kbd', {}, 'Dbl-click'), 'play'),
    );
    this.el.append(this.card, top, cities, hint, this.fileInput);
    this.renderCard(rename);
    this.renderList();
    void d;
  }

  private syncMusic(): void {
    this.musicBtn?.replaceChildren(icon(audio.musicEnabled ? 'music' : 'musicOff', 17));
  }

  private renderCard(renameBtn?: HTMLButtonElement): void {
    const d = this.model.data;
    this.model.recomputeTotals();
    const t = d.totals;
    const preset = PRESET_BY_ID[d.preset]?.name ?? d.preset;
    const rename = renameBtn ?? (this.card.querySelector('.rename') as HTMLButtonElement);
    const total = Math.max(1, t.r + t.c + t.i);
    this.card.replaceChildren(
      h('div', { class: 'rh-title' }, h('h1', { title: d.name }, d.name), rename),
      h('div', { class: 'rh-tags' }, h('span', { class: `climate-tag ${d.climate}` }, d.climate), preset !== d.name ? h('span', {}, preset) : null, h('span', {}, '16 × 16 km')),
      h('div', { class: 'rh-pop' }, h('span', { class: 'v' }, formatPop(t.population)), h('span', { class: 'k' }, 'Region population')),
      h(
        'div',
        { class: 'rh-rci' },
        h('div', {}, h('i', { style: `background: var(--res); width:${Math.max(6, (t.r / total) * 100)}%` }), h('b', {}, formatPop(t.r)), 'Residents'),
        h('div', {}, h('i', { style: `background: var(--com); width:${Math.max(6, (t.c / total) * 100)}%` }), h('b', {}, formatPop(t.c)), 'Commercial'),
        h('div', {}, h('i', { style: `background: var(--ind); width:${Math.max(6, (t.i / total) * 100)}%` }), h('b', {}, formatPop(t.i)), 'Industrial'),
      ),
      h('div', { class: 'rh-tags', style: 'margin-top:12px' }, icon('building', 13), `${t.cities} of ${d.tiles.length} tiles founded`),
    );
  }

  private renderList(): void {
    const founded = this.model.data.tiles.filter((t) => t.city).sort((a, b) => (b.city!.population ?? 0) - (a.city!.population ?? 0));
    if (!founded.length) {
      this.list.replaceChildren(h('div', { class: 'rc-empty' }, 'No cities yet. Click any tile on the map, then ', h('b', {}, 'Found New City'), ' to start building.'));
      return;
    }
    this.list.replaceChildren(
      ...founded.map((t) => {
        const c = t.city!;
        const row = h(
          'div',
          { class: `rc-item ${this.view.selectedTile === t ? 'on' : ''}` },
          c.thumbnail ? h('img', { src: c.thumbnail, alt: '' }) : h('div', { class: 'rc-ph' }),
          h('div', { style: 'min-width:0' }, h('div', { class: 'rc-n' }, c.name), h('div', { class: 'rc-p' }, `${formatPop(c.population)} · ${TILE_SIZE_LABEL[t.size]}`)),
        );
        row.addEventListener('pointerenter', () => audio.hover());
        row.addEventListener('click', () => {
          audio.play('click');
          this.selectTile(t);
          this.view.focusTile(t);
        });
        row.addEventListener('dblclick', () => this.cb.onPlay(t));
        return row;
      }),
    );
  }

  private showTip(tile: RegionTile | null, x: number, y: number): void {
    if (!tile) {
      this.tip.style.opacity = '0';
      return;
    }
    const km = tile.size;
    const c = tile.city;
    this.tip.replaceChildren(
      h('div', { class: 'rt-t' }, c ? c.name : 'Unfounded land', h('span', { class: `size-badge s${tile.size}` }, TILE_SIZE_LABEL[tile.size])),
      h('div', { class: 'rt-s' }, c ? `${formatPop(c.population)} residents · Mayor ${c.mayor}` : `${km} × ${km} km · ${tile.size * 64} × ${tile.size * 64} cells`),
      h('div', { class: 'rt-cta' }, icon(c ? 'play' : 'plus', 12), c ? 'Double-click to play' : 'Double-click to found a new city'),
    );
    const r = this.tip.parentElement!.getBoundingClientRect();
    const tx = Math.min(x - r.left, r.width - 260), ty = Math.min(y - r.top, r.height - 110);
    this.tip.style.left = `${tx}px`;
    this.tip.style.top = `${ty}px`;
    this.tip.style.opacity = '1';
  }

  selectTile(tile: RegionTile | null): void {
    this.view.select(tile);
    this.tileCard?.remove();
    this.tileCard = null;
    this.renderList();
    if (!tile) return;
    const c = tile.city;
    const km = tile.size;
    const water = Math.round(this.model.tileWaterFraction(tile) * 100);
    const img = c?.thumbnail ? h('img', { class: 'tc-img', src: c.thumbnail, alt: '' }) : this.tilePreview(tile);
    const actions = h('div', { class: 'tc-actions' });
    if (c) {
      actions.append(
        button('Play', { icon: 'play', cls: 'lg warm', sound: 'confirm', onClick: () => this.cb.onPlay(tile) }),
        button('Delete city', { icon: 'trash', cls: 'lg danger', onClick: () => this.deleteCity(tile) }),
      );
    } else {
      actions.append(button('Found New City', { icon: 'plus', cls: 'lg warm', sound: 'confirm', onClick: () => this.cb.onFound(tile) }));
    }
    const stats = c
      ? [
          h('span', {}, icon('users', 14), h('b', {}, formatPop(c.population)), 'residents'),
          h('span', {}, icon('coins', 14), h('b', {}, formatMoney(c.funds))),
          h('span', {}, icon('calendar', 14), c.year ? `Year ${c.year}` : '', ' · ', timeAgo(c.lastPlayed)),
        ]
      : [h('span', {}, icon('map', 14), h('b', {}, `${km} × ${km} km`)), h('span', {}, icon('droplet', 14), h('b', {}, `${water}%`), 'water'), h('span', {}, icon('building', 14), h('b', {}, `${tile.size * 64}²`), 'cells')];
    this.tileCard = h(
      'div',
      { class: 'tile-card glass' },
      img,
      h(
        'div',
        { style: 'min-width:0' },
        h('div', { class: 'tc-title' }, h('h3', {}, c ? c.name : 'Unfounded land'), h('span', { class: `size-badge s${tile.size}` }, TILE_SIZE_LABEL[tile.size])),
        h('div', { class: 'tc-sub' }, c ? `Mayor ${c.mayor} · ${c.difficulty} difficulty` : 'Found a city here — its terrain will match the neighbouring tiles.'),
        h('div', { class: 'tc-stats' }, ...stats),
        actions,
      ),
    );
    this.el.appendChild(this.tileCard);
  }

  private tilePreview(tile: RegionTile): HTMLElement {
    const c = h('canvas', { class: 'tc-img', width: '96', height: '96' }) as HTMLCanvasElement;
    // quick relief of the tile from the region height function
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(96, 96);
    const s = tile.size * 1024;
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 96; x++) {
        const wx = tile.x * 1024 + ((x + 0.5) / 96) * s, wz = tile.z * 1024 + ((y + 0.5) / 96) * s;
        const hh = this.model.heightAt(wx, wz);
        const e = s / 96;
        const sh = Math.max(0.55, Math.min(1.3, 1 - (this.model.gridHeight(wx + e, wz) - this.model.gridHeight(wx - e, wz) + this.model.gridHeight(wx, wz + e) - this.model.gridHeight(wx, wz - e)) * 0.03));
        const f = this.model.forestAt(wx, wz);
        let r: number, g: number, b: number;
        if (hh < 0) [r, g, b] = [40, 120, 150];
        else if (hh < 1.5) [r, g, b] = [220, 205, 160];
        else {
          r = 110 + Math.min(hh, 120) * 0.35 - f * 60;
          g = 150 - f * 55;
          b = 72 - f * 20;
        }
        const o = (y * 96 + x) * 4;
        img.data[o] = r * sh;
        img.data[o + 1] = g * sh;
        img.data[o + 2] = b * sh;
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private updateLabels(): void {
    const seen = new Set<string>();
    for (const t of this.model.data.tiles) {
      if (!t.city) continue;
      seen.add(t.key);
      let el = this.labels.get(t.key);
      if (!el) {
        el = h('div', { class: 'city-label' });
        this.labelLayer.appendChild(el);
        this.labels.set(t.key, el);
      }
      const txt = `${t.city.name}|${t.city.population}`;
      if (el.dataset.txt !== txt) {
        el.dataset.txt = txt;
        el.replaceChildren(t.city.name, h('small', {}, formatPop(t.city.population)));
      }
      const p = this.view.project(this.view.tileCenter(t, 260));
      if (!p) {
        el.style.opacity = '0';
        continue;
      }
      el.style.opacity = '1';
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    for (const [k, el] of this.labels)
      if (!seen.has(k)) {
        el.remove();
        this.labels.delete(k);
      }
  }

  // ------------------------------------------------------------------ actions
  private async rename(): Promise<void> {
    const name = await promptDialog({ title: 'Rename region', label: 'Region name', value: this.model.data.name, maxLength: 40 });
    if (!name) return;
    this.model.data.name = name;
    this.renderCard();
    await this.cb.onChanged();
    toast('Region renamed', 'good');
  }

  private async deleteCity(tile: RegionTile): Promise<void> {
    const c = tile.city;
    if (!c) return;
    const ok = await confirmDialog({
      title: `Delete ${c.name}?`,
      message: `The city of ${c.name} (${formatPop(c.population)} residents) will be bulldozed and its save permanently deleted. The land returns to its natural state.`,
      confirm: 'Delete city',
      danger: true,
    });
    if (!ok) return;
    await this.cb.onDeleteCity(tile);
    audio.play('bulldoze');
    await this.refresh();
    this.selectTile(tile);
    toast(`${c.name} was deleted`);
  }

  private async exportFile(): Promise<void> {
    try {
      await this.cb.onChanged();
      downloadBlob(await exportRegion(this.model.data.id), safeFileName(this.model.data.name));
      toast('Region exported', 'good');
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'bad');
    }
  }

  private async importFile(): Promise<void> {
    const f = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!f) return;
    try {
      const r = await importRegion(f);
      toast(`Imported “${r.name}”`, 'good');
      this.cb.onImported?.(r);
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, 'bad');
    }
  }

  /** re-read region data (after returning from a city / deleting) */
  async refresh(): Promise<void> {
    this.model.reindex();
    this.renderCard();
    this.renderList();
    if (this.view.selectedTile) this.selectTile(this.view.selectedTile);
    await this.view.refreshCities();
  }

  dispose(): void {
    this.offAudio();
    this.view.dispose();
    this.el.remove();
    this.tip.remove();
    this.labelLayer.remove();
    this.host.remove();
  }
}
