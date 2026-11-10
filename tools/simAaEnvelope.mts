/**
 * NOTE-048: six independent, quiet-gated bots and their shared A/A envelope.
 *   node --experimental-strip-types tools/simAaEnvelope.mts --tree ROOT --out-dir SCRATCH --quiet-gate PATH
 * Uses the selected tree's rolldown, so tsx and registry access are unnecessary. Interrupted runs restart; completed
 * runs resume only when their source fingerprint matches. Raw annual JSON retains full numeric precision.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { YearRow } from './simbot';

interface RowSpec { size: number; years: number; seed: number }
interface TreeInfo {
  tree: string; commit: string; branch: string; dirty: string[]; sourceFingerprint: string; sourceDiffSha256: string;
}
interface Options {
  tree: string; outDir: string; report: string; quietGate: string; reportOnly: boolean;
}
interface RunSpec {
  schema: 1; id: string; row: RowSpec; nudge?: number; treeInfo: TreeInfo; command: string; equivalentCommand: string;
  jsonPath: string; annualPath: string; logPath: string;
}
interface Annual {
  yearIndex: number; year: number; population: number; air: number; approval: number; ihtShare: number;
  industrialJobs: number; jobsByDev: number[]; residents: number[]; funds: number;
  botRow: Omit<YearRow, 'econMsPerDay' | 'totalMsPerDay'>; rowHash: string; stateHash: string;
}
interface CompletedRun {
  schema: 1; complete: true; spec: RunSpec; startedAt: string; finishedAt: string; node: string; host: 'none';
  rows: Annual[]; seconds: number;
}
const ROWS: RowSpec[] = [{ size: 128, years: 15, seed: 7 }, { size: 256, years: 60, seed: 7 }, { size: 256, years: 60, seed: 11 }];
const METRICS = ['population', 'air', 'approval', 'ihtShare'] as const;
type Metric = typeof METRICS[number];
const LABELS: Record<Metric, string> = { population: 'Population', air: 'Mean air at homes', approval: 'Approval (points)', ihtShare: 'I-HT industrial job share (fraction)' };
const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');
const HELP = `NOTE-048 SIM A/A envelope
usage: node --experimental-strip-types tools/simAaEnvelope.mts --tree ROOT --out-dir DIR --quiet-gate FILE [--report FILE] [--report-only]
  --tree ROOT       code tree to measure (default: current directory); never written by the runner
  --out-dir DIR     raw JSON, annual NDJSON, logs and bundled child (required)
  --quiet-gate FILE lanes' quietrun.mjs; every bot process runs through it (required)
  --report FILE     Markdown output (default: this script's tree/docs/dev/reports/sim-aa-envelope.md)
  --report-only     regenerate the table from completed JSON without running bots
Completed runs with matching source fingerprints are reused. Use a fresh out-dir for the post-T041 base.`;

function parseOptions(argv: string[]): Options {
  const values: Record<string, string> = {};
  let reportOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--report-only') { reportOnly = true; continue; }
    if (!['--tree', '--out-dir', '--quiet-gate', '--report'].includes(flag)) throw new Error(`unknown option ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    values[flag] = value;
  }
  if (!values['--out-dir'] || !values['--quiet-gate']) throw new Error('--out-dir and --quiet-gate are required');
  return {
    tree: resolve(values['--tree'] ?? process.cwd()), outDir: resolve(values['--out-dir']),
    report: resolve(values['--report'] ?? join(ROOT, 'docs/dev/reports/sim-aa-envelope.md')),
    quietGate: resolve(values['--quiet-gate']), reportOnly,
  };
}

function sha(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function canonical(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) return {
    type: value.constructor.name, bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'),
  };
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}
function hash(value: unknown): string { return sha(JSON.stringify(canonical(value))); }
function json(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(`${path}.tmp`, path);
}
async function git(tree: string, outDir: string, ...args: string[]): Promise<string> {
  const stdoutPath = join(outDir, `.aa-git-${process.pid}.stdout`), stderrPath = join(outDir, `.aa-git-${process.pid}.stderr`);
  const stdoutFd = openSync(stdoutPath, 'w'), stderrFd = openSync(stderrPath, 'w');
  try {
    let exit: { code: number | null; signal: NodeJS.Signals | null };
    try {
      exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
        // Fixed git switches / repository-relative paths only; cwd carries the variable tree path. File-backed stdio
        // also works in Windows sandboxes that permit children but disallow the named pipes used by Node's collectors.
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
async function treeInfo(tree: string, outDir: string): Promise<TreeInfo> {
  const commit = await git(tree, outDir, 'rev-parse', 'HEAD');
  const diff = await git(tree, outDir, 'diff', '--binary', 'HEAD', '--', 'src', 'tools/simbot.ts');
  const untracked = (await git(tree, outDir, 'ls-files', '--others', '--exclude-standard', '--', 'src')).split(/\r?\n/).filter(Boolean).sort();
  const extra = untracked.map((name) => [name, sha(readFileSync(join(tree, name), 'utf8'))]);
  return {
    tree, commit, branch: await git(tree, outDir, 'branch', '--show-current'), dirty: (await git(tree, outDir, 'status', '--short')).split(/\r?\n/).filter(Boolean),
    sourceFingerprint: hash({ commit, diff, extra }), sourceDiffSha256: sha(diff),
  };
}
function rowId(row: RowSpec): string { return `${row.size}x${row.years}_s${row.seed}`; }
function runId(row: RowSpec, nudge?: number): string { return `${rowId(row)}_${nudge === undefined ? 'base' : 'plus1'}`; }
function quote(value: string): string { return `'${value.replace(/'/g, "''")}'`; }
function command(args: string[]): string { return args.map((arg) => /^[\w./:=+-]+$/.test(arg) ? arg : quote(arg)).join(' '); }
function cliArgs(row: RowSpec, nudge?: number): string[] {
  return ['--size', String(row.size), '--years', String(row.years), '--seed', String(row.seed),
    '--difficulty', 'medium', '--terrain', 'plains', '--water', '0.2', '--quiet',
    ...(nudge === undefined ? [] : ['--aa-funds-nudge', String(nudge)])];
}

/** Called only in a fresh, bundled node child; all observations happen after the bot's annual row. */
export async function runChild(
  botModule: typeof import('./simbot'), dev: { ID: number; IM: number; IHT: number },
  serializeCity: typeof import('../src/save/serialize').serializeCity, specPath: string,
): Promise<void> {
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as RunSpec;
  const opts = botModule.parseArgs(cliArgs(spec.row, spec.nudge));
  if (spec.nudge !== undefined && opts.aaFundsNudge !== spec.nudge) throw new Error('selected tree lacks --aa-funds-nudge support');
  opts.quiet = true;
  const bot = new botModule.SimBot(opts, await botModule.botSystems(false));
  const rows: Annual[] = [], startedAt = new Date().toISOString(), start = performance.now();
  writeFileSync(spec.annualPath, '', 'utf8');
  writeFileSync(spec.logPath, '', 'utf8');
  const log = (line: string) => { appendFileSync(spec.logPath, `${line}\n`, 'utf8'); console.log(line); };
  log(`SIMBOT size=${opts.size} years=${opts.years} seed=${opts.seed} ${opts.difficulty} ${opts.terrain}`);
  log(`command: ${spec.equivalentCommand}`);
  log(botModule.HEADER);
  bot.run(opts.years, (r) => {
    const st = bot.st, s = st.stats, jobs = s.jobsByDev;
    const industrialJobs = jobs[dev.ID] + jobs[dev.IM] + jobs[dev.IHT];
    const { econMsPerDay: _econ, totalMsPerDay: _total, ...botRow } = r;
    const saved = serializeCity(st, { copy: true });
    saved.savedAt = 0;
    const annual: Annual = {
      yearIndex: rows.length + 1, year: r.year, population: r.pop, air: s.avgAir ?? 0, approval: r.approval,
      ihtShare: industrialJobs > 0 ? jobs[dev.IHT] / industrialJobs : 0, industrialJobs,
      jobsByDev: [...jobs], residents: [...s.residents], funds: st.funds, botRow, rowHash: hash(botRow), stateHash: hash(saved),
    };
    rows.push(annual);
    appendFileSync(spec.annualPath, `${JSON.stringify(annual)}\n`, 'utf8');
    log(botModule.formatRow(r));
    console.error(`[${spec.id}] year ${annual.yearIndex}/${opts.years}: pop=${annual.population} air=${annual.air} approval=${annual.approval} IHT=${annual.ihtShare}`);
  });
  const s = bot.st.stats;
  log(`done in ${((performance.now() - start) / 1000).toFixed(1)}s; loans ${bot.st.budget.loans.length}; unlocked ${bot.st.unlocked.size}; approval ${s.approval.toFixed(0)}`);
  log(`residents ${JSON.stringify(s.residents)} jobs ${s.jobsByDev.join(',')} caps ${s.demandCap.join(',')}`);
  log(`last income ${JSON.stringify(bot.st.budget.lastIncome)}`);
  log(`last expense ${JSON.stringify(bot.st.budget.lastExpense)}`);
  log(bot.log.slice(-25).join('\n'));
  log(`news: ${bot.st.news.slice(-12).map((item) => item.text).join('\n  ')}`);
  const completed: CompletedRun = {
    schema: 1, complete: true, spec, startedAt, finishedAt: new Date().toISOString(), node: process.version,
    host: 'none', rows, seconds: (performance.now() - start) / 1000,
  };
  json(spec.jsonPath, completed);
}

