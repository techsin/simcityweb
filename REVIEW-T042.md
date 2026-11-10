# REVIEW-T042 (cloud lead → desktop worker): PASS

Reviewed origin/local/T042-lg09-difficulty @ 1a2b3f2f (contains dev 05cbf59) against dev 05cbf59. This is a single-pass
lead review (wind-down): the src diff read, the gates taken from the DONE.

**Lead's note:** PASS. Merge T042 (NOTE-091's fast path if dev has not moved into its files), then message "MERGED".
After the merge the cloud runs the 9-member Hard and Expert rows. The one open item goes into T066.

## What was checked

- **Medium is untouched.** `DifficultyRules` gains `opexMultiplier`, `taxPerPoint`, `disasterMultiplier`,
  `manualDispatchWindowMultiplier`, `bankruptRemovalMonths` and `loanCutoffYears`. Medium (and Easy and Sandbox) take
  the neutral values (1, −3.5, 1, 1, null, null). Your gate shows the bot identical with the action log (192,236).
- **One emergency.ts change looked like it might affect every difficulty, and does not.** In the out-of-range branch
  the 5th `setUncovered` argument changed from `true` to `canSend` (`!!freeAny && !manualDispatchExpired`). That branch
  runs only under `else if (freeAny)`, so on Medium `canSend` is still `true`. Only Expert's shortened window can make
  it false.
- **Hard:** income ×0.85 (unchanged), running costs ×1.15, −4.5 approval per tax point, disasters ×1.5, removal after
  12 consecutive negative months.
- **Expert:** Hard's rules plus disasters ×3, the player's dispatch window ×0.75 (automatic dispatch keeps the original
  timing through `dispatchWindowEnd(inc, false)`), and no new loans after year 5 from `foundedDay`.
- **Replicas:** `foundedDay` joins `SYSTEM_KEYS`, so a replica sees the same loan cutoff. A missing key reads as a
  day-0 founding, which is correct for legacy saves. T075's request appends `firsts` to the same list later: append
  after `foundedDay`.
- **The banner and DispatchTool** show "Window closed" and empty options once Expert's manual window has closed. The
  authority refuses late presses with a reason.

## Findings

1. **Expert, FH-08's E1a card** (your open item): its own Send nearest can stay enabled between the fractional window
   close and the next daily options delivery, though the authority refuses the press.
   `renderTeaching: card.send.disabled = !best || manualClosed` goes into **T066**, which is already in
   EmergencyBanner.ts. Leave the banner file alone in this lane.
2. **Balance (the cloud's, after the merge):**
   - Hard's lowest daily funds are §86 on the bot, so a real player near the edge risks removal after 12 negative
     months. The cloud's 9-member Hard row counts members that ever go negative and the longest negative run.
   - An Expert row (9 members) checks year-5 loan reliance.
   - If more than 1 of 9 members go negative on Hard, or Expert's members hit the removal rule, a follow-up tunes start
     funds or `opexMultiplier`.

## Acceptance (from the DONE)

- Gate on 1a2b3f2f: tsc clean; vitest 329 files / 3,379 tests, 0 failed.
- Bot Medium 192,236, identical with the action log; Hard 135,128 on the B2 base, never negative.
- Real-GPU smoke on both hosts: 0 errors. The lane's full real-GPU QA was on its earlier base.
- Merge round: one conflict in EmergencyBanner.refresh() (dev's `rememberTeachingResponse`, then the lane's widened
  Send condition). Three test fixes changed no assertion. topBarTrace.json was re-recorded, and its only diff is Hard's
  tooltip ("costs 4.5 approval").
