# Shared SIM A/A envelope (NOTE-048)

Measured commit: `0df76bce1a663ee44957cf47cfecdb8b18eed187` (branch `local/T062-sim-aa-envelope`). Host: `none`; independent node processes.

Source fingerprint: `0e0f3bbcf84081835fd39008f3d94fad8f3eb3ba19e5fd6db33f2d0ce6f9730b`. Source diff SHA256: `55d5a6a875e74d27ceb696ab68e6d939dc8aa1be4efeb304745f0ec91bb2c50f`.

The working tree includes the funds-nudge instrumentation; the commit identifies the underlying base. Dirty paths at measurement:

- `M tools/simbot.ts`
- `?? tests/sim/botAaFundsNudge.test.ts`
- `?? tools/simAaEnvelope.mts`

Completed runs: **6/6**. All pairs are complete.

The specified +§1 perturbation produces no divergence in the measured metrics on this base: **all twelve row/metric envelopes are exactly zero**, both absolutely and relatively. Annual funds are exactly §1 higher in every nudged run (all years, including years 1–9); the perturbation was applied. This result does not estimate a larger perturbation's fork noise. NOTE-048 therefore leaves these base bands at `max(the item's tolerance, ±1%)` for this measurement.

| Row | Base final population | +§1 final population | Base final funds | +§1 final funds |
|---|---:|---:|---:|---:|
| 128x15_s7 | 192899 | 192899 | 146349 | 146350 |
| 256x60_s7 | 1513835 | 1513835 | 14233559 | 14233560 |
| 256x60_s11 | 1427340 | 1427340 | 16451097 | 16451098 |

There are 270 full-precision annual observations in the raw files, and 108 year-pairs from year 10 in the tables below. A zero maximum ties every year; the envelope tables show the first tied year.

Metrics use the annual bot callback: population and approval from the bot row, air from `stats.avgAir` (the same metric as `tests/sim/balance.test.ts`),
and I-HT share = `jobsByDev[IHT] / (jobsByDev[ID] + jobsByDev[IM] + jobsByDev[IHT])`; agriculture is excluded. Shares are fractions.
Year 10 means the tenth completed year (2010), inclusive. The absolute envelope is `max |nudge − base|` over those years.
Its percentage uses the base value in the year of that maximum. The independent maximum annual relative percentage is also recorded; its peak can occur in another year.
A zero base with a nonzero delta has an infinite relative percentage. Display values have 12 significant digits; raw JSON/NDJSON retain full precision.

Each annual record also stores the timing-free bot row and its SHA256, residents, jobs by type and a canonical serialized-city SHA256.
State hashing sets only the copied save timestamp to zero, sorts object keys, and encodes typed arrays by constructor name and raw base64 bytes.

## Commands and raw evidence

Run from the selected tree (the runner writes only the explicit output/report destinations):

```powershell
node --experimental-strip-types 'C:\Users\techsin\Desktop\projects\simcityweb-T062\tools\simAaEnvelope.mts' --tree 'C:\Users\techsin\Desktop\projects\simcityweb-T062' --out-dir 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa' --report 'C:\Users\techsin\Desktop\projects\simcityweb-T062\docs\dev\reports\sim-aa-envelope.md' --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs'
```

Every actual child command below passes through the quiet gate. The adjacent simbot command is equivalent to the instrumented child's simulation options:

### 128x15_s7_base

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\aa-child.mjs' --aa-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\128x15_s7_base.spec.json'
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' npx tsx 'C:\Users\techsin\Desktop\projects\simcityweb-T062\tools\simbot.ts' --size 128 --years 15 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet
```

Raw: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/128x15_s7_base.json`; annual flush: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/128x15_s7_base.ndjson`; CLI-equivalent log: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/128x15_s7_base.log`.
Node v22.12.0; 2026-11-03T21:46:42.405Z → 2026-11-03T21:46:52.104Z; 9.6987833 seconds. Final residents: `[61124, 93804, 37971]`.

### 128x15_s7_plus1

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\aa-child.mjs' --aa-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\128x15_s7_plus1.spec.json'
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' npx tsx 'C:\Users\techsin\Desktop\projects\simcityweb-T062\tools\simbot.ts' --size 128 --years 15 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet --aa-funds-nudge 1
```

