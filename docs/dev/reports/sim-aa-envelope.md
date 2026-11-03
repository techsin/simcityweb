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


## Fork-noise envelopes

Measured on commit `3833c8d2379d3350663e624fe30be7867c559310` in `C:/Users/techsin/Desktop/projects/simcityweb-T062`, with **no simulation, bot, flag, or committed-runner edits**. This is an appended measurement section; the original +§1 result and all balance fixtures remain unchanged. Command blocks below use that working directory. The full original `say()` log and a successful-command journal are saved for every run; the CLI-equivalent commands reproduce simulation options, while `SIMBOT_LOG=1` is needed to print the CLI's full text log.

Round 2 measurement; generated from **17 completed runs**. All twelve day-1 grid runs and their three bases are present.

Original-control verification: **135 annual state hashes and 135 non-timing yearly rows** checked against the original raw controls (128x15_s7: 15/15; 256x60_s7: 60/60; 256x60_s11: 60/60). Counts require the recorded `baseMatchesCommittedRows: true` result; no unrecorded comparison is inferred.

Use +§10 on day 1 as the common probe: it is the smallest tested nudge that changes the successful action trace on all three rows. This is a measured grid minimum, not the exact threshold. Prefer it to a larger endowment; carry the row/metric envelopes measured for that nudge and revalidate the fork on each new base.

Against the recommended probe sizes, +§10,000 has larger maximum drift in 8/12 row/metric comparisons, smaller drift in 4, and equal drift in 0. The tables retain the complete size response rather than assuming the envelope scales with the endowment.

**The recommended probe sample itself has a common negative population endpoint shift under this diagnostic:** all three endpoints move in the same direction by more than half their diagnostic bands. This requires investigation before treating the calibration as unbiased fork noise. The minimal tested common nudge remains the proposed probe because it demonstrably forks all rows, but its envelope is empirical sensitivity evidence, not proof of unbiased noise.

The successful action trace establishes whether the bot takes a different spending path. A +§1 first-day endowment did not do so on the original measurement. These probes keep simulation formulas, strategy and RNG call sites unchanged, but add purchasing power: the observed envelope combines path sensitivity with any direct endowment effect. It is an empirical bound for these runs, not a confidence interval or a proof of pure noise. A larger nudge need not produce monotonically larger drift.

The first action difference below is the first differing **successful, non-preview CityActions call** in the ordered trace (unchanged tax/funding calls omitted); failed calls and private branch choices are not captured. First logged decision is a separate longest-common-prefix comparison of the complete `say()` log, which does not log every action. An inserted or omitted event is paired with the next event in the other trace. Indices are one-based. Run year is `ceil(day / 360)`; year 0 denotes setup. Calendar dates are copied from the bot.

Annual metrics use the same callback and definitions as the original section: `stats.avgAir` (balance-test air), approval points, and I-HT jobs divided by I-D + I-M + I-HT jobs; agriculture is excluded. With no industrial jobs the share is 0. Year 10 means 2010, inclusive. I-HT shares and deltas are fractions (multiply by 100 for percentage points). Relative delta is `100 × |Δ| / |base|`; zero/zero is 0%, while nonzero/zero is ∞ and the absolute fraction or point delta is the usable magnitude. Max absolute drift and max relative drift can peak in different years. Tables show 12 significant digits; linked JSON preserves full precision.

