/**
 * Delegated UI sounds: generic audio feedback for every control in the app (game HUD, panels, menus, dialogs, region
 * screen), including controls added later, without wiring each one.
 *
 *   const off = installUiSounds(() => audio)   main.ts (+ CityScene with its lazily loaded engine, for the demo pages);
 *                                              listeners are attached once, sources are tried in order
 *
 * What plays (window capture listeners; the sound is decided after the event has been dispatched):
 *   click     buttons / [role=button] / .btn / clickable rows      'click' (secondary), 'press' (primary), 'tap' (icon),
 *             tabs + segmented controls + radios                     'tab', close buttons 'close',
 *             checkboxes / switches                                  'toggleOn' / 'toggleOff'
 *   input     range sliders: soft ticks while dragging / arrow keys (throttled, pitch follows the value),
 *             'sliderRelease' when the pointer lets go of a slider whose value moved while held
 *   change    <select>                                               'tab'
 *   hover     primary menus / toolbars only (HOVER selector)         audio.hover() (very soft, throttled)
 *
 * De-dup: if the element's own handler already requested a specific sound during the same event (audio.playCount
 * changed), the generic sound is skipped - so explicit sounds always win and nothing doubles up.
 * Opt-out: data-sfx="none" on the element or any ancestor. Override: data-sfx="<sound name>" (plays instead of the
 * generic sound, still de-duped). data-sfx-hover="1" opts an element into hover sounds, data-sfx-hover="none" out.
 */

export interface UiSoundAudio {
  play(name: string, opts?: { volume?: number; pitch?: number; pan?: number }): void;
  hover(): void;
  readonly playCount: number;
}

type AudioGetter = () => UiSoundAudio | null | undefined;

/** clickable controls that get generic click feedback */
const CONTROL =
  'button, [role=button], [role=tab], [role=switch], [role=menuitem], [role=option], .btn, a[href], summary, ' +
  'input[type=checkbox], input[type=radio], input[type=button], input[type=submit], ' +
  '.fly-item, .hud-seg.click, .ticker, .toast, .rc-item, .preset-card, .region-row, .news-row, [data-sfx]';

/** primary menus / toolbars that get hover blips (not every panel row) */
const HOVER =
  '.menu-item, .tb-btn, .fly-item, .fly-tabs button, .hud-top .icon-btn, .hud-top .speed button, .hud-top .hud-seg.click, ' +
  '.title-footer button, .rh-top-right button, .tile-card .btn, .preset-card, .mplayer-pill button, [data-sfx-hover]';

/** tab-like controls */
const TABS = '[role=tab], .tabs > button, .fly-tabs button, .ui-seg button, .seg-item, .chips .chip, .graph-list button, .mpl-tabs button, input[type=radio]';

let installed = false;
const sources: AudioGetter[] = [];
const getAudio = (): UiSoundAudio | null => {
  for (const g of sources) {
    try {
      const a = g();
      if (a) return a;
    } catch {
      /* ignore */
    }
  }
  return null;
};

/** add an audio source (first one that returns an engine wins) and wire the listeners once; returns a remover */
export function installUiSounds(get: AudioGetter): () => void {
  sources.push(get);
  const off = () => {
    const i = sources.indexOf(get);
    if (i >= 0) sources.splice(i, 1);
  };
  if (installed || typeof window === 'undefined') return off;
  installed = true;
  window.addEventListener('click', onClick, true);
  window.addEventListener('input', onInput, true);
  window.addEventListener('change', onChange, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);
  window.addEventListener('pointerover', onPointerOver, true);
  return off;
}

function optedOut(el: Element): boolean {
  return !!el.closest('[data-sfx="none"]');
}

function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');
}

/** gentle stereo placement from the pointer's screen x (UI sounds stay near the center) */
function panOf(e: MouseEvent): number {
  const w = window.innerWidth || 1;
  if (!(e.clientX >= 0)) return 0;
  return Math.max(-1, Math.min(1, (e.clientX / w) * 2 - 1)) * 0.22;
}

/** find the control for a click target (explicit controls first, then anything that looks clickable) */
function controlOf(target: EventTarget | null): Element | null {
  const t = target instanceof Element ? target : null;
  if (!t || t.closest('canvas')) return null;
  const c = t.closest(CONTROL);
  if (c) {
    // a <label> wrapping a checkbox re-dispatches the click to the input: let the input's click decide
    if (c instanceof HTMLLabelElement && c.querySelector('input')) return null;
    if (c instanceof HTMLInputElement && (c.type === 'range' || c.type === 'text' || c.type === 'number')) return null;
    return c;
  }
  if (t.closest('input, select, textarea, label')) return null;
  // catch-all: an element styled as clickable (cursor: pointer) within 3 ancestors
  let el: Element | null = t;
  for (let i = 0; el && i < 3; i++, el = el.parentElement) {
    if (el === document.body || el === document.documentElement) break;
    try {
      if (getComputedStyle(el).cursor === 'pointer') return el;
    } catch {
      return null;
    }
  }
  return null;
}