Raw: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/128x15_s7_plus1.json`; annual flush: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/128x15_s7_plus1.ndjson`; CLI-equivalent log: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/128x15_s7_plus1.log`.
Node v22.12.0; 2026-11-03T21:46:52.574Z → 2026-11-03T21:47:02.195Z; 9.6206239 seconds. Final residents: `[61124, 93804, 37971]`.

### 256x60_s7_base

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\aa-child.mjs' --aa-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\256x60_s7_base.spec.json'
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' npx tsx 'C:\Users\techsin\Desktop\projects\simcityweb-T062\tools\simbot.ts' --size 256 --years 60 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet
```

Raw: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s7_base.json`; annual flush: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s7_base.ndjson`; CLI-equivalent log: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s7_base.log`.
Node v22.12.0; 2026-11-03T21:47:02.818Z → 2026-11-03T21:50:24.638Z; 201.8195203 seconds. Final residents: `[412608, 738176, 363051]`.

### 256x60_s7_plus1

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\aa-child.mjs' --aa-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\256x60_s7_plus1.spec.json'
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' npx tsx 'C:\Users\techsin\Desktop\projects\simcityweb-T062\tools\simbot.ts' --size 256 --years 60 --seed 7 --difficulty medium --terrain plains --water 0.2 --quiet --aa-funds-nudge 1
```

Raw: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s7_plus1.json`; annual flush: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s7_plus1.ndjson`; CLI-equivalent log: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s7_plus1.log`.
Node v22.12.0; 2026-11-03T21:50:25.618Z → 2026-11-03T21:52:51.176Z; 145.5567124 seconds. Final residents: `[412608, 738176, 363051]`.

### 256x60_s11_base

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\aa-child.mjs' --aa-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\256x60_s11_base.spec.json'
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' npx tsx 'C:\Users\techsin\Desktop\projects\simcityweb-T062\tools\simbot.ts' --size 256 --years 60 --seed 11 --difficulty medium --terrain plains --water 0.2 --quiet
```

Raw: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s11_base.json`; annual flush: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s11_base.ndjson`; CLI-equivalent log: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s11_base.log`.
Node v22.12.0; 2026-11-03T21:52:51.907Z → 2026-11-03T21:55:34.334Z; 162.4266074 seconds. Final residents: `[388629, 696075, 342636]`.

### 256x60_s11_plus1

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\aa-child.mjs' --aa-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\aa\256x60_s11_plus1.spec.json'
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' npx tsx 'C:\Users\techsin\Desktop\projects\simcityweb-T062\tools\simbot.ts' --size 256 --years 60 --seed 11 --difficulty medium --terrain plains --water 0.2 --quiet --aa-funds-nudge 1
```

Raw: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s11_plus1.json`; annual flush: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s11_plus1.ndjson`; CLI-equivalent log: `../../../../../../AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/aa/256x60_s11_plus1.log`.
Node v22.12.0; 2026-11-03T21:55:35.019Z → 2026-11-03T21:58:16.243Z; 161.2234372 seconds. Final residents: `[388629, 696075, 342636]`.

## Envelope and annual pairs

### 128x15_s7

| Metric | Max absolute Δ | Year | Base there | Relative Δ there | Max annual relative Δ | Year |
|---|---:|---:|---:|---:|---:|---:|
| Population | 0 | 2010 | 99729 | 0% | 0% | 2010 |
| Mean air at homes | 0 | 2010 | 0.074013021175 | 0% | 0% | 2010 |
| Approval (points) | 0 | 2010 | 70.5454822917 | 0% | 0% | 2010 |
| I-HT industrial job share (fraction) | 0 | 2010 | 0 | 0% | 0% | 2010 |

