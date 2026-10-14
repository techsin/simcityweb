/**
 * Off-main-thread LOD proxy generation. Module workers (lodWorker.ts) run the massing-proxy build on copies of a
 * model's attribute arrays and post the proxy back, so proxies never cost frame time (a cold, unoptimised build
 * takes 10-140 ms; warm ones up to ~20 ms). A small pool of workers (`workers`: two on machines with four or more
 * cores) shares the jobs, and each keeps up to `perWorker` jobs queued (bounded copies in flight): a city load posts
 * its prefetch in bulk, so the workers keep building through the load's long main-thread tasks instead of waiting
 * for the main thread to hand out the next job, and the city's proxies are mostly ready by the time the player first
 * moves the camera. Urgent requests (a building needs its proxy now) jump ahead of background prefetches: here, and in
 * the worker's own queue (a promotion message for a job already posted). Results are stored in lodProxy's cache, so a
 * later synchronous lodProxyFor() (captures: flushLod) returns the same geometry.
 * Without module-worker support (Node tests) or if a worker fails to load, `available` is false and callers build
 * synchronously; requests still queued when the workers fail are built on the main thread, one per task.
 */
import * as THREE from 'three';
import { cachedLodProxy, lodProxyExcluded, lodProxyFor, setCachedLodProxy } from './lodProxy';

type Done = (g: THREE.BufferGeometry | null) => void;
interface Job { key: string; geo: THREE.BufferGeometry; done: Done[]; urgent: boolean; worker: number }
interface Reply { key: string; ok: boolean; position?: Float32Array; normal?: Float32Array; color?: Float32Array; surf?: Float32Array; failed?: boolean }

/** workers in the pool: two where the machine has four or more cores (the main thread, the GPU process and the
 *  compositor keep the others busy), else one */
function poolSize(): number {
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : 2;
  return hc >= 4 ? 2 : 1;
}

export class LodProxyBuilder {
  private workers: Worker[] = [];
  /** jobs posted to each worker and not answered yet */
  private posted: number[] = [];
  private failed = false;
  /** jobs not posted yet (urgent first) */
  private queue: Job[] = [];
  private jobs = new Map<string, Job>();
  /** jobs posted to one worker at a time (its own queue: the worker keeps building while the main thread is busy, which
   *  holds the workers' replies, and with them the next posts, for seconds during a city load). Each holds a copy of its
   *  model's attributes (mean ~106 KB over the 535 building variants, max ~640 KB): two workers x 128 hold a whole
   *  town's prefetch (~250 models, ~27 MB in flight), a big city's first 256 models */
  perWorker = 128;
  /** proxies built by the workers (stats) */
  built = 0;

  constructor() {
    if (typeof Worker === 'undefined' || typeof window === 'undefined') { this.failed = true; return; }
    try {
      for (let i = 0, n = poolSize(); i < n; i++) {
        const w = new Worker(new URL('./lodWorker.ts', import.meta.url), { type: 'module', name: `lod-proxies-${i}` });
        w.onmessage = (e: MessageEvent<Reply>) => this.onReply(i, e.data);
        w.onerror = (e) => { e.preventDefault?.(); this.fail(); };
        this.workers.push(w);
        this.posted.push(0);
      }
    } catch {
      for (const w of this.workers) w.terminate();
      this.workers.length = 0;
      this.failed = true;
    }
  }

  /** false: no worker (build synchronously) */
  get available(): boolean {
    return !this.failed && this.workers.length > 0;
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
      if (urgent && !job.urgent) {
        job.urgent = true;
        if (job.worker >= 0) this.workers[job.worker]?.postMessage({ promote: key });
        else {
          const i = this.queue.indexOf(job);
          if (i >= 0) this.queue.splice(i, 1);
          this.post(job);
        }
      }
      return;
    }
    job = { key, geo, done: [done], urgent, worker: -1 };
    this.jobs.set(key, job);
    // (an urgent job goes out at once, past the per-worker bound: it is taken next by the worker's queue)
    if (urgent && !this.failed) this.post(job);
    else { this.queue.push(job); this.pump(); }
  }

  /** post a job to the worker with the fewest jobs queued */
  private post(job: Job): void {
    if (this.failed) { this.queue.unshift(job); this.drainSync(); return; }
    let k = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.posted[i] < this.posted[k]) k = i;
    const g = job.geo;
    const copy = (n: string) => {
      const a = g.getAttribute(n).array;
      return a instanceof Float32Array ? a.slice() : Float32Array.from(a as ArrayLike<number>);
    };
    const msg = { key: job.key, position: copy('position'), color: copy('color'), surf: copy('surf'), urgent: job.urgent };
    job.worker = k;
    this.posted[k]++;
    this.workers[k].postMessage(msg, [msg.position.buffer, msg.color.buffer, msg.surf.buffer]);
  }

  /** hand queued jobs to workers with room (perWorker each) */
  private pump(): void {
    if (this.failed) { this.drainSync(); return; }
    while (this.queue.length) {
      let room = false;
      for (let i = 0; i < this.workers.length; i++) if (this.posted[i] < this.perWorker) { room = true; break; }
      if (!room) return;
      this.post(this.queue.shift()!);
    }
  }

  private onReply(w: number, r: Reply): void {
    if (r.failed) { this.fail(); return; }
    if (w < this.posted.length) this.posted[w] = Math.max(0, this.posted[w] - 1);
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
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.posted.length = 0;
    // requests already posted are lost with the workers: queue them again for the main-thread fallback (urgent first)
    for (const job of this.jobs.values()) {
      if (this.queue.includes(job)) continue;
      job.worker = -1;
      if (job.urgent) this.queue.unshift(job);
      else this.queue.push(job);
    }
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
/** the page's LOD proxy builder (one worker pool for every BuildingRenderer) */
export function lodProxyBuilder(): LodProxyBuilder {
  if (!shared) shared = new LodProxyBuilder();
  return shared;
}
