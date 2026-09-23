/**
 * Toolbar categories and tool specs. Building tools are generated from the catalog (src/sim/catalog.ts) — only the
 * UI metadata (icons, grouping, hotkeys) lives here.
 */
import { Network, Zone } from '../core/types';
import * as catalogMod from '../sim/catalog';
import type { BuildingCategory, BuildingDef } from '../sim/catalogTypes';
import type { GameContext } from './context';
import { RectTool, ZONE_LABELS } from './tools/ZoneTool';
import { NetworkTool, type NetKind } from './tools/NetworkTool';
import { PlopTool } from './tools/PlopTool';
import { QueryTool } from './tools/QueryTool';
import { BrushTool } from './tools/BrushTool';
import { DisasterTool } from './tools/DisasterTool';
import type { Tool } from './tools/Tool';
import { titleCase } from '../ui/format';

export interface ToolSpec {
  id: string;
  label: string;
  icon: string;
  /** css color accent */
  color?: string;
  hotkey?: string;
  desc?: string;
  /** one-off cost (plops) or per-tile cost */
  cost?: number;
  costUnit?: string;
  upkeep?: number;
  income?: number;
  def?: BuildingDef;
  /** unlock hint when locked */
  locked?: { hint: string; progress?: number } | null;
  /** disabled reason (e.g. already built) */
  disabled?: string | null;
  create: (ctx: GameContext) => Tool;
}

export interface ToolGroup {
  label: string;
  icon?: string;
  items: ToolSpec[];
}

export interface ToolCategory {
  id: string;
  label: string;
  icon: string;
  color: string;
  hotkey?: string;
  /** direct tool (no flyout) */
  toolId?: string;
  /** opens a panel */
  panelId?: string;
  groups?: (ctx: GameContext) => ToolGroup[];
}

export const Z_COLORS = { R: 'var(--res)', C: 'var(--com)', I: 'var(--ind)' };

// ------------------------------------------------------------------------------------------------ catalog access
export function allDefs(): BuildingDef[] {
  const cm = catalogMod as unknown as { CATALOG?: BuildingDef[] };
  return Array.isArray(cm.CATALOG) ? cm.CATALOG : [];
}

export function ploppablesOf(cat: BuildingCategory): BuildingDef[] {
  const cm = catalogMod as unknown as { ploppables?: (c: BuildingCategory) => BuildingDef[] };
  let list: BuildingDef[] = [];
  try {
    list = typeof cm.ploppables === 'function' ? cm.ploppables(cat) : allDefs().filter((d) => d.category === cat);
  } catch {
    list = allDefs().filter((d) => d.category === cat);
  }
  return list.filter((d) => !d.hidden && d.category !== 'growable').sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0));
}

/** best-effort icon for a building def (UI metadata only) */
export function defIcon(d: BuildingDef): string {
  const s = (d.id + ' ' + d.model + ' ' + d.name).toLowerCase();
  const rules: [RegExp, string][] = [
    [/wind/, 'wind'], [/solar/, 'solar'], [/nuclear|coal|oil|gas_plant|gas plant|incinerat/, 'factory'], [/hydro|dam/, 'water'],
    [/water_tower|water tower/, 'waterTower'], [/pump|treatment|desalin/, 'water'], [/recycl/, 'recycle'], [/landfill|dump/, 'garbage'],
    [/bus/, 'bus'], [/subway/, 'subway'], [/train|rail|freight/, 'train'], [/airport|air/, 'plane'], [/seaport|ferry|marina|port/, 'anchor'],
    [/parking/, 'parking'], [/police|jail|prison/, 'police'], [/fire/, 'fire'], [/clinic|hospital|medical/, 'health'],
    [/school|college|university|library|museum/, 'education'], [/stadium|soccer|baseball|basketball|tennis|golf/, 'park'],
    [/zoo|garden|park|plaza|playground/, 'park'], [/casino/, 'star'], [/military|missile/, 'target'], [/toxic/, 'alert'],
    [/research/, 'star'], [/statue|obelisk|arch|clock|spire|tower|pyramid|castle|cathedral|opera|lighthouse|observatory|wheel/, 'landmark'],
    [/city_hall|courthouse|mayor|convention|cemetery/, 'civic'],
  ];
  for (const [re, ic] of rules) if (re.test(s)) return ic;
  const byCat: Record<string, string> = { power: 'power', water: 'water', garbage: 'garbage', police: 'police', fire: 'fire', health: 'health', education: 'education', park: 'park', civic: 'civic', landmark: 'landmark', reward: 'reward', transport: 'bus' };
  return byCat[d.category] ?? 'civic';
}

