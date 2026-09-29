/**
 * Data-view overlays: per-cell values (0..1 packed into a Uint8 DataTexture, bilinear filtered on the terrain)
 * + a color ramp (RGBA, alpha = coverage) + UI legend, per overlay AND variant. Pure functions, no GPU state.
 * The values come from the simulation's overlayLayer(state, o, variant) (src/sim/infra/overlays.ts), the same layer the
 * query tool's hover readout reads, so what the player sees and what the tip says always agree.
 */
import { Network, Overlay, Zone } from '../../core/types';
import type { CityState } from '../../sim/CityState';
import { EMG_NEAR, EMG_SPAN, OVERLAY_VARIANTS, TAP_T0, overlayDeps, overlayLayer, resolveVariant } from '../../sim/infra/overlays';
import { NOISY_THRESHOLD, POLLUTED_THRESHOLD } from '../../sim/infra/params';
import { TAP_SAFE } from '../../sim/economy/tuning';

export interface RampStop {
  t: number;
  color: string;
  a?: number;
}

export interface LegendStop {
  color: string;
  label: string;
}

export interface OverlayDef {
  title: string;
  /** Simulation 'layerUpdated' names that should refresh this overlay */
  layers: readonly string[];
  ramp: RampStop[];
  legend: LegendStop[];
  /** legend shows separate swatches (categories) instead of a gradient bar */
  swatches?: boolean;
  /** short explanatory lines under the legend (thresholds, what the colours mean for the player) */
  notes?: string[];
  /** the legend shows the prevailing wind (Air pollution: smoke drifts downwind) */
  wind?: boolean;
  /** per-building data: the terrain draws whole cells (nearest texel) instead of blending into the roads between
   *  the homes (a pale halo on every street) */
  crisp?: boolean;
}

type DefCore = Omit<OverlayDef, 'layers'>;

const COVERAGE = (title: string, color: string, light: string, labels = ['None', 'Weak', 'Strong'], notes?: string[]): DefCore => ({
  title,
  ramp: [
    { t: 0, color: '#6b6f78', a: 0.18 },
    { t: 0.08, color: light, a: 0.35 },
    { t: 0.6, color, a: 0.72 },
    { t: 1, color, a: 0.85 },
  ],
  legend: [
    { color: '#6b6f78', label: labels[0] },
    { color: light, label: labels[1] },
    { color, label: labels[2] },
  ],
  notes,
});

const BAD = (title: string, c1: string, c2: string, c3: string, labels = ['Low', 'Medium', 'High'], notes?: string[]): DefCore => ({
  title,
  ramp: [
    { t: 0, color: c1, a: 0 },
    { t: 0.06, color: c1, a: 0.0 },
    { t: 0.25, color: c1, a: 0.55 },
    { t: 0.6, color: c2, a: 0.72 },
    { t: 1, color: c3, a: 0.82 },
  ],
  legend: [
    { color: c1, label: labels[0] },
    { color: c2, label: labels[1] },
    { color: c3, label: labels[2] },
  ],
  notes,
});

/** a 'bad' ramp with a visible step at a player-facing threshold (the chip / flag threshold) */
const THRESHOLD = (title: string, th: number, c1: string, c2: string, c3: string, labels: string[], notes: string[], wind = false): DefCore => ({
  title,
  ramp: [
    { t: 0, color: c1, a: 0 },
    { t: 0.06, color: c1, a: 0 },
    { t: 0.2, color: c1, a: 0.42 },
    { t: th - 0.01, color: c1, a: 0.6 },
    { t: th + 0.01, color: c2, a: 0.74 },
    { t: Math.min(0.99, th + 0.3), color: c3, a: 0.82 },
    { t: 1, color: c3, a: 0.86 },
  ],
  legend: [
    { color: c1, label: labels[0] },
    { color: c2, label: labels[1] },
    { color: c3, label: labels[2] },
  ],
  notes,
  wind,
});

