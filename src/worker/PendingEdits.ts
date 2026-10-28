/** Preview reservations only: map edits are never applied optimistically to the replica. */
import type { CellRect } from '../core/events';
import type { ActionResult, Cell } from '../sim/actions';
import type { CityState } from '../sim/CityState';
import { getDef, rotatedFootprint } from '../sim/catalog';
import type { Command, CommandOp } from './SimHost';

export type PendingPreview = { kind: 'rect'; rect: CellRect } | { kind: 'path'; path: Cell[] } | { kind: 'brush'; x: number; z: number; radius: number };
/** Optional on the rendering contract during migration; loading/null views need no ghost resources. */
export interface PendingPreviewView { setPendingPreview?(seq: number, preview: PendingPreview | null): void }
export type PendingClaim = 'blocked' | 'waiting';
export interface PendingView {
  readonly count: number;
  readonly revision: number;
  overlay<T>(fn: () => T): T;
  claims(rect: CellRect): PendingClaim | null;
  subscribe(listener: () => void, signal: AbortSignal): () => void;
}

export const NO_PENDING: PendingView = Object.freeze({
  count: 0, revision: 0,
  overlay: <T>(fn: () => T): T => fn(),
  claims: (): null => null,
  subscribe: (): (() => void) => () => {},
});

export function affectsPreview(op: CommandOp): boolean {
  return ['zone', 'dezone', 'bulldoze', 'buildNetwork', 'buildPowerLine', 'buildSubway', 'plop', 'terraform', 'plantTrees', 'setOrdinance', 'takeLoan', 'repayLoan'].includes(op);
}

/** Command geometry is the tool's committed rectangle, path or rotated footprint. */
export function commandPreview(cmd: Command): PendingPreview | null {
  switch (cmd.op) {
    case 'zone': case 'dezone': case 'bulldoze': case 'plantTrees': return { kind: 'rect', rect: { ...cmd.args[0] } };
    case 'buildNetwork': case 'buildPowerLine': case 'buildSubway': return { kind: 'path', path: cmd.args[0].map((c) => ({ ...c })) };
    case 'plop': {
      const [id, x, z, rot] = cmd.args, def = getDef(id);
      if (!def) return null;
      const [w, d] = rotatedFootprint(def, rot);
      return { kind: 'rect', rect: { x0: x, z0: z, x1: x + w, z1: z + d } };
    }
    case 'terraform': return { kind: 'brush', x: cmd.args[1] + 0.5, z: cmd.args[2] + 0.5, radius: Math.max(0.5, Math.min(24, cmd.args[3])) };
    default: return null;
  }
}

export function previewBounds(p: PendingPreview): CellRect {
  if (p.kind === 'rect') return normalize(p.rect);
  if (p.kind === 'brush') return { x0: Math.floor(p.x - p.radius) - 1, z0: Math.floor(p.z - p.radius) - 1, x1: Math.ceil(p.x + p.radius) + 1, z1: Math.ceil(p.z + p.radius) + 1 };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const c of p.path) { x0 = Math.min(x0, c.x); z0 = Math.min(z0, c.z); x1 = Math.max(x1, c.x + 1); z1 = Math.max(z1, c.z + 1); }
  return { x0, z0, x1, z1 };
}

function normalize(r: CellRect): CellRect { return { x0: Math.min(r.x0, r.x1), z0: Math.min(r.z0, r.z1), x1: Math.max(r.x0, r.x1), z1: Math.max(r.z0, r.z1) }; }
function intersects(a: CellRect, b: CellRect): boolean { return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0; }
function touches(p: PendingPreview, r: CellRect): boolean {
  if (p.kind === 'path') return p.path.some((c) => c.x < r.x1 && c.x + 1 > r.x0 && c.z < r.z1 && c.z + 1 > r.z0);
  if (p.kind === 'brush') {
    const x = Math.max(r.x0, Math.min(r.x1, Math.round(p.x))), z = Math.max(r.z0, Math.min(r.z1, Math.round(p.z)));
    return Math.hypot(x - p.x, z - p.z) < p.radius;
  }
  return intersects(previewBounds(p), r);
}