export const CATEGORY_COLORS: Record<string, string> = {
  power: '#f5c542', water: '#4fb7ff', garbage: '#b08a5a', police: '#5a8cff', fire: '#ff6a4d', health: '#ff7a9a', education: '#f0a64a',
  park: '#52d273', civic: '#c7b8ff', landmark: '#b58cff', reward: '#e7b04a', transport: '#9fb3c8',
};

function lockOf(ctx: GameContext, d: BuildingDef): ToolSpec['locked'] {
  if (!d.requires || ctx.sandbox() || ctx.state.unlocked.has(d.requires)) return null;
  let hint = titleCase(d.requires);
  let progress: number | undefined;
  try {
    const r = ctx.mods.listRewards?.(ctx.state).find((x) => x.id === d.requires || x.defIds.includes(d.id));
    if (r) {
      hint = r.requirement || r.description || r.name;
      progress = r.progress;
    }
  } catch {
    /* ignore */
  }
  return { hint, progress };
}

function disabledOf(ctx: GameContext, d: BuildingDef): string | null {
  if (!d.unique) return null;
  if ((ctx.state.milestones[d.id] ?? 0) > 0) return 'Already built (one per city)';
  for (const b of ctx.state.buildings.values()) if (b.def === d.id) return 'Already built (one per city)';
  return null;
}

export function plopSpec(ctx: GameContext, d: BuildingDef): ToolSpec {
  const icon = defIcon(d);
  return {
    id: 'plop:' + d.id,
    label: d.name,
    icon,
    color: CATEGORY_COLORS[d.category],
    desc: d.description,
    cost: d.cost,
    upkeep: d.upkeep,
    income: d.income,
    def: d,
    locked: lockOf(ctx, d),
    disabled: disabledOf(ctx, d),
    create: (c) => new PlopTool(c, d, icon),
  };
}

function plopGroup(ctx: GameContext, label: string, icon: string, cats: BuildingCategory[], extra: ToolSpec[] = []): ToolGroup {
  const items = [...extra];
  for (const c of cats) for (const d of ploppablesOf(c)) items.push(plopSpec(ctx, d));
  return { label, icon, items };
}

// ------------------------------------------------------------------------------------------------ static tools
const zoneSpec = (zone: Zone, label: string, icon: string, color: string, hotkey?: string, desc?: string): ToolSpec => ({
  id: 'zone:' + zone,
  label,
  icon,
  color,
  hotkey,
  desc: desc ?? ZONE_LABELS[zone],
  costUnit: '/tile',
  create: (c) => new RectTool(c, { kind: 'zone', zone }, 'zone:' + zone, ZONE_LABELS[zone], icon),
});

const netSpec = (kind: NetKind, id: string, label: string, icon: string, hotkey?: string, desc?: string): ToolSpec => ({
  id,
  label,
  icon,
  hotkey,
  desc,
  costUnit: '/tile',
  color: kind === 'power' ? '#f5c542' : kind === 'subway' ? '#b58cff' : '#9fb3c8',
  create: (c) => new NetworkTool(c, kind, id, icon),
});

export const STATIC_TOOLS: Record<string, ToolSpec> = {};
function reg(s: ToolSpec): ToolSpec {
  STATIC_TOOLS[s.id] = s;
  return s;
}

const Z = {
  r1: reg(zoneSpec(Zone.ResLow, 'Low density', 'res', '#57d17f', 'R', 'Houses and cottages. Cheap to zone, low traffic.')),
  r2: reg(zoneSpec(Zone.ResMed, 'Medium density', 'resMed', '#35b865', 'R', 'Apartments and row houses.')),
  r3: reg(zoneSpec(Zone.ResHigh, 'High density', 'resHigh', '#1f9a4d', 'R', 'Residential towers. Needs strong demand and good services.')),
  c1: reg(zoneSpec(Zone.ComLow, 'Low density', 'com', '#6aa6ff', 'C', 'Corner shops, diners and small offices.')),
  c2: reg(zoneSpec(Zone.ComMed, 'Medium density', 'comMed', '#3d8bff', 'C', 'Mid-rise shops, hotels and offices.')),
  c3: reg(zoneSpec(Zone.ComHigh, 'High density', 'comHigh', '#2667d6', 'C', 'Skyscrapers and malls. Loves traffic & land value.')),
  i1: reg(zoneSpec(Zone.IndAg, 'Agriculture', 'agri', '#c3cf62', 'I', 'Farms. Low pollution, very few jobs.')),
  i2: reg(zoneSpec(Zone.IndMed, 'Medium density', 'indMed', '#f0b429', 'I', 'Dirty industry and manufacturing.')),
  i3: reg(zoneSpec(Zone.IndHigh, 'High density', 'indHigh', '#d88d17', 'I', 'Manufacturing and high-tech. Needs educated workers.')),
  lf: reg(zoneSpec(Zone.Landfill, 'Landfill', 'landfill', '#b08a5a', undefined, 'Garbage dump zone. Lowers nearby land value.')),
  dz: reg({ id: 'dezone', label: 'De-zone', icon: 'dezone', color: '#ff9d5d', hotkey: 'X', desc: 'Remove zoning from an area.', create: (c) => new RectTool(c, { kind: 'dezone' }, 'dezone', 'De-zone', 'dezone') }),
};

