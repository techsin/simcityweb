/** Pause menu (modal), help / shortcuts panel, error overlay, save indicator. */
import type { GameContext } from '../game/context';
import { Panel } from './Panel';
import { escapeHtml, h } from './dom';
import { icon } from './icons';
import { dayLabel, num } from './format';

export class PauseMenu {
  private back: HTMLDivElement | null = null;
  private prevSpeed = 1;
  constructor(private ctx: GameContext, private parent: HTMLElement, private hooks: { onSettings: () => void; onHelp: () => void }) {}

  get isOpen(): boolean {
    return !!this.back;
  }

  open(): void {
    if (this.back) return;
    const ctx = this.ctx;
    const st = ctx.state;
    this.prevSpeed = ctx.sim.speed;
    ctx.sim.speed = 0;
    const item = (ic: string, label: string, fn: () => void, key?: string, cls = '') => {
      const b = h('button', { class: `btn block ${cls}`, html: icon(ic, 17) + `<span>${label}</span>` + (key ? `<span class="kbd" style="margin-left:auto">${key}</span>` : '') });
      b.addEventListener('click', fn);
      return b;
    };
    const menu = h('div', { class: 'modal mp-glass pause-menu' },
      h('div', { class: 'pm-head' },
        h('div', { class: 'city-badge', html: icon('resHigh', 24) }),
        h('h2', null, st.config.name),
        h('div', { class: 'dim' }, `${dayLabel(st.day, st.config.startYear)} · Population ${num(st.stats.population)}`)),
      item('play', 'Resume', () => this.close(), 'Esc', 'primary'),
      item('save', 'Save city', async () => {
        await ctx.save();
      }, 'Ctrl S'),
      item('region', 'Save & exit to region', async () => {
        this.close(false);
        await ctx.exitToRegion();
      }),
      h('div', { class: 'pm-sep' }),
      item('settings', 'Settings', () => {
        this.close();
        this.hooks.onSettings();
      }),
      item('keyboard', 'Help & shortcuts', () => {
        this.close();
        this.hooks.onHelp();
      }, 'F1'),
    );
    this.back = h('div', { class: 'modal-back' }, menu);
    this.back.addEventListener('pointerdown', (e) => {
      if (e.target === this.back) this.close();
    });
    this.parent.appendChild(this.back);
    ctx.sound('dialogOpen');
    (menu.querySelector('.btn.primary') as HTMLElement | null)?.focus();
  }

  close(resume = true): void {
    const b = this.back;
    if (!b) return;
    this.back = null;
    b.classList.add('closing');
    setTimeout(() => b.remove(), 150);
    if (resume) this.ctx.sim.speed = this.prevSpeed;
    this.ctx.sound('dialogClose');
  }
}

export interface ConfirmOptions {
  title: string;
  /** intro line under the title */
  message?: string;
  /** consequence bullets ("Your only power plant — 4,002 residents will lose power") */
  items?: string[];
  confirm?: string;
  cancel?: string;
  /** red confirm button (destructive actions) */
  danger?: boolean;
  icon?: string;
}

let confirmDepth = 0;
/** a confirmation dialog is open (CityScene leaves Esc / hotkeys to it) */
export function confirmOpen(): boolean {
  return confirmDepth > 0;
}

/**
 * Modal yes / no dialog in the pause-menu style (.modal-back). Enter confirms (unless Cancel has focus); Esc, the
 * backdrop or Cancel dismiss.
 * Resolves true when confirmed.
 */
