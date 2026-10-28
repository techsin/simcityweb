/** W1.1b: the seeded transport lag of the loopback and worker test harnesses. No simulation or main-thread imports. */

/** Virtual transport time, never a busy wait or a change to simulation dt. */
export interface LagProfile { seed: number; packetTicks?: number; ackTicks?: number; longUnitChance?: number; unitMs?: readonly [number, number] }
export class SeededLag {
  private seed: number;
  constructor(readonly profile: LagProfile) { this.seed = profile.seed >>> 0; }
  random(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 0x100000000; }
  packet(ack: boolean): number { return Math.floor(this.random() * ((this.profile.packetTicks ?? 6) + 1)) + (ack ? this.profile.ackTicks ?? 3 : 0); }
  unit(): number {
    if (this.random() >= (this.profile.longUnitChance ?? 0.1)) return 0;
    const [lo, hi] = this.profile.unitMs ?? [50, 150];
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }
}
