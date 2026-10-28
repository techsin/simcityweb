export class MockParam {
  /** the intrinsic value, where the automation starts */
  base: number;
  automationRate = 'a-rate';
  events: [string, ...number[]][] = [];
  constructor(value: number, private clock?: () => number) { this.base = value; }
  /** Like a browser: with automation scheduled, reading .value gives the computed value at the context's time. */
  get value(): number { return this.clock && this.events.length ? this.valueAt(this.clock()) : this.base; }
  set value(v: number) { this.base = v; }
  valueAt(t: number): number {
    let value = this.base, at = 0;
    let target: { value: number; tau: number } | null = null;
    const held = (time: number) => target ? target.value + (value - target.value) * Math.exp(-(time - at) / target.tau) : value;
    for (const [kind, v, time, tau] of this.events) {
      if (t < time) {
        const f = (t - at) / (time - at);
        if (kind === 'linear') return value + (v - value) * f;
        if (kind === 'exp') return value * (v / value) ** f;
        return held(t);
      }
      value = kind === 'target' ? held(time) : v;
      target = kind === 'target' ? { value: v, tau } : null;
      at = time;
    }
    return held(t);
  }
  /** Like Chromium: a hold is added only inside a ramp still running at t. After a set, a finished ramp or a
   *  setTarget nothing is added, so a later ramp runs from that older event unless the caller anchors it. */
  cancelAndHoldAtTime(t: number): this {
    const value = this.valueAt(t);
    const next = this.events.find((e) => e[2] > t);
    const ramping = next !== undefined && (next[0] === 'linear' || next[0] === 'exp') && this.events.some((e) => e[2] <= t);
    if (!ramping) {
      // an event at exactly t has already happened
      this.events = this.events.filter((e) => e[2] <= t);
      return this;
    }
    this.cancelScheduledValues(t);
    return this.linearRampToValueAtTime(value, t);
  }
  cancelScheduledValues(t: number): this {
    this.events = this.events.filter((e) => e[2] < t);
    return this;
  }
  setValueAtTime(v: number, t: number): this { this.events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v: number, t: number): this { this.events.push(['linear', v, t]); return this; }
  exponentialRampToValueAtTime(v: number, t: number): this { this.events.push(['exp', v, t]); return this; }
  setTargetAtTime(v: number, t: number, tau: number): this { this.events.push(['target', v, t, tau]); return this; }
}

export class MockNode extends EventTarget {
  connections = new Set<MockNode | MockParam>();
  gain = new MockParam(1, () => this.context.currentTime);
  frequency = new MockParam(350, () => this.context.currentTime);
  detune = new MockParam(0, () => this.context.currentTime);
  Q = new MockParam(1, () => this.context.currentTime);
  pan = new MockParam(0, () => this.context.currentTime);
  playbackRate = new MockParam(1, () => this.context.currentTime);
  offset = new MockParam(1, () => this.context.currentTime);
  delayTime = new MockParam(0, () => this.context.currentTime);
  threshold = new MockParam(-24, () => this.context.currentTime);
  knee = new MockParam(30, () => this.context.currentTime);
  ratio = new MockParam(12, () => this.context.currentTime);
  attack = new MockParam(0.003, () => this.context.currentTime);
  release = new MockParam(0.25, () => this.context.currentTime);
  buffer: AudioBuffer | null = null;
  type = 'sine';
  loop = false;
  starts: number[][] = [];
  stops: number[] = [];
  endedHandlers = 0;
  private ended: EventListener | null = null;
  constructor(readonly context: MockContext, readonly kind: string) {
    super();
    if (kind === 'filter') this.gain.value = 0;
  }
  connect(dest: MockNode | MockParam): MockNode | MockParam { this.connections.add(dest); return dest; }
  disconnect(dest?: MockNode | MockParam): void {
    if (dest) this.connections.delete(dest);
    else this.connections.clear();
  }
  start(...args: number[]): void {
    if (this.starts.length) throw new Error('A source cannot be restarted');
    this.starts.push(args);
  }
  stop(t = this.context.currentTime): void { this.stops.push(t); }
  setPeriodicWave(): void {}
  set onended(handler: EventListener | null) {
    if (this.ended) this.removeEventListener('ended', this.ended);
    this.ended = handler;
    if (handler) this.addEventListener('ended', handler);
  }
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    if (type === 'ended') this.endedHandlers++;
    super.addEventListener(type, callback, options);
  }
}

export class MockContext extends EventTarget {
  currentTime = 0;
  sampleRate = 48000;
  state = 'running';
  nodes: MockNode[] = [];
  destination = new MockNode(this, 'destination');
  get audio(): AudioContext { return this as unknown as AudioContext; }
  make(kind: string): MockNode {
    const node = new MockNode(this, kind);
    this.nodes.push(node);
    return node;
  }
  createGain(): MockNode { return this.make('gain'); }
  createBiquadFilter(): MockNode { return this.make('filter'); }
  createStereoPanner(): MockNode { return this.make('panner'); }
  createChannelMerger(): MockNode { return this.make('merger'); }
  createDelay(): MockNode { return this.make('delay'); }
  createOscillator(): MockNode { return this.make('oscillator'); }
  createBufferSource(): MockNode { return this.make('buffer'); }
  createConstantSource(): MockNode { return this.make('constant'); }
  createDynamicsCompressor(): MockNode { return this.make('compressor'); }
  createConvolver(): MockNode { return this.make('convolver'); }
  createPeriodicWave(): PeriodicWave { return {} as PeriodicWave; }
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      duration: length / sampleRate, length, sampleRate, numberOfChannels: channels,
      getChannelData: (channel: number) => data[channel],
      copyToChannel: (source: Float32Array, channel: number) => data[channel].set(source),
    } as AudioBuffer;
  }
  setState(state: string): void { this.state = state; this.dispatchEvent(new Event('statechange')); }
  async resume(): Promise<void> { this.setState('running'); }
  async suspend(): Promise<void> { this.setState('suspended'); }
}

export function audioSetup() {
  const mock = new MockContext();
  const ctx = mock.audio;
  const out = ctx.createGain(), wet = ctx.createGain();
  const noise = ctx.createBuffer(1, mock.sampleRate * 2, mock.sampleRate);
  return { mock, ctx, out, wet, noise };
}
