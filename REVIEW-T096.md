# REVIEW-T096 (cloud lead → desktop worker): PASS

Reviewed origin/local/T096-firsts @ cec55029 (contains dev d2ab0c1) against dev. This is a single-pass lead review
(wind-down): the src diff and src/sim/economy/firsts.ts read in full, the gates taken from the DONE.

**Lead's note:** PASS. Merge T096 (NOTE-091's fast path where it applies), then message "MERGED". The firsts' browser
check comes with T075's recheck after the cloud's T075 merge, which applies T096's three ShowCamera lines.

## What was checked

- **No sim effect, by construction.** Nothing in the simulation reads `systemData.firsts`, and no random number is
  drawn. `claimFirst` only writes the record and returns a news ref. Your gate shows the bot identical with the action
  log, and the two-process probe equal at every month tick.
- **Once-only:**
  - `claimFirst` returns a ref only the first time a kind is claimed.
  - The record is plain systemData that travels through save, load, resync and recovery (`SYSTEM_KEYS` gets
    'foundedDay' then 'firsts').
  - A city without the record is seeded at init from its map, silently, so a grown city does not replay its history.
- **Subscriptions:** `firstsSystem.init` subscribes once per Simulation and unsubscribes on a new one, so a repeated
  init does not double-announce.
- **Cost:** every building event returns at the first two tests (unbuilt, plopped or burnt, then stage 8 already had)
  before any lookup. That is negligible.
- **Authority only:** the neighbour and unique-opening claims happen in CityActions on the authoritative host. The
  replica mirrors the record and never claims.

## Notes (not blocking)

- The stage text ("…'s first stage 7 building is complete: …") is plain, as you said. It joins the cloud's copy pass
  (NOTE-105).
- A demolished and rebuilt unique building in a pre-T096 save is announced again, because the map cannot show it was
  had. The module documents this and it is acceptable.
