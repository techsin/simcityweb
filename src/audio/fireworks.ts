/**
 * Fireworks audio — fully procedural (no assets, no three.js):
 *   launch  mortar thump + rising swoosh (or a whistle)
 *   burst   low boom + noisy crack, distant-thunder rumble for big shells, optional crackle tail
 *   crackle / glitter   pre-rendered pop / fizz textures played at random offsets
 *   salute  hard bang;   tick  soft countdown blip
 *
 *   const fa = new FireworksAudio(() => audio.getSfxOutput());     // null while muted / before init -> silent
 *   fa.warm();   // optional, from idle time: pre-render the textures + reverb impulse (else done on first use)
 *   spatialize(listener, x, y, z, sp);  fa.burst(sp, size01, crackle01);
 *
 * Every sound is spatialized from the source's camera-relative position: stereo pan, distance gain, a
 * speed-of-sound delay (340 m/s, capped) and a lowpass that darkens far bursts. Voices are capped and everything —
 * dry sound and the fireworks' own hall reverb — runs through one bus and a limiter into the engine's SFX bus, so
 * the SFX volume / mute apply to all of it and the finale never clips. (The engine's shared reverb send is not
 * used: it feeds the master directly and would bypass the SFX volume.)
 */

export interface FireworksAudioOut {
  /** a live AudioContext (sounds only while it is running) or an OfflineAudioContext (tests / level checks) */
  ctx: BaseAudioContext;
  /** destination (the engine's SFX bus) */
  dest: AudioNode;
  /** the engine's shared reverb send (ignored: the fireworks carry their own reverb inside the SFX path) */
  wet?: AudioNode | null;
  /** optional 1..2 s white-noise buffer */
  noise?: AudioBuffer | null;
}

/** camera position + unit right vector (world space) */
export interface FireworksListener {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

export interface FireworksSpatial {
  pan: number;
  /** 0..1 distance attenuation */
  gain: number;
  /** seconds (sound travel time, capped) */
  delay: number;
  /** lowpass cutoff Hz */
  lowpass: number;
  distance: number;
}

const MAX_VOICES = 22;
const MAX_DELAY = 1.6;
const SPEED_OF_SOUND = 340;
/** asymptotic distance delay (s); stays below MAX_DELAY */
const DELAY_CAP = 1.4;

export function spatialize(l: FireworksListener, x: number, y: number, z: number, out?: FireworksSpatial): FireworksSpatial {
  const o = out ?? { pan: 0, gain: 1, delay: 0, lowpass: 16000, distance: 0 };
  const dx = x - l.x, dy = y - l.y, dz = z - l.z;
  const d = Math.hypot(dx, dy, dz);
  o.distance = d;
  const side = (dx * l.rx + dy * l.ry + dz * l.rz) / Math.max(d, 1);
  o.pan = Math.max(-0.9, Math.min(0.9, side * 1.15));
  o.gain = 1 / (1 + Math.pow(d / 480, 1.3));
  // speed of sound up close, smoothly capped far away (all bursts would otherwise share the same capped lag)
  o.delay = DELAY_CAP * (1 - Math.exp(-d / (SPEED_OF_SOUND * DELAY_CAP)));
  o.lowpass = Math.max(650, Math.min(16000, 16000 * Math.exp(-d / 1300)));
  return o;
}

export class FireworksAudio {
  /** extra gain for all fireworks sounds (0..1.5) */
  volume = 1;
  private getOut: () => FireworksAudioOut | null;
  private ctx: BaseAudioContext | null = null;
  private dest: AudioNode | null = null;
  private bus: GainNode | null = null;
  /** reverb send input: -> convolver -> bus (so the wet signal follows the SFX volume like the dry one) */
  private wet: AudioNode | null = null;
  private wetNodes: AudioNode[] = [];
  private noise: AudioBuffer | null = null;
  private crackleBuf: AudioBuffer | null = null;
  private glitterBuf: AudioBuffer | null = null;
  private irBuf: AudioBuffer | null = null;
  private voiceEnds: number[] = [];

  constructor(getOut: () => FireworksAudioOut | null) {
    this.getOut = getOut;
  }

