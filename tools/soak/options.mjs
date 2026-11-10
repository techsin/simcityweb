import { resolve } from 'node:path';

export const help = `Metropolis production soak (run between timing runs)
  node tools/soak/run.mjs --city dense1m|vet|small [options]

  --hours N                 Duration after setup (default 4)
  --minutes N               Smoke duration; mutually exclusive with --hours
  --cycle-minutes N         Action cycle interval (default 5)
  --sample-seconds N        Telemetry interval (default 15)
  --heap-mib-per-hour N     Strict post-exit heap growth limit (default 16)
  --late-heap-mib-per-hour N  Heap growth limit over the run's second half (default 8; runs of 1 hour or more)
  --min-days-per-sec N      Floor for the sim's days per running second (default 0, off; NOTE-026: 15 for dense1m at ULTRA)
  --fixture PATH            City/region file; required for vet, optional for dense1m (its default is generated: npm run fixtures)
  --port N                  Vite preview loopback port (default 5199, strict)
  --exit-settle-seconds N   Region settle before three GCs (default 20; minimum 16)
  --help                    Print this help without building or opening a browser

Outputs: tools/soak/.runs/<timestamp>-<city>-<pid>/
Exit codes: 0 all gates pass; 1 failed/incomplete run; 2 invalid arguments.
The duration excludes build/setup and includes cycles; the final exit adds settle time.
A cycle still running when the next one is due stops the run: give the soak the machine to itself.
`;

/** dense1m's default fixture, under the gitignored folder that `npm run fixtures` fills (docs/dev/TEST_CITIES.md) */
const DEFAULT_FIXTURES = 'tools/bench/.fixtures/fixtures';
const DEFAULT_FIXTURE = 'dense1m_s7.metropolis';
const BUILD_VET = 'The shared vet_s7_y43 save comes from `npm run fixtures -- --only cities --cities DIR` (two bot runs, several minutes): pass DIR/vet_s7_y43.region.metropolis or its .city.metropolis.';

export function parseOptions(argv, root, env = process.env) {
  const allowed = new Set(['city', 'hours', 'minutes', 'cycle-minutes', 'sample-seconds', 'heap-mib-per-hour', 'late-heap-mib-per-hour', 'min-days-per-sec', 'fixture', 'port', 'exit-settle-seconds']);
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' && argv.length === 1) return { help: true };
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !allowed.has(key)) throw new Error(`Unknown argument: ${argv[i]}`);
    if (key in values) throw new Error(`Duplicate --${key}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for --${key}`);
    values[key] = argv[++i];
  }
  const number = (key, fallback, min = Number.MIN_VALUE) => {
    const n = Number(values[key] ?? fallback);
    if (!Number.isFinite(n) || n < min) throw new Error(`--${key} must be a finite number >= ${min}`);
    return n;
  };
  if ('minutes' in values && 'hours' in values) throw new Error('Choose --minutes or --hours');
  const city = values.city;
  if (!['dense1m', 'vet', 'small'].includes(city)) throw new Error('--city must be dense1m, vet, or small');
  if (city === 'vet' && !values.fixture) throw new Error(`--city vet requires --fixture PATH (vet_s7_y43). ${BUILD_VET}`);
  if (city === 'small' && values.fixture) throw new Error('--city small is newly founded and takes no fixture');
  const durationMs = 'minutes' in values ? number('minutes') * 60_000 : number('hours', 4) * 3_600_000;
  const cycleMs = number('cycle-minutes', 5) * 60_000;
  const sampleMs = number('sample-seconds', 15, 1) * 1000;
  for (const value of [durationMs, cycleMs, sampleMs]) if (!Number.isSafeInteger(Math.ceil(value))) throw new Error('Time interval is too large');
  const port = number('port', 5199, 1024);
  if (!Number.isInteger(port) || port > 65535) throw new Error('--port must be an integer in 1024..65535');
  if (sampleMs >= durationMs) throw new Error('Duration must exceed the telemetry interval');
  return {
    city, durationMs, cycleMs, sampleMs, port,
    heapMiBPerHour: number('heap-mib-per-hour', 16, 0),
    lateHeapMiBPerHour: number('late-heap-mib-per-hour', 8, 0),
    minDaysPerSec: number('min-days-per-sec', 0, 0),
    exitSettleMs: number('exit-settle-seconds', 20, 16) * 1000,
    fixture: city === 'small' ? null : resolve(root, values.fixture ?? resolve(env.SIM_FIXTURES ?? resolve(root, DEFAULT_FIXTURES), DEFAULT_FIXTURE)),
    // where that path came from, for the message when no file is there (missingFixture)
    fixtureFrom: city === 'small' ? null : values.fixture ? '--fixture' : env.SIM_FIXTURES ? 'SIM_FIXTURES' : 'default',
  };
}

/** What to say when the fixture file is not there: how to build the default one, or how to point at one that exists. */
export function missingFixture(options) {
  const from = { '--fixture': 'given with --fixture', SIM_FIXTURES: `SIM_FIXTURES holds no ${DEFAULT_FIXTURE}`, default: 'the default path' }[options.fixtureFrom] ?? 'the fixture path';
  const how = options.city === 'vet' ? BUILD_VET
    : `The dense1m fixture is generated and gitignored, so a fresh worktree has none. Build it in this tree, in under a minute, at ${DEFAULT_FIXTURES}/${DEFAULT_FIXTURE}: npm run fixtures -- --only snap,dense1m (from Windows PowerShell: cmd.exe /d /s /c "npm run fixtures -- --only snap,dense1m"). Or point at one that exists: --fixture PATH, or SIM_FIXTURES=<the folder that holds ${DEFAULT_FIXTURE}>, for example another worktree's ${DEFAULT_FIXTURES}.`;
  return `Fixture missing: ${options.fixture} (${from}). ${how} A fixture is a .metropolis city file or one-city region file with at least 900,000 residents, and it is never generated implicitly. See tools/soak/README.md.`;
}

export function timeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
