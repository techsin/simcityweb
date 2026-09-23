/**
 * Offline audio analysis for the audio lab: BS.1770-style loudness (K-weighting, gated integrated, momentary,
 * short-term, LRA), sample + approx. true peak, RMS, crest, DC, clipping, silence gaps, spectral centroid and band
 * energy, spectral-flux onset density, stereo correlation, and log-frequency spectrogram columns.
 */

// ------------------------------------------------------------------ FFT (radix-2, in place)
export class FFT {
  readonly n: number;
  private cos: Float64Array;
  private sin: Float64Array;
  private rev: Uint32Array;
  constructor(n: number) {
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  /** in-place complex FFT */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * this.cos[k] - im[b] * this.sin[k];
          const ti = re[b] * this.sin[k] + im[b] * this.cos[k];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const round = (x: number, d = 2): number => (isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

// ------------------------------------------------------------------ K-weighting
function kCoeffs(sr: number): { b: number[]; a: number[] }[] {
  // high shelf (stage 1)
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  // RLB high pass (stage 2)
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  const s2 = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [s1, s2];
}

function kWeight(x: Float32Array, sr: number): Float32Array {
  const out = new Float32Array(x.length);
  const st = kCoeffs(sr);
  let src: ArrayLike<number> = x;
  for (const { b, a } of st) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xi = src[i];
      const y = b[0] * xi + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
    src = out; // direct form I can run in place (previous inputs are kept in x1/x2)
  }
  return out;
}

export interface LoudnessResult {
  integrated: number;
  momentaryMax: number;
  shortTermMax: number;
  /** short-term (3 s) loudness every 100 ms */
  shortTerm: number[];
  /** momentary (400 ms) loudness every 100 ms */
  momentary: number[];
  lra: number;
}

/** BS.1770-4 loudness of a stereo segment [a, b) (samples) */
export function loudness(L: Float32Array, R: Float32Array, sr: number, a = 0, b = L.length): LoudnessResult {
  const kl = kWeight(L.subarray(a, b), sr), kr = kWeight(R.subarray(a, b), sr);
  const hop = Math.round(sr * 0.1);
  const nSub = Math.floor(kl.length / hop);
  const sub = new Float64Array(nSub);
  for (let j = 0; j < nSub; j++) {
    let s = 0;
    for (let i = j * hop, e = i + hop; i < e; i++) s += kl[i] * kl[i] + kr[i] * kr[i];
    sub[j] = s;
  }
  const lk = (ms: number) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);
  const blocks = (n: number) => {
    const out: number[] = [];
    for (let j = 0; j + n <= nSub; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += sub[j + k];
      out.push(s / (n * hop));
    }
    return out;
  };
  const m400 = blocks(4);
  const s3 = blocks(30);
  const gated = (zs: number[], rel: number) => {
    const abs = zs.filter((z) => lk(z) > -70);
    if (!abs.length) return { value: -Infinity, kept: [] as number[] };
    const g = lk(abs.reduce((x, y) => x + y, 0) / abs.length) + rel;
    const kept = abs.filter((z) => lk(z) > g);
    return { value: kept.length ? lk(kept.reduce((x, y) => x + y, 0) / kept.length) : -Infinity, kept };
  };
  const integrated = gated(m400, -10).value;
  // LRA: short-term values, -20 LU relative gate, 10th..95th percentile
  let lra = 0;
  {
    const abs = s3.filter((z) => lk(z) > -70);
    if (abs.length > 2) {
      const g = lk(abs.reduce((x, y) => x + y, 0) / abs.length) - 20;
      const v = abs.map(lk).filter((l) => l > g).sort((x, y) => x - y);
      if (v.length > 2) lra = v[Math.floor(v.length * 0.95) - 1] - v[Math.floor(v.length * 0.1)];
    }
  }
  const momentary = m400.map(lk);
  const shortTerm = s3.map(lk);
  // pad the short-term curve at the start so index i ~ time i*0.1 s (window ending there)
  const padS = new Array(Math.min(29, nSub)).fill(-Infinity);
  const padM = new Array(Math.min(3, nSub)).fill(-Infinity);
  return {
    integrated,
    momentaryMax: Math.max(-Infinity, ...momentary.filter(isFinite)),
    shortTermMax: Math.max(-Infinity, ...shortTerm.filter(isFinite)),
    shortTerm: [...padS, ...shortTerm],
    momentary: [...padM, ...momentary],
    lra,
  };
}

// ------------------------------------------------------------------ peaks / levels
function sincTable(phases: number, taps: number): Float64Array[] {
  const out: Float64Array[] = [];
  for (let p = 1; p < phases; p++) {
    const frac = p / phases;
    const h = new Float64Array(taps);
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const x = k - taps / 2 + 1 - frac;
      const s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (taps / 2));
      h[k] = s * w;
      sum += h[k];
    }
    for (let k = 0; k < taps; k++) h[k] /= sum;
    out.push(h);
  }
  return out;
}

