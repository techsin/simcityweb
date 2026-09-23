/**
 * Generative ambient "chill jazz-lite" music (SC4-like): warm pads on extended chords, a soft electric-piano
 * arpeggio with swing and a ping-pong delay, round bass, occasional brushed hats. Fully procedural and endless:
 * progressions are picked from a pool, transposed every few phrases, arpeggio patterns are re-rolled per bar.
 */

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Chord {
  root: number; // midi of the bass root
  tones: number[]; // chord tones relative to root (voicing)
  scale: number[]; // melodic scale degrees relative to root for the arpeggio / fills
}

// voicings relative to the root (semitones)
const MAJ9 = [0, 4, 7, 11, 14];
const MIN9 = [0, 3, 7, 10, 14];
const DOM13 = [0, 4, 10, 14, 21];
const SUS = [0, 5, 7, 10, 14];
const MIN11 = [0, 3, 7, 10, 17];
const MAJ69 = [0, 4, 9, 14, 19];
const IONIAN = [0, 2, 4, 7, 9, 11, 12, 14, 16, 19];
const DORIAN = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15];
const MIXO = [0, 2, 4, 7, 9, 10, 12, 14, 16];

const c = (root: number, tones: number[], scale: number[]): Chord => ({ root, tones, scale });

/** progressions in C (bass roots around C2..B2) */
const PROGRESSIONS: Chord[][] = [
  [c(41, MAJ9, IONIAN), c(40, MIN9, DORIAN), c(38, MIN9, DORIAN), c(43, SUS, MIXO)], // Fmaj9 Em9 Dm9 G9sus
  [c(36, MAJ9, IONIAN), c(45, MIN9, DORIAN), c(38, MIN11, DORIAN), c(43, DOM13, MIXO)], // Cmaj9 Am9 Dm11 G13
  [c(41, MAJ69, IONIAN), c(43, SUS, MIXO), c(40, MIN9, DORIAN), c(45, MIN11, DORIAN)], // F6/9 Gsus Em9 Am11
  [c(38, MIN9, DORIAN), c(43, DOM13, MIXO), c(36, MAJ9, IONIAN), c(36, MAJ69, IONIAN)], // ii V I I
  [c(45, MIN9, DORIAN), c(41, MAJ9, IONIAN), c(36, MAJ9, IONIAN), c(43, SUS, MIXO)], // Am9 Fmaj9 Cmaj9 Gsus
];
const TRANSPOSE = [0, 5, -2, 3, -4, 2];

export class MusicGenerator {
  private ctx: AudioContext;
  private out: GainNode;
  private wet: AudioNode;
  private delayIn: GainNode;
  private nodes: AudioNode[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private bpm = 76;
  private nextBarTime = 0;
  private bar = 0;
  private prog: Chord[] = PROGRESSIONS[0];
  private transpose = 0;
  private noise: AudioBuffer;
  running = false;

  constructor(ctx: AudioContext, dest: AudioNode, wet: AudioNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.wet = wet;
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    // ping-pong delay for the e-piano
    this.delayIn = ctx.createGain();
    this.delayIn.gain.value = 0.28;
    const dl = ctx.createDelay(2), dr = ctx.createDelay(2);
    const beat = 60 / this.bpm;
    dl.delayTime.value = beat * 0.75;
    dr.delayTime.value = beat * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 2600;
    const merger = ctx.createChannelMerger(2);
    this.delayIn.connect(lpf).connect(dl);
    dl.connect(dr);
    dr.connect(fb).connect(dl);
    dl.connect(merger, 0, 0);
    dr.connect(merger, 0, 1);
    merger.connect(this.out);
    this.nodes.push(dl, dr, fb, lpf, merger);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.9, t + 3);
    this.nextBarTime = t + 0.2;
    this.bar = 0;
    this.pickProgression();
    this.timer = setInterval(() => this.schedule(), 120);
    this.schedule();
  }

