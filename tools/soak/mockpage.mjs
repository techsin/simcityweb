// The selftest's stand-in for the game page: no browser, and never part of a real run.
//
// Its shape comes from one place, the source. pageShape() reads the member names that the App (src/main.ts), its city
// record, CityScene, Simulation and CityState declare, with the bundler's own parser. MockPage gives a stand-in value
// only to a name the source still declares, so a member the app drops is gone from this page too and the driver's read
// of it fails here as it does in a browser. T082's soak stopped 68 s in on window.__metropolis.city.state, which W0.6
// had removed, while the selftest's hand-written page still passed 10 of 10.
//
// pageReads() is the static half: every path the tool's own page code reads off window.__metropolis, so the reads on
// steps that the selftest does not run (the canvas work) are checked against the source as well.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { PANEL_IDS } from './driver.mjs';

/** rolldown's parser (oxc): the soak bundles its helpers with rolldown already, so this adds no dependency */
export async function loadParser() {
  return (await import('rolldown/parseAst')).parseAst;
}

/** What each step of a path off window.__metropolis is, and where the source declares its members. */
export const OWNERS = {
  app: { path: [], file: 'src/main.ts', class: 'App' },
  city: { path: ['city'], file: 'src/main.ts', class: 'App', record: 'city' },
  scene: { path: ['city', 'scene'], file: 'src/game/CityScene.ts', class: 'CityScene' },
  sim: { path: ['city', 'scene', 'sim'], file: 'src/sim/Simulation.ts', class: 'Simulation' },
  state: { path: ['city', 'scene', 'sim', 'state'], file: 'src/sim/CityState.ts', class: 'CityState' },
};

const stale = what => { throw new Error(`${what}: pageShape() in tools/soak/mockpage.mjs has to follow the source`); };
const declarations = program => program.body.map(node => node.declaration ?? node);
/** a member's name; null for a computed key or a #private one (the page cannot read those) */
const memberName = member => member.computed || member.key?.type !== 'Identifier' ? null : member.key.name;

/** the instance members a class declares: fields, accessors, methods and constructor parameter properties */
function classMembers(cls) {
  const names = new Set();
  for (const member of cls.body.body) {
    if (member.static) continue;
    if (member.kind === 'constructor') {
      for (const p of member.value.params) if (p.type === 'TSParameterProperty') names.add((p.parameter.left ?? p.parameter).name);
    } else if (memberName(member)) names.add(memberName(member));
  }
  return names;
}

/** the members of an object-typed field: its type literal, also behind `| null` or a type or interface named in the file */
function recordMembers(program, cls, field, file) {
  const named = name => {
    const d = declarations(program).find(node => node.id?.name === name);
    return d?.type === 'TSInterfaceDeclaration' ? d.body.body : d?.type === 'TSTypeAliasDeclaration' ? members(d.typeAnnotation) : null;
  };
  const members = type => type?.type === 'TSTypeLiteral' ? type.members
    : type?.type === 'TSUnionType' ? type.types.map(members).find(Boolean) ?? null
    : type?.type === 'TSTypeReference' ? named(type.typeName.name) : null;
  const found = members(cls.body.body.find(member => memberName(member) === field)?.typeAnnotation?.typeAnnotation);
  return new Set((found ?? stale(`${file} no longer types ${cls.id.name}.${field} as a record`)).map(memberName).filter(Boolean));
}

/** The member names the real page objects declare, by owner (see OWNERS): { app, city, scene, sim, state }, each a Set. */
export function pageShape(parseAst, root) {
  const programs = new Map();
  const program = file => programs.get(file) ?? programs.set(file, parseAst(readFileSync(join(root, file), 'utf8'), { lang: 'ts' }, file)).get(file);
  const shape = {};
  for (const [owner, o] of Object.entries(OWNERS)) {
    const cls = declarations(program(o.file)).find(node => node.type === 'ClassDeclaration' && node.id?.name === o.class) ?? stale(`${o.file} declares no class ${o.class}`);
    shape[owner] = o.record ? recordMembers(program(o.file), cls, o.record, o.file) : classMembers(cls);
  }
  return shape;
}