export interface LevelStats {
  peakDb: number;
  truePeakDb: number;
  rmsDb: number;
  crestDb: number;
  dcOffset: [number, number];
  clipped: number;
  nearClip: number;
  stereoCorrelation: number;
  /** longest run below -60 dBFS (50 ms windows) between the first and last non-silent window */
  longestSilenceSec: number;
  longestSilenceAt: number;
  leadingSilenceSec: number;
  trailingSilenceSec: number;
}

export function levels(L: Float32Array, R: Float32Array, sr: number, a = 0, b = L.length): LevelStats {
  let peak = 0, sq = 0, dl = 0, dr = 0, clipped = 0, near = 0, lr = 0, ll = 0, rr = 0;
  for (let i = a; i < b; i++) {
    const l = L[i], r = R[i];
    const al = Math.abs(l), ar = Math.abs(r);
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
    if (al >= 1 || ar >= 1) clipped++;
    else if (al >= 0.99 || ar >= 0.99) near++;
    sq += l * l + r * r;
    dl += l;
    dr += r;
    lr += l * r;
    ll += l * l;
    rr += r * r;
  }
  const n = Math.max(1, b - a);
  const rms = Math.sqrt(sq / (2 * n));
  // true peak (4x oversampling) around the loudest samples only
  let tp = peak;
  const phases = sincTable(4, 32);
  const thr = peak * 0.6;
  for (const X of [L, R]) {
    for (let i = a + 16; i < b - 17; i++) {
      if (Math.abs(X[i]) < thr && Math.abs(X[i + 1]) < thr) continue;
      for (const h of phases) {
        let s = 0;
        for (let k = 0; k < 32; k++) s += X[i - 15 + k] * h[k];
        const as = Math.abs(s);
        if (as > tp) tp = as;
      }
    }
  }
  // silence
  const w = Math.round(sr * 0.05);
  const nw = Math.floor(n / w);
  const quiet: boolean[] = [];
  for (let j = 0; j < nw; j++) {
    let s = 0;
    for (let i = a + j * w, e = i + w; i < e; i++) s += Math.max(L[i] * L[i], R[i] * R[i]);
    quiet.push(Math.sqrt(s / w) < 0.001);
  }
  const first = quiet.indexOf(false), last = quiet.lastIndexOf(false);
  let best = 0, bestAt = 0, run = 0;
  for (let j = Math.max(0, first); j <= last; j++) {
    if (quiet[j]) {
      run++;
      if (run > best) (best = run), (bestAt = j - run + 1);
    } else run = 0;
  }
  return {
    peakDb: round(db(peak)),
    truePeakDb: round(db(tp)),
    rmsDb: round(db(rms)),
    crestDb: round(db(peak) - db(rms)),
    dcOffset: [round(dl / n, 6), round(dr / n, 6)],
    clipped,
    nearClip: near,
    stereoCorrelation: round(lr / Math.sqrt(Math.max(1e-20, ll * rr)), 3),
    longestSilenceSec: round(best * 0.05),
    longestSilenceAt: round(bestAt * 0.05),
    leadingSilenceSec: round(Math.max(0, first) * 0.05),
    trailingSilenceSec: round(first < 0 ? n / sr : (nw - 1 - last) * 0.05),
  };
}

// ------------------------------------------------------------------ spectrum
export interface SpectrumStats {
  centroidHz: number;
  bands: { low: number; mid: number; high: number };
  /** spectrogram: cols x rows dB values (row 0 = lowest freq), for drawing */
  spec: Float32Array;
  cols: number;
  rows: number;
  fMin: number;
  fMax: number;
}

