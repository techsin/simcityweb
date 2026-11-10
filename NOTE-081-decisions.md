# NOTE-081 (lead → desktop worker), 10 Nov: decisions on your 04:17-04:33 messages

Thanks for correcting the times. Decisions, item by item:

## T084, the nightfall stall: go, exactly as you planned

The fix: never hide the sun light; set its intensity to 0 and keep `sunLit` for the shadow re-render. Keep the
regression test that the program-key inputs never change across a full day. Keep the fresh-profile dusk and dawn QA
check, which fails on any frame over 250 ms or any change in the program count. **Also add the 130-680 ms single
main-thread tasks on the 1M city at Ultra (about one every 20-40 s) to T084's trace pass.** Report their cause; fix
them in T084 if the fix is local, otherwise send options.

## T087's three questions

1. **Keep the X1 hunk** in its safe form: speed only, and the value recorded before the write.
2. **Leave the speedChanged event-value reads** in GameSounds and EmergencyBanner. They are correct, and tests pin
   them. No churn now.
3. **The thermal plant without water keeps its plume** (its output halves); your 0 MW reading is fine.

## T074: move the weather calendar under src/sim before DONE

Sim code must not import from src/render, even type-only. Move the calendar to src/sim (or src/core) and make
src/render/world/Weather import from it. overlays.ts is an old exception, not a precedent.

## T037e: your "healthy" reading is accepted

Healthy means net income is at least 25 % of income **and** the asked-for service fits. Write it in the report as a
reading of the plan.

## T082's soak tool: go, as lane T088

- The driver line (`c.scene.sim.state`), plus a selftest case that runs Driver.save().
- **The days/s gate:** keep the floor at 15 days/s, as NOTE-026 specifies, but **measure it per running second**: sim
  days divided by the seconds the sim was running, excluding the cycle's pauses and loads. Report both numbers. This
  fixes the denominator; it does not loosen the bar.
- The final 4-hour soaks run with the machine to itself: no agents, no Codex, no QA.

## New small lanes

- **T091, a mid-month load loses a reward's announcement** (your T054b finding). `rewardsSystem.init`'s
  `check(sim, true)` unlocks silently at load. Make a load restore the unlocked and announced sets exactly, so the
  announcement still comes at the next month tick, as in an uninterrupted game. Check cityRanks too. Test: load on
  day 383 and day 388, and the Mayor's House news still arrives. The bot and the digests of a continuous run must not
  change.
- **T092, unanswerable prompts.** In the 30 s LIVE cooldown at Ultra, alerts show an enabled Send nearest that cannot
  be used in time, and the sim still counts them as prompted and ignored (emergency.ts:2164, :2884). **Measure first,
  then send options before you change anything.** Questions for the measurement:
  - how often this happens per hour at Ultra on a 250k city and on the 1M city;
  - what it costs in approval;
  - whether the bot path is affected.

  The owner's principle from the LG-06 decision applies: a city is never charged for calls it could not answer.
- **T085 gets the SETTLE_MS fix:** ignore only a click whose pointerdown began before the banner appeared, instead of
  every click within 350 ms. Two clicks were needed in 3 of 5 dispatches.
- **T093, cosmetics:**
  - the tile card says "a little water" at 0 % water;
  - the two WaterRenderer shader warnings per city load.
- **T094, the FEEL-07 producer** (T075's untestable "once per kind across save/load"):
  - record `systemData.firsts`, saved, and emit `ref.first` when a kind happens for the first time;
  - start it after B2 is in dev (it touches sim systemData);
  - the bot and the digests of runs without firsts must stay unchanged; check them.

## Smaller items

- **The flaky workerTransport.test.ts line 259 (a fatal message after ready):** T083 fixes the race. Await the
  worker's fatal message, not the verify query.
- **T086's B5 lock query:** accepted.
