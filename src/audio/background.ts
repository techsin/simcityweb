/** Fade on the audio clock, then suspend once. No timer polling in a hidden tab. */
export class BackgroundMute {
  private enabled = true;
  private hidden = false;
  private quiet = false;
  private volume = 1;
  private completion: ConstantSourceNode | null = null;
  private suspension: Promise<void> | null = null;

  constructor(private ctx: AudioContext, private gain: AudioParam) {
    ctx.addEventListener('statechange', () => {
      if (this.quiet && ctx.state === 'running' && !this.completion && !this.suspension) this.suspend();
    });
  }

  get muted(): boolean { return this.quiet; }

  setVolume(volume: number, immediate = false): void {
    this.volume = volume;
    if (this.quiet) return;
    const t = this.ctx.currentTime;
    this.gain.cancelAndHoldAtTime(t);
    if (immediate) this.gain.setValueAtTime(volume, t);
    else this.gain.setTargetAtTime(volume, t, 0.05);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.update();
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.update();
  }

  private clearCompletion(): void {
    const source = this.completion;
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* context closed */ }
    source.disconnect();
    this.completion = null;
  }

  private suspend(): void {
    this.suspension = this.ctx.suspend().catch(() => {}).then(() => {
      this.suspension = null;
      // Visibility can change while suspend() is still resolving.
      if (!this.quiet) void this.ctx.resume().catch(() => {});
    });
  }

  private update(): void {
    const quiet = this.enabled && this.hidden;
    if (quiet === this.quiet || this.ctx.state === 'closed') return;
    this.quiet = quiet;
    this.clearCompletion();
    const t = this.ctx.currentTime;
    this.gain.cancelAndHoldAtTime(t);
    // Anchor the ramp: after a set or a finished ramp, cancelAndHold adds no event, and the ramp would run from that
    // older event (a step at once, or a cut to 0 after a setTarget) instead of fading from here.
    this.gain.setValueAtTime(this.gain.value, t);
    this.gain.linearRampToValueAtTime(quiet ? 0 : this.volume, t + 0.5);
    if (quiet) {
      if (this.ctx.state === 'suspended') {
        this.gain.cancelScheduledValues(t);
        this.gain.setValueAtTime(0, t);
        return;
      }
      const source = this.completion = this.ctx.createConstantSource();
      source.offset.value = 0;
      source.connect(this.ctx.destination);
      source.onended = () => {
        this.clearCompletion();
        if (!this.quiet) return;
        this.suspend();
      };
      source.start(t);
      source.stop(t + 0.5);
    } else if (!this.suspension) void this.ctx.resume().catch(() => {});
  }
}