export function spectrum(L: Float32Array, R: Float32Array, sr: number, a: number, b: number, cols: number, rows: number, fMin = 20, fMax = 16000): SpectrumStats {
  const N = 4096;
  const fft = new FFT(N);
  const win = hann(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const spec = new Float32Array(cols * rows);
  const bin = sr / N;
  // row -> bin range
  const rowLo: number[] = [], rowHi: number[] = [];
  for (let y = 0; y < rows; y++) {
    const f0 = fMin * Math.pow(fMax / fMin, y / rows), f1 = fMin * Math.pow(fMax / fMin, (y + 1) / rows);
    rowLo.push(f0 / bin);
    rowHi.push(f1 / bin);
  }
  let eTot = 0, eF = 0, eLow = 0, eMid = 0, eHigh = 0;
  const norm = N / 4;
  const len = b - a;
  for (let c = 0; c < cols; c++) {
    const centre = a + Math.floor(((c + 0.5) * len) / cols);
    for (let i = 0; i < N; i++) {
      const k = centre - N / 2 + i;
      const v = k >= a && k < b ? (L[k] + R[k]) * 0.5 : 0;
      re[i] = v * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    const pw = new Float64Array(N / 2);
    for (let k = 1; k < N / 2; k++) {
      pw[k] = (re[k] * re[k] + im[k] * im[k]) / (norm * norm);
      const f = k * bin;
      if (f >= 20) {
        eTot += pw[k];
        eF += pw[k] * f;
        if (f < 250) eLow += pw[k];
        else if (f < 4000) eMid += pw[k];
        else eHigh += pw[k];
      }
    }
    for (let y = 0; y < rows; y++) {
      const lo = rowLo[y], hi = rowHi[y];
      let v: number;
      if (hi - lo < 1) {
        // interpolate between bins
        const x = (lo + hi) / 2, k = Math.floor(x), f = x - k;
        v = (pw[k] ?? 0) * (1 - f) + (pw[k + 1] ?? 0) * f;
      } else {
        v = 0;
        for (let k = Math.floor(lo); k <= Math.min(N / 2 - 1, Math.ceil(hi)); k++) v = Math.max(v, pw[k]);
      }
      spec[c * rows + y] = v > 0 ? 10 * Math.log10(v) : -140;
    }
  }
  return {
    centroidHz: Math.round(eTot > 0 ? eF / eTot : 0),
    bands: { low: round(eLow / Math.max(1e-20, eTot), 3), mid: round(eMid / Math.max(1e-20, eTot), 3), high: round(eHigh / Math.max(1e-20, eTot), 3) },
    spec,
    cols,
    rows,
    fMin,
    fMax,
  };
}

/** spectral-flux onsets: returns onset times (s, relative to a) */
export function onsets(L: Float32Array, R: Float32Array, sr: number, a: number, b: number): number[] {
  const N = 1024, hop = 512;
  const fft = new FFT(N);
  const win = hann(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  let prev = new Float64Array(N / 2);
  const flux: number[] = [];
  for (let s = a; s + N <= b; s += hop) {
    for (let i = 0; i < N; i++) {
      re[i] = (L[s + i] + R[s + i]) * 0.5 * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    const cur = new Float64Array(N / 2);
    let f = 0;
    for (let k = 2; k < N / 2; k++) {
      cur[k] = Math.log1p(1000 * Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N);
      const d = cur[k] - prev[k];
      if (d > 0) f += d;
    }
    flux.push(f);
    prev = cur;
  }
  const mean = flux.reduce((x, y) => x + y, 0) / Math.max(1, flux.length);
  const out: number[] = [];
  let last = -1e9;
  for (let i = 3; i < flux.length - 3; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - 10); j <= Math.min(flux.length - 1, i + 10); j++) (s += flux[j]), n++;
    const thr = (s / n) * 1.25 + mean * 0.15;
    if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] >= flux[i - 2] && flux[i] >= flux[i + 2]) {
      const t = (i * hop + N / 2) / sr;
      if (t - last > 0.04) {
        out.push(t);
        last = t;
      }
    }
  }
  return out;
}

export { round, db };