export function confirmDialog(ctx: GameContext, opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    confirmDepth++;
    const ok = h('button', { class: 'btn ' + (opts.danger ? 'danger' : 'primary'), html: (opts.danger ? icon('bulldoze', 15) : '') + `<span>${escapeHtml(opts.confirm ?? 'OK')}</span>` });
    const no = h('button', { class: 'btn' }, opts.cancel ?? 'Cancel');
    const list = opts.items?.length ? h('ul', { class: 'cf-list' }, ...opts.items.map((t) => h('li', { html: icon('alert', 14) + `<span>${escapeHtml(t)}</span>` }))) : null;
    const box = h('div', { class: 'modal mp-glass confirm-dialog', role: 'alertdialog', 'aria-modal': 'true' },
      h('div', { class: 'cf-head' }, h('span', { class: 'cf-ico' + (opts.danger ? ' danger' : ''), html: icon(opts.icon ?? (opts.danger ? 'alert' : 'help'), 20) }), h('h2', null, opts.title)),
      opts.message ? h('div', { class: 'cf-msg' }, opts.message) : null,
      list,
      h('div', { class: 'cf-actions' }, no, ok),
    );
    const back = h('div', { class: 'modal-back confirm' }, box);
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      confirmDepth = Math.max(0, confirmDepth - 1);
      window.removeEventListener('keydown', onKey, true);
      back.classList.add('closing');
      setTimeout(() => back.remove(), 150);
      ctx.sound(v ? 'confirm' : 'dialogClose');
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter') finish(document.activeElement !== no);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    ok.addEventListener('click', () => finish(true));
    no.addEventListener('click', () => finish(false));
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) finish(false);
    });
    ctx.signal.addEventListener('abort', () => finish(false), { once: true });
    ctx.root.appendChild(back);
    ctx.sound('dialogOpen');
    ok.focus();
  });
}

export const SHORTCUTS: { title: string; keys: [string, string[]][] }[] = [
  {
    title: 'Simulation',
    keys: [
      ['Pause / resume', ['Space']],
      ['Speed normal / fast / ultra', ['1', '2', '3']],
      ['Save city', ['Ctrl', 'S']],
      ['Menu', ['Esc']],
      ['Help', ['F1']],
    ],
  },
  {
    title: 'Tools',
    keys: [
      ['Residential zone (repeat: density)', ['R']],
      ['Commercial zone', ['C']],
      ['Industrial / farms', ['I']],
      ['De-zone', ['X']],
      ['Roads (repeat: type)', ['T']],
      ['Power line', ['L']],
      ['Subway', ['U']],
      ['Bulldoze', ['B']],
      ['Query / inspect', ['V']],
      ['Terraform (repeat: mode)', ['K']],
      ['Cancel / deselect tool', ['Esc']],
    ],
  },
  {
    title: 'While building',
    keys: [
      ['Rotate building', ['R']],
      ['Flip road corner', ['Shift']],
      ['Cancel drag', ['Right-click']],
      ['Brush size', ['[', ']']],
    ],
  },
  {
    title: 'Panels',
    keys: [
      ['Budget', ['M']],
      ['Graphs', ['G']],
      ['City statistics', ['J']],
      ['Advisors & news', ['N']],
      ['Data views', ['O']],
      ['Ordinances', ['Y']],
      ['Close top panel', ['Esc']],
    ],
  },
  {
    title: 'Camera',
    keys: [
      ['Pan', ['W', 'A', 'S', 'D']],
      ['Rotate 90°', ['Q', 'E']],
      ['Tilt', ['PgUp', 'PgDn']],
      ['Orbit', ['Right-drag']],
      ['Pan (mouse)', ['Middle-drag']],
      ['Zoom', ['Wheel']],
    ],
  },
];

export class HelpPanel extends Panel {
  readonly id = 'help';
  readonly title = 'Help & shortcuts';
  override icon = 'keyboard';
  override width = 900;
  override center = true;

  override defaultPos(w: number, hh: number): { x: number; y: number } {
    return { x: Math.max(14, (w - this.width) / 2), y: Math.max(72, (hh - 600) / 2) };
  }

