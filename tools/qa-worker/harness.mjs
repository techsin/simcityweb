import { writeFile } from 'node:fs/promises';

export const BASE = '8ef8f7c';
export const COMMANDS = [
  'zone', 'dezone', 'bulldoze', 'buildNetwork', 'buildPowerLine', 'buildSubway', 'plop', 'terraform', 'plantTrees',
  'setTax', 'setFunding', 'setHistoric', 'setOrdinance', 'takeLoan', 'repayLoan', 'setSpeed', 'resume',
  'dispatch', 'dispatchBest', 'triggerDisaster', 'setCamera', 'dismissAlert', 'setSettings',
];
export const commandCheck = (op) => op === 'terraform' ? 'terraform / held brush reaches flat' : op === 'setCamera' ? 'setCamera / Ctrl+S save' : op;
export const PANELS = ['graphs', 'stats', 'advisors', 'dataviews', 'demographics', 'emergencies', 'rewards'];
export const CHECKS = {
  ...Object.fromEntries(COMMANDS.map((op) => [op, commandCheck(op)])),
  fixture: 'fixture / grow a neighbourhood', save: 'save / reload / Continue', freeze: 'freeze 15 s / resume 1 s',
  onboarding: 'Appendix A / Onboarding Play', 'speed-keys': 'Appendix A / keys 1/2/3',
  'info-demolish': 'Appendix A / InfoPanel Demolish', exit: 'Appendix A / exit to region',
  'data-view': 'Appendix A / select data view', verify: 'replica verify',
  ghosts: 'pending ghosts / provisional edits', packets: 'packet replies / cause tags', recovery: 'recovery mirror',
  ...Object.fromEntries(PANELS.map((id) => [`panel:${id}`, `Appendix A / ${id} panel`])),
};
export const DEPENDENCIES = {
  dezone: ['zone'], bulldoze: ['plop'], repayLoan: ['takeLoan'], setHistoric: [CHECKS.fixture],
  [CHECKS.save]: [CHECKS.setCamera], triggerDisaster: [CHECKS.fixture], dispatch: ['triggerDisaster'], dispatchBest: ['dispatch'],
  dismissAlert: ['triggerDisaster'], [CHECKS.packets]: ['dispatch'], [CHECKS.recovery]: ['zone'],
};
export function selectedChecks(only) {
  if (!only) return null;
  const selected = new Set(['host ready', 'no crash overlay']);
  const add = (name) => { if (selected.has(name)) return; selected.add(name); for (const dep of DEPENDENCIES[name] ?? []) add(dep); };
  add(CHECKS[only] ?? only);
  return selected;
}
export const help = `Worker acceptance harness (T028, base ${BASE})

  node tools/qa-worker/cli.mjs [options]

  --help                     Print this help; no Vite or Playwright import
  --host local|loopback|worker  Host to require (default loopback)
  --swiftshader              Cloud GPU flags; default is the real GPU
  --headed                   Show Chromium (default headless)
  --executable PATH          Chromium executable (otherwise Playwright's)
  --ack-timeout MS           Command/gesture deadline (default 8000)
  --boot-timeout MS          Boot/growth deadline (default 180000)
  --out FILE.json            Write checks and diagnostics
  --only CHECK               Run one check plus its prerequisites (e.g. freeze, zone, save)
  --break-ack OP             Break OP's done promise in the temporary build; implies --only OP
  --drop-ack OP              Probe-only fault: withhold OP's first ack, across city sessions
  --w1                       Also enable verify/protector gates for the local host
  --digest-module PATH       Override shared exactDigest module (default src/worker/queries.ts)

Always builds production assets into a temporary directory and starts its own vite preview.
One fresh browser/context, 256-cell sandbox, synthetic pointer input through the real tools.
Freeze duration is always 15 s; resume deadline is always 1 s.
Loopback runs now, including verify/protectors. Worker skips if its host is not in this build.
Cloud: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/qa-worker/cli.mjs --swiftshader
Checks: ${Object.keys(CHECKS).join(', ')}
Exit: 0 = no failures, 1 = failed check (also a verified broken-build control),
      2 = invalid arguments, 3 = all skipped, 130/143 = SIGINT/SIGTERM.
For --break-ack, require PASS broken-build control; exit 1 alone proves nothing.`;

