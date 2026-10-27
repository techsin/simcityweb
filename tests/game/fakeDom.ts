/**
 * A minimal DOM stand-in for panel tests (the project has no DOM library): elements with classes, inline styles,
 * attributes, children, innerHTML (kept as markup; textContent strips its tags), listeners and click(), plus a
 * `document` with createElement / createTextNode. installFakeDom() swaps it in for a test file (and back).
 */
import { afterAll, beforeAll } from 'vitest';

export class FNode {
  parentNode: FEl | null = null;
  childNodes: FNode[] = [];
  protected own = '';
  get parentElement(): FEl | null {
    return this.parentNode;
  }
  get firstChild(): FNode | null {
    return this.childNodes[0] ?? null;
  }
  get textContent(): string {
    return this.own + this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.own = v;
  }
  remove(): void {
    const p = this.parentNode;
    if (!p) return;
    const i = p.childNodes.indexOf(this);
    if (i >= 0) p.childNodes.splice(i, 1);
    this.parentNode = null;
  }
}

type Listener = (e: unknown) => void;

export class FEl extends FNode {
  className = '';
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  disabled = false;
  title = '';
  scrollTop = 0;
  offsetLeft = 0;
  offsetTop = 0;
  offsetWidth = 0;
  offsetHeight = 0;
  clientWidth = 0;
  clientHeight = 0;
  style: Record<string, unknown> & { cssText: string; setProperty(k: string, v: string): void };
  private html = '';
  private listeners = new Map<string, Listener[]>();
  constructor(readonly tagName: string) {
    super();
    const st: Record<string, unknown> = { cssText: '' };
    st.setProperty = (k: string, v: string) => { st[k] = v; };
    this.style = st as FEl['style'];
  }
  get children(): FEl[] {
    return this.childNodes.filter((c): c is FEl => c instanceof FEl);
  }
  get classList() {
    const get = () => new Set(this.className.split(/\s+/).filter(Boolean));
    const put = (s: Set<string>) => { this.className = [...s].join(' '); };
    return {
      contains: (c: string) => get().has(c),
      add: (...cs: string[]) => { const s = get(); for (const c of cs) s.add(c); put(s); },
      remove: (...cs: string[]) => { const s = get(); for (const c of cs) s.delete(c); put(s); },
      toggle: (c: string, on?: boolean) => { const s = get(); const v = on ?? !s.has(c); if (v) s.add(c); else s.delete(c); put(s); return v; },
    };
  }
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.own = '';
    this.html = v;
  }
  override get textContent(): string {
    return super.textContent + this.html.replace(/<[^>]*>/g, '');
  }
  override set textContent(v: string) {
    this.html = '';
    super.textContent = v;
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
    if (k === 'title') this.title = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  /** options: `signal` removes the listener when it aborts (an aborted one adds nothing), as the DOM does */
  addEventListener(t: string, f: Listener, opts?: boolean | { signal?: AbortSignal }): void {
    const signal = typeof opts === 'object' ? opts.signal : undefined;
    if (signal?.aborted) return;
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), f]);
    signal?.addEventListener('abort', () => this.removeEventListener(t, f), { once: true });
  }
  removeEventListener(t: string, f: Listener): void {
    this.listeners.set(t, (this.listeners.get(t) ?? []).filter((g) => g !== f));
  }
  click(): void {
    this.fire('click');
  }
  focus(): void {}
  blur(): void {}
  /** run the listeners of event type `t` (a minimal event: stopPropagation / preventDefault, target = this) */
  fire(t: string, e: Record<string, unknown> = {}): void {
    for (const f of this.listeners.get(t) ?? []) f({ stopPropagation() {}, preventDefault() {}, target: this, ...e });
  }
  /** listeners registered for type `t` (tests: what a detached element still holds) */
  listenerCount(t?: string): number {
    if (t) return this.listeners.get(t)?.length ?? 0;
    let n = 0;
    for (const l of this.listeners.values()) n += l.length;
    return n;
  }
  appendChild<T extends FNode>(c: T): T {
    c.remove();
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  append(...cs: (FNode | string)[]): void {
    for (const c of cs) this.appendChild(typeof c === 'string' ? textNode(c) : c);
  }
  insertBefore<T extends FNode>(c: T, ref: FNode | null): T {
    c.remove();
    c.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    return c;
  }
  removeChild<T extends FNode>(c: T): T {
    c.remove();
    return c;
  }
  /** all descendant elements, depth first */
  all(): FEl[] {
    const out: FEl[] = [];
    for (const c of this.children) out.push(c, ...c.all());
    return out;
  }
  /** ".a.b" / "tag" / "tag.a" selectors only (tests) */
  querySelectorAll(sel: string): FEl[] {
    const m = /^([a-z0-9-]*)((?:\.[\w-]+)*)$/i.exec(sel.trim());
    if (!m) return [];
    const tag = m[1].toUpperCase(), cls = m[2].split('.').filter(Boolean);
    return this.all().filter((e) => (!tag || e.tagName.toUpperCase() === tag) && cls.every((c) => e.classList.contains(c)));
  }
  querySelector(sel: string): FEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  closest(): FEl | null {
    return null;
  }
}

export function textNode(s: string): FNode {
  const n = new FNode();
  n.textContent = s;
  return n;
}

/** whitespace-normalised text of an element (innerHTML tags stripped) */
export function textOf(e: FEl | FNode): string {
  return e.textContent.replace(/\s+/g, ' ').trim();
}

/** swap the fake document in for the tests of this file (requestAnimationFrame: never calls back) */
export function installFakeDom(): void {
  const g = globalThis as unknown as { document?: unknown; requestAnimationFrame?: unknown };
  let had: [unknown, unknown] = [undefined, undefined];
  beforeAll(() => {
    had = [g.document, g.requestAnimationFrame];
    g.document = { createElement: (t: string) => new FEl(t), createTextNode: (s: string) => textNode(s), addEventListener: () => undefined };
    g.requestAnimationFrame = () => 0;
  });
  afterAll(() => {
    g.document = had[0];
    g.requestAnimationFrame = had[1];
  });
}