  protected build(): void {
    const cols = h('div', { class: 'help-cols' });
    // three balanced columns: [Simulation + Panels] [Tools] [While building + Camera]
    const layout = [[0, 3], [1], [2, 4]];
    for (const idxs of layout) {
      const col = h('div');
      for (const gi of idxs) {
        const g = SHORTCUTS[gi];
        if (!g) continue;
        col.appendChild(h('div', { class: 'sec-title' }, g.title));
        for (const [label, keys] of g.keys) col.appendChild(h('div', { class: 'hk' }, h('span', null, label), h('span', { class: 'keys' }, ...keys.map((k) => h('kbd', null, k)))));
      }
      cols.appendChild(col);
    }
    const tips = h('div', { class: 'help-tips' },
      h('div', { html: '<b>Getting started</b>Zone residential, commercial and industrial land next to roads. Buildings grow where there is demand (watch the RCI meter).' }),
      h('div', { html: '<b>Utilities</b>Place a power plant and connect zones with power lines. Water towers and pumps keep buildings supplied.' }),
      h('div', { html: '<b>Services & money</b>Police, fire, health and schools raise land value. Balance taxes in the Budget panel — high taxes slow growth.' }),
    );
    const guide = h('button', { class: 'btn sm', html: icon('star', 13) + '<span>Show getting-started guide</span>' });
    guide.addEventListener('click', () => {
      this.ctx.showOnboarding?.();
      this.ctx.panels.close(this.id);
    });
    this.body.append(h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:12px' }, h('div', { class: 'dim', style: 'font-size:12.5px' }, 'Build the city of your dreams. Keyboard shortcuts and camera keys work at all times — clicking buttons or panels never takes them away; only text boxes capture keys while you type.'), guide), cols, tips);
  }
}

export class ErrorOverlay {
  readonly el: HTMLDivElement;
  private seen = new Map<string, HTMLElement>();
  constructor(parent: HTMLElement, private hooks: { pause: () => void }) {
    this.el = h('div', { class: 'err-stack' });
    parent.appendChild(this.el);
  }

  report(title: string, err: unknown, opts: { fatal?: boolean; key?: string; sim?: boolean } = {}): void {
    const key = opts.key ?? title;
    const msg = err instanceof Error ? err.message : String(err ?? '');
    const stack = err instanceof Error ? err.stack ?? '' : '';
    console.error('[game]', title, err);
    const existing = this.seen.get(key);
    if (existing) {
      const cnt = existing.querySelector('.cnt') as HTMLElement | null;
      if (cnt) cnt.textContent = String(Number(cnt.textContent || '1') + 1) + '×';
      return;
    }
    const pre = h('pre', { style: 'display:none' }, `${msg}\n\n${stack}`);
    const details = h('button', { class: 'btn sm ghost' }, 'Details');
    details.addEventListener('click', () => (pre.style.display = pre.style.display === 'none' ? 'block' : 'none'));
    const dismiss = h('button', { class: 'btn sm' }, 'Dismiss');
    const card = h('div', { class: 'err-card mp-glass' },
      h('div', { class: 'ec-h', html: icon('alert', 16) + `<span>${escapeHtml(title)}</span><span class="spacer"></span><span class="chip bad cnt">1×</span>` }),
      h('div', { class: 'ec-m' }, msg || 'Unknown error'),
      pre,
      h('div', { class: 'ec-a' }, details, opts.sim ? h('button', { class: 'btn sm', onclick: () => this.hooks.pause() }, 'Pause simulation') : null, opts.fatal ? h('button', { class: 'btn sm primary', onclick: () => location.reload() }, 'Reload') : null, dismiss),
    );
    dismiss.addEventListener('click', () => {
      card.remove();
    });
    this.seen.set(key, card);
    this.el.appendChild(card);
    while (this.el.children.length > 3) this.el.firstElementChild!.remove();
  }
}

export class SavePill {
  readonly el: HTMLDivElement;
  private label: HTMLSpanElement;
  private t = 0;
  constructor(parent: HTMLElement) {
    this.label = h('span', null, 'Saving…');
    this.el = h('div', { class: 'save-pill mp-glass' }, h('span', { class: 'spin' }), h('span', { class: 'ok ico-wrap', html: icon('check', 14) }), this.label);
    parent.appendChild(this.el);
  }
  saving(auto: boolean): void {
    clearTimeout(this.t);
    this.label.textContent = auto ? 'Autosaving…' : 'Saving…';
    this.el.className = 'save-pill mp-glass show';
  }
  done(ok: boolean, msg?: string): void {
    this.label.textContent = ok ? msg ?? 'City saved' : msg ?? 'Save failed';
    this.el.className = 'save-pill mp-glass show done';
    if (!ok) (this.el.querySelector('.ok') as HTMLElement).innerHTML = icon('alert', 14);
    this.t = window.setTimeout(() => (this.el.className = 'save-pill mp-glass'), 1800);
  }
}