const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);

/**
 * Every property path the code reads off window.__metropolis, followed through its local aliases:
 * `const c = window.__metropolis.city; c.lastSave` gives ['city', 'lastSave']. A path ends at a call or a computed key.
 * Followed: const / let declarations, with destructuring, and optional chains. Not followed: a value that reaches a name
 * any other way (an assignment, a conditional, a function argument); the page code here has none.
 */
export function pageReads(parseAst, code, file) {
  const paths = [];
  const lookup = (scope, name) => {
    for (let s = scope; s; s = s.parent) if (s.names.has(name)) return s.names.get(name);
    return null;
  };
  const pathOf = (node, scope) => {
    while (node?.type === 'ChainExpression' || node?.type === 'ParenthesizedExpression') node = node.expression;
    if (node?.type === 'Identifier') return lookup(scope, node.name);
    if (node?.type !== 'MemberExpression' || node.computed) return null;
    if (node.object.type === 'Identifier' && node.object.name === 'window' && node.property.name === '__metropolis') return [];
    const base = pathOf(node.object, scope);
    return base && [...base, node.property.name];
  };
  /** the names a declaration or a parameter introduces; `path` is what the declared value reads (null: not the page) */
  const bind = (pattern, scope, path) => {
    if (pattern?.type === 'Identifier') scope.names.set(pattern.name, path);
    else if (pattern?.type === 'ObjectPattern') for (const p of pattern.properties) {
      // `const { city } = window.__metropolis` reads city as well
      const member = path && p.type === 'Property' && !p.computed && p.key.type === 'Identifier' ? [...path, p.key.name] : null;
      if (member) paths.push(member);
      bind(p.value ?? p.argument, scope, member);
    } else if (pattern?.type === 'ArrayPattern') for (const e of pattern.elements) bind(e, scope, null);
    else if (pattern?.type === 'AssignmentPattern') bind(pattern.left, scope, path);
    else if (pattern?.type === 'RestElement') bind(pattern.argument, scope, null);
  };
  const walk = (node, scope) => {
    if (Array.isArray(node)) { for (const n of node) walk(n, scope); return; }
    if (!node || typeof node.type !== 'string') return;
    if (FUNCTIONS.has(node.type)) {
      // a parameter hides an outer alias of the same name
      const inner = { names: new Map(), parent: scope };
      for (const p of node.params) bind(p, inner, null);
      walk(node.body, inner);
      return;
    }
    if (node.type === 'VariableDeclarator') {
      walk(node.init, scope);
      bind(node.id, scope, pathOf(node.init, scope));
      return;
    }
    if (node.type === 'MemberExpression') {
      const path = pathOf(node, scope);
      // (its object chain is part of this path: no second entry for a prefix)
      if (path) { if (path.length) paths.push(path); return; }
    }
    for (const key in node) if (key !== 'type') walk(node[key], scope);
  };
  walk(parseAst(code, {}, file), { names: new Map(), parent: null });
  return paths;
}

/** The members those paths read, by owner, and the reads that name a member the source does not declare. */
export function checkReads(shape, paths) {
  const read = Object.fromEntries(Object.keys(OWNERS).map(owner => [owner, new Set()]));
  const missing = new Set();
  for (const path of paths) for (const [owner, o] of Object.entries(OWNERS)) {
    if (path.length <= o.path.length || o.path.some((name, i) => path[i] !== name)) continue;
    const member = path[o.path.length];
    read[owner].add(member);
    if (!shape[owner].has(member)) missing.add(['window.__metropolis', ...o.path, member].join('.'));
  }
  return { read, missing: [...missing] };
}

/** a control of the stand-in DOM: as much of an element as the driver's targetPoint() looks at */
class Control {
  constructor(selector, text, rect, shown, click) { Object.assign(this, { selector, textContent: text, rect, shown, click, disabled: false, parentElement: null }); }
  getBoundingClientRect() { const { left, top, width, height } = this.rect; return { left, top, width, height, right: left + width, bottom: top + height }; }
  contains(other) { return other === this; }
  querySelector() { return null; }
  covers(x, y) { return x >= this.rect.left && x < this.rect.left + this.rect.width && y >= this.rect.top && y < this.rect.top + this.rect.height; }
}