async function bundleChild(opts: Options): Promise<string> {
  const entry = join(opts.outDir, 'aa-child-entry.mts'), output = join(opts.outDir, 'aa-child.mjs');
  writeFileSync(entry, [
    `import { runChild } from ${JSON.stringify(SELF)};`,
    `import * as botModule from ${JSON.stringify(join(opts.tree, 'tools/simbot.ts'))};`,
    `import { DevType } from ${JSON.stringify(join(opts.tree, 'src/core/types.ts'))};`,
    `import { serializeCity } from ${JSON.stringify(join(opts.tree, 'src/save/serialize.ts'))};`,
    `await runChild(botModule, DevType, serializeCity, process.argv[3]);`, '',
  ].join('\n'), 'utf8');
  const require = createRequire(join(opts.tree, 'package.json'));
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href) as typeof import('rolldown');
  const bundle = await rolldown({ input: entry, platform: 'node', logLevel: 'warn' });
  try { await bundle.write({ format: 'esm', dir: opts.outDir, entryFileNames: 'aa-child.mjs', chunkFileNames: 'aa-[name]-[hash].mjs' }); } finally { await bundle.close(); }
  return output;
}
function loadCompleted(path: string): CompletedRun | undefined {
  if (!existsSync(path)) return undefined;
  const run = JSON.parse(readFileSync(path, 'utf8')) as CompletedRun;
  if (run.schema !== 1 || !run.complete || run.rows.length !== run.spec.row.years) throw new Error(`invalid completed run: ${path}`);
  return run;
}
async function execute(opts: Options, spec: RunSpec, child: string, specPath: string): Promise<void> {
  console.error(`starting ${spec.id}: ${spec.command}`);
  await new Promise<void>((accept, reject) => {
    const proc = spawn(process.execPath, [opts.quietGate, process.execPath, child, '--aa-child', specPath], {
      cwd: opts.tree, stdio: 'inherit', windowsHide: true,
    });
    proc.once('error', reject);
    proc.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`${spec.id}: exited ${code ?? signal}`)));
  });
}
function fmt(value: number): string { return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12))); }
function pct(delta: number, base: number): number { return base === 0 ? delta === 0 ? 0 : Infinity : 100 * delta / Math.abs(base); }

