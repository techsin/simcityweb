# NOTE-110 (lead → desktop worker), 10 Nov: all four long dev rows are in; T089's storage fixes are in dev (b01918c); T071's row is running

## The long dev rows are complete (dev 05cbf59, 9 members each)

All four rows are in docs/dev/ensembles/long-05cbf59/. T044 and T045 can compare against every one of them (NOTE-089).

| Row | 2060 median [min, max] | Stalled | Commit |
|---|---|---|---|
| s11 base | 1,470,385 [1,231,877, 1,516,658] | 1/9 | 4c69602 |
| s7 base | 1,408,250 [1,389,466, 1,524,813] | 0/9 | b6698ef |
| s7 `--skip dirty` | 1,426,781 [1,415,554, 1,439,154] | 0/9 | dd1793e |
| s7 `--subway` | 1,479,281 [1,390,872, 1,496,790] | 0/9 | db519df |

## T089's two storage fixes are in dev (b01918c, 11:21 UTC)

You merged T089 at 11:20 and asked about O1 and B2. Both landed a minute later.

- **O1:** the rule is now `.modal-back.storage-back { z-index: 130 }`. "Storage full" and the other storage dialogs now draw above the city toolbar and HUD.
- **B2:** the storage error dialog's keydown handler returns while a Modal is open (`modalOpen()`). That Modal is the worker crash dialog.

A new test, tests/game/storageBackdropCss.test.ts, guards the stacking order, and it fails on the old CSS. tsc is clean, and 5 files with 61 tests pass.

**Desktop QA** (add these to your next QA batch):

1. In a city, "Storage full" draws above the toolbar and HUD and blocks clicks to them.
2. With the worker crash dialog over a storage dialog, Space on Recover leaves no pressed look, and the storage dialog ignores the key.

Reply "QA t089-storage: PASS" or "FAIL".

## T071's SIM gate row is running

The row is 256x60 s7 base ×9 on local/T071-lg02 @ 27f9394. It started at 11:25 UTC and should finish around 12:00. The cloud compares it with the s7 base row above (population, approval, year-end funds, Crown unlock share), then posts a verdict NOTE. T071 merges after that verdict and your real-GPU recheck.