  // ------------------------------------------------------------------------------------------------ public
  launch(sp: FireworksSpatial, whistle: boolean, flight = 2.5, glitter = false): void {
    const c = this.begin(0, 2.4);
    if (!c) return;
    const t = c.currentTime + sp.delay + 0.01;
    const g0 = sp.gain * 0.55;
    // mortar thump
    const out = this.chain(sp, t, 2.6);
    const thump = c.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(150, t);
    thump.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const tg = c.createGain();
    env(tg.gain, t, 0.003, 0.18, g0 * 0.9);
    thump.connect(tg).connect(out);
    thump.start(t);
    thump.stop(t + 0.3);
    const dur = Math.min(flight, 2.2);
    if (whistle) {
      const o = c.createOscillator();
      o.type = 'sine';
      const f0 = 1500 + Math.random() * 500;
      o.frequency.setValueAtTime(f0, t + 0.05);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.8 + Math.random() * 0.5), t + dur);
      const lfo = c.createOscillator();
      lfo.frequency.value = 14 + Math.random() * 8;
      const lg = c.createGain();
      lg.gain.value = f0 * 0.015;
      lfo.connect(lg).connect(o.frequency);
      const wg = c.createGain();
      wg.gain.setValueAtTime(0, t);
      wg.gain.linearRampToValueAtTime(g0 * 0.16, t + 0.12);
      wg.gain.setValueAtTime(g0 * 0.16, t + dur - 0.2);
      wg.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(wg).connect(out);
      o.start(t + 0.05);
      o.stop(t + dur + 0.05);
      lfo.start(t + 0.05);
      lfo.stop(t + dur + 0.05);
    }
    // swoosh: band-passed noise sweeping up, fading as the shell climbs
    const n = this.noiseSrc(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(450, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.7);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(g0 * (whistle ? 0.18 : 0.42), t + 0.07);
    ng.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    n.connect(bp).connect(ng).connect(out);
    n.start(t, Math.random());
    n.stop(t + dur + 0.1);
    // glitter tail: faint fizz while it rises
    if (glitter && this.glitterBuf) {
      const s = c.createBufferSource();
      s.buffer = this.glitterBuf;
      const gg = c.createGain();
      gg.gain.setValueAtTime(0, t);
      gg.gain.linearRampToValueAtTime(g0 * 0.12, t + 0.2);
      gg.gain.linearRampToValueAtTime(0, t + dur);
      s.connect(gg).connect(out);
      s.start(t, Math.random() * 0.8, dur + 0.1);
    }
  }

