/**
 * The round-1 TopBar split (POLISH_PLAN §7.3, §7.4) changes no behaviour: a scripted session through every segment
 * (tests/game/topBarTrace.ts) leaves the same DOM tree, makes the same DOM writes and the same calls into the game, step
 * by step, as the TopBar before the split. The reference trace (tests/game/fixtures/topBarTrace.json) was recorded from
 * dev 7348e09's src/ui/TopBar.ts. A lane that changes the HUD on purpose re-records it (TOPBAR_TRACE=write) and shows
 * the fixture's diff in its review; the per-step write counts keep T030's per-tick write skipping visible there.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './fakeDom';
import { installTraceDom, traceTopBar, type TraceStep } from './topBarTrace';

installFakeDom();
let restore = () => {};
beforeAll(() => { restore = installTraceDom(); });
afterAll(() => { restore(); vi.restoreAllMocks(); });

const FIXTURE = new URL('./fixtures/topBarTrace.json', import.meta.url);

/** the stored form: a step's tree as its line edits on the step before (hunks of [first old line, lines removed, lines
 *  inserted]); the first step of each session keeps its whole tree */
type Hunk = [at: number, del: number, ins: string[]];
type Stored = Omit<TraceStep, 'tree'> & { tree?: string[]; patch?: Hunk[] };

/** a line diff (LCS) of `b` on `a`, as hunks in old-line order */
function diff(a: string[], b: string[]): Hunk[] {
  const n = a.length, m = b.length, L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Hunk[] = [];
  let i = 0, j = 0, cur: Hunk | null = null;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { cur = null; i++; j++; continue; }
    if (!cur) out.push((cur = [i, 0, []]));
    if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) cur[2].push(b[j++]);
    else { cur[1]++; i++; }
  }
  return out;
}

function pack(steps: TraceStep[]): Stored[] {
  return steps.map(({ tree, ...s }, i) => {
    if (i === 0 || s.name.endsWith(': construct')) return { ...s, tree };
    const patch = diff(steps[i - 1].tree, tree);
    return patch.length ? { ...s, patch } : s;
  });
}

function unpack(stored: Stored[]): TraceStep[] {
  const out: TraceStep[] = [];
  for (const { tree, patch, ...s } of stored) {
    let t = tree ?? out[out.length - 1].tree;
    if (patch) {
      const prev = t;
      t = [];
      let k = 0;
      for (const [at, del, ins] of patch) { t.push(...prev.slice(k, at), ...ins); k = at + del; }
      t.push(...prev.slice(k));
    }
    out.push({ ...s, tree: t });
  }
  return out;
}

const reference = () => unpack(JSON.parse(readFileSync(FIXTURE, 'utf8')) as Stored[]);

describe('the TopBar split changes no behaviour', () => {
  let steps: TraceStep[] = [];
  beforeAll(async () => {
    steps = await traceTopBar();
    if (process.env.TOPBAR_TRACE === 'write') writeFileSync(FIXTURE, JSON.stringify(pack(steps), null, 1) + '\n');
  });

  it('the scripted session matches the pre-split trace step by step: tree, DOM writes and calls', () => {
    const want = reference();
    expect(steps.map((s) => s.name)).toEqual(want.map((s) => s.name));
    for (let i = 0; i < want.length; i++) {
      expect(steps[i].calls, `${want[i].name}: calls`).toEqual(want[i].calls);
      expect(steps[i].writes, `${want[i].name}: DOM writes`).toEqual(want[i].writes);
      expect(steps[i].tree.join('\n'), `${want[i].name}: DOM tree`).toBe(want[i].tree.join('\n'));
    }
  });

  it('T030: an unchanged tick writes nothing; with the RCI popover open, only its 12 bar titles are set again', () => {
    const at = (name: string) => steps.find((s) => s.name.endsWith(name))!.writes;
    for (const name of ['five unchanged ticks', 'click Fast again (the active speed ticks)', 'still capped: no second toast', 'approval: an unchanged report (no rebuild)']) {
      expect(at(name), name).toEqual({});
    }
    const open = at('three ticks with it open');
    expect(Object.keys(open)).toHaveLength(12);
    for (const [path, props] of Object.entries(open)) expect(`${path} ${props}`).toMatch(/^0\.1\.2\.3\.1\.\d+\.1 div\.rci-bar title×3$/);
  });
});