export function parseArgs(argv) {
  const o = { host: 'loopback', swiftshader: false, headed: false, w1: false, ackTimeout: 8000, bootTimeout: 180000 };
  const flags = { '--help': 'help', '--swiftshader': 'swiftshader', '--headed': 'headed', '--w1': 'w1' };
  const values = { '--host': 'host', '--executable': 'executable', '--out': 'out', '--drop-ack': 'dropAck',
    '--ack-timeout': 'ackTimeout', '--boot-timeout': 'bootTimeout', '--digest-module': 'digestModule', '--only': 'only', '--break-ack': 'breakAck' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags[a]) o[flags[a]] = true;
    else if (values[a]) {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`);
      o[values[a]] = v;
    } else throw new Error(`unknown option ${a}; use --help`);
  }
  if (!['local', 'loopback', 'worker'].includes(o.host)) throw new Error('host must be local, loopback or worker');
  for (const k of ['ackTimeout', 'bootTimeout']) {
    o[k] = Number(o[k]);
    if (!Number.isSafeInteger(o[k]) || o[k] < 1) throw new Error(`${k} must be a positive integer`);
  }
  for (const op of [o.dropAck, o.breakAck]) if (op && !COMMANDS.includes(op)) throw new Error(`unknown command ${op}`);
  if (o.only && !CHECKS[o.only] && !Object.values(CHECKS).includes(o.only)) throw new Error(`unknown check ${o.only}; use --help`);
  if (o.breakAck) {
    if (o.dropAck) throw new Error('--break-ack and --drop-ack are separate controls');
    if (o.only && (CHECKS[o.only] ?? o.only) !== commandCheck(o.breakAck)) throw new Error('--break-ack requires --only to name the same command');
    o.only = o.breakAck;
  }
  o.w1 ||= o.host !== 'local';
  if (o.digestModule && !o.w1) throw new Error('--digest-module requires --w1 for the local host');
  return o;
}

export function assert(ok, reason) { if (!ok) throw new Error(reason); }
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('run interrupted')); };
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
});
/** Preserve the primary error even when releasing a pointer, thawing or closing also fails. */
export async function withCleanup(body, cleanup, onCleanupError = () => {}) {
  let primary;
  try { return await body(); }
  catch (e) { primary = e; throw e; }
  finally {
    try { await cleanup(); }
    catch (e) { if (!primary) throw e; onCleanupError(e); }
  }
}
export async function deadline(promise, ms, reason) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(reason), { code: 'deadline' })), ms); })]);
  } finally { clearTimeout(timer); }
}

export async function poll(read, accept, timeout, reason, interval = 50) {
  const end = performance.now() + timeout;
  let value, first = true;
  do {
    const budget = end - performance.now();
    if (!first && budget <= 0) break;
    first = false;
    // One polling interval of read grace avoids treating a healthy CDP read as stalled at the boundary.
    value = await deadline(Promise.resolve().then(read), Math.max(Math.min(interval, timeout), budget), `${reason} (read timed out)`);
    if (accept(value)) return value;
    const remaining = end - performance.now();
    if (remaining <= 0) break;
    // Do not start a final browser read with the fractional millisecond left after the last sleep.
    // A healthy read may take longer than that; only an actual failed read is a read timeout.
    if (remaining <= interval) { await sleep(remaining); break; }
    await sleep(interval);
  } while (true);
  throw Object.assign(new Error(`${reason}; last=${JSON.stringify(value)}`), { code: 'poll-timeout' });
}

/** The same oracle handles the positive run and --drop-ack. Predictions never count as acknowledgements. */
export async function waitForAcks(read, op, timeout, { gesture = false, tag = false, allowFailure = false } = {}) {
  let last = [], rows;
  try {
    rows = await poll(async () => (last = await read()), (xs) => xs.length > 0 && xs.every((x) => x.status !== 'pending'), timeout, `${op}: missing command or ticket.done acknowledgement`);
  } catch (e) {
    const pending = last.filter((r) => r.status === 'pending' && Number.isSafeInteger(r.seq) && r.seq > 0);
    // A missing input, failed browser read or rejected command is not evidence of a disabled acknowledgement.
    e.failure = { op, kind: pending.length && e.code === 'poll-timeout' ? 'ack-timeout' : 'missing-command', seqs: pending.map((r) => r.seq) };
    if (e.failure.kind === 'ack-timeout') e.message = `${op}: ticket.done acknowledgement deadline expired; pending seq ${e.failure.seqs.join(', ')}`;
    throw e;
  }
  for (const r of rows) {
    const refusal = r.seq === 0 && r.exact === true && r.predicted?.ok === false && r.result?.ok === false;
    assert(Number.isSafeInteger(r.seq) && (r.seq > 0 || (allowFailure && refusal)), `${op}: invalid ticket seq ${r.seq}`);
    assert(r.status === 'resolved', `${op} #${r.seq}: ${r.error ?? r.status}`);
    if (['zone', 'dezone', 'bulldoze', 'buildNetwork', 'buildPowerLine', 'buildSubway', 'plop', 'terraform', 'plantTrees', 'setOrdinance', 'takeLoan', 'repayLoan', 'dispatch', 'dispatchBest'].includes(op)) {
      assert(typeof r.result?.ok === 'boolean', `${op} #${r.seq}: malformed acknowledgement`);
    }
    if (op === 'triggerDisaster') assert(typeof r.result === 'boolean', `${op} #${r.seq}: expected a boolean acknowledgement`);
    if (gesture) assert(r.gesture > 0 && r.owner === r.tool, `${op} #${r.seq}: missing issuing-tool gesture`);
    if (tag) assert(r.tagMatchesTool, `${op} #${r.seq}: dispatch tag is not the issuing tool`);
    if (!allowFailure) assert(r.result !== false && r.result?.ok !== false, `${op} #${r.seq}: refused: ${r.result?.reason ?? r.result}`);
  }
  return rows;
}