/** visitors / activity heat: transparent where there is none */
const HEAT = (title: string, c1: string, c2: string, c3: string, labels: string[], notes?: string[]): DefCore => ({
  title,
  ramp: [
    { t: 0, color: c1, a: 0 },
    { t: 0.03, color: c1, a: 0 },
    { t: 0.12, color: c1, a: 0.45 },
    { t: 0.5, color: c2, a: 0.7 },
    { t: 1, color: c3, a: 0.85 },
  ],
  legend: [
    { color: c1, label: labels[0] },
    { color: c2, label: labels[1] },
    { color: c3, label: labels[2] },
  ],
  notes,
});

const DESIRABILITY_RAMP: RampStop[] = [
  { t: 0, color: '#c8322a', a: 0.75 },
  { t: 0.35, color: '#e89a5a', a: 0.45 },
  { t: 0.5, color: '#d8d8c8', a: 0.08 },
  { t: 0.65, color: '#8fd07a', a: 0.45 },
  { t: 1, color: '#1f9a4a', a: 0.8 },
];

const DESIRABILITY = (title: string, labels = ['Undesirable', 'Neutral', 'Desirable'], notes?: string[]): DefCore => ({
  title,
  ramp: DESIRABILITY_RAMP,
  legend: [
    { color: '#c8322a', label: labels[0] },
    { color: '#d8d8c8', label: labels[1] },
    { color: '#1f9a4a', label: labels[2] },
  ],
  notes,
});

/** appeal to families / seniors / students (0..1, unsigned): a sequential ramp — poor places stay nearly clear, good
 *  ones glow green (a diverging red ramp painted the whole map red around a young town) */
const APPEAL = (title: string, notes?: string[]): DefCore => ({
  title,
  ramp: [
    { t: 0, color: '#8a8f98', a: 0.16 },
    { t: 0.2, color: '#9aa39a', a: 0.2 },
    { t: 0.45, color: '#a8dca0', a: 0.5 },
    { t: 0.75, color: '#3fae5a', a: 0.72 },
    { t: 1, color: '#1f8a4a', a: 0.85 },
  ],
  legend: [
    { color: '#8a8f98', label: 'Poor' },
    { color: '#a8dca0', label: 'Fair' },
    { color: '#1f8a4a', label: 'Great' },
  ],
  notes,
});

/** demographics shares: few (pale) .. typical (mid) .. many (deep); non-homes transparent */
const DEMO = (title: string, what: string): DefCore => ({
  title,
  ramp: [
    { t: 0, color: '#e6e0f5', a: 0 },
    { t: 0.03, color: '#e6e0f5', a: 0 },
    { t: 0.04, color: '#e9e2f7', a: 0.6 },
    { t: 0.52, color: '#9a7ae0', a: 0.74 },
    { t: 1, color: '#4a1fa0', a: 0.88 },
  ],
  legend: [
    { color: '#e9e2f7', label: 'Few' },
    { color: '#9a7ae0', label: 'Typical' },
    { color: '#4a1fa0', label: 'Many' },
  ],
  notes: [`Share of ${what} per home, against the city-wide typical mix`],
  crisp: true,
});

