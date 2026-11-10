/** NOTE-053 / NOTE-062 comparison CLI; this command launches no bots. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AnnualBand, AnnualMetrics, BaseComparison, MetricName, Tolerance, VariantTarget } from './simEnsembleStats';
const { ALL_METRICS, compareBase, compareVariant, disjointBandShift, memberEndpoints, METRICS, relativeSignoff, summarizeEnsemble, systematicShift } = await import(new URL('./simEnsembleStats.ts', import.meta.url).href) as typeof import('./simEnsembleStats');

interface Summary {
  protocol: 'NOTE-053' | 'NOTE-062'; complete: true; row: { size: number; years: number; seed: number };
  source: { commit: string; simBlob: string; srcTree: string; dependencies?: string; observer?: string };
  provenance?: { parentCommit?: string };
  configuration: { botArgs: string[]; variant?: boolean }; nudge: number; runs: 5 | 9;
  members: { id: string; nudge: number; day: number; path?: string; cacheKey?: string; observer?: string }[]; years: AnnualBand[];
  memberEndpoints?: ReturnType<typeof memberEndpoints>;
}
interface Input { path: string; summary: Summary }
export interface CompareCliOptions {
  mode: 'base' | 'variant' | 'signoff'; dev: string[]; lane: string[]; base?: string; variant?: string;
  metrics: MetricName[]; tolerance: Tolerance; target?: VariantTarget; signoffPercent: number;
  fromYear: number; throughYear?: number; outDir: string;
}
const HELP = `NOTE-053 / NOTE-062 ensemble comparison (no bot processes)
usage: node --experimental-strip-types tools/simEnsemble.mts compare MODE [options]
  base     --dev FILE --lane FILE (repeat both for the three-row systematic check)
  variant  --dev FILE --base FILE --variant FILE --metric NAME --target-below-percent 2
  signoff  --dev FILE --lane FILE (repeatable) --signoff-percent 3
  --out-dir DIR        required; write MODE.compare.json and MODE.compare.md
  --metric NAME        repeatable, or comma-separated; default four metrics; approvalNetCommute selects FX2
  --tolerance N        absolute item tolerance for base checks (default 0)
  --tolerance-percent N percent item tolerance, resolved against each year's dev median
  --target-below-percent N | --target-above-percent N | --target-below N | --target-above N
  --from-year N        first bot year index (default 10)
  --to-year N          last bot year index (default row end)
Base/variant comparisons require matching row, nudge and run count (5 with 5, or 9 with 9).
Variant/base require the exact same lane commit and different bot arguments. Dev supplies the stage-two band.
Base rows and 256x60 variants require nine members directly. Short variants use five plus stage two near a threshold.
Nine is final: no third stage. Exact-zero dev I-HT share years are reported but do not gate.
Three consecutive disjoint lane/dev bands are a real shift; long rows report member endpoints and stall counts.
The systematic check needs all three rows and uses each row's last year (15, 60, 60).
Exit: 0 pass; 1 fail; 2 complete named rows with --runs 9; 3 investigate a real shift; 4 supply all three base rows.
Signoff reports the selected years, but only the actual row endpoint reopens the historical sign-off.`;

function numeric(value: string, flag: string): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${flag} requires a finite nonnegative number`);
  return result;
}
export function parseCompareOptions(argv: string[]): CompareCliOptions {
  const mode = argv[0];
  if (!['base', 'variant', 'signoff'].includes(mode)) throw new Error('comparison mode must be base, variant or signoff');
  const values: Record<string, string> = {}, dev: string[] = [], lane: string[] = [], metrics: MetricName[] = [];
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
        if (!ALL_METRICS.includes(metric as MetricName)) throw new Error(`unknown metric ${metric}`);
        if (!metrics.includes(metric as MetricName)) metrics.push(metric as MetricName);
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
  if (!result || !['NOTE-053', 'NOTE-062'].includes(result.protocol) || result.complete !== true || !row ||
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
function rawMembers(input: Input) {
  return input.summary.members.map((member) => {
    if (!member.path) throw new Error(`missing raw member path for ${member.id}: ${input.path}`);
    const path = resolve(dirname(input.path), member.path);
    if (!existsSync(path)) throw new Error(`missing raw member output: ${path}`);
    const value = JSON.parse(readFileSync(path, 'utf8')) as { complete?: boolean; spec?: Partial<Summary['source']> & {
      size?: number; years?: number; seed?: number; nudge?: number; day?: number; botArgs?: string[]; cacheKey?: string }; rows?: AnnualMetrics[] };
    const spec = value.spec, source = input.summary.source, row = input.summary.row;
    if (value.complete !== true || !Array.isArray(value.rows) || value.rows.length !== row.years || !spec ||
        spec.commit !== source.commit || spec.simBlob !== source.simBlob || spec.srcTree !== source.srcTree ||
        spec.size !== row.size || spec.years !== row.years || spec.seed !== row.seed || spec.nudge !== member.nudge || spec.day !== member.day ||
        source.dependencies !== undefined && spec.dependencies !== source.dependencies ||
        member.observer !== undefined && spec.observer !== member.observer || member.cacheKey !== undefined && spec.cacheKey !== member.cacheKey ||
        JSON.stringify(spec.botArgs ?? []) !== JSON.stringify(input.summary.configuration.botArgs) ||
        value.rows.some((annual, index) => annual.yearIndex !== input.summary.years[index].yearIndex || annual.year !== input.summary.years[index].year)) throw new Error(`raw member does not match ensemble origin: ${path}`);
    return { id: member.id, rows: value.rows };
  });
}
/** Match a short variant's five actual members; never infer a five-member median from a nine-member band. */
export function projectFiveMemberSummary(summary: Summary, path: string): Summary {
  if (summary.runs === 5) return summary;
  if (summary.row.size !== 128 || summary.row.years !== 15) throw new Error('five-member projection is only valid for a 128x15 variant');
  const selected = summary.members.filter((member) => Math.abs(member.nudge) <= summary.nudge);
  const projected = { ...summary, runs: 5 as const, members: selected, memberEndpoints: undefined };
  const members = rawMembers({ path, summary: projected });
  return validateSummary({ ...projected, years: summarizeEnsemble(members) }, path);
}
function endpointEvidence(input: Input, metrics: readonly MetricName[]) {
  if (input.summary.row.size !== 256 || input.summary.row.years !== 60) return null;
  try { return { available: true as const, ...memberEndpoints(rawMembers(input), metrics) }; }
  catch (error) { return { available: false as const, reason: error instanceof Error ? error.message : String(error) }; }
}
function endpointTable(lines: string[], row: string, groups: { name: string; input: Input }[], metrics: readonly MetricName[]) {
  const evidence = Object.fromEntries(groups.map((group) => [group.name, endpointEvidence(group.input, metrics)]));
  if (!groups.some((group) => group.input.summary.row.years === 60)) return evidence;
  lines.push('', `## ${row}: year-60 members and stalled counts`, '', 'Stalled means population growth from 2050 to 2060 is under 100,000; this is reported, not gated.', '');
  for (const group of groups) {
    const endpoints = evidence[group.name];
    if (!endpoints?.available) { lines.push(`${group.name}: unavailable (${endpoints && 'reason' in endpoints ? endpoints.reason : 'not a 256x60 row'}).`, ''); continue; }
    lines.push(`${group.name}: **${endpoints.stalledCount}/${endpoints.memberCount} stalled**.`, '',
      `| Metric | ${endpoints.members.map((member) => member.id).join(' | ')} |`, `|---|${endpoints.members.map(() => '---:').join('|')}|`);
    for (const metric of metrics) lines.push(`| ${metric} in 2060 | ${endpoints.members.map((member) => member.values[metric] === undefined ? 'unavailable' : fmt(member.values[metric]!)).join(' | ')} |`);
    lines.push(`| Population in 2050 | ${endpoints.members.map((member) => fmt(member.population2050)).join(' | ')} |`,
      `| Population growth 2050-2060 | ${endpoints.members.map((member) => fmt(member.growth2050to2060)).join(' | ')} |`,
      `| Stalled | ${endpoints.members.map((member) => member.stalled).join(' | ')} |`, '');
  }
  return evidence;
}
function originTable(lines: string[], groups: { name: string; input: Input }[]): void {
  lines.push('## Origins', '', '| Row / role | Measured commit | Parent commit | Summary |', '|---|---|---|---|');
  for (const group of groups) lines.push(`| ${rowId(group.input.summary)} / ${group.name} | \`${group.input.summary.source.commit}\` | ${group.input.summary.provenance?.parentCommit ? `\`${group.input.summary.provenance.parentCommit}\`` : 'unavailable in cached summary'} | \`${group.input.path}\` |`);
  lines.push('');
}
export function validateComparisonPair(dev: Summary, lane: Summary, sameConfiguration = true): void {
  if (rowId(dev) !== rowId(lane) || dev.runs !== lane.runs || dev.nudge !== lane.nudge) throw new Error('comparison requires the same row, nudge and run count; collect both sides with --runs 9 for stage two');
  if (sameConfiguration && JSON.stringify(dev.configuration.botArgs) !== JSON.stringify(lane.configuration.botArgs)) throw new Error('base comparison configuration differs');
}
export function validateVariantPair(base: Summary, variant: Summary): void {
  validateComparisonPair(base, variant, false);
  if (base.source.commit !== variant.source.commit || base.source.simBlob !== variant.source.simBlob || base.source.srcTree !== variant.source.srcTree) throw new Error('variant and base must use the exact same lane commit and simulation sources');
  if (base.source.dependencies !== variant.source.dependencies || base.source.observer !== variant.source.observer) throw new Error('variant and base dependency or observer identity differs');
  if (JSON.stringify(base.configuration.botArgs) === JSON.stringify(variant.configuration.botArgs)) throw new Error('variant and base bot arguments must differ');
}
function fmt(value: number | null): string { return value === null ? 'undefined (zero reference)' : Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(10))); }
function selectedBase(result: BaseComparison, metrics: MetricName[]) {
  const years = result.years.map((year) => ({ ...year, pass: metrics.every((metric) => year.metrics[metric].pass),
    metrics: Object.fromEntries(metrics.map((metric) => [metric, year.metrics[metric]])) }));
  const nearThreshold = years.some((year) => metrics.some((metric) => year.metrics[metric].nearThreshold));
  return { ...result, years, pass: years.every((year) => year.pass), nearThreshold, needsNine: result.needsNine };
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
function instructions(rows: string[]): string { return rows.length ? `Complete these rows on both compared trees with --runs 9: ${rows.join(', ')}. Existing five members are reused.` : 'Nine-member verdicts are final; no third stage. No additional nine-run rows requested.'; }
export async function compareCli(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return; }
  const options = parseCompareOptions(argv), lines: string[] = [`# NOTE-053 / NOTE-062 ${options.mode} comparison`, '',
    `Metrics: ${options.metrics.join(', ')}; bot years ${options.fromYear} through ${options.throughYear ?? 'row end'}.`, ''];
  const range = { fromYear: options.fromYear, throughYear: options.throughYear, metrics: options.metrics };
  let output: unknown, pass: boolean, needsNine: string[] = [], realShift = false, incompleteSystematic = false;
  if (options.mode === 'base') {
    const pairs = pairRows(options);
    originTable(lines, pairs.flatMap((pair) => [{ name: 'dev', input: pair.dev }, { name: 'lane', input: pair.lane }]));
    const results = pairs.map(({ id, dev, lane }) => ({ row: id, dev: dev.path, lane: lane.path,
      devCommit: dev.summary.source.commit, laneCommit: lane.summary.source.commit,
      ...selectedBase(compareBase(dev.summary.years, lane.summary.years, { ...range, tolerance: options.tolerance, runs: dev.summary.runs }), options.metrics),
      disjointBandShift: disjointBandShift(dev.summary.years, lane.summary.years, { ...range, runs: dev.summary.runs }) }));
    const shifts = pairs.length === 3 ? systematicShift(pairs.map((pair) => ({ id: pair.id, dev: pair.dev.summary.years, lane: pair.lane.summary.years, runs: pair.dev.summary.runs })), options.metrics) : null;
    incompleteSystematic = shifts === null;
    realShift = shifts !== null && options.metrics.some((metric) => shifts[metric].realShift) || results.some((result) => options.metrics.some((metric) => result.disjointBandShift[metric].realShift));
    pass = results.every((result) => result.pass); needsNine = results.filter((result) => result.needsNine).map((result) => result.row);
    const endpoints = pairs.map((pair) => ({ row: pair.id, evidence: endpointTable([], pair.id, [{ name: 'dev', input: pair.dev }, { name: 'lane', input: pair.lane }], options.metrics) }));
    output = { results, memberEndpoints: endpoints, systematicShift: shifts ? Object.fromEntries(options.metrics.map((metric) => [metric, shifts[metric]])) : null,
      systematicShiftStatus: shifts ? options.metrics.some((metric) => shifts[metric].realShift) ? 'investigate-real-shift' : 'no-common-shift' : 'requires-all-three-rows' };
    lines.push('| Row | Year | Metric | Dev median [min, max] | Lane median [min, max] | Delta | Delta % | Item tolerance | Allowed delta | Active interval | Pass | Gated | Near threshold |',
      '|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|---|---|');
    for (const result of results) for (const year of result.years) for (const metric of options.metrics) {
      const value = year.metrics[metric];
      const other = pairs.find((pair) => pair.id === result.row)!.lane.summary.years.find((row) => row.yearIndex === year.yearIndex)!.metrics[metric]!;
      lines.push(`| ${result.row} | ${year.yearIndex} (${year.year}) | ${metric} | ${fmt(value.control.median)} [${fmt(value.control.min)}, ${fmt(value.control.max)}] | ${fmt(value.lane)} [${fmt(other.min)}, ${fmt(other.max)}] | ${fmt(value.delta)} | ${fmt(value.relativePercent)} | ${fmt(value.tolerance)} | ${fmt(value.allowedDelta)} | [${fmt(value.lower)}, ${fmt(value.upper)}] | ${value.pass} | ${value.gated ? 'yes' : value.exemption} | ${value.nearThreshold} |`);
    }
    lines.push('', 'The active interval is the intersection of the dev band and median-distance limit. Base rows require nine members directly. Exact-zero nine-member dev I-HT years do not gate; their values remain reported.', '', '## I-HT activation', '', '| Row | First nonzero lane median | Value |', '|---|---|---:|');
    for (const result of results) lines.push(`| ${result.row} | ${result.firstLaneIhtNonzero ? `${result.firstLaneIhtNonzero.yearIndex} (${result.firstLaneIhtNonzero.year})` : 'never'} | ${result.firstLaneIhtNonzero ? fmt(result.firstLaneIhtNonzero.median) : '0'} |`);
    lines.push('', '## Disjoint-band shifts', '', '| Row | Metric | Real shift | Longest consecutive run | Disjoint runs (year indices, direction) |', '|---|---|---|---:|---|');
    for (const result of results) for (const metric of options.metrics) {
      const shift = result.disjointBandShift[metric];
      lines.push(`| ${result.row} | ${metric} | ${shift.realShift} | ${shift.longestRun} | ${shift.streaks.map((streak) => `${streak.fromYear}-${streak.throughYear}, ${streak.direction}`).join('; ') || 'none'} |`);
    }
    lines.push('', 'Three consecutive years wholly outside dev are a real shift, independent of the other rows. A shift requires a mechanism explanation in the lane report; this tool does not infer its cause.', '', '## Systematic shift', '');
    if (!shifts) lines.push('Not evaluated: supply all three --dev/--lane row pairs.');
    else {
      lines.push('| Metric | Real shift | Direction | Endpoint evidence (row: delta; quarter dev band) |', '|---|---|---|---|');
      for (const metric of options.metrics) lines.push(`| ${metric} | ${shifts[metric].realShift} | ${shifts[metric].direction ?? 'none'} | ${shifts[metric].rows.map((row) => `${row.id} y${row.yearIndex}: ${fmt(row.delta)}; ${fmt(row.quarterBand)}`).join('; ')} |`);
      lines.push('', 'The required short row contributes year 15; the two long rows contribute year 60. A reported shift requires investigation even when the annual base checks pass.');
    }
    for (const pair of pairs) endpointTable(lines, pair.id, [{ name: 'dev', input: pair.dev }, { name: 'lane', input: pair.lane }], options.metrics);
  } else if (options.mode === 'variant') {
    let dev = load(options.dev[0]), base = load(options.base!);
    const variant = load(options.variant!), originalRuns = { dev: dev.summary.runs, base: base.summary.runs, variant: variant.summary.runs };
    if (variant.summary.row.size === 128 && variant.summary.row.years === 15 && variant.summary.runs === 5) {
      dev = { ...dev, summary: projectFiveMemberSummary(dev.summary, dev.path) };
      base = { ...base, summary: projectFiveMemberSummary(base.summary, base.path) };
    }
    validateComparisonPair(dev.summary, base.summary); validateVariantPair(base.summary, variant.summary);
    originTable(lines, [{ name: 'dev', input: dev }, { name: 'base', input: base }, { name: 'variant', input: variant }]);
    const result = compareVariant(dev.summary.years, base.summary.years, variant.summary.years, options.target!, { ...range, runs: base.summary.runs });
    pass = result.pass; needsNine = result.needsNine ? [rowId(base.summary)] : [];
    const endpoints = endpointTable([], rowId(base.summary), [{ name: 'dev', input: dev }, { name: 'base', input: base }, { name: 'variant', input: variant }], options.metrics);
    output = { row: rowId(base.summary), dev: dev.path, base: base.path, variant: variant.path, laneCommit: base.summary.source.commit,
      originalRuns, effectiveRuns: { dev: dev.summary.runs, base: base.summary.runs, variant: variant.summary.runs }, memberEndpoints: endpoints, ...result };
    lines.push(`Target: ${options.target!.amount.value}${options.target!.amount.kind === 'percent' ? '%' : ' absolute units'} ${options.target!.direction}; same lane commit \`${base.summary.source.commit}\`.`, '',
      '| Year | Base median | Variant median | Delta | Delta % | Target threshold | Dev band width | Distance to threshold | Pass | Near threshold |', '|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
    for (const year of result.years) lines.push(`| ${year.yearIndex} (${year.year}) | ${fmt(year.base)} | ${fmt(year.variant)} | ${fmt(year.delta)} | ${fmt(year.relativePercent)} | ${fmt(year.threshold)} | ${fmt(year.devBand.width)} | ${fmt(year.distance)} | ${year.pass} | ${year.nearThreshold} |`);
    lines.push('', `Original member counts: dev ${originalRuns.dev}, base ${originalRuns.base}, variant ${originalRuns.variant}; compared counts: dev ${dev.summary.runs}, base ${base.summary.runs}, variant ${variant.summary.runs}. A short five-member variant uses the actual matching control/±X members from any nine-member base/dev files.`, '');
    endpointTable(lines, rowId(base.summary), [{ name: 'dev', input: dev }, { name: 'base', input: base }, { name: 'variant', input: variant }], options.metrics);
  } else {
    const pairs = pairRows(options);
    originTable(lines, pairs.flatMap((pair) => [{ name: 'dev', input: pair.dev }, { name: 'lane', input: pair.lane }]));
    const results = pairs.map(({ id, dev, lane }) => ({ row: id, dev: dev.path, lane: lane.path,
      ...relativeSignoff(dev.summary.years, lane.summary.years, options.signoffPercent, { ...range, runs: dev.summary.runs }) }));
    pass = results.every((result) => options.metrics.every((metric) => !result.metrics[metric].reopen));
    output = { results, memberEndpoints: pairs.map((pair) => ({ row: pair.id,
      evidence: endpointTable([], pair.id, [{ name: 'dev', input: pair.dev }, { name: 'lane', input: pair.lane }], options.metrics) })),
      rule: 'Report excursions in the selected years; reopen only when the actual row endpoint is outside the signed median limit.' };
    lines.push(`Historical sign-off: ±${options.signoffPercent}% of dev's median. Actual row endpoint excursions reopen it; excursions in the selected years are reported.`, '',
      '| Row | Year | Metric | Dev median | Lane median | Delta | Delta % | Outside limit |', '|---|---:|---|---:|---:|---:|---:|---|');
    for (const result of results) for (const year of result.years) for (const metric of options.metrics) {
      const value = year.metrics[metric];
      lines.push(`| ${result.row} | ${year.yearIndex} (${year.year}) | ${metric} | ${fmt(value.dev)} | ${fmt(value.lane)} | ${fmt(value.delta)} | ${fmt(value.relativePercent)} | ${value.outside} |`);
    }
    lines.push('', '| Row | Metric | Outside selected years | Actual endpoint | Endpoint delta % | Reopened at endpoint |', '|---|---|---|---:|---:|---|');
    for (const result of results) for (const metric of options.metrics) lines.push(`| ${result.row} | ${metric} | ${result.metrics[metric].outsideYears.join(', ') || 'none'} | ${result.endpointYearIndex} (${result.endpointYear}) | ${fmt(result.metrics[metric].final.relativePercent)} | ${result.metrics[metric].reopen} |`);
    for (const pair of pairs) endpointTable(lines, pair.id, [{ name: 'dev', input: pair.dev }, { name: 'lane', input: pair.lane }], options.metrics);
  }
  const status = needsNine.length ? 'needs-nine-runs' : realShift ? 'investigate-real-shift' : !pass ? 'fail' : incompleteSystematic ? 'incomplete-systematic-check' : 'pass';
  const summary = { protocol: 'NOTE-053', rules: 'NOTE-062', mode: options.mode, pass, status, provisional: needsNine.length > 0 || incompleteSystematic, needsNine, realShift, incompleteSystematic, options, evidence: output };
  if (incompleteSystematic) lines.push('', 'The annual checks are provisional until all three --dev/--lane row pairs are supplied for the required systematic-shift check.');
  lines.push('', `Verdict: **${status}**; current median checks pass: ${pass}.`, '', instructions(needsNine), '');
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(join(options.outDir, `${options.mode}.compare.json`), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(join(options.outDir, `${options.mode}.compare.md`), lines.join('\n'), 'utf8');
  console.log(`${status}: ${join(options.outDir, `${options.mode}.compare.json`)}; ${instructions(needsNine)}`);
  process.exitCode = status === 'pass' ? 0 : status === 'needs-nine-runs' ? 2 : status === 'investigate-real-shift' ? 3 : status === 'incomplete-systematic-check' ? 4 : 1;
}