| Year | Base pop | +§1 pop | Base air | +§1 air | Base approval | +§1 approval | Base I-HT share | +§1 I-HT share |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2010 | 99729 | 99729 | 0.074013021175 | 0.074013021175 | 70.5454822917 | 70.5454822917 | 0 | 0 |
| 2011 | 116996 | 116996 | 0.0762975017902 | 0.0762975017902 | 73.3377191709 | 73.3377191709 | 0 | 0 |
| 2012 | 134385 | 134385 | 0.0708048271401 | 0.0708048271401 | 75.0662775328 | 75.0662775328 | 0 | 0 |
| 2013 | 153902 | 153902 | 0.0778400375672 | 0.0778400375672 | 76.3292420144 | 76.3292420144 | 0 | 0 |
| 2014 | 172995 | 172995 | 0.0833283045672 | 0.0833283045672 | 78.3821382274 | 78.3821382274 | 0 | 0 |
| 2015 | 192899 | 192899 | 0.0908835924374 | 0.0908835924374 | 81.3650175025 | 81.3650175025 | 0 | 0 |

### 256x60_s7

| Metric | Max absolute Δ | Year | Base there | Relative Δ there | Max annual relative Δ | Year |
|---|---:|---:|---:|---:|---:|---:|
| Population | 0 | 2010 | 98300 | 0% | 0% | 2010 |
| Mean air at homes | 0 | 2010 | 0.0739850444917 | 0% | 0% | 2010 |
| Approval (points) | 0 | 2010 | 63.8519045379 | 0% | 0% | 2010 |
| I-HT industrial job share (fraction) | 0 | 2010 | 0 | 0% | 0% | 2010 |