  stop(fade = 2): void {
    if (!this.running) return;
    this.running = false;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fade);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop(0.1);
    setTimeout(() => {
      this.nodes.forEach((n) => n.disconnect());
      this.out.disconnect();
    }, 300);
  }

  private pickProgression(): void {
    this.prog = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
    if (Math.random() < 0.5) this.transpose = TRANSPOSE[Math.floor(Math.random() * TRANSPOSE.length)];
  }

  private schedule(): void {
    if (!this.running) return;
    const barLen = (60 / this.bpm) * 4;
    while (this.nextBarTime < this.ctx.currentTime + 0.8) {
      // two bars per chord
      const chord = this.prog[Math.floor(this.bar / 2) % this.prog.length];
      const first = this.bar % 2 === 0;
      this.playBar(chord, this.nextBarTime, barLen, first);
      this.nextBarTime += barLen;
      this.bar++;
      if (this.bar % (this.prog.length * 2 * 2) === 0) this.pickProgression();
    }
  }

  private playBar(ch: Chord, t: number, barLen: number, first: boolean): void {
    const tr = this.transpose;
    const beat = barLen / 4;
    // pad on the chord change (sustains 2 bars)
    if (first) this.pad(ch, tr, t, barLen * 2);
    // bass: root on 1, fifth or root on 3, occasional approach note
    this.bass(ch.root + tr, t, beat * 1.6, 0.34);
    if (Math.random() < 0.75) this.bass(ch.root + tr + (Math.random() < 0.5 ? 7 : 12), t + beat * 2, beat * 1.2, 0.22);
    if (!first && Math.random() < 0.35) this.bass(ch.root + tr - 1, t + beat * 3.5, beat * 0.45, 0.16);
    // e-piano arpeggio: 8th notes with swing, random rests, ascending / wandering pattern
    const swing = 0.58;
    const pool = ch.scale.map((s) => ch.root + tr + 24 + s).filter((m) => m >= 57 && m <= 86);
    const chordPool = ch.tones.map((s) => ch.root + tr + 24 + s).filter((m) => m >= 55 && m <= 88);
    let idx = Math.floor(Math.random() * chordPool.length);
    const density = 0.45 + Math.random() * 0.35;
    for (let k = 0; k < 8; k++) {
      if (Math.random() > density && k > 0) continue;
      const offset = Math.floor(k / 2) * beat + (k % 2 ? beat * swing : 0);
      const useScale = Math.random() < 0.3;
      let note: number;
      if (useScale && pool.length) note = pool[Math.floor(Math.random() * pool.length)];
      else {
        idx = (idx + (Math.random() < 0.7 ? 1 : -1) + chordPool.length) % chordPool.length;
        note = chordPool[idx];
      }
      const vel = 0.07 + Math.random() * 0.05 - (k % 2 ? 0.015 : 0);
      this.epiano(note, t + offset + (Math.random() - 0.5) * 0.012, beat * (1.2 + Math.random()), vel);
    }
    // brushed hats on the off-beats, very soft
    for (let b = 0; b < 4; b++) if (Math.random() < 0.7) this.brush(t + b * beat + beat * swing, 0.018 + Math.random() * 0.012);
  }

  private pad(ch: Chord, tr: number, t: number, dur: number): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(1400, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(800, t + dur);
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    const peak = 0.045;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 1.4);
    g.gain.setValueAtTime(peak, t + dur - 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.2);
    lp.connect(g);
    g.connect(this.out);
    const ws = ctx.createGain();
    ws.gain.value = 0.9;
    g.connect(ws).connect(this.wet);
    for (const s of ch.tones) {
      const m = ch.root + tr + 12 + s;
      for (const [type, det, lvl] of [['triangle', -7, 1], ['sawtooth', 6, 0.35]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = midiHz(m);
        o.detune.value = det + (Math.random() - 0.5) * 4;
        const og = ctx.createGain();
        og.gain.value = lvl / ch.tones.length;
        o.connect(og).connect(lp);
        o.start(t);
        o.stop(t + dur + 1.4);
      }
    }
  }

  private bass(m: number, t: number, dur: number, vel: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiHz(m);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = midiHz(m - 12);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.02);
    g.gain.exponentialRampToValueAtTime(vel * 0.4, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    o.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(this.out);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.3);
    o2.stop(t + dur + 0.3);
  }

  /** Rhodes-like FM electric piano */
  private epiano(m: number, t: number, dur: number, vel: number): void {
    const ctx = this.ctx;
    const f = midiHz(m);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.6, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.35);
    mod.connect(mg).connect(car.frequency);
    // tine: high ratio bell partial
    const tine = ctx.createOscillator();
    tine.frequency.value = f * 7.02;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(vel * 0.15, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (m - 72) / 24;
    car.connect(g);
    tine.connect(tg).connect(g);
    g.connect(pan);
    pan.connect(this.out);
    pan.connect(this.delayIn);
    const ws = ctx.createGain();
    ws.gain.value = 0.5;
    pan.connect(ws).connect(this.wet);
    for (const o of [car, mod, tine]) {
      o.start(t);
      o.stop(t + dur + 0.7);
    }
  }

  private brush(t: number, vel: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(hp).connect(g).connect(this.out);
    src.start(t, Math.random());
    src.stop(t + 0.12);
  }
}
