//! ABI helpers shared by all kernels: build info exports and raw-pointer -> slice conversion.
//!
//! JS passes byte offsets into linear memory as i32/u32 (pointers) and element counts. The helpers below turn them
//! into slices; a kernel then works on safe slices (an out-of-range index traps instead of corrupting memory).

/// Bump when an export changes signature or semantics; src/wasm/simWasm.ts refuses a binary with another version.
pub const ABI_VERSION: u32 = 1;

/// ABI version of this binary (checked by the JS loader).
#[unsafe(no_mangle)]
pub extern "C" fn sk_abi_version() -> u32 {
    ABI_VERSION
}

/// Build feature bits: 1 = simd128, 2 = linked with std (size experiment), 4 = bulk-memory, 8 = nontrapping-fptoint,
/// 16 = sign-ext, 32 = atomics (shared-memory build).
#[unsafe(no_mangle)]
pub extern "C" fn sk_features() -> u32 {
    let mut f = 0;
    if cfg!(target_feature = "simd128") {
        f |= 1;
    }
    if cfg!(feature = "std") {
        f |= 2;
    }
    if cfg!(target_feature = "bulk-memory") {
        f |= 4;
    }
    if cfg!(target_feature = "nontrapping-fptoint") {
        f |= 8;
    }
    if cfg!(target_feature = "sign-ext") {
        f |= 16;
    }
    if cfg!(target_feature = "atomics") {
        f |= 32;
    }
    f
}

/// # Safety
/// `ptr` must point to `len` initialised, 4-byte aligned f32 values that no `&mut` slice aliases.
#[inline(always)]
pub unsafe fn f32s<'a>(ptr: *const f32, len: usize) -> &'a [f32] {
    unsafe { core::slice::from_raw_parts(ptr, len) }
}

/// # Safety
/// `ptr` must point to `len` 4-byte aligned f32 values that no other slice aliases.
#[inline(always)]
pub unsafe fn f32s_mut<'a>(ptr: *mut f32, len: usize) -> &'a mut [f32] {
    unsafe { core::slice::from_raw_parts_mut(ptr, len) }
}

/// # Safety
/// `ptr` must point to `len` 8-byte aligned f64 values that no other slice aliases.
#[inline(always)]
pub unsafe fn f64s_mut<'a>(ptr: *mut f64, len: usize) -> &'a mut [f64] {
    unsafe { core::slice::from_raw_parts_mut(ptr, len) }
}

/// # Safety
/// `ptr` must point to `len` 4-byte aligned i32 values that no other slice aliases.
#[inline(always)]
pub unsafe fn i32s_mut<'a>(ptr: *mut i32, len: usize) -> &'a mut [i32] {
    unsafe { core::slice::from_raw_parts_mut(ptr, len) }
}
