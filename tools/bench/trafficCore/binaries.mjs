/**
 * Extra binaries of the same Rust sources for the trafficCore A/B (never installed): `scalar` (no simd128, via
 * tools/build-wasm.mjs --variant scalar) and `imp` (SIMD + `--cfg traffic_import_math`: the traffic kernels' exp / log
 * are imported JS functions env.js_exp / env.js_log instead of the inline fdlibm port — benchmark-only, the shipped
 * binary has no imports). Cached by the manifest's source hash.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CRATE = join(ROOT, 'wasm', 'sim-kernels');

export async function extraBinaries(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const { sourceHash } = await import(join(ROOT, 'tools', 'build-wasm.mjs'));
  const hash = sourceHash();
  const out = {};
  // scalar
  const scalar = join(cacheDir, 'sim_kernels.scalar.wasm');
  const stampS = scalar + '.source';
  if (!(existsSync(scalar) && existsSync(stampS) && readFileSync(stampS, 'utf8') === hash)) {
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-wasm.mjs'), '--variant', 'scalar', '--out', cacheDir], { encoding: 'utf8', cwd: ROOT });
    if (r.status === 0 && existsSync(scalar)) writeFileSync(stampS, hash);
    else console.log('# no scalar build (cargo missing?):', (r.stderr || '').slice(-300));
  }
  if (existsSync(scalar)) out.scalar = scalar;
  // imported exp / log
  const imp = join(cacheDir, 'sim_kernels.imp.wasm');
  const stampI = imp + '.source';
  if (!(existsSync(imp) && existsSync(stampI) && readFileSync(stampI, 'utf8') === hash)) {
    const target = join(cacheDir, 'target-imp');
    const flags = ['-Ctarget-feature=+simd128', '--cfg', 'traffic_import_math', `--remap-path-prefix=${CRATE}=sim-kernels`];
    const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f') };
    delete env.RUSTFLAGS;
    const r = spawnSync('cargo', ['build', '--release', '--lib', '--target', 'wasm32-unknown-unknown', '--target-dir', target, '--manifest-path', join(CRATE, 'Cargo.toml')], { env, encoding: 'utf8' });
    const f = join(target, 'wasm32-unknown-unknown', 'release', 'sim_kernels.wasm');
    if (r.status === 0 && existsSync(f)) { copyFileSync(f, imp); writeFileSync(stampI, hash); }
    else console.log('# no imported-math build:', (r.stderr || '').slice(-300));
  }
  if (existsSync(imp)) out.imp = imp;
  return out;
}