  /** size01: shell calibre (0 small .. 1 huge); crackle01 > 0 adds a crackling tail */
  burst(sp: FireworksSpatial, size01: number, crackle01 = 0): void {
    const c = this.begin(2, 3.5);
    if (!c) return;
    const t = c.currentTime + sp.delay + 0.01;
    const big = Math.max(0, Math.min(1, size01));
    const g0 = sp.gain * (0.6 + 0.5 * big);
    const out = this.chain(sp, t, 4 + big * 2, 0.25 + 0.35 * big);
    // boom: pitched-down sine
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90 + 30 * Math.random(), t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.5 + big * 0.4);
    const og = c.createGain();
    env(og.gain, t, 0.004, 0.7 + 1.1 * big, g0 * 0.95);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 2.2 + big);
    // crack: short bright noise burst
    const n = this.noiseSrc(c);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400 + 1800 * Math.random();
    const ng = c.createGain();
    env(ng.gain, t, 0.002, 0.22 + 0.2 * big, g0 * 0.8);
    n.connect(lp).connect(ng).connect(out);
    n.start(t, Math.random());
    n.stop(t + 0.8);
    // rolling thunder for big (and far) shells
    if (big > 0.35 || sp.distance > 900) {
      const r = this.noiseSrc(c);
      const rl = c.createBiquadFilter();
      rl.type = 'lowpass';
      rl.frequency.value = 180 + 120 * Math.random();
      rl.Q.value = 0.7;
      const rg = c.createGain();
      rg.gain.setValueAtTime(0, t);
      rg.gain.linearRampToValueAtTime(g0 * 0.9 * (0.4 + big), t + 0.12);
      rg.gain.exponentialRampToValueAtTime(0.0008, t + 1.8 + 1.6 * big);
      r.connect(rl).connect(rg).connect(out);
      r.start(t, Math.random());
      r.stop(t + 3.6 + big * 1.6);
    }
    if (crackle01 > 0) this.crackle(sp, 0.8 + crackle01 * 1.4, 0.35 + 0.1 * big, 0.35);
  }

  /** pops for `seconds`, starting `offset` s after the (delayed) event */
  crackle(sp: FireworksSpatial, seconds: number, level = 0.5, offset = 0): void {
    this.texture(this.crackleBuf, sp, seconds, level, offset, 1800);
  }

  /** fizzy glitter (strobe stars) */
  glitter(sp: FireworksSpatial, seconds: number, level = 0.35): void {
    this.texture(this.glitterBuf, sp, seconds, level, 0, 3500);
  }

  salute(sp: FireworksSpatial): void {
    const c = this.begin(2, 3);
    if (!c) return;
    const t = c.currentTime + sp.delay + 0.01;
    const g0 = sp.gain * 1.2;
    const out = this.chain(sp, t, 3.5, 0.5);
    const n = this.noiseSrc(c);
    const bp = c.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 3200;
    const ng = c.createGain();
    env(ng.gain, t, 0.001, 0.16, g0);
    n.connect(bp).connect(ng).connect(out);
    n.start(t, Math.random());
    n.stop(t + 0.5);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
    const og = c.createGain();
    env(og.gain, t, 0.002, 1.1, g0 * 0.9);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 1.8);
  }

  /** countdown blip (not spatialized) */
  tick(final = false): void {
    const c = this.begin(1, 1);
    if (!c || !this.bus) return;
    const t = c.currentTime + 0.01;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = final ? 1568 : 1046.5;
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = (final ? 1568 : 1046.5) * 2.01;
    const g = c.createGain();
    env(g.gain, t, 0.004, final ? 0.9 : 0.35, 0.16);
    const g2 = c.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.bus);
    o.start(t);
    o2.start(t);
    o.stop(t + 1.2);
    o2.stop(t + 1.2);
    if (this.wet) {
      const s = c.createGain();
      s.gain.value = 0.3;
      g.connect(s).connect(this.wet);
      setTimeout(() => s.disconnect(), 2500);
    }
    setTimeout(() => g.disconnect(), 2500);
  }

  /**
   * Pre-render the crackle / glitter textures and the reverb impulse (a few ms of CPU): call from idle time before
   * the first sound. Uses the engine's context when there is one, else context-free AudioBuffers. Safe to repeat.
   */
  warm(): void {
    if (this.crackleBuf && this.glitterBuf && this.irBuf) return;
    let out: FireworksAudioOut | null = null;
    try {
      out = this.getOut();
    } catch {
      out = null;
    }
    const rate = out?.ctx.sampleRate ?? 48000;
    let mk: BufferMaker | null = null;
    if (out) {
      const c = out.ctx;
      mk = (ch, len, sr) => c.createBuffer(ch, len, sr);
    } else if (typeof AudioBuffer === 'function') {
      mk = (ch, len, sr) => new AudioBuffer({ numberOfChannels: ch, length: len, sampleRate: sr });
    }
    if (!mk) return;
    try {
      this.crackleBuf ??= makePops(mk, rate, 3, 70, 0.012, 0.25);
      this.glitterBuf ??= makePops(mk, rate, 3, 260, 0.004, 0.6);
      this.irBuf ??= makeImpulse(mk, rate, 2.4, 3.4);
    } catch {
      /* no WebAudio buffers here: build() makes them on first use */
    }
  }

  /** drop the output graph (e.g. when leaving the city) */
  dispose(): void {
    try {
      this.bus?.disconnect();
      for (const n of this.wetNodes) n.disconnect();
    } catch {
      /* ignore */
    }
    this.wetNodes.length = 0;
    this.wet = null;
    this.bus = null;
    this.ctx = null;
    this.dest = null;
    this.voiceEnds.length = 0;
  }

  // ------------------------------------------------------------------------------------------------ internals
  /** make sure the graph exists; enforce the voice cap (priority 0 launch/crackle .. 2 bursts) */
  private begin(prio: number, dur: number): BaseAudioContext | null {
    let out: FireworksAudioOut | null = null;
    try {
      out = this.getOut();
    } catch {
      out = null;
    }
    // a suspended live context would pile the show up and play it all at once on resume: stay silent instead
    const offline = typeof OfflineAudioContext !== 'undefined' && out?.ctx instanceof OfflineAudioContext;
    if (!out || (out.ctx.state !== 'running' && !offline) || this.volume <= 0) return null;
    const c = out.ctx;
    if (c !== this.ctx || out.dest !== this.dest || !this.bus) this.build(out);
    const now = c.currentTime;
    const v = this.voiceEnds;
    let n = 0;
    for (let i = v.length - 1; i >= 0; i--) {
      if (v[i] < now) v.splice(i, 1);
      else n++;
    }
    const limit = prio >= 2 ? MAX_VOICES + 6 : prio === 1 ? MAX_VOICES + 2 : MAX_VOICES;
    if (n >= limit) return null;
    v.push(now + dur + MAX_DELAY);
    this.bus!.gain.value = this.volume * 0.9;
    return c;
  }

  private build(out: FireworksAudioOut): void {
    try {
      this.bus?.disconnect();
      for (const n of this.wetNodes) n.disconnect();
    } catch {
      /* ignore */
    }
    this.wetNodes.length = 0;
    const c = out.ctx;
    this.ctx = c;
    this.dest = out.dest;
    const bus = c.createGain();
    bus.gain.value = this.volume * 0.9;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -16;
    lim.knee.value = 8;
    lim.ratio.value = 8;
    lim.attack.value = 0.002;
    lim.release.value = 0.35;
    bus.connect(lim).connect(out.dest);
    this.bus = bus;
    this.noise = out.noise ?? makeNoise(c, 2);
    this.warm();
    const mk: BufferMaker = (ch, len, sr) => c.createBuffer(ch, len, sr);
    this.crackleBuf ??= makePops(mk, c.sampleRate, 3, 70, 0.012, 0.25);
    this.glitterBuf ??= makePops(mk, c.sampleRate, 3, 260, 0.004, 0.6);
    this.irBuf ??= makeImpulse(mk, c.sampleRate, 2.4, 3.4);
    // the fireworks' own hall: send -> convolver -> bus (-> limiter -> SFX bus), never straight to the master
    const wetIn = c.createGain();
    const conv = c.createConvolver();
    conv.buffer = this.irBuf;
    const wetOut = c.createGain();
    wetOut.gain.value = 0.7;
    wetIn.connect(conv).connect(wetOut).connect(bus);
    this.wet = wetIn;
    this.wetNodes.push(wetIn, conv, wetOut);
    this.voiceEnds.length = 0;
  }

  /** per-voice output: env -> distance lowpass -> panner -> bus (+ reverb send); auto-disconnects */
  private chain(sp: FireworksSpatial, t: number, life: number, wetAmt = 0.15): AudioNode {
    const c = this.ctx!;
    const input = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = sp.lowpass;
    lp.Q.value = 0.5;
    const pan = c.createStereoPanner();
    pan.pan.value = sp.pan;
    input.connect(lp).connect(pan).connect(this.bus!);
    let send: GainNode | null = null;
    if (this.wet && wetAmt > 0) {
      send = c.createGain();
      // far sounds are mostly reverberant
      send.gain.value = wetAmt * (0.5 + Math.min(1, sp.distance / 1500));
      pan.connect(send).connect(this.wet);
    }
    const ms = (t - c.currentTime + life) * 1000 + 200;
    setTimeout(() => {
      try {
        input.disconnect();
        lp.disconnect();
        pan.disconnect();
        send?.disconnect();
      } catch {
        /* ignore */
      }
    }, ms);
    return input;
  }

  private noiseSrc(c: BaseAudioContext): AudioBufferSourceNode {
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  private texture(buf: AudioBuffer | null, sp: FireworksSpatial, seconds: number, level: number, offset: number, hp: number): void {
    const c = this.begin(0, seconds + offset);
    if (!c || !buf) return;
    const t = c.currentTime + sp.delay + offset + 0.01;
    const dur = Math.min(seconds, buf.duration - 0.1);
    const out = this.chain(sp, t, dur + 0.5, 0.2);
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = 0.85 + Math.random() * 0.35;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = c.createGain();
    const g0 = sp.gain * level;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(g0, t + 0.06);
    g.gain.setValueAtTime(g0, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * Math.max(0, buf.duration - dur - 0.05), dur + 0.05);
  }
}