function writeReport(opts: Options, runs: CompletedRun[], info: TreeInfo): void {
  const lines: string[] = ['# Shared SIM A/A envelope (NOTE-048)', '',
    `Measured commit: \`${info.commit}\` (branch \`${info.branch}\`). Host: \`none\`; independent node processes.`, '',
    `Source fingerprint: \`${info.sourceFingerprint}\`. Source diff SHA256: \`${info.sourceDiffSha256}\`.`, '',
    'The working tree includes the funds-nudge instrumentation; the commit identifies the underlying base. Dirty paths at measurement:', '',
    ...info.dirty.map((path) => `- \`${path.trim()}\``), '',
    `Completed runs: **${runs.length}/6**. ${runs.length === 6 ? 'All pairs are complete.' : 'This report is incomplete; missing pairs have no measured envelope.'}`, '',
    'Metrics use the annual bot callback: population and approval from the bot row, air from `stats.avgAir` (the same metric as `tests/sim/balance.test.ts`),',
    'and I-HT share = `jobsByDev[IHT] / (jobsByDev[ID] + jobsByDev[IM] + jobsByDev[IHT])`; agriculture is excluded. Shares are fractions.',
    'Year 10 means the tenth completed year (2010), inclusive. The absolute envelope is `max |nudge − base|` over those years.',
    'Its percentage uses the base value in the year of that maximum. The independent maximum annual relative percentage is also recorded; its peak can occur in another year.',
    'A zero base with a nonzero delta has an infinite relative percentage. Display values have 12 significant digits; raw JSON/NDJSON retain full precision.', '',
    'Each annual record also stores the timing-free bot row and its SHA256, residents, jobs by type and a canonical serialized-city SHA256.',
    'State hashing sets only the copied save timestamp to zero, sorts object keys, and encodes typed arrays by constructor name and raw base64 bytes.', '',
    '## Commands and raw evidence', '',
    'Run from the selected tree (the runner writes only the explicit output/report destinations):', '', '```powershell',
    command(['node', '--experimental-strip-types', SELF, '--tree', opts.tree, '--out-dir', opts.outDir, '--report', opts.report, '--quiet-gate', opts.quietGate]), '```', '',
    'Every actual child command below passes through the quiet gate. The adjacent simbot command is equivalent to the instrumented child\'s simulation options:', '',
  ];
  for (const run of runs) lines.push(`### ${run.spec.id}`, '', '```powershell', run.spec.command, run.spec.equivalentCommand, '```', '',
    `Raw: \`${relative(dirname(opts.report), run.spec.jsonPath).replaceAll('\\', '/')}\`; annual flush: \`${relative(dirname(opts.report), run.spec.annualPath).replaceAll('\\', '/')}\`; CLI-equivalent log: \`${relative(dirname(opts.report), run.spec.logPath).replaceAll('\\', '/')}\`.`,
    `Node ${run.node}; ${run.startedAt} → ${run.finishedAt}; ${fmt(run.seconds)} seconds. Final residents: \`[${run.rows.at(-1)!.residents.join(', ')}]\`.`, '');
  lines.push('## Envelope and annual pairs', '');
  for (const row of ROWS) {
    const base = runs.find((run) => run.spec.id === runId(row)), nudge = runs.find((run) => run.spec.id === runId(row, 1));
    lines.push(`### ${rowId(row)}`, '');
    if (!base || !nudge) { lines.push('Pair incomplete.', ''); continue; }
    const pairs = base.rows.filter((annual) => annual.yearIndex >= 10).map((annual) => {
      const other = nudge.rows.find((item) => item.yearIndex === annual.yearIndex);
      if (!other || other.year !== annual.year) throw new Error(`${rowId(row)}: unaligned annual data`);
      return { base: annual, nudge: other };
    });
    lines.push('| Metric | Max absolute Δ | Year | Base there | Relative Δ there | Max annual relative Δ | Year |',
      '|---|---:|---:|---:|---:|---:|---:|');
    for (const metric of METRICS) {
      const observations = pairs.map((pair) => ({ year: pair.base.year, base: pair.base[metric],
        delta: Math.abs(pair.nudge[metric] - pair.base[metric]), relative: pct(Math.abs(pair.nudge[metric] - pair.base[metric]), pair.base[metric]) }));
      const absolute = observations.reduce((a, b) => b.delta > a.delta ? b : a);
      const relativeMax = observations.reduce((a, b) => b.relative > a.relative ? b : a);
      lines.push(`| ${LABELS[metric]} | ${fmt(absolute.delta)} | ${absolute.year} | ${fmt(absolute.base)} | ${fmt(absolute.relative)}% | ${fmt(relativeMax.relative)}% | ${relativeMax.year} |`);
    }
    lines.push('', '| Year | Base pop | +§1 pop | Base air | +§1 air | Base approval | +§1 approval | Base I-HT share | +§1 I-HT share |',
      '|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const pair of pairs) lines.push(`| ${pair.base.year} | ${METRICS.flatMap((metric) => [fmt(pair.base[metric]), fmt(pair.nudge[metric])]).join(' | ')} |`);
    lines.push('');
  }
  lines.push('## How SIM lanes use this (NOTE-048)', '',
    'A base row passes within `max(the item’s tolerance, ±1%, this row/metric’s absolute A/A envelope)` in every year from year 10; convert a percentage tolerance using that year’s base value. The systematic-shift check still applies.',
    'A variant target missed by less than the metric’s A/A envelope counts as met when the direction also holds on the other seed; report the margin. A miss larger than the envelope remains a miss.',
    'This does not authorize compensating residential growth, weakening costs, free approval, re-recording a baseline to hide a miss, or changing the default bot strategy.', '',
    '## Re-measure after T041 (NEW-05 option B)', '',
    'Use the same script with the dev tree containing T041 and this flag. Choose a fresh output directory and a separate report so the two bases remain distinguishable:', '',
    '```powershell', command(['node', '--experimental-strip-types', SELF, '--tree', 'PATH_TO_DEV_WITH_T041', '--out-dir', 'FRESH_T041_SCRATCH', '--report', 'T041_ENVELOPE_REPORT.md', '--quiet-gate', opts.quietGate]), '```', '',
    'SIM lanes measure their final gates against that second envelope. To rebuild either table from its completed JSON, repeat its runner command with `--report-only`.', '');
  mkdirSync(dirname(opts.report), { recursive: true });
  writeFileSync(opts.report, lines.join('\n'), 'utf8');
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(HELP); return; }
  const opts = parseOptions(process.argv.slice(2));
  if (!existsSync(join(opts.tree, 'tools/simbot.ts'))) throw new Error(`missing simbot in ${opts.tree}`);
  if (!existsSync(opts.quietGate)) throw new Error(`missing quiet gate ${opts.quietGate}`);
  mkdirSync(opts.outDir, { recursive: true });
  const info = await treeInfo(opts.tree, opts.outDir), runs: CompletedRun[] = [];
  let child: string | undefined;
  for (const row of ROWS) for (const nudge of [undefined, 1]) {
    const id = runId(row, nudge), jsonPath = join(opts.outDir, `${id}.json`), specPath = join(opts.outDir, `${id}.spec.json`);
    const existing = loadCompleted(jsonPath);
    if (existing) {
      if (!opts.reportOnly && (existing.spec.treeInfo.tree !== opts.tree || existing.spec.treeInfo.sourceFingerprint !== info.sourceFingerprint)) throw new Error(`${id}: source changed; choose a fresh --out-dir`);
      runs.push(existing); console.error(`reusing ${id}`); continue;
    }
    if (opts.reportOnly) continue;
    if ((await treeInfo(opts.tree, opts.outDir)).sourceFingerprint !== info.sourceFingerprint) throw new Error('simulation source changed during measurement');
    child ??= await bundleChild(opts);
    const spec: RunSpec = {
      schema: 1, id, row, ...(nudge === undefined ? {} : { nudge }), treeInfo: info, jsonPath,
      annualPath: join(opts.outDir, `${id}.ndjson`), logPath: join(opts.outDir, `${id}.log`),
      command: command(['node', opts.quietGate, 'node', child, '--aa-child', specPath]),
      equivalentCommand: command(['node', opts.quietGate, 'npx', 'tsx', join(opts.tree, 'tools/simbot.ts'), ...cliArgs(row, nudge)]),
    };
    json(specPath, spec);
    await execute(opts, spec, child, specPath);
    if ((await treeInfo(opts.tree, opts.outDir)).sourceFingerprint !== info.sourceFingerprint) throw new Error('simulation source changed during measurement');
    const completed = loadCompleted(jsonPath);
    if (!completed) throw new Error(`${id}: child produced no completed JSON`);
    runs.push(completed);
    writeReport(opts, runs, info);
  }
  const reportInfo = runs[0]?.spec.treeInfo ?? info;
  if (runs.some((run) => run.spec.treeInfo.sourceFingerprint !== reportInfo.sourceFingerprint)) throw new Error('cannot combine results from different simulation sources');
  writeReport(opts, runs, reportInfo);
  console.error(`wrote ${opts.report} (${runs.length}/6 completed runs)`);
}

if (!process.argv.includes('--aa-child') && process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
