/** Music / ambience duck envelopes, shared by the live engine and offline audio lab. */
const ATTACK = 0.06;
const RELEASE = 0.6;
const SOUND_GAP = 2;

class DuckEnvelope {
  private at = -Infinity;
  private from = 1;
  private target = 1;
  private heldUntil = -Infinity;
  private releasedAt = -Infinity;

  constructor(private params: AudioParam[]) {}

  private valueAt(t: number): number {
    if (t < this.at + ATTACK) return this.from + (this.target - this.from) * (t - this.at) / ATTACK;
    if (t <= this.heldUntil) return this.target;
    if (t >= this.releasedAt) return 1;
    return this.target + (1 - this.target) * (t - this.heldUntil) / (this.releasedAt - this.heldUntil);
  }

  duck(db: number, hold: number, release: number, now: number): void {
    if (![db, hold, release].every(Number.isFinite) || db <= 0 || hold < 0 || release < 0) return;
    const from = this.valueAt(now);
    // A weaker overlapping sound must not lift a long duck (e.g. the New Year countdown).
    const target = Math.min(10 ** (-db / 20), now < this.heldUntil ? this.target : from);
    const heldUntil = Math.max(this.heldUntil, now + ATTACK + hold);
    const releasedAt = Math.max(this.releasedAt, heldUntil + release);
    for (const p of this.params) {
      p.cancelAndHoldAtTime(now);
      p.setValueAtTime(from, now);
      p.linearRampToValueAtTime(target, now + ATTACK);
      p.setValueAtTime(target, heldUntil);
      p.linearRampToValueAtTime(1, releasedAt);
    }
    this.at = now;
    this.from = from;
    this.target = target;
    this.heldUntil = heldUntil;
    this.releasedAt = releasedAt;
  }
}

export class AudioDucking {
  readonly music: GainNode;
  readonly reverb: GainNode;
  readonly ambience: GainNode;
  private musicEnvelope: DuckEnvelope;
  private ambienceEnvelope: DuckEnvelope;
  private lastSound = -Infinity;

  constructor(private ctx: BaseAudioContext) {
    this.music = ctx.createGain();
    this.reverb = ctx.createGain();
    this.ambience = ctx.createGain();
    this.musicEnvelope = new DuckEnvelope([this.music.gain, this.reverb.gain]);
    this.ambienceEnvelope = new DuckEnvelope([this.ambience.gain]);
  }

  /** Positive dB reduction; hold / release in seconds, hold starts after the 60 ms attack. */
  duck(db: number, hold: number, release = RELEASE): void {
    this.musicEnvelope.duck(db, hold, release, this.ctx.currentTime);
  }

  /** Audible one-shots lasting at least 0.6 s: music -6 dB, ambience -3 dB, at most once per 2 s. */
  sound(duration: number): void {
    const now = this.ctx.currentTime;
    if (!Number.isFinite(duration) || duration < 0.6 || now - this.lastSound < SOUND_GAP) return;
    this.lastSound = now;
    this.duck(6, duration);
    this.ambienceEnvelope.duck(3, duration, RELEASE, now);
  }
}
