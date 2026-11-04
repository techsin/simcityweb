/** NOTE-053 ensemble collection. The selected tree is read only; every member uses the quiet gate. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Row, Source } from './simAaForkEnvelope.mjs';
const { bundleChild, validateCompleted } = await import(new URL('./simAaForkEnvelope.mts', import.meta.url).href) as typeof import('./simAaForkEnvelope.mjs');
const { METRICS, summarizeEnsemble } = await import(new URL('./simEnsembleStats.ts', import.meta.url).href) as typeof import('./simEnsembleStats');

interface Options extends Row {
  tree: string; outDir: string; quietGate: string; importDirs: string[];
  nudge: number; runs: 5 | 9; jobs: number; botArgs: string[]; reportOnly: boolean; members?: string[];
}
interface Identity extends Source { dependencies: string; observer: string }
interface Member { nudge: number; day: number; id: string }
interface MemberSpec extends Member, Row, Identity {
  cacheKey: string; botArgs: string[]; command: string; equivalentCommand: string;
  jsonPath: string; annualPath: string; actionPath: string; logPath: string;
  importedFrom?: { path: string; commit: string; sha256: string };
}
interface Execution { startedAt: string; finishedAt: string; gatePid?: number; schedulerJobs: number; processLogPath: string }
type Completed = ReturnType<typeof validateCompleted> & { spec: MemberSpec; execution?: Execution };
interface Evidence { path: string; run: Completed }
const SELF = fileURLToPath(import.meta.url);
const DEFAULTS = { difficulty: 'medium', terrain: 'plains', water: 0.2, noInfra: false, profile: 'default' };
const HELP = `NOTE-053 SIM ensemble
usage: node --experimental-strip-types tools/simEnsemble.mts --tree ROOT --size N --years N --seed N --out-dir DIR --quiet-gate FILE [options]
  --nudge X         positive funds amount (default 100)
  --runs 5|9        control, +/-X on days 1 and 1441; 9 adds +/-2X at both timings
  --jobs N          maximum concurrent quiet-gated members (default 3)
  --import-dir DIR  repeatable explicit import of old default-configuration records; simulation source must match
  --bot-args JSON   JSON array of variant bot arguments; alternatively put arguments after --
  --report-only     require completed cached/imported members; launch no bots
  --members IDS     diagnostic comma-separated member IDs, e.g. control,p100-d1,m100-d1
                    a subset writes a partial manifest, never an ensemble summary
Output: ROW_ensemble.summary.json and ROW_ensemble.md, plus individually keyed complete raw members.
Reuse requires exact tree commit, simbot/src identity, dependencies, observer, row, amount, timing and bot args.
Explicit legacy imports retain original provenance and require identical simulation sources and default configuration.
Compare: append the compare subcommand; use compare --help for verdict options.`;

function digest(value: unknown): string { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function atomicJSON(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(`${path}.tmp`, path);
}
function command(args: string[]): string {
  const words = args.map((arg) => /^[\w./:=+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "''")}'`);
  return `${words[0]?.startsWith("'") ? '& ' : ''}${words.join(' ')}`;
}
export function rowId(row: Row): string { return `${row.size}x${row.years}_s${row.seed}`; }
function rawId(row: Row, nudge: number, day: number): string { return `${rowId(row)}_${nudge ? `n${nudge}_d${day}` : 'base'}`; }
function shortId(nudge: number, day: number): string { return nudge ? `${nudge > 0 ? 'p' : 'm'}${Math.abs(nudge)}-d${day}` : 'control'; }
export function ensembleMembers(nudge: number, runs: 5 | 9): { nudge: number; day: number; id: string }[] {
  if (!Number.isFinite(nudge) || nudge <= 0 || ![5, 9].includes(runs) || runs === 9 && !Number.isFinite(2 * nudge)) throw new Error('invalid ensemble nudge or member count');
  return [{ nudge: 0, day: 1, id: 'control' }, ...[1, ...(runs === 9 ? [2] : [])].flatMap((multiple) =>
    [1, 1441].flatMap((day) => [nudge * multiple, -nudge * multiple].map((amount) => ({ nudge: amount, day, id: shortId(amount, day) }))))];
}
export function validateBotArgs(args: unknown): string[] {
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) throw new Error('--bot-args must be a JSON array of strings');
  const booleans = ['--no-infra', '--subway', '--late-ordinances', '--venues', '--spendy', '--neglect'];
  const values = ['--difficulty', '--terrain', '--water', '--tax', '--tax-start-year', '--profile', '--skip'];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], [flag, assigned] = arg.split('=', 2);
    if (booleans.includes(flag) && assigned === undefined) continue;
    if (!values.includes(flag)) throw new Error(`unsupported variant argument ${arg}; selectors, nudge and save output are owned by the ensemble runner`);
    const value = assigned ?? args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    if (flag === '--difficulty' && !['easy', 'medium', 'hard', 'sandbox'].includes(value)) throw new Error('invalid difficulty');
    if (flag === '--profile' && !['default', 'newcomer'].includes(value)) throw new Error('invalid profile');
    if (flag === '--water' && (!Number.isFinite(+value) || +value < 0 || +value > 1)) throw new Error('water must be in [0,1]');
    if (flag === '--tax' && (!Number.isFinite(+value) || +value < 0 || +value > 20)) throw new Error('tax must be in [0,20]');
    if (flag === '--tax-start-year' && (!Number.isInteger(+value) || +value < 1)) throw new Error('tax start year must be a positive integer');
    if (assigned !== undefined && !['--tax', '--tax-start-year'].includes(flag)) throw new Error(`use ${flag} VALUE instead of equals syntax`);
  }
  return args;
}
/** Older bots silently ignore unknown flags. A requested variant must actually reach the selected parser. */
export function assertParsedBotArgs(args: string[], parsed: Record<string, unknown>): void {
  const properties: Record<string, string> = { '--no-infra': 'noInfra', '--late-ordinances': 'lateOrdinances', '--tax-start-year': 'taxStartYear' };
  const booleans = ['--no-infra', '--subway', '--late-ordinances', '--venues', '--spendy', '--neglect'];
  const expected: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    const [flag, assigned] = args[i].split('=', 2), key = properties[flag] ?? flag.slice(2);
    const value = booleans.includes(flag) ? true : assigned ?? args[++i];
    expected[key] = ['--water', '--tax', '--tax-start-year'].includes(flag) ? Number(value) : flag === '--skip' ? String(value).split(',') : value;
  }
  for (const [key, value] of Object.entries(expected)) if (JSON.stringify(parsed[key]) !== JSON.stringify(value)) throw new Error(`selected bot did not apply variant argument ${key}`);
}
async function bundleVariantChild(opts: Options): Promise<string> {
  if (!opts.botArgs.length) return bundleChild(opts);
  const entry = join(opts.outDir, 'ensemble-variant-entry.mts');
  writeFileSync(entry, [
    `import { runChild } from ${JSON.stringify(fileURLToPath(new URL('./simAaForkEnvelope.mts', import.meta.url)))};`,
    `const assertParsedBotArgs = ${assertParsedBotArgs.toString()};`,
    `import * as botModule from ${JSON.stringify(join(opts.tree, 'tools/simbot.ts'))};`,
    `import { DevType } from ${JSON.stringify(join(opts.tree, 'src/core/types.ts'))};`,
    `import { serializeCity } from ${JSON.stringify(join(opts.tree, 'src/save/serialize.ts'))};`,
    `import { readFileSync } from 'node:fs';`,
    `const spec = JSON.parse(readFileSync(process.argv[3], 'utf8'));`,
    `const guarded = { ...botModule, parseArgs(args) { const parsed = botModule.parseArgs(args); assertParsedBotArgs(spec.botArgs, parsed); return parsed; } };`,
    'await runChild(guarded, DevType, serializeCity, process.argv[3]);', '',
  ].join('\n'), 'utf8');
  const require = createRequire(join(opts.tree, 'package.json'));
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href) as typeof import('rolldown');
  const bundle = await rolldown({ input: entry, platform: 'node', logLevel: 'warn' });
  try { await bundle.write({ format: 'esm', dir: opts.outDir, entryFileNames: 'ensemble-variant-child.mjs', chunkFileNames: 'ensemble-variant-[name]-[hash].mjs' }); } finally { await bundle.close(); }
  return join(opts.outDir, 'ensemble-variant-child.mjs');
}
export function parseOptions(argv: string[]): Options {
  const values: Record<string, string> = {}, importDirs: string[] = [];
  let reportOnly = false, trailing: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--') { trailing = argv.slice(i + 1); break; }
    if (flag === '--report-only') { reportOnly = true; continue; }
    if (!['--tree', '--size', '--years', '--seed', '--out-dir', '--quiet-gate', '--nudge', '--runs', '--jobs', '--import-dir', '--bot-args', '--members'].includes(flag)) throw new Error(`unknown option ${flag}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    if (flag === '--import-dir') importDirs.push(resolve(value)); else values[flag] = value;
  }
  const size = Number(values['--size']), years = Number(values['--years']), seed = Number(values['--seed']);
  if (!(size === 128 && years === 15 && seed === 7 || size === 256 && years === 60 && [7, 11].includes(seed))) throw new Error('row must be 128x15 s7, 256x60 s7 or 256x60 s11');
  const nudge = Number(values['--nudge'] ?? 100), runs = Number(values['--runs'] ?? 5), jobs = Number(values['--jobs'] ?? 3);
  if (!Number.isFinite(nudge) || nudge <= 0) throw new Error('--nudge must be finite and positive');
  if (runs !== 5 && runs !== 9) throw new Error('--runs must be 5 or 9');
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error('--jobs must be a positive integer');
  if (!values['--out-dir'] || !values['--quiet-gate']) throw new Error('--out-dir and --quiet-gate are required');
  if (values['--bot-args'] && trailing.length) throw new Error('use either --bot-args or trailing bot arguments');
  const botArgs = validateBotArgs(values['--bot-args'] ? JSON.parse(values['--bot-args']) : trailing);
  const members = values['--members']?.split(',');
  if (members && (new Set(members).size !== members.length || members.some((id) => !ensembleMembers(nudge, runs).some((member) => member.id === id)))) throw new Error('--members contains an unknown or duplicate member');
  return { tree: resolve(values['--tree'] ?? process.cwd()), outDir: resolve(values['--out-dir']), quietGate: resolve(values['--quiet-gate']),
    size, years, seed, nudge, runs, jobs, importDirs, botArgs, reportOnly, ...(members ? { members } : {}) };
}

let gitCounter = 0;
async function git(tree: string, outDir: string, ...args: string[]): Promise<string> {
  const prefix = join(outDir, `.ensemble-git-${process.pid}-${gitCounter++}`), out = `${prefix}.out`, err = `${prefix}.err`;
  const stdout = openSync(out, 'w'), stderr = openSync(err, 'w');
  try {
    let code: number | null;
    try {
      code = await new Promise<number | null>((accept, reject) => {
        const child = spawn(['git', ...args].join(' '), { cwd: tree, shell: true, windowsHide: true, stdio: ['ignore', stdout, stderr] });
        child.once('error', reject); child.once('close', accept);
      });
    } finally { closeSync(stdout); closeSync(stderr); }
    if (code !== 0) throw new Error(`git ${args.join(' ')} failed: ${readFileSync(err, 'utf8').trim() || code}`);
    return readFileSync(out, 'utf8').trimEnd();
  } finally { if (existsSync(out)) unlinkSync(out); if (existsSync(err)) unlinkSync(err); }
}
async function identity(opts: Options): Promise<Identity> {
  if (await git(opts.tree, opts.outDir, 'diff', '--binary', 'HEAD', '--', 'src', 'tools/simbot.ts', 'package.json', 'package-lock.json')) throw new Error('selected simulation or dependency files have tracked changes');
  if (await git(opts.tree, opts.outDir, 'ls-files', '--others', '--exclude-standard', '--', 'src')) throw new Error('selected simulation contains untracked sources');
  const dependencyFiles = ['package.json', 'package-lock.json'].map((name) => [name, existsSync(join(opts.tree, name)) ? readFileSync(join(opts.tree, name), 'utf8') : null]);
  return { commit: await git(opts.tree, opts.outDir, 'rev-parse', 'HEAD'), simBlob: await git(opts.tree, opts.outDir, 'hash-object', 'tools/simbot.ts'),
    srcTree: await git(opts.tree, opts.outDir, 'rev-parse', 'HEAD:src'), dependencies: digest(dependencyFiles),
    observer: digest(readFileSync(fileURLToPath(new URL('./simAaForkEnvelope.mts', import.meta.url)), 'utf8')) };
}
export function memberCacheKey(source: Identity, row: Row, member: Pick<Member, 'nudge' | 'day'>, botArgs: string[]): string {
  return digest({ format: 1, source, row: { size: row.size, years: row.years, seed: row.seed }, nudge: member.nudge, day: member.day, botArgs });
}
function load(path: string, opts: Options, source: Identity, member: Member, key: string): Evidence | undefined {
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, 'utf8'));
  const run = validateCompleted(value, opts, source, member.nudge, member.day, path) as Completed;
  if (run.spec.cacheKey !== key || run.spec.commit !== source.commit || run.spec.dependencies !== source.dependencies || run.spec.observer !== source.observer || JSON.stringify(run.spec.botArgs) !== JSON.stringify(opts.botArgs)) throw new Error(`ensemble cache identity mismatch: ${path}`);
  if (run.spec.jsonPath !== path || run.spec.annualPath !== path.replace(/\.json$/, '.ndjson') || run.spec.actionPath !== path.replace(/\.json$/, '.actions.ndjson') || run.spec.logPath !== path.replace(/\.json$/, '.actions.log')) throw new Error(`ensemble output path mismatch: ${path}`);
  restoreSidecars(run);
  return { path, run };
}
function restoreSidecars(run: Completed): void {
  if (!existsSync(run.spec.annualPath)) writeFileSync(run.spec.annualPath, `${run.rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  if (!existsSync(run.spec.actionPath)) writeFileSync(run.spec.actionPath, `${run.actions.map((action) => JSON.stringify(action)).join('\n')}\n`, 'utf8');
  if (!existsSync(run.spec.logPath)) writeFileSync(run.spec.logPath, `${run.log.map((entry) => `[day ${entry.day}, ${entry.date}] ${entry.text}`).join('\n')}\n`, 'utf8');
}
function importLegacy(opts: Options, source: Identity, member: Member, spec: MemberSpec): Evidence | undefined {
  if (opts.botArgs.length) return undefined;
  for (const dir of opts.importDirs) {
    const path = join(dir, `${rawId(opts, member.nudge, member.day)}.json`);
    if (!existsSync(path)) continue;
    const original = readFileSync(path, 'utf8'), value = JSON.parse(original);
    // An explicit import permits a docs-only commit change, never a simulation/configuration change.
    const run = validateCompleted(value, opts, source, member.nudge, member.day, path);
    if (run.spec.configuration && JSON.stringify(run.spec.configuration) !== JSON.stringify(DEFAULTS) || (run.spec as MemberSpec).botArgs?.length) throw new Error(`legacy import is not default configuration: ${path}`);
    const promoted = { ...run, spec: { ...spec, importedFrom: { path, commit: run.spec.commit, sha256: digest(original) },
      command: run.spec.command, equivalentCommand: run.spec.equivalentCommand } };
    atomicJSON(spec.jsonPath, promoted);
    console.error(`IMPORT ${member.id} from ${path}`);
    return load(spec.jsonPath, opts, source, member, spec.cacheKey);
  }
  return undefined;
}
function cliArgs(opts: Options, member: Member): string[] {
  return ['--size', String(opts.size), '--years', String(opts.years), '--seed', String(opts.seed), '--quiet', ...opts.botArgs,
    ...(member.day === 1 && member.nudge ? ['--aa-funds-nudge', String(member.nudge)] : [])];
}
function numeric(value: number): string { return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(10))); }
function writeSummary(opts: Options, source: Identity, evidence: Evidence[]): void {
  const members = evidence.map(({ path, run }) => ({ id: shortId(run.spec.nudge, run.spec.day), path, cacheKey: run.spec.cacheKey,
    nudge: run.spec.nudge, day: run.spec.day, command: run.spec.command, ...(run.spec.importedFrom ? { importedFrom: run.spec.importedFrom } : {}),
    ...(run.execution ? { execution: run.execution } : {}) }));
  const full = evidence.length === opts.runs;
  const summary = { protocol: 'NOTE-053', complete: full, row: { size: opts.size, years: opts.years, seed: opts.seed }, source,
    configuration: { botArgs: opts.botArgs }, nudge: opts.nudge, runs: opts.runs, jobs: opts.jobs, members,
    ...(full ? { years: summarizeEnsemble(evidence.map(({ run }) => ({ id: run.spec.id, rows: run.rows }))) } : {}) };
  const stem = join(opts.outDir, `${rowId(opts)}_ensemble${full ? '.summary' : '.partial'}`);
  atomicJSON(`${stem}.json`, summary);
  if (!full) {
    console.error(`PARTIAL ${stem}.json; any earlier complete summary/Markdown is unchanged and does not describe this diagnostic selection.`);
    return;
  }
  const lines = [`# NOTE-053 ${rowId(opts)} ensemble`, '', `Commit: \`${source.commit}\`; nudge: ${opts.nudge}; ${opts.runs} members.`, '',
    'Each cell is median [min, max]. Approval is in points; I-HT share is a fraction. The gate judges every year from year 10.', '',
    '| Year index | Calendar year | Population | Approval | Air at homes | I-HT share |', '|---:|---:|---:|---:|---:|---:|'];
  for (const year of summary.years!) lines.push(`| ${year.yearIndex} | ${year.year} | ${METRICS.map((metric) => {
    const band = year.metrics[metric]; return `${numeric(band.median)} [${numeric(band.min)}, ${numeric(band.max)}]`;
  }).join(' | ')} |`);
  lines.push('', '## Members', '', '| Member | Nudge | Day | Raw completed output |', '|---|---:|---:|---|');
  for (const member of members) lines.push(`| ${member.id} | ${member.nudge} | ${member.day} | \`${member.path}\` |`);
  lines.push('', '## Repeat', '', '```powershell', command([process.execPath, '--experimental-strip-types', SELF, '--tree', opts.tree,
    '--size', String(opts.size), '--years', String(opts.years), '--seed', String(opts.seed), '--out-dir', opts.outDir,
    '--quiet-gate', opts.quietGate, '--nudge', String(opts.nudge), '--runs', String(opts.runs), '--jobs', String(opts.jobs),
    ...(opts.botArgs.length ? ['--bot-args', JSON.stringify(opts.botArgs)] : [])]), '```', '');
  writeFileSync(join(opts.outDir, `${rowId(opts)}_ensemble.md`), lines.join('\n'), 'utf8');
}
export async function measure(opts: Options): Promise<void> {
  if (!existsSync(join(opts.tree, 'tools/simbot.ts')) || !existsSync(opts.quietGate)) throw new Error('selected tree simbot or quiet gate is missing');
  mkdirSync(opts.outDir, { recursive: true });
  const source = await identity(opts), members = ensembleMembers(opts.nudge, opts.runs).filter((member) => !opts.members || opts.members.includes(member.id));
  let child: string | undefined;
  const pending: { member: Member; spec: MemberSpec }[] = [], completed = new Map<string, Evidence>();
  for (const member of members) {
    const key = memberCacheKey(source, opts, member, opts.botArgs), stem = join(opts.outDir, `${rawId(opts, member.nudge, member.day)}_${key.slice(0, 16)}`);
    const spec: MemberSpec = { ...source, ...member, id: rawId(opts, member.nudge, member.day), size: opts.size, years: opts.years, seed: opts.seed,
      botArgs: opts.botArgs, cacheKey: key, jsonPath: `${stem}.json`, annualPath: `${stem}.ndjson`, actionPath: `${stem}.actions.ndjson`, logPath: `${stem}.actions.log`,
      command: '', equivalentCommand: member.day === 1 ? command(['node', opts.quietGate, 'npx', 'tsx', join(opts.tree, 'tools/simbot.ts'), ...cliArgs(opts, member)])
        : `observer adds ${member.nudge} funds once on day ${member.day}, after advanceDay and before daily; bot args ${JSON.stringify(cliArgs(opts, member))}` };
    const found = load(spec.jsonPath, opts, source, member, key) ?? importLegacy(opts, source, member, spec);
    if (found) { completed.set(member.id, found); console.error(`REUSE ${member.id} ${found.path}`); }
    else if (opts.reportOnly) throw new Error(`missing completed ${member.id}; omit --report-only to measure`);
    else pending.push({ member, spec });
  }
  if (pending.length) child = await bundleVariantChild(opts);
  let next = 0, failure: unknown;
  await Promise.all(Array.from({ length: Math.min(opts.jobs, pending.length) }, async () => {
    while (!failure && next < pending.length) {
      const { member, spec } = pending[next++], specPath = spec.jsonPath.replace(/\.json$/, '.spec.json');
      try {
        spec.command = command([process.execPath, opts.quietGate, process.execPath, child!, '--fork-child', specPath]);
        atomicJSON(specPath, spec);
        console.error(`START ${member.id}; log ${spec.jsonPath.replace(/\.json$/, '.process.log')}`);
        const processLogPath = spec.jsonPath.replace(/\.json$/, '.process.log');
        const log = openSync(processLogPath, 'w'), startedAt = new Date().toISOString();
        let gatePid: number | undefined;
        try {
          await new Promise<void>((accept, reject) => {
            const proc = spawn(process.execPath, [opts.quietGate, process.execPath, child!, '--fork-child', specPath], { cwd: opts.tree, stdio: ['ignore', log, log], windowsHide: true });
            gatePid = proc.pid;
            proc.once('error', reject); proc.once('close', (code, signal) => code === 0 ? accept() : reject(new Error(`${member.id} exited ${code ?? signal}`)));
          });
        } finally { closeSync(log); }
        const result = load(spec.jsonPath, opts, source, member, spec.cacheKey);
        if (!result) throw new Error(`no completed output for ${member.id}`);
        result.run.execution = { startedAt, finishedAt: new Date().toISOString(), gatePid, schedulerJobs: opts.jobs, processLogPath };
        atomicJSON(spec.jsonPath, result.run);
        completed.set(member.id, result); console.error(`DONE ${member.id}`);
      } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
  if (JSON.stringify(await identity(opts)) !== JSON.stringify(source)) throw new Error('selected source identity changed during measurement');
  writeSummary(opts, source, members.map((member) => completed.get(member.id)!));
  console.error(`WROTE ${join(opts.outDir, `${rowId(opts)}_ensemble`)} (${completed.size} members)`);
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === 'compare') {
    const { compareCli } = await import(new URL('./simEnsembleCompare.mts', import.meta.url).href) as typeof import('./simEnsembleCompare.mjs');
    await compareCli(args.slice(1)); return;
  }
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  await measure(parseOptions(args));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error); process.exitCode = 1;
});