| Year | Base pop | +§1 pop | Base air | +§1 air | Base approval | +§1 approval | Base I-HT share | +§1 I-HT share |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2010 | 98300 | 98300 | 0.0739850444917 | 0.0739850444917 | 63.8519045379 | 63.8519045379 | 0 | 0 |
| 2011 | 112214 | 112214 | 0.0601583915644 | 0.0601583915644 | 62.1163974625 | 62.1163974625 | 0 | 0 |
| 2012 | 128926 | 128926 | 0.0552751532608 | 0.0552751532608 | 63.1424208328 | 63.1424208328 | 0 | 0 |
| 2013 | 145044 | 145044 | 0.054735849427 | 0.054735849427 | 67.7892603094 | 67.7892603094 | 0 | 0 |
| 2014 | 162271 | 162271 | 0.0601129027154 | 0.0601129027154 | 66.4381073297 | 66.4381073297 | 0 | 0 |
| 2015 | 181278 | 181278 | 0.0565621396886 | 0.0565621396886 | 69.3903791891 | 69.3903791891 | 0 | 0 |
| 2016 | 200597 | 200597 | 0.0578913055256 | 0.0578913055256 | 70.1598871862 | 70.1598871862 | 0 | 0 |
| 2017 | 219921 | 219921 | 0.0620043357323 | 0.0620043357323 | 70.2317655245 | 70.2317655245 | 0 | 0 |
| 2018 | 240425 | 240425 | 0.0624139781013 | 0.0624139781013 | 69.9960738892 | 69.9960738892 | 0 | 0 |
| 2019 | 261862 | 261862 | 0.0580984232595 | 0.0580984232595 | 70.8859047855 | 70.8859047855 | 0 | 0 |
| 2020 | 283841 | 283841 | 0.0561423982413 | 0.0561423982413 | 72.5456527563 | 72.5456527563 | 0 | 0 |
| 2021 | 307765 | 307765 | 0.0561130323232 | 0.0561130323232 | 73.9583321142 | 73.9583321142 | 0 | 0 |
| 2022 | 330779 | 330779 | 0.0546999219558 | 0.0546999219558 | 75.9606356589 | 75.9606356589 | 0 | 0 |
| 2023 | 354200 | 354200 | 0.0592411972196 | 0.0592411972196 | 76.342032398 | 76.342032398 | 0 | 0 |
| 2024 | 378985 | 378985 | 0.0612263226049 | 0.0612263226049 | 75.4614011897 | 75.4614011897 | 0 | 0 |
| 2025 | 404262 | 404262 | 0.0611682600552 | 0.0611682600552 | 77.065802537 | 77.065802537 | 0 | 0 |
| 2026 | 432145 | 432145 | 0.0627063337354 | 0.0627063337354 | 77.201767656 | 77.201767656 | 0 | 0 |
| 2027 | 460757 | 460757 | 0.0644352592731 | 0.0644352592731 | 78.2094524809 | 78.2094524809 | 0 | 0 |
| 2028 | 489700 | 489700 | 0.0662124312463 | 0.0662124312463 | 77.9452588346 | 77.9452588346 | 0 | 0 |
| 2029 | 519724 | 519724 | 0.0710718581218 | 0.0710718581218 | 78.535558838 | 78.535558838 | 0 | 0 |
| 2030 | 550399 | 550399 | 0.0757641322725 | 0.0757641322725 | 79.881255312 | 79.881255312 | 0 | 0 |
| 2031 | 580940 | 580940 | 0.0822221449947 | 0.0822221449947 | 81.3426041265 | 81.3426041265 | 0 | 0 |
| 2032 | 613567 | 613567 | 0.0833016719808 | 0.0833016719808 | 82.2056823218 | 82.2056823218 | 0 | 0 |
| 2033 | 646596 | 646596 | 0.0866347129278 | 0.0866347129278 | 82.4035368299 | 82.4035368299 | 0 | 0 |
| 2034 | 678863 | 678863 | 0.0953405191024 | 0.0953405191024 | 82.7216193094 | 82.7216193094 | 0 | 0 |
| 2035 | 711503 | 711503 | 0.0967528291132 | 0.0967528291132 | 82.3212765252 | 82.3212765252 | 0 | 0 |
| 2036 | 745163 | 745163 | 0.104260484687 | 0.104260484687 | 81.6550759309 | 81.6550759309 | 0 | 0 |
| 2037 | 778371 | 778371 | 0.111184867164 | 0.111184867164 | 82.1080479323 | 82.1080479323 | 0 | 0 |
| 2038 | 814131 | 814131 | 0.113757455394 | 0.113757455394 | 81.8263275001 | 81.8263275001 | 0 | 0 |
| 2039 | 848978 | 848978 | 0.125735778555 | 0.125735778555 | 81.6680640579 | 81.6680640579 | 0 | 0 |
| 2040 | 885236 | 885236 | 0.132807427482 | 0.132807427482 | 82.6186158782 | 82.6186158782 | 0 | 0 |
| 2041 | 922651 | 922651 | 0.134063531203 | 0.134063531203 | 82.6850781617 | 82.6850781617 | 0 | 0 |
| 2042 | 953459 | 953459 | 0.137795632176 | 0.137795632176 | 81.7318925805 | 81.7318925805 | 0 | 0 |
| 2043 | 990285 | 990285 | 0.147602957846 | 0.147602957846 | 81.4184619882 | 81.4184619882 | 0 | 0 |
| 2044 | 1029252 | 1029252 | 0.147342438296 | 0.147342438296 | 81.5077523582 | 81.5077523582 | 0 | 0 |
| 2045 | 1066213 | 1066213 | 0.155903303419 | 0.155903303419 | 80.9601454361 | 80.9601454361 | 0 | 0 |
| 2046 | 1103538 | 1103538 | 0.158856001761 | 0.158856001761 | 80.8512483237 | 80.8512483237 | 0 | 0 |
| 2047 | 1139240 | 1139240 | 0.165945846636 | 0.165945846636 | 79.775902191 | 79.775902191 | 0 | 0 |
| 2048 | 1186078 | 1186078 | 0.155345502961 | 0.155345502961 | 80.4586668362 | 80.4586668362 | 0 | 0 |
| 2049 | 1222311 | 1222311 | 0.166970501919 | 0.166970501919 | 80.9511105372 | 80.9511105372 | 0 | 0 |
| 2050 | 1265741 | 1265741 | 0.167177882126 | 0.167177882126 | 80.8282333843 | 80.8282333843 | 0 | 0 |
| 2051 | 1306287 | 1306287 | 0.172646983238 | 0.172646983238 | 80.7534327958 | 80.7534327958 | 0.00592249012918 | 0.00592249012918 |
| 2052 | 1347980 | 1347980 | 0.165388201505 | 0.165388201505 | 80.6369747076 | 80.6369747076 | 0.00814035221034 | 0.00814035221034 |
| 2053 | 1392709 | 1392709 | 0.162583798599 | 0.162583798599 | 80.7548470143 | 80.7548470143 | 0.00956450956451 | 0.00956450956451 |
| 2054 | 1413703 | 1413703 | 0.166730635037 | 0.166730635037 | 80.5938057518 | 80.5938057518 | 0.0236319752152 | 0.0236319752152 |
| 2055 | 1433758 | 1433758 | 0.170764696709 | 0.170764696709 | 79.0876602917 | 79.0876602917 | 0.0366587441133 | 0.0366587441133 |
| 2056 | 1455861 | 1455861 | 0.179043508252 | 0.179043508252 | 80.0662775043 | 80.0662775043 | 0.0559334779715 | 0.0559334779715 |
| 2057 | 1470002 | 1470002 | 0.173427477068 | 0.173427477068 | 80.4826074625 | 80.4826074625 | 0.0740231723265 | 0.0740231723265 |
| 2058 | 1488790 | 1488790 | 0.17540397003 | 0.17540397003 | 80.0913343012 | 80.0913343012 | 0.0895362510269 | 0.0895362510269 |
| 2059 | 1504810 | 1504810 | 0.17442361977 | 0.17442361977 | 79.8836708941 | 79.8836708941 | 0.0939054034731 | 0.0939054034731 |
| 2060 | 1513835 | 1513835 | 0.178626333759 | 0.178626333759 | 80.3574246959 | 80.3574246959 | 0.10239866758 | 0.10239866758 |

