/** coordinator side of armWorker.ts: one worker (isolate) per arm, request / reply by message */
import { Worker } from 'node:worker_threads';
import type { ArmKind } from './arms';

export interface ArmProc {
  kind: ArmKind;
  info: Record<string, number>;
  call<T = Record<string, unknown>>(msg: Record<string, unknown>): Promise<T>;
  close(): Promise<number>;
}

export async function spawnArm(file: string, kind: ArmKind, fixture: string, args: string[], resident: boolean, extra: { scalar?: string; imp?: string }): Promise<ArmProc> {
  const w = new Worker(file, { workerData: { kind, fixture, args, resident, ...extra }, resourceLimits: { maxOldGenerationSizeMb: 6144 } });
  let pending: { res: (v: unknown) => void; rej: (e: Error) => void } | null = null;
  w.on('message', (m: { error?: string }) => {
    const p = pending;
    pending = null;
    if (!p) return;
    if (m.error) p.rej(new Error(`${kind}: ${m.error}`));
    else p.res(m);
  });
  w.on('error', (e: unknown) => { const p = pending; pending = null; p?.rej(e instanceof Error ? e : new Error(String(e))); });
  w.on('exit', (code) => { const p = pending; pending = null; p?.rej(new Error(`${kind}: arm worker exited (${code})`)); });
  // the worker keeps the process alive only while a request is pending (an error in the coordinator must not leave
  // idle arm isolates holding the process open)
  const call = <T,>(msg: Record<string, unknown>) => new Promise<T>((res, rej) => {
    w.ref();
    pending = { res: (v) => { w.unref(); res(v as T); }, rej: (e) => { w.unref(); rej(e); } };
    w.postMessage(msg);
  });
  const info = await call<Record<string, number>>({ cmd: 'init' });
  return { kind, info, call, close: () => w.terminate() };
}
