/**
 * The committed binary (src/wasm/sim_kernels.wasm) must match its manifest and the current Rust sources, and export
 * everything the bindings call. Fails with "run npm run build:wasm" when the Rust code changed without a rebuild.
 * Needs no Rust toolchain (hashes only).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs build script (no type declarations)
import { sourceHash } from '../../tools/build-wasm.mjs';
import { SIM_WASM_ABI } from '../../src/wasm/simWasm';
import { BLUR_KERNEL } from '../../src/wasm/kernels/blurBind';

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const manifest = JSON.parse(readFileSync(root('src/wasm/sim_kernels.manifest.json'), 'utf8')) as {
  sha256: string; sourceHash: string; abi: number; bytes: number; exports: string[]; variant: string; featureBits: number;
};
const bytes = readFileSync(root('src/wasm/sim_kernels.wasm'));

describe('committed sim_kernels.wasm', () => {
  it('matches the manifest (sha256, size)', () => {
    expect(bytes.length).toBe(manifest.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
  });

  it('was built from the current Rust sources (else: npm run build:wasm)', () => {
    expect((sourceHash as (dir?: string) => string)(root('wasm/sim-kernels')), 'wasm/sim-kernels changed since the last npm run build:wasm').toBe(manifest.sourceHash);
  });

  it('has the ABI and every export the bindings call, and no imports', () => {
    const mod = new WebAssembly.Module(bytes);
    expect(WebAssembly.Module.imports(mod)).toEqual([]);
    const names = new Set(WebAssembly.Module.exports(mod).map((e) => e.name));
    for (const n of ['memory', '__heap_base', 'sk_abi_version', 'sk_features', ...BLUR_KERNEL.required]) expect(names.has(n), n).toBe(true);
    const inst = new WebAssembly.Instance(mod, {});
    expect((inst.exports.sk_abi_version as () => number)()).toBe(SIM_WASM_ABI);
    expect(manifest.abi).toBe(SIM_WASM_ABI);
    // the shipped variant is the SIMD build (feature bit 1)
    expect(manifest.variant).toBe('simd');
    expect(((inst.exports.sk_features as () => number)() & 1) === 1).toBe(true);
  });

  it('stays small (no std / fmt bloat slipped in)', () => {
    expect(bytes.length).toBeLessThan(256 * 1024);
  });
});