const EMERGENCY = (title: string, unit: string, station: string): DefCore => {
  // slack s maps to t = 0.08 + 0.92 (s + SPAN) / (2 SPAN): s = -3 -> tNear, s = 0 -> tZero
  const t = (s: number) => 0.08 + (0.92 * (s + EMG_SPAN)) / (2 * EMG_SPAN);
  const tNear = t(-EMG_NEAR), tZero = t(0);
  return {
    title,
    ramp: [
      { t: 0, color: '#6a4c93', a: 0.78 },
      { t: 0.045, color: '#6a4c93', a: 0.78 },
      { t: 0.08, color: '#b8262a', a: 0.8 },
      { t: tNear - 0.006, color: '#d8402a', a: 0.74 },
      { t: tNear + 0.006, color: '#f0a030', a: 0.74 },
      { t: tZero - 0.006, color: '#f0c040', a: 0.7 },
      { t: tZero + 0.006, color: '#6ccf6a', a: 0.55 },
      { t: 1, color: '#1f9a4a', a: 0.7 },
    ],
    legend: [
      { color: '#3fb45a', label: 'Auto-dispatch' },
      { color: '#f0a030', label: 'Just out of reach' },
      { color: '#c8322a', label: 'You must dispatch' },
      { color: '#6a4c93', label: `No ${station}` },
    ],
    swatches: true,
    notes: [
      `Green: ${unit} are sent automatically in time — incidents there become statistics.`,
      'Amber / red: nobody arrives in time on their own. The game drops to live speed and you dispatch.',
    ],
  };
};

const BINARY = (title: string, on: string, onLabel: string, offLabel: string): DefCore => ({
  title,
  ramp: [
    { t: 0, color: '#000000', a: 0 },
    { t: 0.3, color: '#000000', a: 0 },
    { t: 0.5, color: '#d9412b', a: 0.8 },
    { t: 0.62, color: '#d9412b', a: 0.8 },
    { t: 0.85, color: on, a: 0.75 },
    { t: 1, color: on, a: 0.75 },
  ],
  legend: [
    { color: on, label: onLabel },
    { color: '#d9412b', label: offLabel },
  ],
  swatches: true,
});

const NONE: DefCore = { title: 'None', ramp: [{ t: 0, color: '#000000', a: 0 }, { t: 1, color: '#000000', a: 0 }], legend: [] };

const pctT = (v: number) => `${Math.round(v * 100)}%`;

