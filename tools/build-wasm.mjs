#!/usr/bin/env node
/**
 * Build the Rust simulation kernels (wasm/sim-kernels) and install the shipped binary into src/wasm/.
 *
 *   npm run build:wasm                      build the shipped variant -> src/wasm/sim_kernels.wasm + manifest
 *   node tools/build-wasm.mjs --all         also build every experiment variant and print the size table
 *   node tools/build-wasm.mjs --variant mvp [--out DIR]   build one variant (copied to DIR, never installed)
 *   node tools/build-wasm.mjs --check       rebuild in a temp target dir and verify the committed binary is identical
 *   node tools/build-wasm.mjs --if-available   exit 0 with a note when cargo is missing (CI without Rust)
 *
 * The binary and src/wasm/sim_kernels.manifest.json are COMMITTED: players / CI without Rust build the game with them.
 * tests/wasm/binary.test.ts fails when the Rust sources no longer match the manifest (forgot to run build:wasm).
 * No external crates, no wasm-bindgen / wasm-pack / binaryen: plain `cargo build --target wasm32-unknown-unknown`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = join(ROOT, 'wasm', 'sim-kernels');
const OUT_DIR = join(ROOT, 'src', 'wasm');
const OUT_WASM = join(OUT_DIR, 'sim_kernels.wasm');
const OUT_MANIFEST = join(OUT_DIR, 'sim_kernels.manifest.json');
const TARGET = 'wasm32-unknown-unknown';
const ARTIFACT = 'sim_kernels.wasm';

/**
 * Variants. The default wasm32 CPU of rustc 1.94 (LLVM 21, "generic") already enables bulk-memory, multivalue,
 * mutable-globals, nontrapping-fptoint, reference-types and sign-ext; `mvp` turns all of them off.
 * relaxed-simd is never enabled: its results are implementation-defined (the sim must be bit-exact).
 */
const VARIANTS = {
  simd: { flags: ['-Ctarget-feature=+simd128'], features: [], shipped: true, note: 'generic CPU + simd128 (shipped)' },
  scalar: { flags: [], features: [], note: 'generic CPU (bulk-memory, nontrapping-fptoint, sign-ext, mutable-globals, multivalue, reference-types)' },
  mvp: { flags: ['-Ctarget-cpu=mvp'], features: [], note: 'MVP only (no post-MVP features)' },
  std: { flags: ['-Ctarget-feature=+simd128'], features: ['std'], note: 'simd + std instead of #![no_std] (size experiment)' },
  names: { flags: ['-Ctarget-feature=+simd128'], features: [], strip: false, note: 'simd with the name section (profiling)' },
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function haveCargo() {
  const r = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

/** sha256 over the crate sources (path + content), independent of the machine */
export function sourceHash(crateDir = CRATE) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.rs')) files.push(p);
    }
  };
  walk(join(crateDir, 'src'));
  for (const f of ['Cargo.toml', 'Cargo.lock']) if (existsSync(join(crateDir, f))) files.push(join(crateDir, f));
  files.sort();
  const h = createHash('sha256');
  for (const f of files) {
    h.update(relative(crateDir, f).split('\\').join('/'));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex');
}

function build(name, targetRoot) {
  const v = VARIANTS[name];
  if (!v) throw new Error(`unknown variant ${name} (${Object.keys(VARIANTS).join(', ')})`);
  const targetDir = join(targetRoot, name);
  // deterministic paths inside the binary (bounds-check panic locations): crate dir -> "sim-kernels"
  const rustflags = [...v.flags, `--remap-path-prefix=${CRATE}=sim-kernels`];
  const cargoArgs = ['build', '--release', '--lib', '--target', TARGET, '--target-dir', targetDir, '--manifest-path', join(CRATE, 'Cargo.toml')];
  if (v.features.length) cargoArgs.push('--features', v.features.join(','));
  const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: rustflags.join('\x1f') };
  delete env.RUSTFLAGS;
  if (v.strip === false) env.CARGO_PROFILE_RELEASE_STRIP = 'false';
  const t0 = Date.now();
  const r = spawnSync('cargo', cargoArgs, { env, encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(r.stdout + r.stderr);
    throw new Error(`cargo build (${name}) failed`);
  }
  const file = join(targetDir, TARGET, 'release', ARTIFACT);
  const bytes = readFileSync(file);
  return { name, file, bytes, rustflags: v.flags, features: v.features, note: v.note, ms: Date.now() - t0 };
}