/** seq 0 is an exact, unposted refusal. Only coalesced slider calls may share a transported ticket. */
export function validateSession(rows) {
  let highest = 0;
  const seen = new Map();
  for (const r of rows) {
    if (r.seq === 0) {
      assert(r.exact === true && r.predicted?.ok === false && r.result?.ok === false, 'invalid unposted refusal');
      continue;
    }
    assert(Number.isSafeInteger(r.seq) && r.seq > 0, 'invalid transported sequence');
    const old = seen.get(r.seq);
    if (old) assert(['setTax', 'setFunding'].includes(r.op) && old.op === r.op && old.args[0] === r.args[0]
      && old.ticketId > 0 && old.ticketId === r.ticketId, 'only coalesced slider calls may share a ticket');
    else { assert(r.seq > highest, 'transported ticket sequence did not increase'); seen.set(r.seq, r); highest = r.seq; }
  }
}

export function brokenBuildVerdict(checks, op, transform, cleanupErrors = []) {
  const failures = checks.filter((c) => c.status === 'FAIL' && c.name !== 'broken-build control');
  const match = failures.length === 1 && failures[0].name === commandCheck(op) && failures[0].failure?.kind === 'ack-timeout' && failures[0].failure.op === op;
  return transform?.op === op && transform?.rewrites === 1 && match && cleanupErrors.length === 0;
}

export class Report {
  checks = [];
  details = { base: BASE };
  get failed() { return this.checks.some((c) => c.status === 'FAIL'); }
  add(name, status, reason, failure) {
    this.checks.push({ name, status, reason, ...(failure ? { failure } : {}) });
    console.log(`${status} ${name}: ${String(reason).replace(/\s*\r?\n\s*/g, ' | ')}`);
  }
  passed(name) { return this.checks.some((c) => c.name === name && c.status === 'PASS'); }
  async check(name, fn, dependencies = []) {
    if (this.signal?.aborted && name !== 'cleanup' && name !== 'console errors') { this.add(name, 'SKIPPED', 'run interrupted'); return; }
    if (this.selection && !this.selection.has(name) && !['production build', 'Chromium', 'console errors', 'cleanup', 'temporary build sweep'].includes(name)) {
      this.add(name, 'SKIPPED', `not selected by --only ${this.only}`); return;
    }
    const missing = dependencies.filter((n) => !this.passed(n));
    if (missing.length) { this.add(name, 'SKIPPED', `prerequisite did not pass: ${missing.join(', ')}`); return; }
    try { this.add(name, 'PASS', (await fn()) ?? 'verified'); }
    catch (e) { this.add(name, 'FAIL', e.message ?? String(e), e.failure); }
  }
  configure(options) {
    this.only = options.only; this.selection = selectedChecks(options.only);
    if (options.breakAck) this.selection.add('other command acknowledgements');
  }
  get exitCode() { return this.failed ? 1 : this.checks.some((c) => c.status === 'PASS') ? 0 : 3; }
  async finish(options) {
    const count = () => Object.fromEntries(['PASS', 'FAIL', 'SKIPPED'].map((s) => [s, this.checks.filter((c) => c.status === s).length]));
    const control = () => {
      const ok = brokenBuildVerdict(this.checks, options.breakAck, this.details.brokenBuild, this.details.cleanupErrors);
      return { name: 'broken-build control', status: ok ? 'PASS' : 'FAIL', reason: ok
        ? `temporary production build withheld ${options.breakAck}.done; only its acknowledgement check failed (exit 1 is expected)`
        : `expected only ${commandCheck(options.breakAck)} to fail with a pending ${options.breakAck} ticket from the transformed build; inspect every FAIL and cleanup diagnostic` };
    };
    const verdict = options.breakAck ? control() : null;
    if (verdict) this.checks.push(verdict);
    if (options.out) {
      try { await writeFile(options.out, JSON.stringify({ options, ...this.details, checks: this.checks, counts: count() }, null, 2) + '\n'); }
      catch (e) {
        this.add('report output', 'FAIL', e.message);
        if (verdict) Object.assign(verdict, control());
      }
    }
    // Do not announce a successful control before discovering an output/cleanup failure.
    if (verdict) console.log(`${verdict.status} ${verdict.name}: ${verdict.reason}`);
    const counts = count(), status = this.failed ? 'FAIL' : counts.PASS ? 'PASS' : 'SKIPPED';
    console.log(`${status} summary: ${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIPPED} skipped`);
  }
}
