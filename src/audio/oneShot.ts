/** Reusable processing nodes. Sources still have one start/stop; reclaim on the audio clock, without ended handlers. */
type Kind = 'gain' | 'filter' | 'panner' | 'merger';
type Node = GainNode | BiquadFilterNode | StereoPannerNode | ChannelMergerNode;
const MAX_IDLE = 256;
const TAIL = 0.25;

function reset(p: AudioParam, value: number): void {
  p.cancelScheduledValues(0);
  p.value = value;
  try {
    p.automationRate = 'a-rate';
  } catch {
    /* fixed rate */
  }
}

export class OneShotPool {
  private idle: Record<Kind, Node[]> = { gain: [], filter: [], panner: [], merger: [] };
  private active: OneShot[] = [];
  private free: OneShot[] = [];
  private lastCollect = -Infinity;

  constructor(readonly ctx: BaseAudioContext, private created: () => void = () => {}) {}

  begin(): OneShot {
    this.collect();
    const voice = this.free.pop() ?? new OneShot(this);
    voice.reset();
    this.active.push(voice);
    return voice;
  }

  take(kind: Kind): Node {
    let node = this.idle[kind].pop();
    if (!node) {
      node = kind === 'gain' ? this.ctx.createGain() : kind === 'filter' ? this.ctx.createBiquadFilter()
        : kind === 'panner' ? this.ctx.createStereoPanner() : this.ctx.createChannelMerger(2);
      this.created();
    }
    if (kind === 'gain') reset((node as GainNode).gain, 1);
    else if (kind === 'filter') {
      const f = node as BiquadFilterNode;
      f.type = 'lowpass';
      reset(f.frequency, 350);
      reset(f.detune, 0);
      reset(f.Q, 1);
      reset(f.gain, 0);
    } else if (kind === 'panner') reset((node as StereoPannerNode).pan, 0);
    return node;
  }

  recycle(kind: Kind, node: Node): void {
    node.disconnect();
    if (this.idle[kind].length < MAX_IDLE) this.idle[kind].push(node);
  }

  /** Lazy collection stays bounded by recent polyphony and never adds an idle timer. */
  collect(): void {
    const now = this.ctx.currentTime;
    if (now - this.lastCollect < 0.05) return;
    this.lastCollect = now;
    let keep = 0;
    for (const voice of this.active) {
      if (voice.end + TAIL > now) this.active[keep++] = voice;
      else {
        voice.release();
        if (this.free.length < MAX_IDLE) this.free.push(voice);
      }
    }
    this.active.length = keep;
  }

  dispose(): void {
    for (const voice of this.active) voice.release(true);
    this.active.length = 0;
    this.free.length = 0;
    for (const nodes of Object.values(this.idle)) nodes.length = 0;
  }
}

export class OneShot {
  end = Infinity;
  private until = 0;
  private nodes: [Kind, Node][] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private inputs: [AudioNode, AudioNode | AudioParam][] = [];

  constructor(private pool: OneShotPool) {}

  reset(): void {
    this.end = Infinity;
    this.until = 0;
  }

  private take(kind: Kind): Node {
    const node = this.pool.take(kind);
    this.nodes.push([kind, node]);
    return node;
  }

  gain(): GainNode { return this.take('gain') as GainNode; }
  filter(): BiquadFilterNode { return this.take('filter') as BiquadFilterNode; }
  panner(): StereoPannerNode { return this.take('panner') as StereoPannerNode; }
  merger(): ChannelMergerNode { return this.take('merger') as ChannelMergerNode; }

  /** Register the actual stop time, including releases; never derive it from a sound's UI metadata. */
  source(source: AudioScheduledSourceNode, end: number): void {
    this.sources.push(source);
    this.hold(end);
  }

  hold(end: number): void { this.until = Math.max(this.until, end); }

  input(source: AudioNode, dest: AudioNode | AudioParam): void {
    this.inputs.push([source, dest]);
  }

  finish(): void {
    this.end = Math.max(this.pool.ctx.currentTime, this.until);
  }

  release(stop = false): void {
    for (const [source, dest] of this.inputs) {
      try {
        if ('setValueAtTime' in dest) source.disconnect(dest);
        else source.disconnect(dest);
      } catch {
        /* already disconnected */
      }
    }
    for (const source of this.sources) {
      if (stop) {
        try { source.stop(); } catch { /* already stopped */ }
      }
      source.disconnect();
    }
    for (const [kind, node] of this.nodes) this.pool.recycle(kind, node);
    this.inputs.length = 0;
    this.sources.length = 0;
    this.nodes.length = 0;
  }
}

const pools = new WeakMap<BaseAudioContext, OneShotPool>();
export function oneShots(ctx: BaseAudioContext): OneShotPool {
  let pool = pools.get(ctx);
  if (!pool) {
    pool = new OneShotPool(ctx);
    pools.set(ctx, pool);
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'closed') pool!.dispose();
    });
  }
  return pool;
}
