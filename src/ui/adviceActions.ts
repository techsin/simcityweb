/**
 * Advice actions (POLISH_PLAN FH-03, LG-05): the button an advice offers — "Zone homes" on "no room to grow", "Build
 * roads" on zones no road reaches, "Rezone" and "Connect a highway" on a built-out city — found by the advice's id, never
 * by its text (a text gets reworded; the id stays): NewsItem.ref.advice for a toast (src/ui/Notifications.ts), the card's
 * options, else OpenAdvice.ref ?? id, for an Advisors card (src/ui/panels/AdvisorsPanel.ts). An id without an entry
 * offers no button. An action moves the camera to the advice's place first when it has one, then opens its tool or data
 * view; a tool pulses its toolbar category for a few seconds (the onboarding coach mark's look, PULSE_CLASS: a class of
 * its own, which the onboarding card's coach updates leave alone). emptyFrontTiles: the room a
 * family has left, for the "no room to grow" card's count (and FH-03's RCI "+ zone" badge once the TopBar is split:
 * demand above 0.5 with fewer than 12 such tiles — 8 for commercial and industrial, as the zone rules count).
 */
import { Network, Overlay, Zone, isRoad } from '../core/types';
import type { GameContext } from '../game/context';
import { CATEGORIES } from '../game/toolCatalog';
import type { CityState, NewsItem } from '../sim/CityState';
import type { OpenAdvice } from '../sim/economy/advisors';

export interface AdviceAction {
  /** the button's words (a toast shows them under its text) */
  label: string;
  /** src/ui/icons.ts name */
  icon: string;
  /** what the button does (its tooltip) */
  tip: string;
  /** run it; `at`: the advice's place (null: none) */
  run(ctx: GameContext, at: { x: number; z: number } | null): void;
}

/** a card's button and the place it acts on */
export interface AdviceButton {
  action: AdviceAction;
  at: { x: number; z: number } | null;
}

/** the camera distance of an action's move (the Advisors panel's "Show me") */
const FOCUS_DISTANCE = 420;
/** how long a toolbar category pulses after an action selected one of its tools (ms) */
export const PULSE_MS = 4500;

/** the class of an advice pulse: the coach mark's look (hud.css) under a class of its own — the onboarding card resets
 *  `coach` on every toolbar button about twice a second (Toolbar.setCoach), which would end the pulse at once */
export const PULSE_CLASS = 'advice-pulse';
/** the pulses' pending timers per city, cleared with it (a timer must not hold an exited city's toolbar) */
const pulseTimers = new WeakMap<AbortSignal, Set<ReturnType<typeof setTimeout>>>();
/** a button's running pulse (a new pulse restarts it) */
const pulseOf = new WeakMap<Element, ReturnType<typeof setTimeout>>();
/** pulse toolbar category `catId` for PULSE_MS: Toolbar builds one .tb-btn per CATEGORIES entry, in that order (nothing to
 *  pulse without that toolbar) */
function pulse(ctx: GameContext, catId: string): void {
  const k = CATEGORIES.findIndex((c) => c.id === catId);
  const btns = ctx.root?.querySelector('.toolbar')?.querySelectorAll('.tb-btn');
  const b = k >= 0 && btns && btns.length === CATEGORIES.length ? btns[k] : null;
  if (!b || ctx.signal?.aborted) return;
  let timers = ctx.signal ? pulseTimers.get(ctx.signal) : undefined;
  if (ctx.signal && !timers) {
    const own = (timers = new Set());
    pulseTimers.set(ctx.signal, own);
    ctx.signal.addEventListener('abort', () => { for (const t of own) clearTimeout(t); own.clear(); }, { once: true });
  }
  const prev = pulseOf.get(b);
  if (prev !== undefined) {
    clearTimeout(prev);
    timers?.delete(prev);
  }
  b.classList.add(PULSE_CLASS);
  const t = setTimeout(() => {
    timers?.delete(t);
    pulseOf.delete(b);
    b.classList.remove(PULSE_CLASS);
  }, PULSE_MS);
  pulseOf.set(b, t);
  timers?.add(t);
}

const go = (ctx: GameContext, at: { x: number; z: number } | null) => {
  if (at) ctx.focusCell(at.x, at.z, FOCUS_DISTANCE);
};

