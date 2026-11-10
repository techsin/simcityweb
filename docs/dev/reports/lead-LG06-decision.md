# LG-06 decision memo

## What the diagnosis showed
- **The attentive city's loss started with a call the player could not answer, and it only appears on the old tree.** On the tree before T041, seed 11: in year 1, a medical call came in a town of 2,121 people with no clinic. The player was never shown it and could not have answered it. Five people died, the safety record fell, and migration and tourism dropped. By year 10 the city was 17,321 residents smaller (-17.9%). The safety record alone accounts for 8,036 of that, about 46%. The rest comes from how the parts interact, so their effects do not add up. Today's approval rule would forgive this call in a town that small. On the T043+T041 tree, which is the kind the final tests use, the same seed shows no gap: -59 residents at year 10 and +627 at year 15.
- **Neglect does not pay more, and it can come out ahead.** Correcting Q2: ignoring calls caused more failures (39 against 11 across five cities over 10 years) but smaller repair bills. The median was §1,512 against §2,400 by year 10 and §2,436 against §2,760 by year 15. Many of those failures were medical calls with no property damage. In the older year-60 nine-run set, the neglectful seed-11 city ends 3.9% larger and 12% richer than the attentive one with LG-06 on. With LG-06 off it was 1.9% smaller. Keeping the military base is shown in one representative city only, not across the five-city group.
- **The repair booking and the scars work as built, with limits.** The booking changed none of 25,200 monthly finance decisions in the attentive seed-11 runs, so it stays. The report does find booking-sensitive forks elsewhere. The scars' +1.9% growth comes from one pair of runs on one seed and map size. On seed 11, scars alone end -0.7%. It is a fork in the city's development path, not a built-in bonus.
- **The tuning search was narrow.** It tried six single settings, one per lever, on the old tree only. None passed the base checks. It did not try combinations, any lever on top of option (a), a higher repair share or a deaths weight. NOTE-048 allows both of the last two.
- **Option (a) is fair, but neglect barely costs anything under it.** It fixes the old-tree attentive city: the year-15 shift goes from -13.68% to -0.13%. Problems remain:
  - All four attentive rows still fail a base check.
  - On the T043+T041 tree it pushes the seed-11 attentive city about 1% away from dev.
  - Neglect loses less than 0.5% against its own attentive city (the target is 2%).
  - Against neglect with LG-06 off, it ends larger on 3 of 4 runs (+3.20% on old-tree seed 11). So it fails the "neglect must cost by itself" gate.
  - All four approval margins are negative.
  - These are 15-year, five-run results only.

  Even at year 60, the 2% target sits inside a spread of about 14% between nine runs of the same city.

## Options
1. **Cut LG-06 from this release.** An "approval-only" version is the same thing, because T043 adds no approval term.
   - **What changes:** T043 is not merged, and its branch and evidence are kept. LG-06 moves to the backlog with its acceptance and gates unchanged. LG-15 gets its own disaster-only damage charge.
   - **What a player feels:** The game as it is today. Neglect costs approval, small towns get grace, and the approval breakdown already explains it.
   - **Risk:** The lowest. LG-06's problem stays open and is stated honestly.
   - **Cost:** One plan amendment, no runs and no code on dev. It frees a final-gate bot slot and withdraws three requests to other owners: B2's scar refresh, the GUIDE label and the META banner.
2. **A repair bill only for calls the player saw and ignored.**
   - **What changes:** The safety record and the scars are dropped. The repair charge applies only to the existing "ignored" calls: shown, then not answered. The item is renamed, and its growth and funds targets are rewritten before any run.
   - **What a player feels:** "You saw the call and did not answer: -§8,400 rebuild." The rule is clear and fair, but the cost is small: about §1-2k over 15 years against funds of about §120k.
   - **Risk:** It is a new rule, so the owner must approve it. The attentive base stays identical to dev only if the attentive test city leaves no call ignored, and that is not yet checked. It does not make neglect cost growth.
   - **Cost:** A small emergency hunk (waiting on B2), the label, the banner text, and one nine-run neglect set on the final dev. No new saved data is needed.