const BASE: Record<Overlay, DefCore> = {
  [Overlay.None]: NONE,
  [Overlay.Zones]: {
    title: 'Zones',
    ramp: NONE.ramp,
    legend: [
      { color: '#7fd66b', label: 'Residential (low)' },
      { color: '#2f9e3a', label: 'Residential (high)' },
      { color: '#6fa8e8', label: 'Commercial (low)' },
      { color: '#2456b8', label: 'Commercial (high)' },
      { color: '#f0d45a', label: 'Industrial (low)' },
      { color: '#c9901e', label: 'Industrial (high)' },
      { color: '#9a7a5a', label: 'Landfill' },
    ],
    swatches: true,
  },
  [Overlay.Traffic]: {
    title: 'Traffic',
    ramp: [
      { t: 0, color: '#3fbf5a', a: 0 },
      { t: 0.015, color: '#3fbf5a', a: 0.0 },
      { t: 0.05, color: '#3fbf5a', a: 0.85 },
      { t: 0.45, color: '#e8d840', a: 0.9 },
      { t: 0.75, color: '#ef8a2a', a: 0.92 },
      { t: 1, color: '#d42a2a', a: 0.95 },
    ],
    legend: [
      { color: '#3fbf5a', label: 'Free flow' },
      { color: '#e8d840', label: 'Busy' },
      { color: '#ef8a2a', label: 'Heavy' },
      { color: '#d42a2a', label: 'Jammed' },
    ],
  },
  [Overlay.AirPollution]: THRESHOLD('Air Pollution', POLLUTED_THRESHOLD, '#d6cf62', '#b87a34', '#5e2a22', ['Clean', `Polluted ≥ ${pctT(POLLUTED_THRESHOLD)}`, 'Heavy smog'],
    [`Homes and shops above ${pctT(POLLUTED_THRESHOLD)} get the "Polluted" chip: lower desirability, health and land value.`], true),
  [Overlay.WaterPollution]: BAD('Water Pollution', '#8fd0a8', '#5a8f3c', '#3b4418', ['Clean', 'Murky', 'Polluted'],
    ['Pumps drawing polluted water deliver dirty tap water — treat it or move them upstream.']),
  [Overlay.Garbage]: BAD('Uncollected Garbage', '#d9c07a', '#a8703a', '#5e3a1e', ['Clean', 'Piling up', 'Overflowing'],
    ['Piles grow where trucks never come: no landfill capacity, out of truck range, or no road at the door.']),
  [Overlay.LandValue]: {
    title: 'Land Value',
    ramp: [
      { t: 0, color: '#9c3b2a', a: 0.55 },
      { t: 0.3, color: '#dcb65a', a: 0.6 },
      { t: 0.6, color: '#46b35a', a: 0.68 },
      { t: 1, color: '#1b6fb0', a: 0.78 },
    ],
    legend: [
      { color: '#9c3b2a', label: 'Low ($)' },
      { color: '#dcb65a', label: 'Medium' },
      { color: '#46b35a', label: 'High ($$)' },
      { color: '#1b6fb0', label: 'Very high ($$$)' },
    ],
  },
  [Overlay.Crime]: BAD('Crime', '#e3c64e', '#d65a2a', '#7a1a4a', ['Safe', 'Some crime', 'Dangerous']),
  [Overlay.Police]: COVERAGE('Police · patrol coverage', '#2d5fd6', '#8fb0f0', ['None', 'Weak', 'Strong'],
    ['How well patrols prevent crime. Response to incidents: Emergency data view.']),
  [Overlay.Fire]: COVERAGE('Fire · prevention coverage', '#d9412b', '#f0a08a', ['None', 'Weak', 'Strong'],
    ['Lower fire risk near stations. Response to fires: Emergency data view.']),
  [Overlay.Health]: COVERAGE('Health · care access', '#d6457e', '#f0a0c0', ['None', 'Weak', 'Strong'],
    ['Clinic and hospital seats within reach. Ambulance response: Emergency data view.']),
  [Overlay.Education]: COVERAGE('Education · all school tiers', '#8a52d6', '#c8a8f0', ['None', 'Some', 'Full'],
    ['Full only with every tier nearby: elementary 45%, high school 35%, university 20%.']),
  [Overlay.Power]: BINARY('Power', '#ffd84a', 'Powered', 'No power'),
  [Overlay.Water]: BINARY('Water Supply', '#3aa0e6', 'Water service', 'No water'),
  [Overlay.Desirability]: DESIRABILITY('Desirability · R$$'),
  [Overlay.Noise]: THRESHOLD('Noise', NOISY_THRESHOLD, '#dbb05a', '#c2482e', '#6a1f5a', ['Quiet', `Noisy ≥ ${pctT(NOISY_THRESHOLD)}`, 'Very noisy'],
    [`Homes above ${pctT(NOISY_THRESHOLD)} get the "Noisy" chip. Trees, parks and distance from highways help.`]),
  [Overlay.Transit]: COVERAGE('Transit Coverage', '#1f9fb0', '#8fd6e0', ['None', 'Some', 'Well served']),
  [Overlay.Parks]: COVERAGE('Parks & Recreation', '#3a9a3a', '#a8dca0', ['None', 'Some', 'Plenty']),
  [Overlay.Commute]: {
    title: 'Commute Time',
    ramp: [
      { t: 0, color: '#3fbf7a', a: 0 },
      { t: 0.04, color: '#3fbf7a', a: 0 },
      { t: 0.06, color: '#3fbf7a', a: 0.55 },
      { t: 0.35, color: '#e8d840', a: 0.62 },
      { t: 0.66, color: '#ef8a2a', a: 0.72 },
      { t: 1, color: '#b8262a', a: 0.8 },
    ],
    legend: [
      { color: '#3fbf7a', label: 'Short' },
      { color: '#e8d840', label: 'Average' },
      { color: '#b8262a', label: 'Very long' },
    ],
    notes: ['Minutes to work from each lot. Avenues, highways and transit shorten it.'],
  },
  [Overlay.Shops]: COVERAGE('Shop Access', '#c07a2a', '#ecc890', ['None', 'Some', 'Plenty'], ['Shops within walking or driving reach of homes.']),
  [Overlay.Demographics]: DEMO('Demographics · children', 'children (0–11)'),
  [Overlay.Tourism]: HEAT('Tourism', '#f0b8d0', '#d0508a', '#7a1a5a', ['Few visitors', 'Busy', 'Crowded'], ['Where tourists go: landmarks, parks, beaches and hotels.']),
  [Overlay.Nimby]: {
    title: 'Neighbourhood Image',
    ramp: [
      { t: 0, color: '#b02a5a', a: 0.8 },
      { t: 0.38, color: '#e08aa0', a: 0.42 },
      { t: 0.48, color: '#d8d8c8', a: 0.0 },
      { t: 0.52, color: '#d8d8c8', a: 0.0 },
      { t: 0.62, color: '#8ab8e8', a: 0.42 },
      { t: 1, color: '#2a6ad0', a: 0.8 },
    ],
    legend: [
      { color: '#b02a5a', label: 'Unwanted (stigma)' },
      { color: '#d8d8c8', label: 'Neutral' },
      { color: '#2a6ad0', label: 'Prestigious' },
    ],
    notes: ['Jails, dumps and heavy plants repel homes (NIMBY); landmarks, parks and campuses attract the wealthy.'],
  },
  [Overlay.Soil]: BAD('Soil Contamination', '#c8b070', '#8a6a30', '#4a3010', ['Clean', 'Contaminated', 'Toxic'],
    ['Left by industry, dumps and spills; it fades slowly once the source is gone.']),
  [Overlay.Emergency]: EMERGENCY('Emergency · fire response', 'fire trucks', 'fire station'),
  [Overlay.Parking]: BAD('Parking Pressure', '#dbb05a', '#c2482e', '#6a1f5a', ['Easy', 'Tight', 'Full'],
    ['Above 60% shops lose customers. A parking garage next to a transit stop relieves the block.']),
};

