/**
 * T061 item 6 (NOTE-055): `policy.teaching` on the worker host. The getter is PacketSimHost's (T036 step 5 adds it beside
 * alerts / live / toast / warn), so WorkerSimHost has it too; the worker's gap was its recorder, which listed the view's
 * fields (alerts, live, toast, warn) and would have dropped `teaching` from every packet. It now sends every field of the
 * view (recorder.ts policyState). The end-to-end read of `host.policy.teaching` on the worker host waits for T036 step 5.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { LivePolicy } from '../../src/worker/SimCore';
import { policyState } from '../../src/worker/recorder';
import { newState } from '../infra/cityGen';

describe('the policy a packet carries (T061 item 6)', () => {
  it('every field of the view, a field added later included; not subscribe; the alerts copied', () => {
    const alerts = [{ id: 1, wasPossible: true }];
    const view = {
      get alerts() { return alerts; }, get live() { return true; }, get toast() { return undefined; }, get warn() { return true as const; },
      get teaching() { return { id: 1, variant: 'e1' }; },
      subscribe() { return () => {}; },
    };
    const p = policyState(view);
    expect(p).toEqual({ alerts: [{ id: 1, wasPossible: true }], live: true, toast: undefined, warn: true, teaching: { id: 1, variant: 'e1' } });
    expect(Object.keys(p)).toEqual(['alerts', 'live', 'toast', 'warn', 'teaching']);
    expect(p.alerts[0]).not.toBe(alerts[0]);
    expect('subscribe' in p).toBe(false);
  });

  it('reads LivePolicy\'s own view the same way the old field list did', () => {
    const policy = new LivePolicy(new Simulation(newState(16)), new AbortController().signal);
    expect(policyState(policy.view)).toEqual({ alerts: [], live: false, toast: undefined, warn: undefined });
  });
});
