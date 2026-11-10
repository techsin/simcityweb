/**
 * Top HUD bar: city, date & speed, funds, population, RCI demand, approval, panel buttons.
 *
 * The shell (POLISH_PLAN §7.3: META's) lays out one component per segment from src/ui/topbar/ and ticks them in order;
 * each segment owns its DOM, its listeners and its update (the round-1 TopBar split, §7.4):
 * - cityDate.ts (META): city menu, date with the PAUSED and LIVE pills, speed buttons, time of day;
 * - fundsSegment.ts (GUIDE): treasury and last month's recurring net;
 * - populationSegment.ts (CONTENT): residents and their monthly change;
 * - rciSegment.ts (GUIDE): demand bars, FH-03's "+ zone" badge, the cap toasts and the RCI popover;
 * - approvalSegment.ts (GUIDE): score, face and the FH-06 card;
 * - panelButtons.ts (META): panel buttons with their badges, Help, Settings and the menu.
 */
import type { GameContext } from '../game/context';
import { h } from './dom';
import { CityDateGroup } from './topbar/cityDate';
import { FundsSegment } from './topbar/fundsSegment';
import { PopulationSegment } from './topbar/populationSegment';
import { RciSegment } from './topbar/rciSegment';
import { ApprovalSegment } from './topbar/approvalSegment';
import { PanelButtons } from './topbar/panelButtons';

export { isOneOff, lastNet, sumOneOff, sumRecurring, sumValues } from './topbar/fundsSegment';
export { DEV_NAMES, capRatio, familyDemand } from './topbar/rciSegment';

export class TopBar {
  readonly el: HTMLDivElement;
  readonly city: CityDateGroup;
  readonly funds: FundsSegment;
  readonly population: PopulationSegment;
  readonly rci: RciSegment;
  readonly approval: ApprovalSegment;
  readonly buttons: PanelButtons;

  constructor(ctx: GameContext, parent: HTMLElement) {
    this.city = new CityDateGroup(ctx);
    this.funds = new FundsSegment(ctx);
    this.population = new PopulationSegment(ctx);
    // opening the popover refreshes the whole bar at once
    this.rci = new RciSegment(ctx, () => this.update());
    this.approval = new ApprovalSegment(ctx);
    this.buttons = new PanelButtons(ctx);
    this.el = h('div', { class: 'hud-top' });
    this.el.append(
      this.city.el,
      h('div', { class: 'mp-glass' }, this.funds.el, this.population.el, this.rci.el, this.approval.el),
      h('div', { class: 'spacer' }),
      this.buttons.el,
    );
    parent.appendChild(this.el);
  }

  /** onboarding coach mark on the play button */
  setCoachPlay(on: boolean): void {
    this.city.setCoachPlay(on);
  }

  /** badge (e.g. unread advisor messages) on a panel button */
  setBadge(panel: string, n: number): void {
    this.buttons.setBadge(panel, n);
  }

  /** close the RCI popover; true if it was open */
  closePopover(): boolean {
    return this.rci.closePopover();
  }

  /** one HUD tick (CityScene: ~6 Hz, and at once when the camera stops); the segments in their pre-split order */
  update(): void {
    this.city.update();
    this.funds.update();
    this.population.update();
    this.rci.update();
    this.buttons.update();
    this.approval.update();
  }
}
