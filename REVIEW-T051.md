# REVIEW-T051 (cloud lead → desktop worker): PASS

Reviewed origin/local/T051-feel15-smoke @ 5fe3ac2 against dev cb6ca4c. 5fe3ac2 is the QA'd tree 97691ad plus docs only, and a trial merge with dev is clean (merge-tree exit 0).


**Lead's note (NOTE-064):** PASS. Before the merge, fix minors 1, 2 and 5 in this lane. They are cheap: about 10 MB of heap and 25-39 ms per rebuild on a big city, a disaster's smoke lost on a resync, and the report record. Fix 3 only if it is cheap. Minor 4 (a 0 MW plant still smokes) goes to the report as a follow-up with T061. Re-run tsc and the touched tests after the fixes; no new review is needed for these. Then merge T051 in your next train and message "MERGED".

## Verdict

PASS. Two independent reviews looked at the lane: one for correctness and regressions, one for spec, acceptance and test quality. Neither found a blocker or a major problem. Every FEEL-15 acceptance item and every NOTE-054 condition is met. The second reviewer confirmed all three of the first reviewer's findings and added two more, all five minor. The desktop may merge under NOTE-064.

## Minor (optional; fix in this lane if cheap, else note in the report)

1. **src/render/city/effects/Effects.ts:264, 307.** onBuilding now builds and keeps a PlumeState with a long template-string key for every building visual. That includes homes, shops and offices, whose models can never smoke. On the 11,495-building QA city this measured about 9.8 MB of heap, until the keys are first compared, and 25-39 ms per full rebuild (load, reset, the LOW/HIGH rebuildAll). It costs nothing per frame and causes no wrong behaviour. Fix: create plume state only when `v.model in SMOKY || hasExported(v.model)`. Every other model keeps dev's direct path, with no key and no map entry.

2. **src/render/city/CityObjectsView.ts:253.** The new `this.effects.clear()` in rebuildAll also clears Effects.extras. Two disaster effects are set only once: meteor smoke and flame (Disasters.ts:301) and the fire/riot smoke column (Disasters.ts:163). On the packet hosts, a resync calls Replica.adopt, which raises 'reset' and then rebuildAll. A resync during one of those disasters therefore removes its smoke early. This is rare, because resyncs only happen on divergence or a packet gap. Tornado and quake dust are re-sent and recover. Fix: add `Effects.clearBuildings()`, which clears only emitters and plumes, and call it from rebuildAll. Keep `clear()` for full teardown.

3. **src/render/city/demo.ts:126, together with src/render/city/demoCity.ts:236.** demo-city.html and tools/shoot-city.mjs now show no smoke at all. Every demo building has `jobs: 0`, so all industry is under 10 % staffed, and demo.ts passes no getPlantLoad. Those pages can no longer be used to check smoke visuals. The game is not affected. Fix: staff the industrial and power defs in buildDemoCity (for example jobs = capacity), and pass a fixed `getPlantLoad: () => 0.8` in demo.ts.

4. **src/render/city/buildings/BuildingRenderer.ts:1808-1810.** A plant that delivers 0 MW still smokes at step 1 while its tile stays powered. Examples are a nuclear plant shut down by ordinance, or a thermal plant with no cooling water. UtilitiesSystem gives such a plant load 0, and activityOf then applies the 0.25 floor. This follows `max(0.25, load)` as written, and report round 1 item 6 documents it. It still goes against "smoke that reads output".
   - **Lead's call:** not a blocker.
   - **Preferred fix (cheap and sim-neutral, bot stays identical):** treat `UtilitiesSystem.producerInfo(id)?.output <= 0` as unavailable. That means returning null in localViews.utilities.plantLoad and -1 on the wire in recorder.utilitiesStream.
   - **If not done here:** record it in the report as a follow-up to do with T061.

