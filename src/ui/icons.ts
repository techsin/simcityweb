/**
 * Inline SVG icon set for the game UI. 24x24 grid, stroke = currentColor, round joins.
 * icon(name) returns an SVG string; iconEl(name) a span element.
 */

const P: Record<string, string> = {
  // ---------------------------------------------------------------- zones
  res: '<path d="M3.5 11.5 12 4.5l8.5 7"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  resMed: '<path d="M4 20V9l5-3 5 3v11"/><path d="M14 20V12l6 1.5V20"/><path d="M3 20h18"/><path d="M7 11h1M10 11h1M7 14.5h1M10 14.5h1M17 16h1"/>',
  resHigh: '<rect x="5" y="3" width="8" height="17" rx="1"/><path d="M13 9h5.5a.5.5 0 0 1 .5.5V20"/><path d="M3 20h18"/><path d="M8 7h2M8 10.5h2M8 14h2M16 13h1M16 16h1"/>',
  com: '<path d="M4.5 10.5V20h15v-9.5"/><path d="M3 10.5 5 4.5h14l2 6z"/><path d="M3 10.5c0 1.6 1.3 2.5 3 2.5s3-.9 3-2.5c0 1.6 1.3 2.5 3 2.5s3-.9 3-2.5c0 1.6 1.3 2.5 3 2.5s3-.9 3-2.5"/><path d="M10 20v-4.5h4V20"/>',
  comMed: '<path d="M4 20V8h10v12"/><path d="M14 11h6v9"/><path d="M3 20h18"/><path d="M4 11.5h10"/><path d="M7 14.5h1.5M10.5 14.5H12M7 17h1.5M10.5 17H12M16.5 14h1.5M16.5 17h1.5"/>',
  comHigh: '<path d="M8 21V6l4-3 4 3v15"/><path d="M4 21v-9h4M16 12h4v9"/><path d="M3 21h18"/><path d="M11 8h2M11 11h2M11 14h2M11 17h2"/>',
  ind: '<path d="M3 20h18"/><path d="M4 20v-9l5 3v-3l5 3v-3l5 3V20"/><path d="M17 11V4h2.5v8"/><path d="M7.5 17h1.5M11.5 17H13M15.5 17H17"/>',
  indMed: '<path d="M3 20h18"/><path d="M4 20V10l4 2.5V10l4 2.5V10l4 2.5V20"/><path d="M16 12.5V5h2.5v7.5M18.5 8H20v12"/><path d="M7 16.5h1.5M11 16.5h1.5"/>',
  indHigh: '<path d="M3 20h18"/><path d="M5 20v-8h14v8"/><path d="M5 12l3-5h8l3 5"/><path d="M9 16h6"/><circle cx="12" cy="9.5" r="1"/>',
  agri: '<path d="M12 21V9.5"/><path d="M12 9.5c-2.4-.5-3.5-2.4-3.5-4.8 2.4.4 3.5 2.3 3.5 4.8z"/><path d="M12 9.5c2.4-.5 3.5-2.4 3.5-4.8-2.4.4-3.5 2.3-3.5 4.8z"/><path d="M12 14c-2.4-.5-3.5-2.4-3.5-4.8 2.4.4 3.5 2.3 3.5 4.8zM12 14c2.4-.5 3.5-2.4 3.5-4.8-2.4.4-3.5 2.3-3.5 4.8z"/><path d="M12 18.5c-2.4-.5-3.5-2.4-3.5-4.8 2.4.4 3.5 2.3 3.5 4.8zM12 18.5c2.4-.5 3.5-2.4 3.5-4.8-2.4.4-3.5 2.3-3.5 4.8z"/>',
  landfill: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  dezone: '<path d="M16.5 3.8 20.2 7.5a1.5 1.5 0 0 1 0 2.1L11 18.8H6.8L3.8 15.8a1.5 1.5 0 0 1 0-2.1L14.4 3.8a1.5 1.5 0 0 1 2.1 0z"/><path d="M9 8.8l6.2 6.2"/><path d="M11 18.8h9"/>',
  zones: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.5"/>',

  // ---------------------------------------------------------------- transport
  street: '<path d="M8 3 6 21M16 3l2 18"/><path d="M12 5v2.5M12 11v2.5M12 17v2.5"/>',
  road: '<path d="M6.5 3 3.5 21M17.5 3l3 18"/><path d="M12 4v3M12 10.5v3M12 17v3"/>',
  avenue: '<path d="M5 3 2.5 21M19 3l2.5 18"/><path d="M12 3v18"/><path d="M8.3 5.5v2M8 11v2M7.7 16.5v2M15.7 5.5v2M16 11v2M16.3 16.5v2"/>',
  oneway: '<path d="M6.5 3 3.5 21M17.5 3l3 18"/><path d="M12 19V7"/><path d="M8.5 10.5 12 7l3.5 3.5"/>',
  highway: '<path d="M4.5 3 2 21M19.5 3 22 21"/><path d="M10.5 3 9.8 21M13.5 3l.7 18" stroke-dasharray="2.2 2.6"/><path d="M12 3v18" stroke-opacity=".35"/>',
  rail: '<path d="M8 2.5 6 21.5M16 2.5l2 19"/><path d="M5.5 6h13M5.2 10h13.6M4.8 14h14.4M4.4 18h15.2"/>',
  subway: '<rect x="5" y="3.5" width="14" height="14" rx="3.5"/><path d="M5 11h14"/><path d="M8.5 14.5h.01M15.5 14.5h.01"/><path d="M8 17.5 6 20.5M16 17.5l2 3"/>',
  power: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
  pylon: '<path d="M12 3 8 21M12 3l4 18"/><path d="M5 7h14M6.5 11h11"/><path d="M9.8 13.5 14.8 18M14.2 13.5 9.2 18"/>',
  bus: '<rect x="4.5" y="3.5" width="15" height="15" rx="2.5"/><path d="M4.5 11.5h15"/><path d="M8 15h.01M16 15h.01"/><path d="M7 18.5V21M17 18.5V21"/>',
  train: '<rect x="5.5" y="3" width="13" height="14.5" rx="3"/><path d="M5.5 10.5h13"/><path d="M9 14h.01M15 14h.01"/><path d="M8.5 17.5 6.5 21M15.5 17.5l2 3.5"/>',
  plane: '<path d="M21 15.5v-2l-8-5V4a1.5 1.5 0 0 0-3 0v4.5l-8 5v2l8-2.5v4.5l-2.5 2v1.5l4-1 4 1V19l-2.5-2v-4.5z"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14"/><path d="M8 11h8"/><path d="M4 13a8 8 0 0 0 16 0"/>',
  parking: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 16.5v-9h3.2a2.6 2.6 0 0 1 0 5.2H10"/>',
  transport: '<path d="M6 3 3.5 21M18 3l2.5 18"/><path d="M12 4v3M12 10.5v3M12 17v3"/>',

  // ---------------------------------------------------------------- utilities
  utilities: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
  water: '<path d="M12 3.2c3.7 4.3 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.3-6.3 6-10.6z"/><path d="M9.2 14.5a3 3 0 0 0 2.8 2.8"/>',
  waterTower: '<path d="M6 4h12v5.5a6 6 0 0 1-12 0z"/><path d="M8 14 6.5 21M16 14l1.5 7M12 15.5V21M7.3 18h9.4"/>',
  garbage: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  recycle: '<path d="M7.2 19.5H5.1a1.8 1.8 0 0 1-1.6-2.7l1.6-2.8"/><path d="M11.5 19.5h7.4a1.8 1.8 0 0 0 1.6-2.7l-1.5-2.6"/><path d="m9.8 17.2-2.3 2.3 2.3 2.3"/><path d="M9.3 6.8 10.4 5a1.8 1.8 0 0 1 3.1 0l3.7 6.4"/><path d="m17.8 8.5-.6 3.1-3.1-.8"/><path d="M4.2 13.9 7.2 8.7"/><path d="m3.8 9.9 3.4-1.2.8 3.1"/>',
  factory: '<path d="M3 20h18"/><path d="M4 20v-9l5 3v-3l5 3v-3l5 3V20"/><path d="M17 11V4h2.5v8"/>',
  wind: '<path d="M12 12v9.5"/><circle cx="12" cy="10" r="1.6"/><path d="M12 8.4 11 2.5M13.4 10.8l5.4 2.6M10.6 10.8l-5 3.2"/>',
  solar: '<path d="M4 16 6.5 8h11L20 16z"/><path d="M9.5 8 8.5 16M14.5 8l1 8M5.3 12h13.4"/><path d="M12 16v4.5M8.5 20.5h7"/>',

  // ---------------------------------------------------------------- civic
  civic: '<path d="M3 20.5h18"/><path d="M4 9h16"/><path d="M12 3.5 20 9H4z"/><path d="M6 11.5v6.5M10 11.5v6.5M14 11.5v6.5M18 11.5v6.5"/><path d="M4.5 18h15"/>',
  police: '<path d="M12 2.8 19.5 6v5.5c0 4.7-3.2 8.2-7.5 9.7-4.3-1.5-7.5-5-7.5-9.7V6z"/><path d="m12 8.2 1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z"/>',
  fire: '<path d="M12 21.2c-3.9 0-6.8-2.7-6.8-6.4 0-3.5 2.6-5.3 3.7-8.8 1.4 1.4 2 2.7 2.1 4.2C12.6 8.3 13.5 5.2 14.6 3c2.6 2.9 4.2 6.8 4.2 11.2 0 4-3 7-6.8 7z"/><path d="M12 21.2c-1.6 0-2.8-1.2-2.8-2.8 0-1.8 1.4-2.6 2-4.2 1.9 1.1 3.6 2.4 3.6 4.4 0 1.5-1.2 2.6-2.8 2.6z"/>',
  health: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 7.5v9M7.5 12h9"/>',
  education: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.8c0 1.3 2.5 3 5.5 3s5.5-1.7 5.5-3V11"/><path d="M21.5 9v5.5"/>',
  landmark: '<path d="M12 2.5 13.2 6h-2.4z"/><path d="M10.8 6h2.4l1.3 12.5h-5z"/><path d="M6.5 21.5h11l-1.5-3h-8z"/>',
  reward: '<path d="M7.5 3.5h9v5.5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 5.5H4.5a3 3 0 0 0 3 4.3M16.5 5.5h3a3 3 0 0 1-3 4.3"/><path d="M12 13.5v3.5"/><path d="M8 21h8l-1-4H9z"/>',
  trophy: '<path d="M7.5 3.5h9v5.5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 5.5H4.5a3 3 0 0 0 3 4.3M16.5 5.5h3a3 3 0 0 1-3 4.3"/><path d="M12 13.5v3.5"/><path d="M8 21h8l-1-4H9z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',

  // ---------------------------------------------------------------- parks
  park: '<path d="M12 21.5v-5"/><path d="M12 16.5c-3.9 0-6.5-2.3-6.5-5.4 0-2.2 1.3-3.3 2.2-3.7C8 4.9 9.9 3 12 3s4 1.9 4.3 4.4c.9.4 2.2 1.5 2.2 3.7 0 3.1-2.6 5.4-6.5 5.4z"/><path d="M12 13.5l-2.2-2M12 12l2.4-2.4"/><path d="M6 21.5h12"/>',
  trees: '<path d="M8 21.5v-3.5"/><path d="M8 3.5 3.5 12h2.2L3 18h10l-2.7-6h2.2z"/><path d="M17 21.5V19"/><path d="M17 9l-3.2 5.5h1.5L13.5 19h7l-1.8-4.5h1.5z"/>',

  // ---------------------------------------------------------------- terrain
  terrain: '<path d="M2.5 19.5 9 8.5l3.8 6.2L15.5 11l6 8.5z"/><path d="m7 12 2 1.3 1.7-1.2"/>',
  raise: '<path d="M2.5 20.5 8.5 11l4.5 7 2.5-3.6 6 6.1z"/><path d="M17.5 11V3"/><path d="m14.5 6 3-3 3 3"/>',
  lower: '<path d="M2.5 20.5 8.5 11l4.5 7 2.5-3.6 6 6.1z"/><path d="M17.5 3v8"/><path d="m14.5 8 3 3 3-3"/>',
  level: '<path d="M3 16.5h18"/><path d="M3 20.5h18"/><path d="M6 12.5l3-4 3 2.5 3-4.5 3 6"/>',
  smooth: '<path d="M2.5 16c3-5 5.5-5 8 0s5.5 5 8 0l3-2"/><path d="M3 20.5h18"/>',
  brush: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 2.5"/><circle cx="12" cy="12" r="1.5"/>',

  // ---------------------------------------------------------------- tools
  bulldoze: '<path d="M2.5 18.5h11"/><rect x="3.5" y="14.5" width="10" height="4" rx="2"/><path d="M5 14.5V10h4.5l2 4.5"/><path d="M6.5 10V6.5h2.5V10"/><path d="M13.5 12.5h2.5l2-3 3 1.5-1.5 7.5h-3.5l.5-3h-3"/>',
  query: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="M10.5 8v.01M10.5 10.5V13.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5.5"/>',
  layers: '<path d="m12 3 9.5 5-9.5 5-9.5-5z"/><path d="m2.5 12.5 9.5 5 9.5-5"/><path d="m2.5 17 9.5 5 9.5-5" stroke-opacity=".6"/>',
  disaster: '<path d="M4.5 5h15M6.5 9h11M8 13h8M10 17h4M11.5 21h1"/>',
  tornado: '<path d="M3.5 4.5h17M5.5 8.5h13M7.5 12.5h8.5M9.5 16.5h5M11 20.5h2"/>',
  quake: '<path d="M2.5 12h3.5l2-5 3 10 3-13 2.5 11 1.5-3h3.5"/>',
  meteor: '<circle cx="15.5" cy="15.5" r="4.5"/><path d="M3 3l8 8M6.5 3l6 6M3 6.5l6 6"/>',
  flood: '<path d="M2.5 9c2 1.3 3.5 1.3 5 0s3.5-1.3 5 0 3.5 1.3 5 0 3-1.3 4 0"/><path d="M2.5 14c2 1.3 3.5 1.3 5 0s3.5-1.3 5 0 3.5 1.3 5 0 3-1.3 4 0"/><path d="M2.5 19c2 1.3 3.5 1.3 5 0s3.5-1.3 5 0 3.5 1.3 5 0 3-1.3 4 0"/>',
  riot: '<circle cx="8" cy="7" r="2.5"/><circle cx="16" cy="7" r="2.5"/><path d="M3.5 19v-2.5a4 4 0 0 1 8 0V19M12.5 19v-2.5a4 4 0 0 1 8 0V19"/>',
  ufo: '<ellipse cx="12" cy="12.5" rx="9.5" ry="3.5"/><path d="M7.5 10.2a4.5 4.5 0 0 1 9 0"/><path d="m7 16.5-2 4M17 16.5l2 4M12 16v4.5"/>',

  // ---------------------------------------------------------------- panels / HUD
  budget: '<circle cx="12" cy="12" r="9"/><path d="M15.2 8.8c-.5-1-1.7-1.6-3.2-1.6-1.9 0-3.2 1-3.2 2.4 0 3.3 6.6 1.7 6.6 5 0 1.4-1.4 2.4-3.4 2.4-1.6 0-2.9-.7-3.4-1.8"/><path d="M12 5.2v1.9M12 17.1v1.7"/>',
  graphs: '<path d="M3.5 3.5v17h17"/><path d="m7 15 4-4.5 3 3L19.5 7"/><path d="M16 7h3.5v3.5"/>',
  stats: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3.5" height="7" rx=".8"/><rect x="10.3" y="6" width="3.5" height="12" rx=".8"/><rect x="15.6" y="13.5" width="3.5" height="4.5" rx=".8"/>',
  advisors: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5v-1.5a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2a5 5 0 0 1 3 4.8v1.5"/>',
  ordinances: '<path d="M6 3.5h9.5l3.5 3.5v13.5H6z"/><path d="M15 3.5V7.5h4"/><path d="M9 11h7M9 14h7M9 17h4.5"/>',
  news: '<path d="M4 5.5h13v13a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v9.5a2 2 0 0 1-4 0"/><path d="M7.5 9h6M7.5 12.5h6M7.5 16h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.5-2.7 4"/><path d="M12 17.3v.01"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 9.5h.01M9.3 9.5h.01M12.6 9.5h.01M15.9 9.5h.01M18 9.5h.01M6 12.5h.01M18 12.5h.01M9 15h6"/>',
  map: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>',
  save: '<path d="M5 3.5h11l3.5 3.5v11.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2z"/><path d="M8 3.5v5h7v-5"/><rect x="7.5" y="13" width="9" height="7.5" rx="1"/>',
  exit: '<path d="M14 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4"/><path d="M9.5 16.5 5 12l4.5-4.5"/><path d="M5 12h10"/>',
  region: '<path d="M3 7.5 9 4.5l6 3 6-3v12l-6 3-6-3-6 3z"/><path d="M9 4.5v12M15 7.5v12"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
  chevUp: '<path d="m6 15 6-6 6 6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevRight: '<path d="m9 6 6 6-6 6"/>',
  chevLeft: '<path d="m15 6-6 6 6 6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dot: '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',

  // ---------------------------------------------------------------- time / sim
  pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.7" y="5" width="3.8" height="14" rx="1" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" fill="currentColor" stroke="none"/>',
  fast: '<path d="M3.5 6.3v11.4a.7.7 0 0 0 1.1.6L12 13v4.7a.7.7 0 0 0 1.1.6l8.2-5.7a.7.7 0 0 0 0-1.2L13.1 5.7a.7.7 0 0 0-1.1.6V11L4.6 5.7a.7.7 0 0 0-1.1.6z" fill="currentColor" stroke="none"/>',
  ultra: '<path d="M1.5 7v10a.6.6 0 0 0 1 .5L8 13.4v3.6a.6.6 0 0 0 1 .5l5.2-3.9v3.4a.6.6 0 0 0 1 .5l6.8-5a.6.6 0 0 0 0-1l-6.8-5a.6.6 0 0 0-1 .5v3.4L9 6.5A.6.6 0 0 0 8 7v3.6L2.5 6.5a.6.6 0 0 0-1 .5z" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  sunrise: '<path d="M12 3v5M8.5 5.5 12 2l3.5 3.5" stroke-opacity="0"/><path d="M7 16a5 5 0 0 1 10 0"/><path d="M3 19.5h18M12 6v3M4.9 9.9l1.4 1.4M19.1 9.9l-1.4 1.4M2.5 16h2M19.5 16h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',

  // ---------------------------------------------------------------- stats
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5v-1.5a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2a5 5 0 0 1 3 4.8v1.5"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v5M18 9.5v5"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14c.9 1.4 2.3 2.2 4 2.2s3.1-.8 4-2.2"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  meh: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15h7"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  frown: '<circle cx="12" cy="12" r="9"/><path d="M8 16.2c.9-1.4 2.3-2.2 4-2.2s3.1.8 4 2.2"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  alert: '<path d="M10.3 4.1 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17v.01"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  heart: '<path d="M12 20.5s-8-4.7-8-10.5a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8c0 5.8-8 10.5-8 10.5z"/>',
  leaf: '<path d="M5 19c0-8.5 5.5-14 15-14 0 9.5-5.5 15-14 15"/><path d="M5 19 13 11"/>',
  smog: '<path d="M6.5 16.5a4 4 0 1 1 1.2-7.8 5.5 5.5 0 0 1 10.3 2.3 3 3 0 0 1-.5 5.5z"/><path d="M4 20h9M15.5 20H20"/>',
  car: '<path d="M4.5 16.5V12l2-5h11l2 5v4.5"/><path d="M3.5 12h17"/><rect x="3.5" y="12" width="17" height="4.5" rx="1"/><path d="M6 16.5V19M18 16.5V19"/><path d="M7 14.2h.01M17 14.2h.01"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M9.5 21l2.5-6.5 3 3V21"/><path d="M8 11.5l2.5-4h3.5l2 3.5 2.5 1"/><path d="M12 14.5 13 7.5"/>',
  briefcase: '<rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M8.5 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2"/><path d="M3 13h18"/>',
  home: '<path d="M3.5 11.5 12 4.5l8.5 7"/><path d="M5.5 10v9.5h13V10"/>',
  crime: '<path d="M12 2.8 19.5 6v5.5c0 4.7-3.2 8.2-7.5 9.7-4.3-1.5-7.5-5-7.5-9.7V6z"/><path d="M12 8v4.5M12 15.5v.01"/>',
  noise: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  landValue: '<path d="M3.5 11.5 12 4.5l8.5 7"/><path d="M5.5 10v9.5h13V10"/><path d="M12 10.5v6.5M13.8 11.8c-.3-.6-1-.9-1.8-.9-1 0-1.8.6-1.8 1.4 0 1.9 3.7 1 3.7 2.8 0 .8-.8 1.4-1.9 1.4-.9 0-1.6-.4-1.9-1"/>',
  desire: '<path d="M12 20.5s-8-4.7-8-10.5a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8c0 5.8-8 10.5-8 10.5z"/>',
  none: '<circle cx="12" cy="12" r="8.5"/><path d="M6 18 18 6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  historic: '<path d="M4 21h16"/><path d="M5 18h14"/><path d="M6 18V9M10 18V9M14 18V9M18 18V9"/><path d="M4 9h16l-8-5.5z"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17"/>',
};

export type IconName = keyof typeof P | string;

export function icon(name: IconName, size = 20, extraClass = ''): string {
  const body = P[name] ?? P.dot;
  return `<svg class="ico ${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function iconEl(name: IconName, size = 20, extraClass = ''): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'ico-wrap';
  s.innerHTML = icon(name, size, extraClass);
  return s;
}

export function hasIcon(name: string): boolean {
  return name in P;
}
