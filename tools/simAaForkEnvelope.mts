/**
 * NOTE-052: symmetric fork probes for one SIM balance row, in sequential quiet-gated processes.
 *   node --experimental-strip-types tools/simAaForkEnvelope.mts --help
 * Writes only its output directory. Use --all-sizes for one-command-per-row collection, then select the smallest
 * candidate that forks all four probes on all three rows. Reuse is keyed by clean simulation sources.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { YearRow } from './simbot';

export interface Row { size: number; years: number; seed: number }
interface Options extends Row {
  tree: string; outDir: string; quietGate: string; reuseDir?: string; reportOnly: boolean; allSizes: boolean; nudge?: number;
}
export interface Source { commit: string; simBlob: string; srcTree: string }
interface Spec extends Row, Source {
  id: string; nudge: number; day: number; command: string; equivalentCommand: string;
  jsonPath: string; annualPath: string; actionPath: string; logPath: string;
  configuration?: typeof CONFIGURATION;
  botArgs?: string[];
}
export interface AnnualMetrics {
  yearIndex: number; year: number; population: number; air: number; approval: number; ihtShare: number;
}
interface Annual extends AnnualMetrics {
  funds: number; residents: number[]; jobsByDev: number[];
  botRow: Omit<YearRow, 'econMsPerDay' | 'totalMsPerDay'>; stateHash: string;
}
interface Action { day: number; date: string; method: string; args: unknown[]; cost?: number; affected?: number }
interface Log { day: number; date: string; year: number; text: string }
interface Completed {
  complete: true; spec: Spec; rows: Annual[]; actions: Action[]; log: Log[]; seconds: number; node: string;
}
interface Evidence { path: string; run: Completed }
interface Difference<T> { index: number; control: T | null; nudge: T | null }
const SELF = fileURLToPath(import.meta.url);
const GRID = [10, 100, 1000, 10000];
const YEAR_FIVE_DAY = 4 * 360 + 1;
const METRICS = ['population', 'air', 'approval', 'ihtShare'] as const;
const CONFIGURATION = { difficulty: 'medium', terrain: 'plains', water: 0.2, noInfra: false, profile: 'default' } as const;
const HELP = `NOTE-052 symmetric SIM fork envelope (one row)
usage: node --experimental-strip-types tools/simAaForkEnvelope.mts --tree ROOT --size N --years N --seed N --out-dir DIR --quiet-gate FILE [--reuse-dir DIR] [--nudge X | --all-sizes] [--report-only]
  --tree ROOT       selected code tree (default: current directory); never modified
  --size N          128 or 256; --years N and --seed N select a required balance row
  --out-dir DIR     raw runs, annual/action journals, JSON summary and standalone Markdown (required)
  --quiet-gate FILE every bot process runs sequentially through this gate (required)
  --reuse-dir DIR   optional prior Round-2/NOTE-052 JSON directory, validated by source/configuration
  --nudge X         force 10,100,1000,10000, e.g. the common X required by the three rows
  --all-sizes       collect all grid candidates; intersect the three rows' qualifying candidates
  --report-only     use completed JSON only; fail if the candidate data needed for selection is missing
Default searches 10,100,1000,10000 and stops when +/-X on day1 and day1441 all fork the control.
Day1441 is the first simulated iteration of the fifth bot year, after the year4 callback at day1440.
Choose the smallest X that qualifies on ALL three rows, not the maximum of local minima: qualification
may be non-monotonic. --all-sizes gives one collection command per row. --nudge X summarizes a common X.
Source changes require a fresh output directory. Docs-only commit changes permit verified reuse.
Use a fresh output directory and the T041 tree to repeat the protocol after T041.`;

export function parseOptions(argv: string[]): Options {
  const values: Record<string, string> = {};
  let reportOnly = false, allSizes = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--report-only') { reportOnly = true; continue; }
    if (flag === '--all-sizes') { allSizes = true; continue; }
    if (!['--tree', '--size', '--years', '--seed', '--out-dir', '--quiet-gate', '--reuse-dir', '--nudge'].includes(flag)) throw new Error(`unknown option ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    values[flag] = value;
  }
  if (!values['--out-dir'] || !values['--quiet-gate']) throw new Error('--out-dir and --quiet-gate are required');
  const size = Number(values['--size']), years = Number(values['--years']), seed = Number(values['--seed']);
  if (!(size === 128 && years === 15 && seed === 7 || size === 256 && years === 60 && [7, 11].includes(seed))) throw new Error('row must be 128x15 s7, 256x60 s7 or 256x60 s11');
  const nudge = values['--nudge'] === undefined ? undefined : Number(values['--nudge']);
  if (nudge !== undefined && !GRID.includes(nudge)) throw new Error('--nudge must be 10, 100, 1000 or 10000');
  if (nudge !== undefined && allSizes) throw new Error('--nudge and --all-sizes are mutually exclusive');
  return { tree: resolve(values['--tree'] ?? process.cwd()), size, years, seed, reportOnly, allSizes, nudge,
    outDir: resolve(values['--out-dir']), quietGate: resolve(values['--quiet-gate']),
    ...(values['--reuse-dir'] ? { reuseDir: resolve(values['--reuse-dir']) } : {}) };
}
function canonical(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) return { type: value.constructor.name, bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function json(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(`${path}.tmp`, path);
}
function command(args: string[]): string { return args.map((arg) => /^[\w./:=+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "''")}'`).join(' '); }
async function git(tree: string, outDir: string, ...args: string[]): Promise<string> {
  const stdoutPath = join(outDir, `.fork-git-${process.pid}.stdout`), stderrPath = join(outDir, `.fork-git-${process.pid}.stderr`);
  const stdoutFd = openSync(stdoutPath, 'w'), stderrFd = openSync(stderrPath, 'w');
  try {
    let exit: { code: number | null; signal: NodeJS.Signals | null };
    try {
      exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
        // Arguments are fixed git switches and repository-relative paths. File-backed stdio avoids restricted pipes.
        const proc = spawn(['git', ...args].join(' '), { cwd: tree, shell: true, windowsHide: true, stdio: ['ignore', stdoutFd, stderrFd] });
        proc.once('error', reject);
        proc.once('close', (code, signal) => accept({ code, signal }));
      });
    } finally { closeSync(stdoutFd); closeSync(stderrFd); }
    const stdout = readFileSync(stdoutPath, 'utf8'), stderr = readFileSync(stderrPath, 'utf8');
    if (exit.code !== 0) throw new Error(`git ${args.join(' ')}: ${stderr.trim() || exit.code || exit.signal}`);
    return stdout.trimEnd();
  } finally {
    if (existsSync(stdoutPath)) unlinkSync(stdoutPath);
    if (existsSync(stderrPath)) unlinkSync(stderrPath);
  }
}
async function source(tree: string, outDir: string): Promise<Source> {
  if (await git(tree, outDir, 'diff', '--binary', 'HEAD', '--', 'src', 'tools/simbot.ts')) throw new Error('simulation sources have tracked changes; commit or use a clean selected tree');
  if (await git(tree, outDir, 'ls-files', '--others', '--exclude-standard', '--', 'src')) throw new Error('simulation sources contain untracked files');
  return { commit: await git(tree, outDir, 'rev-parse', 'HEAD'),
    simBlob: await git(tree, outDir, 'hash-object', 'tools/simbot.ts'), srcTree: await git(tree, outDir, 'rev-parse', 'HEAD:src') };
}
export function sameSource(a: Source, b: Source): boolean { return a.simBlob === b.simBlob && a.srcTree === b.srcTree; }
function rowId(row: Row): string { return `${row.size}x${row.years}_s${row.seed}`; }
function runId(row: Row, nudge: number, day: number): string { return `${rowId(row)}_${nudge ? `n${nudge}_d${day}` : 'base'}`; }
function cliArgs(row: Row, nudge: number, day: number): string[] {
  return ['--size', String(row.size), '--years', String(row.years), '--seed', String(row.seed), '--quiet',
    ...(nudge && day === 1 ? ['--aa-funds-nudge', String(nudge)] : [])];
}

/** Bundled into a fresh child with the selected tree's modules; observation matches the Round-2 sweep. */
export async function runChild(
  botModule: typeof import('./simbot'), dev: { ID: number; IM: number; IHT: number },
  serializeCity: typeof import('../src/save/serialize').serializeCity, specPath: string,
): Promise<void> {
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as Spec;
  const opts = botModule.parseArgs([...cliArgs(spec, spec.nudge, spec.day), ...(spec.botArgs ?? [])]);
  if (spec.day === 1 && spec.nudge && opts.aaFundsNudge !== spec.nudge) throw new Error('selected tree lacks --aa-funds-nudge support');
  if (!spec.botArgs?.length && (opts.difficulty !== CONFIGURATION.difficulty || opts.terrain !== CONFIGURATION.terrain || opts.water !== CONFIGURATION.water || opts.noInfra || opts.profile && opts.profile !== 'default')) throw new Error('selected tree changed the default bot configuration');
  const bot: any = new botModule.SimBot(opts, await botModule.botSystems(opts.noInfra));
  const rows: Annual[] = [], actions: Action[] = [], log: Log[] = [];
  const start = performance.now();
  let actionFlush = 0, logFlush = 0, injected = spec.day === 1;
  for (const path of [spec.annualPath, spec.actionPath, spec.logPath]) writeFileSync(path, '', 'utf8');
  const say = bot.say;
  bot.say = function (this: any, text: string) {
    log.push({ day: this.st.day, date: this.st.dateLabel(), year: this.st.year, text });
    say.call(this, text);
  };
  // Exclude previews, failed attempts and unchanged setters; forward once with the original receiver/arguments.
  const previewIndex: Record<string, number> = { zone: 2, dezone: 1, buildNetwork: 2, buildPowerLine: 1,
    buildSubway: 1, bulldozeSubway: 1, bulldoze: 1, plop: 4, terraform: 5, plantTrees: 1 };
  const methods = [...Object.keys(previewIndex), 'setTax', 'setFunding', 'setOrdinance', 'takeLoan', 'repayLoan', 'toggleHistoric'];
  for (const method of methods) {
    const original = bot.A[method];
    if (typeof original !== 'function') continue;
    bot.A[method] = function (this: any, ...values: any[]) {
      const preview = previewIndex[method] !== undefined && values[previewIndex[method]] === true;
      const before = method === 'setTax' ? bot.st.budget.taxRates[values[0]] : method === 'setFunding' ? bot.st.budget.funding[values[0]] : undefined;
      const result = original.apply(this, values);
      const after = method === 'setTax' ? bot.st.budget.taxRates[values[0]] : method === 'setFunding' ? bot.st.budget.funding[values[0]] : undefined;
      if (!preview && (result?.ok || (method === 'setTax' || method === 'setFunding') && before !== after)) {
        const compact = values.map((value) => Array.isArray(value) && value.length && typeof value[0] === 'object'
          ? { from: value[0], to: value.at(-1), length: value.length, hash: hash(value) } : value);
        actions.push(JSON.parse(JSON.stringify({ day: bot.st.day, date: bot.st.dateLabel(), method, args: compact,
          ...(result ? { cost: result.cost, affected: result.affected } : {}) })));
      }
      return result;
    };
  }
  if (spec.day !== 1) {
    const daily = bot.daily;
    bot.daily = function (this: any) {
      if (!injected && this.days === spec.day) { this.st.funds += spec.nudge; injected = true; }
      daily.call(this);
    };
  }
  bot.run(spec.years, (r: YearRow) => {
    const s = bot.st.stats, industry = s.jobsByDev[dev.ID] + s.jobsByDev[dev.IM] + s.jobsByDev[dev.IHT];
    const { econMsPerDay: _econ, totalMsPerDay: _total, ...botRow } = r;
    const state = serializeCity(bot.st, { copy: true });
    state.savedAt = 0;
    const annual: Annual = { yearIndex: rows.length + 1, year: r.year, population: r.pop, air: s.avgAir ?? 0,
      approval: r.approval, ihtShare: industry ? s.jobsByDev[dev.IHT] / industry : 0, funds: bot.st.funds,
      residents: [...s.residents], jobsByDev: [...s.jobsByDev], botRow, stateHash: hash(state) };
    rows.push(annual);
    appendFileSync(spec.annualPath, `${JSON.stringify(annual)}\n`, 'utf8');
    appendFileSync(spec.actionPath, `${actions.slice(actionFlush).map((value) => JSON.stringify(value)).join('\n')}\n`, 'utf8');
    appendFileSync(spec.logPath, `${log.slice(logFlush).map((value) => `[day ${value.day}, ${value.date}] ${value.text}`).join('\n')}\n`, 'utf8');
    actionFlush = actions.length; logFlush = log.length;
    console.error(`[${spec.id}] year ${annual.yearIndex}/${spec.years}: pop=${annual.population} air=${annual.air} approval=${annual.approval} IHT=${annual.ihtShare}`);
  });
  if (!injected) throw new Error('later-day injection was not reached');
  json(spec.jsonPath, { complete: true, spec, rows, log, actions, seconds: (performance.now() - start) / 1000, node: process.version });
}