3. **One last try with option (a), all gates kept, and a stop rule written first.**
   - **What changes:** Losses count only when the call was shown, a unit was sent, or a station was in range. Constants and gates stay as they are. Dropping the gate after (a) failed it is not offered: that would be a rule following a result, and it still would not reach the 2% target.
   - **What a player feels:** No unfair charges. Neglect costs almost nothing extra.
   - **Risk:** Present evidence says it fails. It adds new saved state and save-format work.
   - **Cost:** A new tracking mechanism and saved ledger with tests, about 30 more screening runs, then 75 runs on the final dev after B2 and T041 merge (36 of them 60-year). It competes with the final tests for T044 and T045.
4. **Redesign: each call the player sees and ignores costs newcomers.**
   - **What changes:** A fixed penalty per ignored call, like the existing approval penalty, with approval's 2,000-8,000-resident fade-in. Bills and scars apply only to ignored calls.
   - **What a player feels:** If it works, a clear rule the player controls, and attentive cities are untouched by design.
   - **Risk:** Unproven. It may need a large weight per call, and the late-game growth cap can mask it.
   - **Cost:** A new spec, then about 36 sixty-year runs per candidate, then the 75-run final set. Realistically after release.

## Lead recommendation
Cut LG-06's simulation changes from this release (option 1). Keep the branch, the 425-run evidence, its acceptance and every NOTE-048/053/062 gate exactly as written. While LG-06 claims to cost growth, the "neglect must cost by itself" gate stays: retire the claim, not the gate. No measured variant passes the unchanged gates. Full LG-06 punishes a city for a call it never saw, and in the year-60 set the neglectful seed-11 city still ends ahead. Option (a) fixes the unfairness but leaves no cost a player would notice, and it only helps the old tree. Shipping any of it under "neglect costs growth" would show players a consequence that never arrives. Cutting costs no runs and no dev code, and it takes a lane that shifts the base out of the way of the T044/T045 final gates. For any future version, record two things now. First, the owner should confirm that a city is never charged for calls it was not shown (NOTE-062 section 5 Q1). Second, the next design should key off calls that were shown and ignored, using data that is already saved and used by approval, with the small-town fade-in. If the owner wants something visible for release, option 2 is the only variant worth shipping, and only after confirming that the attentive test city records zero ignored calls.

## The question for the owner
For this release, should ignoring emergency calls cost the city anything beyond the approval drop it already causes today?
- **A (recommended):** No. Leave it out for now and design a fairer version after release, based only on calls the player saw and ignored.
- **B:** Only a small, visible repair bill each time the player sees a call and ignores it, with no hidden growth penalty.
- **C:** One last attempt at the growth penalty, counting only calls the player could have answered. If it fails the existing tests, drop it with no more tuning.
- **D:** Yes. Design a stronger penalty now, even though it means weeks of testing and may still miss the release.

Every answer assumes a city is never charged for calls it was not shown or could not answer.

## What the desktop does next under each answer
- **A:**
  - Drop T043 from the wave-2 merge list and close it unmerged, keeping the branch.
  - Amend POLISH_PLAN: LG-06 is deferred to the backlog, with the reason, the evidence and its acceptance unchanged. Re-scope LG-15's charge.
  - Withdraw the B2, GUIDE and META requests.
  - Saves: nothing to migrate. LG-06 was never on dev. If internal T043 test saves matter, confirm that dev's loader ignores their extra keys.
- **B:**
  - Check the existing logs for ignored calls in the attentive test city.
  - Rewrite the item's name and gates before any run.
  - Strip the safety record and scars from T043, and limit the charge to shown-and-ignored calls.
  - Request the B2 hunk, the GUIDE label and the META banner.
  - Run one nine-run neglect set per seed plus a base identity check on the final dev.
  - Saves: bill only calls that settle after the load. Each incident's saved "shown" flag is used the same way approval uses it.
- **C:**
  - Write the stop rule into the plan first, and get the owner's approval for the eligibility rule.
  - Old-save policy: an incident counts once a call is shown, a unit is sent or a station is in range after the load, not from the saved flag, which the emergency code resets. The 12-month count starts empty. No refunds, and existing scars keep their expiry.
  - Build the tracking mechanism and saved ledger with tests, and finish the screens.
  - After B2 and T041 merge, run the 75-run final set. Cut on any failed neglect row.
- **D:**
  - Do A's steps for this release.
  - Open a backlog task with the per-ignored-call spec, preregistered 60-year screens on the post-T041 dev, and the full final set afterward.