export class PendingEdits implements PendingView {
  private edits = new Map<number, { cost: number; unique?: string; geometry: PendingPreview | null; claim: PendingClaim; cuts: CellRect[] }>();
  private listeners = new Map<() => void, () => void>();
  private reported = new WeakSet<() => void>();
  private depth = 0;
  private mirrored = 0;
  revision = 0;
  constructor(private state: () => CityState) {}
  get count(): number { return this.edits.size; }

  add(seq: number, cmd: Command, predicted?: ActionResult): void {
    if (!affectsPreview(cmd.op)) return;
    const st = this.state(), def = cmd.op === 'plop' ? getDef(cmd.args[0]) : undefined;
    const sandbox = st.config.sandbox || st.config.difficulty === 'sandbox';
    // Ordinance cost is monthly, and sandbox construction does not debit funds. Loans still credit them.
    const cost = cmd.op === 'setOrdinance' || (sandbox && cmd.op !== 'takeLoan') ? 0 : predicted?.cost ?? 0;
    const cuts: CellRect[] = [];
    const demolished = new Set(predicted?.demolished);
    if (cmd.op === 'bulldoze') {
      const r = normalize(cmd.args[0]);
      for (let z = Math.max(0, r.z0); z < Math.min(st.size, r.z1); z++) for (let x = Math.max(0, r.x0); x < Math.min(st.size, r.x1); x++) {
        const id = st.building[st.idx(x, z)];
        if (id >= 0) demolished.add(id);
      }
    }
    for (const id of demolished) {
      const b = st.buildings.get(id);
      if (b) cuts.push({ x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d });
    }
    this.edits.set(seq, { cost, unique: def?.unique ? def.id : undefined, geometry: commandPreview(cmd), claim: ['plop', 'buildNetwork', 'buildPowerLine', 'buildSubway'].includes(cmd.op) ? 'blocked' : 'waiting', cuts });
    this.changed();
  }

  /** Called by the packet's plain/adopt hook: its funds and milestones already contain commands through cmd. */
  rebase(cmd: number): void { this.mirrored = cmd; }
  /** Called at Ack replay, before resolving its ticket. */
  ack(seq: number): void { if (this.edits.delete(seq)) this.changed(); }

  overlay<T>(fn: () => T): T {
    if (this.depth) return fn();
    const st = this.state(), funds = st.funds, milestones = st.milestones;
    const saved = new Map<string, number | undefined>();
    this.depth++;
    try {
      for (const [seq, edit] of this.edits) {
        if (seq <= this.mirrored) continue;
        st.funds -= edit.cost;
        if (edit.unique) {
          if (!saved.has(edit.unique)) saved.set(edit.unique, milestones[edit.unique]);
          milestones[edit.unique] = (milestones[edit.unique] ?? 0) + 1;
        }
      }
      return fn();
    } finally {
      st.funds = funds;
      for (const [id, value] of saved) {
        if (value === undefined) delete milestones[id];
        else milestones[id] = value;
      }
      this.depth--;
    }
  }

  claims(rect: CellRect): PendingClaim | null {
    const r = normalize(rect);
    let claim: PendingClaim | null = null;
    for (const e of this.edits.values()) {
      if (e.geometry && touches(e.geometry, r)) {
        if (e.claim === 'blocked') return 'blocked';
        claim = 'waiting';
      }
      if (e.cuts.some((cut) => intersects(cut, r))) claim = 'waiting';
    }
    return claim;
  }

  subscribe(listener: () => void, signal: AbortSignal): () => void {
    this.listeners.get(listener)?.();
    const off = () => { this.listeners.delete(listener); signal.removeEventListener('abort', off); };
    if (!signal.aborted) { this.listeners.set(listener, off); signal.addEventListener('abort', off, { once: true }); }
    return off;
  }
  dispose(): void {
    for (const off of this.listeners.values()) off();
    this.edits.clear();
  }
  private changed(): void {
    this.revision++;
    for (const listener of this.listeners.keys()) {
      try { listener(); }
      catch (error) {
        if (this.reported.has(listener)) continue;
        this.reported.add(listener);
        console.error('[pending] preview listener failed', error);
      }
    }
  }
}
