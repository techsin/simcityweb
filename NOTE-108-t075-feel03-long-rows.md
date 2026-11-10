# NOTE-108 (lead → desktop worker), 10 Nov: T075's dev merge stays with you; FEEL-03 is in dev; two long rows are in

## T075: you finish the dev merge (NOTE-099's cloud merge is withdrawn)

local/T075-camera-snap @ 16cc6d9 (09:45) shows your lane already part-way through the dev merge, with dev's docs
merged in. Taking it over would waste that work, so the cloud stands down. Finish it there, and fold in T096's three
ShowCamera lines now that T096 is in dev:

- ShowCamera.ts:292 `const key = n.ref?.first;`
- the :279 comment
- showCamera.test.ts:92
- skip `unique:rw_*`

**Since your snapshot, dev also has:**

- **FEEL-03 (afa1d24):** it edits src/game/CityScene.ts, src/game/tools/Tool.ts, src/ui/hud.css and src/ui/topbar/*.
  It adds src/ui/FloatText.ts, floatText.css and topbar/hudChip.ts, and re-records tests/game/fixtures/topBarTrace.json.
- **The botAaFundsNudge timeouts (336a957, NOTE-107).**

Expect CityScene.ts and the trace fixture to conflict. Re-record the fixture with `TOPBAR_TRACE=write`, and say which
diff remains. The cloud lands B11 (the top bar's `titleWithKey` titles) after T075 is in dev, and B13 after T084 and
T075.

## FEEL-03 is in dev (afa1d24); its Desktop QA follows in the next NOTE

It merged after a third full gate (332 files, 3,436 tests, 0 failed). The first two gates timed out only on
botAaFundsNudge, which NOTE-107 fixed. The bot is identical.

## The long dev rows (dev 05cbf59, 9 members each, at docs/dev/ensembles/long-05cbf59/)

| Row | 2060 median [min, max] | Stalled | Commit |
|---|---|---|---|
| s11 base | 1,470,385 [1,231,877, 1,516,658] | 1/9 | 4c69602 |
| s7 base | 1,408,250 [1,389,466, 1,524,813] | 0/9 | b6698ef |
| s7 `--skip dirty` | 1,426,781 [1,415,554, 1,439,154] | 0/9 | dd1793e |

s7 `--subway` finishes in about 30 minutes, and then T071's 9-member row runs on 27f9394. T044 and T045 can start
comparing against the three rows that are in.

## Cloud from here (1-2 tasks)

- T063's fix round is still running.
- FH-14, the next guide lane, starts now.
- T066 waits for T063 and T085 to be in dev.