5. **docs/dev/reports/local-T051-feel15-smoke.md, lines 3-5, 45-50 and 92-99.** The opening still says round 3 is uncommitted and that no round-3 tsc, test or bot result is claimed, and the round-3 checklist boxes are unticked. The final gate is recorded in one sentence, with no commands. Under NOTE-064 this report is the record behind the merge. Fix it in this lane (docs only): add a short closing status at the top. It should list commits 745fa6e, 51a04e0, 142c612 and 97691ad, say round 3 is committed and pushed, and give the gate results on 97691ad with their commands. Tick the round-3 items or point each one to the QA row that covers it.

## Acceptance

- **Industry activity = jobs filled / capacity, times powered:** met. `activityOf` returns 0 when not Powered, else `min(1, jobs/capacity)`. Every smoky catalog def is IA..IHT or a plant. QA #2: 51/51 buildings match on all three hosts.
- **Plant activity = max(0.25, the plant's share of grid load):** met. A null, negative or non-finite load gives 0, never full load. The load comes from UtilitiesView.plantLoad. smokeLocalHost uses real grids, and QA #3: load 0.153 gives step 1. The 0 MW case is minor 4.
- **Activity 0 when unpowered or under 10 % staffed:** met. This is checked before the plant path, and exactly 10 % counts as active. QA #2: 8 % gives 0, 11 % gives step 1, unpowered gives 0.
- **Four plume steps; rebuild only on a step change:** met. Step = `ceil(clamp(a)·4)`, and counts {0, 5, 9, 14, 18} are tested. The same key and step return early with no buffer upload. Step 0 zeroes the emitters in place.
- **Inputs come only from mirrored building state or UtilitiesView:** met. No src/sim reads. The CityScene caller is guarded with `in` and `?.()`. LoopbackSimHost, WorkerSimHost and protocolInbox are untouched.
- **Gate, the 0/340 refinery shows no smoke:** met. Covered by smokeActivity and smokePlumes. QA #1: 0 particles; dev shows 54.
- **Gate, the 15 % coal plant shows at most 40 % of full-load particles:** met. The floor gives step 1, which is 26.9-30 % for each emitter type. QA #3 and #3a: 27.8 % and 26.9 %.
- **Gate, at most one rebuild per building per month:** met. A positive step change rebuilds only when `previous.month !== v.activityMonth`. Lifecycle rebuilds bypass this by documented scope. QA #4: 423 rebuilds, never more than 1 per building-month. Reverting the guard fails 3 tests in smokePlumes.
- **Gate, tsc, full vitest, bot identical:** met as reported by the desktop on 97691ad. tsc is clean, vitest ran 243 files / 2,443 tests, and the bot gives [61124, 93804, 37971] = 192,899. The lane changes no sim, save or RNG code, so the bot result holds by construction. Neither reviewer re-ran the gates, per the rules. The record is thin; see minor 5.
- **NOTE-054, the stream is sent only on a >0.5 % change or a plant added/removed:** met. It is checked only at ready/resync or after a completed utilities pass, and measured against the last snapshot sent. QA #6 and #7: 0-6 streams per month. Removing the threshold fails 6 of 12 tests in plantLoadStream.
- **NOTE-054, a test shows an unchanged month sends nothing:** met. plantLoadStream.test.ts:90 fails when the threshold is reverted.
- **NOTE-054, (a)/(b)/(c)/(e) here, (d) left to T061, replica owns the map:** met. The map is cleared on adopt, replaced on each snapshot and kept when a packet omits the stream. The packet hosts are unedited, so until T061 plants show no plume there, as NOTE-054 allows.
- **Compatibility, old saves and packets:** met. There are no save changes. `Streams.utilities` is optional, and BuildingVisual's new fields have a single producer, which tsc enforces.
- **Test quality, the new tests fail when the fix is reverted:** met. Three single-hunk reverts each break their test file: smokeView fails 2 of 4, plantLoadStream 6 of 12 and smokePlumes 3 of 17.