### 256x60_s11

| Metric | Max absolute Δ | Year | Base there | Relative Δ there | Max annual relative Δ | Year |
|---|---:|---:|---:|---:|---:|---:|
| Population | 0 | 2010 | 97469 | 0% | 0% | 2010 |
| Mean air at homes | 0 | 2010 | 0.065350349494 | 0% | 0% | 2010 |
| Approval (points) | 0 | 2010 | 64.5131653156 | 0% | 0% | 2010 |
| I-HT industrial job share (fraction) | 0 | 2010 | 0 | 0% | 0% | 2010 |

| Year | Base pop | +§1 pop | Base air | +§1 air | Base approval | +§1 approval | Base I-HT share | +§1 I-HT share |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2010 | 97469 | 97469 | 0.065350349494 | 0.065350349494 | 64.5131653156 | 64.5131653156 | 0 | 0 |
| 2011 | 111424 | 111424 | 0.0580437408479 | 0.0580437408479 | 63.4003528592 | 63.4003528592 | 0 | 0 |
| 2012 | 126476 | 126476 | 0.0544750470377 | 0.0544750470377 | 63.5637266137 | 63.5637266137 | 0 | 0 |
| 2013 | 143996 | 143996 | 0.0520217003319 | 0.0520217003319 | 63.6206172189 | 63.6206172189 | 0 | 0 |
| 2014 | 163210 | 163210 | 0.0522545755233 | 0.0522545755233 | 70.2355302508 | 70.2355302508 | 0 | 0 |
| 2015 | 182428 | 182428 | 0.0514671112541 | 0.0514671112541 | 70.8877589306 | 70.8877589306 | 0 | 0 |
| 2016 | 202147 | 202147 | 0.0522574326203 | 0.0522574326203 | 72.3115621325 | 72.3115621325 | 0 | 0 |
| 2017 | 221560 | 221560 | 0.0573060732476 | 0.0573060732476 | 72.3716101346 | 72.3716101346 | 0 | 0 |
| 2018 | 241641 | 241641 | 0.0563750850087 | 0.0563750850087 | 73.1531831645 | 73.1531831645 | 0 | 0 |
| 2019 | 264481 | 264481 | 0.0556510217607 | 0.0556510217607 | 74.3239597793 | 74.3239597793 | 0 | 0 |
| 2020 | 287234 | 287234 | 0.0557169253613 | 0.0557169253613 | 76.4404919454 | 76.4404919454 | 0 | 0 |
| 2021 | 310168 | 310168 | 0.0547470670098 | 0.0547470670098 | 77.7540836674 | 77.7540836674 | 0 | 0 |
| 2022 | 332224 | 332224 | 0.0584134414695 | 0.0584134414695 | 77.3706823023 | 77.3706823023 | 0 | 0 |
| 2023 | 356520 | 356520 | 0.0611642692479 | 0.0611642692479 | 77.9120360245 | 77.9120360245 | 0 | 0 |
| 2024 | 381058 | 381058 | 0.0632593138714 | 0.0632593138714 | 78.1691956093 | 78.1691956093 | 0 | 0 |
| 2025 | 406789 | 406789 | 0.0629129261695 | 0.0629129261695 | 78.0048748875 | 78.0048748875 | 0 | 0 |
| 2026 | 432624 | 432624 | 0.0670506912252 | 0.0670506912252 | 78.2446253242 | 78.2446253242 | 0 | 0 |
| 2027 | 459464 | 459464 | 0.0657421438106 | 0.0657421438106 | 78.0884129186 | 78.0884129186 | 0 | 0 |
| 2028 | 489945 | 489945 | 0.0630358514868 | 0.0630358514868 | 80.1594304101 | 80.1594304101 | 0 | 0 |
| 2029 | 520692 | 520692 | 0.0636400710001 | 0.0636400710001 | 81.6009226435 | 81.6009226435 | 0 | 0 |
| 2030 | 551235 | 551235 | 0.0677812627025 | 0.0677812627025 | 81.4590017164 | 81.4590017164 | 0 | 0 |
| 2031 | 582733 | 582733 | 0.0701001861004 | 0.0701001861004 | 82.2232143329 | 82.2232143329 | 0 | 0 |
| 2032 | 614845 | 614845 | 0.0724190332987 | 0.0724190332987 | 82.3868309707 | 82.3868309707 | 0 | 0 |
| 2033 | 647575 | 647575 | 0.0757977680989 | 0.0757977680989 | 82.3619177508 | 82.3619177508 | 0 | 0 |
| 2034 | 679334 | 679334 | 0.0827262118302 | 0.0827262118302 | 82.9694498342 | 82.9694498342 | 0 | 0 |
| 2035 | 713490 | 713490 | 0.0854047246629 | 0.0854047246629 | 82.8921472633 | 82.8921472633 | 0 | 0 |
| 2036 | 746748 | 746748 | 0.0919302300019 | 0.0919302300019 | 83.8068783412 | 83.8068783412 | 0 | 0 |
| 2037 | 780557 | 780557 | 0.0981501369686 | 0.0981501369686 | 83.1437641225 | 83.1437641225 | 0 | 0 |
| 2038 | 815501 | 815501 | 0.102178297807 | 0.102178297807 | 82.9540376397 | 82.9540376397 | 0 | 0 |
| 2039 | 850651 | 850651 | 0.107450141015 | 0.107450141015 | 82.8090936591 | 82.8090936591 | 0 | 0 |
| 2040 | 888193 | 888193 | 0.113307293426 | 0.113307293426 | 83.0747485967 | 83.0747485967 | 0 | 0 |
| 2041 | 921632 | 921632 | 0.123881921098 | 0.123881921098 | 82.7341033392 | 82.7341033392 | 0 | 0 |
| 2042 | 958822 | 958822 | 0.126086734444 | 0.126086734444 | 82.3437330942 | 82.3437330942 | 0 | 0 |
| 2043 | 993905 | 993905 | 0.129741976511 | 0.129741976511 | 81.6238087259 | 81.6238087259 | 0 | 0 |
| 2044 | 1031139 | 1031139 | 0.127841465029 | 0.127841465029 | 81.6738854807 | 81.6738854807 | 0 | 0 |
| 2045 | 1068216 | 1068216 | 0.134717231435 | 0.134717231435 | 81.3672525062 | 81.3672525062 | 0 | 0 |
| 2046 | 1109143 | 1109143 | 0.135719597588 | 0.135719597588 | 81.3922144238 | 81.3922144238 | 0 | 0 |
| 2047 | 1147425 | 1147425 | 0.138409774208 | 0.138409774208 | 81.4479538941 | 81.4479538941 | 0 | 0 |
| 2048 | 1186527 | 1186527 | 0.142596638453 | 0.142596638453 | 81.4228326633 | 81.4228326633 | 0 | 0 |
| 2049 | 1225495 | 1225495 | 0.145552599512 | 0.145552599512 | 81.0957329846 | 81.0957329846 | 0 | 0 |
| 2050 | 1272103 | 1272103 | 0.140626416381 | 0.140626416381 | 80.9499364094 | 80.9499364094 | 0 | 0 |
| 2051 | 1313026 | 1313026 | 0.146472679267 | 0.146472679267 | 80.4217985169 | 80.4217985169 | 0.0100193668234 | 0.0100193668234 |
| 2052 | 1354608 | 1354608 | 0.143862404618 | 0.143862404618 | 80.6428101102 | 80.6428101102 | 0.0108910310306 | 0.0108910310306 |
| 2053 | 1372356 | 1372356 | 0.142825009073 | 0.142825009073 | 81.1771549768 | 81.1771549768 | 0.0244613470833 | 0.0244613470833 |
| 2054 | 1388950 | 1388950 | 0.143359957365 | 0.143359957365 | 80.4236104261 | 80.4236104261 | 0.0316264226817 | 0.0316264226817 |
| 2055 | 1386414 | 1386414 | 0.144885651148 | 0.144885651148 | 80.7403544601 | 80.7403544601 | 0.0406296878671 | 0.0406296878671 |
| 2056 | 1400344 | 1400344 | 0.144751544239 | 0.144751544239 | 80.4208527847 | 80.4208527847 | 0.0479925961835 | 0.0479925961835 |
| 2057 | 1403945 | 1403945 | 0.145909746932 | 0.145909746932 | 81.1171802385 | 81.1171802385 | 0.0605594441453 | 0.0605594441453 |
| 2058 | 1414561 | 1414561 | 0.142471353527 | 0.142471353527 | 80.7983833485 | 80.7983833485 | 0.0762453855407 | 0.0762453855407 |
| 2059 | 1416617 | 1416617 | 0.147304497255 | 0.147304497255 | 80.1027854209 | 80.1027854209 | 0.0910363244426 | 0.0910363244426 |
| 2060 | 1427340 | 1427340 | 0.147485057472 | 0.147485057472 | 81.3566945637 | 81.3566945637 | 0.103251506482 | 0.103251506482 |

