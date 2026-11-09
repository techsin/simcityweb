/** The positive gate is also used by the deliberate negative controls. */
export type Fault = 'none' | 'transfer' | 'grow';
export interface WorkerReport {
  initial: boolean;
  afterBoot: boolean;
  intact: boolean;
  days: number;
  mode: string;
  blurActive: boolean;
  memoryBefore: number | null;
  memoryAfter: number | null;
  memoryStable: boolean;
  loaderGrows: number;
}
export interface ProtectorReport {
  main: { initial: boolean; intact: boolean };
  worker: WorkerReport;
  daysReceived: number;
  bytesReceived: number;
}
export interface Run { report: ProtectorReport; trace: string[] }

export function protectorFailures({ report: r, trace }: Run): string[] {
  const out: string[] = [];
  if (!r.main.initial || !r.main.intact) out.push('main protector invalidated');
  if (!r.worker.initial || !r.worker.afterBoot || !r.worker.intact) out.push('worker protector invalidated');
  if (r.worker.days !== 60 || r.daysReceived !== 60 || r.bytesReceived <= 0) out.push('incomplete simulation / message run');
  if (!r.worker.memoryStable || r.worker.memoryBefore !== r.worker.memoryAfter || r.worker.loaderGrows !== 0) out.push('wasm memory grew');
  if (trace.length) out.push(`protector trace: ${trace.join('\n')}`);
  if (r.worker.mode === 'wasm') {
    if (!(r.worker.memoryBefore! > 0)) out.push('wasm memory missing');
    if (!r.worker.blurActive) out.push('wasm blur drop-in never activated');
  } else if (r.worker.mode !== 'js') out.push('unknown kernel mode');
  else if (r.worker.blurActive || r.worker.memoryBefore !== null) out.push('JS mode used wasm');
  return out;
}
