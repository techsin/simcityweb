/** NOTE-053 comparison CLI. Collection stays in simEnsemble.mts; this command launches no bots. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AnnualBand, BaseComparison, Metric, Tolerance, VariantTarget } from './simEnsembleStats';
const { compareBase, compareVariant, METRICS, relativeSignoff, systematicShift } = await import(new URL('./simEnsembleStats.ts', import.meta.url).href) as typeof import('./simEnsembleStats');

interface Summary {
  protocol: 'NOTE-053'; complete: true; row: { size: number; years: number; seed: number };
  source: { commit: string; simBlob: string; srcTree: string; dependencies?: string; observer?: string };
  configuration: { botArgs: string[] }; nudge: number; runs: 5 | 9;
  members: { id: string; nudge: number; day: number }[]; years: AnnualBand[];
}
interface Input { path: string; summary: Summary }
export interface CompareCliOptions {
  mode: 'base' | 'variant' | 'signoff'; dev: string[]; lane: string[]; base?: string; variant?: string;
  metrics: Metric[]; tolerance: Tolerance; target?: VariantTarget; signoffPercent: number;
  fromYear: number; throughYear?: number; outDir: string;
}
const HELP = `NOTE-053 ensemble comparison (no bot processes)
usage: node --experimental-strip-types tools/simEnsemble.mts compare MODE [options]
  base     --dev FILE --lane FILE (repeat both for the three-row systematic check)
  variant  --dev FILE --base FILE --variant FILE --metric NAME --target-below-percent 2
  signoff  --dev FILE --lane FILE (repeatable) --signoff-percent 3
  --out-dir DIR        required; write MODE.compare.json and MODE.compare.md
  --metric NAME        repeatable, or comma-separated; base/signoff default to all four metrics
  --tolerance N        absolute item tolerance for base checks (default 0)
  --tolerance-percent N percent item tolerance, resolved against each year's dev median
  --target-below-percent N | --target-above-percent N | --target-below N | --target-above N
  --from-year N        first bot year index (default 10)
  --to-year N          last bot year index (default row end)
Base/variant comparisons require matching row, nudge and run count (5 with 5, or 9 with 9).
Variant/base require the exact same lane commit and different bot arguments. Dev supplies the stage-two band.
Every active base boundary within half of dev's band triggers nine runs, even for passing checks and zero bands.
The systematic check needs all three rows and uses each row's last year (15, 60, 60).
Exit: 0 pass; 1 fail; 2 rerun named rows with --runs 9; 3 investigate a systematic shift; 4 supply all three base rows.
Signoff reports the selected years, but only the actual row endpoint reopens the historical sign-off.`;

function numeric(value: string, flag: string): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${flag} requires a finite nonnegative number`);
  return result;
}
export function parseCompareOptions(argv: string[]): CompareCliOptions {
  const mode = argv[0];
  if (!['base', 'variant', 'signoff'].includes(mode)) throw new Error('comparison mode must be base, variant or signoff');
  const values: Record<string, string> = {}, dev: string[] = [], lane: string[] = [], metrics: Metric[] = [];
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (!['--dev', '--lane', '--base', '--variant', '--metric', '--tolerance', '--tolerance-percent', '--out-dir', '--from-year', '--to-year',
      '--target-below-percent', '--target-above-percent', '--target-below', '--target-above', '--signoff-percent'].includes(flag)) throw new Error(`unknown compare option ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    if (flag === '--dev') dev.push(resolve(value));
    else if (flag === '--lane') lane.push(resolve(value));
    else if (flag === '--metric') {
      for (const metric of value.split(',')) {
        if (!METRICS.includes(metric as Metric)) throw new Error(`unknown metric ${metric}`);
        if (!metrics.includes(metric as Metric)) metrics.push(metric as Metric);
      }
    } else {
      if (values[flag] !== undefined) throw new Error(`duplicate compare option ${flag}`);
      values[flag] = value;
    }
  }
  if (!values['--out-dir']) throw new Error('--out-dir is required');
  if (!dev.length || mode !== 'variant' && (!lane.length || lane.length !== dev.length)) throw new Error('supply a --dev and --lane file for each compared row');
  if (values['--tolerance'] !== undefined && values['--tolerance-percent'] !== undefined) throw new Error('choose absolute or percent tolerance');
  const tolerance: Tolerance = values['--tolerance-percent'] !== undefined ? { kind: 'percent', value: numeric(values['--tolerance-percent'], '--tolerance-percent') }
    : { kind: 'absolute', value: numeric(values['--tolerance'] ?? '0', '--tolerance') };
  const fromYear = numeric(values['--from-year'] ?? '10', '--from-year'), throughYear = values['--to-year'] === undefined ? undefined : numeric(values['--to-year'], '--to-year');
  if (!Number.isInteger(fromYear) || fromYear < 1 || throughYear !== undefined && (!Number.isInteger(throughYear) || throughYear < fromYear)) throw new Error('invalid comparison year range');
  const targetFlags = ['--target-below-percent', '--target-above-percent', '--target-below', '--target-above'].filter((flag) => values[flag] !== undefined);
  let target: VariantTarget | undefined;
  if (mode === 'variant') {
    if (dev.length !== 1 || lane.length || !values['--base'] || !values['--variant'] || metrics.length !== 1 || targetFlags.length !== 1) throw new Error('variant needs one dev, base, variant, metric and target');
    const flag = targetFlags[0];
    target = { metric: metrics[0], direction: flag.includes('below') ? 'below' : 'above', amount: { kind: flag.endsWith('percent') ? 'percent' : 'absolute', value: numeric(values[flag], flag) } };
  } else if (targetFlags.length || values['--base'] || values['--variant']) throw new Error('base/variant files and targets require variant mode');
  if (mode !== 'base' && (values['--tolerance'] !== undefined || values['--tolerance-percent'] !== undefined)) throw new Error('item tolerance is only used by base mode');
  if (mode !== 'signoff' && values['--signoff-percent'] !== undefined) throw new Error('--signoff-percent requires signoff mode');
  return { mode: mode as CompareCliOptions['mode'], dev, lane, metrics: metrics.length ? metrics : [...METRICS], tolerance, target,
    signoffPercent: numeric(values['--signoff-percent'] ?? '3', '--signoff-percent'), fromYear, throughYear,
    outDir: resolve(values['--out-dir']), ...(values['--base'] ? { base: resolve(values['--base']) } : {}), ...(values['--variant'] ? { variant: resolve(values['--variant']) } : {}) };
}
function rowId(value: Summary): string { const row = value.row; return `${row.size}x${row.years}_s${row.seed}`; }
export function validateSummary(value: unknown, path = 'ensemble summary'): Summary {
  const result = value as Summary, row = result?.row;
  if (!result || result.protocol !== 'NOTE-053' || result.complete !== true || !row ||
      !(row.size === 128 && row.years === 15 && row.seed === 7 || row.size === 256 && row.years === 60 && [7, 11].includes(row.seed)) ||
      !result.source || !['commit', 'simBlob', 'srcTree'].every((key) => {
        const identity = result.source[key as keyof Summary['source']]; return typeof identity === 'string' && identity.length > 0;
      }) ||
      !result.configuration || !Array.isArray(result.configuration.botArgs) || !result.configuration.botArgs.every((arg) => typeof arg === 'string') ||
      ![5, 9].includes(result.runs) || !Number.isFinite(result.nudge) || result.nudge <= 0 || !Array.isArray(result.members) || result.members.length !== result.runs ||
      !Array.isArray(result.years) || result.years.length !== row.years) throw new Error(`invalid complete ensemble summary: ${path}`);
  const expected = ['0:1', ...[1, ...(result.runs === 9 ? [2] : [])].flatMap((multiple) => [1, 1441].flatMap((day) => [`${multiple * result.nudge}:${day}`, `${-multiple * result.nudge}:${day}`]))].sort();
  const actual = result.members.map((member) => `${member.nudge}:${member.day}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected) || new Set(result.members.map((member) => member.id)).size !== result.runs) throw new Error(`invalid ensemble members: ${path}`);
  if (['dependencies', 'observer'].some((key) => {
    const identity = result.source[key as keyof Summary['source']]; return identity !== undefined && (typeof identity !== 'string' || identity.length === 0);
  })) throw new Error(`invalid optional source identity: ${path}`);
  if (result.years.some((year, index) => year.yearIndex !== index + 1)) throw new Error(`incomplete ensemble years: ${path}`);
  compareBase(result.years, result.years); // Validate every annual metric/band before reading any verdict.
  return result;
}
function load(path: string): Input { return { path, summary: validateSummary(JSON.parse(readFileSync(path, 'utf8')), path) }; }
export function validateComparisonPair(dev: Summary, lane: Summary, sameConfiguration = true): void {
  if (rowId(dev) !== rowId(lane) || dev.runs !== lane.runs || dev.nudge !== lane.nudge) throw new Error('comparison requires the same row, nudge and run count; collect both sides with --runs 9 for stage two');
  if (sameConfiguration && JSON.stringify(dev.configuration) !== JSON.stringify(lane.configuration)) throw new Error('base comparison configuration differs');
}
export function validateVariantPair(base: Summary, variant: Summary): void {
  validateComparisonPair(base, variant, false);
  if (base.source.commit !== variant.source.commit || base.source.simBlob !== variant.source.simBlob || base.source.srcTree !== variant.source.srcTree) throw new Error('variant and base must use the exact same lane commit and simulation sources');
  if (base.source.dependencies !== variant.source.dependencies || base.source.observer !== variant.source.observer) throw new Error('variant and base dependency or observer identity differs');
  if (JSON.stringify(base.configuration) === JSON.stringify(variant.configuration)) throw new Error('variant and base bot arguments must differ');
}
function fmt(value: number | null): string { return value === null ? 'undefined (zero reference)' : Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(10))); }
function selectedBase(result: BaseComparison, metrics: Metric[]) {
  const years = result.years.map((year) => ({ ...year, pass: metrics.every((metric) => year.metrics[metric].pass),
    metrics: Object.fromEntries(metrics.map((metric) => [metric, year.metrics[metric]])) }));
  const nearThreshold = years.some((year) => metrics.some((metric) => year.metrics[metric].nearThreshold));
  return { ...result, years, pass: years.every((year) => year.pass), nearThreshold, needsNine: result.runs === 5 && nearThreshold };
}
function pairRows(options: CompareCliOptions) {
  const dev = options.dev.map(load), lane = options.lane.map(load);
  if (new Set(dev.map((input) => rowId(input.summary))).size !== dev.length || new Set(lane.map((input) => rowId(input.summary))).size !== lane.length) throw new Error('duplicate compared row');
  if (new Set(dev.map((input) => input.summary.source.commit)).size !== 1 || new Set(lane.map((input) => input.summary.source.commit)).size !== 1) throw new Error('all dev rows and all lane rows must each use one tree commit');
  return dev.map((reference) => {
    const other = lane.find((input) => rowId(input.summary) === rowId(reference.summary));
    if (!other) throw new Error(`missing lane row ${rowId(reference.summary)}`);
    validateComparisonPair(reference.summary, other.summary);
    return { dev: reference, lane: other, id: rowId(reference.summary) };
  });
}
function instructions(rows: string[]): string { return rows.length ? `Rerun these rows on both compared trees with --runs 9: ${rows.join(', ')}. Existing five members are reused.` : 'No additional nine-run rows requested.'; }
export async function compareCli(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return; }
  const options = parseCompareOptions(argv), lines: string[] = [`# NOTE-053 ${options.mode} comparison`, '',
    `Metrics: ${options.metrics.join(', ')}; bot years ${options.fromYear} through ${options.throughYear ?? 'row end'}.`, ''];
  const range = { fromYear: options.fromYear, throughYear: options.throughYear };
  let output: unknown, pass: boolean, needsNine: string[] = [], realShift = false, incompleteSystematic = false;
  if (options.mode === 'base') {
    const pairs = pairRows(options);
    const results = pairs.map(({ id, dev, lane }) => ({ row: id, dev: dev.path, lane: lane.path,
      devCommit: dev.summary.source.commit, laneCommit: lane.summary.source.commit,
      ...selectedBase(compareBase(dev.summary.years, lane.summary.years, { ...range, tolerance: options.tolerance, runs: dev.summary.runs }), options.metrics) }));
    const shifts = pairs.length === 3 ? systematicShift(pairs.map((pair) => ({ id: pair.id, dev: pair.dev.summary.years, lane: pair.lane.summary.years }))) : null;
    incompleteSystematic = shifts === null;
    realShift = shifts !== null && options.metrics.some((metric) => shifts[metric].realShift);
    pass = results.every((result) => result.pass); needsNine = results.filter((result) => result.needsNine).map((result) => result.row);
    output = { results, systematicShift: shifts ? Object.fromEntries(options.metrics.map((metric) => [metric, shifts[metric]])) : null,
      systematicShiftStatus: shifts ? realShift ? 'investigate-real-shift' : 'no-common-shift' : 'requires-all-three-rows' };
    lines.push('| Row | Year | Metric | Dev median [min, max] | Lane median | Delta | Delta % | Item tolerance | Allowed delta | Active interval | Pass | Near threshold |',
      '|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|---|');
    for (const result of results) for (const year of result.years) for (const metric of options.metrics) {
      const value = year.metrics[metric];
      lines.push(`| ${result.row} | ${year.yearIndex} (${year.year}) | ${metric} | ${fmt(value.control.median)} [${fmt(value.control.min)}, ${fmt(value.control.max)}] | ${fmt(value.lane)} | ${fmt(value.delta)} | ${fmt(value.relativePercent)} | ${fmt(value.tolerance)} | ${fmt(value.allowedDelta)} | [${fmt(value.lower)}, ${fmt(value.upper)}] | ${value.pass} | ${value.nearThreshold} |`);
    }
    lines.push('', 'The active interval is the intersection of the dev band and median-distance limit. JSON retains every boundary reason and distance. A check at an active boundary, including a zero-width band, requests stage two.', '', '## Systematic shift', '');
    if (!shifts) lines.push('Not evaluated: supply all three --dev/--lane row pairs.');
    else {
      lines.push('| Metric | Real shift | Direction | Endpoint evidence (row: delta; quarter dev band) |', '|---|---|---|---|');
      for (const metric of options.metrics) lines.push(`| ${metric} | ${shifts[metric].realShift} | ${shifts[metric].direction ?? 'none'} | ${shifts[metric].rows.map((row) => `${row.id} y${row.yearIndex}: ${fmt(row.delta)}; ${fmt(row.quarterBand)}`).join('; ')} |`);
      lines.push('', 'The required short row contributes year 15; the two long rows contribute year 60. A reported shift requires investigation even when the annual base checks pass.');
    }
  } else if (options.mode === 'variant') {
    const dev = load(options.dev[0]), base = load(options.base!), variant = load(options.variant!);
    validateComparisonPair(dev.summary, base.summary); validateVariantPair(base.summary, variant.summary);
    const result = compareVariant(dev.summary.years, base.summary.years, variant.summary.years, options.target!, { ...range, runs: base.summary.runs });
    pass = result.pass; needsNine = result.needsNine ? [rowId(base.summary)] : [];
    output = { row: rowId(base.summary), dev: dev.path, base: base.path, variant: variant.path, laneCommit: base.summary.source.commit, ...result };
    lines.push(`Target: ${options.target!.amount.value}${options.target!.amount.kind === 'percent' ? '%' : ' absolute units'} ${options.target!.direction}; same lane commit \`${base.summary.source.commit}\`.`, '',
      '| Year | Base median | Variant median | Delta | Delta % | Target threshold | Dev band width | Distance to threshold | Pass | Near threshold |', '|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
    for (const year of result.years) lines.push(`| ${year.yearIndex} (${year.year}) | ${fmt(year.base)} | ${fmt(year.variant)} | ${fmt(year.delta)} | ${fmt(year.relativePercent)} | ${fmt(year.threshold)} | ${fmt(year.devBand.width)} | ${fmt(year.distance)} | ${year.pass} | ${year.nearThreshold} |`);
  } else {
    const pairs = pairRows(options);
    const results = pairs.map(({ id, dev, lane }) => ({ row: id, dev: dev.path, lane: lane.path,
      ...relativeSignoff(dev.summary.years, lane.summary.years, options.signoffPercent, range) }));
    pass = results.every((result) => options.metrics.every((metric) => !result.metrics[metric].reopen));
    output = { results, rule: 'Report excursions in the selected years; reopen only when the actual row endpoint is outside the signed median limit.' };
    lines.push(`Historical sign-off: ±${options.signoffPercent}% of dev's median. Actual row endpoint excursions reopen it; excursions in the selected years are reported.`, '',
      '| Row | Year | Metric | Dev median | Lane median | Delta | Delta % | Outside limit |', '|---|---:|---|---:|---:|---:|---:|---|');
    for (const result of results) for (const year of result.years) for (const metric of options.metrics) {
      const value = year.metrics[metric];
      lines.push(`| ${result.row} | ${year.yearIndex} (${year.year}) | ${metric} | ${fmt(value.dev)} | ${fmt(value.lane)} | ${fmt(value.delta)} | ${fmt(value.relativePercent)} | ${value.outside} |`);
    }
    lines.push('', '| Row | Metric | Outside selected years | Actual endpoint | Endpoint delta % | Reopened at endpoint |', '|---|---|---|---:|---:|---|');
    for (const result of results) for (const metric of options.metrics) lines.push(`| ${result.row} | ${metric} | ${result.metrics[metric].outsideYears.join(', ') || 'none'} | ${result.endpointYearIndex} (${result.endpointYear}) | ${fmt(result.metrics[metric].final.relativePercent)} | ${result.metrics[metric].reopen} |`);
  }
  const status = needsNine.length ? 'needs-nine-runs' : !pass ? 'fail' : incompleteSystematic ? 'incomplete-systematic-check' : realShift ? 'investigate-systematic-shift' : 'pass';
  const summary = { protocol: 'NOTE-053', mode: options.mode, pass, status, provisional: needsNine.length > 0 || incompleteSystematic, needsNine, realShift, incompleteSystematic, options, evidence: output };
  if (incompleteSystematic) lines.push('', 'The annual checks are provisional until all three --dev/--lane row pairs are supplied for the required systematic-shift check.');
  lines.push('', `Verdict: **${status}**; current median checks pass: ${pass}.`, '', instructions(needsNine), '');
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(join(options.outDir, `${options.mode}.compare.json`), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(join(options.outDir, `${options.mode}.compare.md`), lines.join('\n'), 'utf8');
  console.log(`${status}: ${join(options.outDir, `${options.mode}.compare.json`)}; ${instructions(needsNine)}`);
  process.exitCode = status === 'pass' ? 0 : status === 'needs-nine-runs' ? 2 : status === 'investigate-systematic-shift' ? 3 : status === 'incomplete-systematic-check' ? 4 : 1;
}
