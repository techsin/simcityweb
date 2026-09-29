/**
 * Off-main-thread LOD proxy generation. A module worker (lodWorker.ts) runs the massing-proxy build on copies of a
 * model's attribute arrays and posts the proxy back, so proxies never cost frame time (a cold, unoptimised build
 * takes 10-140 ms; warm ones up to ~20 ms). At most `maxInFlight` requests are posted at a time (bounded copies and
 * worker queue); urgent requests (a building needs its proxy now) jump ahead of background prefetches. Results are
 * stored in lodProxy's cache, so a later synchronous lodProxyFor() (captures: flushLod) returns the same geometry.
 * Without module-worker support (Node tests) or if the worker fails to load, `available` is false and callers build
 * synchronously; requests still queued when the worker fails are built on the main thread, one per task.
 */
import * as THREE from 'three';
import { cachedLodProxy, lodProxyExcluded, lodProxyFor, setCachedLodProxy } from './lodProxy';

type Done = (g: THREE.BufferGeometry | null) => void;
interface Job { key: string; geo: THREE.BufferGeometry; done: Done[] }
interface Reply { key: string; ok: boolean; position?: Float32Array; normal?: Float32Array; color?: Float32Array; surf?: Float32Array }

export class LodProxyBuilder {
  private worker: Worker | null = null;
  private failed = false;
  private queue: Job[] = [];
  private jobs = new Map<string, Job>();
  private flying = 0;
  /** requests posted to the worker at once */
  maxInFlight = 2;
  /** proxies built by the worker (stats) */
  built = 0;

  constructor() {
    if (typeof Worker === 'undefined' || typeof window === 'undefined') { this.failed = true; return; }
    try {
      this.worker = new Worker(new URL('./lodWorker.ts', import.meta.url), { type: 'module', name: 'lod-proxies' });
      this.worker.onmessage = (e: MessageEvent<Reply>) => this.onReply(e.data);
      this.worker.onerror = (e) => { e.preventDefault?.(); this.fail(); };
    } catch {
      this.failed = true;
      this.worker = null;
    }
  }

  /** false: no worker (build synchronously) */
  get available(): boolean {
    return !this.failed && this.worker !== null;
  }

  /** requests not answered yet */
  get pending(): number {
    return this.jobs.size;
  }

  /** build the proxy of model geometry `geo` (cache key `key`) off the main thread and call done(proxy | null) */
  request(key: string, geo: THREE.BufferGeometry, done: Done, urgent = false): void {
    const c = cachedLodProxy(key);
    if (c !== undefined || lodProxyExcluded(key)) { done(c ?? null); return; }
    let job = this.jobs.get(key);
    if (job) {
      job.done.push(done);
      if (urgent) {
        const i = this.queue.indexOf(job);
        if (i > 0) { this.queue.splice(i, 1); this.queue.unshift(job); }
      }
      return;
    }
    job = { key, geo, done: [done] };
    this.jobs.set(key, job);
    if (urgent) this.queue.unshift(job);
    else this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    if (this.failed) { this.drainSync(); return; }
    const w = this.worker;
    while (w && this.flying < this.maxInFlight && this.queue.length) {
      const job = this.queue.shift()!;
      const g = job.geo;
      const copy = (n: string) => {
        const a = g.getAttribute(n).array;
        return a instanceof Float32Array ? a.slice() : Float32Array.from(a as ArrayLike<number>);
      };
      const msg = { key: job.key, position: copy('position'), color: copy('color'), surf: copy('surf') };
      this.flying++;
      w.postMessage(msg, [msg.position.buffer, msg.color.buffer, msg.surf.buffer]);
    }
  }

  private onReply(r: Reply): void {
    this.flying = Math.max(0, this.flying - 1);
    let g: THREE.BufferGeometry | null = null;
    if (r.ok && r.position && r.normal && r.color && r.surf) {
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(r.position, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(r.normal, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(r.color, 3));
      g.setAttribute('surf', new THREE.Float32BufferAttribute(r.surf, 3));
      g.name = r.key + '#lod';
      this.built++;
    }
    this.finish(r.key, setCachedLodProxy(r.key, g));
    this.pump();
  }

  private finish(key: string, g: THREE.BufferGeometry | null): void {
    const job = this.jobs.get(key);
    if (!job) return;
    this.jobs.delete(key);
    for (const d of job.done) d(g);
  }

  private fail(): void {
    if (this.failed) return;
    this.failed = true;
    this.worker?.terminate();
    this.worker = null;
    this.flying = 0;
    // requests already posted are lost with the worker: queue them again for the main-thread fallback
    for (const job of this.jobs.values()) if (!this.queue.includes(job)) this.queue.push(job);
    this.drainSync();
  }

  private draining = false;
  /** main-thread fallback: one build per task (setTimeout), so a backlog never lands in a single frame */
  private drainSync(): void {
    if (this.draining || !this.queue.length) return;
    this.draining = true;
    setTimeout(() => {
      this.draining = false;
      const job = this.queue.shift();
      if (job) this.finish(job.key, lodProxyFor(job.key, job.geo));
      this.drainSync();
    }, 0);
  }
}

let shared: LodProxyBuilder | null = null;
/** the page's LOD proxy builder (one worker for every BuildingRenderer) */
export function lodProxyBuilder(): LodProxyBuilder {
  if (!shared) shared = new LodProxyBuilder();
  return shared;
}
