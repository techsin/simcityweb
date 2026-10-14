/** Tiny DOM helpers for the game UI (no framework). */

export type Child = Node | string | number | null | undefined | false;
export type Attrs = Record<string, unknown> & {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration> | Record<string, string>;
  html?: string;
  dataset?: Record<string, string>;
};

/** Create an element: h('div', { class: 'x', onclick: fn }, 'text', child) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else
          for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
            if (sv === undefined || sv === null) continue;
            if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
            else (el.style as unknown as Record<string, string>)[sk] = String(sv);
          }
      } else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'dataset') Object.assign(el.dataset, v as Record<string, string>);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Set text only when changed (avoids layout churn in per-frame updates). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export function setHTML(el: Element, html: string): void {
  if ((el as HTMLElement).dataset.html !== html) {
    (el as HTMLElement).dataset.html = html;
    el.innerHTML = html;
  }
}

export function toggleClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** True when keyboard focus is in a text-entry element (UI must not steal those keys). */
export function isTyping(e?: Event): boolean {
  const t = (e?.target as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'button';
  }
  return false;
}

/** keys a focused range slider keeps for itself (stepping it; Tab and lone modifiers do nothing to the map) */
export const SLIDER_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Tab', 'Shift', 'Control', 'Alt', 'Meta']);

/**
 * A range slider. It keeps the keyboard focus after a click or a drag, so the arrow keys (Home / End, Page Up / Down)
 * step it — final fixes P10: it blurred itself on pointerup, the arrows then panned the map and one 0.5 % tax step was
 * ~1.8 px of track. The camera ignores keys while an input has focus (CameraController.isTypingTarget) and the scene's
 * hotkeys treat range inputs as non-typing (isTyping); any other key (Esc, W A S D, a hotkey) or a pointer press
 * anywhere else (the map, another control) releases the focus, and the camera keys work again.
 */
export function slider(opts: { min: number; max: number; step?: number; value: number; oninput: (v: number) => void; onchange?: (v: number) => void; class?: string }): HTMLInputElement {
  const el = h('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step ?? 1, class: opts.class ?? 'ui-range' }) as HTMLInputElement;
  el.value = String(opts.value);
  const paint = () => {
    const t = (Number(el.value) - opts.min) / (opts.max - opts.min || 1);
    el.style.setProperty('--fill', `${(t * 100).toFixed(1)}%`);
  };
  paint();
  el.addEventListener('input', () => {
    paint();
    opts.oninput(Number(el.value));
  });
  el.addEventListener('change', () => opts.onchange?.(Number(el.value)));
  // the keys a range input acts on keep the focus; any other key (Esc, a camera key, a hotkey) releases it first, so the
  // camera sees that key — also the release of a key held from before the click (a W held while the slider had the
  // focus would otherwise keep the camera moving: the camera ignores key-ups while an input has focus)
  const onKey = (e: KeyboardEvent) => {
    if (!SLIDER_KEYS.has(e.key)) el.blur();
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('keyup', onKey);
  const outside = (e: Event) => {
    // (a slider removed while focused — its panel closed — may never get its blur: drop the listener then)
    if (!el.isConnected) {
      document.removeEventListener('pointerdown', outside, true);
      return;
    }
    const t = e.target as (Element & { closest?: (s: string) => Element | null }) | null;
    if (t === el) return;
    // (this slider's own −/+ buttons keep it focused: stepButtons)
    const step = t?.closest?.('.ui-stepbtn') as (Element & { __for?: HTMLInputElement }) | null | undefined;
    if (step && step.__for === el) return;
    el.blur();
  };
  el.addEventListener('focus', () => document.addEventListener('pointerdown', outside, true));
  el.addEventListener('blur', () => document.removeEventListener('pointerdown', outside, true));
  (el as any).__paint = paint;
  return el;
}

/** move a slider made by slider() by `dir` steps, as the player would (fires its input handler); false at its end */
export function stepSlider(el: HTMLInputElement, dir: number): boolean {
  const step = Number(el.step) || 1, min = Number(el.min), max = Number(el.max);
  const cur = Number(el.value);
  // the next value on the step grid in that direction (11.25 + 0.5 → 11.5, − → 11.0; not 11.75 / 10.75)
  const g = (cur - min) / step;
  const k = dir > 0 ? Math.floor(g + 1e-9) + 1 : Math.ceil(g - 1e-9) - 1;
  const next = clamp(Math.round(k * step * 1e6) / 1e6 + min, min, max);
  if (Math.abs(next - cur) < 1e-9) return false;
  el.value = String(next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * − / + buttons beside a slider (one step each, the slider keeps the keyboard focus for the arrow keys): exact steps
 * where the track is short (final fixes P10: the Budget panel's 72 px tax tracks). `label` names the setting for the
 * buttons' tooltips ("R$ tax").
 */
export function stepButtons(el: HTMLInputElement, label: string, fmt: (step: number) => string = (s) => String(s)): [HTMLButtonElement, HTMLButtonElement] {
  const mk = (dir: number) => {
    const b = h('button', { type: 'button', class: 'ui-stepbtn', title: `${dir < 0 ? 'Lower' : 'Raise'} ${label} by ${fmt(Number(el.step) || 1)}`, 'aria-label': `${dir < 0 ? 'Lower' : 'Raise'} ${label}` }, dir < 0 ? '−' : '+') as HTMLButtonElement & { __for?: HTMLInputElement };
    b.__for = el;
    // (no focus change on press: the slider keeps it)
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      stepSlider(el, dir);
      el.focus({ preventScroll: true });
    });
    return b;
  };
  return [mk(-1), mk(1)];
}

/** update a slider made by slider() without firing input */
export function setSlider(el: HTMLInputElement, v: number): void {
  if (document.activeElement === el) return;
  if (Number(el.value) !== v) {
    el.value = String(v);
    (el as any).__paint?.();
  }
}

/** Toggle switch */
export function toggle(on: boolean, onchange: (v: boolean) => void, disabled = false): HTMLButtonElement {
  const el = h('button', { class: 'ui-switch' + (on ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(on), disabled }) as HTMLButtonElement;
  el.appendChild(h('span', { class: 'knob' }));
  el.addEventListener('click', () => {
    const v = !el.classList.contains('on');
    el.classList.toggle('on', v);
    el.setAttribute('aria-checked', String(v));
    onchange(v);
    el.blur();
  });
  return el;
}

export function setToggle(el: HTMLElement, on: boolean): void {
  toggleClass(el, 'on', on);
}

/** Segmented control */
export function segmented<T extends string | number>(options: { value: T; label: string; title?: string }[], value: T, onchange: (v: T) => void): HTMLDivElement {
  const el = h('div', { class: 'ui-seg' });
  for (const o of options) {
    const b = h('button', { type: 'button', class: o.value === value ? 'on' : '', title: o.title }, o.label);
    b.addEventListener('click', () => {
      for (const c of el.children) c.classList.remove('on');
      b.classList.add('on');
      onchange(o.value);
      b.blur();
    });
    el.appendChild(b);
  }
  return el;
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
