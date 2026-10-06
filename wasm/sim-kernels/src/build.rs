//! Cargo build script (Cargo.toml `build = "src/build.rs"`; it lives under src/ so tools/build-wasm.mjs's source hash
//! — and with it tests/wasm/binary.test.ts — covers it). Not part of the library's module tree.
//!
//! PRE-SIZED LINEAR MEMORY. The wasm binary starts with INITIAL_MEMORY bytes of linear memory instead of LLD's minimum
//! (stack + static data, 17 pages), so the JS-side WasmHeap never has to call `memory.grow` for a 256² city: the
//! loader's 4 MiB staging reserve, the services tier engine (≈ 20–40 MiB at 1M population) and adopted CityState
//! layers (12.3 MiB) all fit. Why it matters: every `memory.grow` DETACHES the old ArrayBuffer, and the first detach in
//! a V8 isolate permanently invalidates V8's "ArrayBuffer detaching" protector — after that, every typed-array access
//! in the whole isolate (the JS sim included) carries a detach check: measured 7–16 % slower for the whole JS sim on
//! dense1m (independent A/B of the services port). A pre-sized memory that never grows keeps the protector intact.
//! Untouched pages cost no physical memory (they are zero pages until written).
//!
//! The value is exported by the binary as `sk_initial_memory()` (abi.rs) so the loader / tests can check it.
use std::env;

/// initial linear memory in bytes (a multiple of 64 KiB). 64 MiB covers the largest map (256²; region tiles are
/// 64 / 128 / 256 cells) with every ported kernel's state resident; bigger needs still work (the heap grows, at the
/// protector cost above) — raise this instead.
const INITIAL_MEMORY: u64 = 64 << 20;

fn main() {
    println!("cargo:rerun-if-changed=src/build.rs");
    println!("cargo:rustc-env=SK_INITIAL_MEMORY={INITIAL_MEMORY}");
    let target = env::var("TARGET").unwrap_or_default();
    // only the wasm cdylib: host builds (cargo test) link with the system linker, which knows no such flag
    if target.starts_with("wasm32") {
        println!("cargo:rustc-link-arg-cdylib=--initial-memory={INITIAL_MEMORY}");
    }
}
