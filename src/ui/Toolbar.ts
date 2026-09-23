/** Bottom-center toolbar: categories → flyout menus of tools (data-driven from the catalog), rich tooltips, tool chip. */
import { Network, Zone } from '../core/types';
import type { GameContext } from '../game/context';
import { CATEGORIES, CATEGORY_COLORS, categoryOfTool, findToolSpec, type ToolCategory, type ToolSpec } from '../game/toolCatalog';
import type { BuildingDef } from '../sim/catalogTypes';
import type { ActionResult } from '../sim/actions';
import { clear, escapeHtml, h, toggleClass } from './dom';
import { icon } from './icons';
import { money, num, titleCase } from './format';
import { thumbs } from './thumbs';
import { uiZoom } from './zoom';

const CAT_LABELS: Record<string, string> = {
  power: 'Power', water: 'Water', garbage: 'Garbage', police: 'Police', fire: 'Fire', health: 'Health', education: 'Education',
  park: 'Parks & recreation', civic: 'Civic', landmark: 'Landmark', reward: 'Reward', transport: 'Transport',
};

function hotkeyOf(spec: ToolSpec): string | undefined {
  return spec.hotkey;
}

export class Toolbar {
  readonly el: HTMLDivElement;
  private bar: HTMLDivElement;
  private flyout: HTMLDivElement;
  private chip: HTMLDivElement;
  private tip: HTMLDivElement;
  private btns = new Map<string, HTMLButtonElement>();
  private openCat: string | null = null;
  private tileCost = new Map<string, number | null>();
  private freeCell: { x: number; z: number } | null | undefined;

  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.el = h('div', { class: 'hud-bottom' });
    this.chip = h('div', { class: 'tool-chip mp-glass' });
    this.bar = h('div', { class: 'toolbar mp-glass' });
    this.flyout = h('div', { class: 'flyout mp-glass' });
    this.tip = h('div', { class: 'rich-tip mp-glass' });
    this.bar.appendChild(this.flyout);
    CATEGORIES.forEach((c, i) => {
      if (c.id === 'bulldoze') this.bar.appendChild(h('div', { class: 'sep' }));
      const b = h('button', { class: 'tb-btn', style: { '--c': c.color } as Record<string, string>, title: '' }, h('span', { class: 'ico-wrap', html: icon(c.icon, 23) }), h('span', { class: 'tb-l' }, c.label), c.hotkey ? h('span', { class: 'tb-k' }, c.hotkey.split(' ')[0]) : null) as HTMLButtonElement;
      b.addEventListener('click', () => {
        this.onCategory(c);
        b.blur();
      });
      b.addEventListener('pointerenter', () => {
        this.showCatTip(c, b);
        this.ctx.sound('hover');
      });
      b.addEventListener('pointerleave', () => this.hideTip());
      this.btns.set(c.id, b);
      this.bar.appendChild(b);
      void i;
    });
    this.el.append(this.chip, this.bar);
    parent.appendChild(this.el);
    parent.appendChild(this.tip);
    document.addEventListener('pointerdown', (e) => {
      if (this.openCat && !(e.target as HTMLElement).closest('.toolbar')) this.closeFlyout();
    }, { signal: ctx.signal });
    ctx.ui.on('tool', () => this.syncActive());
    ctx.ui.on('panel', ({ id }) => {
      if (id === 'dataviews') this.syncActive();
    });
    ctx.ui.on('overlay', () => this.syncActive());
    this.syncActive();
  }

  get flyoutOpen(): boolean {
    return this.openCat !== null;
  }

  private onCategory(c: ToolCategory): void {
    this.hideTip();
    if (c.toolId) {
      this.closeFlyout();
      const cur = this.ctx.tools.activeId;
      this.ctx.tools.select(cur === c.toolId ? null : c.toolId);
      this.ctx.sound('click');
      return;
    }
    if (c.panelId) {
      this.closeFlyout();
      this.ctx.panels.toggle(c.panelId);
      return;
    }
    if (this.openCat === c.id) this.closeFlyout();
    else this.openFlyout(c.id);
  }

  openFlyout(catId: string): void {
    const c = CATEGORIES.find((x) => x.id === catId);
    if (!c?.groups) return;
    this.openCat = catId;
    for (const [id, b] of this.btns) toggleClass(b, 'open', id === catId);
    this.renderFlyout(c);
    this.flyout.style.maxWidth = Math.min(1180, (this.el.parentElement?.clientWidth ?? 1600) - 32) + 'px';
    // position centered over the category button, clamped to the bar
    const b = this.btns.get(catId)!;
    const center = b.offsetLeft + b.offsetWidth / 2;
    this.flyout.style.left = center + 'px';
    requestAnimationFrame(() => {
      const barW = this.bar.offsetWidth;
      const fw = this.flyout.offsetWidth;
      const vw = (this.el.parentElement?.clientWidth ?? window.innerWidth);
      const barLeft = this.bar.getBoundingClientRect().left / uiZoom();
      // wide menus center on the toolbar, narrow ones on their button
      let left = fw > barW * 0.9 ? barW / 2 : center;
      const minC = fw / 2 - barLeft + 8, maxC = vw - barLeft - fw / 2 - 8;
      left = Math.max(minC, Math.min(maxC, left));
      this.flyout.style.left = left + 'px';
      this.flyout.classList.add('open');
    });
    this.ctx.sound('open');
  }

  closeFlyout(): void {
    if (!this.openCat) return;
    this.openCat = null;
    this.flyout.classList.remove('open');
    for (const b of this.btns.values()) b.classList.remove('open');
    this.hideTip();
  }

  // ------------------------------------------------------------------------------------------------ per-tile costs
  private findFreeCell(): { x: number; z: number } | null {
    if (this.freeCell !== undefined) return this.freeCell;
    const st = this.ctx.state;
    const N = st.size;
    const c = N >> 1;
    for (let r = 0; r < N / 2; r++) {
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = c + dx, z = c + dz;
          if (!st.inBounds(x, z)) continue;
          const i = st.idx(x, z);
          if (!st.water[i] && !st.network[i] && st.building[i] < 0 && !st.zone[i] && st.cellSlope(x, z) < 1.5) return (this.freeCell = { x, z });
        }
    }
    return (this.freeCell = null);
  }

  private perTileCost(spec: ToolSpec): number | null {
    if (this.tileCost.has(spec.id)) return this.tileCost.get(spec.id)!;
    const cell = this.findFreeCell();
    let cost: number | null = null;
    if (cell) {
      const a = this.ctx.actions;
      let r: ActionResult | null = null;
      try {
        if (spec.id.startsWith('zone:')) r = a.zone({ x0: cell.x, z0: cell.z, x1: cell.x + 1, z1: cell.z + 1 }, Number(spec.id.slice(5)) as Zone, true);
        else if (spec.id.startsWith('net:')) r = a.buildNetwork([cell], Number(spec.id.slice(4)) as Network, true);
        else if (spec.id === 'power') r = a.buildPowerLine([cell], true);
        else if (spec.id === 'subway') r = a.buildSubway([cell], true);
      } catch {
        r = null;
      }
      if (r && isFinite(r.cost) && r.cost > 0) cost = r.cost;
    }
    this.tileCost.set(spec.id, cost);
    return cost;
  }

  /** cost line html: one-off cost + monthly upkeep (plops) or per-tile cost */
  private costLine(spec: ToolSpec): string {
    if (spec.def) {
      const cost = spec.cost ? money(spec.cost) : 'Free';
      const up = spec.upkeep ? `${money(spec.upkeep)}/mo` : spec.income ? `+${money(spec.income)}/mo` : '&nbsp;';
      return `<span>${cost}</span><span class="up">${up}</span>`;
    }
    if (spec.costUnit) {
      const c = this.perTileCost(spec);
      return `<span>${c ? `${money(c)}${spec.costUnit}` : '—'}</span><span class="up">&nbsp;</span>`;
    }
    return '<span>&nbsp;</span><span class="up">&nbsp;</span>';
  }

  // ------------------------------------------------------------------------------------------------ flyout
  private renderFlyout(c: ToolCategory): void {
    clear(this.flyout);
    let groups = [] as ReturnType<NonNullable<ToolCategory['groups']>>;
    try {
      groups = c.groups!(this.ctx);
    } catch (e) {
      console.error('[toolbar] failed to build category', c.id, e);
    }
    const head = h('div', { class: 'fly-head' }, h('span', { class: 'ico-wrap', style: { color: c.color }, html: icon(c.icon, 18) }), h('span', { class: 'fly-title' }, c.label), c.hotkey ? h('span', { class: 'dim' }, 'Hotkeys ', ...c.hotkey.split(' ').map((k) => h('kbd', null, k))) : null);
    const wrap = h('div', { class: 'fly-groups' });
    const active = this.ctx.tools.activeId;
    for (const g of groups) {
      const items = h('div', { class: 'fly-items' });
      if (!g.items.length) items.appendChild(h('div', { class: 'fly-empty' }, 'Nothing available yet'));
      for (const s of g.items) items.appendChild(this.item(s, s.id === active));
      wrap.appendChild(h('div', { class: 'fly-group' }, h('div', { class: 'sec-title', html: (g.icon ? icon(g.icon, 13) : '') + `<span>${escapeHtml(g.label)}</span>` }), items));
    }
    this.flyout.append(head, wrap);
  }

  private item(s: ToolSpec, active: boolean): HTMLElement {
    const color = s.color ?? '#3fa7ff';
    const thumb = h('div', { class: 'fly-thumb' });
    if (s.id.startsWith('zone:')) thumb.appendChild(h('span', { class: 'zsw' }));
    thumb.appendChild(h('span', { class: 'ico-wrap', html: icon(s.icon, 26) }));
    if (s.def) {
      const def = s.def;
      const cached = thumbs.cached(def.model);
      const put = (url: string | null) => {
        if (!url) return;
        for (const ch of [...thumb.children]) if (!ch.classList.contains('prog')) ch.remove();
        thumb.prepend(h('img', { src: url, alt: '' }));
      };
      if (cached) put(cached);
      else if (cached === undefined) thumbs.get(def.model, def.footprint).then(put);
    }
    const el = h('div', { class: 'fly-item' + (active ? ' active' : '') + (s.locked ? ' locked' : '') + (s.disabled ? ' disabled' : ''), style: { '--c': color } as Record<string, string> },
      thumb,
      h('div', { class: 'fly-name' + (s.label.length <= 13 ? ' one' : '') }, s.label),
      h('div', { class: 'fly-cost', html: this.costLine(s) }),
    );
    const hk = hotkeyOf(s);
    if (hk) el.appendChild(h('span', { class: 'fly-key' }, h('kbd', null, hk)));
    if (s.locked) {
      el.appendChild(h('span', { class: 'lock', html: icon('lock', 12) }));
      if (s.locked.progress !== undefined) thumb.appendChild(h('span', { class: 'prog' }, h('i', { style: { width: `${Math.round(s.locked.progress * 100)}%` } })));
    }
    el.addEventListener('click', () => {
      if (s.locked || s.disabled) {
        this.ctx.sound('error');
        el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 220 });
        return;
      }
      if (this.ctx.tools.select(s.id)) {
        this.ctx.sound('click');
        this.closeFlyout();
      }
    });
    el.addEventListener('pointerenter', () => {
      this.showSpecTip(s, el);
      this.ctx.sound('hover');
    });
    el.addEventListener('pointerleave', () => this.hideTip());
    return el;
  }

  // ------------------------------------------------------------------------------------------------ rich tooltip
  private placeTip(anchor: HTMLElement): void {
    const z = uiZoom();
    const r = anchor.getBoundingClientRect();
    const pr = this.tip.parentElement!.getBoundingClientRect();
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    let x = (r.left + r.width / 2 - pr.left) / z - tw / 2;
    let y = (r.top - pr.top) / z - th - 10;
    const maxX = pr.width / z - tw - 8;
    x = Math.max(8, Math.min(maxX, x));
    if (y < 8) y = (r.bottom - pr.top) / z + 10;
    this.tip.style.left = x + 'px';
    this.tip.style.top = y + 'px';
    this.tip.classList.add('show');
  }

  hideTip(): void {
    this.tip.classList.remove('show');
  }

  private showCatTip(c: ToolCategory, anchor: HTMLElement): void {
    if (this.openCat) return;
    const desc: Record<string, string> = {
      zones: 'Zone land for residential, commercial and industrial growth.',
      transport: 'Roads, highways, rail, subways and transit stations.',
      utilities: 'Power plants and lines, water and garbage services.',
      civic: 'Police, fire, health, education and civic buildings.',
      parks: 'Parks and recreation raise land value and happiness.',
      landmarks: 'Landmarks, rewards and business deals.',
      terrain: 'Reshape the land, plant trees' + (this.ctx.state.config.disasters || this.ctx.sandbox() ? ' and unleash disasters.' : '.'),
      bulldoze: 'Demolish buildings, roads and trees.',
      query: 'Inspect buildings, roads and lots.',
      dataviews: 'Data views: traffic, pollution, land value, coverage…',
    };
    this.tip.innerHTML = `<h4>${escapeHtml(c.label)}</h4><p style="margin-bottom:0">${escapeHtml(desc[c.id] ?? '')}</p>${c.hotkey ? `<div class="rt-key">Hotkey ${c.hotkey.split(' ').map((k) => `<kbd>${k}</kbd>`).join(' ')}</div>` : ''}`;
    this.tip.style.width = '240px';
    this.placeTip(anchor);
  }

  private showSpecTip(s: ToolSpec, anchor: HTMLElement): void {
    const rows: [string, string][] = [];
    let cat = '';
    let catColor = s.color ?? 'var(--accent-2)';
    const d: BuildingDef | undefined = s.def;
    if (d) {
      cat = CAT_LABELS[d.category] ?? titleCase(d.category);
      catColor = CATEGORY_COLORS[d.category] ?? catColor;
      rows.push(['Cost', d.cost ? money(d.cost) : 'Free']);
      if (d.upkeep) rows.push(['Upkeep', `${money(d.upkeep)} / month`]);
      if (d.income) rows.push(['Income', `<span class="pos">+${money(d.income)} / month</span>`]);
      rows.push(['Size', `${d.footprint[0]} × ${d.footprint[1]} tiles`]);
      if (d.jobs) rows.push(['Jobs', num(d.jobs)]);
      if (d.capacity && d.category !== 'growable') rows.push(['Capacity', num(d.capacity)]);
      if (d.powerOut) rows.push(['Power output', `${num(d.powerOut)} MW`]);
      if (d.waterOut) rows.push(['Water output', `${num(d.waterOut)} kL/day`]);
      if (d.garbageCapacity) rows.push(['Garbage capacity', `${num(d.garbageCapacity)} t/month`]);
      if (d.coverage) rows.push([`${titleCase(d.coverage.kind)} coverage`, `radius ${d.coverage.radius}${d.coverage.capacity ? ` · ${num(d.coverage.capacity)} cap.` : ''}`]);
      if (d.landValue) rows.push(['Land value', `<span class="${d.landValue.amount >= 0 ? 'pos' : 'neg'}">${d.landValue.amount >= 0 ? '+' : ''}${Math.round(d.landValue.amount * 100)}</span> · r ${d.landValue.radius}`]);
      if (d.pollution) {
        const p = d.pollution;
        const parts = [p.air ? `air ${p.air}` : '', p.water ? `water ${p.water}` : '', p.noise ? `noise ${p.noise}` : '', p.garbage ? `garbage ${p.garbage}` : ''].filter(Boolean);
        if (parts.length) rows.push(['Pollution', `<span class="neg">${parts.join(', ')}</span>`]);
      }
      if (d.unique) rows.push(['Limit', 'One per city']);
      if (d.placement === 'shore') rows.push(['Placement', 'Shoreline']);
      if (d.placement === 'water') rows.push(['Placement', 'On water']);
    } else {
      cat = s.id.startsWith('zone:') ? 'Zone' : s.id.startsWith('net:') || s.id === 'subway' || s.id === 'power' ? 'Network' : s.id.startsWith('disaster:') ? 'Disaster' : 'Tool';
      const c = s.costUnit ? this.perTileCost(s) : null;
      if (c) rows.push(['Cost', `${money(c)} per tile`]);
    }
    const lock = s.locked ? `<div class="rt-lock">${icon('lock', 14)}<div><b>Locked</b><br>${escapeHtml(s.locked.hint)}${s.locked.progress !== undefined ? ` · ${Math.round(s.locked.progress * 100)}%` : ''}</div></div>` : '';
    const dis = s.disabled ? `<div class="rt-lock">${icon('alert', 14)}<div>${escapeHtml(s.disabled)}</div></div>` : '';
    const key = s.hotkey ? `<div class="rt-key">Hotkey <kbd>${s.hotkey}</kbd>${s.id.startsWith('plop:') ? '' : ' (press again to cycle)'}</div>` : s.def ? `<div class="rt-key">Click to select · <kbd>R</kbd> rotates while placing</div>` : '';
    this.tip.style.width = '270px';
    this.tip.innerHTML = `<div class="rt-cat" style="color:${catColor}">${escapeHtml(cat)}</div><h4>${escapeHtml(s.label)}</h4>${s.desc ? `<p>${escapeHtml(s.desc)}</p>` : '<div style="height:6px"></div>'}<div class="rt-rows">${rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('')}</div>${lock}${dis}${key}`;
    this.placeTip(anchor);
  }

  // ------------------------------------------------------------------------------------------------ active state + chip
  syncActive(): void {
    const id = this.ctx.tools.activeId;
    const cat = categoryOfTool(this.ctx, id);
    for (const [cid, b] of this.btns) {
      const c = CATEGORIES.find((x) => x.id === cid)!;
      const on = cid === cat || (c.panelId !== undefined && (this.ctx.panels.isOpen(c.panelId) || (cid === 'dataviews' && this.ctx.overlay !== 0)));
      toggleClass(b, 'active', on || (cid === 'query' && id === null));
    }
    // chip
    clear(this.chip);
    if (!id) {
      this.chip.classList.remove('show');
      return;
    }
    const spec = findToolSpec(this.ctx, id);
    const tool = this.ctx.tools.active;
    const color = spec?.color ?? '#3fa7ff';
    this.chip.style.setProperty('--c', color);
    const hints = h('div', { class: 'tc-hints' });
    for (const t of tool.hints()) {
      const span = h('span');
      span.innerHTML = escapeHtml(t).replace(/\b(Esc|Shift|R|\[ \])\b/g, (m) => `<kbd>${m === '[ ]' ? '[ ]' : m}</kbd>`);
      hints.appendChild(span);
    }
    const close = h('button', { class: 'icon-btn', title: 'Done (Esc)', html: icon('close', 15), style: 'width:28px;height:28px' });
    close.addEventListener('click', () => this.ctx.tools.select(null));
    const opts = tool.options();
    this.chip.append(h('div', { class: 'tc-ico', html: icon(tool.icon, 16) }), h('span', { class: 'tc-name' }, spec?.label ?? tool.label), hints);
    if (opts) this.chip.appendChild(opts);
    this.chip.appendChild(close);
    this.chip.classList.add('show');
    if (this.openCat) {
      const c = CATEGORIES.find((x) => x.id === this.openCat);
      if (c) this.renderFlyout(c);
    }
  }
}