const N = {
  street: reg(netSpec(Network.Street, 'net:1', 'Street', 'street', 'T', 'Cheap, slow and low-capacity. Great for residential blocks.')),
  road: reg(netSpec(Network.Road, 'net:2', 'Road', 'road', 'T', 'Standard two-lane road.')),
  avenue: reg(netSpec(Network.Avenue, 'net:3', 'Avenue', 'avenue', 'T', 'Four-lane divided road with high capacity.')),
  oneway: reg(netSpec(Network.OneWay, 'net:4', 'One-way road', 'oneway', 'T', 'Drag in the direction of travel.')),
  highway: reg(netSpec(Network.Highway, 'net:5', 'Highway', 'highway', 'T', 'Limited access, very high capacity. Ramps connect to roads & avenues.')),
  rail: reg(netSpec(Network.Rail, 'net:6', 'Rail', 'rail', undefined, 'Train tracks for passenger and freight stations.')),
  subway: reg(netSpec('subway', 'subway', 'Subway', 'subway', 'U', 'Underground rail. Place subway stations to connect.')),
  power: reg(netSpec('power', 'power', 'Power line', 'pylon', 'L', 'Carries electricity between power plants and zones.')),
};

const T = {
  query: reg({ id: 'query', label: 'Query', icon: 'query', color: '#7cd4ff', hotkey: 'V', desc: 'Inspect buildings, roads and lots.', create: (c) => new QueryTool(c) }),
  bulldoze: reg({ id: 'bulldoze', label: 'Bulldoze', icon: 'bulldoze', color: '#ff6a4d', hotkey: 'B', desc: 'Demolish buildings, roads and trees.', create: (c) => new RectTool(c, { kind: 'bulldoze' }, 'bulldoze', 'Bulldoze', 'bulldoze') }),
  raise: reg({ id: 'terra:raise', label: 'Raise', icon: 'raise', color: '#c9a36a', hotkey: 'K', desc: 'Raise the terrain.', create: (c) => new BrushTool(c, 'raise', 'raise') }),
  lower: reg({ id: 'terra:lower', label: 'Lower', icon: 'lower', color: '#c9a36a', hotkey: 'K', desc: 'Lower the terrain (below sea level makes water).', create: (c) => new BrushTool(c, 'lower', 'lower') }),
  level: reg({ id: 'terra:level', label: 'Level', icon: 'level', color: '#c9a36a', hotkey: 'K', desc: 'Flatten to the height where you start.', create: (c) => new BrushTool(c, 'level', 'level') }),
  smooth: reg({ id: 'terra:smooth', label: 'Smooth', icon: 'smooth', color: '#c9a36a', hotkey: 'K', desc: 'Soften bumps and cliffs.', create: (c) => new BrushTool(c, 'smooth', 'smooth') }),
  trees: reg({ id: 'trees', label: 'Plant trees', icon: 'trees', color: '#52d273', desc: 'Trees raise land value and reduce pollution.', create: (c) => new BrushTool(c, 'trees', 'trees') }),
};

const DISASTER_ICONS: Record<string, string> = { fire: 'fire', tornado: 'tornado', earthquake: 'quake', quake: 'quake', meteor: 'meteor', flood: 'flood', riot: 'riot', ufo: 'ufo', volcano: 'terrain' };

export function disasterSpecs(ctx: GameContext): ToolSpec[] {
  const kinds = ctx.mods.disasterKinds ?? [];
  return kinds.map((k) => {
    const icon = DISASTER_ICONS[k.id] ?? 'alert';
    return { id: 'disaster:' + k.id, label: k.name, icon, color: '#ff5d5d', desc: `Trigger a ${k.name.toLowerCase()} at the clicked spot.`, create: (c: GameContext) => new DisasterTool(c, k.id, k.name, icon) };
  });
}

/** hotkey cycles (pressing the key again moves to the next tool in the list) */
export const HOTKEY_CYCLES: Record<string, string[]> = {
  r: ['zone:1', 'zone:2', 'zone:3'],
  c: ['zone:4', 'zone:5', 'zone:6'],
  i: ['zone:8', 'zone:9', 'zone:7'],
  x: ['dezone'],
  t: ['net:2', 'net:3', 'net:1', 'net:4', 'net:5'],
  l: ['power'],
  u: ['subway'],
  b: ['bulldoze'],
  v: ['query'],
  k: ['terra:raise', 'terra:lower', 'terra:level', 'terra:smooth'],
};

