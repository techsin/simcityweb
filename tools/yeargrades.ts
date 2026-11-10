/**
 * YEARGRADES — LG-21's long-run grade gate (T054): runs the bot and grades every year as the Year in review card does,
 * from the city's history at each 1 January (yearGradeInput in src/ui/YearReview.ts, yearGrade in src/ui/yearGrade.ts).
 * The bot rows themselves omit the grade's inputs, so this probe reads the history the card reads.
 *
 *   npx tsx tools/yeargrades.ts --size 256 --years 60 --seed 7 --quiet
 *
 * Takes every simbot option, plus:
 *   --from <year>  the first 1 January that must pass (default 2010; the year labels are the bot rows' years)
 *   --min <score>  the lowest passing score (default 55, a C)
 *   --json <path>  also write the rows and the verdict as JSON
 * Prints one line per year (score, letter, the six stat scores, growth or unemployment scoring) and a verdict; exits 1
 * when a year from --from on cannot be graded or scores below --min. The run is a bot run: take the timing lock.
 */
import { writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { botSystems, parseArgs, SimBot } from './simbot';
import { yearGrade, type YearGradeLetter, type YearGradeScores } from '../src/ui/yearGrade';

// The card module imports its stylesheet; node has no loader for .css, so this run loads it as an empty module.
register('data:text/javascript,' + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
const { yearGradeInput } = await import('../src/ui/YearReview');

interface GradeRow {
  /** the bot row's year: the 1 January the card is captured on (the card reviews the year before) */
  year: number;
  pop: number;
  score: number | null;
  letter: YearGradeLetter | null;
  builtOut: boolean | null;
  scores: YearGradeScores | null;
}

const own = new Map<string, string>();
const rest: string[] = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--from' || argv[i] === '--min' || argv[i] === '--json') own.set(argv[i], argv[++i]);
  else rest.push(argv[i]);
}
const from = Number(own.get('--from') ?? 2010), min = Number(own.get('--min') ?? 55), json = own.get('--json');
if (!Number.isFinite(from) || !Number.isFinite(min)) {
  console.error('yeargrades: --from and --min take numbers');
  process.exit(2);
}
const opts = parseArgs(rest);
const bot = new SimBot(opts, await botSystems(opts.noInfra));
const st = bot.st;
console.log(`YEARGRADES size=${opts.size} years=${opts.years} seed=${opts.seed} ${opts.difficulty} ${opts.terrain}; pass: every year from ${from} scores >= ${min}`);
const rows: GradeRow[] = [];
const fmt = (n: number) => n.toFixed(1).padStart(5);
bot.run(opts.years, (r) => {
  const input = yearGradeInput(st.history, st.monthIndex);
  const g = input ? yearGrade(input) : null;
  rows.push({ year: r.year, pop: r.pop, score: g?.score ?? null, letter: g?.letter ?? null, builtOut: input?.builtOut ?? null, scores: g?.scores ?? null });
  const s = g?.scores;
  console.log(`${r.year} pop ${String(r.pop).padStart(8)}  ${g ? `${fmt(g.score)} ${g.letter}` : '    - -'}`
    + (s ? `  growth ${fmt(s.growth)}${input!.builtOut ? ' (unemployment)' : ''} approval ${fmt(s.approval)} finances ${fmt(s.finances)}`
      + ` safety ${fmt(s.safety)} environment ${fmt(s.environment)} services ${fmt(s.services)}` : '  (no complete measured year)'));
});
const gated = rows.filter((r) => r.year >= from);
const failing = gated.filter((r) => r.score === null || r.score < min);
const graded = gated.filter((r) => r.score !== null);
const lowest = graded.reduce<GradeRow | null>((a, r) => (a === null || r.score! < a.score! ? r : a), null);
const letters = graded.reduce<Record<string, number>>((a, r) => ({ ...a, [r.letter!]: (a[r.letter!] ?? 0) + 1 }), {});
const pass = gated.length > 0 && failing.length === 0;
console.log(`residents ${JSON.stringify(st.stats.residents)}`);
console.log(`${pass ? 'PASS' : 'FAIL'}: ${gated.length - failing.length} of ${gated.length} years from ${from} score >= ${min};`
  + ` letters ${JSON.stringify(letters)}; lowest ${lowest ? `${lowest.score!.toFixed(2)} (${lowest.letter}) in ${lowest.year}` : 'none'};`
  + ` built-out years ${gated.filter((r) => r.builtOut).length}`
  + (failing.length ? `; failing ${failing.map((r) => `${r.year} ${r.score === null ? 'ungraded' : r.score.toFixed(1)}`).join(', ')}` : ''));
if (json) writeFileSync(json, JSON.stringify({ opts, from, min, pass, lowest, letters, residents: st.stats.residents, rows }, null, 1));
process.exitCode = pass ? 0 : 1;
