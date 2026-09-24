/** Modal dialogs, confirm / prompt helpers and toasts for the meta UI. */
import { audio } from '../../audio';
import { button, h, icon } from './dom';

let root: HTMLElement | null = null;
export function setUiRoot(el: HTMLElement): void {
  root = el;
}
export function uiRoot(): HTMLElement {
  return root ?? document.body;
}

export interface ModalOptions {
  title: string;
  subtitle?: string | Node;
  icon?: string;
  size?: 'narrow' | 'mid' | 'wide';
  body: Node;
  footer?: Node[];
  closable?: boolean;
  onClose?: () => void;
  /** called on Enter (unless focus is in a textarea) */
  onEnter?: () => void;
}

/**
 * open modals, bottom to top. Every modal listens on window, so only the top-most one may handle Esc / Enter: one Esc
 * on a confirm stacked over Load Region closed both (stopPropagation doesn't stop other listeners on window).
 */
const openModals: Modal[] = [];

export class Modal {
  readonly back: HTMLElement;
  readonly card: HTMLElement;
  private closed = false;
  private keyHandler = (e: KeyboardEvent) => {
    if (openModals[openModals.length - 1] !== this) return;
    if (e.key === 'Escape' && this.opts.closable !== false) {
      e.stopPropagation();
      this.close();
    } else if (e.key === 'Enter' && this.opts.onEnter && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      this.opts.onEnter();
    }
  };

  constructor(private opts: ModalOptions) {
    const head = h(
      'div',
      { class: 'modal-head' },
      opts.icon ? h('div', { class: 'mh-icon' }, icon(opts.icon, 20)) : null,
      h('div', { class: 'mh-grow' }, h('h2', {}, opts.title), opts.subtitle ? h('div', { class: 'mh-sub' }, opts.subtitle) : null),
      opts.closable !== false ? h('button', { class: 'modal-close', title: 'Close (Esc)', onclick: () => this.close() }, icon('x', 18)) : null,
    );
    this.card = h(
      'div',
      { class: `modal ${opts.size === 'wide' ? 'wide' : opts.size === 'mid' ? 'mid' : ''}`, role: 'dialog' },
      head,
      h('div', { class: 'modal-body scroll' }, opts.body),
      opts.footer?.length ? h('div', { class: 'modal-foot' }, ...opts.footer) : null,
    );
    this.back = h('div', { class: 'modal-back' }, this.card);
    this.back.addEventListener('pointerdown', (e) => {
      if (e.target === this.back && opts.closable !== false) this.close();
    });
    uiRoot().appendChild(this.back);
    openModals.push(this);
    window.addEventListener('keydown', this.keyHandler, true);
    audio.play('dialogOpen');
    const first = this.card.querySelector<HTMLElement>('input[type=text], .autofocus');
    // preventScroll: focusing a field low in a tall body must not scroll the top of the dialog out of view
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 60);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  close(silent = false): void {
    if (this.closed) return;
    this.closed = true;
    const i = openModals.indexOf(this);
    if (i >= 0) openModals.splice(i, 1);
    window.removeEventListener('keydown', this.keyHandler, true);
    if (!silent) audio.play('dialogClose');
    this.back.style.transition = 'opacity 0.18s';
    this.back.style.opacity = '0';
    setTimeout(() => this.back.remove(), 180);
    this.opts.onClose?.();
  }
}