/** a tool of toolbar category `cat`: selected (its own sound), the category pulsing */
function toolAction(label: string, icon: string, tip: string, tool: string, cat: string): AdviceAction {
  return {
    label, icon, tip,
    run(ctx, at) {
      go(ctx, at);
      if (ctx.tools.select(tool)) pulse(ctx, cat);
    },
  };
}

/** LG-05: the low-value blocks show on the Land value view; the Zones tools paint the new zone over them */
const REZONE: AdviceAction = {
  label: 'Rezone', icon: 'landValue', tip: 'Shows the lowest-value block on the Land value view and opens the Zones tools',
  run(ctx, at) {
    go(ctx, at);
    if (ctx.overlay !== Overlay.LandValue) ctx.setOverlay(Overlay.LandValue);
    ctx.openFlyout?.('zones');
  },
};

/** advice id (src/sim/economy/advisors.ts rule id, Advice.ref or an Advice.options id) → its action */
const ACTIONS: Readonly<Record<string, AdviceAction>> = {
  zoneR: toolAction('Zone homes', 'res', 'Selects residential zoning: paint it along your roads', 'zone:1', 'zones'),
  zoneC: toolAction('Zone shops', 'com', 'Selects commercial zoning: paint it along your roads', 'zone:4', 'zones'),
  zoneI: toolAction('Zone industry', 'ind', 'Selects industrial zoning: paint it along your roads', 'zone:8', 'zones'),
  noRoadAccess: toolAction('Build roads', 'road', 'Selects the Road tool: run roads into the zones', 'net:2', 'transport'),
  rezone: REZONE,
  connect: toolAction('Connect a highway', 'highway', 'Selects the Highway tool at the neighbour’s edge', 'net:5', 'transport'),
  // (the built-out card's toast offers its first option)
  builtOut: REZONE,
};

/** the action of advice id `id`; null: it has no button */
export function adviceAction(id: string | null | undefined): AdviceAction | null {
  return id && Object.prototype.hasOwnProperty.call(ACTIONS, id) ? ACTIONS[id] : null;
}

/** a news item's button: by NewsItem.ref.advice, never by the text */
export function newsAction(n: Pick<NewsItem, 'ref'>): AdviceAction | null {
  return adviceAction(n.ref?.advice);
}

const placeOf = (p: { x?: number; z?: number }) => (p.x !== undefined && p.z !== undefined ? { x: p.x, z: p.z } : null);

/** an Advisors card's buttons: its options (LG-05), else its own action (its ref, else its rule id) at its place */
export function issueButtons(o: Pick<OpenAdvice, 'id' | 'ref' | 'options' | 'x' | 'z'>): AdviceButton[] {
  const out: AdviceButton[] = [];
  if (o.options?.length) {
    for (const p of o.options) {
      const action = adviceAction(p.id);
      if (action) out.push({ action, at: placeOf(p) });
    }
    return out;
  }
  const action = adviceAction(o.ref ?? o.id);
  if (action) out.push({ action, at: placeOf(o) });
  return out;
}

/**
 * FH-03: the room a family (0 R, 1 C, 2 I) has left — empty zoned tiles facing a road, with no network, water or power
 * line on them: what growth counts as room (growth.ts rebuildCandidates; the advisors' zone rules read that count). One
 * pass over the mirrored layers
 */
export function emptyFrontTiles(st: Pick<CityState, 'size' | 'cells' | 'zone' | 'building' | 'network' | 'water' | 'powerLines'>, fam: number): number {
  const N = st.size, C = st.cells, zone = st.zone, bld = st.building, net = st.network, water = st.water, lines = st.powerLines;
  const lo = fam === 0 ? Zone.ResLow : fam === 1 ? Zone.ComLow : Zone.IndAg, hi = lo + 2;
  const road = (i: number) => isRoad(net[i] as Network);
  let n = 0;
  for (let i = 0; i < C; i++) {
    const zn = zone[i];
    if (zn < lo || zn > hi || bld[i] >= 0 || net[i] !== Network.None || water[i] || lines[i]) continue;
    const x = i % N;
    if ((x > 0 && road(i - 1)) || (x < N - 1 && road(i + 1)) || (i >= N && road(i - N)) || (i + N < C && road(i + N))) n++;
  }
  return n;
}