/**
 * The page as the Driver sees it: evaluate() runs a function's source in another realm and hands back plain values, as
 * Playwright does, and mouse / keyboard act on a small model of the game: the region screen with its one city, the
 * city with its speed buttons and pause menu, a save that takes a moment, an exit and a load.
 * `shape` is pageShape()'s result, or a copy with a member taken out to see what its removal does.
 */
export class MockPage {
  constructor(shape, { hostKind = 'local', globals = {} } = {}) {
    this.shape = shape;
    this.hostKind = hostKind;
    /** the names given a stand-in, by owner: the selftest holds them against what the tool reads */
    this.standIns = Object.fromEntries(Object.keys(OWNERS).map(owner => [owner, new Set()]));
    this.input = [];
    this.deferred = [];
    this.compiled = new Map();
    this.game = { inCity: false, speed: 0, resumeSpeed: 1, day: 100, lastSave: 1_000_000, saving: 0, saves: 0, menu: false, selected: false, buildings: new Map([[1, { id: 1 }], [2, { id: 2 }]]) };
    const g = this.game;
    this.app = this.shaped('app', { city: null, busy: false, regionScreen: {} });
    const hud = () => g.inCity && !g.menu, menu = () => g.inCity && g.menu;
    this.controls = [];
    for (const [selector, text, shown, click] of [
      ['.rc-item', 'Soak City 1.2M · Large', () => !g.inCity, () => { g.selected = true; }],
      ['.tc-actions button', 'Play', () => !g.inCity && g.selected, () => this.load()],
      ['.tc-actions button', 'Delete city', () => !g.inCity && g.selected, () => {}],
      ['.speed button[title="Pause (Space)"]', '', hud, () => { g.speed = 0; }],
      ['.hud-top button[title="Menu (Esc)"]', '', hud, () => this.openMenu()],
      ['.pause-menu button', 'Resume Esc', menu, () => this.closeMenu()],
      ['.pause-menu button', 'Save city Ctrl S', menu, () => this.save()],
      ['.pause-menu button', 'Save & exit to region', menu, () => this.exit()],
    ]) this.controls.push(new Control(selector, text, { left: 20 + 80 * this.controls.length, top: 20, width: 60, height: 30 }, shown, click));
    // (a selector with nothing to match here; any other one is a mistake in the selftest or a new read to stand in for)
    const selectors = new Set([...this.controls.map(c => c.selector), '.loading-veil, .loading']);
    const document = {
      documentElement: {},
      querySelectorAll: selector => selectors.has(selector) ? this.controls.filter(c => c.selector === selector && c.shown())
        : (() => { throw new Error(`the mock page has no stand-in for the selector ${selector}`); })(),
      querySelector: selector => document.querySelectorAll(selector)[0] ?? null,
      elementFromPoint: (x, y) => this.controls.findLast(c => c.shown() && c.covers(x, y)) ?? null,
    };
    this.context = vm.createContext({
      ...globals, document, innerHeight: 1080, __ready: true, __metropolis: this.app,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', overflowY: 'visible' }),
    });
    this.context.window = this.context;
    this.mouse = {
      click: async (x, y) => { this.input.push(`click ${x},${y}`); document.elementFromPoint(x, y)?.click(); },
      move: async (x, y) => { this.input.push(`move ${x},${y}`); },
    };
    this.keyboard = { press: async key => { this.input.push(`key ${key}`); this.key(key); } };
  }

