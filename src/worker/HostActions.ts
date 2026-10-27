/** Main-thread predictions; the transport owns sequence numbers, cause tags and acknowledgement replay. */
import type { CellRect } from '../core/events';
import type { DevType, Network, Zone } from '../core/types';
import type { ActionResult, Cell, CityActionsApi, TerraformKind } from '../sim/actions';
import { BF } from '../sim/CityState';
import type { ServiceKind } from '../sim/catalogTypes';
import { Gesture, type ActOptions, type Command, type CommandArgs, type CommandOp, type CommandResult, type GestureOwner, type SimHost, type Ticket } from './SimHost';
import { PendingEdits, commandPreview, previewBounds, type PendingClaim } from './PendingEdits';
import { PreviewActions } from './PreviewActions';

export interface ActionTransport extends Pick<SimHost, 'state' | 'act'> {
  post<K extends CommandOp>(op: K, args: CommandArgs<K>, opts: ActOptions): Pick<Ticket<CommandResult<K>>, 'seq' | 'done'>;
}
export type PredictedAction = ActionResult & { provisional?: true; needsConfirm?: boolean };

export class HostActions implements CityActionsApi {
  readonly pending: PendingEdits;
  readonly preview: PreviewActions;
  private gesture: Gesture | null = null;
  private disposed = false;
  constructor(private host: ActionTransport) {
    this.pending = new PendingEdits(() => host.state);
    this.preview = new PreviewActions(() => host.state);
  }

  /** The loopback/worker host delegates act here; post owns the queue and optimistic field writes. */
  act<K extends CommandOp>(op: K, args: CommandArgs<K>, opts: ActOptions = {}): Ticket<CommandResult<K>> {
    if (this.disposed) throw new Error('Simulation host is disposed');
    const cmd = { op, args } as Command;
    const exact = this.pending.count === 0;
    const result = this.pending.overlay(() => this.preview.predict(cmd));
    const predicted = (result && !exact ? { ...result, provisional: true } : result) as CommandResult<K> | undefined;
    const gesture = opts.gesture ?? this.gesture;
    if (exact && result && !result.ok) {
      const done = Promise.resolve(predicted as CommandResult<K>);
      gesture?.track(done);
      return { seq: 0, predicted, exact, done };
    }
    const sent = this.host.post(op, args, { ...opts, gesture: gesture ?? undefined });
    this.pending.add(sent.seq, cmd, result);
    // Ack replay removes the reservation synchronously. Rejection also releases it (crash/disposal).
    void sent.done.then(() => this.pending.ack(sent.seq), () => this.pending.ack(sent.seq));
    gesture?.track(sent.done);
    return { ...sent, predicted, exact: result !== undefined && exact };
  }

  beginGesture(owner: GestureOwner): Gesture {
    this.gesture?.end();
    const gesture = new Gesture(owner, () => { if (this.gesture === gesture) this.gesture = null; });
    this.gesture = gesture;
    return gesture;
  }

  private run<K extends CommandOp>(op: K, args: CommandArgs<K>, preview: boolean): PredictedAction {
    if (this.disposed) throw new Error('Simulation host is disposed');
    if (!preview) {
      const ticket = this.host.act(op, args);
      const r = ticket.predicted as ActionResult;
      return ticket.exact ? r : { ...r, provisional: true };
    }
    const cmd = { op, args } as Command;
    const r = this.pending.overlay(() => this.preview.predict(cmd))!;
    const geometry = commandPreview(cmd);
    let claim: PendingClaim | null = null;
    if (geometry?.kind === 'path') {
      for (const c of geometry.path) {
        const next = this.pending.claims({ x0: c.x, z0: c.z, x1: c.x + 1, z1: c.z + 1 });
        if (next === 'blocked') { claim = next; break; }
        claim ??= next;
      }
    } else if (geometry) claim = this.pending.claims(previewBounds(geometry));
    return { ...r, ...(this.pending.count ? { provisional: true as const } : {}), ...(claim ? { ok: false, reason: claim === 'blocked' ? 'Blocked by a pending edit' : 'Waiting for the last edit…' } : {}) };
  }

  zone(rect: CellRect, zone: Zone, preview = false): PredictedAction { return this.run('zone', [rect, zone], preview); }
  dezone(rect: CellRect, preview = false): PredictedAction { return this.run('dezone', [rect], preview); }
  bulldoze(rect: CellRect, preview = false): PredictedAction { return this.run('bulldoze', [rect], preview); }
  buildNetwork(path: Cell[], type: Network, preview = false): PredictedAction { return this.run('buildNetwork', [path, type], preview); }
  buildPowerLine(path: Cell[], preview = false): PredictedAction { return this.run('buildPowerLine', [path], preview); }
  buildSubway(path: Cell[], preview = false): PredictedAction { return this.run('buildSubway', [path], preview); }
  plop(id: string, x: number, z: number, rot: 0 | 1 | 2 | 3, preview = false): PredictedAction { return this.run('plop', [id, x, z, rot], preview); }
  terraform(kind: TerraformKind, x: number, z: number, radius: number, strength: number, preview = false): PredictedAction { return this.run('terraform', [kind, x, z, radius, strength], preview); }
  plantTrees(rect: CellRect, preview = false): PredictedAction { return this.run('plantTrees', [rect], preview); }
  setOrdinance(id: string, enabled: boolean, opts?: { confirm?: boolean }): PredictedAction { return this.run('setOrdinance', [id, enabled, opts], false); }
  takeLoan(amount: number): PredictedAction { return this.run('takeLoan', [amount], false); }
  repayLoan(index: number): PredictedAction {
    const loan = this.host.state.budget.loans[index];
    return this.run('repayLoan', [index, { principal: loan?.principal ?? NaN, monthsLeft: loan?.monthsLeft ?? NaN }], false);
  }
  setTax(dev: DevType, value: number): void { this.host.act('setTax', [dev, value]); }
  setFunding(service: ServiceKind, value: number): void { this.host.act('setFunding', [service, value]); }
  toggleHistoric(id: number): void { this.host.act('setHistoric', [id, !((this.host.state.buildings.get(id)?.flags ?? 0) & BF.Historic)]); }

  dispose(): void {
    this.disposed = true;
    this.gesture?.end();
    this.pending.dispose();
  }
}
