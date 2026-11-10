/**
 * Stylish full-screen loading overlay with progress text, bar and rotating tips: the general tips from a random one,
 * or a caller's own list in its order (FH-12: the first city's three tips, firstCity.ts).
 */
import { h } from './dom';
import { EMBLEM_SVG } from './emblem';

const TIPS = [
  'Connect your city to its neighbours with roads, rails and highways to share jobs and trade.',
  'Low-density residential grows best away from heavy industry — pollution travels downwind.',
  'Parks and plazas raise land value and attract wealthier residents.',
  'Keep an eye on the RCI demand bars: zone what your city is asking for.',
  'Avenues and highways carry far more traffic than streets. Plan your arterials early.',
  'Water pollution spreads along rivers. Put pumps upstream of your industry.',
  'Each region tile is its own city — found several and watch the region grow.',
  'Take a loan to fund a big project, but make sure your budget can cover the payments.',
];

export class LoadingScreen {
  readonly el: HTMLElement;
  private text: HTMLElement;
  private fill: HTMLElement;
  private tip: HTMLElement;
  private timer: ReturnType<typeof setInterval>;

  constructor(root: HTMLElement, title = 'METROPOLIS', tips: readonly string[] = TIPS) {
    this.text = h('div', { class: 'ld-text' }, 'Loading…');
    this.fill = h('div', { class: 'ld-fill' });
    if (!tips.length) tips = TIPS;
    let k = tips === TIPS ? Math.floor(Math.random() * tips.length) : 0;
    this.tip = h('div', { class: 'ld-tip' }, h('b', {}, 'Tip'), tips[k]);
    this.el = h(
      'div',
      { class: 'loading' },
      h('div', { class: 'ld-emblem', html: EMBLEM_SVG }),
      h('div', { class: 'ld-logo' }, title),
      h('div', { class: 'ld-bar' }, this.fill),
      this.text,
      this.tip,
    );
    root.appendChild(this.el);
    this.timer = setInterval(() => {
      k = (k + 1) % tips.length;
      this.tip.replaceChildren(h('b', {}, 'Tip'), tips[k]);
    }, 5000);
  }

  set(text: string, progress?: number): void {
    this.text.textContent = text;
    if (progress !== undefined) this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
  }

  async hide(): Promise<void> {
    clearInterval(this.timer);
    this.fill.style.width = '100%';
    this.el.classList.add('fade');
    await new Promise((r) => setTimeout(r, 480));
    this.el.remove();
  }

  remove(): void {
    clearInterval(this.timer);
    this.el.remove();
  }
}
