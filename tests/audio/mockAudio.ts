export class MockParam {
  value: number;
  automationRate = 'a-rate';
  events: [string, ...number[]][] = [];
  constructor(value: number) { this.value = value; }
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
  gain = new MockParam(1);
  frequency = new MockParam(350);
  detune = new MockParam(0);
  Q = new MockParam(1);
  pan = new MockParam(0);
  playbackRate = new MockParam(1);
  offset = new MockParam(1);
  delayTime = new MockParam(0);
  threshold = new MockParam(-24);
  knee = new MockParam(30);
  ratio = new MockParam(12);
  attack = new MockParam(0.003);
  release = new MockParam(0.25);
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
