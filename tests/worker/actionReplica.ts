/** A held command queue and a replaceable replica; T032 supplies the packet transport. */
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import type { CityState } from '../../src/sim/CityState';
import { HostActions, type ActionTransport } from '../../src/worker/HostActions';
import { LocalSimHost, type ActOptions, type Command, type CommandArgs, type CommandOp, type CommandResult, type Ticket } from '../../src/worker/SimHost';

export async function actionReplica(state: CityState) {
  const local = new LocalSimHost(state);
  await local.start();
  const copy = () => deserializeCity(serializeCity(state, { copy: true }));
  let replica = copy(), seq = 0;
  const queued: { seq: number; cmd: Command; opts: ActOptions; resolve(r: unknown): void; reject(e: Error): void }[] = [];
  const transport: ActionTransport = {
    get state() { return replica; },
    act: <K extends CommandOp>(op: K, args: CommandArgs<K>, opts?: ActOptions): Ticket<CommandResult<K>> => actions.act(op, args, opts),
    post: <K extends CommandOp>(op: K, args: CommandArgs<K>, opts: ActOptions) => {
      const id = ++seq;
      const done = new Promise<CommandResult<K>>((resolve, reject) => queued.push({ seq: id, cmd: structuredClone({ op, args }) as Command, opts, resolve: (r) => resolve(r as CommandResult<K>), reject }));
      return { seq: id, done };
    },
  };
  const actions = new HostActions(transport);
  return {
    local, actions, transport, queued,
    get state() { return replica; },
    get posted() { return seq; },
    replace(state: CityState) { replica = state; },
    replay() {
      const next = queued.shift()!;
      const result = local.act(next.cmd.op, next.cmd.args).predicted;
      replica = copy();
      actions.pending.rebase(next.seq);
      actions.pending.ack(next.seq);
      const ack = structuredClone(result);
      if (ack && typeof ack === 'object' && 'cells' in ack) delete ack.cells;
      next.resolve(ack);
      return ack;
    },
    reject() {
      const next = queued.shift()!;
      actions.pending.ack(next.seq);
      next.reject(new Error('Host crashed'));
    },
    async dispose() { actions.dispose(); await local.dispose(); },
  };
}
