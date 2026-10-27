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

function walk(n: Node, visit: (n: Node) => void): void {
  visit(n);
  for (const [key, value] of Object.entries(n)) {
    if (key === 'parent' || key === 'comments') continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      const c = node(v);
      if (c) walk(c, visit);
    }
  }
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

  // Conservative replica aliases, including `const st = ctx.state`, `const b = st.budget`
  // and building lookups. W0.6 reviews these sites, including mutating methods and deletes.
  const aliases = new Set<string>();
  function replica(value: unknown): boolean {
    const n = unwrap(value);
    if (!n) return false;
    if (n.type === 'Identifier') return aliases.has(name(n)!);
    if (n.type === 'MemberExpression') {
      return (name(n) === 'state' && ['ctx', 'host'].includes(name(n.object) ?? '')) ||
        name(n) === 'budget' || replica(n.object);
    }
    return n.type === 'CallExpression' && replica(member(n.callee)?.object);
  }
  if (rule === 'replica') {
    let size = -1;
    while (size !== aliases.size) {
      size = aliases.size;
      walk(tree, (n) => {
        if (n.type === 'VariableDeclarator' && replica(n.init) && node(n.id)?.type === 'Identifier') aliases.add(name(n.id)!);
      });
    }
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
    if (rule === 'replica') {
      if (target && (replica(target) || (member(target) && name(target) === 'flags'))) report(n, 'replica write');
      if (n.type === 'UnaryExpression' && n.operator === 'delete' && replica(n.argument)) report(n, 'replica write');
      if (call && method && replica(method.object) && ['set', 'add', 'delete', 'clear', 'fill', 'copyWithin', 'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(called ?? '')) report(n, 'replica write');
      if (call && called === 'assign' && name(method?.object) === 'Object' && replica((n.arguments as Node[])[0])) report(n, 'replica write');
    }
  });
  return out;
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
