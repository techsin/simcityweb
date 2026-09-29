//! Exact ports of V8's `Math.exp` / `Math.log` (src/base/ieee754.cc: FreeBSD msun e_exp.c / e_log.c, including
//! V8's `exp(1) == E` special case), for kernels that must reproduce JS results bit for bit without importing the JS
//! functions (the shipped binary has no imports: tests/wasm/binary.test.ts).
//!
//! Every operation is a plain IEEE double operation in the C source order; Rust / LLVM never contract or reassociate
//! them and wasm has no FMA outside relaxed-simd, so the wasm result is the fdlibm result on every engine.
//! Whether that equals the ENGINE's Math.exp / Math.log is an empirical property of the engine:
//!  * V8 (Node 22 / V8 12.4, Chromium 141): identical on every argument tested — every argument the traffic fixtures
//!    produce plus 10^8 random ones (tools/bench/trafficCore.bench.mjs `math`, tests/wasm/trafficCore.test.ts);
//!  * other engines may use another libm: src/wasm/kernels/trafficBind.ts runs a self-test against the engine's
//!    Math.exp / Math.log before the first traffic kernel call and runs the traffic phases in JS if any bit differs.
//! A benchmark-only build (`--cfg traffic_import_math`) calls imported JS functions instead (env.js_exp / env.js_log),
//! to price that alternative (see traffic.rs).

const HALF: [f64; 2] = [0.5, -0.5];
const O_THRESHOLD: f64 = 7.09782712893383973096e+02; // 0x40862E42, 0xFEFA39EF
const U_THRESHOLD: f64 = -7.45133219101941108420e+02; // 0xC0874910, 0xD52D3051
const LN2HI: [f64; 2] = [6.93147180369123816490e-01, -6.93147180369123816490e-01]; // 0x3FE62E42, 0xFEE00000
const LN2LO: [f64; 2] = [1.90821492927058770002e-10, -1.90821492927058770002e-10]; // 0x3DEA39EF, 0x35793C76
const INVLN2: f64 = 1.44269504088896338700e+00; // 0x3FF71547, 0x652B82FE
const P1: f64 = 1.66666666666666019037e-01; // 0x3FC55555, 0x5555553E
const P2: f64 = -2.77777777770155933842e-03; // 0xBF66C16C, 0x16BEBD93
const P3: f64 = 6.61375632143793436117e-05; // 0x3F11566A, 0xAF25DE2C
const P4: f64 = -1.65339022054652515390e-06; // 0xBEBBBD41, 0xC5D26BF1
const P5: f64 = 4.13813679705723846039e-08; // 0x3E663769, 0x72BEA4D0
const E: f64 = 2.718281828459045; // 0x4005BF0A, 0x8B145769
const HUGE: f64 = 1.0e+300;
const TWOM1000: f64 = 9.33263618503218878990e-302; // 2**-1000
const TWO1023: f64 = 8.988465674311579539e307; // 0x1p1023

/// `Math.exp(x)` as V8 computes it (ieee754::exp)
#[inline]
pub fn exp(x0: f64) -> f64 {
    let mut x = x0;
    let bits = x.to_bits();
    let mut hx = (bits >> 32) as u32;
    let xsb = ((hx >> 31) & 1) as usize;
    hx &= 0x7fff_ffff;
    let mut hi = 0.0f64;
    let mut lo = 0.0f64;
    let mut k: i32 = 0;
    // filter out non-finite argument
    if hx >= 0x4086_2E42 {
        // |x| >= 709.78...
        if hx >= 0x7ff0_0000 {
            let lx = bits as u32;
            if ((hx & 0xfffff) | lx) != 0 {
                return x + x; // NaN
            }
            return if xsb == 0 { x } else { 0.0 }; // exp(+-inf) = {inf, 0}
        }
        if x > O_THRESHOLD {
            return HUGE * HUGE; // overflow
        }
        if x < U_THRESHOLD {
            return TWOM1000 * TWOM1000; // underflow
        }
    }
    // argument reduction
    if hx > 0x3fd6_2e42 {
        // |x| > 0.5 ln2
        if hx < 0x3ff0_a2b2 {
            // and |x| < 1.5 ln2
            if x == 1.0 {
                return E;
            }
            hi = x - LN2HI[xsb];
            lo = LN2LO[xsb];
            k = 1 - xsb as i32 - xsb as i32;
        } else {
            k = (INVLN2 * x + HALF[xsb]) as i32; // static_cast<int>: truncation (|value| < 1100 here)
            let t = k as f64;
            hi = x - t * LN2HI[0]; // t * ln2HI is exact here
            lo = t * LN2LO[0];
        }
        x = hi - lo;
    } else if hx < 0x3e30_0000 {
        // |x| < 2**-28
        if HUGE + x > 1.0 {
            return 1.0 + x; // trigger inexact
        }
    } else {
        k = 0;
    }
    // x is now in primary range
    let t = x * x;
    let twopk = if k >= -1021 {
        f64::from_bits(((0x3ff0_0000i32.wrapping_add(k << 20)) as u32 as u64) << 32)
    } else {
        f64::from_bits(((0x3ff0_0000i32.wrapping_add((k + 1000) << 20)) as u32 as u64) << 32)
    };
    let c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    if k == 0 {
        return 1.0 - ((x * c) / (c - 2.0) - x);
    }
    let y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
    if k >= -1021 {
        if k == 1024 {
            return y * 2.0 * TWO1023;
        }
        return y * twopk;
    }
    y * twopk * TWOM1000
}