export function confirmDialog(o: { title: string; message: string | Node; confirm?: string; cancel?: string; danger?: boolean; icon?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const ok = button(o.confirm ?? 'OK', { cls: `lg ${o.danger ? 'danger' : 'primary'}`, sound: 'confirm', onClick: () => { result = true; m.close(true); } });
    const m = new Modal({
      title: o.title,
      icon: o.icon ?? (o.danger ? 'trash' : 'info'),
      body: h('div', { style: 'color: var(--text-dim); line-height: 1.55; font-size: 14px' }, o.message),
      footer: [h('div', { class: 'grow' }), button(o.cancel ?? 'Cancel', { cls: 'lg ghost', onClick: () => m.close() }), ok],
      onEnter: () => ok.click(),
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog(o: { title: string; label: string; value?: string; confirm?: string; icon?: string; maxLength?: number }): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const input = h('input', { type: 'text', value: o.value ?? '', maxlength: String(o.maxLength ?? 40), spellcheck: 'false' }) as HTMLInputElement;
    const ok = button(o.confirm ?? 'Save', {
      cls: 'lg primary',
      sound: 'confirm',
      onClick: () => {
        const v = input.value.trim();
        if (!v) return;
        result = v;
        m.close(true);
      },
    });
    const m = new Modal({
      title: o.title,
      icon: o.icon ?? 'edit',
      body: h('div', { class: 'field' }, h('label', {}, o.label), input),
      footer: [h('div', { class: 'grow' }), button('Cancel', { cls: 'lg ghost', onClick: () => m.close() }), ok],
      onEnter: () => ok.click(),
      onClose: () => resolve(result),
    });
    setTimeout(() => input.select(), 80);
  });
}

let toastWrap: HTMLElement | null = null;
export function toast(text: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 2800): void {
  if (!toastWrap || !toastWrap.isConnected) {
    toastWrap = h('div', { class: 'toast-wrap' });
    uiRoot().appendChild(toastWrap);
  }
  const t = h('div', { class: `toast ${kind}` }, icon(kind === 'bad' ? 'x' : kind === 'good' ? 'check' : 'info', 16), text);
  toastWrap.appendChild(t);
  if (kind === 'bad') audio.play('error');
  else if (kind === 'good') audio.play('good', { volume: 0.75 });
  setTimeout(() => {
    t.style.transition = 'opacity 0.3s, transform 0.3s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(-6px)';
    setTimeout(() => t.remove(), 320);
  }, ms);
}

/** labelled range slider bound to a value 0..1 (or custom range) */
export function slider(o: { label: string; value: number; min?: number; max?: number; step?: number; format?: (v: number) => string; onInput: (v: number) => void; icon?: string }): { el: HTMLElement; input: HTMLInputElement; set(v: number): void; setDisabled(d: boolean): void } {
  const min = o.min ?? 0, max = o.max ?? 1, step = o.step ?? 0.01;
  const fmt = o.format ?? ((v: number) => `${Math.round(((v - min) / (max - min)) * 100)}%`);
  const val = h('span', { class: 'fl-val' }, fmt(o.value));
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  input.value = String(o.value);
  const paintFill = () => input.style.setProperty('--p', `${((+input.value - min) / (max - min)) * 100}%`);
  paintFill();
  input.addEventListener('input', () => {
    const v = +input.value;
    val.textContent = fmt(v);
    paintFill();
    o.onInput(v);
  });
  const el = h('div', { class: 'slider' }, h('div', { class: 'field-label' }, o.icon ? icon(o.icon, 14) : null, o.label, val), input);
  return {
    el,
    input,
    set(v: number) {
      input.value = String(v);
      val.textContent = fmt(v);
      paintFill();
    },
    setDisabled(d: boolean) {
      el.classList.toggle('disabled', d);
      input.disabled = d;
    },
  };
}

export function toggle(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => {
    audio.play(input.checked ? 'toggleOn' : 'toggleOff');
    onChange(input.checked);
  });
  return h('label', { class: 'toggle' }, input, h('span', { class: 'tg' }), label);
}

/** single-choice segmented control */
export function segmented<T extends string | number>(o: {
  items: { value: T; title: string; sub?: string; icon?: string; disabled?: boolean }[];
  value: T;
  cols?: 2 | 3 | 4;
  onChange: (v: T) => void;
  chips?: boolean;
}): { el: HTMLElement; set(v: T): void } {
  const btns = new Map<T, HTMLButtonElement>();
  const el = h('div', { class: o.chips ? 'chips' : `seg c${o.cols ?? o.items.length}` });
  const set = (v: T) => {
    for (const [k, b] of btns) b.classList.toggle('on', k === v);
  };
  for (const it of o.items) {
    const b = o.chips
      ? h('button', { class: 'chip', type: 'button', disabled: it.disabled }, it.icon ? icon(it.icon, 14) : null, it.title)
      : h('button', { class: 'seg-item', type: 'button', disabled: it.disabled }, h('span', { class: 'si-t' }, it.icon ? icon(it.icon, 15) : null, it.title), it.sub ? h('span', { class: 'si-s' }, it.sub) : null);
    b.addEventListener('click', () => {
      audio.play('tab');
      set(it.value);
      o.onChange(it.value);
    });
    btns.set(it.value, b as HTMLButtonElement);
    el.appendChild(b);
  }
  set(o.value);
  return { el, set };
}
