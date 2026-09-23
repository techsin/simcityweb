/** Tiny typed event emitter. */
export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private map = new Map<keyof Events, Set<Listener<any>>>();
  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }
  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    this.map.get(type)?.delete(fn);
  }
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
  clear(): void {
    this.map.clear();
  }
}

/** Integer rectangle in cell coordinates, inclusive min, exclusive max. */
export interface CellRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