function sizes(buf) {
  return {
    bytes: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
}

/** the binary's imports: the engine's Math.exp / Math.log (src/wasm/simWasm.ts simWasmImports(), same object) */
const IMPORTS = { env: { js_exp: Math.exp, js_log: Math.log } };

function describe(buf) {
  const mod = new WebAssembly.Module(buf);
  const inst = new WebAssembly.Instance(mod, IMPORTS);
  const ex = inst.exports;
  return {
    abi: ex.sk_abi_version(),
    featureBits: ex.sk_features(),
    exports: WebAssembly.Module.exports(mod).filter((e) => e.kind === 'function').map((e) => e.name).sort(),
    imports: WebAssembly.Module.imports(mod).map((i) => `${i.module}.${i.name}`).sort(),
    heapBase: Number(ex.__heap_base.value),
    initialPages: ex.memory.buffer.byteLength / 65536,
  };
}

function rustcVersion() {
  try {
    return execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function manifestFor(b) {
  const d = describe(b.bytes);
  return {
    file: ARTIFACT,
    variant: b.name,
    abi: d.abi,
    featureBits: d.featureBits,
    rustflags: b.rustflags,
    cargoFeatures: b.features,
    rustc: rustcVersion(),
    ...sizes(b.bytes),
    sha256: createHash('sha256').update(b.bytes).digest('hex'),
    sourceHash: sourceHash(),
    heapBase: d.heapBase,
    initialPages: d.initialPages,
    imports: d.imports,
    exports: d.exports,
  };
}

function main() {
  if (!haveCargo()) {
    const msg = 'build-wasm: cargo not found — the committed src/wasm/sim_kernels.wasm is used as is (install Rust + `rustup target add wasm32-unknown-unknown` to rebuild)';
    if (flag('--if-available')) {
      console.log(msg);
      return;
    }
    console.error(msg);
    process.exit(1);
  }
  const targetRoot = join(CRATE, 'target');

  if (flag('--check')) {
    const tmp = mkdtempSync(join(tmpdir(), 'sim-kernels-check-'));
    try {
      const b = build('simd', tmp);
      const committed = existsSync(OUT_WASM) ? readFileSync(OUT_WASM) : Buffer.alloc(0);
      const same = committed.equals(b.bytes);
      const man = existsSync(OUT_MANIFEST) ? JSON.parse(readFileSync(OUT_MANIFEST, 'utf8')) : null;
      const srcOk = man?.sourceHash === sourceHash();
      console.log(`check: rebuilt ${b.bytes.length} B vs committed ${committed.length} B -> ${same ? 'IDENTICAL' : 'DIFFERENT'}; manifest sourceHash ${srcOk ? 'matches' : 'STALE'}`);
      if (!same || !srcOk) process.exit(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return;
  }

  const one = opt('--variant');
  const names = flag('--all') ? Object.keys(VARIANTS) : one ? [one] : ['simd'];
  const outDir = opt('--out');
  if (outDir) mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const name of names) {
    const b = build(name, targetRoot);
    const s = sizes(b.bytes);
    rows.push({ variant: name, ...s, note: b.note, ms: b.ms });
    if (outDir) copyFileSync(b.file, join(outDir, `sim_kernels.${name}.wasm`));
    if (VARIANTS[name].shipped && !one) {
      copyFileSync(b.file, OUT_WASM);
      writeFileSync(OUT_MANIFEST, JSON.stringify(manifestFor(b), null, 2) + '\n');
      console.log(`installed ${relative(ROOT, OUT_WASM)} (${s.bytes} B, gzip ${s.gzip} B, brotli ${s.brotli} B) + ${relative(ROOT, OUT_MANIFEST)}`);
    }
  }
  console.log('variant   bytes   gzip  brotli  build  note');
  for (const r of rows) {
    console.log(`${r.variant.padEnd(8)} ${String(r.bytes).padStart(6)} ${String(r.gzip).padStart(6)} ${String(r.brotli).padStart(7)} ${String((r.ms / 1000).toFixed(1) + 's').padStart(6)}  ${r.note}`);
  }
  // guard against an accidentally huge binary (e.g. std + fmt pulled in by a debug print)
  const shipped = existsSync(OUT_WASM) ? statSync(OUT_WASM).size : 0;
  if (shipped > 512 * 1024) console.warn(`WARNING: ${relative(ROOT, OUT_WASM)} is ${shipped} B (> 512 KiB)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
