/** Banner/panel leases share one city-bound options watch per incident. */
import { watchFor, type QueryResult, type SimHost, type WatchHandle } from '../worker/SimHost';

interface Entry { watch: WatchHandle<QueryResult<'dispatchOptions'>>; users: number }
const pools = new WeakMap<SimHost, Map<number, Entry>>();

export class DispatchOptionsWatches {
  private held = new Map<number, Entry>();
  private pool: Map<number, Entry>;
  constructor(private host: SimHost, private signal: AbortSignal) {
    let pool = pools.get(host);
    if (!pool) { pool = new Map(); pools.set(host, pool); }
    this.pool = pool;
  }

  get(id: number): WatchHandle<QueryResult<'dispatchOptions'>> {
    let entry = this.held.get(id);
    if (!entry) {
      entry = this.pool.get(id);
      if (!entry) {
        entry = { watch: watchFor(this.host, 'dispatchOptions', { incidentId: id }, 'daily', this.signal), users: 0 };
        this.pool.set(id, entry);
      }
      entry.users++;
      this.held.set(id, entry);
    }
    return entry.watch;
  }

  retain(ids: ReadonlySet<number>): void {
    for (const [id, entry] of this.held) if (!ids.has(id)) {
      this.held.delete(id);
      if (--entry.users === 0) { entry.watch.dispose(); this.pool.delete(id); }
    }
  }

  dispose(): void { this.retain(new Set()); }
}