/** per-variant overrides (index = variant; undefined = the base def) */
const VARIANTS: Partial<Record<Overlay, (Partial<DefCore> | undefined)[]>> = {
  [Overlay.Traffic]: [undefined, {
    title: 'Traffic · trucks',
    ramp: [
      { t: 0, color: '#e8c88a', a: 0 },
      { t: 0.03, color: '#e8c88a', a: 0 },
      { t: 0.06, color: '#e8c88a', a: 0.35 },
      { t: 0.3, color: '#e0a040', a: 0.8 },
      { t: 0.65, color: '#c05a1a', a: 0.9 },
      { t: 1, color: '#6a2a10', a: 0.95 },
    ],
    legend: [
      { color: '#e8c88a', label: 'Few trucks' },
      { color: '#e0a040', label: 'Freight route' },
      { color: '#6a2a10', label: 'Heavy freight' },
    ],
    notes: ['Trucks per day from industry to highways, freight rail and seaports. They make noise and slow cars.'],
  }],
  [Overlay.Garbage]: [undefined, {
    title: 'Garbage · landfill fill',
    ramp: [
      { t: 0, color: '#a8d890', a: 0 },
      { t: 0.02, color: '#a8d890', a: 0.6 },
      { t: 0.5, color: '#d8b050', a: 0.75 },
      { t: 0.8, color: '#c0602a', a: 0.82 },
      { t: 1, color: '#6a2a1a', a: 0.88 },
    ],
    legend: [
      { color: '#a8d890', label: 'Empty' },
      { color: '#d8b050', label: 'Half full' },
      { color: '#6a2a1a', label: 'Full' },
    ],
    notes: ['A full landfill takes no more garbage: zone more, or build an incinerator / recycling center.'],
  }],
  [Overlay.Education]: [undefined,
    { title: 'Education · elementary', notes: ['Children 0–11: seats and walking reach of elementary schools.'] },
    { title: 'Education · high school', notes: ['Teens 12–17: seats and reach of high schools.'] },
    { title: 'Education · university', notes: ['Young adults 18–24: colleges, universities and libraries.'] },
  ],
  [Overlay.Water]: [undefined, {
    title: 'Water · tap water quality',
    ramp: [
      { t: 0, color: '#c8322a', a: 0 },
      { t: 0.06, color: '#c8322a', a: 0 },
      { t: TAP_T0, color: '#c8322a', a: 0.82 },
      { t: TAP_T0 + (1 - TAP_T0) * TAP_SAFE - 0.012, color: '#e8903a', a: 0.76 },
      { t: TAP_T0 + (1 - TAP_T0) * TAP_SAFE + 0.012, color: '#6cc0e8', a: 0.66 },
      { t: 1, color: '#1f78d0', a: 0.78 },
    ],
    legend: [
      { color: '#c8322a', label: 'Unsafe' },
      { color: '#e8903a', label: `< ${pctT(TAP_SAFE)}` },
      { color: '#6cc0e8', label: 'Safe' },
      { color: '#1f78d0', label: 'Clean' },
    ],
    swatches: true,
    notes: [`Below ${pctT(TAP_SAFE)} quality residents get sick and unhappy. A water treatment plant cleans the whole network.`],
    // served cells only: blending into the unserved land would paint an "unsafe" rim around every network
    crisp: true,
  }],
  [Overlay.Parks]: [undefined,
    { title: 'Parks · play & sports', notes: ['Playgrounds and sports fields for children and teens.'] },
    { title: 'Parks · gardens & parks', notes: ['Green space everyone enjoys — seniors most.'] },
  ],
  [Overlay.Demographics]: [
    undefined,
    DEMO('Demographics · teens', 'teens (12–17)'),
    DEMO('Demographics · young adults', 'young adults (18–24)'),
    DEMO('Demographics · seniors', 'seniors (65+)'),
    { ...DEMO('Demographics · workforce', 'working-age residents'), notes: ['Share of residents who work, per home'] },
    {
      title: 'Demographics · wealth',
      ramp: [
        { t: 0, color: '#86b6ef', a: 0 },
        { t: 0.2, color: '#86b6ef', a: 0 },
        { t: 0.33, color: '#9cc4f2', a: 0.72 },
        { t: 0.66, color: '#3987e5', a: 0.78 },
        { t: 1, color: '#15358f', a: 0.85 },
      ],
      legend: [
        { color: '#9cc4f2', label: 'R$ homes' },
        { color: '#3987e5', label: 'R$$ homes' },
        { color: '#15358f', label: 'R$$$ homes' },
      ],
      swatches: true,
      notes: ['Wealthy residents want high land value, parks, safety and prestige nearby.'],
    },
  ],
  [Overlay.Emergency]: [undefined, EMERGENCY('Emergency · police response', 'police cars', 'police station'), EMERGENCY('Emergency · ambulance response', 'ambulances', 'clinic or hospital')],
};

