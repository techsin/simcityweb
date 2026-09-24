/** Bottom-center toolbar: categories → flyout menus of tools (data-driven from the catalog), rich tooltips, tool chip. */
import { Network, Zone } from '../core/types';
import type { GameContext } from '../game/context';
import { CATEGORIES, CATEGORY_COLORS, categoryOfTool, findToolSpec, type ToolCategory, type ToolSpec } from '../game/toolCatalog';
import type { BuildingDef } from '../sim/catalogTypes';
import { BRIDGE_COST_MUL, NETWORK_INFO, POWERLINE_COST, SUBWAY_COST, networkCellCost, zoneCellCost } from '../sim/economy/tuning';
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
      // hover blip: delegated (src/ui/uiSounds.ts, .tb-btn)
      b.addEventListener('pointerenter', () => this.showCatTip(c, b));
      b.addEventListener('pointerleave', () => this.hideTip());
      this.btns.set(c.id, b);
      this.bar.appendChild(b);
      void i;
    });
    this.el.append(this.chip, this.bar);
    parent.appendChild(this.el);
    parent.appendChild(this.tip);
    document.addEventListener('pointerdown', (e) => {
      if (this.openCat && !(e.target as HTMLElement).closest('.toolbar')) {
        this.ctx.sound('flyoutClose');
        this.closeFlyout();
      }
    }, { signal: ctx.signal });
    ctx.ui.on('tool', () => this.syncActive());
    ctx.ui.on('panel', ({ id }) => {
      if (id === 'dataviews') this.syncActive();
    });
    ctx.ui.on('overlay', () => this.syncActive());
    this.syncActive();
  }

  /** onboarding coach marks: pulse these category buttons */
  setCoach(catIds: string[]): void {
    for (const [id, b] of this.btns) toggleClass(b, 'coach', catIds.includes(id));
  }

  get flyoutOpen(): boolean {
    return this.openCat !== null;
  }

  private onCategory(c: ToolCategory): void {
    this.hideTip();
    if (c.toolId) {
      this.closeFlyout();
      const cur = this.ctx.tools.activeId;
      // ToolController.select plays the tool sound
      this.ctx.tools.select(cur === c.toolId ? null : c.toolId);
      return;
    }
    if (c.panelId) {
      this.closeFlyout();
      this.ctx.panels.toggle(c.panelId);
      return;
    }
    if (this.openCat === c.id) {
      this.ctx.sound('flyoutClose');
      this.closeFlyout();
    } else this.openFlyout(c.id);
  }

  openFlyout(catId: string, tab?: string): void {
    const c = CATEGORIES.find((x) => x.id === catId);
    if (!c?.groups) return;
    if (tab) {
      try {
        const gi = c.groups(this.ctx).findIndex((g) => g.label.toLowerCase().startsWith(tab.toLowerCase()));
        if (gi >= 0) this.lastTab.set(catId, gi);
      } catch {
        /* ignore */
      }
    }
    this.openCat = catId;
    for (const [id, b] of this.btns) toggleClass(b, 'open', id === catId);
    try {
      this.renderFlyout(c);
    } catch (e) {
      // keep button + flyout consistent (open) even if one item fails to render
      console.error('[toolbar] flyout render failed', catId, e);
    }
    this.flyout.style.maxWidth = Math.min(1180, (this.el.parentElement?.clientWidth ?? 1600) - 32) + 'px';
    // reveal right away (positionFlyout's offsetWidth read lays the new items out first; the CSS transition still
    // plays from the closed style). No "next frame" step: nothing can race it (QA #8: a close landing before a
    // deferred reveal left it stuck open) and a slow first thumbnail render can't hold the flyout back.
    this.positionFlyout();
    this.flyout.classList.add('open');
    this.ctx.sound('flyout');
  }

  /** center over the category button (wide menus: over the toolbar), clamped to the screen */
  private positionFlyout(): void {
    if (!this.openCat) return;
    const b = this.btns.get(this.openCat);
    if (!b) return;
    const center = b.offsetLeft + b.offsetWidth / 2;
    const barW = this.bar.offsetWidth;
    const fw = this.flyout.offsetWidth;
    const vw = this.el.parentElement?.clientWidth ?? window.innerWidth;
    const barLeft = this.bar.getBoundingClientRect().left / uiZoom();
    let left = fw > barW * 0.9 ? barW / 2 : center;
    const minC = fw / 2 - barLeft + 8, maxC = vw - barLeft - fw / 2 - 8;
    left = Math.max(minC, Math.min(maxC, left));
    this.flyout.style.left = left + 'px';
  }

  closeFlyout(): void {
    if (!this.openCat) {
      this.flyout.classList.remove('open');
      return;
    }
    this.openCat = null;
    this.flyout.classList.remove('open');
    for (const b of this.btns.values()) b.classList.remove('open');
    this.hideTip();
  }

  // ------------------------------------------------------------------------------------------------ per-tile costs
  /** § per tile on land, from sim-core's tuning (economy/tuning.ts) */
  private perTileCost(spec: ToolSpec): number | null {
    let c = 0;
    if (spec.id.startsWith('zone:')) c = zoneCellCost(Number(spec.id.slice(5)) as Zone);
    else if (spec.id.startsWith('net:')) c = networkCellCost(Number(spec.id.slice(4)) as Network);
    else if (spec.id === 'power') c = POWERLINE_COST;
    else if (spec.id === 'subway') c = SUBWAY_COST;
    return c > 0 ? c : null;
  }

  /** extra cost note for networks (bridges) */
  private bridgeNote(spec: ToolSpec): string | null {
    if (spec.id.startsWith('net:')) {
      const t = Number(spec.id.slice(4)) as Network;
      const info = NETWORK_INFO[t];
      if (!info) return null;
      return info.bridge ? `Bridges ${money(info.cost * BRIDGE_COST_MUL)} per tile` : "Can't bridge water";
    }
    return null;
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
    const total = groups.reduce((s, g) => s + g.items.length, 0);
    const tabbed = groups.length > 1 && total > 12;
    if (tabbed) {
      // large categories: one group at a time, chosen with tabs (remembers the last tab / the active tool's group)
      let sel = groups.findIndex((g) => g.items.some((s) => s.id === active));
      if (sel < 0) sel = Math.min(this.lastTab.get(c.id) ?? 0, groups.length - 1);
      const tabs = h('div', { class: 'fly-tabs' });
      groups.forEach((g, gi) => {
        const b = h('button', { class: gi === sel ? 'on' : '', html: (g.icon ? icon(g.icon, 14) : '') + `<span>${escapeHtml(g.label)}</span><span class="n">${g.items.length}</span>` });
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.lastTab.set(c.id, gi);
          this.renderFlyout(c);
          this.positionFlyout();
          this.ctx.sound('tab');
        });
        tabs.appendChild(b);
      });
      head.appendChild(tabs);
      const g = groups[sel];
      const items = h('div', { class: 'fly-items wide' });
      if (!g.items.length) items.appendChild(h('div', { class: 'fly-empty' }, 'Nothing available yet'));
      for (const s of g.items) items.appendChild(this.item(s, s.id === active));
      wrap.appendChild(h('div', { class: 'fly-group' }, items));
    } else {
      for (const g of groups) {
        const items = h('div', { class: 'fly-items' + (groups.length === 1 ? ' wide' : '') });
        if (!g.items.length) items.appendChild(h('div', { class: 'fly-empty' }, 'Nothing available yet'));
        for (const s of g.items) items.appendChild(this.item(s, s.id === active));
        wrap.appendChild(h('div', { class: 'fly-group' }, h('div', { class: 'sec-title', html: (g.icon ? icon(g.icon, 13) : '') + `<span>${escapeHtml(g.label)}</span>` }), items));
      }
    }
    this.flyout.append(head, wrap);
  }
  private lastTab = new Map<string, number>();

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
      // ToolController.select plays the (category-pitched) tool sound
      if (this.ctx.tools.select(s.id)) this.closeFlyout();
    });
    el.addEventListener('pointerenter', () => this.showSpecTip(s, el));
    el.addEventListener('pointerleave', () => this.hideTip());
    return el;
  }

  // ------------------------------------------------------------------------------------------------ rich tooltip
  private placeTip(anchor: HTMLElement): void {
    const z = uiZoom();
    const r = anchor.getBoundingClientRect();
    const pr = this.tip.parentElement!.getBoundingClientRect();
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    const maxX = pr.width / z - tw - 8;
    let x = (r.left + r.width / 2 - pr.left) / z - tw / 2;
    x = Math.max(8, Math.min(maxX, x));
    // flyout items: never cover the flyout's own header / tabs — above the whole flyout; else beside the flyout;
    // else (wide + tall flyout) beside the hovered item, kept below the header
    const fly = anchor.closest('.flyout');
    if (fly) {
      const TOP = 64; // below the top bar
      const fr = fly.getBoundingClientRect();
      const W = pr.width / z, H = pr.height / z;
      let y = (fr.top - pr.top) / z - th - 8;
      if (y < TOP) {
        const right = (fr.right - pr.left) / z + 10;
        const left = (fr.left - pr.left) / z - tw - 10;
        const itemMid = (r.top - pr.top) / z + r.height / z / 2;
        if (right + tw <= W - 8 || left >= 8) {
          x = right + tw <= W - 8 ? right : left;
          y = Math.max(TOP, Math.min(H - th - 8, itemMid - th / 2));
        } else {
          const head = fly.querySelector('.fly-head') as HTMLElement | null;
          const headBottom = head ? (head.getBoundingClientRect().bottom - pr.top) / z + 6 : (fr.top - pr.top) / z;
          const iR = (r.right - pr.left) / z + 8, iL = (r.left - pr.left) / z - tw - 8;
          x = iR + tw <= W - 8 ? iR : iL >= 8 ? iL : x;
          y = Math.max(headBottom, TOP, Math.min(H - th - 8, itemMid - th / 2));
        }
      }
      this.tip.style.left = x + 'px';
      this.tip.style.top = y + 'px';
      this.tip.classList.add('show');
      return;
    }
    let y = (r.top - pr.top) / z - th - 10;
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
      const bn = this.bridgeNote(s);
      if (bn) rows.push(['Over water', bn]);
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
      span.innerHTML = escapeHtml(t)
        .replace(/\b(Esc|Shift|R|Alt)\b/g, (m) => `<kbd>${m}</kbd>`)
        .replace('[ ]', '<kbd>[</kbd> <kbd>]</kbd>');
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
