/**
 * The top bar's left group (POLISH_PLAN §7.3: META's, from the round-1 TopBar split): the city menu (name, mayor,
 * difficulty), the date with its PAUSED and LIVE pills, the speed buttons and the time of day.
 */
import type { GameContext } from '../../game/context';
import { h, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import { dayLabel, hourLabel } from '../format';

/**
 * FH-08 (META's hunk): the LIVE pill's hover title states T029's rule and the restore (emergencyPolicy.ts). An
 * emergency inside a station's range never slows the game: only 'uncovered' sites that are not 'busy' raise an alert.
 * Outside every range LIVE holds the game at slowed 1x while the player sends help; the player's speed comes back once
 * the help sent is on scene (FOLLOW_GRACE; at once for a drive over FOLLOW_MAX_MIN) or the call is over, unless the
 * player changed it meanwhile. The pill shows only while that slow-down runs, so the 30 s cooldown (LIVE_COOLDOWN_MS)
 * needs no words here.
 */
const LIVE_TITLE = 'Within station range never slows. Outside it, LIVE slows your dispatch; your speed returns when help arrives. Settings → Gameplay.';

export class CityDateGroup {
  readonly el: HTMLElement;
  private cityName: HTMLElement;
  private citySub: HTMLElement;
  private dateEl: HTMLElement;
  private todEl: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];

  constructor(private ctx: GameContext) {
    this.cityName = h('div', { class: 'city-name' });
    this.citySub = h('div', { class: 'hud-sub dim' });
    const city = h('div', { class: 'hud-seg click', title: 'City menu (Esc)' }, h('div', { class: 'city-badge', html: icon('resHigh', 18) }), h('div', { class: 'hud-stack' }, this.cityName, this.citySub));
    city.addEventListener('click', () => this.ctx.openPauseMenu(), { signal: this.ctx.signal });
    this.dateEl = h('div', { class: 'hud-value' });
    this.todEl = h('div', { class: 'tod hide-sm' });
    const date = h('div', { class: 'hud-seg' }, h('div', { class: 'hud-stack' }, h('div', { class: 'hud-label' }, 'Date', h('span', { class: 'paused-pill' }, 'PAUSED'), h('span', { class: 'live-pill', title: LIVE_TITLE }, 'LIVE')), this.dateEl));
    const speeds: [number, string, string][] = [[0, 'pause', 'Pause (Space)'], [1, 'play', 'Normal speed (1)'], [2, 'fast', 'Fast (2)'], [3, 'ultra', 'Ultra (3)']];
    const sp = h('div', { class: 'speed' });
    for (const [s, ic, t] of speeds) {
      const b = h('button', { title: t, html: icon(ic, 15) }) as HTMLButtonElement;
      b.addEventListener('click', () => {
        // distinct sounds: pause (tape-stop), normal / fast / ultra (1-3 rising blips); re-clicking the active speed ticks
        this.ctx.sound(this.ctx.sim.speed === s ? 'tap' : s === 0 ? 'pause' : 'speed' + s);
        this.ctx.host.setSpeed(s, 'topbar');
        b.blur();
      }, { signal: this.ctx.signal });
      this.speedBtns.push(b);
      sp.appendChild(b);
    }
    const spSeg = h('div', { class: 'hud-seg' }, sp, this.todEl);
    this.el = h('div', { class: 'mp-glass' }, city, date, spSeg);
  }

  /** onboarding coach mark on the play button */
  setCoachPlay(on: boolean): void {
    toggleClass(this.speedBtns[1], 'coach', on);
  }

  update(): void {
    const ctx = this.ctx;
    const st = ctx.state;
    setText(this.cityName, st.config.name || 'New City');
    const diff = st.config.sandbox ? 'Sandbox' : st.config.difficulty[0].toUpperCase() + st.config.difficulty.slice(1);
    setText(this.citySub, `Mayor ${st.config.mayor || ''} · ${diff}`.replace('Mayor  ·', 'Mayor ·'));
    setText(this.dateEl, dayLabel(st.day, st.config.startYear));
    const speed = ctx.sim.speed;
    this.speedBtns.forEach((b, i) => {
      toggleClass(b, 'on', i === speed);
      toggleClass(b, 'paused', i === 0 && speed === 0);
    });
    toggleClass(this.el, 'is-paused', speed === 0);
    let hour = 12;
    try {
      hour = ctx.world.timeOfDay ?? 12;
    } catch {
      /* ignore */
    }
    const night = hour < 6 || hour >= 19.5;
    const todHtml = icon(night ? 'moon' : hour < 8 || hour > 18 ? 'sunrise' : 'sun', 15) + `<span class="num">${hourLabel(hour)}</span>`;
    if (this.todEl.dataset.h !== todHtml) {
      this.todEl.dataset.h = todHtml;
      this.todEl.innerHTML = todHtml;
    }
    toggleClass(this.todEl, 'night', night);
  }
}
