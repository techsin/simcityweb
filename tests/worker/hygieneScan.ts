/** S1's source checks. Parse code so comments, strings and multiline calls cannot fool the scan. */
import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { parseSync } from 'rolldown/utils';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const local = (path: string): string => relative(ROOT, path).replace(/\\/g, '/');

export function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const path = `${dir}/${e.name}`;
    return e.isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(e.name) ? [path] : [];
  }).sort();
}

interface Node { type: string; start: number; end: number; [key: string]: unknown }
export interface Violation { file: string; line: number; rule: string; code: string }

function node(v: unknown): Node | undefined {
  return v !== null && typeof v === 'object' && 'type' in v && typeof v.type === 'string' ? v as Node : undefined;
}

function children(n: Node): Node[] {
  const out: Node[] = [];
  for (const [key, value] of Object.entries(n)) {
    if (key === 'parent' || key === 'comments') continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      const c = node(v);
      if (c) out.push(c);
    }
  }
  return out;
}

function walk(n: Node, visit: (n: Node) => void): void {
  visit(n);
  for (const c of children(n)) walk(c, visit);
}

function unwrap(value: unknown): Node | undefined {
  let n = node(value);
  while (n && ['ChainExpression', 'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(n.type)) n = node(n.expression);
  return n;
}

function name(value: unknown): string | undefined {
  const n = unwrap(value);
  if (!n) return;
  if (n.type === 'Identifier') return n.name as string;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'MemberExpression') return name(n.property);
}

function member(value: unknown): Node | undefined {
  const n = unwrap(value);
  return n?.type === 'MemberExpression' ? n : undefined;
}

export type ScanRule = 'isolate' | 'speed' | 'liveSlowdown' | 'systems' | 'replica';

export function scan(file: string, source: string, rule: ScanRule = 'isolate'): Violation[] {
  const parsed = parseSync(file, source, { sourceType: 'module' });
  if (parsed.errors.length) throw new Error(`${file}: ${JSON.stringify(parsed.errors)}`);
  const tree = parsed.program as unknown as Node;
  const out: Violation[] = [];
  const report = (n: Node, why: string) => out.push({
    file, line: source.slice(0, n.start).split('\n').length, rule: why, code: source.slice(n.start, n.end),
  });

  if (rule === 'replica') {
    replicaWrites(tree, report);
    return out;
  }

  walk(tree, (n) => {
    const call = n.type === 'CallExpression';
    const callee = unwrap(n.callee);
    const method = member(callee);
    const called = name(callee);
    if (rule === 'isolate') {
      const args = call ? n.arguments as Node[] : [];
      if (call && ['postMessage', 'structuredClone'].includes(called ?? '') &&
        (args.length > 1 || args.some((a) => a.type === 'SpreadElement'))) report(n, 'transfer list');
      if (n.type === 'Property' && name(n.key) === 'transferList') report(n, 'transfer list');
      if (call && method && /^transfer(?:ToFixedLength)?$/.test(called ?? '')) report(n, 'ArrayBuffer transfer');
      if (n.type === 'Identifier' && ['Blob', 'CompressionStream', 'DecompressionStream'].includes(name(n)!)) report(n, 'web body / stream');
      if (n.type === 'NewExpression' && called === 'Response') report(n, 'Response body');
      if (call && method && ['stream', 'arrayBuffer', 'text'].includes(called ?? '')) report(n, 'web body / stream');
      // The loader's allocator may contain the operation; the runtime suite forbids it even at init.
      if (call && method && called === 'grow' && file !== 'src/wasm/heap.ts') report(n, 'memory.grow');
      if (call && method && called === 'reserve' && /heap/i.test(name(method.object) ?? '') && file !== 'src/wasm/simWasm.ts') report(n, 'wasm heap reserve');
    }
    if (rule === 'systems' && call && ['emergencyOf', 'getSystem'].includes(called ?? '')) report(n, 'system reach-in');

    const target = n.type === 'AssignmentExpression' ? n.left : n.type === 'UpdateExpression' ? n.argument : undefined;
    if ((rule === 'speed' || rule === 'liveSlowdown') && member(target) && name(target) === rule) report(n, `${rule} writer`);
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ W0.6 replica writes
// Conservative replica aliases (`const st = ctx.state`, `const b = st.budget`, building lookups, the loop variable of
// `for (const b of st.buildings.values())`), resolved through the file's real scopes: the loop counter `z` of one
// function is not the alias `z` of another, and a parameter shadows an outer alias.
type Scope = Map<string, { replica: boolean; init?: Node; chain: Scope[] }>;
const SCOPE_NODES = new Set(['Program', 'BlockStatement', 'StaticBlock', 'SwitchStatement', 'ForStatement', 'ForInStatement',
  'ForOfStatement', 'CatchClause', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
/** calls that return a copy or a plain value, never one of the replica's own objects */
const COPIES = new Set(['slice', 'map', 'filter', 'concat', 'flat', 'flatMap', 'toSorted', 'toReversed', 'toSpliced', 'with',
  'join', 'toString', 'toFixed', 'reduce', 'reduceRight', 'some', 'every', 'includes', 'indexOf', 'lastIndexOf', 'findIndex',
  'findLastIndex', 'has', 'keys', 'entries']);
const MUTATORS = new Set(['set', 'add', 'delete', 'clear', 'fill', 'copyWithin', 'push', 'pop', 'shift', 'unshift', 'splice',
  'sort', 'reverse']);

/** the names a binding pattern declares */
function patternNames(p: unknown, out: string[] = []): string[] {
  const n = node(p);
  if (!n) return out;
  if (n.type === 'Identifier') out.push(n.name as string);
  else if (n.type === 'AssignmentPattern') patternNames(n.left, out);
  else if (n.type === 'RestElement') patternNames(n.argument, out);
  else if (n.type === 'TSParameterProperty') patternNames(n.parameter, out);
  else if (n.type === 'ArrayPattern') for (const e of n.elements as unknown[]) patternNames(e, out);
  else if (n.type === 'ObjectPattern') for (const q of n.properties as Node[]) patternNames(q.type === 'RestElement' ? q : q.value, out);
  return out;
}

/** the bindings a scope node declares directly: block statements, loop heads, catch and function parameters */
function declare(scope: Scope, chain: Scope[], n: Node): void {
  // only `const x = <expr>` can make an alias; destructured names and parameters are plain bindings that shadow
  const add = (id: unknown, init?: Node, patterns = false) => {
    const alias = patterns || node(id)?.type === 'Identifier' ? init : undefined;
    for (const k of patternNames(id)) scope.set(k, { replica: false, init: alias, chain });
  };
  const statement = (s: Node | undefined) => {
    if (!s) return;
    if (s.type === 'VariableDeclaration') for (const d of s.declarations as Node[]) add(d.id, node(d.init));
    else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) add(s.id);
    else if (s.type === 'ImportDeclaration') for (const sp of s.specifiers as Node[]) add(sp.local);
    else if (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration') statement(node(s.declaration));
  };
  if (n.type === 'Program' || n.type === 'BlockStatement' || n.type === 'StaticBlock') for (const s of n.body as Node[]) statement(s);
  else if (n.type === 'SwitchStatement') for (const c of n.cases as Node[]) for (const s of c.consequent as Node[]) statement(s);
  else if (n.type === 'ForStatement') statement(node(n.init));
  else if (n.type === 'ForInStatement' || n.type === 'ForOfStatement') {
    const left = node(n.left);
    // the loop variables of `for (const b of <replica collection>)` are replica elements
    if (left?.type === 'VariableDeclaration') {
      for (const d of left.declarations as Node[]) add(d.id, n.type === 'ForOfStatement' ? node(n.right) : undefined, true);
    }
  } else if (n.type === 'CatchClause') add(n.param);
  else {
    if (n.type === 'FunctionExpression' && n.id) add(n.id);
    for (const p of n.params as unknown[]) add(p);
  }
}

function lookup(chain: Scope[], k: string) {
  for (let i = chain.length - 1; i >= 0; i--) {
    const b = chain[i].get(k);
    if (b) return b;
  }
}

function replicaExpr(value: unknown, chain: Scope[]): boolean {
  const n = unwrap(value);
  if (!n) return false;
  if (n.type === 'Identifier') return lookup(chain, n.name as string)?.replica ?? false;
  if (n.type === 'MemberExpression') {
    return (name(n) === 'state' && ['ctx', 'host'].includes(name(n.object) ?? '')) ||
      name(n) === 'budget' || replicaExpr(n.object, chain);
  }
  if (n.type !== 'CallExpression') return false;
  const m = member(n.callee);
  return !!m && !COPIES.has(name(m) ?? '') && replicaExpr(m.object, chain);
}

function replicaWrites(tree: Node, report: (n: Node, why: string) => void): void {
  const scopes = new Map<Node, Scope>();
  const build = (n: Node, chain: Scope[]) => {
    if (SCOPE_NODES.has(n.type)) {
      const s: Scope = new Map();
      chain = [...chain, s];
      scopes.set(n, s);
      declare(s, chain, n);
    }
    for (const c of children(n)) build(c, chain);
  };
  build(tree, []);
  // aliases of aliases, until nothing changes
  const bindings = [...scopes.values()].flatMap((s) => [...s.values()]).filter((b) => b.init);
  for (let changed = true; changed;) {
    changed = false;
    for (const b of bindings) {
      if (!b.replica && replicaExpr(b.init, b.chain)) b.replica = changed = true;
    }
  }
  const free = (v: unknown, chain: Scope[]) => {
    const n = unwrap(v);
    return n?.type === 'Identifier' && !lookup(chain, n.name as string);
  };
  const mentionsBF = (v: unknown) => {
    let found = false;
    const n = node(v);
    if (n) walk(n, (c) => { if (c.type === 'Identifier' && c.name === 'BF') found = true; });
    return found;
  };
  const check = (n: Node, chain: Scope[]) => {
    const s = scopes.get(n);
    if (s) chain = [...chain, s];
    const target = member(n.type === 'AssignmentExpression' ? n.left : n.type === 'UpdateExpression' ? n.argument : undefined);
    // a building's flags written through an untracked (undeclared) name, or with the BF building flags, count too
    if (target && (replicaExpr(target, chain) || (name(target) === 'flags' && (free(target.object, chain) || mentionsBF(n.right))))) {
      report(n, 'replica write');
    }
    if (n.type === 'UnaryExpression' && n.operator === 'delete' && replicaExpr(n.argument, chain)) report(n, 'replica write');
    if (n.type === 'CallExpression') {
      const method = member(n.callee), called = name(n.callee);
      if (method && MUTATORS.has(called ?? '') && replicaExpr(method.object, chain)) report(n, 'replica write');
      if (called === 'assign' && name(method?.object) === 'Object' && replicaExpr((n.arguments as Node[])[0], chain)) report(n, 'replica write');
    }
    for (const c of children(n)) check(c, chain);
  };
  check(tree, []);
}

export function scanFiles(files: string[], rule: ScanRule = 'isolate'): Violation[] {
  return files.flatMap((file) => scan(file, readFileSync(join(ROOT, file), 'utf8'), rule));
}

/** Rolldown's module graph before tree shaking, so an unused forbidden import also fails. No bundle is written. */
export async function importGraph(entry: string): Promise<string[]> {
  const modules = new Set<string>();
  const bundle = await rolldown({
    input: join(ROOT, entry), platform: 'node', treeshake: false,
    plugins: [{ name: 'hygiene-graph', buildEnd() {
      for (const id of this.getModuleIds()) if (isAbsolute(id)) modules.add(local(id));
    } }],
  });
  try {
    await bundle.generate({ format: 'esm' });
    return [...modules].sort();
  } finally { await bundle.close(); }
}
