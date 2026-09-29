/** Worker entry of one ISOLATED browser arm (see browserArm.ts) */
import { makeArmHost, type ArmHost } from './browserArmHost';

let host: ArmHost | null = null;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
self.onmessage = async (e: MessageEvent<{ cmd: string; opts?: Parameters<typeof makeArmHost>[0] }>) => {
  try {
    if (e.data.cmd === 'init') { host = await makeArmHost(e.data.opts!); post({ value: host.info }); }
    else if (e.data.cmd === 'cycle') post({ value: host!.cycle() });
    else if (e.data.cmd === 'digest') post({ value: host!.digest() });
  } catch (err) {
    post({ error: err instanceof Error ? err.stack ?? err.message : String(err) });
  }
};