/** attack / exponential decay envelope */
function env(p: AudioParam, t: number, attack: number, decay: number, peak: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(Math.max(peak, 0.0001), t + attack);
  p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function makeNoise(c: BaseAudioContext, seconds: number): AudioBuffer {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** a texture of random decaying noise pops (crackle: sparse & chunky; glitter: dense & tiny) */
type BufferMaker = (channels: number, length: number, sampleRate: number) => AudioBuffer;

/** stereo hall impulse: decorrelated noise with an exponential decay (RT60 ~ `seconds`), soft attack */
function makeImpulse(mk: BufferMaker, sr: number, seconds: number, decay: number): AudioBuffer {
  const n = Math.floor(sr * seconds);
  const b = mk(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * decay) * Math.min(1, t / 0.012);
    }
  }
  return b;
}

function makePops(mk: BufferMaker, sr: number, seconds: number, perSecond: number, maxLen: number, minAmp: number): AudioBuffer {
  const n = Math.floor(sr * seconds);
  const b = mk(1, n, sr);
  const d = b.getChannelData(0);
  const pops = Math.floor(seconds * perSecond);
  for (let p = 0; p < pops; p++) {
    const at = Math.floor(Math.random() * n);
    const len = Math.max(8, Math.floor(sr * (0.0015 + Math.random() * maxLen)));
    const amp = minAmp + Math.random() * (1 - minAmp);
    const tau = len * 0.22;
    for (let i = 0; i < len && at + i < n; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / tau);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  const k = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < n; i++) d[i] *= k;
  return b;
}
