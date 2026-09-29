//! Metropolis simulation kernels (Rust -> wasm32-unknown-unknown, raw C ABI exports, no external crates).
//!
//! Porting rules (details: wasm/README.md):
//!  * Every export is a pure function over caller-provided linear memory: pointers (u32 byte offsets) + sizes +
//!    scalars in, results written in place. Kernels NEVER allocate and never call `memory.grow`, so typed-array
//!    views held by JS stay valid across a kernel call; scratch buffers are passed in by the caller.
//!  * Bit-exact with the JS original: JS computes in f64 and rounds to f32 only when storing into a Float32Array,
//!    so ported code computes in f64 and rounds (`as f32`) exactly where the JS stores. No FMA (`mul_add`), no
//!    reassociation, no relaxed-simd; iteration order of every floating-point accumulation is the JS order.
//!  * No globals / statics in kernels (keeps them re-entrant and thread-safe for a future shared-memory build).
//!
//! Export naming: `<module>_<function>` (e.g. `blur_box_h`); infrastructure exports start with `sk_`.
#![cfg_attr(all(target_arch = "wasm32", not(feature = "std")), no_std)]

#[cfg(all(target_arch = "wasm32", not(feature = "std")))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    // bounds-check failures and other panics trap; the JS wrapper catches the RuntimeError, disables wasm and
    // falls back to the JS kernel (see src/wasm/simWasm.ts)
    core::arch::wasm32::unreachable()
}

pub mod abi;
pub mod blur;
pub mod catch;
pub mod econ;
pub mod fdlibm;
pub mod fields;
pub mod math;
pub mod popagg;
pub mod probe;
pub mod search;
pub mod traffic;
