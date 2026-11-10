/**
 * NOTE-081: sim code imports nothing from src/render, src/ui or src/game, type-only imports included. The simulation
 * runs in a worker and in the node tools; the screen's modules read it, and it never reads them.
 * The sources are parsed, as tests/worker/hygieneScan.ts parses them, so a comment or a string that names a path is
 * no import. That settles the exception NOTE-081 names, src/sim/infra/overlays.ts: the file cites
 * src/render/world/overlays.ts (curbCells) in a doc comment and imports nothing from the renderer, so the rule has no
 * exception to list. If a real one is ever granted, name it here by file and target, one line, and nothing wider.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseSync } from 'rolldown/utils';
import { describe, expect, it } from 'vitest';
import { ROOT, local, sourceFiles, staticImportGraph } from '../worker/hygieneScan';

interface ModuleRef { file: string; line: number; spec: string; target: string; typeOnly: boolean }

const literal = (v: unknown): string | undefined => {
  const n = v as { type?: unknown; value?: unknown } | null | undefined;
  return n && n.type === 'Literal' && typeof n.value === 'string' ? n.value : undefined;
};

/**
 * Every module a source names: `import` and `export ... from` (type-only ones too), `import()` as a call and as a
 * type, and `require`. `target` is the path from the repository root for a relative specifier, else the specifier.
 */
function moduleRefs(file: string, source = readFileSync(join(ROOT, file), 'utf8')): ModuleRef[] {
  const parsed = parseSync(file, source, { sourceType: 'module' });
  if (parsed.errors.length) throw new Error(`${file}: ${JSON.stringify(parsed.errors)}`);
  const out: ModuleRef[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const c of v) walk(c); return; }
    if (v === null || typeof v !== 'object') return;
    const n = v as Record<string, unknown> & { start: number };
    if (typeof n.type === 'string') {
      const required = n.type === 'CallExpression' && (n.callee as { name?: unknown } | null)?.name === 'require';
      const spec = literal(n.type === 'TSExternalModuleReference' ? n.expression : required ? (n.arguments as unknown[])[0] : n.source);
      if (spec !== undefined) {
        const parts = n.specifiers as { importKind?: string; exportKind?: string }[] | undefined;
        out.push({
          file, spec, line: source.slice(0, n.start).split('\n').length,
          target: spec.startsWith('.') ? local(resolve(ROOT, dirname(file), spec)) : spec,
          typeOnly: n.type === 'TSImportType' || n.importKind === 'type' || n.exportKind === 'type'
            || (!!parts?.length && parts.every((s) => s.importKind === 'type' || s.exportKind === 'type')),
        });
      }
    }
    for (const [key, c] of Object.entries(n)) if (key !== 'parent' && key !== 'comments') walk(c);
  };
  walk(parsed.program);
  return out;
}

/** the screen's side of the game: what the simulation must not import */
const SCREEN = /^src\/(render|ui|game)(\/|$)/;
const show = (r: ModuleRef): string => `${r.file}:${r.line} -> ${r.target}${r.typeOnly ? ' (type-only)' : ''}`;
const intoScreen = (files: string[]): string[] => files.flatMap((f) => moduleRefs(f)).filter((r) => SCREEN.test(r.target)).map(show);

describe('NOTE-081: sim code imports nothing from src/render, src/ui or src/game', () => {
  it('the scan reads every way a module names another, type-only ones too, and no comment or string', () => {
    const refs = moduleRefs('src/sim/economy/sample.ts', `
      import a from '../../render/a';
      import type { B } from '../../ui/b';
      import { type C } from '../../game/c';
      export { d } from "../../render/d";
      export type { E } from '../../ui/e';
      export * from '../../game/f';
      const g = await import('../../render/g');
      type H = import('../../ui/h').H;
      import i = require('../../game/i');
      const j = require('../../render/j');
      import { k, type K } from './k';
      import type * as Three from 'three';
      // import { l } from '../../render/l';
      /** The Traffic view paints that road's value on i (src/render/world/overlays.ts curbCells, the same rule). */
      const m = "import { m } from '../../render/m'";
    `);
    expect(refs.map((r) => `${r.line}: ${r.target}${r.typeOnly ? ' (type-only)' : ''}`)).toEqual([
      '2: src/render/a', '3: src/ui/b (type-only)', '4: src/game/c (type-only)', '5: src/render/d',
      '6: src/ui/e (type-only)', '7: src/game/f', '8: src/render/g', '9: src/ui/h (type-only)', '10: src/game/i',
      '11: src/render/j', '12: src/sim/economy/k', '13: three (type-only)',
    ]);
    // the rule takes the ten that reach the screen's modules and leaves the sim's own module and the package
    expect(refs.filter((r) => SCREEN.test(r.target))).toHaveLength(10);
    expect(SCREEN.test('src/renderer/a')).toBe(false);
    expect(SCREEN.test('src/sim/render/a')).toBe(false);
  });

  it('no file under src/sim/economy imports from src/render, src/ui or src/game, type-only imports included', () => {
    const economy = sourceFiles('src/sim/economy');
    // an empty or misplaced scan must never pass
    expect(economy).toEqual(expect.arrayContaining(['src/sim/economy/advisors.ts', 'src/sim/economy/weatherCalendar.ts']));
    expect(intoScreen(economy)).toEqual([]);
  });

  it('nor does the rest of src/sim: src/sim/infra/overlays.ts cites the renderer in a comment, which is no import', () => {
    const rest = sourceFiles('src/sim').filter((p) => !p.startsWith('src/sim/economy/'));
    expect(rest).toContain('src/sim/Simulation.ts');
    expect(intoScreen(rest)).toEqual([]);
  });

  it('the weather calendar names sim and core modules alone, and nothing that loads with it is the renderer or a package', () => {
    const entry = 'src/sim/economy/weatherCalendar.ts';
    // what the module names itself, type-only included: no three, not even as a type
    const named = moduleRefs(entry);
    expect(named.map((r) => r.target)).toContain('src/sim/economy/eventHeadlines');
    expect(named.filter((r) => !/^src\/(sim|core)\//.test(r.target)).map(show)).toEqual([]);
    // what loads with it in the worker: its runtime import graph
    const loaded = staticImportGraph(entry);
    expect(loaded).toEqual(expect.arrayContaining([entry, 'src/sim/economy/eventHeadlines.ts']));
    expect(loaded.filter((p) => SCREEN.test(p))).toEqual([]);
    expect(loaded.flatMap((f) => moduleRefs(f)).filter((r) => !r.typeOnly && !r.spec.startsWith('.')).map(show)).toEqual([]);
  });
});
