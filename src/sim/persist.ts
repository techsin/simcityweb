/**
 * Save hooks (T057, save / load continuity). A system whose runtime state must survive a save, but which keeps it in
 * a form that is too large or too costly to mirror into systemData every day (per-building caches, list orders),
 * registers a hook on the CityState it runs: serializeCity calls the state's hooks first, and each writes its compact
 * record into state.systemData, which is then saved with everything else. The system's init() reads the record back
 * on a loaded city.
 *
 * A hook only writes systemData records that its own system reads at init. It must be idempotent (a save repeated
 * without a simulated day in between writes the same record), and it must not change anything the simulation reads:
 * saving is not a game event, and a game that saves continues exactly like one that does not.
 */
const hooks = new WeakMap<object, Map<string, () => void>>();

/** set (fn) or drop (null) the save hook `key` of a state; a system's init() sets its hook again on every (re)init */
export function setSaveHook(state: object, key: string, fn: (() => void) | null): void {
  let m = hooks.get(state);
  if (!fn) { m?.delete(key); return; }
  if (!m) hooks.set(state, (m = new Map()));
  m.set(key, fn);
}

/** run every save hook of a state (serializeCity, before it reads the state) */
export function runSaveHooks(state: object): void {
  const m = hooks.get(state);
  if (m) for (const fn of m.values()) fn();
}

/**
 * The systemData records the economy systems' continuity state lives in (T057): written by save hooks or kept by the
 * systems, read back by their init() on a loaded city. A save from before T057 has none of them, and a city loaded
 * without them rebuilds that state at load, as it did before (recovery snapshots may leave them out: recoveryCodec).
 */
export const CONTINUITY_RECORDS: readonly string[] = ['econLists', 'lvRun', 'popRun', 'approvalRun', 'growthRun'];
