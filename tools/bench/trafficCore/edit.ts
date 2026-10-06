/**
 * Gameplay-like network edit between traffic cycles (the verifier's edit-heavy protocol): toggles ONE dead-end road
 * cell — bulldozed on one call, rebuilt on the next — identically in every arm. Every bulldoze SHRINKS the road graph
 * below the previous cycle's settled search counts (the P1 condition) and every edit forces a graph rebuild.
 */
import type { Arm } from './arms';

let editCell = -1, editType = 0;

/** toggle the edit cell of `a` (found once: the first road cell with exactly one road neighbour and no building) */
export function editToggle(a: Arm): number {
  const st = a.st as unknown as { size: number; network: Uint8Array; building: Int32Array };
  const N = st.size, net = st.network;
  if (editCell < 0) {
    const isRoad = (i: number) => net[i] >= 1 && net[i] <= 5;
    for (let i = 0; i < N * N && editCell < 0; i++) {
      if (!isRoad(i) || st.building[i] >= 0) continue;
      const x = i % N, z = (i - x) / N;
      const k = (x > 0 && isRoad(i - 1) ? 1 : 0) + (x < N - 1 && isRoad(i + 1) ? 1 : 0) + (z > 0 && isRoad(i - N) ? 1 : 0) + (z < N - 1 && isRoad(i + N) ? 1 : 0);
      if (k === 1) { editCell = i; editType = net[i]; }
    }
    if (editCell < 0) throw new Error('no dead-end road cell to edit');
  }
  net[editCell] = net[editCell] !== 0 ? 0 : editType;
  (a.sim.events as unknown as { emit(type: string): void }).emit('networkChanged');
  return net[editCell];
}