const LN2_HI: f64 = 6.93147180369123816490e-01; // 3fe62e42 fee00000
const LN2_LO: f64 = 1.90821492927058770002e-10; // 3dea39ef 35793c76
const TWO54: f64 = 1.80143985094819840000e+16; // 43500000 00000000
const LG1: f64 = 6.666666666666735130e-01; // 3FE55555 55555593
const LG2: f64 = 3.999999999940941908e-01; // 3FD99999 9997FA04
const LG3: f64 = 2.857142874366239149e-01; // 3FD24924 94229359
const LG4: f64 = 2.222219843214978396e-01; // 3FCC71C5 1D8E78AF
const LG5: f64 = 1.818357216161805012e-01; // 3FC74664 96CB03DE
const LG6: f64 = 1.531383769920937332e-01; // 3FC39A09 D078C69F
const LG7: f64 = 1.479819860511658591e-01; // 3FC2F112 DF3E5244

/// `Math.log(x)` as V8 computes it (ieee754::log)
#[inline]
pub fn log(x0: f64) -> f64 {
    let mut x = x0;
    let bits = x.to_bits();
    let mut hx = (bits >> 32) as u32 as i32;
    let lx = bits as u32;
    let mut k: i32 = 0;
    if hx < 0x0010_0000 {
        // x < 2**-1022
        if ((hx & 0x7fff_ffff) as u32 | lx) == 0 {
            return -TWO54 / 0.0; // log(+-0) = -inf
        }
        if hx < 0 {
            return (x - x) / 0.0; // log(-#) = NaN
        }
        k -= 54;
        x *= TWO54; // subnormal number, scale up x
        hx = (x.to_bits() >> 32) as u32 as i32;
    }
    if hx >= 0x7ff0_0000 {
        return x + x;
    }
    k += (hx >> 20) - 1023;
    hx &= 0x000f_ffff;
    let mut i = (hx + 0x95f64) & 0x10_0000;
    // normalize x or x/2
    x = f64::from_bits((((hx | (i ^ 0x3ff0_0000)) as u32 as u64) << 32) | (x.to_bits() & 0xffff_ffff));
    k += i >> 20;
    let f = x - 1.0;
    if (0x000f_ffff & (2 + hx)) < 3 {
        // -2**-20 <= f < 2**-20
        if f == 0.0 {
            if k == 0 {
                return 0.0;
            }
            let dk = k as f64;
            return dk * LN2_HI + dk * LN2_LO;
        }
        let r = f * f * (0.5 - 0.33333333333333333 * f);
        if k == 0 {
            return f - r;
        }
        let dk = k as f64;
        return dk * LN2_HI - ((r - dk * LN2_LO) - f);
    }
    let s = f / (2.0 + f);
    let dk = k as f64;
    let z = s * s;
    i = hx - 0x6147a;
    let w = z * z;
    let j = 0x6b851 - hx;
    let t1 = w * (LG2 + w * (LG4 + w * LG6));
    let t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
    i |= j;
    let r = t2 + t1;
    if i > 0 {
        let hfsq = 0.5 * f * f;
        if k == 0 {
            return f - (hfsq - s * (hfsq + r));
        }
        dk * LN2_HI - ((hfsq - (s * (hfsq + r) + dk * LN2_LO)) - f)
    } else {
        if k == 0 {
            return f - s * (f - r);
        }
        dk * LN2_HI - ((s * (f - r) - dk * LN2_LO) - f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// fdlibm is accurate to < 1 ulp: compare with the host libm within 1 ulp on a sweep (the bit-exact comparison
    /// against V8 runs in JS, tests/wasm/trafficCore.test.ts)
    fn ulps(a: f64, b: f64) -> u64 {
        if a == b || (a.is_nan() && b.is_nan()) {
            return 0;
        }
        (a.to_bits() as i64 - b.to_bits() as i64).unsigned_abs()
    }

    #[test]
    fn exp_log_within_one_ulp_of_host() {
        let mut s: u64 = 0x2545f4914f6cdd1d;
        for _ in 0..500_000 {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            let x = ((s >> 11) as f64 / (1u64 << 53) as f64 - 0.5) * 1400.0;
            assert!(ulps(exp(x), x.exp()) <= 1, "exp({x:e})");
            let y = f64::from_bits(s >> 1); // positive doubles of every exponent
            if y.is_finite() {
                assert!(ulps(log(y), y.ln()) <= 1, "log({y:e})");
            }
        }
    }

    #[test]
    fn specials() {
        assert_eq!(exp(0.0), 1.0);
        assert_eq!(exp(-0.0), 1.0);
        assert_eq!(exp(1.0), E);
        assert_eq!(exp(f64::INFINITY), f64::INFINITY);
        assert_eq!(exp(f64::NEG_INFINITY).to_bits(), 0);
        assert!(exp(f64::NAN).is_nan());
        assert_eq!(exp(710.0), f64::INFINITY);
        assert_eq!(exp(-746.0), 0.0);
        assert_eq!(log(1.0), 0.0);
        assert_eq!(log(0.0), f64::NEG_INFINITY);
        assert_eq!(log(-0.0), f64::NEG_INFINITY);
        assert!(log(-1.0).is_nan());
        assert!(log(f64::NAN).is_nan());
        assert_eq!(log(f64::INFINITY), f64::INFINITY);
        assert!(log(5e-324).is_finite());
    }
}
