/** Shared standing/ruin index of exact mirrored buildings. */
import type { GameContext } from '../game/context';
import { BF, type Building, type CityState } from '../sim/CityState';

export interface RuinState { live: Set<string>; ruin: Map<string, Building> }

export function ruinState(list: Iterable<Building>): RuinState {
  return indexRuins(list);
}

function indexRuins(list: Iterable<Building>, flags?: Map<number, number>): RuinState {
  const live = new Set<string>(), ruin = new Map<string, Building>();
  for (const b of list) {
    if (!(b.flags & BF.Plopped)) continue;
    flags?.set(b.id, b.flags & (BF.Plopped | BF.Burnt));
    if (b.flags & BF.Burnt) {
      if (!ruin.has(b.def)) ruin.set(b.def, b);
    } else live.add(b.def);
  }
  return { live, ruin };
}

interface Memo { key: string; buildings: CityState['buildings']; flags: Map<number, number>; value: RuinState }
const memos = new WeakMap<CityState, Memo>();

/** One city scan per epoch, shared by every catalog def and RewardsPanel. */
export function ruinsFor(ctx: Pick<GameContext, 'state' | 'host' | 'signal'>): RuinState {
  const st = ctx.state;
  let memo = memos.get(st);
  if (!memo) {
    memo = { key: '', buildings: st.buildings, flags: new Map(), value: { live: new Set(), ruin: new Map() } };
    memos.set(st, memo);
    const cache = memo;
    // Ruins can change inside a day; power and other presentation flags do not affect this index.
    const off = ctx.host?.events?.on('buildingChanged', (b) => {
      const flags = b.flags & BF.Plopped ? b.flags & (BF.Plopped | BF.Burnt) : 0;
      if ((cache.flags.get(b.id) ?? 0) !== flags) cache.key = '';
    });
    const close = () => { off?.(); memos.delete(st); ctx.signal.removeEventListener('abort', close); };
    if (ctx.signal.aborted) close();
    else ctx.signal.addEventListener('abort', close, { once: true });
  }
  const key = `${st.buildings.size}:${st.nextBuildingId}:${st.day}:${ctx.host?.commandCount ?? 0}`;
  if (memo.key !== key || memo.buildings !== st.buildings) {
    memo.key = key;
    memo.buildings = st.buildings;
    memo.flags.clear();
    memo.value = indexRuins(st.buildings.values(), memo.flags);
  }
  return memo.value;
}
