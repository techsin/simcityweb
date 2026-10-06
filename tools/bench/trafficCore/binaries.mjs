/**
 * Extra binaries of the same Rust sources for the trafficCore A/B (never installed):
 *   scalar  the shipped flags without simd128 (tools/build-wasm.mjs variant `scalar`)
 *   fdlibm  SIMD + `--cfg traffic_inline_math`: the traffic kernels' exp / log are the inline fdlibm port (fdlibm.rs,
 *           V8's algorithm: exact on V8 only) instead of the shipped imports env.js_exp / env.js_log = the engine's
 *           Math.exp / Math.log — the A/B of what the import costs
 * Built from $TRAFFIC_CRATE (default wasm/sim-kernels) with the same rustflags as build-wasm.mjs, cached by the crate's
 * source hash. $SIM_WASM_PATH (the loader's binary override) should be the same crate's shipped build.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const VARIANTS = {
  scalar: [],
  fdlibm: ['-Ctarget-feature=+simd128', '--cfg', 'traffic_inline_math'],
};

export async function extraBinaries(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const crate = resolve(process.env.TRAFFIC_CRATE ?? join(ROOT, 'wasm', 'sim-kernels'));
  const { sourceHash } = await import(join(ROOT, 'tools', 'build-wasm.mjs'));
  const hash = sourceHash(crate);
  const out = {};
  for (const [name, flags] of Object.entries(VARIANTS)) {
    const file = join(cacheDir, `sim_kernels.${name}.wasm`);
    const stamp = file + '.source';
    if (!(existsSync(file) && existsSync(stamp) && readFileSync(stamp, 'utf8') === hash)) {
      const target = join(cacheDir, `target-${name}`);
      const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: [...flags, `--remap-path-prefix=${crate}=sim-kernels`].join('\x1f') };
      delete env.RUSTFLAGS;
      const r = spawnSync('cargo', ['build', '--release', '--lib', '--target', 'wasm32-unknown-unknown', '--target-dir', target, '--manifest-path', join(crate, 'Cargo.toml')], { env, encoding: 'utf8' });
      const f = join(target, 'wasm32-unknown-unknown', 'release', 'sim_kernels.wasm');
      if (r.status === 0 && existsSync(f)) { copyFileSync(f, file); writeFileSync(stamp, hash); }
      else console.log(`# no ${name} build (cargo missing?):`, (r.stderr || '').slice(-300));
    }
    if (existsSync(file)) out[name] = file;
  }
  return out;
}
