//! Exact equivalents of the JS `Math` functions the kernels need, usable under #![no_std] (core has no `floor`).
//! Each one must return exactly what V8 returns for every input, including -0, NaN and infinities.

/// `Math.floor(x)`: musl's bit-exact floor (round toward -inf), valid in any rounding mode-free wasm/f64 setting.
/// floor(-0) = -0, floor(-0.5) = -1, floor(NaN) = NaN, floor(+-inf) = +-inf.
#[inline]
pub fn floor(x: f64) -> f64 {
    #[cfg(any(feature = "std", not(target_arch = "wasm32")))]
    {
        x.floor()
    }
    #[cfg(all(not(feature = "std"), target_arch = "wasm32"))]
    {
        const TOINT: f64 = 4503599627370496.0; // 2^52
        let ui = x.to_bits();
        let e = ((ui >> 52) & 0x7ff) as i32;
        if e >= 0x3ff + 52 || x == 0.0 {
            return x; // integral already, NaN, inf or +-0
        }
        // y = int(x) - x, where int(x) is the integer nearest to x (round-to-nearest-even via the 2^52 trick)
        let y = if (ui >> 63) != 0 { x - TOINT + TOINT - x } else { x + TOINT - TOINT - x };
        if e < 0x3ff {
            // |x| < 1
            return if (ui >> 63) != 0 { -1.0 } else { 0.0 };
        }
        if y > 0.0 { x + y - 1.0 } else { x + y }
    }
}

/// Clamp an integral f64 (e.g. a `Math.floor` result used as a grid offset) to [-lim, lim] as i64. Callers use it only
/// where every |v| > lim behaves like lim (all indices out of range either way). NaN maps to `lim` (out of range).
#[inline]
pub fn clamp_offset(v: f64, lim: i64) -> i64 {
    if v != v {
        return lim;
    }
    let l = lim as f64;
    if v > l {
        lim
    } else if v < -l {
        -lim
    } else {
        v as i64
    }
}

#[cfg(test)]
mod tests {
    /// the wasm floor path, compiled for the host so it can be compared with std's floor
    fn musl_floor(x: f64) -> f64 {
        const TOINT: f64 = 4503599627370496.0;
        let ui = x.to_bits();
        let e = ((ui >> 52) & 0x7ff) as i32;
        if e >= 0x3ff + 52 || x == 0.0 {
            return x;
        }
        let y = if (ui >> 63) != 0 { x - TOINT + TOINT - x } else { x + TOINT - TOINT - x };
        if e < 0x3ff {
            return if (ui >> 63) != 0 { -1.0 } else { 0.0 };
        }
        if y > 0.0 { x + y - 1.0 } else { x + y }
    }

    #[test]
    fn floor_matches_std_bitwise() {
        let specials = [
            0.0, -0.0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5, 2.5, -2.5, 1e-300, -1e-300, 4503599627370495.5, -4503599627370495.5,
            4503599627370496.0, 9007199254740993.0, f64::INFINITY, f64::NEG_INFINITY, f64::MAX, f64::MIN, f64::MIN_POSITIVE,
            0.49999999999999994, -0.49999999999999994, 255.99999999999997, -255.99999999999997,
        ];
        for &x in &specials {
            assert_eq!(musl_floor(x).to_bits(), x.floor().to_bits(), "x = {x:e}");
        }
        assert!(musl_floor(f64::NAN).is_nan());
        // xorshift over all exponents
        let mut s: u64 = 0x9e3779b97f4a7c15;
        for _ in 0..2_000_000 {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            let x = f64::from_bits(s);
            if x.is_nan() {
                continue;
            }
            assert_eq!(musl_floor(x).to_bits(), x.floor().to_bits(), "x = {x:e}");
            let y = (s as i64 as f64) / 1024.0; // many small fractional values
            assert_eq!(musl_floor(y).to_bits(), y.floor().to_bits(), "y = {y:e}");
        }
    }
}