## How SIM lanes use this (NOTE-048)

A base row passes within `max(the item’s tolerance, ±1%, this row/metric’s absolute A/A envelope)` in every year from year 10; convert a percentage tolerance using that year’s base value. The systematic-shift check still applies.
A variant target missed by less than the metric’s A/A envelope counts as met when the direction also holds on the other seed; report the margin. A miss larger than the envelope remains a miss.
This does not authorize compensating residential growth, weakening costs, free approval, re-recording a baseline to hide a miss, or changing the default bot strategy.

## Re-measure after T041 (NEW-05 option B)

Use the same script with the dev tree containing T041 and this flag. Choose a fresh output directory and a separate report so the two bases remain distinguishable:

```powershell
node --experimental-strip-types 'C:\Users\techsin\Desktop\projects\simcityweb-T062\tools\simAaEnvelope.mts' --tree PATH_TO_DEV_WITH_T041 --out-dir FRESH_T041_SCRATCH --report T041_ENVELOPE_REPORT.md --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs'
```

SIM lanes measure their final gates against that second envelope. To rebuild either table from its completed JSON, repeat its runner command with `--report-only`.

## Flags-off identity and gates

The underlying dev is `9fcc2ec`; HEAD `0df76bc` adds only the queued task. The task's `683d02b` base label is stale. No simulation formulas, difficulty rules, strategy thresholds, saved keys, or RNG calls changed.