/** desirability variant titles / notes: the 12 DevTypes, then the appeal views */
function desirabilityDef(v: number): DefCore {
  const labels = OVERLAY_VARIANTS[Overlay.Desirability]!;
  if (v >= 12) {
    const who = labels[v];
    const why = v === 12 ? 'Schools, playgrounds, safety and quiet streets' : v === 13 ? 'Clinics and hospitals, gardens, shops and quiet' : 'Colleges, transit and shops';
    return APPEAL(`Appeal · ${who.toLowerCase()}`, [`${why} draw ${who.toLowerCase()} here.`]);
  }
  return DESIRABILITY(`Desirability · ${labels[v]}`, ['Undesirable', 'Neutral', 'Desirable'], ['Where this kind of building wants to grow (hover a lot for the reasons).']);
}

/** the definition (ramp, legend, refresh layers) of an overlay + variant */
export function overlayDef(o: Overlay, variant = -1): OverlayDef {
  const base = BASE[o] ?? NONE;
  const v = resolveVariant(o, variant);
  let core: DefCore = base;
  if (o === Overlay.Desirability) core = desirabilityDef(v);
  else {
    const ov = VARIANTS[o]?.[v];
    if (ov) core = { ...base, ...ov };
  }
  return { ...core, layers: overlayDeps(o, v) };
}

