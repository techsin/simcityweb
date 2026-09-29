//! Tiny exports for the memory-model study (tools/bench/wasm-memory.bench.ts): call overhead and raw bandwidth.

/// empty call (per-call JS -> wasm overhead)
#[unsafe(no_mangle)]
pub extern "C" fn sk_noop() {}

/// call with the typical kernel argument shape (5 x i32/f64), returns something so it is not dead code
#[unsafe(no_mangle)]
pub extern "C" fn sk_args5(a: u32, b: u32, c: u32, d: i32, e: f64) -> f64 {
    (a ^ b ^ c) as f64 + d as f64 + e
}

/// sum of `n` f32 values at `ptr` in f64, in index order (a one-pass read over a layer)
///
/// # Safety
/// `ptr` must point to `n` f32 values in linear memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sk_sum_f32(ptr: *const f32, n: u32) -> f64 {
    let a = unsafe { crate::abi::f32s(ptr, n as usize) };
    let mut s = 0.0f64;
    for &v in a {
        s += v as f64;
    }
    s
}

/// dst[i] = src[i] * k (f64 multiply, f32 store): a one-pass read + write over a layer
///
/// # Safety
/// `src` / `dst` must point to `n` f32 values each; they may be equal but must not partially overlap.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sk_scale_f32(src: *const f32, dst: *mut f32, n: u32, k: f64) {
    let n = n as usize;
    if src == dst as *const f32 {
        let d = unsafe { crate::abi::f32s_mut(dst, n) };
        for v in d.iter_mut() {
            *v = (*v as f64 * k) as f32;
        }
    } else {
        let s = unsafe { crate::abi::f32s(src, n) };
        let d = unsafe { crate::abi::f32s_mut(dst, n) };
        for (o, &v) in d.iter_mut().zip(s) {
            *o = (v as f64 * k) as f32;
        }
    }
}