A separate process was bundled and run **before editing** `tools/simbot.ts`, then compared with the measured flags-off 128×15 s7 process. Every non-timing yearly row field and all 15 canonical serialized-city hashes match exactly. CPU timing columns are observations, not deterministic state. Both processes end with residents `[61124, 93804, 37971]` = **192,899**.

Pre-edit commands (the probe imports the unmodified worktree and uses the same hash algorithm described above):

```powershell
node_modules/.bin/rolldown.cmd C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/beforeAa.mts --platform node --format esm --dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/before-bundle
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/before-bundle/beforeAa.js C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/before-aa.json
```

| Year | Population, both processes | State SHA256, both processes |
|---:|---:|---|
| 2001 | 3587 | `de8002cc606ab2694a42ac3533f3aa41337a93bbc2f423c8aac946de7962f9b3` |
| 2002 | 9297 | `1239b9b441253bce71efd0f96947c85ef0bcecd747d80a7264b0db1448ada99f` |
| 2003 | 17010 | `a54657498412826b6fa38d5bb10c484fac872a3602d25dc3f8a05bc50db17652` |
| 2004 | 25619 | `e3c87e28b1fb67786f29689c1e582a864ad3088967fd733302a7d951a59e6368` |
| 2005 | 34686 | `4fc4e5862d51ef336978e4c87ee66e072c6b13cbda37d5b38226afdce404b8c7` |
| 2006 | 45074 | `7fe3ff7fc255a841454e34b3de3ff66fd62aaf07050acec8aee74381a9a6a38c` |
| 2007 | 56442 | `80bf5992366712307378979e8b76d8699abfbdcbc751db9f89c33438812005d9` |
| 2008 | 69984 | `f26b56c0c8198308c1ad9e9365b5e3656cf4e71af1a09d5cca6e94265a348c67` |
| 2009 | 84409 | `685ca1883d270bc4cf5fca05b28785e41b4a55c0b4cd9d417436e5a7f691c043` |
| 2010 | 99729 | `ae136b53f357824582295685ccdb67f1c2ad9a9253f0f6695e1eadfb3c9c4bc4` |
| 2011 | 116996 | `a3669c9573813ba092440c8cfbaac31e8ea2fe915d45c76021d18bce5a9a940b` |
| 2012 | 134385 | `63685aae170d5b81bf975159b928100739b52465c230b0f6e418f66b580633d1` |
| 2013 | 153902 | `bb200b0cf42ac458fe6c9918309edb16cef398d4e3fe1079cd5fd2a5b27e1d45` |
| 2014 | 172995 | `236c5a959e3bdf6cea5ccb7cede57a7179a2812e47a7707d00b8e163a1ab860a` |
| 2015 | 192899 | `3cecb44dbd20ff5d5b8f669de8ed3d7becfc2f3477c1545e8c03b89f4c679532` |

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | Pass after all code changes |
| `tests/sim/botAaFundsNudge.test.ts` | 11 passed; signed/zero/invalid inputs, first-day funds-only state, RNG isolation, once-only behavior, flags-off/zero identity |
| `tests/sim/botLongGame.test.ts` | 28 passed |
| Flags-off 128×15 s7 | 15/15 yearly hashes and non-timing rows identical; 192,899 |
| Six runs | All complete, exit 0, same simulation source fingerprint |
| Independent envelope check | All four absolute maxima are 0 on all three rows; annual funds deltas are [1, 1] on every pair |
| `--report-only` regeneration | Identical generated report content; no simulations rerun |

`tsx` is absent and restricted npm cannot fetch it (`ENOTCACHED`). The runner uses the local Rolldown fallback documented in `tools/balance-json.ts`. Actual child commands and equivalent simbot commands are both recorded above.

The ordinary Vitest invocation cannot load Vite's config in this sandbox (`spawn EPERM`). Both files pass using the installed native loader and thread pool, each run separately through the quiet gate:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/vitest/vitest.mjs run tests/sim/botAaFundsNudge.test.ts --maxWorkers=1 --configLoader native --pool threads
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/vitest/vitest.mjs run tests/sim/botLongGame.test.ts --maxWorkers=1 --configLoader native --pool threads
```

No full suite, browser, GPU timing, separate Hard hashes or old-save continuation was run. T062 has no browser acceptance checks. The post-T041 remeasurement remains for the worker, using the command above with that dev tree and a fresh output directory. For reproducible comparisons, keep the same runner and dependencies; use a fresh output directory after changing measurement code.

The session's no-commit/no-push/no-`.done` rule overrides the queued task's final push instruction. There are no infra hunks, cloud-held edits or cloud requests. See [the lane handoff](local-T062-sim-aa-envelope.md).