/** generic sound for a control (null = none) */
export function genericSound(el: Element): string | null {
  const o = el.getAttribute('data-sfx');
  if (o) return o === 'none' ? null : o;
  if (el instanceof HTMLInputElement && el.type === 'checkbox') return el.checked ? 'toggleOn' : 'toggleOff';
  if (el.getAttribute('role') === 'switch' || el.classList.contains('ui-switch'))
    return el.getAttribute('aria-checked') === 'true' || el.classList.contains('on') ? 'toggleOn' : 'toggleOff';
  if (el.matches(TABS)) return 'tab';
  if (el.matches('.modal-close, .t-x, [title^="Close"], [title^="Dismiss"], [title^="Done"]')) return 'close';
  if (el.matches('.btn.primary, .btn.warm, .menu-item.primary, input[type=submit]')) return 'press';
  if (el.matches('.icon-btn, .sq-btn, .mpl-btn')) return 'tap';
  return 'click';
}

function onClick(e: MouseEvent): void {
  const a = getAudio();
  if (!a) return;
  const el = controlOf(e.target);
  if (!el || optedOut(el) || isDisabled(el)) return;
  const before = a.playCount;
  const pan = panOf(e);
  // decide after every handler of this click ran (and after checkbox 'change'): explicit sounds win
  setTimeout(() => {
    const au = getAudio();
    if (!au || au.playCount !== before) return;
    const name = genericSound(el);
    if (name) au.play(name, { pan });
  }, 0);
}

// ------------------------------------------------------------------ sliders
const sliderState = new WeakMap<HTMLInputElement, { last: number; v: number; drag: boolean; down: number; moved: boolean }>();
/** the range input currently held with the pointer (released by the window pointerup, wherever it happens) */
let held: HTMLInputElement | null = null;

function rangeOf(t: EventTarget | null): HTMLInputElement | null {
  return t instanceof HTMLInputElement && t.type === 'range' && !optedOut(t) ? t : null;
}

function stateOf(el: HTMLInputElement) {
  let s = sliderState.get(el);
  if (!s) {
    s = { last: -1e9, v: Number(el.value), drag: false, down: Number(el.value), moved: false };
    sliderState.set(el, s);
  }
  return s;
}

function onPointerDown(e: PointerEvent): void {
  const el = rangeOf(e.target);
  if (!el) return;
  const s = stateOf(el);
  s.drag = true;
  s.down = Number(el.value);
  s.moved = false;
  held = el;
}

/**
 * Pointer released after holding a slider: settle sound when the value moved (drag or track click). Driven by
 * pointerup rather than 'change' - 'change' is skipped when a handler re-renders / blurs the input mid-drag.
 */
function onPointerUp(): void {
  const el = held;
  held = null;
  if (!el) return;
  const s = stateOf(el);
  if (!s.drag) return;
  s.drag = false;
  const v = Number(el.value);
  s.v = v;
  // moved: the value changed at some point while held (a drag can end where it started)
  if (s.moved || v !== s.down) getAudio()?.play('sliderRelease');
}

function onInput(e: Event): void {
  const el = rangeOf(e.target);
  if (!el) return;
  const a = getAudio();
  if (!a) return;
  const s = stateOf(el);
  const v = Number(el.value);
  if (v === s.v) return;
  s.v = v;
  if (s.drag) s.moved = true;
  const now = performance.now();
  if (now - s.last < 55) return;
  s.last = now;
  const min = Number(el.min || 0), max = Number(el.max || 100);
  const f = max > min ? (v - min) / (max - min) : 0.5;
  a.play('tick', { pitch: 0.84 + 0.42 * Math.max(0, Math.min(1, f)) });
}

function onChange(e: Event): void {
  const t = e.target;
  const a = getAudio();
  if (!a) return;
  if (t instanceof HTMLSelectElement) {
    if (!optedOut(t)) a.play('tab');
    return;
  }
  // range inputs: keyboard changes only tick (onInput); a released drag / track click settles (onPointerUp)
}

// ------------------------------------------------------------------ hover
let hovered: Element | null = null;

function onPointerOver(e: PointerEvent): void {
  if (e.pointerType === 'touch') return;
  const t = e.target instanceof Element ? e.target : null;
  const el = t?.closest(HOVER) ?? null;
  if (el === hovered) return;
  hovered = el;
  if (!el || el.getAttribute('data-sfx-hover') === 'none' || isDisabled(el) || optedOut(el)) return;
  getAudio()?.hover();
}
