/** A dry, unoccupied route from the founding camera's buildable area to the nearest reachable edge. */
import { bestBuildableCell } from '../../game/cameraStart';
import type { CityState } from '../../sim/CityState';

export function edgeHint(st: CityState): { x: number; z: number }[] {
  const origin = bestBuildableCell(st), N = st.size;
  let start = origin.z * N + origin.x;
  const passable = (i: number) => !st.water[i] && st.building[i] < 0;
  // The camera helper picks a block centre, which can itself be wet on an island tile.
  if (!passable(start)) {
    let distance = Infinity;
    start = -1;
    for (let i = 0; i < st.cells; i++) if (passable(i)) {
      const d = Math.abs(i % N - origin.x) + Math.abs(Math.floor(i / N) - origin.z);
      if (d < distance) { distance = d; start = i; }
    }
    if (start < 0) return [];
  }
  const previous = new Int32Array(st.cells).fill(-1), queue = new Int32Array(st.cells);
  previous[start] = start;
  queue[0] = start;
  let head = 0, tail = 1, end = -1;
  while (head < tail) {
    const i = queue[head++], x = i % N, z = Math.floor(i / N);
    if (x === 0 || x === N - 1 || z === 0 || z === N - 1) { end = i; break; }
    for (const j of [i - N, i - 1, i + 1, i + N]) {
      if (previous[j] !== -1 || !passable(j)) continue;
      previous[j] = i;
      queue[tail++] = j;
    }
  }
  if (end < 0) return [];
  const path: { x: number; z: number }[] = [];
  for (let i = end; ; i = previous[i]) {
    path.push({ x: i % N, z: Math.floor(i / N) });
    if (i === start) break;
  }
  return path;
}