  /** An object with every name its owner declares in the source; a stand-in is kept only under a declared name. */
  shaped(owner, standIns) {
    const declared = this.shape[owner], object = {};
    for (const name of declared) object[name] = undefined;
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(standIns))) {
      this.standIns[owner].add(name);
      if (declared.has(name)) Object.defineProperty(object, name, descriptor);
    }
    return object;
  }
  /** (a member the source dropped stays dropped) */
  set(object, name, value) { if (name in object) object[name] = value; }

  /** a city the App has entered: a saved city resumes at normal speed */
  enterCity() {
    const g = this.game;
    Object.assign(g, { inCity: true, menu: false, speed: 1 });
    const state = this.shaped('state', { size: 256, get day() { return g.day; }, stats: { population: 1_200_000 }, buildings: g.buildings, config: { regionId: 'soak', tileX: 3, tileZ: 4 } });
    const sim = this.shaped('sim', { state, get speed() { return g.speed; } });
    const panels = new Map(PANEL_IDS.map(id => [id, { el: null, isOpen: false }]));
    const scene = this.shaped('scene', {
      sim, host: { kind: this.hostKind }, settings: { quality: 'ultra' }, degraded: { world: false, objects: false, actions: false },
      panels: { panels, order: [], get: id => panels.get(id), isOpen: id => !!panels.get(id)?.isOpen },
      pause: { get isOpen() { return g.menu; } }, toolbar: { flyoutOpen: false }, tools: { activeId: null }, ctx: { overlay: 0 },
      worldView: { isNull: false, renderer: {}, camera: {}, controls: { distance: 500, target: { x: 0, y: 0, z: 0 } } }, canvas: {}, objects: {},
      simReady: true, get saving() { return g.saving ? {} : null; },
    });
    this.set(this.app, 'city', this.shaped('city', { scene, tile: { key: '3,4' }, host: scene.host, get lastSave() { return g.lastSave; }, get saving() { return g.saving; }, saveFailed: false }));
    this.set(this.app, 'regionScreen', null);
  }
  /** back on the region screen, with the city's tile selected as App.exitCity leaves it */
  leaveCity() {
    Object.assign(this.game, { inCity: false, menu: false, selected: true });
    this.set(this.app, 'city', null);
    this.set(this.app, 'regionScreen', {});
  }

  /** `fn` runs once the page has been read `reads` more times: a save or a load is not done at the driver's first look */
  later(reads, fn) { this.deferred.push({ reads, fn }); }
  save(then = () => {}) {
    const g = this.game;
    if (g.saving) return;
    g.saving = 1;
    this.later(2, () => { g.lastSave += 60_000; g.saving = 0; g.saves++; then(); });
  }
  load() {
    this.set(this.app, 'busy', true);
    this.later(2, () => { this.enterCity(); this.set(this.app, 'busy', false); });
  }
  exit() {
    Object.assign(this.game, { menu: false, speed: 0 });
    this.save(() => this.leaveCity());
  }
  openMenu() { const g = this.game; Object.assign(g, { menu: true, resumeSpeed: g.speed, speed: 0 }); }
  closeMenu() { const g = this.game; Object.assign(g, { menu: false, speed: g.resumeSpeed }); }
  key(key) {
    const g = this.game;
    if (!g.inCity) return;
    if (key === 'Escape') return g.menu ? this.closeMenu() : this.openMenu();
    if (g.menu) return; // the pause menu takes the keys
    if (key === 'Control+s') this.save();
    else if (/^[123]$/.test(key)) g.speed = Number(key);
  }

  /** the function as the page has it: its source, compiled in the page's realm, so nothing of the caller's closure */
  inPage(fn) {
    const source = `(${fn})`;
    return this.compiled.get(source) ?? this.compiled.set(source, vm.runInContext(source, this.context)).get(source);
  }
  /** an init script (installTelemetry) or a probe's page function, where no plain value has to come back */
  call(fn) { return this.inPage(fn)(); }
  /** page.evaluate: plain values in and out; a save or a load in progress moves on by one read */
  async evaluate(fn, arg) {
    for (const d of this.deferred.splice(0)) if (--d.reads > 0) this.deferred.push(d); else d.fn();
    const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    try { return plain(await this.inPage(fn)(plain(arg))); }
    catch (error) { throw new Error(`page.evaluate: ${error?.stack ?? error}`); }
  }
}
