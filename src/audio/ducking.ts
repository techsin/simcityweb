/** Music / ambience duck envelopes, shared by the live engine and offline audio lab. */
const ATTACK = 0.06;
const RELEASE = 0.6;
const SOUND_GAP = 2;

class DuckEnvelope {
  private at = -Infinity;
  private from = 1;
  private target = 1;
  private attackUntil = -Infinity;
  private heldUntil = -Infinity;
  private releasedAt = -Infinity;

  constructor(private params: AudioParam[]) {}

  valueAt(t: number, before = false): number {
    if (t < this.attackUntil) return this.from + (this.target - this.from) * (t - this.at) / (this.attackUntil - this.at);
    if (t === this.releasedAt && t === this.heldUntil) return before ? this.target : 1;
    if (t <= this.heldUntil) return this.target;
    if (t >= this.releasedAt) return 1;
    return this.target + (1 - this.target) * (t - this.heldUntil) / (this.releasedAt - this.heldUntil);
  }

  timesAfter(now: number): number[] {
    return [this.attackUntil, this.heldUntil, this.releasedAt].filter((t) => t > now);
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
    this.attackUntil = now + ATTACK;
    this.heldUntil = heldUntil;
    this.releasedAt = releasedAt;
  }

  release(release: number, now: number): void {
    if (!Number.isFinite(release) || release < 0) return;
    this.from = this.target = release === 0 ? 1 : this.valueAt(now);
    this.at = this.attackUntil = this.heldUntil = now;
    this.releasedAt = now + release;
  }
}

export class AudioDucking {
  readonly music: GainNode;
  readonly reverb: GainNode;
  readonly ambience: GainNode;
  private musicEnvelope: DuckEnvelope;
  private liveEnvelope: DuckEnvelope;
  private ambienceEnvelope: DuckEnvelope;
  private lastSound = -Infinity;

  constructor(private ctx: BaseAudioContext) {
    this.music = ctx.createGain();
    this.reverb = ctx.createGain();
    this.ambience = ctx.createGain();
    this.musicEnvelope = new DuckEnvelope([]);
    this.liveEnvelope = new DuckEnvelope([]);
    this.ambienceEnvelope = new DuckEnvelope([this.ambience.gain]);
  }

  /** Positive dB reduction; hold / release in seconds, hold starts after the 60 ms attack. */
  duck(db: number, hold: number, release = RELEASE, opts?: { renew?: boolean }): void {
    const envelope = opts?.renew ? this.liveEnvelope : this.musicEnvelope;
    envelope.duck(db, hold, release, this.ctx.currentTime);
    this.syncMusic();
  }

  /** Release only the renewable LIVE duck; longer event ducks retain their own deadlines. */
  releaseDuck(release = 0.5): void {
    this.liveEnvelope.release(release, this.ctx.currentTime);
    this.syncMusic();
  }

  private syncMusic(): void {
    const now = this.ctx.currentTime;
    const a = this.musicEnvelope, b = this.liveEnvelope;
    const times = [...new Set([now, ...a.timesAfter(now), ...b.timesAfter(now)])].sort((x, y) => x - y);
    for (const p of [this.music.gain, this.reverb.gain]) {
      p.cancelAndHoldAtTime(now);
      p.setValueAtTime(Math.min(a.valueAt(now), b.valueAt(now)), now);
      for (let i = 1; i < times.length; i++) {
        const start = times[i - 1], end = times[i];
        const diff = a.valueAt(start) - b.valueAt(start);
        const nextDiff = a.valueAt(end, true) - b.valueAt(end, true);
        // The quieter envelope can change halfway through two overlapping ramps.
        if (diff * nextDiff < 0) {
          const cross = start + (end - start) * diff / (diff - nextDiff);
          p.linearRampToValueAtTime(a.valueAt(cross), cross);
        }
        const before = Math.min(a.valueAt(end, true), b.valueAt(end, true));
        const after = Math.min(a.valueAt(end), b.valueAt(end));
        p.linearRampToValueAtTime(before, end);
        if (after !== before) p.setValueAtTime(after, end);
      }
    }
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