export async function bundleChild(opts: Pick<Options, 'tree' | 'outDir'>): Promise<string> {
  const entry = join(opts.outDir, 'fork-child-entry.mts');
  writeFileSync(entry, [
    `import { runChild } from ${JSON.stringify(SELF)};`,
    `import * as botModule from ${JSON.stringify(join(opts.tree, 'tools/simbot.ts'))};`,
    `import { DevType } from ${JSON.stringify(join(opts.tree, 'src/core/types.ts'))};`,
    `import { serializeCity } from ${JSON.stringify(join(opts.tree, 'src/save/serialize.ts'))};`,
    'await runChild(botModule, DevType, serializeCity, process.argv[3]);', '',
  ].join('\n'), 'utf8');
  const require = createRequire(join(opts.tree, 'package.json'));
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href) as typeof import('rolldown');
  const bundle = await rolldown({ input: entry, platform: 'node', logLevel: 'warn' });
  try { await bundle.write({ format: 'esm', dir: opts.outDir, entryFileNames: 'fork-child.mjs', chunkFileNames: 'fork-[name]-[hash].mjs' }); } finally { await bundle.close(); }
  return join(opts.outDir, 'fork-child.mjs');
}
function loadCompleted(path: string, opts: Options, info: Source, nudge: number, day: number): Evidence | undefined {
  if (!existsSync(path)) return undefined;
  const run = validateCompleted(JSON.parse(readFileSync(path, 'utf8')), opts, info, nudge, day, path);
  return { path, run };
}
export function validateCompleted(value: unknown, row: Row, info: Source, nudge: number, day: number, path = 'run'): Completed {
  if (!value || typeof value !== 'object') throw new Error(`invalid completed run: ${path}`);
  const run = value as Completed;
  const spec = run.spec;
  if (!run.complete || !spec || spec.id !== runId(row, nudge, day) || spec.size !== row.size || spec.years !== row.years || spec.seed !== row.seed || spec.nudge !== nudge || spec.day !== day || !sameSource(spec, info)) throw new Error(`run/source mismatch: ${path}`);
  if (spec.configuration && JSON.stringify(spec.configuration) !== JSON.stringify(CONFIGURATION)) throw new Error(`configuration mismatch: ${path}`);
  // Legacy Round-2 records used the same explicit three selectors and the unchanged selected bot's defaults.
  if (!Array.isArray(run.rows) || run.rows.length !== row.years || !Array.isArray(run.actions) || !Array.isArray(run.log)) throw new Error(`incomplete evidence: ${path}`);
  if (!run.log.every((entry) => Number.isInteger(entry.day) && typeof entry.text === 'string') ||
      !run.actions.every((entry) => Number.isInteger(entry.day) && typeof entry.method === 'string' && Array.isArray(entry.args))) throw new Error(`invalid action evidence: ${path}`);
  for (const [index, annual] of run.rows.entries()) {
    if (annual.yearIndex !== index + 1 || !Number.isInteger(annual.year) || !METRICS.every((metric) => Number.isFinite(annual[metric])) || !annual.botRow || !/^[a-f0-9]{64}$/.test(annual.stateHash)) throw new Error(`invalid annual evidence: ${path} year ${index + 1}`);
  }
  return run;
}
function difference<T>(base: T[], other: T[]): Difference<T> | null {
  const end = Math.max(base.length, other.length);
  for (let index = 0; index < end; index++) if (JSON.stringify(base[index]) !== JSON.stringify(other[index])) return { index, control: base[index] ?? null, nudge: other[index] ?? null };
  return null;
}
export function firstLogDifference<T extends { day: number; text: string }>(base: T[], other: T[]): Difference<T> | null {
  const end = Math.max(base.length, other.length);
  for (let index = 0; index < end; index++) {
    const a = base[index], b = other[index];
    if (!a || !b || a.day !== b.day || a.text !== b.text) return { index, control: a ?? null, nudge: b ?? null };
  }
  return null;
}
function forks(base: Completed, run: Completed) {
  const action = difference(base.actions, run.actions), log = firstLogDifference(base.log, run.log);
  return { forks: log !== null, firstAction: action, firstLog: log };
}
function pct(delta: number, base: number): number | null { return base === 0 ? delta === 0 ? 0 : null : 100 * delta / Math.abs(base); }
export function summarizeEnvelope(base: AnnualMetrics[], runs: { id: string; rows: AnnualMetrics[] }[], enabled = true) {
  if (!runs.length || !base.some((row) => row.yearIndex >= 10)) throw new Error('envelope requires probe runs and year-10 observations');
  return Object.fromEntries(METRICS.map((metric) => {
    const observations = runs.flatMap((run) => base.filter((row) => row.yearIndex >= 10).map((row) => {
      const other = run.rows[row.yearIndex - 1];
      if (!other || other.year !== row.year || other.yearIndex !== row.yearIndex) throw new Error('unaligned annual observations');
      const delta = enabled ? Math.abs(other[metric] - row[metric]) : 0;
      return { delta, year: row.year, yearIndex: row.yearIndex, control: row[metric], relativePercent: pct(delta, row[metric]), run: run.id };
    }));
    const maximum = observations.reduce((a, b) => b.delta > a.delta ? b : a);
    const maximumRelative = observations.reduce((a, b) => (b.relativePercent ?? Infinity) > (a.relativePercent ?? Infinity) ? b : a);
    return [metric, { ...maximum, maxAnnualRelativePercent: maximumRelative.relativePercent, maxAnnualRelativeYear: maximumRelative.year }];
  }));
}
function fmt(value: number | null): string { return value === null ? 'infinite' : Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12))); }
function cell(value: unknown): string { return (typeof value === 'string' ? value : JSON.stringify(value) ?? 'null').replaceAll('|', '\\|').replaceAll('\n', ' '); }
function writeReport(opts: Options, info: Source, base: Evidence, candidates: { x: number; runs: Evidence[] }[]): void {
  const results = candidates.map(({ x, runs }) => ({ x, allFork: runs.every(({ run }) => forks(base.run, run).forks),
    envelope: summarizeEnvelope(base.run.rows, runs.map(({ run }) => ({ id: run.spec.id, rows: run.rows }))),
    runs: runs.map(({ path, run }) => ({ id: run.spec.id, path, command: run.spec.command, nudge: run.spec.nudge, day: run.spec.day,
      ...forks(base.run, run), final: Object.fromEntries(METRICS.map((metric) => [metric, {
        control: base.run.rows.at(-1)![metric], value: run.rows.at(-1)![metric],
        delta: run.rows.at(-1)![metric] - base.run.rows.at(-1)![metric],
      }])) })) }));
  const selected = results.find((candidate) => candidate.allFork), finalCandidate = candidates.find((candidate) => candidate.x === selected?.x) ?? candidates.at(-1)!;
  const exhaustedGrid = GRID.every((x) => candidates.some((candidate) => candidate.x === x));
  const zeroEnvelope = !selected && exhaustedGrid;
  const measuredEnvelope = selected || zeroEnvelope ? summarizeEnvelope(base.run.rows,
    finalCandidate.runs.map(({ run }) => ({ id: run.spec.id, rows: run.rows })), !zeroEnvelope) : null;
  const summary = { protocol: 'NOTE-052', row: { size: opts.size, years: opts.years, seed: opts.seed }, source: info,
    configuration: CONFIGURATION, yearFiveDay: YEAR_FIVE_DAY, selectionMode: opts.allSizes ? 'all-sizes' : opts.nudge === undefined ? 'search' : 'forced',
    rowQualifyingXs: results.filter((candidate) => candidate.allFork).map((candidate) => candidate.x),
    chosenX: selected?.x ?? null, selectionStatus: selected ? 'local-candidate' : zeroEnvelope ? 'no-qualifying-grid-candidate' : 'unresolved',
    zeroEnvelope, control: base.path, candidates: results, envelope: measuredEnvelope,
    rule: 'Historical NOTE-052 fork diagnostics. NOTE-053 gates use ensemble medians and min-max bands; use simEnsemble.mts for final gates.' };
  const name = `${rowId(opts)}_note052`;
  json(join(opts.outDir, `${name}.summary.json`), summary);
  const lines = [`# NOTE-052 ${rowId(opts)} fork envelope`, '',
    `Commit: \`${info.commit}\`; simbot blob: \`${info.simBlob}\`; src tree: \`${info.srcTree}\`.`, '',
    `Row-qualifying X values: **${summary.rowQualifyingXs.join(', ') || 'none'}**; smallest measured local candidate: **${selected?.x ?? (zeroEnvelope ? 'none (zero envelope)' : 'unresolved')}**.`, '',
    'This row alone does not select the shared three-row X. Use `--all-sizes` for each row and choose the smallest intersection of their qualifying X values; qualification need not be monotonic. JSON includes every candidate envelope, so collection needs one command per row. Rows that exhaust all four sizes without qualifying have zero envelopes and are excluded from that intersection. A failed forced candidate is unresolved, not a zero-envelope fallback.', '',
    'Day 1 uses the production nudge flag. Day 1441 is the first simulated iteration of bot year 5, after the year-4 callback at day 1440; the calendar year starts at day 1440. Later injection occurs once after advanceDay and before daily/monthly decisions. No RNG draw is added.', '',
    'Fork qualification requires a difference in the full say action log, comparing {day,text}. Successful non-preview command journals are supplementary; unchanged tax/funding setters and unsuccessful attempts are excluded. Percentages use the control in the year of the absolute maximum; I-HT share is a fraction.', '',
    '## Candidate and first-decision evidence', '',
    '| X | Run | Forks | First successful command difference (zero-based index; control / probe) | First full-log difference (zero-based index; control / probe) |',
    '|---:|---|---|---|---|'];
  for (const candidate of results) for (const run of candidate.runs) lines.push(`| ${candidate.x} | ${run.id} | ${run.forks} | ${cell(run.firstAction)} | ${cell(run.firstLog)} |`);
  lines.push('', '## Envelope from year 10', '', '| Metric | Max absolute delta | Year | Control there | Relative delta there | Probe | Max annual relative delta | Year |', '|---|---:|---:|---:|---:|---|---:|---:|');
  for (const metric of measuredEnvelope ? METRICS : []) {
    const value = measuredEnvelope![metric];
    lines.push(`| ${metric} | ${fmt(value.delta)} | ${value.year} | ${fmt(value.control)} | ${fmt(value.relativePercent)}% | ${value.run} | ${fmt(value.maxAnnualRelativePercent)}% | ${value.maxAnnualRelativeYear} |`);
  }
  lines.push('', '## Signed endpoint deltas for the cross-row real-effect check', '',
    'Compare these signed endpoint deltas across all three rows, separately at each timing and across both timings. Report consistent nudge-sign or reverse-sign patterns, and patterns where both signs move a metric in the same direction. Raw annual records retain every year for the same check over years 10 through the end.', '',
    '| Probe | Population | Air at homes | Approval points | I-HT share fraction |', '|---|---:|---:|---:|---:|');
  const selectedResult = results.find((candidate) => candidate.x === finalCandidate.x)!;
  for (const run of selectedResult.runs) lines.push(`| ${run.id} | ${METRICS.map((metric) => fmt(run.final[metric].delta)).join(' | ')} |`);
  lines.push('', '## Commands and raw files', '', '```powershell',
    command(['node', '--experimental-strip-types', SELF, '--tree', opts.tree, '--size', String(opts.size), '--years', String(opts.years), '--seed', String(opts.seed), '--out-dir', opts.outDir, '--quiet-gate', opts.quietGate,
      ...(opts.reuseDir ? ['--reuse-dir', opts.reuseDir] : []), ...(opts.allSizes ? ['--all-sizes'] : []), ...(opts.nudge === undefined ? [] : ['--nudge', String(opts.nudge)])]), '```', '',
    'Repeat with `--report-only` to rebuild from completed evidence. To remeasure after T041, change `--tree` to that dev tree and `--out-dir` to a fresh directory. Do not pass a reuse directory from a different source tree.', '',
    `Control raw: \`${base.path}\`.`, '');
  for (const { runs } of candidates) for (const { path, run } of runs) lines.push(`- \`${path}\``, '', '```powershell', run.spec.command, run.spec.equivalentCommand, '```', '');
  lines.push('These are historical fork diagnostics. NOTE-053 replaces the earlier base and variant margin rules with ensemble medians and min-max bands; use simEnsemble.mts for final gates. No baseline is re-recorded.', '');
  writeFileSync(join(opts.outDir, `${name}.md`), lines.join('\n'), 'utf8');
}
async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(HELP); return; }
  const opts = parseOptions(process.argv.slice(2));
  if (!existsSync(join(opts.tree, 'tools/simbot.ts'))) throw new Error(`missing simbot in ${opts.tree}`);
  if (!existsSync(opts.quietGate)) throw new Error(`missing quiet gate ${opts.quietGate}`);
  mkdirSync(opts.outDir, { recursive: true });
  const info = await source(opts.tree, opts.outDir);
  let child: string | undefined;
  async function obtain(nudge: number, day: number): Promise<Evidence> {
    const id = runId(opts, nudge, day);
    for (const dir of [...new Set([opts.outDir, ...(opts.reuseDir ? [opts.reuseDir] : [])])]) {
      const existing = loadCompleted(join(dir, `${id}.json`), opts, info, nudge, day);
      if (existing) { console.error(`REUSE ${id} from ${existing.path}`); return existing; }
    }
    if (opts.reportOnly) throw new Error(`missing completed ${id}; omit --report-only to measure`);
    if (!sameSource(await source(opts.tree, opts.outDir), info)) throw new Error('simulation sources changed during measurement');
    child ??= await bundleChild(opts);
    const specPath = join(opts.outDir, `${id}.spec.json`);
    const spec: Spec = { id, size: opts.size, years: opts.years, seed: opts.seed, nudge, day, ...info, configuration: CONFIGURATION,
      jsonPath: join(opts.outDir, `${id}.json`), annualPath: join(opts.outDir, `${id}.ndjson`), actionPath: join(opts.outDir, `${id}.actions.ndjson`), logPath: join(opts.outDir, `${id}.actions.log`),
      command: command(['node', opts.quietGate, 'node', child, '--fork-child', specPath]),
      equivalentCommand: day === 1 ? command(['node', opts.quietGate, 'npx', 'tsx', join(opts.tree, 'tools/simbot.ts'), ...cliArgs(opts, nudge, day)]) : `observer wrapper: add ${nudge} funds once before daily after advanceDay on day ${day}` };
    json(specPath, spec);
    console.error(`START ${spec.command}`);
    await new Promise<void>((accept, reject) => {
      const proc = spawn(process.execPath, [opts.quietGate, process.execPath, child!, '--fork-child', specPath], { cwd: opts.tree, stdio: 'inherit', windowsHide: true });
      proc.once('error', reject);
      proc.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`${id}: exited ${code ?? signal}`)));
    });
    if (!sameSource(await source(opts.tree, opts.outDir), info)) throw new Error('simulation sources changed during measurement');
    const completed = loadCompleted(spec.jsonPath, opts, info, nudge, day);
    if (!completed) throw new Error(`child produced no completed ${id}`);
    return completed;
  }
  const base = await obtain(0, 1), candidates: { x: number; runs: Evidence[] }[] = [];
  for (const x of opts.nudge === undefined ? GRID : [opts.nudge]) {
    const runs: Evidence[] = [];
    for (const day of [1, YEAR_FIVE_DAY]) for (const nudge of [x, -x]) runs.push(await obtain(nudge, day));
    candidates.push({ x, runs });
    writeReport(opts, info, base, candidates);
    if (!opts.allSizes && runs.every(({ run }) => forks(base.run, run).forks)) break;
  }
  console.error(`WROTE ${join(opts.outDir, `${rowId(opts)}_note052.summary.json`)} and .md`);
}

if (!process.argv.includes('--fork-child') && process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