/** panel hotkeys */
export const PANEL_HOTKEYS: Record<string, string> = {
  m: 'budget',
  g: 'graphs',
  j: 'stats',
  n: 'advisors',
  o: 'dataviews',
  y: 'ordinances',
};

export const CATEGORIES: ToolCategory[] = [
  {
    id: 'zones', label: 'Zones', icon: 'zones', color: '#52d273', hotkey: 'R C I',
    groups: () => [
      { label: 'Residential', icon: 'res', items: [Z.r1, Z.r2, Z.r3] },
      { label: 'Commercial', icon: 'com', items: [Z.c1, Z.c2, Z.c3] },
      { label: 'Industrial', icon: 'ind', items: [Z.i1, Z.i2, Z.i3] },
      { label: 'Other', icon: 'dezone', items: [Z.lf, Z.dz] },
    ],
  },
  {
    id: 'transport', label: 'Transport', icon: 'transport', color: '#9fb3c8', hotkey: 'T',
    groups: (ctx) => [
      { label: 'Roads', icon: 'road', items: [N.street, N.road, N.avenue, N.oneway, N.highway] },
      { label: 'Rail & transit', icon: 'train', items: [N.rail, N.subway] },
      plopGroup(ctx, 'Stations & terminals', 'bus', ['transport']),
    ],
  },
  {
    id: 'utilities', label: 'Utilities', icon: 'utilities', color: '#f5c542', hotkey: 'L',
    groups: (ctx) => [
      plopGroup(ctx, 'Power', 'power', ['power'], [N.power]),
      plopGroup(ctx, 'Water', 'water', ['water']),
      plopGroup(ctx, 'Garbage', 'garbage', ['garbage'], [Z.lf]),
    ],
  },
  {
    id: 'civic', label: 'Civic', icon: 'civic', color: '#5a8cff',
    groups: (ctx) => [
      plopGroup(ctx, 'Police', 'police', ['police']),
      plopGroup(ctx, 'Fire', 'fire', ['fire']),
      plopGroup(ctx, 'Health', 'health', ['health']),
      plopGroup(ctx, 'Education', 'education', ['education']),
      plopGroup(ctx, 'Civic', 'civic', ['civic']),
    ],
  },
  {
    id: 'parks', label: 'Parks', icon: 'park', color: '#52d273',
    groups: (ctx) => [plopGroup(ctx, 'Parks & recreation', 'park', ['park'])],
  },
  {
    id: 'landmarks', label: 'Rewards', icon: 'reward', color: '#e7b04a',
    groups: (ctx) => [plopGroup(ctx, 'Landmarks', 'landmark', ['landmark']), plopGroup(ctx, 'Rewards & business deals', 'reward', ['reward'])],
  },
  {
    id: 'terrain', label: 'Terrain', icon: 'terrain', color: '#c9a36a', hotkey: 'K',
    groups: (ctx) => {
      const g: ToolGroup[] = [
        { label: 'Terraform', icon: 'terrain', items: [T.raise, T.lower, T.level, T.smooth] },
        { label: 'Nature', icon: 'trees', items: [T.trees] },
      ];
      if ((ctx.state.config.disasters || ctx.sandbox()) && ctx.mods.triggerDisaster) g.push({ label: 'Disasters', icon: 'alert', items: disasterSpecs(ctx) });
      return g;
    },
  },
  { id: 'bulldoze', label: 'Bulldoze', icon: 'bulldoze', color: '#ff6a4d', hotkey: 'B', toolId: 'bulldoze' },
  { id: 'query', label: 'Query', icon: 'query', color: '#7cd4ff', hotkey: 'V', toolId: 'query' },
  { id: 'dataviews', label: 'Data', icon: 'layers', color: '#3fd6c6', hotkey: 'O', panelId: 'dataviews' },
];

/** find any tool spec by id (static, plop from catalog, disasters) */
export function findToolSpec(ctx: GameContext, id: string): ToolSpec | null {
  if (STATIC_TOOLS[id]) return STATIC_TOOLS[id];
  if (id.startsWith('plop:')) {
    const defId = id.slice(5);
    const d = allDefs().find((x) => x.id === defId);
    return d ? plopSpec(ctx, d) : null;
  }
  if (id.startsWith('disaster:')) return disasterSpecs(ctx).find((s) => s.id === id) ?? null;
  return null;
}

/** which category a tool belongs to (for toolbar highlighting) */
export function categoryOfTool(ctx: GameContext, id: string | null): string | null {
  if (!id) return null;
  for (const c of CATEGORIES) {
    if (c.toolId === id) return c.id;
    if (c.groups) {
      try {
        for (const g of c.groups(ctx)) if (g.items.some((s) => s.id === id)) return c.id;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}
