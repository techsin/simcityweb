/**
 * Web Locks across "tabs" (every RegionSaveLock of one test shares it): a held name answers `ifAvailable` with null,
 * a steal rejects the holder's request with AbortError, and query() lists the held names without taking anything.
 */
export class FakeLocks {
  readonly held = new Map<string, { reject: (error: unknown) => void }>();
  readonly requests: { name: string; options: LockOptions }[] = [];
  queries = 0;

  request(name: string, options: LockOptions, callback: LockGrantedCallback<unknown>): Promise<unknown> {
    this.requests.push({ name, options });
    return new Promise((resolve, reject) => {
      const previous = this.held.get(name);
      if (previous && options.steal) {
        this.held.delete(name);
        previous.reject(new DOMException('Stolen', 'AbortError'));
      } else if (previous) {
        Promise.resolve(callback(null)).then(resolve, reject);
        return;
      }
      const entry = { reject };
      this.held.set(name, entry);
      Promise.resolve(callback({ name, mode: 'exclusive' } as Lock)).then(() => {
        if (this.held.get(name) === entry) this.held.delete(name);
        resolve(undefined);
      }, (error) => {
        if (this.held.get(name) === entry) this.held.delete(name);
        reject(error);
      });
    });
  }

  async query(): Promise<LockManagerSnapshot> {
    this.queries++;
    return { held: [...this.held.keys()].map((name) => ({ name, mode: 'exclusive' as const })), pending: [] };
  }
}

export const regionLockName = (regionId: string) => `metropolis.region.${regionId}`;