/** default definitions (variant -1) per overlay (kept for callers that index by overlay) */
export const OVERLAYS: Record<Overlay, OverlayDef> = Object.fromEntries(
  (Object.keys(BASE) as unknown as Overlay[]).map((k) => [k, overlayDef(Number(k) as Overlay)]),
) as Record<Overlay, OverlayDef>;

export interface OverlayLegend {
  title: string;
  stops: LegendStop[];
  /** separate swatches (categories) instead of a gradient */
  swatches: boolean;
  notes: string[];
  wind: boolean;
}

/** Legend for the UI (title + color stops + notes) of an overlay + variant. */
export function overlayLegend(o: Overlay, variant = -1): OverlayLegend {
  const d = overlayDef(o, variant);
  return { title: d.title, stops: d.legend.map((s) => ({ ...s })), swatches: !!d.swatches, notes: [...(d.notes ?? [])], wind: !!d.wind };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fill `out` (Uint8, N*N) with the overlay value per cell (0..255) of an overlay + variant. */
export function computeOverlayValues(state: CityState, o: Overlay, out: Uint8Array, variant = -1): void {
  const C = state.cells;
  if (o === Overlay.None || o === Overlay.Zones) {
    out.fill(0);
    return;
  }
  const L = overlayLayer(state, o, variant);
  if (!L || !L.data || L.data.length < C) {
    out.fill(0);
    return;
  }
  const d = L.data, inv = 1 / (L.scale || 1);
  if (L.palette === 'binary') {
    // served 255, a building / zoned lot that needs the service but has none 128 (red), anything else 0
    for (let i = 0; i < C; i++) {
      const needs = state.building[i] >= 0 || state.zone[i] !== Zone.None;
      out[i] = d[i] ? 255 : needs ? 128 : 0;
    }
    return;
  }
  if (L.roadsOnly) {
    const net = state.network;
    for (let i = 0; i < C; i++) out[i] = net[i] !== 0 && net[i] !== Network.Rail ? Math.round((0.05 + 0.95 * clamp01(d[i] * inv)) * 255) : 0;
    return;
  }
  if (L.palette === 'diverging') {
    for (let i = 0; i < C; i++) out[i] = Math.round(clamp01(0.5 + 0.5 * d[i] * inv) * 255);
    return;
  }
  if (L.floor !== undefined) {
    const f = L.floor;
    for (let i = 0; i < C; i++) {
      const v = d[i];
      out[i] = v > 0 ? Math.round((f + (1 - f) * clamp01(v * inv)) * 255) : 0;
    }
    return;
  }
  for (let i = 0; i < C; i++) out[i] = Math.round(clamp01(d[i] * inv) * 255);
}

/** Zone tint colors (sRGB hex) indexed by Zone. Lighter = low density, darker = high density. */
export const ZONE_COLORS: Record<number, number> = {
  [Zone.None]: 0x000000,
  [Zone.ResLow]: 0x86e070,
  [Zone.ResMed]: 0x4fc04a,
  [Zone.ResHigh]: 0x2a9434,
  [Zone.ComLow]: 0x7ab4f0,
  [Zone.ComMed]: 0x4a86dc,
  [Zone.ComHigh]: 0x2456b8,
  [Zone.IndAg]: 0xd8e070,
  [Zone.IndMed]: 0xf0cc4a,
  [Zone.IndHigh]: 0xd0921e,
  [Zone.Landfill]: 0x9a7a5a,
};
