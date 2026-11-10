# T037 (topbar): the round-1 TopBar split (POLISH_PLAN §7.3, §7.4)

## Cloud carry-over (Nov 3)

The desktop was unavailable (NOTE-044), so the cloud's guide chain runs this new lane on `cloud/topbar`, from dev
`7348e09` (T037b merged at `b1fc37b`). No `local/*` branch holds any of it: the desktop never started the split
(NOTE-035 and NOTE-037 held it for the reset, NOTE-038 started it "after T030 merges", NOTE-044 to NOTE-047 give it to
the cloud).

### Gap list (required against done, written before any new work)

**Read:** docs/dev/queue/T037-polish-r1-guide.md; every NOTE that names T037 (035, 037, 038, 040, 042, 043, 044, 045,
046, 047, 048, 050, 051, 053, 056, 057, 059, 060, 061, 063, 064) and NOTE-044; the lead-notes branch's NOTE-067, 069,
073 and 075 (the ones that name the split); docs/dev/handoff/2026-11-04/README.md; POLISH_PLAN §4 (headings), §7.1-§7.6
and §8.0-§8.1 in full; T030's task file and report (docs/dev/queue/T030-ui-frame-cost.md,
docs/dev/reports/local-T030-ui-frame.md); T037a's report on `local/R1-guide-a` for what it will wire into the split.
There is no lane report and no lane diff to read: the lane starts from dev.

| # | Required | Where it comes from | Done at start |
|---|---|---|---|
| 1 | Split `src/ui/TopBar.ts` into a shell plus one component per segment under `src/ui/topbar/**`, so META, CONTENT and GUIDE stop editing the same `buildCenter` and `update()` | T037 "First, the TopBar split"; §7.3's TopBar row; §7.4 "Interfaces land first" | no |
| 2 | The segments follow §7.3's owners: META the shell, `buildLeft` (city name, mayor, difficulty, date) and the LIVE pill title; CONTENT the population segment; GUIDE the funds, RCI and approval segments, their popovers and coach marks, and the focus handlers | §7.2 GUIDE bullet; §7.3 | no |
| 3 | Change no behaviour. Keep T030's throttling (CityScene's ~6 Hz HUD tick, the refresh when the camera stops) and its frame-cost work (transform-scaled demand fills, no style write for an unchanged value, cached innerHTML, no layout reads in the update, no `will-change`) exactly | the lead's brief for this lane; T030 | no |
| 4 | The HUD is pixel-identical at rest and while the camera moves | the lead's brief; NOTE-061 §1 (the TopBar split's browser line) | no |
| 5 | Every importer keeps working: CityScene (`TopBar`), BudgetPanel (`isOneOff`, `sumOneOff`, `sumRecurring`), AdvisorsPanel (`lastNet`), InfoPanel (`DEV_NAMES`) | the current imports | n/a |
| 6 | Move or adapt the tests: topBarFrame.test.ts, approvalHud.test.ts and rciGuide.test.ts (`bar['issuesWatch']` reads a private field that moves), toastBudget.test.ts (reads `src/ui/TopBar.ts` for the demand-cap toast) | the lead's brief | no |
| 7 | Leave the hooks later lanes need in the right component: T037a's `GuideHooks.mark` wiring (NOTE-048 item 3, after the split reaches dev), FH-08's LIVE-title hunk "written against src/ui/topbar/**" (NOTE-048, NOTE-069), FH-23's focus handlers (NOTE-067), CONTENT's rank line. Their code is theirs: this lane adds none of it | NOTE-048, NOTE-067, NOTE-069 | n/a |
| 8 | Gates: tsc, the full vitest (with the Worker hygiene test, §8.1 check 1), the lane's tests; the bot only if src/sim, src/worker, src/game or src/save change | T037 gates; the lead's brief | no |
| 9 | The browser check (the HUD pixel-identical at rest and while moving) | NOTE-059 §3 kept the split's planned browser checks; NOTE-061 §1 (later, 9 Nov) moved every browser check, this split's by name, to the desktop's real GPU, and `lock.sh` refuses browser runs on the cloud | no |
| 10 | Report with this section, the `.done` line, everything committed on `cloud/topbar` | the lead's brief | no |

**Not this lane's:** T037 (a)-(e) and their acceptance (other sub-lanes; b, c and d are in dev, a and e are the
desktop's); §8.1's checks 2-10 (sim hashes, newcomer targets, pacing, spring start, storage, performance on the y20
save, personas) concern items this refactor does not touch; it changes no sim outcome and no file the bot runs.