| Row | Completed grid nudges | Smallest tested forking day-1 nudge | First action / first logged decision | First annual metric difference | Final population (base → smallest fork) |
|---|---|---:|---|---|---|
| 128x15_s7 | +§10, +§100, +§1000, +§10000 | +§10 | day 3720; May 2010; run year 11 (#1189) / day 3720; May 2010; run year 11; calendar year 2010 (#667) | 2011 | 192899 → 191754 |
| 256x60_s7 | +§10, +§100, +§1000, +§10000 | +§10 | day 4260; Nov 2011; run year 12 (#1566) / day 4260; Nov 2011; run year 12; calendar year 2011 (#828) | 2012 | 1513835 → 1287517 |
| 256x60_s11 | +§10, +§100, +§1000, +§10000 | +§10 | day 4590; Oct 2012; run year 13 (#1613) / day 4590; Oct 2012; run year 13; calendar year 2012 (#833) | 2013 | 1427340 → 1362916 |

### The recommended +§10 probe

These are the maximum absolute differences from the unchanged base over completed years 10 onward. I-HT is shown in percentage points here; the detailed tables below use fractions.

| Row | Population | Air at homes | Approval points | I-HT percentage points |
|---|---:|---:|---:|---:|
| 128x15_s7 | 1145 | 0.00266070191745 | 0.361220387898 | 0 |
| 256x60_s7 | 226318 | 0.0295162286014 | 2.40551675511 | 9.37275261713 |
| 256x60_s11 | 64424 | 0.0176448591177 | 2.1341464291 | 5.84628832132 |

First successful-action forks for this probe:

- **128×15 s7, day 3,720 (May 2010, city year 11):** the base proceeds to commercial rezoning; +§10 clears a small lot for a Bus Stop. The first differing text-log entries are “built 1 bus stop” versus “cleared 1 small lots for Bus Stop ($150)”.
- **256×60 s7, day 4,260 (November 2011, city year 12):** +§10 clears a small lot for a Playground; the base’s next successful action is road work for a residential block on day 4,290 (December).
- **256×60 s11, day 4,590 (October 2012, city year 13):** +§10 buys the Mayor’s Statue; the base’s next successful action is a Recycling Center on day 4,620 (November).

All four tested day-1 sizes fork every row. The four-size grid establishes the smallest **tested** size, not the exact integer threshold between §1 and §10.

The cheap timing experiment is limited to **128×15 s7**. +§10 on day 1,800 has identical full successful-command and text-log sequences, and identical annual population/air/approval/I-HT metrics, to +§10 on day 1. On day 4,320 it has identical command/log sequences and metrics to the unnudged base through year 15: this later pulse misses the earlier fork. Its funds are exactly §10 higher at each checkpoint from year 12. Thus delaying a probe can leave the fork unchanged or fail to create one; the later-day results do not establish a timing envelope for the 256×60 rows.

### Calibration direction diagnostic

NOTE-048’s systematic-shift rule applies to item gates. Applying a related calculation to this calibration is a **diagnostic, not an extra acceptance gate**. No item-specific tolerance is supplied here: the endpoint band is `max(1% × base final population, population envelope from year 10)`; the threshold below is half that band. Signed endpoint percentages use the unnudged final population. A common direction across these three deterministic rows is a reason to investigate, not an estimate of statistical bias.

| Row | Recommended nudge / day | Base final pop | Probe final pop | Signed endpoint Δ | Signed endpoint Δ% | Population envelope | Diagnostic band (1% floor) | Half band | Absolute endpoint Δ > half band? |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 128x15_s7 | +§10 / 1 | 192899 | 191754 | -1145 | -0.593574875971% | 1145 | 1928.99 | 964.495 | yes |
| 256x60_s7 | +§10 / 1 | 1513835 | 1287517 | -226318 | -14.9499780359% | 226318 | 226318 | 113159 | yes |
| 256x60_s11 | +§10 / 1 | 1427340 | 1362916 | -64424 | -4.51357069794% | 64424 | 64424 | 32212 | yes |

**Signed final population drift across day-1 sizes**

| Row | Base final population | +§10 Δ% | +§100 Δ% | +§1,000 Δ% | +§10,000 Δ% |
|---|---:|---:|---:|---:|---:|
| 128x15_s7 | 192899 | -0.593574875971% | -1.43442941643% | 0.731470873359% | 0.3380007154% |
| 256x60_s7 | 1513835 | -14.9499780359% | -8.84594424095% | 0.820432874124% | -7.28943378902% |
| 256x60_s11 | 1427340 | -4.51357069794% | 3.93585270503% | 7.50059551333% | 8.82880042597% |

### Provenance and exact commands

Scratch generator: `C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forkNoiseReport.mjs`; SHA256 `9cd6099865d03ff07a6f90d2f1b0d8c8a4529501895f8803368b0f0551821ec6`. This generator reads JSON and writes only the explicit scratch output; it starts no simulations.

**128x15_s7_base** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [128x15_s7_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_base.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\128x15_s7_base.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet
```

**128x15_s7_n10000_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [128x15_s7_n10000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n10000_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\128x15_s7_n10000_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet --aa-funds-nudge 10000
```

**128x15_s7_n1000_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [128x15_s7_n1000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n1000_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\128x15_s7_n1000_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet --aa-funds-nudge 1000
```

**128x15_s7_n100_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [128x15_s7_n100_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n100_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\128x15_s7_n100_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet --aa-funds-nudge 100
```

**128x15_s7_n10_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [128x15_s7_n10_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n10_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\128x15_s7_n10_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 128 --years 15 --seed 7 --quiet --aa-funds-nudge 10
```

**128x15_s7_n10_d1800** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [128x15_s7_n10_d1800](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n10_d1800.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\128x15_s7_n10_d1800.spec.json
```

**128x15_s7_n10_d4320** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [128x15_s7_n10_d4320](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n10_d4320.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\128x15_s7_n10_d4320.spec.json
```

**256x60_s11_base** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [256x60_s11_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_base.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s11_base.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet
```

**256x60_s11_n10000_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [256x60_s11_n10000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_n10000_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s11_n10000_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet --aa-funds-nudge 10000
```

**256x60_s11_n1000_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [256x60_s11_n1000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_n1000_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s11_n1000_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet --aa-funds-nudge 1000
```

**256x60_s11_n100_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [256x60_s11_n100_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_n100_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s11_n100_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet --aa-funds-nudge 100
```

**256x60_s11_n10_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [256x60_s11_n10_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_n10_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s11_n10_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 11 --quiet --aa-funds-nudge 10
```

**256x60_s7_base** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [256x60_s7_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_base.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s7_base.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet
```

**256x60_s7_n10000_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [256x60_s7_n10000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_n10000_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s7_n10000_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet --aa-funds-nudge 10000
```

**256x60_s7_n1000_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [256x60_s7_n1000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_n1000_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s7_n1000_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet --aa-funds-nudge 1000
```

**256x60_s7_n100_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [256x60_s7_n100_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_n100_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s7_n100_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet --aa-funds-nudge 100
```

**256x60_s7_n10_d1** — commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Raw full precision: [256x60_s7_n10_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_n10_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s7_n10_d1.spec.json
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsx tools/simbot.ts --size 256 --years 60 --seed 7 --quiet --aa-funds-nudge 10
```

Later-day probes use the actual scratch-wrapper command above. They inject immediately before the selected day’s `daily()` call, after `advanceDay()` and the day counter increment, and before that day’s monthly decisions. No nonexistent simbot day-selection flag is implied.

### 128x15_s7

| Nudge / day | Successful action trace forks? | First successful action difference | First logged decision difference | First annual metric difference | Final population / air / approval / I-HT share |
|---|---|---|---|---|---|
| +§10 / 1 | yes | #1189: base day 3720; May 2010; run year 11: `zone([{"x0":56,"z0":74,"x1":64,"z1":82},6])`; cost `1280`; affected `64`; nudge day 3720; May 2010; run year 11: `bulldoze([{"x0":2,"z0":38,"x1":3,"z1":39}])`; cost `11`; affected `1` | #667: base day 3720; May 2010; run year 11; calendar year 2010: `built 1 bus stop`; nudge day 3720; May 2010; run year 11; calendar year 2010: `cleared 1 small lots for Bus Stop ($150)` | 2011 | 191754 / 0.0887281025502 / 81.3850622364 / 0 |
| +§100 / 1 | yes | #406: base day 1230; Jun 2003; run year 4: `buildNetwork([{"from":{"x":64,"z":19},"to":{"x":73,"z":19},"length":10,"hash":"6cd8ca1364a2a1850611e54e73afd56540f7b90ecf149cbada1d8a20dc99f4de"},2])`; cost `180`; affected `9`; nudge day 1200; May 2003; run year 4: `buildNetwork([{"from":{"x":91,"z":73},"to":{"x":100,"z":73},"length":10,"hash":"b0055ac6cd2b2849d614e01ac7193268218ed63c2b420639bf51a787a79b7a17"},3])`; cost `364`; affected `10` | #178: base day 1230; Jun 2003; run year 4; calendar year 2003: `developed R block (7,2) as zone 2`; nudge day 1200; May 2003; run year 4; calendar year 2003: `built Medical Clinic ($1802)` | 2004 | 190132 / 0.0916931294957 / 81.556299867 / 0 |
| +§1000 / 1 | yes | #193: base day 540; Jul 2001; run year 2: `takeLoan([60000])`; cost `-60000`; affected `1`; nudge day 510; Jun 2001; run year 2: `buildNetwork([{"from":{"x":37,"z":28},"to":{"x":46,"z":28},"length":10,"hash":"98dd640b9a521b2b968f43844fa53e063345546337f6b613b86dc9598736c80c"},2])`; cost `200`; affected `10` | #64: base day 540; Jul 2001; run year 2; calendar year 2001: `took a loan of $60000`; nudge day 510; Jun 2001; run year 2; calendar year 2001: `developed R block (4,3) as zone 2` | 2002 | 194310 / 0.0807144179924 / 80.4163075198 / 0 |
| +§10000 / 1 | yes | #117: base day 300; Nov 2000; run year 1: `buildNetwork([{"from":{"x":73,"z":64},"to":{"x":82,"z":64},"length":10,"hash":"4f19b3b9e666f0db9c6cc28ae192d316e846134919734e72425403fbac74df1c"},3])`; cost `20`; affected `1`; nudge day 300; Nov 2000; run year 1: `plop(["civ_police_station",71,38,0])`; cost `1500`; affected `1` | #39: base day 300; Nov 2000; run year 1; calendar year 2000: `built Medical Clinic ($1800)`; nudge day 300; Nov 2000; run year 1; calendar year 2000: `built Police Station ($1500)` | 2001 | 193551 / 0.0808232133524 / 79.0623205916 / 0 |
| +§10 / 1800 | yes | #1189: base day 3720; May 2010; run year 11: `zone([{"x0":56,"z0":74,"x1":64,"z1":82},6])`; cost `1280`; affected `64`; nudge day 3720; May 2010; run year 11: `bulldoze([{"x0":2,"z0":38,"x1":3,"z1":39}])`; cost `11`; affected `1` | #667: base day 3720; May 2010; run year 11; calendar year 2010: `built 1 bus stop`; nudge day 3720; May 2010; run year 11; calendar year 2010: `cleared 1 small lots for Bus Stop ($150)` | 2011 | 191754 / 0.0887281025502 / 81.3850622364 / 0 |
| +§10 / 4320 | no | identical | identical | none | 192899 / 0.0908835924374 / 81.3650175025 / 0 |

#### Envelope by nudge

| Nudge / day | Metric | Max absolute Δ | Year | Base there | Relative Δ there | Max annual relative Δ | Year |
|---|---|---:|---:|---:|---:|---:|---:|
| +§10 / 1 | Population | 1145 | 2015 | 192899 | 0.593574875971% | 0.593574875971% | 2015 |
| +§10 / 1 | Air at homes | 0.00266070191745 | 2014 | 0.0833283045672 | 3.19303498526% | 3.19303498526% | 2014 |
| +§10 / 1 | Approval (points) | 0.361220387898 | 2013 | 76.3292420144 | 0.473239846702% | 0.473239846702% | 2013 |
| +§10 / 1 | I-HT share (fraction) | 0 | 2010 | 0 | 0% | 0% | 2010 |
| +§100 / 1 | Population | 2767 | 2015 | 192899 | 1.43442941643% | 1.43442941643% | 2015 |
| +§100 / 1 | Air at homes | 0.00294449733518 | 2012 | 0.0708048271401 | 4.15861100735% | 4.15861100735% | 2012 |
| +§100 / 1 | Approval (points) | 0.695722764347 | 2013 | 76.3292420144 | 0.911476055554% | 0.914908278548% | 2010 |
| +§100 / 1 | I-HT share (fraction) | 0 | 2010 | 0 | 0% | 0% | 2010 |
| +§1000 / 1 | Population | 3194 | 2012 | 134385 | 2.37675335789% | 2.37675335789% | 2012 |
| +§1000 / 1 | Air at homes | 0.0101691744449 | 2015 | 0.0908835924374 | 11.1892302804% | 11.7068505255% | 2014 |
| +§1000 / 1 | Approval (points) | 0.948709982729 | 2015 | 81.3650175025 | 1.16599247668% | 1.31454521806% | 2010 |
| +§1000 / 1 | I-HT share (fraction) | 0 | 2010 | 0 | 0% | 0% | 2010 |
| +§10000 / 1 | Population | 2620 | 2012 | 134385 | 1.94962235369% | 1.94962235369% | 2012 |
| +§10000 / 1 | Air at homes | 0.0142014166733 | 2013 | 0.0778400375672 | 18.2443599941% | 18.2443599941% | 2013 |
| +§10000 / 1 | Approval (points) | 2.3026969109 | 2015 | 81.3650175025 | 2.83008224122% | 2.83008224122% | 2015 |
| +§10000 / 1 | I-HT share (fraction) | 0.00433387506772 | 2013 | 0 | ∞% | ∞% | 2013 |
| +§10 / 1800 | Population | 1145 | 2015 | 192899 | 0.593574875971% | 0.593574875971% | 2015 |
| +§10 / 1800 | Air at homes | 0.00266070191745 | 2014 | 0.0833283045672 | 3.19303498526% | 3.19303498526% | 2014 |
| +§10 / 1800 | Approval (points) | 0.361220387898 | 2013 | 76.3292420144 | 0.473239846702% | 0.473239846702% | 2013 |
| +§10 / 1800 | I-HT share (fraction) | 0 | 2010 | 0 | 0% | 0% | 2010 |
| +§10 / 4320 | Population | 0 | 2010 | 99729 | 0% | 0% | 2010 |
| +§10 / 4320 | Air at homes | 0 | 2010 | 0.074013021175 | 0% | 0% | 2010 |
| +§10 / 4320 | Approval (points) | 0 | 2010 | 70.5454822917 | 0% | 0% | 2010 |
| +§10 / 4320 | I-HT share (fraction) | 0 | 2010 | 0 | 0% | 0% | 2010 |

#### Annual absolute deltas: +§10 on day 1

Compared with the baseline; raw values: [128x15_s7_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_base.json>), [128x15_s7_n10_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n10_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 0 | 0 | 0 | 0 |
| 2011 | 398 | 0.00104653617797 | 0.0592734783872 | 0 |
| 2012 | 113 | 0.000894231624274 | 0.0843049126874 | 0 |
| 2013 | 777 | 0.00172058363258 | 0.361220387898 | 0 |
| 2014 | 590 | 0.00266070191745 | 0.209931209432 | 0 |
| 2015 | 1145 | 0.00215548988712 | 0.0200447339093 | 0 |

#### Annual absolute deltas: +§100 on day 1

Compared with the baseline; raw values: [128x15_s7_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_base.json>), [128x15_s7_n100_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n100_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 903 | 0.000403407946707 | 0.645426457629 | 0 |
| 2011 | 1326 | 0.00012233718726 | 0.457395217392 | 0 |
| 2012 | 569 | 0.00294449733518 | 0.419093381347 | 0 |
| 2013 | 1952 | 0.000693794203292 | 0.695722764347 | 0 |
| 2014 | 2456 | 0.00121978600348 | 0.566492525369 | 0 |
| 2015 | 2767 | 0.000809537058363 | 0.191282364456 | 0 |

#### Annual absolute deltas: +§1000 on day 1

Compared with the baseline; raw values: [128x15_s7_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_base.json>), [128x15_s7_n1000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n1000_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 1651 | 0.00645444061429 | 0.927352264024 | 0 |
| 2011 | 1309 | 0.0075094237852 | 0.535735373956 | 0 |
| 2012 | 3194 | 0.00595956232314 | 0.582464268996 | 0 |
| 2013 | 1869 | 0.00837401819013 | 0.756150084326 | 0 |
| 2014 | 2011 | 0.00975512006116 | 0.594018155696 | 0 |
| 2015 | 1411 | 0.0101691744449 | 0.948709982729 | 0 |

#### Annual absolute deltas: +§10000 on day 1

Compared with the baseline; raw values: [128x15_s7_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_base.json>), [128x15_s7_n10000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n10000_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 1742 | 0.0108060661114 | 0.358886049457 | 0 |
| 2011 | 1799 | 0.0116181561288 | 0.0311480932386 | 0 |
| 2012 | 2620 | 0.00819215243438 | 0.317202165043 | 0 |
| 2013 | 765 | 0.0142014166733 | 0.49674771828 | 0.00433387506772 |
| 2014 | 561 | 0.0112541727754 | 0.564510458978 | 0 |
| 2015 | 652 | 0.010060379085 | 2.3026969109 | 0 |

#### Annual absolute deltas: +§10 on day 1800

Compared with the baseline; raw values: [128x15_s7_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_base.json>), [128x15_s7_n10_d1800](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n10_d1800.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 0 | 0 | 0 | 0 |
| 2011 | 398 | 0.00104653617797 | 0.0592734783872 | 0 |
| 2012 | 113 | 0.000894231624274 | 0.0843049126874 | 0 |
| 2013 | 777 | 0.00172058363258 | 0.361220387898 | 0 |
| 2014 | 590 | 0.00266070191745 | 0.209931209432 | 0 |
| 2015 | 1145 | 0.00215548988712 | 0.0200447339093 | 0 |

#### Later-day timing sensitivity against the same day-1 amount

These comparisons isolate injection timing at the same added endowment. Their metric maxima use all annual observations from year 10; they do not replace the comparisons against the unnudged baseline above. The first-action column gives the earlier date of the first differing pair and both calls.

| Amount / later day | Day-1 counterpart | First successful action difference | First logged decision difference | First annual metric difference | Max absolute Δ population | Max absolute Δ air | Max absolute Δ approval | Max absolute Δ I-HT share |
|---|---|---|---|---|---:|---:|---:|---:|
| +§10 / 1800 | [128x15_s7_n10_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n10_d1.json>) | identical | identical | none | 0 | 0 | 0 | 0 |
| +§10 / 4320 | [128x15_s7_n10_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n10_d1.json>) | #1189, day 3720; May 2010; run year 11; day 1 day 3720; May 2010; run year 11: `bulldoze([{"x0":2,"z0":38,"x1":3,"z1":39}])`; cost `11`; affected `1`; later day 3720; May 2010; run year 11: `zone([{"x0":56,"z0":74,"x1":64,"z1":82},6])`; cost `1280`; affected `64` | #667, day 3720; May 2010; run year 11; calendar year 2010; day 1 day 3720; May 2010; run year 11; calendar year 2010: `cleared 1 small lots for Bus Stop ($150)`; later day 3720; May 2010; run year 11; calendar year 2010: `built 1 bus stop` | 2011 | 1145 | 0.00266070191745 | 0.361220387898 | 0 |

| Amount / later day | Metric | Max absolute timing Δ | Year | Day-1 value there | Relative Δ there | Max annual relative Δ | Year |
|---|---|---:|---:|---:|---:|---:|---:|
| +§10 / 1800 | Population | 0 | 2010 | 99729 | 0% | 0% | 2010 |
| +§10 / 1800 | Air at homes | 0 | 2010 | 0.074013021175 | 0% | 0% | 2010 |
| +§10 / 1800 | Approval (points) | 0 | 2010 | 70.5454822917 | 0% | 0% | 2010 |
| +§10 / 1800 | I-HT share (fraction) | 0 | 2010 | 0 | 0% | 0% | 2010 |
| +§10 / 4320 | Population | 1145 | 2015 | 191754 | 0.597119225675% | 0.597119225675% | 2015 |
| +§10 / 4320 | Air at homes | 0.00266070191745 | 2014 | 0.0806676026498 | 3.29835253566% | 3.29835253566% | 2014 |
| +§10 / 4320 | Approval (points) | 0.361220387898 | 2013 | 76.6904624023 | 0.471010835745% | 0.471010835745% | 2013 |
| +§10 / 4320 | I-HT share (fraction) | 0 | 2010 | 0 | 0% | 0% | 2010 |

#### Spread across day-1 nudge sizes

Positive-grid range uses the completed subset of +§10, +§100, +§1,000 and +§10,000 (4/4); base-inclusive range adds the unnudged run. Later-day probes are excluded. A yearly cell is minimum…maximum (range).

| Set | Metric | Max yearly range | Year | Relative to base there | Min run | Max run |
|---|---|---:|---:|---:|---|---|
| positive grid | Population | 4467 | 2014 | 2.58215555363% | 128x15_s7_n100_d1 | 128x15_s7_n1000_d1 |
| positive grid | Air at homes | 0.0148952108766 | 2013 | 19.135667636% | 128x15_s7_n10000_d1 | 128x15_s7_n100_d1 |
| positive grid | Approval (points) | 2.49397927536 | 2015 | 3.06517389403% | 128x15_s7_n10000_d1 | 128x15_s7_n100_d1 |
| positive grid | I-HT share (fraction) | 0.00433387506772 | 2013 | ∞% | 128x15_s7_n10_d1 | 128x15_s7_n10000_d1 |
| base + grid | Population | 4467 | 2014 | 2.58215555363% | 128x15_s7_n100_d1 | 128x15_s7_n1000_d1 |
| base + grid | Air at homes | 0.0148952108766 | 2013 | 19.135667636% | 128x15_s7_n10000_d1 | 128x15_s7_n100_d1 |
| base + grid | Approval (points) | 2.49397927536 | 2015 | 3.06517389403% | 128x15_s7_n10000_d1 | 128x15_s7_n100_d1 |
| base + grid | I-HT share (fraction) | 0.00433387506772 | 2013 | ∞% | 128x15_s7_base | 128x15_s7_n10000_d1 |

**Yearly positive grid ranges**

| Year | Population min…max (range) | Air min…max (range) | Approval min…max (range) | I-HT share min…max (range) |
|---:|---:|---:|---:|---:|
| 2010 | 98826…101471 (2645) | 0.0632069550636…0.0744164291217 (0.0112094740581) | 69.6181300277…70.5454822917 (0.927352264024) | 0…0 (0) |
| 2011 | 115670…118795 (3125) | 0.0646793456614…0.0764198389775 (0.0117404933161) | 72.8019837969…73.7951143882 (0.993130591348) | 0…0 (0) |
| 2012 | 133816…137579 (3763) | 0.0626126747057…0.0737493244753 (0.0111366497696) | 74.7490753677…75.6487418018 (0.899666434038) | 0…0 (0) |
| 2013 | 151950…155771 (3821) | 0.0636386208939…0.0785338317705 (0.0148952108766) | 76.6904624023…77.0853920988 (0.394929696427) | 0…0.00433387506772 (0.00433387506772) |
| 2014 | 170539…175006 (4467) | 0.0720741317919…0.0845480905707 (0.0124739587788) | 77.7881200717…78.9486307528 (1.16051068107) | 0…0 (0) |
| 2015 | 190132…194310 (4178) | 0.0807144179924…0.0916931294957 (0.0109787115033) | 79.0623205916…81.556299867 (2.49397927536) | 0…0 (0) |

**Yearly base + grid ranges**

| Year | Population min…max (range) | Air min…max (range) | Approval min…max (range) | I-HT share min…max (range) |
|---:|---:|---:|---:|---:|
| 2010 | 98826…101471 (2645) | 0.0632069550636…0.0744164291217 (0.0112094740581) | 69.6181300277…70.5454822917 (0.927352264024) | 0…0 (0) |
| 2011 | 115670…118795 (3125) | 0.0646793456614…0.0764198389775 (0.0117404933161) | 72.8019837969…73.7951143882 (0.993130591348) | 0…0 (0) |
| 2012 | 133816…137579 (3763) | 0.0626126747057…0.0737493244753 (0.0111366497696) | 74.7490753677…75.6487418018 (0.899666434038) | 0…0 (0) |
| 2013 | 151950…155771 (3821) | 0.0636386208939…0.0785338317705 (0.0148952108766) | 76.3292420144…77.0853920988 (0.756150084326) | 0…0.00433387506772 (0.00433387506772) |
| 2014 | 170539…175006 (4467) | 0.0720741317919…0.0845480905707 (0.0124739587788) | 77.7881200717…78.9486307528 (1.16051068107) | 0…0 (0) |
| 2015 | 190132…194310 (4178) | 0.0807144179924…0.0916931294957 (0.0109787115033) | 79.0623205916…81.556299867 (2.49397927536) | 0…0 (0) |

**Stability across nudge sizes.** Compare the per-size maximum absolute drift in the same unit. The ratio is relative to this row’s smallest tested forking day-1 nudge; ∞ means its envelope is zero while the larger nudge’s is nonzero.

| Metric | Smallest fork: nudge / envelope | +§10,000 envelope | Ratio, +§10,000 / smallest fork |
|---|---:|---:|---:|
| Population | +§10 / 1145 | 2620 | 2.28820960699 |
| Air at homes | +§10 / 0.00266070191745 | 0.0142014166733 | 5.33747000374 |
| Approval (points) | +§10 / 0.361220387898 | 2.3026969109 | 6.37477005188 |
| I-HT share (fraction) | +§10 / 0 | 0.00433387506772 | ∞ |

### 256x60_s7

| Nudge / day | Successful action trace forks? | First successful action difference | First logged decision difference | First annual metric difference | Final population / air / approval / I-HT share |
|---|---|---|---|---|---|
| +§10 / 1 | yes | #1566: base day 4290; Dec 2011; run year 12: `buildNetwork([{"from":{"x":137,"z":38},"to":{"x":146,"z":38},"length":10,"hash":"1d64cd3d43e0b19430f260b68298793a30d261d85cb61e552602eb6f57aa74d5"},3])`; cost `398`; affected `10`; nudge day 4260; Nov 2011; run year 12: `bulldoze([{"x0":136,"z0":118,"x1":137,"z1":119}])`; cost `8`; affected `1` | #828: base day 4290; Dec 2011; run year 12; calendar year 2011: `developed R block (15,4) as zone 2`; nudge day 4260; Nov 2011; run year 12; calendar year 2011: `cleared 1 small lots for Playground ($250)` | 2012 | 1287517 / 0.149110105157 / 80.4488132318 / 0.169808511826 |
| +§100 / 1 | yes | #270: base day 720; Jan 2002; run year 2: `setTax([0,10])`; cost ``; affected ``; nudge day 720; Jan 2002; run year 2: `buildNetwork([{"from":{"x":155,"z":137},"to":{"x":164,"z":137},"length":10,"hash":"df70dcd77b3b1f0bd971eb79afc0bd8790992c04626009ac39e4eca9b1e6f5d6"},2])`; cost `180`; affected `9` | #139: base day 750; Feb 2002; run year 3; calendar year 2002: `rezoned (12,16) to 2`; nudge day 750; Feb 2002; run year 3; calendar year 2002: `developed C block (17,9) as zone 5` | 2003 | 1379922 / 0.158303165101 / 79.9395016464 / 0.137623904611 |
| +§1000 / 1 | yes | #164: base day 420; Mar 2001; run year 2: `takeLoan([60000])`; cost `-60000`; affected `1`; nudge day 420; Mar 2001; run year 2: `setTax([0,10])`; cost ``; affected `` | #59: base day 420; Mar 2001; run year 2; calendar year 2001: `took a loan of $60000`; nudge day 420; Mar 2001; run year 2; calendar year 2001: `developed R block (11,16) as zone 1` | 2002 | 1526255 / 0.172779680326 / 80.8726454332 / 0.0772714897409 |
| +§10000 / 1 | yes | #113: base day 300; Nov 2000; run year 1: `plop(["util_wind_turbine",159,120,0])`; cost `800`; affected `1`; nudge day 270; Oct 2000; run year 1: `plop(["park_plaza",108,117,0])`; cost `508`; affected `1` | #36: base day 300; Nov 2000; run year 1; calendar year 2000: `built Wind Turbine ($800)`; nudge day 270; Oct 2000; run year 1; calendar year 2000: `built Plaza ($508)` | 2001 | 1403485 / 0.165593084301 / 80.1369504418 / 0.0523117860412 |

#### Envelope by nudge

| Nudge / day | Metric | Max absolute Δ | Year | Base there | Relative Δ there | Max annual relative Δ | Year |
|---|---|---:|---:|---:|---:|---:|---:|
| +§10 / 1 | Population | 226318 | 2060 | 1513835 | 14.9499780359% | 14.9499780359% | 2060 |
| +§10 / 1 | Air at homes | 0.0295162286014 | 2060 | 0.178626333759 | 16.5240073959% | 16.5240073959% | 2060 |
| +§10 / 1 | Approval (points) | 2.40551675511 | 2032 | 82.2056823218 | 2.92621712656% | 2.92621712656% | 2032 |
| +§10 / 1 | I-HT share (fraction) | 0.0937275261713 | 2055 | 0.0366587441133 | 255.675769692% | ∞% | 2044 |
| +§100 / 1 | Population | 133913 | 2060 | 1513835 | 8.84594424095% | 8.84594424095% | 2060 |
| +§100 / 1 | Air at homes | 0.0226935081447 | 2056 | 0.179043508252 | 12.6748567241% | 14.394462245% | 2018 |
| +§100 / 1 | Approval (points) | 3.92461663103 | 2012 | 63.1424208328 | 6.21549915139% | 6.21549915139% | 2012 |
| +§100 / 1 | I-HT share (fraction) | 0.0511209163901 | 2054 | 0.0236319752152 | 216.320963121% | ∞% | 2048 |
| +§1000 / 1 | Population | 12589 | 2057 | 1470002 | 0.856393392662% | 0.856393392662% | 2057 |
| +§1000 / 1 | Air at homes | 0.0148115767545 | 2039 | 0.125735778555 | 11.7799220911% | 16.4450101763% | 2011 |
| +§1000 / 1 | Approval (points) | 4.31803530677 | 2013 | 67.7892603094 | 6.36979262949% | 6.36979262949% | 2013 |
| +§1000 / 1 | I-HT share (fraction) | 0.025127177839 | 2060 | 0.10239866758 | 24.5385789023% | 100% | 2051 |
| +§10000 / 1 | Population | 110350 | 2060 | 1513835 | 7.28943378902% | 7.28943378902% | 2060 |
| +§10000 / 1 | Air at homes | 0.0130332494573 | 2060 | 0.178626333759 | 7.29637628619% | 14.7315969408% | 2011 |
| +§10000 / 1 | Approval (points) | 5.70546994943 | 2013 | 67.7892603094 | 8.41648060974% | 8.41648060974% | 2013 |
| +§10000 / 1 | I-HT share (fraction) | 0.0500868815387 | 2060 | 0.10239866758 | 48.9136067124% | ∞% | 2050 |

#### Annual absolute deltas: +§10 on day 1

Compared with the baseline; raw values: [256x60_s7_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_base.json>), [256x60_s7_n10_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_n10_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 0 | 0 | 0 | 0 |
| 2011 | 0 | 0 | 0 | 0 |
| 2012 | 116 | 0.0000804788496781 | 0.0269578378245 | 0 |
| 2013 | 101 | 0.000989769581301 | 0.934449835657 | 0 |
| 2014 | 97 | 0.00403996400438 | 0.0663803443202 | 0 |
| 2015 | 202 | 0.000464961861987 | 0.281055040988 | 0 |
| 2016 | 782 | 0.00184213760129 | 0.43064716522 | 0 |
| 2017 | 951 | 0.00249116135943 | 1.21013729133 | 0 |
| 2018 | 265 | 0.00139034983482 | 0.425816028927 | 0 |
| 2019 | 927 | 0.00719338063287 | 1.01102362811 | 0 |
| 2020 | 926 | 0.000509503787836 | 1.04807066796 | 0 |
| 2021 | 2185 | 0.00142828582117 | 1.51106210143 | 0 |
| 2022 | 310 | 0.0027558298251 | 2.12945069668 | 0 |
| 2023 | 524 | 0.000921884386296 | 0.928291210994 | 0 |
| 2024 | 428 | 0.00184382219598 | 0.449683864577 | 0 |
| 2025 | 448 | 0.00555432781159 | 1.80814027698 | 0 |
| 2026 | 2469 | 0.00653654445467 | 1.65246521979 | 0 |
| 2027 | 3123 | 0.00135235207973 | 1.59065743198 | 0 |
| 2028 | 3106 | 0.000131585403349 | 0.992690121686 | 0 |
| 2029 | 2891 | 0.00194696827423 | 0.903331899873 | 0 |
| 2030 | 2383 | 0.0004295765446 | 1.6366900468 | 0 |
| 2031 | 2198 | 0.000484503035771 | 2.34895060767 | 0 |
| 2032 | 3738 | 0.00628867439266 | 2.40551675511 | 0 |
| 2033 | 4672 | 0.00213763238071 | 2.38090585659 | 0 |
| 2034 | 2579 | 0.0036244690473 | 1.38062011095 | 0 |
| 2035 | 2375 | 0.00170474616134 | 0.601046671055 | 0 |
| 2036 | 599 | 0.000498806204757 | 0.418761038497 | 0 |
| 2037 | 795 | 0.000663522397715 | 0.362298892296 | 0 |
| 2038 | 158 | 0.00143960550505 | 0.113340270474 | 0 |
| 2039 | 141 | 0.00519419321965 | 0.196462782051 | 0 |
| 2040 | 807 | 0.0112537011038 | 0.723788977169 | 0 |
| 2041 | 2802 | 0.00826394519982 | 1.47584453382 | 0 |
| 2042 | 1938 | 0.00492371785847 | 0.808778844563 | 0 |
| 2043 | 2621 | 0.0124845721073 | 0.451989206407 | 0 |
| 2044 | 1524 | 0.00957170405281 | 0.296075828765 | 0.002362399392 |
| 2045 | 3096 | 0.0164344664499 | 0.693716478632 | 0.00827935692236 |
| 2046 | 860 | 0.0134320328305 | 1.32764672506 | 0.018555110672 |
| 2047 | 791 | 0.019579818127 | 0.589034275322 | 0.0295540579538 |
| 2048 | 3808 | 0.00935206032211 | 0.52915232856 | 0.0393275768573 |
| 2049 | 36807 | 0.0124684167203 | 0.879001576447 | 0.0492147442367 |
| 2050 | 64539 | 0.0192496113063 | 1.27333956323 | 0.0562189722259 |
| 2051 | 88681 | 0.019906018975 | 0.637564052014 | 0.0621567093339 |
| 2052 | 117522 | 0.0188328753594 | 0.198158534812 | 0.0754700497371 |
| 2053 | 156592 | 0.00865181958227 | 0.48294039937 | 0.08834078931 |
| 2054 | 159061 | 0.0169178661656 | 0.669994769005 | 0.0907584870359 |
| 2055 | 174680 | 0.0188165536145 | 1.24601888029 | 0.0937275261713 |
| 2056 | 188721 | 0.02274986099 | 0.346612719594 | 0.0882296440324 |
| 2057 | 196327 | 0.0201893974077 | 0.425789588319 | 0.0809082527593 |
| 2058 | 206516 | 0.0253822571304 | 0.268575885657 | 0.0647762031356 |
| 2059 | 214364 | 0.0227096242329 | 0.445233721521 | 0.0655943840888 |
| 2060 | 226318 | 0.0295162286014 | 0.0913885358948 | 0.0674098442463 |

#### Annual absolute deltas: +§100 on day 1

Compared with the baseline; raw values: [256x60_s7_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_base.json>), [256x60_s7_n100_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_n100_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 845 | 0.00402872081107 | 0.0311819368076 | 0 |
| 2011 | 670 | 0.0056914356465 | 0.481645164884 | 0 |
| 2012 | 1105 | 0.000518791154169 | 3.92461663103 | 0 |
| 2013 | 1482 | 0.00101207984811 | 0.263057682316 | 0 |
| 2014 | 935 | 0.00680872885515 | 1.40242343999 | 0 |
| 2015 | 484 | 0.00451471706652 | 0.616717514634 | 0 |
| 2016 | 1013 | 0.00520242027494 | 0.196359812184 | 0 |
| 2017 | 1984 | 0.00850567368798 | 0.453813974527 | 0 |
| 2018 | 1668 | 0.00898415651339 | 0.39183273478 | 0 |
| 2019 | 1181 | 0.00479373443888 | 0.589592378945 | 0 |
| 2020 | 1097 | 0.00391976995939 | 0.0151228264326 | 0 |
| 2021 | 1786 | 0.00506533068018 | 1.20262040842 | 0 |
| 2022 | 1820 | 0.0047213685847 | 0.529572127531 | 0 |
| 2023 | 3242 | 0.00850454493231 | 0.186854033713 | 0 |
| 2024 | 3178 | 0.00825391773334 | 1.60474788676 | 0 |
| 2025 | 3469 | 0.00391590932177 | 0.218353874461 | 0 |
| 2026 | 885 | 0.00486497963699 | 0.607781552459 | 0 |
| 2027 | 1196 | 0.00648020999362 | 0.445881015056 | 0 |
| 2028 | 1959 | 0.0081544168479 | 0.357429446151 | 0 |
| 2029 | 3213 | 0.00855304039792 | 0.131615529032 | 0 |
| 2030 | 2770 | 0.0100098348679 | 0.202740935975 | 0 |
| 2031 | 3905 | 0.0101708735678 | 0.213012298486 | 0 |
| 2032 | 2704 | 0.00550725795147 | 0.431224510375 | 0 |
| 2033 | 2924 | 0.00656203809185 | 0.216354529247 | 0 |
| 2034 | 2759 | 0.00904725617009 | 0.845378357029 | 0 |
| 2035 | 3780 | 0.00788027875754 | 0.202438045003 | 0 |
| 2036 | 2104 | 0.00770077640523 | 0.895377566423 | 0 |
| 2037 | 3112 | 0.00154608645942 | 0.753523425777 | 0 |
| 2038 | 2269 | 0.000350082805994 | 2.04733939351 | 0 |
| 2039 | 138 | 0.00784669246294 | 0.52659458958 | 0 |
| 2040 | 224 | 0.0144401728399 | 1.12481902142 | 0 |
| 2041 | 1856 | 0.0126502732866 | 1.16770386274 | 0 |
| 2042 | 837 | 0.00954415202155 | 0.413707617956 | 0 |
| 2043 | 167 | 0.0172641097478 | 0.653130013833 | 0 |
| 2044 | 2166 | 0.00675369246277 | 1.48950250998 | 0 |
| 2045 | 1034 | 0.0102036261727 | 0.362147410669 | 0 |
| 2046 | 2755 | 0.0145946467741 | 0.310392908381 | 0 |
| 2047 | 4393 | 0.0182539181365 | 0.39890664184 | 0 |
| 2048 | 1692 | 0.00759247633235 | 0.409975464846 | 0.00175555599145 |
| 2049 | 3152 | 0.0196204504455 | 0.113655548801 | 0.0135973647924 |
| 2050 | 3778 | 0.0126449313647 | 0.162896425612 | 0.0266876566095 |
| 2051 | 3419 | 0.0200433888704 | 1.59350253455 | 0.0263770409483 |
| 2052 | 29997 | 0.010431224102 | 1.32449141285 | 0.0313393777582 |
| 2053 | 60861 | 0.00725028688538 | 1.46661712532 | 0.0492731444759 |
| 2054 | 72398 | 0.0140519413244 | 0.68503020266 | 0.0511209163901 |
| 2055 | 95485 | 0.0141326090971 | 0.60443080455 | 0.0433373417051 |
| 2056 | 104239 | 0.0226935081447 | 0.568125342866 | 0.0408188527691 |
| 2057 | 109618 | 0.0197022943621 | 0.224449856408 | 0.0390853616841 |
| 2058 | 125218 | 0.0215753120856 | 0.0765320730862 | 0.0394712688897 |
| 2059 | 131827 | 0.0183140910682 | 0.315573039329 | 0.034994765482 |
| 2060 | 133913 | 0.0203231686575 | 0.417923049509 | 0.0352252370316 |

#### Annual absolute deltas: +§1000 on day 1

Compared with the baseline; raw values: [256x60_s7_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_base.json>), [256x60_s7_n1000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_n1000_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 299 | 0.00368999252015 | 0.34902274569 | 0 |
| 2011 | 434 | 0.00989305361467 | 2.58820258042 | 0 |
| 2012 | 249 | 0.00857917403434 | 0.166721184995 | 0 |
| 2013 | 1051 | 0.00859972680665 | 4.31803530677 | 0 |
| 2014 | 795 | 0.00369218481304 | 2.85580670335 | 0 |
| 2015 | 135 | 0.00196271974683 | 0.0749463802693 | 0 |
| 2016 | 526 | 0.0047559593547 | 1.18864177475 | 0 |
| 2017 | 1006 | 0.00828765309451 | 0.208125757817 | 0 |
| 2018 | 1112 | 0.00623348406515 | 1.69555021819 | 0 |
| 2019 | 1067 | 0.00446437770849 | 1.1626771674 | 0 |
| 2020 | 1356 | 0.000962666815079 | 1.26655091767 | 0 |
| 2021 | 1575 | 0.00235668309007 | 0.80298803485 | 0 |
| 2022 | 2024 | 0.00269590677074 | 0.606936754109 | 0 |
| 2023 | 2314 | 0.00479130938449 | 0.157505447897 | 0 |
| 2024 | 1669 | 0.00533245211433 | 2.42241101848 | 0 |
| 2025 | 1902 | 0.00397557219401 | 0.454801639443 | 0 |
| 2026 | 650 | 0.00623234823206 | 0.844358528451 | 0 |
| 2027 | 252 | 0.00454926889592 | 0.404346579441 | 0 |
| 2028 | 813 | 0.00662346261023 | 0.320176733725 | 0 |
| 2029 | 651 | 0.00629837276653 | 0.708999581438 | 0 |
| 2030 | 2079 | 0.010814780982 | 1.5564121127 | 0 |
| 2031 | 3044 | 0.011931457191 | 1.15228989453 | 0 |
| 2032 | 2211 | 0.00699617103319 | 0.1779557242 | 0 |
| 2033 | 1117 | 0.00715145244588 | 0.667435455075 | 0 |
| 2034 | 1255 | 0.0117582834283 | 0.0498312679043 | 0 |
| 2035 | 1781 | 0.00364345470165 | 0.163502797275 | 0 |
| 2036 | 185 | 0.00343348006485 | 0.315834179154 | 0 |
| 2037 | 1307 | 0.00836426318857 | 0.180256030258 | 0 |
| 2038 | 1353 | 0.0083309607584 | 0.897494599382 | 0 |
| 2039 | 1363 | 0.0148115767545 | 1.09178540414 | 0 |
| 2040 | 2345 | 0.013305805953 | 0.425088874925 | 0 |
| 2041 | 1344 | 0.0050736462558 | 0.252639232937 | 0 |
| 2042 | 5554 | 0.00376306001841 | 0.808449317862 | 0 |
| 2043 | 1123 | 0.0107456337613 | 0.411452222214 | 0 |
| 2044 | 269 | 0.00607279175508 | 0.0777762960338 | 0 |
| 2045 | 5577 | 0.0123870713432 | 0.536418916293 | 0 |
| 2046 | 3615 | 0.00666613984295 | 0.510272229437 | 0 |
| 2047 | 8300 | 0.01029193628 | 1.01616193853 | 0 |
| 2048 | 4038 | 0.00337377335445 | 1.01091381648 | 0 |
| 2049 | 7073 | 0.00921574538362 | 0.186946376345 | 0 |
| 2050 | 3329 | 0.00113316756152 | 0.175255561805 | 0 |
| 2051 | 7202 | 0.010759594859 | 0.567153926812 | 0.00592249012918 |
| 2052 | 626 | 0.00579009818973 | 0.598901680518 | 0.00102352694207 |
| 2053 | 2425 | 0.0057756803271 | 0.0948118282846 | 0.00395624807442 |
| 2054 | 4185 | 0.00215649718224 | 0.0491455468849 | 0.00873082528279 |
| 2055 | 4581 | 0.00191190880524 | 1.2427105757 | 0.0134854285218 |
| 2056 | 11905 | 0.0112705188382 | 1.0253965273 | 0.002126618841 |
| 2057 | 12589 | 0.00608290605397 | 0.265936334263 | 0.00660844023518 |
| 2058 | 4530 | 0.00645238930264 | 0.598156675346 | 0.0114010312259 |
| 2059 | 3656 | 0.0055041996853 | 0.626440911947 | 0.014921479772 |
| 2060 | 12420 | 0.00584665343308 | 0.515220737244 | 0.025127177839 |

#### Annual absolute deltas: +§10000 on day 1

Compared with the baseline; raw values: [256x60_s7_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_base.json>), [256x60_s7_n10000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_n10000_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 52 | 0.00328988678814 | 1.6999448393 | 0 |
| 2011 | 617 | 0.00886229177134 | 1.80108747782 | 0 |
| 2012 | 397 | 0.00813858881004 | 0.00814094841422 | 0 |
| 2013 | 713 | 0.00471625251615 | 5.70546994943 | 0 |
| 2014 | 914 | 0.00258837114834 | 1.17417627316 | 0 |
| 2015 | 983 | 0.00640031338673 | 0.037778907487 | 0 |
| 2016 | 1185 | 0.00598776304109 | 0.296835219975 | 0 |
| 2017 | 1556 | 0.00268640287276 | 0.140173482371 | 0 |
| 2018 | 1041 | 0.00184747136093 | 0.480509460547 | 0 |
| 2019 | 1440 | 0.000557719091529 | 0.45732974807 | 0 |
| 2020 | 1536 | 0.00502732498378 | 0.635880723636 | 0 |
| 2021 | 1642 | 0.00114800914764 | 2.10421337121 | 0 |
| 2022 | 1668 | 0.00470152890688 | 0.615421252009 | 0 |
| 2023 | 2438 | 0.00373499080645 | 0.57420754877 | 0 |
| 2024 | 2329 | 0.00403578765231 | 1.18832486482 | 0 |
| 2025 | 2378 | 0.00738775674622 | 0.0119472029789 | 0 |
| 2026 | 1174 | 0.005234756412 | 0.729331754574 | 0 |
| 2027 | 169 | 0.000232380784427 | 0.856977548006 | 0 |
| 2028 | 53 | 0.000146015657346 | 0.494110303839 | 0 |
| 2029 | 57 | 0.00283315261236 | 0.215348152175 | 0 |
| 2030 | 50 | 0.0044343529784 | 0.999494440224 | 0 |
| 2031 | 1119 | 0.00533555728374 | 0.840961389016 | 0 |
| 2032 | 508 | 0.00339683085062 | 1.62253816956 | 0 |
| 2033 | 1350 | 0.00143241596865 | 1.66526232514 | 0 |
| 2034 | 26 | 0.00412384588559 | 0.458461633573 | 0 |
| 2035 | 218 | 0.00325626086039 | 0.171349862101 | 0 |
| 2036 | 514 | 0.00296984767434 | 0.255771181314 | 0 |
| 2037 | 1490 | 0.00240424774634 | 0.592929394214 | 0 |
| 2038 | 711 | 0.00213530277607 | 0.193008676368 | 0 |
| 2039 | 1866 | 0.00889295965141 | 0.0989907639753 | 0 |
| 2040 | 1352 | 0.0117018704727 | 0.874066443275 | 0 |
| 2041 | 4001 | 0.0111484600601 | 1.93116452555 | 0 |
| 2042 | 387 | 0.00655977398593 | 1.12066835425 | 0 |
| 2043 | 704 | 0.0103322521413 | 1.07399741642 | 0 |
| 2044 | 967 | 0.00609877539579 | 0.6501706587 | 0 |
| 2045 | 660 | 0.00517347724215 | 1.098026295 | 0 |
| 2046 | 3060 | 0.00910570249405 | 0.743790797245 | 0 |
| 2047 | 5497 | 0.0109483250105 | 0.298975829156 | 0 |
| 2048 | 450 | 0.00213766405082 | 0.890267528839 | 0 |
| 2049 | 4061 | 0.00910797836496 | 0.649588218077 | 0 |
| 2050 | 769 | 0.00775414433835 | 1.05455315364 | 0.00807821042609 |
| 2051 | 1664 | 0.00840453661273 | 1.21365338946 | 0.0145741857 |
| 2052 | 27091 | 0.00623991411724 | 1.96625588129 | 0.0200516956622 |
| 2053 | 58753 | 0.00234116866187 | 2.22020921421 | 0.035352875011 |
| 2054 | 65478 | 0.00369156336913 | 1.68629718438 | 0.0294972339651 |
| 2055 | 65962 | 0.00310290124334 | 0.511152695367 | 0.0165667427892 |
| 2056 | 70872 | 0.0103730294298 | 0.0683284295607 | 0.00230941036894 |
| 2057 | 72750 | 0.00751608926466 | 0.931269545623 | 0.0218224977902 |
| 2058 | 98151 | 0.000995455677253 | 1.35975759898 | 0.0371512244701 |
| 2059 | 107561 | 0.00404679123452 | 0.632762578367 | 0.041528171899 |
| 2060 | 110350 | 0.0130332494573 | 0.220474254121 | 0.0500868815387 |

#### Spread across day-1 nudge sizes

Positive-grid range uses the completed subset of +§10, +§100, +§1,000 and +§10,000 (4/4); base-inclusive range adds the unnudged run. Later-day probes are excluded. A yearly cell is minimum…maximum (range).

| Set | Metric | Max yearly range | Year | Relative to base there | Min run | Max run |
|---|---|---:|---:|---:|---|---|
| positive grid | Population | 238738 | 2060 | 15.77041091% | 256x60_s7_n10_d1 | 256x60_s7_n1000_d1 |
| positive grid | Air at homes | 0.0263777128077 | 2058 | 15.0382644151% | 256x60_s7_n10_d1 | 256x60_s7_n10000_d1 |
| positive grid | Approval (points) | 5.44241226711 | 2013 | 8.02842845943% | 256x60_s7_n10000_d1 | 256x60_s7_n100_d1 |
| positive grid | I-HT share (fraction) | 0.117496725785 | 2060 | 114.744389319% | 256x60_s7_n10000_d1 | 256x60_s7_n10_d1 |
| base + grid | Population | 238738 | 2060 | 15.77041091% | 256x60_s7_n10_d1 | 256x60_s7_n1000_d1 |
| base + grid | Air at homes | 0.0295162286014 | 2060 | 16.5240073959% | 256x60_s7_n10_d1 | 256x60_s7_base |
| base + grid | Approval (points) | 5.70546994943 | 2013 | 8.41648060974% | 256x60_s7_n10000_d1 | 256x60_s7_base |
| base + grid | I-HT share (fraction) | 0.117496725785 | 2060 | 114.744389319% | 256x60_s7_n10000_d1 | 256x60_s7_n10_d1 |

**Yearly positive grid ranges**

| Year | Population min…max (range) | Air min…max (range) | Approval min…max (range) | I-HT share min…max (range) |
|---:|---:|---:|---:|---:|
| 2010 | 98248…99145 (897) | 0.0699563236806…0.0772749312798 (0.00731860759921) | 62.1519596986…63.8830864747 (1.73112677611) | 0…0 (0) |
| 2011 | 111597…112884 (1287) | 0.0601583915644…0.0700514451791 (0.00989305361467) | 59.5281948821…62.1163974625 (2.58820258042) | 0…0 (0) |
| 2012 | 128529…130031 (1502) | 0.0547563621067…0.0638543272952 (0.00909796518851) | 62.9756996478…67.0670374638 (4.09133781603) | 0…0 (0) |
| 2013 | 143993…146526 (2533) | 0.0557256190083…0.0633355762337 (0.00760995722535) | 62.08379036…67.5262026271 (5.44241226711) | 0…0 (0) |
| 2014 | 161476…163206 (1730) | 0.0533041738602…0.057524531567 (0.00422035770681) | 63.5823006264…67.8405307697 (4.25823014335) | 0…0 (0) |
| 2015 | 181143…182261 (1118) | 0.0520474226221…0.0629624530753 (0.0109150304533) | 68.7736616745…69.4653255694 (0.691663894904) | 0…0 (0) |
| 2016 | 199815…201782 (1967) | 0.0526888852507…0.0638790685667 (0.011190183316) | 69.729240021…71.348528961 (1.61928893997) | 0…0 (0) |
| 2017 | 218970…221905 (2935) | 0.0534986620443…0.064690738605 (0.0111920765607) | 69.0216282332…70.685579499 (1.66395126586) | 0…0 (0) |
| 2018 | 240160…242093 (1933) | 0.0534298215879…0.0642614494622 (0.0108316278743) | 70.3879066239…71.6916241073 (1.30371748341) | 0…0 (0) |
| 2019 | 260935…263302 (2367) | 0.0533046888207…0.0652918038924 (0.0119871150717) | 69.8748811574…72.0485819529 (2.17370079551) | 0…0 (0) |
| 2020 | 282915…285377 (2462) | 0.0522226282819…0.061169723225 (0.00894709494317) | 71.4975820884…73.812203674 (2.31462158562) | 0…0 (0) |
| 2021 | 305580…309551 (3971) | 0.051047701643…0.0575413181443 (0.00649361650136) | 72.4472700127…76.0625454854 (3.61527547264) | 0…0 (0) |
| 2022 | 330469…332803 (2334) | 0.0499785533711…0.0594014508627 (0.00942289749158) | 73.8311849622…76.5760569109 (2.74487194869) | 0…0 (0) |
| 2023 | 354724…357442 (2718) | 0.0507366522873…0.062976188026 (0.0122395357388) | 75.413741187…76.9162399467 (1.50249875976) | 0…0 (0) |
| 2024 | 379413…382163 (2750) | 0.0529724048716…0.0652621102572 (0.0122897053856) | 75.9110850543…77.8838122082 (1.97272715391) | 0…0 (0) |
| 2025 | 404710…407731 (3021) | 0.0571926878612…0.0685560168015 (0.0113633289402) | 75.2576622601…77.5206041765 (2.26294191642) | 0…0 (0) |
| 2026 | 429676…433319 (3643) | 0.0564739855034…0.0692428781901 (0.0127688926867) | 75.5493024362…78.0461261844 (2.49682374824) | 0…0 (0) |
| 2027 | 457634…461953 (4319) | 0.0579550492795…0.0646676400575 (0.00671259077804) | 76.6187950489…78.6137990604 (1.99500401142) | 0…0 (0) |
| 2028 | 486594…491659 (5065) | 0.0580580143984…0.0663584469037 (0.00830043250525) | 76.9525687129…78.2654355683 (1.31286685541) | 0…0 (0) |
| 2029 | 516833…522937 (6104) | 0.0625188177239…0.0730188263961 (0.0105000086722) | 77.6322269382…79.2445584195 (1.61233148131) | 0…0 (0) |
| 2030 | 548016…553169 (5153) | 0.0649493512904…0.0753345557279 (0.0103852044374) | 78.2445652652…81.4376674247 (3.19310215949) | 0…0 (0) |
| 2031 | 578742…584845 (6103) | 0.0702906878038…0.081737641959 (0.0114469541552) | 78.9936535188…82.494894021 (3.5012405022) | 0…0 (0) |
| 2032 | 609829…616271 (6442) | 0.0763055009476…0.0895903463735 (0.0132848454258) | 79.8001655667…82.383638046 (2.58347247931) | 0…0 (0) |
| 2033 | 641924…649520 (7596) | 0.0794832604819…0.0887723453085 (0.00928908482659) | 80.0226309733…83.0709722849 (3.04834131166) | 0…0 (0) |
| 2034 | 676284…681622 (5338) | 0.0835822356741…0.0917160500551 (0.00813381438098) | 81.3409991984…82.6717880414 (1.33078884305) | 0…0 (0) |
| 2035 | 709128…715283 (6155) | 0.0888725503557…0.0984575752746 (0.00958502491888) | 81.7202298541…82.4847793225 (0.76454946833) | 0…0 (0) |
| 2036 | 744564…747267 (2703) | 0.096559708282…0.103761678482 (0.00720197020048) | 80.7596983645…82.0738369694 (1.31413860492) | 0…0 (0) |
| 2037 | 779166…781483 (2317) | 0.102820603976…0.112730953624 (0.009910349648) | 81.3545245065…82.2883039625 (0.933779456035) | 0…0 (0) |
| 2038 | 814289…816400 (2111) | 0.105426494636…0.115892758171 (0.0104662635345) | 79.7789881066…82.7238220994 (2.94483399289) | 0…0 (0) |
| 2039 | 848837…850844 (2007) | 0.110924201801…0.120541585336 (0.00961738353484) | 81.1414694683…82.759849462 (1.61837999372) | 0…0 (0) |
| 2040 | 883884…887581 (3697) | 0.118367254642…0.121553726378 (0.00318647173607) | 81.4937968568…83.0437047531 (1.54990789635) | 0…0 (0) |
| 2041 | 918650…923995 (5345) | 0.121413257917…0.128989884948 (0.00757662703085) | 80.7539136362…82.4324389288 (1.67852529261) | 0…0 (0) |
| 2042 | 953072…959013 (5941) | 0.128251480154…0.134032572158 (0.00578109200314) | 80.6112242262…82.5403418984 (1.92911767211) | 0…0 (0) |
| 2043 | 989581…992906 (3325) | 0.130338848098…0.137270705705 (0.00693185760651) | 80.3444645718…81.8299142104 (1.48544963863) | 0…0 (0) |
| 2044 | 1027086…1030776 (3690) | 0.137770734243…0.141269646541 (0.00349891229773) | 80.0182498482…81.5855286543 (1.56727880601) | 0…0.002362399392 (0.002362399392) |
| 2045 | 1065179…1071790 (6611) | 0.139468836969…0.150729826177 (0.0112609892078) | 79.8621191411…81.4965643524 (1.63444521129) | 0…0.00827935692236 (0.00827935692236) |
| 2046 | 1104398…1107153 (2755) | 0.144261354987…0.152189861918 (0.0079285069312) | 79.5236015986…81.3615205531 (1.8379189545) | 0…0.018555110672 (0.018555110672) |
| 2047 | 1140031…1147540 (7509) | 0.146366028509…0.155653910356 (0.00928788184704) | 80.0748780201…80.7920641295 (0.717186109376) | 0…0.0295540579538 (0.0295540579538) |
| 2048 | 1182270…1190116 (7846) | 0.145993442639…0.15320783891 (0.00721439627128) | 79.5683993074…81.4695806527 (1.90118134532) | 0…0.0393275768573 (0.0393275768573) |
| 2049 | 1185504…1229384 (43880) | 0.147350051474…0.157862523554 (0.0105124720805) | 80.0721089608…81.1380569136 (1.06594795279) | 0…0.0492147442367 (0.0492147442367) |
| 2050 | 1201202…1269070 (67868) | 0.14792827082…0.166044714565 (0.0181164437448) | 79.554893821…81.0034889461 (1.44859512504) | 0…0.0562189722259 (0.0562189722259) |
| 2051 | 1217606…1313489 (95883) | 0.152603594368…0.164242446625 (0.0116388522577) | 79.1599302612…81.3205867226 (2.16065646136) | 0…0.0680791994631 (0.0680791994631) |
| 2052 | 1230458…1348606 (118148) | 0.146555326146…0.171178299695 (0.0246229735491) | 78.6707188263…80.8351332424 (2.1644144161) | 0.00711682526827…0.0836104019474 (0.0764935766791) |
| 2053 | 1236117…1395134 (159017) | 0.153931979017…0.168359478926 (0.0144274999094) | 78.5346378001…80.8496588426 (2.3150210425) | 0.0135207576389…0.0979052988745 (0.0843845412356) |
| 2054 | 1254642…1417888 (163246) | 0.149812768871…0.170422198406 (0.0206094295348) | 78.9075085674…80.6429512987 (1.73544273126) | 0.032362800498…0.114390462251 (0.0820276617531) |
| 2055 | 1259078…1438339 (179261) | 0.151948143094…0.172676605514 (0.0207284624198) | 79.5988129871…80.333679172 (0.734866184924) | 0.0501441726351…0.130386270285 (0.0802420976495) |
| 2056 | 1267140…1467766 (200626) | 0.156293647262…0.168670478822 (0.0123768315602) | 79.4981521614…81.0916740316 (1.59352187017) | 0.0536240676026…0.144163122004 (0.0905390544014) |
| 2057 | 1273675…1482591 (208916) | 0.15323807966…0.167344571014 (0.0141064913537) | 79.5513379169…80.2581576061 (0.706819689216) | 0.0522006745363…0.154931425086 (0.10273075055) |
| 2058 | 1282274…1493320 (211046) | 0.150021712899…0.176399425707 (0.0263777128077) | 78.7315767022…80.6894909766 (1.95791427433) | 0.0523850265568…0.154312454163 (0.101927427606) |
| 2059 | 1290446…1508466 (218020) | 0.151713995537…0.170376828535 (0.0186628329984) | 79.2509083157…80.510111806 (1.25920349031) | 0.0523772315741…0.159499787562 (0.107122555988) |
| 2060 | 1287517…1526255 (238738) | 0.149110105157…0.172779680326 (0.0236695751683) | 79.9395016464…80.8726454332 (0.933143786753) | 0.0523117860412…0.169808511826 (0.117496725785) |

**Yearly base + grid ranges**

| Year | Population min…max (range) | Air min…max (range) | Approval min…max (range) | I-HT share min…max (range) |
|---:|---:|---:|---:|---:|
| 2010 | 98248…99145 (897) | 0.0699563236806…0.0772749312798 (0.00731860759921) | 62.1519596986…63.8830864747 (1.73112677611) | 0…0 (0) |
| 2011 | 111597…112884 (1287) | 0.0601583915644…0.0700514451791 (0.00989305361467) | 59.5281948821…62.1163974625 (2.58820258042) | 0…0 (0) |
| 2012 | 128529…130031 (1502) | 0.0547563621067…0.0638543272952 (0.00909796518851) | 62.9756996478…67.0670374638 (4.09133781603) | 0…0 (0) |
| 2013 | 143993…146526 (2533) | 0.054735849427…0.0633355762337 (0.00859972680665) | 62.08379036…67.7892603094 (5.70546994943) | 0…0 (0) |
| 2014 | 161476…163206 (1730) | 0.0533041738602…0.0601129027154 (0.00680872885515) | 63.5823006264…67.8405307697 (4.25823014335) | 0…0 (0) |
| 2015 | 181143…182261 (1118) | 0.0520474226221…0.0629624530753 (0.0109150304533) | 68.7736616745…69.4653255694 (0.691663894904) | 0…0 (0) |
| 2016 | 199815…201782 (1967) | 0.0526888852507…0.0638790685667 (0.011190183316) | 69.729240021…71.348528961 (1.61928893997) | 0…0 (0) |
| 2017 | 218970…221905 (2935) | 0.0534986620443…0.064690738605 (0.0111920765607) | 69.0216282332…70.685579499 (1.66395126586) | 0…0 (0) |
| 2018 | 240160…242093 (1933) | 0.0534298215879…0.0642614494622 (0.0108316278743) | 69.9960738892…71.6916241073 (1.69555021819) | 0…0 (0) |
| 2019 | 260935…263302 (2367) | 0.0533046888207…0.0652918038924 (0.0119871150717) | 69.8748811574…72.0485819529 (2.17370079551) | 0…0 (0) |
| 2020 | 282915…285377 (2462) | 0.0522226282819…0.061169723225 (0.00894709494317) | 71.4975820884…73.812203674 (2.31462158562) | 0…0 (0) |
| 2021 | 305580…309551 (3971) | 0.051047701643…0.0575413181443 (0.00649361650136) | 72.4472700127…76.0625454854 (3.61527547264) | 0…0 (0) |
| 2022 | 330469…332803 (2334) | 0.0499785533711…0.0594014508627 (0.00942289749158) | 73.8311849622…76.5760569109 (2.74487194869) | 0…0 (0) |
| 2023 | 354200…357442 (3242) | 0.0507366522873…0.062976188026 (0.0122395357388) | 75.413741187…76.9162399467 (1.50249875976) | 0…0 (0) |
| 2024 | 378985…382163 (3178) | 0.0529724048716…0.0652621102572 (0.0122897053856) | 75.4614011897…77.8838122082 (2.42241101848) | 0…0 (0) |
| 2025 | 404262…407731 (3469) | 0.0571926878612…0.0685560168015 (0.0113633289402) | 75.2576622601…77.5206041765 (2.26294191642) | 0…0 (0) |
| 2026 | 429676…433319 (3643) | 0.0564739855034…0.0692428781901 (0.0127688926867) | 75.5493024362…78.0461261844 (2.49682374824) | 0…0 (0) |
| 2027 | 457634…461953 (4319) | 0.0579550492795…0.0646676400575 (0.00671259077804) | 76.6187950489…78.6137990604 (1.99500401142) | 0…0 (0) |
| 2028 | 486594…491659 (5065) | 0.0580580143984…0.0663584469037 (0.00830043250525) | 76.9525687129…78.2654355683 (1.31286685541) | 0…0 (0) |
| 2029 | 516833…522937 (6104) | 0.0625188177239…0.0730188263961 (0.0105000086722) | 77.6322269382…79.2445584195 (1.61233148131) | 0…0 (0) |
| 2030 | 548016…553169 (5153) | 0.0649493512904…0.0757641322725 (0.010814780982) | 78.2445652652…81.4376674247 (3.19310215949) | 0…0 (0) |
| 2031 | 578742…584845 (6103) | 0.0702906878038…0.0822221449947 (0.011931457191) | 78.9936535188…82.494894021 (3.5012405022) | 0…0 (0) |
| 2032 | 609829…616271 (6442) | 0.0763055009476…0.0895903463735 (0.0132848454258) | 79.8001655667…82.383638046 (2.58347247931) | 0…0 (0) |
| 2033 | 641924…649520 (7596) | 0.0794832604819…0.0887723453085 (0.00928908482659) | 80.0226309733…83.0709722849 (3.04834131166) | 0…0 (0) |
| 2034 | 676284…681622 (5338) | 0.0835822356741…0.0953405191024 (0.0117582834283) | 81.3409991984…82.7216193094 (1.38062011095) | 0…0 (0) |
| 2035 | 709128…715283 (6155) | 0.0888725503557…0.0984575752746 (0.00958502491888) | 81.7202298541…82.4847793225 (0.76454946833) | 0…0 (0) |
| 2036 | 744564…747267 (2703) | 0.096559708282…0.104260484687 (0.00770077640523) | 80.7596983645…82.0738369694 (1.31413860492) | 0…0 (0) |
| 2037 | 778371…781483 (3112) | 0.102820603976…0.112730953624 (0.009910349648) | 81.3545245065…82.2883039625 (0.933779456035) | 0…0 (0) |
| 2038 | 814131…816400 (2269) | 0.105426494636…0.115892758171 (0.0104662635345) | 79.7789881066…82.7238220994 (2.94483399289) | 0…0 (0) |
| 2039 | 848837…850844 (2007) | 0.110924201801…0.125735778555 (0.0148115767545) | 81.1414694683…82.759849462 (1.61837999372) | 0…0 (0) |
| 2040 | 883884…887581 (3697) | 0.118367254642…0.132807427482 (0.0144401728399) | 81.4937968568…83.0437047531 (1.54990789635) | 0…0 (0) |
| 2041 | 918650…923995 (5345) | 0.121413257917…0.134063531203 (0.0126502732866) | 80.7539136362…82.6850781617 (1.93116452555) | 0…0 (0) |
| 2042 | 953072…959013 (5941) | 0.128251480154…0.137795632176 (0.00954415202155) | 80.6112242262…82.5403418984 (1.92911767211) | 0…0 (0) |
| 2043 | 989581…992906 (3325) | 0.130338848098…0.147602957846 (0.0172641097478) | 80.3444645718…81.8299142104 (1.48544963863) | 0…0 (0) |
| 2044 | 1027086…1030776 (3690) | 0.137770734243…0.147342438296 (0.00957170405281) | 80.0182498482…81.5855286543 (1.56727880601) | 0…0.002362399392 (0.002362399392) |
| 2045 | 1065179…1071790 (6611) | 0.139468836969…0.155903303419 (0.0164344664499) | 79.8621191411…81.4965643524 (1.63444521129) | 0…0.00827935692236 (0.00827935692236) |
| 2046 | 1103538…1107153 (3615) | 0.144261354987…0.158856001761 (0.0145946467741) | 79.5236015986…81.3615205531 (1.8379189545) | 0…0.018555110672 (0.018555110672) |
| 2047 | 1139240…1147540 (8300) | 0.146366028509…0.165945846636 (0.019579818127) | 79.775902191…80.7920641295 (1.01616193853) | 0…0.0295540579538 (0.0295540579538) |
| 2048 | 1182270…1190116 (7846) | 0.145993442639…0.155345502961 (0.00935206032211) | 79.5683993074…81.4695806527 (1.90118134532) | 0…0.0393275768573 (0.0393275768573) |
| 2049 | 1185504…1229384 (43880) | 0.147350051474…0.166970501919 (0.0196204504455) | 80.0721089608…81.1380569136 (1.06594795279) | 0…0.0492147442367 (0.0492147442367) |
| 2050 | 1201202…1269070 (67868) | 0.14792827082…0.167177882126 (0.0192496113063) | 79.554893821…81.0034889461 (1.44859512504) | 0…0.0562189722259 (0.0562189722259) |
| 2051 | 1217606…1313489 (95883) | 0.152603594368…0.172646983238 (0.0200433888704) | 79.1599302612…81.3205867226 (2.16065646136) | 0…0.0680791994631 (0.0680791994631) |
| 2052 | 1230458…1348606 (118148) | 0.146555326146…0.171178299695 (0.0246229735491) | 78.6707188263…80.8351332424 (2.1644144161) | 0.00711682526827…0.0836104019474 (0.0764935766791) |
| 2053 | 1236117…1395134 (159017) | 0.153931979017…0.168359478926 (0.0144274999094) | 78.5346378001…80.8496588426 (2.3150210425) | 0.00956450956451…0.0979052988745 (0.08834078931) |
| 2054 | 1254642…1417888 (163246) | 0.149812768871…0.170422198406 (0.0206094295348) | 78.9075085674…80.6429512987 (1.73544273126) | 0.0236319752152…0.114390462251 (0.0907584870359) |
| 2055 | 1259078…1438339 (179261) | 0.151948143094…0.172676605514 (0.0207284624198) | 79.0876602917…80.333679172 (1.24601888029) | 0.0366587441133…0.130386270285 (0.0937275261713) |
| 2056 | 1267140…1467766 (200626) | 0.156293647262…0.179043508252 (0.02274986099) | 79.4981521614…81.0916740316 (1.59352187017) | 0.0536240676026…0.144163122004 (0.0905390544014) |
| 2057 | 1273675…1482591 (208916) | 0.15323807966…0.173427477068 (0.0201893974077) | 79.5513379169…80.4826074625 (0.931269545623) | 0.0522006745363…0.154931425086 (0.10273075055) |
| 2058 | 1282274…1493320 (211046) | 0.150021712899…0.176399425707 (0.0263777128077) | 78.7315767022…80.6894909766 (1.95791427433) | 0.0523850265568…0.154312454163 (0.101927427606) |
| 2059 | 1290446…1508466 (218020) | 0.151713995537…0.17442361977 (0.0227096242329) | 79.2509083157…80.510111806 (1.25920349031) | 0.0523772315741…0.159499787562 (0.107122555988) |
| 2060 | 1287517…1526255 (238738) | 0.149110105157…0.178626333759 (0.0295162286014) | 79.9395016464…80.8726454332 (0.933143786753) | 0.0523117860412…0.169808511826 (0.117496725785) |

**Stability across nudge sizes.** Compare the per-size maximum absolute drift in the same unit. The ratio is relative to this row’s smallest tested forking day-1 nudge; ∞ means its envelope is zero while the larger nudge’s is nonzero.

| Metric | Smallest fork: nudge / envelope | +§10,000 envelope | Ratio, +§10,000 / smallest fork |
|---|---:|---:|---:|
| Population | +§10 / 226318 | 110350 | 0.487588260766 |
| Air at homes | +§10 / 0.0295162286014 | 0.0130332494573 | 0.441562153257 |
| Approval (points) | +§10 / 2.40551675511 | 5.70546994943 | 2.37182714995 |
| I-HT share (fraction) | +§10 / 0.0937275261713 | 0.0500868815387 | 0.534388173728 |

### 256x60_s11

| Nudge / day | Successful action trace forks? | First successful action difference | First logged decision difference | First annual metric difference | Final population / air / approval / I-HT share |
|---|---|---|---|---|---|
| +§10 / 1 | yes | #1613: base day 4620; Nov 2012; run year 13: `plop(["util_recycling_center",179,201,0])`; cost `9000`; affected `1`; nudge day 4590; Oct 2012; run year 13: `plop(["civ_statue",93,123,0])`; cost `500`; affected `1` | #833: base day 4620; Nov 2012; run year 13; calendar year 2012: `built Recycling Center ($9000)`; nudge day 4590; Oct 2012; run year 13; calendar year 2012: `built Statue of the Mayor ($500)` | 2013 | 1362916 / 0.162400621776 / 80.7575291485 / 0.157376412218 |
| +§100 / 1 | yes | #390: base day 1110; Feb 2003; run year 4: `buildNetwork([{"from":{"x":92,"z":92},"to":{"x":92,"z":101},"length":10,"hash":"5061b4da1e89bd278af646c00c717cf66899e1fc7626353b9097eddf6bcc514d"},2])`; cost `160`; affected `8`; nudge day 1110; Feb 2003; run year 4: `buildNetwork([{"from":{"x":173,"z":137},"to":{"x":182,"z":137},"length":10,"hash":"c9f18e69eb9dacc01a55339e5aed6bda6310c11c9d8c1dab13f5b6b54d4ce462"},2])`; cost `180`; affected `9` | #168: base day 1110; Feb 2003; run year 4; calendar year 2003: `saving for a prison ($12000): 26 % of the sentenced have no bed`; nudge day 1110; Feb 2003; run year 4; calendar year 2003: `built Prison ($12000)` | 2004 | 1483518 / 0.16888213734 / 81.271739906 / 0.0886738163746 |
| +§1000 / 1 | yes | #112: base day 270; Oct 2000; run year 1: `buildNetwork([{"from":{"x":155,"z":110},"to":{"x":155,"z":119},"length":10,"hash":"9082daa843f3289ee4dd0b5dab67d332566fbe6e2a5d9ace18f3256d19aba801"},2])`; cost `176`; affected `8`; nudge day 240; Sep 2000; run year 1: `plop(["park_plaza",102,117,0])`; cost `500`; affected `1` | #32: base day 270; Oct 2000; run year 1; calendar year 2000: `developed R block (16,12) as zone 1`; nudge day 240; Sep 2000; run year 1; calendar year 2000: `built Plaza ($500)` | 2001 | 1534399 / 0.17186087664 / 80.340956516 / 0.0804764903629 |
| +§10000 / 1 | yes | #112: base day 270; Oct 2000; run year 1: `buildNetwork([{"from":{"x":155,"z":110},"to":{"x":155,"z":119},"length":10,"hash":"9082daa843f3289ee4dd0b5dab67d332566fbe6e2a5d9ace18f3256d19aba801"},2])`; cost `176`; affected `8`; nudge day 240; Sep 2000; run year 1: `plop(["park_plaza",102,117,0])`; cost `500`; affected `1` | #32: base day 270; Oct 2000; run year 1; calendar year 2000: `developed R block (16,12) as zone 1`; nudge day 240; Sep 2000; run year 1; calendar year 2000: `built Plaza ($500)` | 2001 | 1553357 / 0.156029903447 / 80.413346937 / 0.0406333265013 |

#### Envelope by nudge

| Nudge / day | Metric | Max absolute Δ | Year | Base there | Relative Δ there | Max annual relative Δ | Year |
|---|---|---:|---:|---:|---:|---:|---:|
| +§10 / 1 | Population | 64424 | 2060 | 1427340 | 4.51357069794% | 4.51357069794% | 2060 |
| +§10 / 1 | Air at homes | 0.0176448591177 | 2059 | 0.147304497255 | 11.978493153% | 11.978493153% | 2059 |
| +§10 / 1 | Approval (points) | 2.1341464291 | 2013 | 63.6206172189 | 3.35448872141% | 3.35448872141% | 2013 |
| +§10 / 1 | I-HT share (fraction) | 0.0584628832132 | 2059 | 0.0910363244426 | 64.2192922123% | ∞% | 2050 |
| +§100 / 1 | Population | 66063 | 2059 | 1416617 | 4.66343408275% | 4.66343408275% | 2059 |
| +§100 / 1 | Air at homes | 0.0262246665456 | 2058 | 0.142471353527 | 18.406975084% | 18.406975084% | 2058 |
| +§100 / 1 | Approval (points) | 3.23743074775 | 2020 | 76.4404919454 | 4.23523013178% | 4.23523013178% | 2020 |
| +§100 / 1 | I-HT share (fraction) | 0.0145776901074 | 2060 | 0.103251506482 | 14.1186221917% | 87.1067554364% | 2051 |
| +§1000 / 1 | Population | 107059 | 2060 | 1427340 | 7.50059551333% | 7.50059551333% | 2060 |
| +§1000 / 1 | Air at homes | 0.0279660799477 | 2057 | 0.145909746932 | 19.1666975893% | 20.3564649782% | 2011 |
| +§1000 / 1 | Approval (points) | 2.82379365417 | 2016 | 72.3115621325 | 3.90503754986% | 3.90503754986% | 2016 |
| +§1000 / 1 | I-HT share (fraction) | 0.0319098421567 | 2059 | 0.0910363244426 | 35.0517690077% | 100% | 2051 |
| +§10000 / 1 | Population | 126017 | 2060 | 1427340 | 8.82880042597% | 8.82880042597% | 2060 |
| +§10000 / 1 | Air at homes | 0.0142157860271 | 2041 | 0.123881921098 | 11.4752708879% | 16.8890552382% | 2026 |
| +§10000 / 1 | Approval (points) | 4.28196840858 | 2014 | 70.2355302508 | 6.09658443993% | 6.09658443993% | 2014 |
| +§10000 / 1 | I-HT share (fraction) | 0.0626181799806 | 2060 | 0.103251506482 | 60.6462628142% | ∞% | 2010 |

#### Annual absolute deltas: +§10 on day 1

Compared with the baseline; raw values: [256x60_s11_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_base.json>), [256x60_s11_n10_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_n10_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 0 | 0 | 0 | 0 |
| 2011 | 0 | 0 | 0 | 0 |
| 2012 | 0 | 0 | 0 | 0 |
| 2013 | 86 | 0.000306054411088 | 2.1341464291 | 0 |
| 2014 | 133 | 0.00126996356111 | 0.539977313516 | 0 |
| 2015 | 760 | 0.00142648635566 | 0.465021919529 | 0 |
| 2016 | 660 | 0.00103090906225 | 0.260752383055 | 0 |
| 2017 | 885 | 0.00253577873725 | 0.0251215527238 | 0 |
| 2018 | 148 | 0.00132602853299 | 0.282407476956 | 0 |
| 2019 | 1674 | 0.00218451238894 | 0.72078824604 | 0 |
| 2020 | 705 | 0.0034784174417 | 1.71701623284 | 0 |
| 2021 | 708 | 0.003040536895 | 0.451843607961 | 0 |
| 2022 | 955 | 0.00562031783631 | 0.422770957041 | 0 |
| 2023 | 347 | 0.00118759749657 | 0.343454381056 | 0 |
| 2024 | 44 | 0.00301308450646 | 0.00855756161448 | 0 |
| 2025 | 89 | 0.00347897432591 | 0.512184470107 | 0 |
| 2026 | 465 | 0.00136508005327 | 0.285544975671 | 0 |
| 2027 | 275 | 0.00342570349554 | 0.78088106271 | 0 |
| 2028 | 1445 | 0.000258786163696 | 1.23785526301 | 0 |
| 2029 | 2295 | 0.00182082858086 | 1.92116004394 | 0 |
| 2030 | 1983 | 0.00133264533984 | 0.3694074918 | 0 |
| 2031 | 2723 | 0.00381136061975 | 0.00125646863587 | 0 |
| 2032 | 2936 | 0.00347324332368 | 0.0434692764417 | 0 |
| 2033 | 3549 | 0.00439804467113 | 0.104559986173 | 0 |
| 2034 | 4496 | 0.00431840143629 | 0.954095622955 | 0 |
| 2035 | 6137 | 0.0073405392003 | 1.09690243732 | 0 |
| 2036 | 6025 | 0.0088695453365 | 1.8700304537 | 0 |
| 2037 | 4244 | 0.00147068657179 | 0.811762134594 | 0 |
| 2038 | 4834 | 0.0105978769026 | 0.912059925487 | 0 |
| 2039 | 3588 | 0.0116363566196 | 0.889229526344 | 0 |
| 2040 | 4089 | 0.00748351154863 | 0.568081355937 | 0 |
| 2041 | 3787 | 0.0000608163216552 | 0.487837318346 | 0 |
| 2042 | 7500 | 0.00292537783429 | 0.844474943646 | 0 |
| 2043 | 4129 | 0.000719113600265 | 0.290970392452 | 0 |
| 2044 | 6499 | 0.00584800644189 | 0.0986452775473 | 0 |
| 2045 | 5862 | 0.00741264911602 | 0.15351939614 | 0 |
| 2046 | 11214 | 0.00977101901664 | 0.67935269924 | 0 |
| 2047 | 7392 | 0.00889840022137 | 1.38837571468 | 0 |
| 2048 | 4808 | 0.000719704971047 | 1.82344245469 | 0 |
| 2049 | 1911 | 0.00107499844845 | 0.141981973448 | 0 |
| 2050 | 8362 | 0.00731251300819 | 0.024043570731 | 0.010858426612 |
| 2051 | 10983 | 0.00605112589542 | 0.240002436931 | 0.0122746745521 |
| 2052 | 37403 | 0.0064199651414 | 0.499703020541 | 0.0241166947469 |
| 2053 | 47139 | 0.0148816198762 | 1.21055245669 | 0.0288479101259 |
| 2054 | 56462 | 0.0127693999731 | 0.0152658025473 | 0.036757495088 |
| 2055 | 45858 | 0.0129984875523 | 0.0138933852173 | 0.0396687834616 |
| 2056 | 57375 | 0.0172230623674 | 0.0933500791021 | 0.0533765125192 |
| 2057 | 56316 | 0.014912115031 | 0.228505916271 | 0.0525826027446 |
| 2058 | 63753 | 0.0156645689369 | 0.324237689855 | 0.054535911498 |
| 2059 | 56969 | 0.0176448591177 | 0.302987417396 | 0.0584628832132 |
| 2060 | 64424 | 0.0149155643043 | 0.599165415191 | 0.0541249057363 |

#### Annual absolute deltas: +§100 on day 1

Compared with the baseline; raw values: [256x60_s11_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_base.json>), [256x60_s11_n100_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_n100_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 11 | 0.0047026931872 | 1.43622617669 | 0 |
| 2011 | 192 | 0.00218838161389 | 1.52457176667 | 0 |
| 2012 | 1395 | 0.00476232673432 | 1.53748595367 | 0 |
| 2013 | 1103 | 0.00380521416582 | 0.380358581151 | 0 |
| 2014 | 317 | 0.00601105020839 | 2.56540058456 | 0 |
| 2015 | 518 | 0.00547972677656 | 0.604933732415 | 0 |
| 2016 | 1115 | 0.00240599793241 | 1.68253109265 | 0 |
| 2017 | 1296 | 0.00574132403126 | 1.68633085768 | 0 |
| 2018 | 1530 | 0.000852339118852 | 2.33561649227 | 0 |
| 2019 | 2730 | 0.00276442877948 | 2.29226085872 | 0 |
| 2020 | 2960 | 0.00337066664166 | 3.23743074775 | 0 |
| 2021 | 3092 | 0.00245987585108 | 2.1935776053 | 0 |
| 2022 | 273 | 0.00565408829569 | 0.66455631366 | 0 |
| 2023 | 1180 | 0.00439498961818 | 0.618117496611 | 0 |
| 2024 | 583 | 0.00330199011462 | 0.625592987909 | 0 |
| 2025 | 1389 | 0.0000451048593248 | 0.821924214525 | 0 |
| 2026 | 739 | 0.00575475955955 | 0.699720242178 | 0 |
| 2027 | 551 | 0.00415605655726 | 0.118287707818 | 0 |
| 2028 | 439 | 0.00192906297901 | 2.02611774147 | 0 |
| 2029 | 137 | 0.000708580119256 | 2.49727175061 | 0 |
| 2030 | 161 | 0.00196002117404 | 0.608877129569 | 0 |
| 2031 | 483 | 0.00222914551595 | 1.29973383354 | 0 |
| 2032 | 197 | 0.00759927031498 | 0.405194602675 | 0 |
| 2033 | 1086 | 0.00925832771339 | 0.241391160807 | 0 |
| 2034 | 11 | 0.00402051795932 | 0.830920474593 | 0 |
| 2035 | 176 | 0.00842984604781 | 0.169780954289 | 0 |
| 2036 | 679 | 0.00317292856277 | 1.33966243752 | 0 |
| 2037 | 509 | 0.00375498697661 | 0.89254105743 | 0 |
| 2038 | 1150 | 0.00299405607522 | 0.421528641299 | 0 |
| 2039 | 1652 | 0.00531953561027 | 0.211756507786 | 0 |
| 2040 | 1480 | 0.00352170520821 | 0.212258498406 | 0 |
| 2041 | 3234 | 0.000251987270081 | 0.545700060905 | 0 |
| 2042 | 902 | 0.00436335246771 | 0.289645622929 | 0 |
| 2043 | 484 | 0.00573444885399 | 0.380847595845 | 0 |
| 2044 | 324 | 0.00889878005952 | 0.285292753964 | 0 |
| 2045 | 1574 | 0.0085359341817 | 0.784593643494 | 0 |
| 2046 | 93 | 0.00718492450625 | 0.82071407599 | 0 |
| 2047 | 3422 | 0.0199247863112 | 0.87048081259 | 0 |
| 2048 | 998 | 0.0106090016699 | 0.941103854723 | 0 |
| 2049 | 6195 | 0.00620564094701 | 0.824546116459 | 0 |
| 2050 | 5150 | 0.02569873459 | 0.12776463879 | 0 |
| 2051 | 2305 | 0.0101669168964 | 0.0538411165489 | 0.00872754535518 |
| 2052 | 1176 | 0.0199934075008 | 0.0823822083271 | 0.0056882100334 |
| 2053 | 18944 | 0.013428883918 | 0.0698141757492 | 0.00835600006974 |
| 2054 | 12451 | 0.0206968311198 | 0.0985978125782 | 0.00151093804707 |
| 2055 | 40257 | 0.0164576930185 | 0.214543940098 | 0.0120403588825 |
| 2056 | 45127 | 0.018310362981 | 0.0795031181607 | 0.00472568982885 |
| 2057 | 52372 | 0.0188990911223 | 0.819511212142 | 0.00440925435631 |
| 2058 | 49776 | 0.0262246665456 | 0.0811442495033 | 0.00823170924096 |
| 2059 | 66063 | 0.0150067572117 | 0.651232242633 | 0.0140023170447 |
| 2060 | 56178 | 0.0213970798684 | 0.0849546577103 | 0.0145776901074 |

#### Annual absolute deltas: +§1000 on day 1

Compared with the baseline; raw values: [256x60_s11_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_base.json>), [256x60_s11_n1000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_n1000_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 2225 | 0.00796495839238 | 1.50525650798 | 0 |
| 2011 | 2930 | 0.0118156537777 | 0.0814088304015 | 0 |
| 2012 | 4170 | 0.0104271080064 | 1.8182283917 | 0 |
| 2013 | 3275 | 0.00643680905723 | 0.712450160657 | 0 |
| 2014 | 2368 | 0.00423190637311 | 1.5606983731 | 0 |
| 2015 | 2490 | 0.00277894094728 | 0.266912452253 | 0 |
| 2016 | 1634 | 0.00270598989303 | 2.82379365417 | 0 |
| 2017 | 1584 | 0.00102672515374 | 2.0725946398 | 0 |
| 2018 | 2926 | 0.000468878491402 | 1.16267721943 | 0 |
| 2019 | 1721 | 0.000270881356283 | 0.0595557226831 | 0 |
| 2020 | 2330 | 0.00148799730737 | 0.467380778101 | 0 |
| 2021 | 1347 | 0.00186139258742 | 1.12991620106 | 0 |
| 2022 | 2659 | 0.00277642167241 | 1.72314650628 | 0 |
| 2023 | 2583 | 0.00440131772576 | 1.85358159866 | 0 |
| 2024 | 2036 | 0.00540438243951 | 1.74032299004 | 0 |
| 2025 | 1940 | 0.00371590074922 | 0.775024231276 | 0 |
| 2026 | 2720 | 0.00773632177181 | 1.39561220219 | 0 |
| 2027 | 4503 | 0.00609952958286 | 0.446724627293 | 0 |
| 2028 | 4372 | 0.00140474089224 | 0.110114263189 | 0 |
| 2029 | 3706 | 0.00151262577675 | 0.961491370535 | 0 |
| 2030 | 4235 | 0.0013815634728 | 0.048065613347 | 0 |
| 2031 | 3535 | 0.000982063860755 | 0.53375496088 | 0 |
| 2032 | 4491 | 0.00219908866648 | 0.281098362391 | 0 |
| 2033 | 3519 | 0.00702797546471 | 0.2716224997 | 0 |
| 2034 | 5584 | 0.00287703847512 | 0.665818122796 | 0 |
| 2035 | 4325 | 0.0063342171147 | 0.142749822898 | 0 |
| 2036 | 5266 | 0.00707488914946 | 0.665004197531 | 0 |
| 2037 | 6728 | 0.000744617850869 | 0.276464233713 | 0 |
| 2038 | 5367 | 0.00503712118559 | 0.518523003154 | 0 |
| 2039 | 5135 | 0.00289053668246 | 0.101640243628 | 0 |
| 2040 | 2628 | 0.00643021535415 | 0.300457039118 | 0 |
| 2041 | 7489 | 0.0000684180156915 | 0.131693146591 | 0 |
| 2042 | 7517 | 0.00322481059237 | 0.13690957825 | 0 |
| 2043 | 10020 | 0.00399951554414 | 1.05069471826 | 0 |
| 2044 | 12265 | 0.00722287668233 | 0.452615210437 | 0 |
| 2045 | 7184 | 0.00978057744077 | 1.70872710532 | 0 |
| 2046 | 2788 | 0.0164808651498 | 1.42732045802 | 0 |
| 2047 | 7172 | 0.0174793724238 | 1.62012967711 | 0 |
| 2048 | 6668 | 0.0114687235207 | 0.826832476917 | 0 |
| 2049 | 6214 | 0.0126711050974 | 0.227037721079 | 0 |
| 2050 | 817 | 0.0238785375243 | 0.140866363656 | 0 |
| 2051 | 7025 | 0.0122133592897 | 0.334185613987 | 0.0100193668234 |
| 2052 | 3847 | 0.0251194108289 | 0.443311727599 | 0.0108910310306 |
| 2053 | 31358 | 0.017356108515 | 1.09521104483 | 0.0244613470833 |
| 2054 | 50098 | 0.0207066118689 | 0.254695305023 | 0.0143472667021 |
| 2055 | 65310 | 0.0246788554764 | 0.94104771786 | 0.0157314015267 |
| 2056 | 81796 | 0.0187006862538 | 0.577404187955 | 0.0125821388478 |
| 2057 | 83076 | 0.0279660799477 | 1.65020336677 | 0.0115969708956 |
| 2058 | 93763 | 0.0265735585265 | 1.03665812441 | 0.017620608382 |
| 2059 | 99961 | 0.024536676325 | 0.654306623433 | 0.0319098421567 |
| 2060 | 107059 | 0.0243758191684 | 1.01573804767 | 0.0227750161191 |

#### Annual absolute deltas: +§10000 on day 1

Compared with the baseline; raw values: [256x60_s11_base](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_base.json>), [256x60_s11_n10000_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_n10000_d1.json>).

| Year | Absolute Δ population | Absolute Δ air | Absolute Δ approval | Absolute Δ I-HT share |
|---:|---:|---:|---:|---:|
| 2010 | 583 | 0.000262426477721 | 0.972485927621 | 0.0154051251666 |
| 2011 | 1200 | 0.0032247073473 | 2.02517498746 | 0.0136974425661 |
| 2012 | 380 | 0.000686720712369 | 1.61924975736 | 0.0129959236389 |
| 2013 | 787 | 0.000176923318202 | 0.597634142693 | 0.0124821820703 |
| 2014 | 3341 | 0.00212680907418 | 4.28196840858 | 0.0123161135819 |
| 2015 | 3376 | 0.00238783660396 | 0.134613717423 | 0.0123461480018 |
| 2016 | 2746 | 0.00272360072494 | 0.197970812284 | 0.0121361950781 |
| 2017 | 2593 | 0.000776341579078 | 0.793512462719 | 0.0118968692449 |
| 2018 | 2036 | 0.00458756521616 | 0.37879291999 | 0.012058057313 |
| 2019 | 3133 | 0.00599447379829 | 0.788071598136 | 0.0119464621511 |
| 2020 | 2063 | 0.00710391301394 | 1.47318759781 | 0.0108414119737 |
| 2021 | 2324 | 0.00648065492839 | 0.812718722521 | 0.0119382022472 |
| 2022 | 1837 | 0.00798956653742 | 1.44755898343 | 0.0119851576994 |
| 2023 | 2751 | 0.00878518174942 | 1.11524370311 | 0.0119864920028 |
| 2024 | 2446 | 0.00964590636069 | 0.198185890127 | 0.0119780464288 |
| 2025 | 3424 | 0.00934305172128 | 1.10022966648 | 0.0115821516074 |
| 2026 | 3837 | 0.0113242282786 | 0.28305972405 | 0.0117354328369 |
| 2027 | 3247 | 0.00896222575469 | 0.658511371844 | 0.0118725188291 |
| 2028 | 6062 | 0.0097443068583 | 1.78451446684 | 0.0118384917984 |
| 2029 | 5744 | 0.00721220680821 | 0.701183138299 | 0.0117520175536 |
| 2030 | 6841 | 0.00614655331201 | 0.0940995115215 | 0.0118202430956 |
| 2031 | 6194 | 0.0091272816073 | 0.142071309609 | 0.0115757488063 |
| 2032 | 7101 | 0.00492271151299 | 0.713325690283 | 0.0105059893958 |
| 2033 | 6694 | 0.00836665235933 | 0.135246463025 | 0.0101656268803 |
| 2034 | 5926 | 0.0103635483539 | 0.802052198676 | 0.00472841538231 |
| 2035 | 7749 | 0.00691970611926 | 1.08434066205 | 0.00442203695358 |
| 2036 | 7195 | 0.00944303231065 | 1.11408004421 | 0 |
| 2037 | 6244 | 0.00740056369222 | 0.244497688469 | 0 |
| 2038 | 7045 | 0.00663982052637 | 0.786982779491 | 0 |
| 2039 | 7737 | 0.00741119683574 | 0.16934233516 | 0 |
| 2040 | 11303 | 0.00168765200453 | 0.847574320609 | 0 |
| 2041 | 8094 | 0.0142157860271 | 0.586606707284 | 0 |
| 2042 | 10558 | 0.0070926959298 | 0.428179259221 | 0 |
| 2043 | 3315 | 0.00631400318134 | 1.09544972213 | 0 |
| 2044 | 3342 | 0.0000990426766288 | 0.789823514561 | 0 |
| 2045 | 3032 | 0.000745398155541 | 0.739456140122 | 0 |
| 2046 | 5268 | 0.00370860671964 | 0.50946247922 | 0 |
| 2047 | 4725 | 0.00260412305975 | 0.0391494129125 | 0 |
| 2048 | 4252 | 0.00143349248415 | 0.209523090374 | 0 |
| 2049 | 3739 | 0.000663172071808 | 0.245291621327 | 0 |
| 2050 | 10038 | 0.00947243160459 | 0.0239559175582 | 0 |
| 2051 | 7761 | 0.00479275463962 | 0.710017375703 | 0.0100193668234 |
| 2052 | 8118 | 0.0108556138102 | 0.0109349926259 | 0.0108910310306 |
| 2053 | 17038 | 0.00920578258962 | 0.180072826263 | 0.0237980411667 |
| 2054 | 45413 | 0.00591868440614 | 0.111604227363 | 0.0188962953805 |
| 2055 | 88944 | 0.00769539737751 | 0.245871933198 | 0.0191167820688 |
| 2056 | 92155 | 0.0131060170608 | 0.246863466022 | 0.0220473328669 |
| 2057 | 108994 | 0.00940026811332 | 0.021288012415 | 0.0363482819166 |
| 2058 | 110479 | 0.0100854914309 | 0.0917671681393 | 0.0455074226277 |
| 2059 | 123031 | 0.0117445756462 | 0.104513006288 | 0.0545686710836 |
| 2060 | 126017 | 0.00854484597546 | 0.943347626664 | 0.0626181799806 |

#### Spread across day-1 nudge sizes

Positive-grid range uses the completed subset of +§10, +§100, +§1,000 and +§10,000 (4/4); base-inclusive range adds the unnudged run. Later-day probes are excluded. A yearly cell is minimum…maximum (range).

| Set | Metric | Max yearly range | Year | Relative to base there | Min run | Max run |
|---|---|---:|---:|---:|---|---|
| positive grid | Population | 190441 | 2060 | 13.3423711239% | 256x60_s11_n10_d1 | 256x60_s11_n10000_d1 |
| positive grid | Air at homes | 0.0225289093709 | 2047 | 16.276964181% | 256x60_s11_n10000_d1 | 256x60_s11_n100_d1 |
| positive grid | Approval (points) | 4.82194572209 | 2014 | 6.86539377559% | 256x60_s11_n10000_d1 | 256x60_s11_n10_d1 |
| positive grid | I-HT share (fraction) | 0.116743085717 | 2060 | 113.066714177% | 256x60_s11_n10000_d1 | 256x60_s11_n10_d1 |
| base + grid | Population | 190441 | 2060 | 13.3423711239% | 256x60_s11_n10_d1 | 256x60_s11_n10000_d1 |
| base + grid | Air at homes | 0.0279660799477 | 2057 | 19.1666975893% | 256x60_s11_base | 256x60_s11_n1000_d1 |
| base + grid | Approval (points) | 4.82194572209 | 2014 | 6.86539377559% | 256x60_s11_n10000_d1 | 256x60_s11_n10_d1 |
| base + grid | I-HT share (fraction) | 0.116743085717 | 2060 | 113.066714177% | 256x60_s11_n10000_d1 | 256x60_s11_n10_d1 |

**Yearly positive grid ranges**

| Year | Population min…max (range) | Air min…max (range) | Approval min…max (range) | I-HT share min…max (range) |
|---:|---:|---:|---:|---:|
| 2010 | 96886…99694 (2808) | 0.0606476563068…0.0733153078864 (0.0126676515796) | 63.0079088076…64.5131653156 (1.50525650798) | 0…0.0154051251666 (0.0154051251666) |
| 2011 | 110224…114354 (4130) | 0.0548190335006…0.0698593946256 (0.015040361125) | 61.3751778717…63.4003528592 (2.02517498746) | 0…0.0136974425661 (0.0136974425661) |
| 2012 | 126096…130646 (4550) | 0.0497127203034…0.0649021550441 (0.0151894347407) | 61.745498222…63.5637266137 (1.8182283917) | 0…0.0129959236389 (0.0129959236389) |
| 2013 | 143209…147271 (4062) | 0.0482164861661…0.0584585093892 (0.0102420232231) | 63.0229830762…65.754763648 (2.73178057179) | 0…0.0124821820703 (0.0124821820703) |
| 2014 | 159869…165578 (5709) | 0.0462435253149…0.0564864818964 (0.0102429565815) | 65.9535618423…70.7755075644 (4.82194572209) | 0…0.0123161135819 (0.0123161135819) |
| 2015 | 179052…184918 (5866) | 0.0459873844775…0.0542460522013 (0.00825866772384) | 70.2828251982…70.7531452131 (0.470320014992) | 0…0.0123461480018 (0.0123461480018) |
| 2016 | 199401…203781 (4380) | 0.0498514346879…0.0549810333453 (0.00512959865735) | 69.4877684783…72.5095329448 (3.02176446645) | 0…0.0121361950781 (0.0121361950781) |
| 2017 | 218967…223144 (4177) | 0.0515647492163…0.0580824148266 (0.00651766561034) | 70.2990154948…73.1651225973 (2.86610710252) | 0…0.0118968692449 (0.0118968692449) |
| 2018 | 239605…244567 (4962) | 0.0517875197925…0.0572274241276 (0.00543990433502) | 70.8175666723…73.5319760845 (2.71440941225) | 0…0.012058057313 (0.012058057313) |
| 2019 | 261348…266202 (4854) | 0.0496565479625…0.0553801404045 (0.00572359244201) | 72.0316989205…75.1120313774 (3.08033245686) | 0…0.0119464621511 (0.0119464621511) |
| 2020 | 284274…289564 (5290) | 0.0486130123473…0.0542289280539 (0.00561591570657) | 73.2030611977…77.9136795433 (4.71061834556) | 0…0.0108414119737 (0.0108414119737) |
| 2021 | 307076…311515 (4439) | 0.0482664120814…0.0566084595972 (0.00834204751581) | 75.5605060621…78.5668023899 (3.00629632782) | 0…0.0119382022472 (0.0119382022472) |
| 2022 | 330387…334883 (4496) | 0.0504238749321…0.0556370197971 (0.00521314486501) | 75.647535796…78.8182412858 (3.17070548972) | 0…0.0119851576994 (0.0119851576994) |
| 2023 | 353769…359103 (5334) | 0.0523790874985…0.0599766717513 (0.00759758425285) | 76.0584544259…79.0272797276 (2.96882530177) | 0…0.0119864920028 (0.0119864920028) |
| 2024 | 378612…383094 (4482) | 0.0536134075107…0.060246229365 (0.00663282185422) | 76.4288726193…78.3673814994 (1.93850888016) | 0…0.0119780464288 (0.0119780464288) |
| 2025 | 403365…408729 (5364) | 0.0535698744482…0.0629580310288 (0.00938815658061) | 76.904645221…77.4926904174 (0.588045196378) | 0…0.0115821516074 (0.0115821516074) |
| 2026 | 428787…435344 (6557) | 0.0557264629466…0.065685611172 (0.00995914822536) | 76.849013122…78.5301702998 (1.68115717786) | 0…0.0117354328369 (0.0117354328369) |
| 2027 | 456217…463967 (7750) | 0.0567799180559…0.062316440315 (0.00553652225915) | 77.6416882913…78.8692939813 (1.22760569) | 0…0.0118725188291 (0.0118725188291) |
| 2028 | 483883…494317 (10434) | 0.0532915446285…0.0632946376505 (0.010003093022) | 78.1333126686…80.2695446733 (2.13623200466) | 0…0.0118384917984 (0.0118384917984) |
| 2029 | 514948…524398 (9450) | 0.0564278641919…0.065460899581 (0.00903303538907) | 79.1036508928…80.8997395052 (1.79608861231) | 0…0.0117520175536 (0.0117520175536) |
| 2030 | 544394…555470 (11076) | 0.0616347093905…0.0697412838765 (0.00810657448605) | 80.8501245868…81.5531012279 (0.70297664109) | 0…0.0118202430956 (0.0118202430956) |
| 2031 | 576539…586268 (9729) | 0.0609729044931…0.0739115467201 (0.012938642227) | 80.9234804993…82.3652856425 (1.44180514315) | 0…0.0115757488063 (0.0115757488063) |
| 2032 | 607744…619336 (11592) | 0.0674963217857…0.0800183036137 (0.012521981828) | 81.6735052804…82.3433616943 (0.669856413841) | 0…0.0105059893958 (0.0105059893958) |
| 2033 | 640881…651094 (10213) | 0.0674311157396…0.0850560958123 (0.0176249800727) | 82.0902952511…82.4971642138 (0.406868962726) | 0…0.0101656268803 (0.0101656268803) |
| 2034 | 673408…684918 (11510) | 0.0723626634763…0.0870446132665 (0.0146819497902) | 82.0153542112…82.3036317114 (0.288277500159) | 0…0.00472841538231 (0.00472841538231) |
| 2035 | 705741…717815 (12074) | 0.0784850185436…0.0938345707107 (0.0153495521671) | 81.795244826…83.0348970862 (1.23965226022) | 0…0.00442203695358 (0.00442203695358) |
| 2036 | 739553…752014 (12461) | 0.0824871976912…0.100799775338 (0.0183125776472) | 81.9368478875…83.1418741437 (1.20502625616) | 0…0 (0) |
| 2037 | 774313…787285 (12972) | 0.0907495732764…0.101905123945 (0.0111555506688) | 82.2512230651…82.899266434 (0.648043368961) | 0…0 (0) |
| 2038 | 808456…820868 (12412) | 0.0955384772806…0.112776174709 (0.0172376974289) | 82.0419777142…82.5325089984 (0.490531284188) | 0…0 (0) |
| 2039 | 842914…855786 (12872) | 0.100038944179…0.119086497634 (0.0190475534554) | 81.9198641327…83.0208501669 (1.10098603413) | 0…0 (0) |
| 2040 | 876890…890821 (13931) | 0.111619641421…0.120790804974 (0.00917116355316) | 82.2271742761…82.8624900983 (0.635315822203) | 0…0 (0) |
| 2041 | 913538…929121 (15583) | 0.109666135071…0.124133908368 (0.0144677732972) | 82.1474966319…82.6024101926 (0.454913560693) | 0…0 (0) |
| 2042 | 948264…966339 (18075) | 0.118994038515…0.130450086912 (0.0114560483975) | 81.4992581506…82.206823516 (0.707565365396) | 0…0 (0) |
| 2043 | 989776…1003925 (14149) | 0.12342797333…0.135476425365 (0.0120484520353) | 81.9147791184…82.719258448 (0.804479329681) | 0…0 (0) |
| 2044 | 1024640…1043404 (18764) | 0.127742422352…0.136740245089 (0.00899782273614) | 81.3885927267…82.4637089952 (1.07511626853) | 0…0 (0) |
| 2045 | 1062354…1075400 (13046) | 0.133971833279…0.144497808876 (0.0105259755963) | 79.6585254009…82.1067086463 (2.44818324544) | 0…0 (0) |
| 2046 | 1097929…1111931 (14002) | 0.132010990869…0.152200462738 (0.0201894718695) | 79.9648939657…81.901676903 (1.93678293724) | 0…0 (0) |
| 2047 | 1140033…1154597 (14564) | 0.135805651149…0.15833456052 (0.0225289093709) | 79.827824217…81.487103307 (1.65927909002) | 0…0 (0) |
| 2048 | 1181719…1193195 (11476) | 0.141163145969…0.154065361974 (0.0129022160049) | 79.5993902086…81.213309573 (1.61391936432) | 0…0 (0) |
| 2049 | 1221756…1231709 (9953) | 0.14488942744…0.158223704609 (0.0133342771692) | 80.2711868681…81.3410246059 (1.06983773779) | 0…0 (0) |
| 2050 | 1262065…1272920 (10855) | 0.147938929389…0.166325150971 (0.0183862215818) | 80.8090700457…80.9739799801 (0.164909934387) | 0…0.010858426612 (0.010858426612) |
| 2051 | 1302043…1320051 (18008) | 0.151265433906…0.158686038556 (0.00742060465007) | 80.0876129029…81.1318158926 (1.04420298969) | 0…0.0222940413756 (0.0222940413756) |
| 2052 | 1317205…1358455 (41250) | 0.150282369759…0.168981815447 (0.0186994456875) | 80.1431070897…80.7251923185 (0.582085228868) | 0…0.0350077257776 (0.0350077257776) |
| 2053 | 1325217…1403714 (78497) | 0.152030791663…0.160181117588 (0.00815032592539) | 79.9666025201…81.107340801 (1.14073828094) | 0…0.0533092572092 (0.0533092572092) |
| 2054 | 1332488…1439048 (106560) | 0.149278641771…0.164066569233 (0.0147879274628) | 80.3250126135…80.6783057311 (0.353293117601) | 0.0127301273013…0.0683839177698 (0.0556537904685) |
| 2055 | 1340556…1475358 (134802) | 0.152581048525…0.169564506624 (0.0169834580989) | 79.7993067423…80.9862263933 (1.18691965106) | 0.0215129057984…0.0802984713288 (0.0587855655304) |
| 2056 | 1342969…1492499 (149530) | 0.1578575613…0.163452230493 (0.00559466919294) | 79.8434485967…80.5142028638 (0.670754267057) | 0.0259452633166…0.101369108703 (0.0754238453861) |
| 2057 | 1347629…1512939 (165310) | 0.155310015045…0.17387582688 (0.0185658118344) | 79.4669768717…81.0958922261 (1.62891535435) | 0.0242111622287…0.11314204689 (0.0889308846612) |
| 2058 | 1350808…1525040 (174232) | 0.152556844958…0.169044912054 (0.0164880670955) | 79.7617252241…80.717239099 (0.955513874903) | 0.030737962913…0.130781297039 (0.100043334126) |
| 2059 | 1359648…1539648 (180000) | 0.159049072901…0.17184117358 (0.0127921006787) | 79.4484787975…80.7540176635 (1.30553886607) | 0.036467653359…0.149499207656 (0.113031554297) |
| 2060 | 1362916…1553357 (190441) | 0.156029903447…0.17186087664 (0.015830973193) | 80.340956516…81.271739906 (0.930783389964) | 0.0406333265013…0.157376412218 (0.116743085717) |

**Yearly base + grid ranges**

| Year | Population min…max (range) | Air min…max (range) | Approval min…max (range) | I-HT share min…max (range) |
|---:|---:|---:|---:|---:|
| 2010 | 96886…99694 (2808) | 0.0606476563068…0.0733153078864 (0.0126676515796) | 63.0079088076…64.5131653156 (1.50525650798) | 0…0.0154051251666 (0.0154051251666) |
| 2011 | 110224…114354 (4130) | 0.0548190335006…0.0698593946256 (0.015040361125) | 61.3751778717…63.4003528592 (2.02517498746) | 0…0.0136974425661 (0.0136974425661) |
| 2012 | 126096…130646 (4550) | 0.0497127203034…0.0649021550441 (0.0151894347407) | 61.745498222…63.5637266137 (1.8182283917) | 0…0.0129959236389 (0.0129959236389) |
| 2013 | 143209…147271 (4062) | 0.0482164861661…0.0584585093892 (0.0102420232231) | 63.0229830762…65.754763648 (2.73178057179) | 0…0.0124821820703 (0.0124821820703) |
| 2014 | 159869…165578 (5709) | 0.0462435253149…0.0564864818964 (0.0102429565815) | 65.9535618423…70.7755075644 (4.82194572209) | 0…0.0123161135819 (0.0123161135819) |
| 2015 | 179052…184918 (5866) | 0.0459873844775…0.0542460522013 (0.00825866772384) | 70.2828251982…70.8877589306 (0.604933732415) | 0…0.0123461480018 (0.0123461480018) |
| 2016 | 199401…203781 (4380) | 0.0498514346879…0.0549810333453 (0.00512959865735) | 69.4877684783…72.5095329448 (3.02176446645) | 0…0.0121361950781 (0.0121361950781) |
| 2017 | 218967…223144 (4177) | 0.0515647492163…0.0580824148266 (0.00651766561034) | 70.2990154948…73.1651225973 (2.86610710252) | 0…0.0118968692449 (0.0118968692449) |
| 2018 | 239605…244567 (4962) | 0.0517875197925…0.0572274241276 (0.00543990433502) | 70.8175666723…73.5319760845 (2.71440941225) | 0…0.012058057313 (0.012058057313) |
| 2019 | 261348…266202 (4854) | 0.0496565479625…0.0556510217607 (0.00599447379829) | 72.0316989205…75.1120313774 (3.08033245686) | 0…0.0119464621511 (0.0119464621511) |
| 2020 | 284274…289564 (5290) | 0.0486130123473…0.0557169253613 (0.00710391301394) | 73.2030611977…77.9136795433 (4.71061834556) | 0…0.0108414119737 (0.0108414119737) |
| 2021 | 307076…311515 (4439) | 0.0482664120814…0.0566084595972 (0.00834204751581) | 75.5605060621…78.5668023899 (3.00629632782) | 0…0.0119382022472 (0.0119382022472) |
| 2022 | 330387…334883 (4496) | 0.0504238749321…0.0584134414695 (0.00798956653742) | 75.647535796…78.8182412858 (3.17070548972) | 0…0.0119851576994 (0.0119851576994) |
| 2023 | 353769…359103 (5334) | 0.0523790874985…0.0611642692479 (0.00878518174942) | 76.0584544259…79.0272797276 (2.96882530177) | 0…0.0119864920028 (0.0119864920028) |
| 2024 | 378612…383094 (4482) | 0.0536134075107…0.0632593138714 (0.00964590636069) | 76.4288726193…78.3673814994 (1.93850888016) | 0…0.0119780464288 (0.0119780464288) |
| 2025 | 403365…408729 (5364) | 0.0535698744482…0.0629580310288 (0.00938815658061) | 76.904645221…78.0048748875 (1.10022966648) | 0…0.0115821516074 (0.0115821516074) |
| 2026 | 428787…435344 (6557) | 0.0557264629466…0.0670506912252 (0.0113242282786) | 76.849013122…78.5301702998 (1.68115717786) | 0…0.0117354328369 (0.0117354328369) |
| 2027 | 456217…463967 (7750) | 0.0567799180559…0.0657421438106 (0.00896222575469) | 77.6416882913…78.8692939813 (1.22760569) | 0…0.0118725188291 (0.0118725188291) |
| 2028 | 483883…494317 (10434) | 0.0532915446285…0.0632946376505 (0.010003093022) | 78.1333126686…80.2695446733 (2.13623200466) | 0…0.0118384917984 (0.0118384917984) |
| 2029 | 514948…524398 (9450) | 0.0564278641919…0.065460899581 (0.00903303538907) | 79.1036508928…81.6009226435 (2.49727175061) | 0…0.0117520175536 (0.0117520175536) |
| 2030 | 544394…555470 (11076) | 0.0616347093905…0.0697412838765 (0.00810657448605) | 80.8501245868…81.5531012279 (0.70297664109) | 0…0.0118202430956 (0.0118202430956) |
| 2031 | 576539…586268 (9729) | 0.0609729044931…0.0739115467201 (0.012938642227) | 80.9234804993…82.3652856425 (1.44180514315) | 0…0.0115757488063 (0.0115757488063) |
| 2032 | 607744…619336 (11592) | 0.0674963217857…0.0800183036137 (0.012521981828) | 81.6735052804…82.3868309707 (0.713325690283) | 0…0.0105059893958 (0.0105059893958) |
| 2033 | 640881…651094 (10213) | 0.0674311157396…0.0850560958123 (0.0176249800727) | 82.0902952511…82.4971642138 (0.406868962726) | 0…0.0101656268803 (0.0101656268803) |
| 2034 | 673408…684918 (11510) | 0.0723626634763…0.0870446132665 (0.0146819497902) | 82.0153542112…82.9694498342 (0.954095622955) | 0…0.00472841538231 (0.00472841538231) |
| 2035 | 705741…717815 (12074) | 0.0784850185436…0.0938345707107 (0.0153495521671) | 81.795244826…83.0348970862 (1.23965226022) | 0…0.00442203695358 (0.00442203695358) |
| 2036 | 739553…752014 (12461) | 0.0824871976912…0.100799775338 (0.0183125776472) | 81.9368478875…83.8068783412 (1.8700304537) | 0…0 (0) |
| 2037 | 774313…787285 (12972) | 0.0907495732764…0.101905123945 (0.0111555506688) | 82.2512230651…83.1437641225 (0.89254105743) | 0…0 (0) |
| 2038 | 808456…820868 (12412) | 0.0955384772806…0.112776174709 (0.0172376974289) | 82.0419777142…82.9540376397 (0.912059925487) | 0…0 (0) |
| 2039 | 842914…855786 (12872) | 0.100038944179…0.119086497634 (0.0190475534554) | 81.9198641327…83.0208501669 (1.10098603413) | 0…0 (0) |
| 2040 | 876890…890821 (13931) | 0.111619641421…0.120790804974 (0.00917116355316) | 82.2271742761…83.0747485967 (0.847574320609) | 0…0 (0) |
| 2041 | 913538…929121 (15583) | 0.109666135071…0.124133908368 (0.0144677732972) | 82.1474966319…82.7341033392 (0.586606707284) | 0…0 (0) |
| 2042 | 948264…966339 (18075) | 0.118994038515…0.130450086912 (0.0114560483975) | 81.4992581506…82.3437330942 (0.844474943646) | 0…0 (0) |
| 2043 | 989776…1003925 (14149) | 0.12342797333…0.135476425365 (0.0120484520353) | 81.6238087259…82.719258448 (1.09544972213) | 0…0 (0) |
| 2044 | 1024640…1043404 (18764) | 0.127742422352…0.136740245089 (0.00899782273614) | 81.3885927267…82.4637089952 (1.07511626853) | 0…0 (0) |
| 2045 | 1062354…1075400 (13046) | 0.133971833279…0.144497808876 (0.0105259755963) | 79.6585254009…82.1067086463 (2.44818324544) | 0…0 (0) |
| 2046 | 1097929…1111931 (14002) | 0.132010990869…0.152200462738 (0.0201894718695) | 79.9648939657…81.901676903 (1.93678293724) | 0…0 (0) |
| 2047 | 1140033…1154597 (14564) | 0.135805651149…0.15833456052 (0.0225289093709) | 79.827824217…81.487103307 (1.65927909002) | 0…0 (0) |
| 2048 | 1181719…1193195 (11476) | 0.141163145969…0.154065361974 (0.0129022160049) | 79.5993902086…81.4228326633 (1.82344245469) | 0…0 (0) |
| 2049 | 1221756…1231709 (9953) | 0.14488942744…0.158223704609 (0.0133342771692) | 80.2711868681…81.3410246059 (1.06983773779) | 0…0 (0) |
| 2050 | 1262065…1272920 (10855) | 0.140626416381…0.166325150971 (0.02569873459) | 80.8090700457…80.9739799801 (0.164909934387) | 0…0.010858426612 (0.010858426612) |
| 2051 | 1302043…1320051 (18008) | 0.146472679267…0.158686038556 (0.0122133592897) | 80.0876129029…81.1318158926 (1.04420298969) | 0…0.0222940413756 (0.0222940413756) |
| 2052 | 1317205…1358455 (41250) | 0.143862404618…0.168981815447 (0.0251194108289) | 80.1431070897…80.7251923185 (0.582085228868) | 0…0.0350077257776 (0.0350077257776) |
| 2053 | 1325217…1403714 (78497) | 0.142825009073…0.160181117588 (0.017356108515) | 79.9666025201…81.1771549768 (1.21055245669) | 0…0.0533092572092 (0.0533092572092) |
| 2054 | 1332488…1439048 (106560) | 0.143359957365…0.164066569233 (0.0207066118689) | 80.3250126135…80.6783057311 (0.353293117601) | 0.0127301273013…0.0683839177698 (0.0556537904685) |
| 2055 | 1340556…1475358 (134802) | 0.144885651148…0.169564506624 (0.0246788554764) | 79.7993067423…80.9862263933 (1.18691965106) | 0.0215129057984…0.0802984713288 (0.0587855655304) |
| 2056 | 1342969…1492499 (149530) | 0.144751544239…0.163452230493 (0.0187006862538) | 79.8434485967…80.5142028638 (0.670754267057) | 0.0259452633166…0.101369108703 (0.0754238453861) |
| 2057 | 1347629…1512939 (165310) | 0.145909746932…0.17387582688 (0.0279660799477) | 79.4669768717…81.1171802385 (1.65020336677) | 0.0242111622287…0.11314204689 (0.0889308846612) |
| 2058 | 1350808…1525040 (174232) | 0.142471353527…0.169044912054 (0.0265735585265) | 79.7617252241…80.7983833485 (1.03665812441) | 0.030737962913…0.130781297039 (0.100043334126) |
| 2059 | 1359648…1539648 (180000) | 0.147304497255…0.17184117358 (0.024536676325) | 79.4484787975…80.7540176635 (1.30553886607) | 0.036467653359…0.149499207656 (0.113031554297) |
| 2060 | 1362916…1553357 (190441) | 0.147485057472…0.17186087664 (0.0243758191684) | 80.340956516…81.3566945637 (1.01573804767) | 0.0406333265013…0.157376412218 (0.116743085717) |

**Stability across nudge sizes.** Compare the per-size maximum absolute drift in the same unit. The ratio is relative to this row’s smallest tested forking day-1 nudge; ∞ means its envelope is zero while the larger nudge’s is nonzero.

| Metric | Smallest fork: nudge / envelope | +§10,000 envelope | Ratio, +§10,000 / smallest fork |
|---|---:|---:|---:|
| Population | +§10 / 64424 | 126017 | 1.95605674904 |
| Air at homes | +§10 / 0.0176448591177 | 0.0142157860271 | 0.805661633924 |
| Approval (points) | +§10 / 2.1341464291 | 4.28196840858 | 2.00640797191 |
| I-HT share (fraction) | +§10 / 0.0584628832132 | 0.0626181799806 | 1.0710758098 |

### Recommendation and use by lanes

Use +§10 on day 1 as the common probe: it is the smallest tested nudge that changes the successful action trace on all three rows. This is a measured grid minimum, not the exact threshold. Prefer it to a larger endowment; carry the row/metric envelopes measured for that nudge and revalidate the fork on each new base.

Against the recommended probe sizes, +§10,000 has larger maximum drift in 8/12 row/metric comparisons, smaller drift in 4, and equal drift in 0. The tables retain the complete size response rather than assuming the envelope scales with the endowment.

Use the chosen perturbation’s row-specific, metric-specific absolute envelopes with NOTE-048’s `max(item tolerance, ±1%, envelope)` rule; preserve its systematic-shift and cross-seed direction checks. Do not substitute the full +§10,000 spread as extra tolerance simply because it is larger. The cross-size ranges diagnose stability and sensitivity, and the later-day experiment diagnoses timing sensitivity. No balance baseline was re-recorded. The existing +§1 section remains a valid no-fork control. Remeasure on the dev containing T041 before final lane gates.

### Reproduction and verification of this follow-up

The scratch scripts and their SHA256s are retained alongside the raw data. They are fixed to this measurement worktree/base; rebuild against a fresh target and update source provenance when measuring T041. The committed tree-parameterised runner is unchanged.

| Scratch script | SHA256 |
|---|---|
| [forkChild.mts](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forkChild.mts>) | `64311472ac88d789fbf8d5294a58c5a0406a76866d114bc4b2b4c07074ab7d4e` |
| [forkMatrix.mjs](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forkMatrix.mjs>) | `b918be720a87a40bf1889dbef7a6a29a957919eb28faf06e51310ecc13654343` |
| [forkNoiseReport.mjs](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forkNoiseReport.mjs>) | `9cd6099865d03ff07a6f90d2f1b0d8c8a4529501895f8803368b0f0551821ec6` |
| [validateForks.mjs](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/validateForks.mjs>) | `415cd395a3c602caae195c04d5f5c92df751c668a541ec024855151ba3622907` |

```powershell
C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/.bin/rolldown.cmd C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forkChild.mts --platform node --format esm --dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/fork-bundle --entry-file-names '[name].mjs' --chunk-file-names '[name]-[hash].mjs'
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forkMatrix.mjs
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forkMatrix.mjs --later '128,15,7,10,1800' '128,15,7,10,4320'
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forkNoiseReport.mjs --dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks --out C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/fork-noise-section.md
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/validateForks.mjs
```

The independent validator checked **17 complete runs, 705 annual observations, all 135 original-control hashes/rows, all 56 variant/metric envelopes, every first successful-command mismatch index, and both timing comparisons**. All passed. The 12 positive day-1 grid probes all fork; the day-1,800 probe forks, and the day-4,320 probe does not. The three controls still end at **192,899; 1,513,835; 1,427,340**.

`npx tsc --noEmit` passes. `tests/sim/botAaFundsNudge.test.ts`: **11 passed**, exit 0, through the quiet gate with the native-loader/thread-pool workaround already described in the original section:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/vitest/vitest.mjs run tests/sim/botAaFundsNudge.test.ts --maxWorkers=1 --configLoader native --pool threads
```

Do not point the original `--report-only` generator at this combined report when rebuilding its +§1 tables: it overwrites the destination. Generate its output into scratch, and build this section separately with `forkNoiseReport.mjs`. The old section was preserved byte for byte when this follow-up was appended.

No infra hunks, cloud-held edits, outside-scope repository hunks, cloud requests, baseline re-recording, commits, pushes or `.done` files. No browser checks occur in this task’s acceptance (checklist: N/A). Full-suite/GPU/browser checks, 256×60 later-day probes, sub-§10 threshold searches, negative nudges, and the post-T041 measurement were not run. The calibration’s common negative endpoint direction remains an explicit issue for the lead before accepting it as unbiased noise.
