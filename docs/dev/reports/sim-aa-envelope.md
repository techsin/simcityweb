# Shared SIM A/A envelope (NOTE-048)

> Current workflow: [NOTE-062 final gates and collectors](#note-062-final-gate-runner-and-observers) amends NOTE-053. Base rows and 256×60 variants go directly to nine members; only 128×15 variants start at five. Earlier measured tables and verdicts remain historical evidence, subject to the lead's NOTE-062 amendments.

Measured commit: `0df76bce1a663ee44957cf47cfecdb8b18eed187` (branch `local/T062-sim-aa-envelope`). Host: `none`; independent node processes.

Source fingerprint: `0e0f3bbcf84081835fd39008f3d94fad8f3eb3ba19e5fd6db33f2d0ce6f9730b`. Source diff SHA256: `55d5a6a875e74d27ceb696ab68e6d939dc8aa1be4efeb304745f0ec91bb2c50f`.

The working tree includes the funds-nudge instrumentation; the commit identifies the underlying base. Dirty paths at measurement:

- `M tools/simbot.ts`
- `?? tests/sim/botAaFundsNudge.test.ts`
- `?? tools/simAaEnvelope.mts`

Completed runs: **6/6**. All pairs are complete.

The specified +§1 perturbation produces no divergence in the measured metrics on this base: **all twelve row/metric envelopes are exactly zero**, both absolutely and relatively. Annual funds are exactly §1 higher in every nudged run (all years, including years 1–9); the perturbation was applied. This result does not estimate a larger perturbation's fork noise. It is a historical no-fork measurement; current NOTE-053 gates use ensemble medians and bands.

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

## How SIM lanes use this (NOTE-048, superseded by NOTE-053)

NOTE-053 now requires a lane's ensemble median to be inside dev's ensemble min-max band and its absolute median difference to be at most `max(item tolerance, half of dev's band)` in every year from year 10. The current systematic-shift check uses endpoint median differences greater than a quarter of dev's band in the same direction across all three rows.
Variant targets compare the variant and base ensemble medians at the same lane commit. The old absolute-envelope allowance does not apply; checks near their thresholds require the nine-run second stage described in Round 4.
This does not authorize compensating residential growth, weakening costs, free approval, re-recording a baseline to hide a miss, or changing the default bot strategy.

## Re-measure after T041 (historical +§1 protocol)

This command reproduces the original +§1 diagnostic. Current final gates use the NOTE-053 ensemble commands in Round 4; this earlier command is retained for provenance. A separate output/report keeps measurements distinguishable:

```powershell
node --experimental-strip-types 'C:\Users\techsin\Desktop\projects\simcityweb-T062\tools\simAaEnvelope.mts' --tree PATH_TO_DEV_WITH_T041 --out-dir FRESH_T041_SCRATCH --report T041_ENVELOPE_REPORT.md --quiet-gate 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs'
```

To rebuild either historical table from its completed JSON, repeat its runner command with `--report-only` and a separate report destination. SIM lanes now use the ensemble workflow in Round 4 for final gates.

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

No full suite, browser, GPU timing, separate Hard hashes or old-save continuation was run. T062 has no browser acceptance checks. The post-T041 remeasurement was outstanding at this first round and is completed as NOTE-053 ensembles in Round 4. For reproducible comparisons, keep the same runner and dependencies; use a fresh output directory after changing measurement code.

The session's no-commit/no-push/no-`.done` rule overrides the queued task's final push instruction. There are no infra hunks, cloud-held edits or cloud requests. See [the lane handoff](local-T062-sim-aa-envelope.md).


## Fork-noise envelopes

Measured on commit `3833c8d2379d3350663e624fe30be7867c559310` in `C:/Users/techsin/Desktop/projects/simcityweb-T062`, with **no simulation, bot, flag, or committed-runner edits**. This is an appended measurement section; the original +§1 result and all balance fixtures remain unchanged. Command blocks below use that working directory. The full original `say()` log and a successful-command journal are saved for every run; the CLI-equivalent commands reproduce simulation options, while `SIMBOT_LOG=1` is needed to print the CLI's full text log.

Round 2 measurement; generated from **17 completed runs**. All twelve day-1 grid runs and their three bases are present.

Original-control verification: **135 annual state hashes and 135 non-timing yearly rows** checked against the original raw controls (128x15_s7: 15/15; 256x60_s7: 60/60; 256x60_s11: 60/60). Counts require the recorded `baseMatchesCommittedRows: true` result; no unrecorded comparison is inferred.

The historical Round 2 recommendation was +§10 on day 1, the smallest tested positive-only nudge that changed the successful action trace on all three rows. Round 3's symmetric protocol rejected that size and selected §100; NOTE-053 uses that §100 size for ensemble members.

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

The following is a historical Round 2 diagnostic, **not a current acceptance gate**. It used the then-current NOTE-048 calculation: the endpoint diagnostic band is `max(1% × base final population, population envelope from year 10)`; the threshold below is half that diagnostic band. NOTE-053 replaces that gate rule. Signed endpoint percentages use the unnudged final population. A common direction across these three deterministic rows is a reason to investigate, not an estimate of statistical bias.

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

The historical Round 2 recommendation was +§10 on day 1, the smallest tested positive-only nudge that changed the successful action trace on all three rows. Round 3's symmetric protocol rejected that size and selected §100; NOTE-053 uses that §100 size for ensemble members.

Against the recommended probe sizes, +§10,000 has larger maximum drift in 8/12 row/metric comparisons, smaller drift in 4, and equal drift in 0. The tables retain the complete size response rather than assuming the envelope scales with the endowment.

This Round 2 recommendation is superseded: use NOTE-053's ensemble medians and bands for final gates, rather than any single-nudge envelope allowance. The cross-size ranges diagnose stability and sensitivity, and the later-day experiment diagnoses timing sensitivity. No balance baseline was re-recorded. The existing +§1 section remains a valid no-fork control; Round 4 measures the ensembles on dev and on the supplied T041 tree.

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

No infra hunks, cloud-held edits, outside-scope repository hunks, cloud requests, baseline re-recording, commits, pushes or `.done` files were made in Round 2. No browser checks occur in this task's acceptance (checklist: N/A). Full-suite/GPU/browser checks, 256×60 later-day probes, sub-§10 threshold searches, negative nudges, and the post-T041 measurement had not been run at that round; Rounds 3–4 add the signed/timed probes and T041 ensembles. The one-sided calibration's common negative endpoint direction motivated those follow-ups.


## NOTE-052 symmetric fork-noise protocol (Round 3)

**Chosen X: §100.** All twelve probes (±§100 on day 1 and at the start of year 5, across all three rows) change the complete action log against the unnudged control. This is the smallest qualifying common size in the mandated §10/§100/§1,000/§10,000 grid; it is not an exact sub-grid threshold. In this chosen-size matrix, the three unnudged controls and three +§100 day-1 probes are reused from Round 2 because the simulation source is unchanged; nine missing probes complete that matrix. Failed smaller-size probes are additional selection evidence, not part of the chosen-size envelope.

This section superseded Round 2's one-sided probe recommendation. NOTE-053 subsequently replaced NOTE-052's base and variant margin guidance with ensemble medians and bands, measured in Round 4. No balance fixture or baseline has been re-recorded. The Round 2 sweep above remains supporting evidence, including its non-monotonic size response.

The year-5 injection is before the first bot `daily()` of year 5: loop day **1441**, after advancing the city clock, before that day’s monthly decisions. The city calendar day is zero-based at a year boundary, so day 1440 is the preceding annual checkpoint; injecting there would affect the end-of-year-4 callback and is not the timing used here. Day-1 probes use the committed funds-nudge flag. The later probes change only funds once in the scratch wrapper.

The fork criterion is the **complete `say()` action log**, comparing ordered `{day, text}` entries. Each first differing pair below comes from its longest common prefix; an inserted event is paired with the next control event, which can be later. The successful-command journal is supplemental evidence: successful non-preview CityActions calls, unchanged tax/funding setters omitted, with no failed attempts/private branches recorded. Indices are one-based. Calendar dates are copied from the log; run year is `ceil(day / 360)`.

Metrics match the earlier sections: population; `stats.avgAir` at homes (the balance-test air metric); approval points; I-HT industrial jobs divided by I-D + I-M + I-HT jobs, excluding agriculture. No industrial jobs means share 0. I-HT shares and deltas are fractions (×100 gives percentage points). Tables use 12 significant digits; linked raw JSON preserves full precision.

### Smaller-size selection failures

A common candidate fails as soon as any required signed/timed probe has an identical complete action log to its control. Finishing the other probes cannot make that candidate qualify. The following completed, source-matched records justify advancing to the next grid size; they are excluded from the selected envelope.

| Rejected X | Non-forking probe | Complete log | Successful journal | Annual population / air / approval / I-HT | Annual funds Δ |
|---:|---|---|---|---|---|
| §10 | [256x60_s11_n-10_d1](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_n-10_d1.json>) | identical | identical | all four identical for all 60 checkpoints | -10 |

In particular, the 256×60 seed-11 −§10 day-1 run keeps funds exactly §10 below control at every yearly checkpoint while leaving all four metrics, all successful commands, and the full action log identical. Consequently §10 does not satisfy the symmetric protocol, despite its three positive day-1 forks in Round 2.

Failed-probe provenance: `256x60_s11_n-10_d1`, simbot `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`, source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. Exact command:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s11_n-10_d1.spec.json
```

### Chosen-size first differing decisions

| Row | Probe | First differing complete action-log entries | First differing successful commands (supplemental) |
|---|---|---|---|
| 128x15_s7 | +§100 / day 1 | #178: control day 1230; Jun 2003; run year 4; calendar year 2003: `developed R block (7,2) as zone 2`; probe day 1200; May 2003; run year 4; calendar year 2003: `built Medical Clinic ($1802)` | #406: control day 1230; Jun 2003; run year 4: `buildNetwork([{"from":{"x":64,"z":19},"to":{"x":73,"z":19},"length":10,"hash":"6cd8ca1364a2a1850611e54e73afd56540f7b90ecf149cbada1d8a20dc99f4de"},2])`; cost `180`; affected `9`; probe day 1200; May 2003; run year 4: `buildNetwork([{"from":{"x":91,"z":73},"to":{"x":100,"z":73},"length":10,"hash":"b0055ac6cd2b2849d614e01ac7193268218ed63c2b420639bf51a787a79b7a17"},3])`; cost `364`; affected `10` |
| 128x15_s7 | −§100 / day 1 | #299: control day 2010; Aug 2005; run year 6; calendar year 2005: `cleared 1 small lots for Bus Stop ($150)`; probe day 2010; Aug 2005; run year 6; calendar year 2005: `built 3 bus stops` | #632: control day 2010; Aug 2005; run year 6: `bulldoze([{"x0":33,"z0":68,"x1":37,"z1":69}])`; cost `29`; affected `4`; probe day 2040; Sep 2005; run year 6: `buildNetwork([{"from":{"x":64,"z":118},"to":{"x":73,"z":118},"length":10,"hash":"6e1606cb0a6129283cf8ea3c7af65b1751107084de59ca4108aff4ec12050af7"},2])`; cost `180`; affected `9` |
| 128x15_s7 | +§100 / day 1441 | #215: control day 1560; May 2004; run year 5; calendar year 2004: `developed R block (10,11) as zone 2`; probe day 1530; Apr 2004; run year 5; calendar year 2004: `built Medical Clinic ($1800)` | #500: control day 1560; May 2004; run year 5: `buildNetwork([{"from":{"x":91,"z":109},"to":{"x":100,"z":109},"length":10,"hash":"cb9cce3aec34337e83b1f515977c6a7b70a96f1e77f28287a44ce5b6837b1bb4"},3])`; cost `380`; affected `10`; probe day 1530; Apr 2004; run year 5: `plop(["civ_clinic",14,65,0])`; cost `1800`; affected `1` |
| 128x15_s7 | −§100 / day 1441 | #299: control day 2010; Aug 2005; run year 6; calendar year 2005: `cleared 1 small lots for Bus Stop ($150)`; probe day 2010; Aug 2005; run year 6; calendar year 2005: `built 3 bus stops` | #632: control day 2010; Aug 2005; run year 6: `bulldoze([{"x0":33,"z0":68,"x1":37,"z1":69}])`; cost `29`; affected `4`; probe day 2040; Sep 2005; run year 6: `buildNetwork([{"from":{"x":64,"z":118},"to":{"x":73,"z":118},"length":10,"hash":"6e1606cb0a6129283cf8ea3c7af65b1751107084de59ca4108aff4ec12050af7"},2])`; cost `180`; affected `9` |
| 256x60_s7 | +§100 / day 1 | #139: control day 750; Feb 2002; run year 3; calendar year 2002: `rezoned (12,16) to 2`; probe day 750; Feb 2002; run year 3; calendar year 2002: `developed C block (17,9) as zone 5` | #270: control day 720; Jan 2002; run year 2: `setTax([0,10])`; cost ``; affected ``; probe day 720; Jan 2002; run year 2: `buildNetwork([{"from":{"x":155,"z":137},"to":{"x":164,"z":137},"length":10,"hash":"df70dcd77b3b1f0bd971eb79afc0bd8790992c04626009ac39e4eca9b1e6f5d6"},2])`; cost `180`; affected `9` |
| 256x60_s7 | −§100 / day 1 | #206: control day 1530; Apr 2004; run year 5; calendar year 2004: `built Medical Clinic ($1800)`; probe day 1560; May 2004; run year 5; calendar year 2004: `developed R block (9,18) as zone 2` | #466: control day 1530; Apr 2004; run year 5: `plop(["civ_clinic",132,93,0])`; cost `1800`; affected `1`; probe day 1560; May 2004; run year 5: `buildNetwork([{"from":{"x":83,"z":173},"to":{"x":92,"z":173},"length":10,"hash":"a1e8382fabc117eda9e9711a082a91b10dc6c73cfaadec5cf02fbfa85ef6ed2b"},2])`; cost `208`; affected `10` |
| 256x60_s7 | +§100 / day 1441 | #550: control day 2850; Dec 2007; run year 8; calendar year 2007: `developed R block (11,20) as zone 2`; probe day 2820; Nov 2007; run year 8; calendar year 2007: `rezoned (13,11) to 3` | #1033: control day 2850; Dec 2007; run year 8: `setTax([0,9.5])`; cost ``; affected ``; probe day 2820; Nov 2007; run year 8: `zone([{"x0":120,"z0":102,"x1":128,"z1":110},3])`; cost `1220`; affected `61` |
| 256x60_s7 | −§100 / day 1441 | #206: control day 1530; Apr 2004; run year 5; calendar year 2004: `built Medical Clinic ($1800)`; probe day 1560; May 2004; run year 5; calendar year 2004: `developed R block (9,18) as zone 2` | #466: control day 1530; Apr 2004; run year 5: `plop(["civ_clinic",132,93,0])`; cost `1800`; affected `1`; probe day 1560; May 2004; run year 5: `buildNetwork([{"from":{"x":83,"z":173},"to":{"x":92,"z":173},"length":10,"hash":"a1e8382fabc117eda9e9711a082a91b10dc6c73cfaadec5cf02fbfa85ef6ed2b"},2])`; cost `208`; affected `10` |
| 256x60_s11 | +§100 / day 1 | #168: control day 1110; Feb 2003; run year 4; calendar year 2003: `saving for a prison ($12000): 26 % of the sentenced have no bed`; probe day 1110; Feb 2003; run year 4; calendar year 2003: `built Prison ($12000)` | #390: control day 1110; Feb 2003; run year 4: `buildNetwork([{"from":{"x":92,"z":92},"to":{"x":92,"z":101},"length":10,"hash":"5061b4da1e89bd278af646c00c717cf66899e1fc7626353b9097eddf6bcc514d"},2])`; cost `160`; affected `8`; probe day 1110; Feb 2003; run year 4: `buildNetwork([{"from":{"x":173,"z":137},"to":{"x":182,"z":137},"length":10,"hash":"c9f18e69eb9dacc01a55339e5aed6bda6310c11c9d8c1dab13f5b6b54d4ce462"},2])`; cost `180`; affected `9` |
| 256x60_s11 | −§100 / day 1 | #177: control day 1230; Jun 2003; run year 4; calendar year 2003: `developed I block (19,11) as zone 8`; probe day 1260; Jul 2003; run year 4; calendar year 2003: `developed R block (9,10) as zone 2` | #407: control day 1230; Jun 2003; run year 4: `buildNetwork([{"from":{"x":173,"z":101},"to":{"x":182,"z":101},"length":10,"hash":"78b46f267615579c3e44d8ccc0188ccef0309721e9632df3f42045f850310b09"},2])`; cost `180`; affected `9`; probe day 1260; Jul 2003; run year 4: `buildNetwork([{"from":{"x":83,"z":101},"to":{"x":92,"z":101},"length":10,"hash":"59eed3a785933bbacd26349156a217c52549158e7a2f7e844b652920dbd5ccf5"},2])`; cost `190`; affected `9` |
| 256x60_s11 | +§100 / day 1441 | #245: control day 1830; Feb 2005; run year 6; calendar year 2005: `built Medical Clinic ($1800)`; probe day 1830; Feb 2005; run year 6; calendar year 2005: `built Police Station ($1500)` | #555: control day 1830; Feb 2005; run year 6: `plop(["civ_clinic",150,93,0])`; cost `1800`; affected `1`; probe day 1830; Feb 2005; run year 6: `plop(["civ_police_station",120,96,0])`; cost `1500`; affected `1` |
| 256x60_s11 | −§100 / day 1441 | #299: control day 2010; Aug 2005; run year 6; calendar year 2005: `cleared 1 small lots for Bus Stop ($150)`; probe day 2040; Sep 2005; run year 6; calendar year 2005: `built Water Pump ($502)` | #629: control day 2010; Aug 2005; run year 6: `bulldoze([{"x0":116,"z0":114,"x1":119,"z1":115}])`; cost `23`; affected `3`; probe day 2040; Sep 2005; run year 6: `plop(["util_water_pump",123,154,0])`; cost `502`; affected `1` |

### Selected symmetric envelope

For each row and metric, the envelope is `max |probe − control|` over all four signed/timed runs and every annual checkpoint from **year 10 (2010), inclusive**, through the row’s end. The percentage in the first percentage column divides the absolute maximum by the control **at the same winning year**. The independently maximized annual percentage is reported separately; it can peak in a different run/year. Zero/zero is 0%; nonzero/zero is ∞, so use the absolute metric unit in that case. Ties retain the first timing/sign/year encountered (+day1, −day1, +year5, −year5; chronological years).

| Row | Metric | Max absolute Δ | Winning probe / year | Signed Δ there | Control there | % of control there | Max annual relative Δ / winning probe / year |
|---|---|---:|---|---:|---:|---:|---|
| 128x15_s7 | Population | 2767 | +§100 / day 1 / 2015 | -2767 | 192899 | 1.43442941643% | 1.43442941643% / +§100 / day 1 / 2015 |
| 128x15_s7 | Air at homes | 0.00560960939425 | +§100 / day 1441 / 2015 | +0.00560960939425 | 0.0908835924374 | 6.1723015605% | 6.53408693626% / −§100 / day 1 / 2010 |
| 128x15_s7 | Approval (points) | 1.92919785979 | +§100 / day 1441 / 2012 | +1.92919785979 | 75.0662775328 | 2.56999270937% | 2.65746204589% / +§100 / day 1441 / 2010 |
| 128x15_s7 | I-HT share (fraction) | 0 | +§100 / day 1 / 2010 | 0 | 0 | 0% | 0% / +§100 / day 1 / 2010 |
| 256x60_s7 | Population | 133913 | +§100 / day 1 / 2060 | -133913 | 1513835 | 8.84594424095% | 8.84594424095% / +§100 / day 1 / 2060 |
| 256x60_s7 | Air at homes | 0.0248380385345 | −§100 / day 1 / 2056 | -0.0248380385345 | 0.179043508252 | 13.8726272609% | 17.7282071198% / +§100 / day 1441 / 2019 |
| 256x60_s7 | Approval (points) | 5.50529078302 | −§100 / day 1 / 2013 | -5.50529078302 | 67.7892603094 | 8.12118432609% | 8.12118432609% / −§100 / day 1 / 2013 |
| 256x60_s7 | I-HT share (fraction) | 0.0511209163901 | +§100 / day 1 / 2054 | +0.0511209163901 | 0.0236319752152 | 216.320963121% | ∞% / +§100 / day 1 / 2048 |
| 256x60_s11 | Population | 87489 | +§100 / day 1441 / 2059 | +87489 | 1416617 | 6.17591063781% | 6.17591063781% / +§100 / day 1441 / 2059 |
| 256x60_s11 | Air at homes | 0.0406407867526 | −§100 / day 1 / 2057 | +0.0406407867526 | 0.145909746932 | 27.8533734772% | 27.9314906143% / −§100 / day 1 / 2058 |
| 256x60_s11 | Approval (points) | 5.42848638277 | −§100 / day 1 / 2014 | -5.42848638277 | 70.2355302508 | 7.72897472744% | 7.72897472744% / −§100 / day 1 / 2014 |
| 256x60_s11 | I-HT share (fraction) | 0.103251506482 | −§100 / day 1441 / 2060 | -0.103251506482 | 0.103251506482 | 100% | 100% / +§100 / day 1441 / 2051 |

### Real-effect direction checks

The diagnostic asks whether both signs consistently align with the nudge (+ up / − down), consistently reverse it (+ down / − up), or both signs move the metric up or down. Endpoint and mean classifications require a **strict nonzero direction in every row** for a timing; the combined column requires all six positive probes and all six negative probes across both timings. The annual classification is stricter: it flattens every paired annual delta from year 10 onward and requires that same nonzero pattern at **every checkpoint of every applicable trajectory**. A zero delta does not establish a direction. These are descriptive checks, not additional gates or proof that money has no effect.

Endpoint checks compare each row’s final year against its control. Mean checks average **paired signed annual deltas** from year 10 through the end (six samples for the 128 row, 51 for each 256 row). Mean percentages divide by the mean control over those same years. Endpoint/mean summaries do not imply a sign held throughout the trajectory: the explicit annual classification tests that requirement, and the annual sign-count table below retains reversals and zeros.

| Metric | Summary | Day 1, all three rows | Year 5, all three rows | Both timings, all rows |
|---|---|---|---|---|
| Population | endpoint | mixed or zero | mixed or zero | mixed or zero |
| Population | mean | mixed or zero | mixed or zero | mixed or zero |
| Population | annual | mixed or zero | mixed or zero | mixed or zero |
| Air at homes | endpoint | mixed or zero | mixed or zero | mixed or zero |
| Air at homes | mean | mixed or zero | mixed or zero | mixed or zero |
| Air at homes | annual | mixed or zero | mixed or zero | mixed or zero |
| Approval (points) | endpoint | mixed or zero | mixed or zero | mixed or zero |
| Approval (points) | mean | mixed or zero | mixed or zero | mixed or zero |
| Approval (points) | annual | mixed or zero | mixed or zero | mixed or zero |
| I-HT share (fraction) | endpoint | mixed or zero | mixed or zero | mixed or zero |
| I-HT share (fraction) | mean | mixed or zero | mixed or zero | mixed or zero |
| I-HT share (fraction) | annual | mixed or zero | mixed or zero | mixed or zero |

**Direction patterns that meet the strict all-row test:**
No metric has one of the strict all-row direction patterns in endpoint, mean, or every-annual-checkpoint checks, at either timing or across both timings.

**Within-row agreement between positive and negative probes**

A separate reading of “both signs move a metric the same direction in every row” allows the shared direction to differ across rows. This pairwise test requires nonzero + and − deltas with matching signs within each of the three rows. The qualifying endpoint/mean cases below show actual signed deltas as `+ probe Δ / − probe Δ`. They are within-row concordances, **not additional flags for a common direction across rows**.

| Metric | Summary | Timing | 128×15 s7: + Δ / − Δ | 256×60 s7: + Δ / − Δ | 256×60 s11: + Δ / − Δ |
|---|---|---:|---:|---:|---:|
| Population | endpoint | 1 | -2767 / -1311 | -133913 / -52748 | +56178 / +71451 |
| Air at homes | endpoint | 1 | +0.000809537058363 / +0.00198947417753 | -0.0203231686575 / -0.0114359563202 | +0.0213970798684 / +0.0350765371117 |
| Air at homes | mean | 1 | +0.00103222662238 / +0.0000362128313091 | -0.00929403977621 / -0.00603037782527 | +0.00515633359313 / +0.0163988099227 |
| Approval (points) | mean | 1 | +0.28075996588 / +0.0274575606952 | -0.26624486122 / -0.184315987357 | -0.80333473934 / -1.31604041601 |
| Approval (points) | mean | 1441 | +1.42320444747 / +0.0274575606952 | -0.690025697882 / -0.184315987357 | -0.79149782196 / -0.312785739121 |

No metric/timing has strict within-row +/− concordance at every year-10-onward checkpoint across all three rows. The endpoint/mean concordances above do not persist throughout every trajectory.


**Signed endpoint deltas and values**

| Metric | Row | Timing | Control | + probe value | + signed Δ (%) | − probe value | − signed Δ (%) |
|---|---|---:|---:|---:|---:|---:|---:|
| Population | 128x15_s7 | 1 | 192899 | 190132 | -2767 (-1.43442941643%) | 191588 | -1311 (-0.679630272837%) |
| Population | 128x15_s7 | 1441 | 192899 | 193108 | +209 (+0.10834685509%) | 191588 | -1311 (-0.679630272837%) |
| Population | 256x60_s7 | 1 | 1513835 | 1379922 | -133913 (-8.84594424095%) | 1461087 | -52748 (-3.48439559133%) |
| Population | 256x60_s7 | 1441 | 1513835 | 1504801 | -9034 (-0.59676252696%) | 1461087 | -52748 (-3.48439559133%) |
| Population | 256x60_s11 | 1 | 1427340 | 1483518 | +56178 (+3.93585270503%) | 1498791 | +71451 (+5.00588507293%) |
| Population | 256x60_s11 | 1441 | 1427340 | 1503201 | +75861 (+5.31485140191%) | 1472527 | +45187 (+3.16581893592%) |
| Air at homes | 128x15_s7 | 1 | 0.0908835924374 | 0.0916931294957 | +0.000809537058363 (+0.890740601964%) | 0.0928730666149 | +0.00198947417753 (+2.18903558296%) |
| Air at homes | 128x15_s7 | 1441 | 0.0908835924374 | 0.0964932018316 | +0.00560960939425 (+6.1723015605%) | 0.0928730666149 | +0.00198947417753 (+2.18903558296%) |
| Air at homes | 256x60_s7 | 1 | 0.178626333759 | 0.158303165101 | -0.0203231686575 (-11.3774762264%) | 0.167190377439 | -0.0114359563202 (-6.4021670711%) |
| Air at homes | 256x60_s7 | 1441 | 0.178626333759 | 0.183209193398 | +0.00458285963956 (+2.5656125517%) | 0.167190377439 | -0.0114359563202 (-6.4021670711%) |
| Air at homes | 256x60_s11 | 1 | 0.147485057472 | 0.16888213734 | +0.0213970798684 (+14.5079645594%) | 0.182561594583 | +0.0350765371117 (+23.7831124814%) |
| Air at homes | 256x60_s11 | 1441 | 0.147485057472 | 0.171516885347 | +0.0240318278749 (+16.2944153712%) | 0.177723910876 | +0.030238853404 (+20.5029946236%) |
| Approval (points) | 128x15_s7 | 1 | 81.3650175025 | 81.556299867 | +0.191282364456 (+0.23509165281%) | 80.9060989013 | -0.458918601182 (-0.564024460718%) |
| Approval (points) | 128x15_s7 | 1441 | 81.3650175025 | 81.3803027179 | +0.015285215385 (+0.0187859793486%) | 80.9060989013 | -0.458918601182 (-0.564024460718%) |
| Approval (points) | 256x60_s7 | 1 | 80.3574246959 | 79.9395016464 | -0.417923049509 (-0.520080193075%) | 80.5414097299 | +0.183985033973 (+0.228958350357%) |
| Approval (points) | 256x60_s7 | 1441 | 80.3574246959 | 79.7398013242 | -0.617623371738 (-0.768595278004%) | 80.5414097299 | +0.183985033973 (+0.228958350357%) |
| Approval (points) | 256x60_s11 | 1 | 81.3566945637 | 81.271739906 | -0.0849546577103 (-0.104422454926%) | 79.1371672705 | -2.21952729322 (-2.72814340003%) |
| Approval (points) | 256x60_s11 | 1441 | 81.3566945637 | 80.4411987232 | -0.915495840463 (-1.12528642587%) | 79.9558196962 | -1.4008748675 (-1.721892556%) |
| I-HT share (fraction) | 128x15_s7 | 1 | 0 | 0 | 0 (0%) | 0 | 0 (0%) |
| I-HT share (fraction) | 128x15_s7 | 1441 | 0 | 0 | 0 (0%) | 0 | 0 (0%) |
| I-HT share (fraction) | 256x60_s7 | 1 | 0.10239866758 | 0.137623904611 | +0.0352252370316 (+34.4000931497%) | 0.126146721117 | +0.0237480535376 (+23.191760302%) |
| I-HT share (fraction) | 256x60_s7 | 1441 | 0.10239866758 | 0.114821932244 | +0.0124232646645 (+12.1322522628%) | 0.126146721117 | +0.0237480535376 (+23.191760302%) |
| I-HT share (fraction) | 256x60_s11 | 1 | 0.103251506482 | 0.0886738163746 | -0.0145776901074 (-14.1186221917%) | 0.0819100032892 | -0.0213415031927 (-20.6694351684%) |
| I-HT share (fraction) | 256x60_s11 | 1441 | 0.103251506482 | 0.00458502431922 | -0.0986664821627 (-95.5593632718%) | 0 | -0.103251506482 (-100%) |

**Signed mean annual (year ≥10) deltas and values**

| Metric | Row | Timing | Control | + probe value | + signed Δ (%) | − probe value | − signed Δ (%) |
|---|---|---:|---:|---:|---:|---:|---:|
| Population | 128x15_s7 | 1 | 145151 | 143488.833333 | -1662.16666667 (-1.14512932509%) | 145007.666667 | -143.333333333 (-0.0987477408584%) |
| Population | 128x15_s7 | 1441 | 145151 | 146102.5 | +951.5 (+0.655524247163%) | 145007.666667 | -143.333333333 (-0.0987477408584%) |
| Population | 256x60_s7 | 1 | 760259.72549 | 744441.215686 | -15818.5098039 (-2.08067181169%) | 755811.72549 | -4448 (-0.585063216012%) |
| Population | 256x60_s7 | 1441 | 760259.72549 | 754882.196078 | -5377.52941176 (-0.707327934318%) | 755811.72549 | -4448 (-0.585063216012%) |
| Population | 256x60_s11 | 1 | 752842.745098 | 759306.215686 | +6463.47058824 (+0.85854192397%) | 751880.27451 | -962.470588235 (-0.127844838049%) |
| Population | 256x60_s11 | 1441 | 752842.745098 | 761658.058824 | +8815.31372549 (+1.17093692978%) | 756043.411765 | +3200.66666667 (+0.425144120403%) |
| Air at homes | 128x15_s7 | 1 | 0.0788612141128 | 0.0798934407352 | +0.00103222662238 (+1.30891545862%) | 0.0788974269442 | +0.0000362128313091 (+0.0459196979358%) |
| Air at homes | 128x15_s7 | 1441 | 0.0788612141128 | 0.0801837869565 | +0.00132257284366 (+1.67708912237%) | 0.0788974269442 | +0.0000362128313091 (+0.0459196979358%) |
| Air at homes | 256x60_s7 | 1 | 0.109373713422 | 0.100079673646 | -0.00929403977621 (-8.49750775156%) | 0.103343335597 | -0.00603037782527 (-5.51355315331%) |
| Air at homes | 256x60_s7 | 1441 | 0.109373713422 | 0.116133311679 | +0.00675959825713 (+6.18027681939%) | 0.103343335597 | -0.00603037782527 (-5.51355315331%) |
| Air at homes | 256x60_s11 | 1 | 0.096718281946 | 0.101874615539 | +0.00515633359313 (+5.33129155045%) | 0.113117091869 | +0.0163988099227 (+16.9552328606%) |
| Air at homes | 256x60_s11 | 1441 | 0.096718281946 | 0.105752983059 | +0.0090347011134 (+9.34125475724%) | 0.105208997286 | +0.00849071534004 (+8.77881117118%) |
| Approval (points) | 128x15_s7 | 1 | 75.8376461233 | 76.1184060892 | +0.28075996588 (+0.370211867367%) | 75.865103684 | +0.0274575606952 (+0.0362057132556%) |
| Approval (points) | 128x15_s7 | 1441 | 75.8376461233 | 77.2608505708 | +1.42320444747 (+1.876646389%) | 75.865103684 | +0.0274575606952 (+0.0362057132556%) |
| Approval (points) | 256x60_s7 | 1 | 77.4873848716 | 77.2211400104 | -0.26624486122 (-0.343597685818%) | 77.3030688842 | -0.184315987357 (-0.237865799268%) |
| Approval (points) | 256x60_s7 | 1441 | 77.4873848716 | 76.7973591737 | -0.690025697882 (-0.89050069121%) | 77.3030688842 | -0.184315987357 (-0.237865799268%) |
| Approval (points) | 256x60_s11 | 1 | 78.5384389162 | 77.7351041769 | -0.80333473934 (-1.02285549653%) | 77.2223985002 | -1.31604041601 (-1.67566408776%) |
| Approval (points) | 256x60_s11 | 1441 | 78.5384389162 | 77.7469410943 | -0.79149782196 (-1.00778400091%) | 78.2256531771 | -0.312785739121 (-0.398258156691%) |
| I-HT share (fraction) | 128x15_s7 | 1 | 0 | 0 | 0 (0%) | 0 | 0 (0%) |
| I-HT share (fraction) | 128x15_s7 | 1441 | 0 | 0 | 0 (0%) | 0 | 0 (0%) |
| I-HT share (fraction) | 256x60_s7 | 1 | 0.00979833418844 | 0.0182901750615 | +0.00849184087309 (+86.6661690628%) | 0.0153588607647 | +0.0055605265763 (+56.7497134651%) |
| I-HT share (fraction) | 256x60_s7 | 1441 | 0.00979833418844 | 0.0118073169191 | +0.0020089827307 (+20.5033089509%) | 0.0153588607647 | +0.0055605265763 (+56.7497134651%) |
| I-HT share (fraction) | 256x60_s11 | 1 | 0.00973947278981 | 0.00812634116302 | -0.00161313162679 (-16.5628228714%) | 0.00805019274808 | -0.00168928004173 (-17.3446764336%) |
| I-HT share (fraction) | 256x60_s11 | 1441 | 0.00973947278981 | 0.000540672922461 | -0.00919879986735 (-94.4486428154%) | 0 | -0.00973947278981 (-100%) |

**Annual sign persistence (year ≥10)**

Each count is an annual checkpoint against the paired unnudged control. The minimum/maximum are signed deltas. A trajectory with both up and down counts changes direction; zero checkpoints are retained. Strict across-trajectory direction is established only when every checkpoint has that nonzero sign.

| Metric | Row | Probe | Annual up / down / zero | Minimum signed Δ | Maximum signed Δ |
|---|---|---|---:|---:|---:|
| Population | 128x15_s7 | +§100 / day 1 | 0 / 6 / 0 | -2767 | -569 |
| Population | 128x15_s7 | −§100 / day 1 | 3 / 3 / 0 | -1311 | +667 |
| Population | 128x15_s7 | +§100 / day 1441 | 6 / 0 / 0 | +209 | +1887 |
| Population | 128x15_s7 | −§100 / day 1441 | 3 / 3 / 0 | -1311 | +667 |
| Population | 256x60_s7 | +§100 / day 1 | 35 / 16 / 0 | -133913 | +4393 |
| Population | 256x60_s7 | −§100 / day 1 | 42 / 9 / 0 | -57162 | +12855 |
| Population | 256x60_s7 | +§100 / day 1441 | 16 / 35 / 0 | -40517 | +2549 |
| Population | 256x60_s7 | −§100 / day 1441 | 42 / 9 / 0 | -57162 | +12855 |
| Population | 256x60_s11 | +§100 / day 1 | 26 / 25 / 0 | -5150 | +66063 |
| Population | 256x60_s11 | −§100 / day 1 | 9 / 42 / 0 | -18786 | +71451 |
| Population | 256x60_s11 | +§100 / day 1441 | 17 / 34 / 0 | -9853 | +87489 |
| Population | 256x60_s11 | −§100 / day 1441 | 11 / 40 / 0 | -11773 | +58143 |
| Air at homes | 128x15_s7 | +§100 / day 1 | 6 / 0 / 0 | +0.00012233718726 | +0.00294449733518 |
| Air at homes | 128x15_s7 | −§100 / day 1 | 4 / 2 / 0 | -0.00483607514773 | +0.00308479111722 |
| Air at homes | 128x15_s7 | +§100 / day 1441 | 3 / 3 / 0 | -0.00174002979428 | +0.00560960939425 |
| Air at homes | 128x15_s7 | −§100 / day 1441 | 4 / 2 / 0 | -0.00483607514773 | +0.00308479111722 |
| Air at homes | 256x60_s7 | +§100 / day 1 | 4 / 47 / 0 | -0.0226935081447 | +0.0056914356465 |
| Air at homes | 256x60_s7 | −§100 / day 1 | 5 / 46 / 0 | -0.0248380385345 | +0.0093295322441 |
| Air at homes | 256x60_s7 | +§100 / day 1441 | 46 / 5 / 0 | -0.00381833581007 | +0.0190834129024 |
| Air at homes | 256x60_s7 | −§100 / day 1441 | 5 / 46 / 0 | -0.0248380385345 | +0.0093295322441 |
| Air at homes | 256x60_s11 | +§100 / day 1 | 34 / 17 / 0 | -0.00601105020839 | +0.0262246665456 |
| Air at homes | 256x60_s11 | −§100 / day 1 | 47 / 4 / 0 | -0.00210159090022 | +0.0406407867526 |
| Air at homes | 256x60_s11 | +§100 / day 1441 | 41 / 10 / 0 | -0.00333805080417 | +0.0277067039892 |
| Air at homes | 256x60_s11 | −§100 / day 1441 | 32 / 19 / 0 | -0.00810476188716 | +0.0384151934715 |
| Approval (points) | 128x15_s7 | +§100 / day 1 | 5 / 1 / 0 | -0.645426457629 | +0.695722764347 |
| Approval (points) | 128x15_s7 | −§100 / day 1 | 3 / 3 / 0 | -0.458918601182 | +0.389363177501 |
| Approval (points) | 128x15_s7 | +§100 / day 1441 | 6 / 0 / 0 | +0.015285215385 | +1.92919785979 |
| Approval (points) | 128x15_s7 | −§100 / day 1441 | 3 / 3 / 0 | -0.458918601182 | +0.389363177501 |
| Approval (points) | 256x60_s7 | +§100 / day 1 | 13 / 38 / 0 | -2.04733939351 | +3.92461663103 |
| Approval (points) | 256x60_s7 | −§100 / day 1 | 23 / 28 / 0 | -5.50529078302 | +2.02694016002 |
| Approval (points) | 256x60_s7 | +§100 / day 1441 | 9 / 42 / 0 | -3.43243846148 | +1.41343218476 |
| Approval (points) | 256x60_s7 | −§100 / day 1441 | 23 / 28 / 0 | -5.50529078302 | +2.02694016002 |
| Approval (points) | 256x60_s11 | +§100 / day 1 | 6 / 45 / 0 | -3.23743074775 | +0.651232242633 |
| Approval (points) | 256x60_s11 | −§100 / day 1 | 0 / 51 / 0 | -5.42848638277 | -0.12429850795 |
| Approval (points) | 256x60_s11 | +§100 / day 1441 | 5 / 46 / 0 | -2.15547139223 | +0.87014830121 |
| Approval (points) | 256x60_s11 | −§100 / day 1441 | 11 / 40 / 0 | -2.09580134763 | +0.810168390043 |
| I-HT share (fraction) | 128x15_s7 | +§100 / day 1 | 0 / 0 / 6 | 0 | 0 |
| I-HT share (fraction) | 128x15_s7 | −§100 / day 1 | 0 / 0 / 6 | 0 | 0 |
| I-HT share (fraction) | 128x15_s7 | +§100 / day 1441 | 0 / 0 / 6 | 0 | 0 |
| I-HT share (fraction) | 128x15_s7 | −§100 / day 1441 | 0 / 0 / 6 | 0 | 0 |
| I-HT share (fraction) | 256x60_s7 | +§100 / day 1 | 13 / 0 / 38 | 0 | +0.0511209163901 |
| I-HT share (fraction) | 256x60_s7 | −§100 / day 1 | 11 / 0 / 40 | 0 | +0.0362124270835 |
| I-HT share (fraction) | 256x60_s7 | +§100 / day 1441 | 8 / 2 / 41 | -0.00569600146813 | +0.0258333886853 |
| I-HT share (fraction) | 256x60_s7 | −§100 / day 1441 | 11 / 0 / 40 | 0 | +0.0362124270835 |
| I-HT share (fraction) | 256x60_s11 | +§100 / day 1 | 0 / 10 / 41 | -0.0145776901074 | 0 |
| I-HT share (fraction) | 256x60_s11 | −§100 / day 1 | 1 / 9 / 41 | -0.0213415031927 | +0.00141049029616 |
| I-HT share (fraction) | 256x60_s11 | +§100 / day 1441 | 0 / 10 / 41 | -0.0986664821627 | 0 |
| I-HT share (fraction) | 256x60_s11 | −§100 / day 1441 | 0 / 10 / 41 | -0.103251506482 | 0 |

### Per-year four-run metrics and signed deltas

Cells show `probe value (signed Δ from control)`; the control column is unperturbed. These are the full four-run annual observations used for the selected envelope, not newly recorded balance targets.

**128x15_s7**

**Population**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 99729 | 98826 (-903) | 100141 (+412) | 101026 (+1297) | 100141 (+412) |
| 2011 | 116996 | 115670 (-1326) | 116914 (-82) | 118282 (+1286) | 116914 (-82) |
| 2012 | 134385 | 133816 (-569) | 135052 (+667) | 136272 (+1887) | 135052 (+667) |
| 2013 | 153902 | 151950 (-1952) | 154050 (+148) | 154203 (+301) | 154050 (+148) |
| 2014 | 172995 | 170539 (-2456) | 172301 (-694) | 173724 (+729) | 172301 (-694) |
| 2015 | 192899 | 190132 (-2767) | 191588 (-1311) | 193108 (+209) | 191588 (-1311) |

**Air at homes**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 0.074013021175 | 0.0744164291217 (+0.000403407946707) | 0.0691769460273 (-0.00483607514773) | 0.0737038752696 (-0.000309145905416) | 0.0691769460273 (-0.00483607514773) |
| 2011 | 0.0762975017902 | 0.0764198389775 (+0.00012233718726) | 0.0734733641701 (-0.0028241376201) | 0.0745574719959 (-0.00174002979428) | 0.0734733641701 (-0.0028241376201) |
| 2012 | 0.0708048271401 | 0.0737493244753 (+0.00294449733518) | 0.0726766850373 (+0.00187185789727) | 0.0713872420802 (+0.000582414940134) | 0.0726766850373 (+0.00187185789727) |
| 2013 | 0.0778400375672 | 0.0785338317705 (+0.000693794203292) | 0.0787714041308 (+0.000931366563658) | 0.0777135397159 (-0.000126497851312) | 0.0787714041308 (+0.000931366563658) |
| 2014 | 0.0833283045672 | 0.0845480905707 (+0.00121978600348) | 0.0864130956845 (+0.00308479111722) | 0.0872473908458 (+0.00391908627857) | 0.0864130956845 (+0.00308479111722) |
| 2015 | 0.0908835924374 | 0.0916931294957 (+0.000809537058363) | 0.0928730666149 (+0.00198947417753) | 0.0964932018316 (+0.00560960939425) | 0.0928730666149 (+0.00198947417753) |

**Approval (points)**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 70.5454822917 | 69.9000558341 (-0.645426457629) | 70.8518853117 (+0.306403019916) | 72.4202017087 (+1.87471941699) | 70.8518853117 (+0.306403019916) |
| 2011 | 73.3377191709 | 73.7951143882 (+0.457395217392) | 73.0679494545 (-0.269769716381) | 75.2252772179 (+1.88755804704) | 73.0679494545 (-0.269769716381) |
| 2012 | 75.0662775328 | 75.4853709141 (+0.419093381347) | 75.0147602906 (-0.0515172421673) | 76.9954753925 (+1.92919785979) | 75.0147602906 (-0.0515172421673) |
| 2013 | 76.3292420144 | 77.0249647788 (+0.695722764347) | 76.7186051919 (+0.389363177501) | 78.1388951287 (+1.80965311426) | 76.7186051919 (+0.389363177501) |
| 2014 | 78.3821382274 | 78.9486307528 (+0.566492525369) | 78.6313229539 (+0.249184726484) | 79.4049512588 (+1.02281303138) | 78.6313229539 (+0.249184726484) |
| 2015 | 81.3650175025 | 81.556299867 (+0.191282364456) | 80.9060989013 (-0.458918601182) | 81.3803027179 (+0.015285215385) | 80.9060989013 (-0.458918601182) |

**I-HT share (fraction)**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2011 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2012 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2013 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2014 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2015 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |

**256x60_s7**

**Population**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 98300 | 99145 (+845) | 99253 (+953) | 98274 (-26) | 99253 (+953) |
| 2011 | 112214 | 112884 (+670) | 113394 (+1180) | 112139 (-75) | 113394 (+1180) |
| 2012 | 128926 | 130031 (+1105) | 129198 (+272) | 127207 (-1719) | 129198 (+272) |
| 2013 | 145044 | 146526 (+1482) | 145600 (+556) | 144178 (-866) | 145600 (+556) |
| 2014 | 162271 | 163206 (+935) | 162928 (+657) | 160481 (-1790) | 162928 (+657) |
| 2015 | 181278 | 181762 (+484) | 182155 (+877) | 180069 (-1209) | 182155 (+877) |
| 2016 | 200597 | 201610 (+1013) | 201275 (+678) | 199101 (-1496) | 201275 (+678) |
| 2017 | 219921 | 221905 (+1984) | 220777 (+856) | 218074 (-1847) | 220777 (+856) |
| 2018 | 240425 | 242093 (+1668) | 241134 (+709) | 239141 (-1284) | 241134 (+709) |
| 2019 | 261862 | 263043 (+1181) | 262375 (+513) | 260393 (-1469) | 262375 (+513) |
| 2020 | 283841 | 284938 (+1097) | 285431 (+1590) | 283865 (+24) | 285431 (+1590) |
| 2021 | 307765 | 309551 (+1786) | 309055 (+1290) | 307460 (-305) | 309055 (+1290) |
| 2022 | 330779 | 332599 (+1820) | 332670 (+1891) | 332098 (+1319) | 332670 (+1891) |
| 2023 | 354200 | 357442 (+3242) | 356659 (+2459) | 356749 (+2549) | 356659 (+2459) |
| 2024 | 378985 | 382163 (+3178) | 380900 (+1915) | 380023 (+1038) | 380900 (+1915) |
| 2025 | 404262 | 407731 (+3469) | 406912 (+2650) | 406143 (+1881) | 406912 (+2650) |
| 2026 | 432145 | 433030 (+885) | 433598 (+1453) | 431806 (-339) | 433598 (+1453) |
| 2027 | 460757 | 461953 (+1196) | 461632 (+875) | 460782 (+25) | 461632 (+875) |
| 2028 | 489700 | 491659 (+1959) | 491442 (+1742) | 490453 (+753) | 491442 (+1742) |
| 2029 | 519724 | 522937 (+3213) | 522372 (+2648) | 520150 (+426) | 522372 (+2648) |
| 2030 | 550399 | 553169 (+2770) | 553583 (+3184) | 550404 (+5) | 553583 (+3184) |
| 2031 | 580940 | 584845 (+3905) | 585610 (+4670) | 582204 (+1264) | 585610 (+4670) |
| 2032 | 613567 | 616271 (+2704) | 617395 (+3828) | 613290 (-277) | 617395 (+3828) |
| 2033 | 646596 | 649520 (+2924) | 649727 (+3131) | 645810 (-786) | 649727 (+3131) |
| 2034 | 678863 | 681622 (+2759) | 681383 (+2520) | 679236 (+373) | 681383 (+2520) |
| 2035 | 711503 | 715283 (+3780) | 715266 (+3763) | 712703 (+1200) | 715266 (+3763) |
| 2036 | 745163 | 747267 (+2104) | 747885 (+2722) | 746244 (+1081) | 747885 (+2722) |
| 2037 | 778371 | 781483 (+3112) | 781532 (+3161) | 778850 (+479) | 781532 (+3161) |
| 2038 | 814131 | 816400 (+2269) | 818087 (+3956) | 814455 (+324) | 818087 (+3956) |
| 2039 | 848978 | 849116 (+138) | 853454 (+4476) | 848274 (-704) | 853454 (+4476) |
| 2040 | 885236 | 885012 (-224) | 890501 (+5265) | 885781 (+545) | 890501 (+5265) |
| 2041 | 922651 | 920795 (-1856) | 928329 (+5678) | 917818 (-4833) | 928329 (+5678) |
| 2042 | 953459 | 954296 (+837) | 957446 (+3987) | 951529 (-1930) | 957446 (+3987) |
| 2043 | 990285 | 990452 (+167) | 997916 (+7631) | 988082 (-2203) | 997916 (+7631) |
| 2044 | 1029252 | 1027086 (-2166) | 1034676 (+5424) | 1023376 (-5876) | 1034676 (+5424) |
| 2045 | 1066213 | 1065179 (-1034) | 1072615 (+6402) | 1064870 (-1343) | 1072615 (+6402) |
| 2046 | 1103538 | 1106293 (+2755) | 1110071 (+6533) | 1098739 (-4799) | 1110071 (+6533) |
| 2047 | 1139240 | 1143633 (+4393) | 1152095 (+12855) | 1138642 (-598) | 1152095 (+12855) |
| 2048 | 1186078 | 1184386 (-1692) | 1187726 (+1648) | 1177033 (-9045) | 1187726 (+1648) |
| 2049 | 1222311 | 1225463 (+3152) | 1232104 (+9793) | 1219475 (-2836) | 1232104 (+9793) |
| 2050 | 1265741 | 1261963 (-3778) | 1271588 (+5847) | 1260949 (-4792) | 1271588 (+5847) |
| 2051 | 1306287 | 1302868 (-3419) | 1310245 (+3958) | 1299862 (-6425) | 1310245 (+3958) |
| 2052 | 1347980 | 1317983 (-29997) | 1342501 (-5479) | 1337018 (-10962) | 1342501 (-5479) |
| 2053 | 1392709 | 1331848 (-60861) | 1354614 (-38095) | 1361273 (-31436) | 1354614 (-38095) |
| 2054 | 1413703 | 1341305 (-72398) | 1374323 (-39380) | 1389189 (-24514) | 1374323 (-39380) |
| 2055 | 1433758 | 1338273 (-95485) | 1398399 (-35359) | 1407293 (-26465) | 1398399 (-35359) |
| 2056 | 1455861 | 1351622 (-104239) | 1419186 (-36675) | 1416443 (-39418) | 1419186 (-36675) |
| 2057 | 1470002 | 1360384 (-109618) | 1418230 (-51772) | 1439713 (-30289) | 1418230 (-51772) |
| 2058 | 1488790 | 1363572 (-125218) | 1442416 (-46374) | 1448273 (-40517) | 1442416 (-46374) |
| 2059 | 1504810 | 1372983 (-131827) | 1447648 (-57162) | 1488777 (-16033) | 1447648 (-57162) |
| 2060 | 1513835 | 1379922 (-133913) | 1461087 (-52748) | 1504801 (-9034) | 1461087 (-52748) |

**Air at homes**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 0.0739850444917 | 0.0699563236806 (-0.00402872081107) | 0.0802627946323 (+0.0062777501406) | 0.0704382396244 (-0.00354680486728) | 0.0802627946323 (+0.0062777501406) |
| 2011 | 0.0601583915644 | 0.0658498272109 (+0.0056914356465) | 0.0694879238085 (+0.0093295322441) | 0.0700432335119 (+0.00988484194743) | 0.0694879238085 (+0.0093295322441) |
| 2012 | 0.0552751532608 | 0.0547563621067 (-0.000518791154169) | 0.0590170184239 (+0.00374186516306) | 0.0590557211552 (+0.00378056789434) | 0.0590170184239 (+0.00374186516306) |
| 2013 | 0.054735849427 | 0.0557479292751 (+0.00101207984811) | 0.0590546329688 (+0.00431878354183) | 0.0602716823544 (+0.0055358329274) | 0.0590546329688 (+0.00431878354183) |
| 2014 | 0.0601129027154 | 0.0533041738602 (-0.00680872885515) | 0.0585039394277 (-0.0016089632877) | 0.0584087150806 (-0.00170418763477) | 0.0585039394277 (-0.0016089632877) |
| 2015 | 0.0565621396886 | 0.0520474226221 (-0.00451471706652) | 0.0563234720299 (-0.000238667658692) | 0.0556163296971 (-0.000945809991485) | 0.0563234720299 (-0.000238667658692) |
| 2016 | 0.0578913055256 | 0.0526888852507 (-0.00520242027494) | 0.0551385476053 (-0.00275275792031) | 0.0550865775116 (-0.00280472801403) | 0.0551385476053 (-0.00275275792031) |
| 2017 | 0.0620043357323 | 0.0534986620443 (-0.00850567368798) | 0.0553132853763 (-0.00669105035601) | 0.0581859999222 (-0.00381833581007) | 0.0553132853763 (-0.00669105035601) |
| 2018 | 0.0624139781013 | 0.0534298215879 (-0.00898415651339) | 0.0577463087727 (-0.00466766932864) | 0.0632737035353 (+0.000859725434029) | 0.0577463087727 (-0.00466766932864) |
| 2019 | 0.0580984232595 | 0.0533046888207 (-0.00479373443888) | 0.0551992230652 (-0.00289920019431) | 0.0683982320683 (+0.0102998088088) | 0.0551992230652 (-0.00289920019431) |
| 2020 | 0.0561423982413 | 0.0522226282819 (-0.00391976995939) | 0.0548954530563 (-0.001246945185) | 0.0595928518964 (+0.00345045365516) | 0.0548954530563 (-0.001246945185) |
| 2021 | 0.0561130323232 | 0.051047701643 (-0.00506533068018) | 0.0536702474236 (-0.00244278489956) | 0.061835959954 (+0.0057229276308) | 0.0536702474236 (-0.00244278489956) |
| 2022 | 0.0546999219558 | 0.0499785533711 (-0.0047213685847) | 0.0532523899714 (-0.00144753198436) | 0.0608312173134 (+0.00613129535759) | 0.0532523899714 (-0.00144753198436) |
| 2023 | 0.0592411972196 | 0.0507366522873 (-0.00850454493231) | 0.0536960108499 (-0.0055451863697) | 0.062303437841 (+0.00306224062143) | 0.0536960108499 (-0.0055451863697) |
| 2024 | 0.0612263226049 | 0.0529724048716 (-0.00825391773334) | 0.0570906756188 (-0.00413564698613) | 0.0694638608233 (+0.00823753821845) | 0.0570906756188 (-0.00413564698613) |
| 2025 | 0.0611682600552 | 0.0572523507335 (-0.00391590932177) | 0.0578569471507 (-0.00331131290456) | 0.0681830300373 (+0.0070147699821) | 0.0578569471507 (-0.00331131290456) |
| 2026 | 0.0627063337354 | 0.0578413540984 (-0.00486497963699) | 0.0576544237627 (-0.00505190997274) | 0.0681487009787 (+0.0054423672433) | 0.0576544237627 (-0.00505190997274) |
| 2027 | 0.0644352592731 | 0.0579550492795 (-0.00648020999362) | 0.0592879334372 (-0.00514732583596) | 0.0694904468741 (+0.00505518760093) | 0.0592879334372 (-0.00514732583596) |
| 2028 | 0.0662124312463 | 0.0580580143984 (-0.0081544168479) | 0.0598405489781 (-0.00637188226822) | 0.0713018696509 (+0.00508943840456) | 0.0598405489781 (-0.00637188226822) |
| 2029 | 0.0710718581218 | 0.0625188177239 (-0.00855304039792) | 0.0646516106759 (-0.00642024744595) | 0.0766479039481 (+0.00557604582624) | 0.0646516106759 (-0.00642024744595) |
| 2030 | 0.0757641322725 | 0.0657542974046 (-0.0100098348679) | 0.0662961153293 (-0.00946801694317) | 0.0801341995663 (+0.00437006729387) | 0.0662961153293 (-0.00946801694317) |
| 2031 | 0.0822221449947 | 0.0720512714269 (-0.0101708735678) | 0.071387970564 (-0.0108341744308) | 0.0844021845717 (+0.002180039577) | 0.071387970564 (-0.0108341744308) |
| 2032 | 0.0833016719808 | 0.0777944140293 (-0.00550725795147) | 0.0762349641241 (-0.0070667078567) | 0.0921530972229 (+0.00885142524209) | 0.0762349641241 (-0.0070667078567) |
| 2033 | 0.0866347129278 | 0.080072674836 (-0.00656203809185) | 0.0802682566791 (-0.00636645624871) | 0.095025260551 (+0.0083905476232) | 0.0802682566791 (-0.00636645624871) |
| 2034 | 0.0953405191024 | 0.0862932629323 (-0.00904725617009) | 0.0854119381418 (-0.00992858096059) | 0.0984079420798 (+0.00306742297738) | 0.0854119381418 (-0.00992858096059) |
| 2035 | 0.0967528291132 | 0.0888725503557 (-0.00788027875754) | 0.0900893304223 (-0.00666349869094) | 0.106854005488 (+0.0101011763751) | 0.0900893304223 (-0.00666349869094) |
| 2036 | 0.104260484687 | 0.096559708282 (-0.00770077640523) | 0.0985766757053 (-0.00568380898195) | 0.112796976636 (+0.00853649194864) | 0.0985766757053 (-0.00568380898195) |
| 2037 | 0.111184867164 | 0.112730953624 (+0.00154608645942) | 0.102755676251 (-0.00842919091326) | 0.122396988761 (+0.0112121215968) | 0.102755676251 (-0.00842919091326) |
| 2038 | 0.113757455394 | 0.1141075382 (+0.000350082805994) | 0.111509206562 (-0.00224824883293) | 0.132840868297 (+0.0190834129024) | 0.111509206562 (-0.00224824883293) |
| 2039 | 0.125735778555 | 0.117889086092 (-0.00784669246294) | 0.117469039436 (-0.00826673911901) | 0.138909582156 (+0.0131738036003) | 0.117469039436 (-0.00826673911901) |
| 2040 | 0.132807427482 | 0.118367254642 (-0.0144401728399) | 0.123397884516 (-0.00940954296593) | 0.13951387196 (+0.00670644447847) | 0.123397884516 (-0.00940954296593) |
| 2041 | 0.134063531203 | 0.121413257917 (-0.0126502732866) | 0.125318391669 (-0.00874513953485) | 0.143379778413 (+0.00931624720927) | 0.125318391669 (-0.00874513953485) |
| 2042 | 0.137795632176 | 0.128251480154 (-0.00954415202155) | 0.131581969679 (-0.00621366249722) | 0.147671955797 (+0.00987632362084) | 0.131581969679 (-0.00621366249722) |
| 2043 | 0.147602957846 | 0.130338848098 (-0.0172641097478) | 0.132227601661 (-0.0153753561846) | 0.155297690857 (+0.00769473301061) | 0.132227601661 (-0.0153753561846) |
| 2044 | 0.147342438296 | 0.140588745833 (-0.00675369246277) | 0.13882561089 (-0.00851682740554) | 0.158979489623 (+0.0116370513277) | 0.13882561089 (-0.00851682740554) |
| 2045 | 0.155903303419 | 0.145699677246 (-0.0102036261727) | 0.143134952917 (-0.0127683505016) | 0.160586629451 (+0.00468332603197) | 0.143134952917 (-0.0127683505016) |
| 2046 | 0.158856001761 | 0.144261354987 (-0.0145946467741) | 0.150067530572 (-0.00878847118917) | 0.166444098207 (+0.00758809644582) | 0.150067530572 (-0.00878847118917) |
| 2047 | 0.165945846636 | 0.147691928499 (-0.0182539181365) | 0.14765903251 (-0.0182868141255) | 0.167729313218 (+0.0017834665821) | 0.14765903251 (-0.0182868141255) |
| 2048 | 0.155345502961 | 0.147753026628 (-0.00759247633235) | 0.15336972846 (-0.00197577450087) | 0.172723700048 (+0.0173781970877) | 0.15336972846 (-0.00197577450087) |
| 2049 | 0.166970501919 | 0.147350051474 (-0.0196204504455) | 0.150475101405 (-0.0164954005141) | 0.169689774178 (+0.00271927225859) | 0.150475101405 (-0.0164954005141) |
| 2050 | 0.167177882126 | 0.154532950761 (-0.0126449313647) | 0.155464893246 (-0.0117129888803) | 0.177092364457 (+0.00991448233036) | 0.155464893246 (-0.0117129888803) |
| 2051 | 0.172646983238 | 0.152603594368 (-0.0200433888704) | 0.164149715258 (-0.00849726798048) | 0.178798806246 (+0.00615182300819) | 0.164149715258 (-0.00849726798048) |
| 2052 | 0.165388201505 | 0.154956977403 (-0.010431224102) | 0.153368043387 (-0.0120201581183) | 0.177893690569 (+0.0125054890639) | 0.153368043387 (-0.0120201581183) |
| 2053 | 0.162583798599 | 0.155333511713 (-0.00725028688538) | 0.164037287854 (+0.00145348925531) | 0.174625979708 (+0.0120421811089) | 0.164037287854 (+0.00145348925531) |
| 2054 | 0.166730635037 | 0.152678693712 (-0.0140519413244) | 0.164129877814 (-0.00260075722249) | 0.182993966319 (+0.0162633312824) | 0.164129877814 (-0.00260075722249) |
| 2055 | 0.170764696709 | 0.156632087612 (-0.0141326090971) | 0.16540508106 (-0.00535961564827) | 0.175748978394 (+0.00498428168557) | 0.16540508106 (-0.00535961564827) |
| 2056 | 0.179043508252 | 0.156350000107 (-0.0226935081447) | 0.154205469717 (-0.0248380385345) | 0.18611066335 (+0.00706715509871) | 0.154205469717 (-0.0248380385345) |
| 2057 | 0.173427477068 | 0.153725182706 (-0.0197022943621) | 0.17084205647 (-0.00258542059812) | 0.181635705648 (+0.00820822857966) | 0.17084205647 (-0.00258542059812) |
| 2058 | 0.17540397003 | 0.153828657944 (-0.0215753120856) | 0.168051154679 (-0.00735281535056) | 0.187011146621 (+0.0116071765916) | 0.168051154679 (-0.00735281535056) |
| 2059 | 0.17442361977 | 0.156109528702 (-0.0183140910682) | 0.169665793985 (-0.00475782578518) | 0.18516328007 (+0.0107396603002) | 0.169665793985 (-0.00475782578518) |
| 2060 | 0.178626333759 | 0.158303165101 (-0.0203231686575) | 0.167190377439 (-0.0114359563202) | 0.183209193398 (+0.00458285963956) | 0.167190377439 (-0.0114359563202) |

**Approval (points)**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 63.8519045379 | 63.8830864747 (+0.0311819368076) | 62.1769382346 (-1.67496630328) | 63.8207616878 (-0.0311428500733) | 62.1769382346 (-1.67496630328) |
| 2011 | 62.1163974625 | 61.6347522976 (-0.481645164884) | 63.2229332272 (+1.10653576475) | 61.7172108006 (-0.399186661851) | 63.2229332272 (+1.10653576475) |
| 2012 | 63.1424208328 | 67.0670374638 (+3.92461663103) | 61.6471759948 (-1.495244838) | 61.0514145318 (-2.09100630095) | 61.6471759948 (-1.495244838) |
| 2013 | 67.7892603094 | 67.5262026271 (-0.263057682316) | 62.2839695264 (-5.50529078302) | 64.3568218479 (-3.43243846148) | 62.2839695264 (-5.50529078302) |
| 2014 | 66.4381073297 | 67.8405307697 (+1.40242343999) | 64.5977660967 (-1.84034123302) | 66.185627447 (-0.252479882724) | 64.5977660967 (-1.84034123302) |
| 2015 | 69.3903791891 | 68.7736616745 (-0.616717514634) | 69.0050762861 (-0.38530290302) | 68.9233547452 (-0.467024443966) | 69.0050762861 (-0.38530290302) |
| 2016 | 70.1598871862 | 69.963527374 (-0.196359812184) | 69.9951035479 (-0.164783638355) | 69.923648637 (-0.236238549233) | 69.9951035479 (-0.164783638355) |
| 2017 | 70.2317655245 | 70.685579499 (+0.453813974527) | 69.517886913 (-0.713878611528) | 69.4188273617 (-0.812938162814) | 69.517886913 (-0.713878611528) |
| 2018 | 69.9960738892 | 70.3879066239 (+0.39183273478) | 69.986378043 (-0.00969584616116) | 69.9004616121 (-0.0956122770515) | 69.986378043 (-0.00969584616116) |
| 2019 | 70.8859047855 | 71.4754971645 (+0.589592378945) | 71.1729072576 (+0.28700247205) | 70.2671187341 (-0.618786051423) | 71.1729072576 (+0.28700247205) |
| 2020 | 72.5456527563 | 72.5607755828 (+0.0151228264326) | 71.2536573593 (-1.29199539707) | 72.1371693692 (-0.408483387106) | 71.2536573593 (-1.29199539707) |
| 2021 | 73.9583321142 | 72.7557117057 (-1.20262040842) | 72.4112819559 (-1.54705015826) | 73.0587092729 (-0.899622841225) | 72.4112819559 (-1.54705015826) |
| 2022 | 75.9606356589 | 75.4310635313 (-0.529572127531) | 75.3358113332 (-0.624824325676) | 76.3700096606 (+0.409374001729) | 75.3358113332 (-0.624824325676) |
| 2023 | 76.342032398 | 76.5288864317 (+0.186854033713) | 76.2288094072 (-0.113222990815) | 76.9512044095 (+0.609172011551) | 76.2288094072 (-0.113222990815) |
| 2024 | 75.4614011897 | 77.0661490765 (+1.60474788676) | 76.6132485291 (+1.15184733939) | 76.8748333745 (+1.41343218476) | 76.6132485291 (+1.15184733939) |
| 2025 | 77.065802537 | 76.8474486626 (-0.218353874461) | 76.4997075282 (-0.566095008828) | 77.1276849904 (+0.0618824533867) | 76.4997075282 (-0.566095008828) |
| 2026 | 77.201767656 | 76.5939861035 (-0.607781552459) | 76.5059936839 (-0.695773972117) | 76.0578162169 (-1.1439514391) | 76.5059936839 (-0.695773972117) |
| 2027 | 78.2094524809 | 77.7635714659 (-0.445881015056) | 77.6260208603 (-0.583431620664) | 78.0843374511 (-0.125115029854) | 77.6260208603 (-0.583431620664) |
| 2028 | 77.9452588346 | 77.5878293884 (-0.357429446151) | 77.3822568207 (-0.563002013888) | 78.7304332546 (+0.785174419991) | 77.3822568207 (-0.563002013888) |
| 2029 | 78.535558838 | 78.6671743671 (+0.131615529032) | 78.665187276 (+0.129628437934) | 79.3833210906 (+0.847762252559) | 78.665187276 (+0.129628437934) |
| 2030 | 79.881255312 | 79.6785143761 (-0.202740935975) | 80.3749907249 (+0.493735412916) | 79.4576306687 (-0.423624643327) | 80.3749907249 (+0.493735412916) |
| 2031 | 81.3426041265 | 81.129591828 (-0.213012298486) | 81.3154538597 (-0.0271502668016) | 81.1895452269 (-0.153058899571) | 81.3154538597 (-0.0271502668016) |
| 2032 | 82.2056823218 | 81.7744578114 (-0.431224510375) | 81.8707557972 (-0.334926524606) | 81.3780773367 (-0.827604985107) | 81.8707557972 (-0.334926524606) |
| 2033 | 82.4035368299 | 82.1871823006 (-0.216354529247) | 81.9068757713 (-0.496661058605) | 82.2639187704 (-0.139618059439) | 81.9068757713 (-0.496661058605) |
| 2034 | 82.7216193094 | 81.8762409523 (-0.845378357029) | 81.8116427338 (-0.909976575502) | 82.1208985786 (-0.600720730705) | 81.8116427338 (-0.909976575502) |
| 2035 | 82.3212765252 | 82.1188384802 (-0.202438045003) | 82.6115277297 (+0.290251204468) | 82.5384176932 (+0.217141168004) | 82.6115277297 (+0.290251204468) |
| 2036 | 81.6550759309 | 80.7596983645 (-0.895377566423) | 82.0831285934 (+0.428052662422) | 81.682528931 (+0.0274530000529) | 82.0831285934 (+0.428052662422) |
| 2037 | 82.1080479323 | 81.3545245065 (-0.753523425777) | 81.9702029966 (-0.137844935721) | 81.7050848917 (-0.402963040554) | 81.9702029966 (-0.137844935721) |
| 2038 | 81.8263275001 | 79.7789881066 (-2.04733939351) | 82.1077685112 (+0.281441011107) | 80.8578107174 (-0.968516782629) | 82.1077685112 (+0.281441011107) |
| 2039 | 81.6680640579 | 81.1414694683 (-0.52659458958) | 82.0318126819 (+0.363748624022) | 80.6149224318 (-1.05314162605) | 82.0318126819 (+0.363748624022) |
| 2040 | 82.6186158782 | 81.4937968568 (-1.12481902142) | 82.2978528738 (-0.320763004431) | 81.9362788961 (-0.682336982047) | 82.2978528738 (-0.320763004431) |
| 2041 | 82.6850781617 | 81.517374299 (-1.16770386274) | 82.6811451297 (-0.00393303203975) | 81.3243931387 (-1.36068502306) | 82.6811451297 (-0.00393303203975) |
| 2042 | 81.7318925805 | 81.3181849625 (-0.413707617956) | 82.0639661132 (+0.332073532729) | 80.8415919546 (-0.890300625859) | 82.0639661132 (+0.332073532729) |
| 2043 | 81.4184619882 | 80.7653319744 (-0.653130013833) | 82.5827416228 (+1.16427963464) | 79.8445693135 (-1.57389267473) | 82.5827416228 (+1.16427963464) |
| 2044 | 81.5077523582 | 80.0182498482 (-1.48950250998) | 81.4090083679 (-0.0987439903304) | 80.0097050034 (-1.49804735484) | 81.4090083679 (-0.0987439903304) |
| 2045 | 80.9601454361 | 80.5979980254 (-0.362147410669) | 81.1881858681 (+0.228040432076) | 79.7520941943 (-1.20805124175) | 81.1881858681 (+0.228040432076) |
| 2046 | 80.8512483237 | 80.5408554153 (-0.310392908381) | 81.0005068417 (+0.149258518066) | 79.5704829996 (-1.28076532403) | 81.0005068417 (+0.149258518066) |
| 2047 | 79.775902191 | 80.1748088328 (+0.39890664184) | 81.0588852664 (+1.28298307539) | 79.2554570494 (-0.520445141551) | 81.0588852664 (+1.28298307539) |
| 2048 | 80.4586668362 | 80.8686423011 (+0.409975464846) | 80.4624820383 (+0.00381520207813) | 79.8964904416 (-0.562176394573) | 80.4624820383 (+0.00381520207813) |
| 2049 | 80.9511105372 | 80.8374549884 (-0.113655548801) | 80.7488537718 (-0.202256765416) | 78.807667578 (-2.14344295924) | 80.7488537718 (-0.202256765416) |
| 2050 | 80.8282333843 | 80.6653369586 (-0.162896425612) | 80.8447373631 (+0.0165039788294) | 79.0001615783 (-1.828071806) | 80.8447373631 (+0.0165039788294) |
| 2051 | 80.7534327958 | 79.1599302612 (-1.59350253455) | 79.6780085888 (-1.07542420696) | 78.9820083742 (-1.7714244216) | 79.6780085888 (-1.07542420696) |
| 2052 | 80.6369747076 | 79.3124832948 (-1.32449141285) | 80.4376637069 (-0.199311000677) | 78.7405308964 (-1.89644381123) | 80.4376637069 (-0.199311000677) |
| 2053 | 80.7548470143 | 79.288229889 (-1.46661712532) | 80.0034644751 (-0.751382539201) | 78.7171376936 (-2.03770932069) | 80.0034644751 (-0.751382539201) |
| 2054 | 80.5938057518 | 79.9087755491 (-0.68503020266) | 81.0113417551 (+0.417536003256) | 78.74415033 (-1.84965542177) | 81.0113417551 (+0.417536003256) |
| 2055 | 79.0876602917 | 79.6920910962 (+0.60443080455) | 81.1146004517 (+2.02694016002) | 79.8113875174 (+0.723727225731) | 81.1146004517 (+2.02694016002) |
| 2056 | 80.0662775043 | 79.4981521614 (-0.568125342866) | 81.0223110796 (+0.956033575336) | 79.0694871654 (-0.996790338919) | 81.0223110796 (+0.956033575336) |
| 2057 | 80.4826074625 | 80.2581576061 (-0.224449856408) | 80.5079109207 (+0.0253034582485) | 79.2567015091 (-1.22590595334) | 80.5079109207 (+0.0253034582485) |
| 2058 | 80.0913343012 | 80.0148022281 (-0.0765320730862) | 80.9268790245 (+0.835544723313) | 79.7689561178 (-0.322378183427) | 80.9268790245 (+0.835544723313) |
| 2059 | 79.8836708941 | 79.5680978547 (-0.315573039329) | 80.6622888259 (+0.778617931801) | 79.4466630409 (-0.437007853123) | 80.6622888259 (+0.778617931801) |
| 2060 | 80.3574246959 | 79.9395016464 (-0.417923049509) | 80.5414097299 (+0.183985033973) | 79.7398013242 (-0.617623371738) | 80.5414097299 (+0.183985033973) |

**I-HT share (fraction)**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2011 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2012 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2013 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2014 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2015 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2016 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2017 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2018 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2019 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2020 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2021 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2022 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2023 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2024 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2025 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2026 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2027 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2028 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2029 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2030 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2031 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2032 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2033 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2034 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2035 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2036 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2037 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2038 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2039 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2040 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2041 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2042 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2043 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2044 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2045 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2046 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2047 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2048 | 0 | 0.00175555599145 (+0.00175555599145) | 0 (0) | 0 (0) | 0 (0) |
| 2049 | 0 | 0.0135973647924 (+0.0135973647924) | 0 (0) | 0 (0) | 0 (0) |
| 2050 | 0 | 0.0266876566095 (+0.0266876566095) | 0.0136107814235 (+0.0136107814235) | 0 (0) | 0.0136107814235 (+0.0136107814235) |
| 2051 | 0.00592249012918 | 0.0322995310774 (+0.0263770409483) | 0.017711478238 (+0.0117889881089) | 0.0108506944444 (+0.00492820431526) | 0.017711478238 (+0.0117889881089) |
| 2052 | 0.00814035221034 | 0.0394797299685 (+0.0313393777582) | 0.0256530991081 (+0.0175127468977) | 0.0275955816651 (+0.0194552294547) | 0.0256530991081 (+0.0175127468977) |
| 2053 | 0.00956450956451 | 0.0588376540404 (+0.0492731444759) | 0.0389398138279 (+0.0293753042634) | 0.0353978982498 (+0.0258333886853) | 0.0389398138279 (+0.0293753042634) |
| 2054 | 0.0236319752152 | 0.0747528916054 (+0.0511209163901) | 0.053544494721 (+0.0299125195057) | 0.0469383243681 (+0.0233063491529) | 0.053544494721 (+0.0299125195057) |
| 2055 | 0.0366587441133 | 0.0799960858184 (+0.0433373417051) | 0.0676564334843 (+0.030997689371) | 0.0506116510086 (+0.0139529068953) | 0.0676564334843 (+0.030997689371) |
| 2056 | 0.0559334779715 | 0.0967523307406 (+0.0408188527691) | 0.0838448478516 (+0.0279113698801) | 0.0651489527774 (+0.00921547480592) | 0.0838448478516 (+0.0279113698801) |
| 2057 | 0.0740231723265 | 0.113108534011 (+0.0390853616841) | 0.11023559941 (+0.0362124270835) | 0.069570251311 (-0.00445292101544) | 0.11023559941 (+0.0362124270835) |
| 2058 | 0.0895362510269 | 0.129007519917 (+0.0394712688897) | 0.123119258943 (+0.0335830079166) | 0.0838402495588 (-0.00569600146813) | 0.123119258943 (+0.0335830079166) |
| 2059 | 0.0939054034731 | 0.128900168955 (+0.034994765482) | 0.122839370876 (+0.0289339674031) | 0.0973976272484 (+0.00349222377528) | 0.122839370876 (+0.0289339674031) |
| 2060 | 0.10239866758 | 0.137623904611 (+0.0352252370316) | 0.126146721117 (+0.0237480535376) | 0.114821932244 (+0.0124232646645) | 0.126146721117 (+0.0237480535376) |

**256x60_s11**

**Population**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 97469 | 97480 (+11) | 96407 (-1062) | 97010 (-459) | 96079 (-1390) |
| 2011 | 111424 | 111232 (-192) | 110332 (-1092) | 111220 (-204) | 110096 (-1328) |
| 2012 | 126476 | 127871 (+1395) | 126617 (+141) | 126754 (+278) | 125601 (-875) |
| 2013 | 143996 | 145099 (+1103) | 142480 (-1516) | 144130 (+134) | 143383 (-613) |
| 2014 | 163210 | 162893 (-317) | 159429 (-3781) | 163214 (+4) | 160600 (-2610) |
| 2015 | 182428 | 181910 (-518) | 178036 (-4392) | 181953 (-475) | 179951 (-2477) |
| 2016 | 202147 | 201032 (-1115) | 198931 (-3216) | 201746 (-401) | 199261 (-2886) |
| 2017 | 221560 | 220264 (-1296) | 217743 (-3817) | 221252 (-308) | 219067 (-2493) |
| 2018 | 241641 | 240111 (-1530) | 238125 (-3516) | 242039 (+398) | 239254 (-2387) |
| 2019 | 264481 | 261751 (-2730) | 259674 (-4807) | 264370 (-111) | 260637 (-3844) |
| 2020 | 287234 | 284274 (-2960) | 281689 (-5545) | 286886 (-348) | 283799 (-3435) |
| 2021 | 310168 | 307076 (-3092) | 303929 (-6239) | 310073 (-95) | 306293 (-3875) |
| 2022 | 332224 | 331951 (-273) | 327213 (-5011) | 333566 (+1342) | 328831 (-3393) |
| 2023 | 356520 | 355340 (-1180) | 350807 (-5713) | 357155 (+635) | 353318 (-3202) |
| 2024 | 381058 | 380475 (-583) | 375374 (-5684) | 381880 (+822) | 377503 (-3555) |
| 2025 | 406789 | 405400 (-1389) | 400281 (-6508) | 406287 (-502) | 402379 (-4410) |
| 2026 | 432624 | 431885 (-739) | 426244 (-6380) | 432136 (-488) | 428640 (-3984) |
| 2027 | 459464 | 460015 (+551) | 454626 (-4838) | 459324 (-140) | 456712 (-2752) |
| 2028 | 489945 | 489506 (-439) | 484568 (-5377) | 488133 (-1812) | 485941 (-4004) |
| 2029 | 520692 | 520829 (+137) | 515169 (-5523) | 518809 (-1883) | 515857 (-4835) |
| 2030 | 551235 | 551396 (+161) | 545987 (-5248) | 549130 (-2105) | 547314 (-3921) |
| 2031 | 582733 | 582250 (-483) | 577395 (-5338) | 579744 (-2989) | 578928 (-3805) |
| 2032 | 614845 | 614648 (-197) | 608730 (-6115) | 610615 (-4230) | 610449 (-4396) |
| 2033 | 647575 | 646489 (-1086) | 641046 (-6529) | 643324 (-4251) | 643353 (-4222) |
| 2034 | 679334 | 679323 (-11) | 671270 (-8064) | 675552 (-3782) | 675310 (-4024) |
| 2035 | 713490 | 713314 (-176) | 705812 (-7678) | 706910 (-6580) | 708864 (-4626) |
| 2036 | 746748 | 747427 (+679) | 738362 (-8386) | 741622 (-5126) | 740004 (-6744) |
| 2037 | 780557 | 781066 (+509) | 773730 (-6827) | 776288 (-4269) | 775648 (-4909) |
| 2038 | 815501 | 816651 (+1150) | 807517 (-7984) | 811907 (-3594) | 809106 (-6395) |
| 2039 | 850651 | 852303 (+1652) | 841049 (-9602) | 844940 (-5711) | 843442 (-7209) |
| 2040 | 888193 | 889673 (+1480) | 879800 (-8393) | 880019 (-8174) | 878323 (-9870) |
| 2041 | 921632 | 924866 (+3234) | 914584 (-7048) | 913767 (-7865) | 914510 (-7122) |
| 2042 | 958822 | 957920 (-902) | 950104 (-8718) | 952007 (-6815) | 947049 (-11773) |
| 2043 | 993905 | 994389 (+484) | 981631 (-12274) | 989261 (-4644) | 986663 (-7242) |
| 2044 | 1031139 | 1031463 (+324) | 1017766 (-13373) | 1030678 (-461) | 1023542 (-7597) |
| 2045 | 1068216 | 1069790 (+1574) | 1055287 (-12929) | 1072401 (+4185) | 1065768 (-2448) |
| 2046 | 1109143 | 1109236 (+93) | 1094324 (-14819) | 1109943 (+800) | 1103535 (-5608) |
| 2047 | 1147425 | 1144003 (-3422) | 1132339 (-15086) | 1144048 (-3377) | 1151307 (+3882) |
| 2048 | 1186527 | 1187525 (+998) | 1169316 (-17211) | 1183951 (-2576) | 1187374 (+847) |
| 2049 | 1225495 | 1231690 (+6195) | 1209924 (-15571) | 1222848 (-2647) | 1233587 (+8092) |
| 2050 | 1272103 | 1266953 (-5150) | 1254073 (-18030) | 1262250 (-9853) | 1261639 (-10464) |
| 2051 | 1313026 | 1310721 (-2305) | 1295571 (-17455) | 1306968 (-6058) | 1307156 (-5870) |
| 2052 | 1354608 | 1353432 (-1176) | 1335822 (-18786) | 1348318 (-6290) | 1352531 (-2077) |
| 2053 | 1372356 | 1391300 (+18944) | 1376252 (+3896) | 1392815 (+20459) | 1387290 (+14934) |
| 2054 | 1388950 | 1401401 (+12451) | 1398314 (+9364) | 1440737 (+51787) | 1410655 (+21705) |
| 2055 | 1386414 | 1426671 (+40257) | 1413815 (+27401) | 1464302 (+77888) | 1428499 (+42085) |
| 2056 | 1400344 | 1445471 (+45127) | 1433502 (+33158) | 1476049 (+75705) | 1444001 (+43657) |
| 2057 | 1403945 | 1456317 (+52372) | 1442965 (+39020) | 1487877 (+83932) | 1462088 (+58143) |
| 2058 | 1414561 | 1464337 (+49776) | 1448528 (+33967) | 1491046 (+76485) | 1462768 (+48207) |
| 2059 | 1416617 | 1482680 (+66063) | 1484614 (+67997) | 1504106 (+87489) | 1471782 (+55165) |
| 2060 | 1427340 | 1483518 (+56178) | 1498791 (+71451) | 1503201 (+75861) | 1472527 (+45187) |

**Air at homes**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 0.065350349494 | 0.0606476563068 (-0.0047026931872) | 0.0741703598792 (+0.00882001038522) | 0.0654003938042 (+0.0000500443101811) | 0.062168676391 (-0.00318167310303) |
| 2011 | 0.0580437408479 | 0.055855359234 (-0.00218838161389) | 0.0593061927397 (+0.00126245189175) | 0.0644109030923 (+0.00636716224434) | 0.0645595073575 (+0.00651576650958) |
| 2012 | 0.0544750470377 | 0.0497127203034 (-0.00476232673432) | 0.0562949667144 (+0.00181991967665) | 0.0525824920964 (-0.0018925549413) | 0.0518874926503 (-0.00258755438745) |
| 2013 | 0.0520217003319 | 0.0482164861661 (-0.00380521416582) | 0.0555974714951 (+0.00357577116313) | 0.0510184235683 (-0.00100327676366) | 0.0499834863083 (-0.00203821402367) |
| 2014 | 0.0522545755233 | 0.0462435253149 (-0.00601105020839) | 0.0537209677605 (+0.00146639223719) | 0.055483865296 (+0.00322928977262) | 0.0473097713287 (-0.00494480419462) |
| 2015 | 0.0514671112541 | 0.0459873844775 (-0.00547972677656) | 0.0563030703865 (+0.00483595913243) | 0.0565486899266 (+0.00508157867257) | 0.045746366541 (-0.00572074471303) |
| 2016 | 0.0522574326203 | 0.0498514346879 (-0.00240599793241) | 0.0565367466969 (+0.00427931407661) | 0.0527427747305 (+0.000485342110139) | 0.0441526707332 (-0.00810476188716) |
| 2017 | 0.0573060732476 | 0.0515647492163 (-0.00574132403126) | 0.0598561785793 (+0.00255010533178) | 0.062884943181 (+0.00557886993343) | 0.050383138573 (-0.0069229346746) |
| 2018 | 0.0563750850087 | 0.0572274241276 (+0.000852339118852) | 0.0608228784064 (+0.0044477933977) | 0.0545566195012 (-0.00181846550753) | 0.0501280973105 (-0.00624698769825) |
| 2019 | 0.0556510217607 | 0.0528865929813 (-0.00276442877948) | 0.0560521993084 (+0.000401177547621) | 0.0539889333438 (-0.00166208841695) | 0.0504015313443 (-0.00524949041642) |
| 2020 | 0.0557169253613 | 0.0523462587196 (-0.00337066664166) | 0.0549987054698 (-0.000718219891509) | 0.0523788745571 (-0.00333805080417) | 0.0496295109793 (-0.00608741438197) |
| 2021 | 0.0547470670098 | 0.0522871911587 (-0.00245987585108) | 0.0572027484116 (+0.00245568140177) | 0.0523680172558 (-0.00237904975401) | 0.0506567511298 (-0.00409031587996) |
| 2022 | 0.0584134414695 | 0.0527593531738 (-0.00565408829569) | 0.0563118505693 (-0.00210159090022) | 0.0552336852261 (-0.00317975624339) | 0.0544952927805 (-0.00391814868905) |
| 2023 | 0.0611642692479 | 0.0567692796297 (-0.00439498961818) | 0.0604832878747 (-0.000680981373167) | 0.0600525360776 (-0.00111173317026) | 0.0577381724933 (-0.00342609675458) |
| 2024 | 0.0632593138714 | 0.0599573237568 (-0.00330199011462) | 0.0656655722565 (+0.00240625838508) | 0.0613773650253 (-0.00188194884615) | 0.0594275024251 (-0.00383181144636) |
| 2025 | 0.0629129261695 | 0.0629580310288 (+0.0000451048593248) | 0.0668897743491 (+0.00397684817961) | 0.0660536522379 (+0.00314072606843) | 0.0617308977597 (-0.00118202840985) |
| 2026 | 0.0670506912252 | 0.0612959316657 (-0.00575475955955) | 0.0669440457419 (-0.000106645483367) | 0.0665075245825 (-0.000543166642692) | 0.0623330877204 (-0.00471760350482) |
| 2027 | 0.0657421438106 | 0.0615860872533 (-0.00415605655726) | 0.06960806194 (+0.00386591812947) | 0.0662493464781 (+0.000507202667514) | 0.0629151474749 (-0.00282699633566) |
| 2028 | 0.0630358514868 | 0.0611067885077 (-0.00192906297901) | 0.0716394825492 (+0.00860363106246) | 0.0656833434827 (+0.0026474919959) | 0.0628195431198 (-0.000216308366968) |
| 2029 | 0.0636400710001 | 0.0643486511194 (+0.000708580119256) | 0.0750147502442 (+0.0113746792442) | 0.0679750941102 (+0.00433502311011) | 0.0681110431934 (+0.00447097219334) |
| 2030 | 0.0677812627025 | 0.0697412838765 (+0.00196002117404) | 0.0769039723364 (+0.00912270963392) | 0.0721811532593 (+0.00439989055683) | 0.0688450115832 (+0.00106374888066) |
| 2031 | 0.0701001861004 | 0.0723293316163 (+0.00222914551595) | 0.0834208008024 (+0.013320614702) | 0.077930327836 (+0.00783014173564) | 0.0744927478238 (+0.00439256172339) |
| 2032 | 0.0724190332987 | 0.0800183036137 (+0.00759927031498) | 0.0858982828134 (+0.0134792495147) | 0.0833964452328 (+0.0109774119341) | 0.0794164284736 (+0.00699739517485) |
| 2033 | 0.0757977680989 | 0.0850560958123 (+0.00925832771339) | 0.0908314923925 (+0.0150337242936) | 0.0837325368929 (+0.00793476879397) | 0.0820384730526 (+0.00624070495369) |
| 2034 | 0.0827262118302 | 0.0867467297895 (+0.00402051795932) | 0.101733974655 (+0.019007762825) | 0.091709024897 (+0.00898281306679) | 0.0864207421429 (+0.00369453031276) |
| 2035 | 0.0854047246629 | 0.0938345707107 (+0.00842984604781) | 0.100116876454 (+0.0147121517915) | 0.0987167230067 (+0.0133119983438) | 0.0974763542354 (+0.0120716295725) |
| 2036 | 0.0919302300019 | 0.0951031585647 (+0.00317292856277) | 0.107488300411 (+0.0155580704094) | 0.100810481872 (+0.00888025187016) | 0.102959981473 (+0.0110297514712) |
| 2037 | 0.0981501369686 | 0.101905123945 (+0.00375498697661) | 0.113785284161 (+0.0156351471929) | 0.106671345828 (+0.0085212088594) | 0.103445688051 (+0.00529555108203) |
| 2038 | 0.102178297807 | 0.105172353882 (+0.00299405607522) | 0.119279615383 (+0.0171013175756) | 0.108876402027 (+0.00669810422012) | 0.114245085227 (+0.0120667874201) |
| 2039 | 0.107450141015 | 0.112769676625 (+0.00531953561027) | 0.126056959369 (+0.0186068183548) | 0.117281865418 (+0.00983172440315) | 0.117423067503 (+0.00997292648897) |
| 2040 | 0.113307293426 | 0.116828998634 (+0.00352170520821) | 0.129887023697 (+0.0165797302715) | 0.12195091575 (+0.00864362232458) | 0.124273557956 (+0.0109662645303) |
| 2041 | 0.123881921098 | 0.124133908368 (+0.000251987270081) | 0.142696690675 (+0.0188147695775) | 0.127374058334 (+0.00349213723624) | 0.12381012157 (-0.0000717995280235) |
| 2042 | 0.126086734444 | 0.130450086912 (+0.00436335246771) | 0.144575050726 (+0.0184883162813) | 0.127965290031 (+0.00187855558644) | 0.137016775084 (+0.0109300406396) |
| 2043 | 0.129741976511 | 0.135476425365 (+0.00573444885399) | 0.146611437364 (+0.0168694608534) | 0.132142502792 (+0.002400526281) | 0.136380379174 (+0.00663840266333) |
| 2044 | 0.127841465029 | 0.136740245089 (+0.00889878005952) | 0.153304499935 (+0.0254630349055) | 0.142594588148 (+0.0147531231187) | 0.152859208646 (+0.025017743617) |
| 2045 | 0.134717231435 | 0.143253165617 (+0.0085359341817) | 0.158265272862 (+0.0235480414272) | 0.14080238453 (+0.0060851530951) | 0.150519909214 (+0.0158026777786) |
| 2046 | 0.135719597588 | 0.142904522095 (+0.00718492450625) | 0.15990635414 (+0.0241867565515) | 0.152674323384 (+0.016954725796) | 0.15197178937 (+0.0162521917819) |
| 2047 | 0.138409774208 | 0.15833456052 (+0.0199247863112) | 0.169138761911 (+0.0307289877031) | 0.157108470572 (+0.0186986963634) | 0.149802722178 (+0.0113929479695) |
| 2048 | 0.142596638453 | 0.153205640123 (+0.0106090016699) | 0.171808653885 (+0.0292120154312) | 0.157149319071 (+0.0145526806178) | 0.160871906113 (+0.0182752676596) |
| 2049 | 0.145552599512 | 0.151758240459 (+0.00620564094701) | 0.173847097014 (+0.0282944975024) | 0.162690375251 (+0.0171377757398) | 0.154546439733 (+0.00899384022118) |
| 2050 | 0.140626416381 | 0.166325150971 (+0.02569873459) | 0.174208293745 (+0.0335818773637) | 0.162816154634 (+0.0221897382531) | 0.166178183192 (+0.0255517668106) |
| 2051 | 0.146472679267 | 0.156639596163 (+0.0101669168964) | 0.175126842925 (+0.028654163658) | 0.168199521175 (+0.0217268419082) | 0.165858823431 (+0.019386144164) |
| 2052 | 0.143862404618 | 0.163855812119 (+0.0199934075008) | 0.180875223886 (+0.0370128192681) | 0.16947079926 (+0.0256083946419) | 0.166770411334 (+0.0229080067164) |
| 2053 | 0.142825009073 | 0.156253892991 (+0.013428883918) | 0.176661749973 (+0.0338367408998) | 0.166497204058 (+0.0236721949852) | 0.163510597338 (+0.0206855882652) |
| 2054 | 0.143359957365 | 0.164056788484 (+0.0206968311198) | 0.175300481566 (+0.031940524201) | 0.16437900878 (+0.0210190514154) | 0.166995973574 (+0.0236360162097) |
| 2055 | 0.144885651148 | 0.161343344166 (+0.0164576930185) | 0.184043543051 (+0.0391578919031) | 0.169314615785 (+0.0244289646375) | 0.174912011361 (+0.0300263602131) |
| 2056 | 0.144751544239 | 0.16306190722 (+0.018310362981) | 0.17942816008 (+0.0346766158414) | 0.167833523342 (+0.0230819791033) | 0.177614379313 (+0.0328628350743) |
| 2057 | 0.145909746932 | 0.164808838054 (+0.0188990911223) | 0.186550533685 (+0.0406407867526) | 0.173270672509 (+0.027360925577) | 0.174061608776 (+0.0281518618434) |
| 2058 | 0.142471353527 | 0.168696020073 (+0.0262246665456) | 0.182265726266 (+0.0397943727385) | 0.170178057516 (+0.0277067039892) | 0.180886546999 (+0.0384151934715) |
| 2059 | 0.147304497255 | 0.162311254467 (+0.0150067572117) | 0.182973823183 (+0.0356693259279) | 0.162669681915 (+0.0153651846599) | 0.175752339177 (+0.0284478419216) |
| 2060 | 0.147485057472 | 0.16888213734 (+0.0213970798684) | 0.182561594583 (+0.0350765371117) | 0.171516885347 (+0.0240318278749) | 0.177723910876 (+0.030238853404) |

**Approval (points)**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 64.5131653156 | 63.0769391389 (-1.43622617669) | 64.121745472 (-0.391419843605) | 64.676211261 (+0.163045945341) | 64.9457940974 (+0.432628781813) |
| 2011 | 63.4003528592 | 61.8757810925 (-1.52457176667) | 62.3414562954 (-1.05889656382) | 63.5843318522 (+0.183978993053) | 64.0420290185 (+0.641676159296) |
| 2012 | 63.5637266137 | 62.0262406601 (-1.53748595367) | 61.9924189426 (-1.57130767117) | 62.7494778673 (-0.814248746388) | 63.0316284368 (-0.532098176946) |
| 2013 | 63.6206172189 | 63.2402586377 (-0.380358581151) | 62.4083362375 (-1.21228098139) | 64.4907655201 (+0.87014830121) | 63.4843576984 (-0.136259520464) |
| 2014 | 70.2355302508 | 67.6701296663 (-2.56540058456) | 64.8070438681 (-5.42848638277) | 69.7922046748 (-0.443325576079) | 69.9254351369 (-0.310095113958) |
| 2015 | 70.8877589306 | 70.2828251982 (-0.604933732415) | 67.0215711403 (-3.86618779032) | 69.9334179345 (-0.954340996118) | 71.1467203415 (+0.258961410969) |
| 2016 | 72.3115621325 | 70.6290310398 (-1.68253109265) | 70.4025500066 (-1.90901212587) | 70.930926154 (-1.38063597845) | 72.0593578805 (-0.252204252027) |
| 2017 | 72.3716101346 | 70.6852792769 (-1.68633085768) | 70.1747235226 (-2.19688661201) | 71.7462059723 (-0.625404162313) | 72.1474844745 (-0.224125660128) |
| 2018 | 73.1531831645 | 70.8175666723 (-2.33561649227) | 71.241047626 (-1.91213553851) | 72.6849184417 (-0.468264722866) | 73.0735203119 (-0.0796628526384) |
| 2019 | 74.3239597793 | 72.0316989205 (-2.29226085872) | 72.4338189705 (-1.89014080876) | 73.6696893807 (-0.654270398595) | 73.9368019881 (-0.387157791134) |
| 2020 | 76.4404919454 | 73.2030611977 (-3.23743074775) | 73.7681846693 (-2.67230727618) | 76.1679586732 (-0.272533272202) | 76.3537571287 (-0.086734816742) |
| 2021 | 77.7540836674 | 75.5605060621 (-2.1935776053) | 75.1840649435 (-2.57001872388) | 77.2123468278 (-0.541736839566) | 76.9415584023 (-0.812525265047) |
| 2022 | 77.3706823023 | 76.7061259887 (-0.66455631366) | 76.0479120587 (-1.32277024363) | 77.4890035906 (+0.118321288269) | 77.3505446464 (-0.0201376559459) |
| 2023 | 77.9120360245 | 77.2939185279 (-0.618117496611) | 76.2887567216 (-1.62327930296) | 77.6433592556 (-0.268676768933) | 77.9336070815 (+0.0215710569898) |
| 2024 | 78.1691956093 | 77.5436026214 (-0.625592987909) | 76.4603769478 (-1.70881866153) | 77.7414366218 (-0.42775898754) | 78.0419120235 (-0.127283585766) |
| 2025 | 78.0048748875 | 77.182950673 (-0.821924214525) | 76.912012365 (-1.09286252249) | 76.2640054381 (-1.74086944937) | 77.6147377146 (-0.39013717293) |
| 2026 | 78.2446253242 | 77.544905082 (-0.699720242178) | 77.2549435325 (-0.989681791703) | 77.5347736949 (-0.709851629275) | 77.4017167485 (-0.842908575648) |
| 2027 | 78.0884129186 | 78.2067006264 (+0.118287707818) | 76.5165356378 (-1.57187728075) | 77.0703712907 (-1.01804162785) | 77.5910608598 (-0.49735205878) |
| 2028 | 80.1594304101 | 78.1333126686 (-2.02611774147) | 77.7653943036 (-2.39403610649) | 78.0039590179 (-2.15547139223) | 78.9467285643 (-1.21270184579) |
| 2029 | 81.6009226435 | 79.1036508928 (-2.49727175061) | 79.5910751866 (-2.00984745686) | 80.2667622591 (-1.33416038437) | 79.5051212958 (-2.09580134763) |
| 2030 | 81.4590017164 | 80.8501245868 (-0.608877129569) | 80.1015030183 (-1.35749869808) | 81.6331017631 (+0.174100046743) | 81.4404011945 (-0.0186005218952) |
| 2031 | 82.2232143329 | 80.9234804993 (-1.29973383354) | 81.0140749074 (-1.2091394255) | 81.9152452188 (-0.307969114067) | 81.8911466084 (-0.332067724489) |
| 2032 | 82.3868309707 | 81.981636368 (-0.405194602675) | 81.5399457676 (-0.846885203089) | 81.6151927392 (-0.77163823153) | 82.1603265696 (-0.226504401102) |
| 2033 | 82.3619177508 | 82.12052659 (-0.241391160807) | 82.2376192429 (-0.12429850795) | 81.4447745966 (-0.917143154231) | 83.1720861408 (+0.810168390043) |
| 2034 | 82.9694498342 | 82.1385293596 (-0.830920474593) | 81.9956103728 (-0.973839461305) | 81.6148849526 (-1.3545648815) | 82.7060501036 (-0.263399730571) |
| 2035 | 82.8921472633 | 82.722366309 (-0.169780954289) | 82.0975389445 (-0.79460831883) | 81.2325811 (-1.65956616332) | 82.8874108553 (-0.00473640800571) |
| 2036 | 83.8068783412 | 82.4672159037 (-1.33966243752) | 82.4523262652 (-1.35455207605) | 81.8511807927 (-1.95569754851) | 82.5830114622 (-1.22386687901) |
| 2037 | 83.1437641225 | 82.2512230651 (-0.89254105743) | 82.4190760791 (-0.724688043451) | 82.3181606984 (-0.825603424076) | 82.0410693877 (-1.10269473483) |
| 2038 | 82.9540376397 | 82.5325089984 (-0.421528641299) | 81.4223369041 (-1.53170073555) | 81.5748907845 (-1.37914685515) | 82.1592113194 (-0.794826320227) |
| 2039 | 82.8090936591 | 83.0208501669 (+0.211756507786) | 82.114800467 (-0.694293192082) | 81.7314164498 (-1.07767720932) | 83.1101948772 (+0.301101218076) |
| 2040 | 83.0747485967 | 82.8624900983 (-0.212258498406) | 82.6798979898 (-0.394850606946) | 81.9454839227 (-1.12926467404) | 82.9221156273 (-0.15263296943) |
| 2041 | 82.7341033392 | 82.1884032783 (-0.545700060905) | 82.1334679586 (-0.600635380576) | 81.1310210895 (-1.6030822497) | 82.5358667038 (-0.198236635415) |
| 2042 | 82.3437330942 | 82.0540874713 (-0.289645622929) | 82.1575348568 (-0.186198237462) | 81.583606989 (-0.760126105222) | 82.0478262311 (-0.295906863082) |
| 2043 | 81.6238087259 | 82.0046563218 (+0.380847595845) | 81.0054729891 (-0.618335736862) | 81.2709746426 (-0.35283408333) | 82.0453687947 (+0.421560068775) |
| 2044 | 81.6738854807 | 81.3885927267 (-0.285292753964) | 80.8561381665 (-0.817747314186) | 81.3544681847 (-0.319417296007) | 81.6548746945 (-0.0190107862) |
| 2045 | 81.3672525062 | 80.5826588627 (-0.784593643494) | 80.9084507238 (-0.458801782415) | 80.9465309421 (-0.420721564071) | 81.3620270895 (-0.00522541671944) |
| 2046 | 81.3922144238 | 80.5715003478 (-0.82071407599) | 80.3864119872 (-1.00580243654) | 81.02390851 (-0.368305913775) | 81.1568988778 (-0.235315545954) |
| 2047 | 81.4479538941 | 80.5774730815 (-0.87048081259) | 79.5412460772 (-1.90670781692) | 80.3222267899 (-1.12572710425) | 81.8762702293 (+0.428316335237) |
| 2048 | 81.4228326633 | 80.4817288086 (-0.941103854723) | 79.7791260831 (-1.64370658021) | 79.7900236096 (-1.63280905372) | 81.4782541627 (+0.0554214993408) |
| 2049 | 81.0957329846 | 80.2711868681 (-0.824546116459) | 80.2386953987 (-0.857037585875) | 79.8305016712 (-1.26523131337) | 81.248412134 (+0.152679149437) |
| 2050 | 80.9499364094 | 80.8221717706 (-0.12776463879) | 79.9565191964 (-0.993417213004) | 79.8307428068 (-1.11919360259) | 80.438332376 (-0.511604033339) |
| 2051 | 80.4217985169 | 80.3679574004 (-0.0538411165489) | 79.6633762229 (-0.758422294065) | 79.9492527193 (-0.472545797616) | 80.6414577051 (+0.219659188191) |
| 2052 | 80.6428101102 | 80.7251923185 (+0.0823822083271) | 79.9800760914 (-0.662734018769) | 79.5939078267 (-1.04890228354) | 80.4232597104 (-0.21955039979) |
| 2053 | 81.1771549768 | 81.107340801 (-0.0698141757492) | 80.4829884336 (-0.694166543196) | 79.3138476557 (-1.86330732108) | 80.6480393726 (-0.529115604226) |
| 2054 | 80.4236104261 | 80.3250126135 (-0.0985978125782) | 80.2338463766 (-0.189764049462) | 80.0636408587 (-0.359969567339) | 79.7013495829 (-0.722260843154) |
| 2055 | 80.7403544601 | 80.9548984002 (+0.214543940098) | 79.9308201976 (-0.809534262591) | 80.0500672483 (-0.690287211854) | 80.4130059591 (-0.327348501094) |
| 2056 | 80.4208527847 | 80.3413496665 (-0.0795031181607) | 80.2474455786 (-0.173407206091) | 80.2545719243 (-0.166280860322) | 80.3756313061 (-0.0452214785361) |
| 2057 | 81.1171802385 | 80.2976690264 (-0.819511212142) | 79.6853405289 (-1.43183970964) | 80.1255566076 (-0.991623630938) | 79.0766552494 (-2.04052498911) |
| 2058 | 80.7983833485 | 80.717239099 (-0.0811442495033) | 79.5188434281 (-1.27953992033) | 79.6756895717 (-1.12269377675) | 80.053724096 (-0.744659252444) |
| 2059 | 80.1027854209 | 80.7540176635 (+0.651232242633) | 79.6906575395 (-0.412127881383) | 80.0132186901 (-0.089566730768) | 79.8283400653 (-0.274445355664) |
| 2060 | 81.3566945637 | 81.271739906 (-0.0849546577103) | 79.1371672705 (-2.21952729322) | 80.4411987232 (-0.915495840463) | 79.9558196962 (-1.4008748675) |

**I-HT share (fraction)**

| Year | Control | + day 1 | − day 1 | + year 5 (day 1441) | − year 5 (day 1441) |
|---:|---:|---:|---:|---:|---:|
| 2010 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2011 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2012 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2013 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2014 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2015 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2016 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2017 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2018 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2019 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2020 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2021 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2022 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2023 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2024 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2025 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2026 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2027 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2028 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2029 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2030 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2031 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2032 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2033 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2034 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2035 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2036 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2037 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2038 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2039 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2040 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2041 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2042 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2043 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2044 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2045 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2046 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2047 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2048 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2049 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2050 | 0 | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 2051 | 0.0100193668234 | 0.00129182146827 (-0.00872754535518) | 0.00160669993874 (-0.0084126668847) | 0 (-0.0100193668234) | 0 (-0.0100193668234) |
| 2052 | 0.0108910310306 | 0.00520282099724 (-0.0056882100334) | 0.00640601711561 (-0.00448501391503) | 0 (-0.0108910310306) | 0 (-0.0108910310306) |
| 2053 | 0.0244613470833 | 0.0161053470136 (-0.00835600006974) | 0.0169915953487 (-0.00746975173469) | 0 (-0.0244613470833) | 0 (-0.0244613470833) |
| 2054 | 0.0316264226817 | 0.0301154846347 (-0.00151093804707) | 0.0287983457869 (-0.00282807689482) | 0 (-0.0316264226817) | 0 (-0.0316264226817) |
| 2055 | 0.0406296878671 | 0.0285893289846 (-0.0120403588825) | 0.0397066422504 (-0.000923045616716) | 0.00462511666494 (-0.0360045712022) | 0 (-0.0406296878671) |
| 2056 | 0.0479925961835 | 0.0432669063547 (-0.00472568982885) | 0.0494030864797 (+0.00141049029616) | 0.00460919979744 (-0.0433833963861) | 0 (-0.0479925961835) |
| 2057 | 0.0605594441453 | 0.056150189789 (-0.00440925435631) | 0.0547291076944 (-0.0058303364509) | 0.00458502431922 (-0.0559744198261) | 0 (-0.0605594441453) |
| 2058 | 0.0762453855407 | 0.0680136762997 (-0.00823170924096) | 0.058744564988 (-0.0175008205527) | 0.00458492962546 (-0.0716604559152) | 0 (-0.0762453855407) |
| 2059 | 0.0910363244426 | 0.0770340073979 (-0.0140023170447) | 0.0722637672603 (-0.0187725571823) | 0.00458502431922 (-0.0864513001234) | 0 (-0.0910363244426) |
| 2060 | 0.103251506482 | 0.0886738163746 (-0.0145776901074) | 0.0819100032892 (-0.0213415031927) | 0.00458502431922 (-0.0986664821627) | 0 (-0.103251506482) |

### Reused Round 2 size-response evidence

The [Round 2 sweep](#fork-noise-envelopes) supplies the +day1 size comparison. The population envelopes below repeat those completed measurements against the same controls. They do not increase monotonically with the size of the grant: the 256 seed-7 envelope falls from 226,318 at §10 to 12,589 at §1,000, then rises to 110,350 at §10,000. The chosen symmetric envelope above follows NOTE-052; the largest positive-only sweep spread is not substituted as extra tolerance.

| Row | +§10 day1 population envelope | +§100 | +§1,000 | +§10,000 |
|---|---:|---:|---:|---:|
| 128x15_s7 | 1145 | 2767 | 3194 | 2620 |
| 256x60_s7 | 226318 | 133913 | 12589 | 110350 |
| 256x60_s11 | 64424 | 66063 | 107059 | 126017 |

### Raw provenance and exact measurement commands

This section is generated by `C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\round3Report.mjs` (SHA256 `c5ec9dc2ded79d1a84a86a32e5ce1090d8a67d343587cf065c490734529fe3d9`). The generator starts no simulations. The selected protocol uses 15 complete runs / 675 annual records; nine symmetric probes are new and the three controls plus three +day1 probes are reused. Original controls recorded their 135 annual state-hash and non-timing-row matches; unchanged simbot/source identities permit reuse despite documentation-only intervening commits.

**128x15_s7_base**: commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_base.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\128x15_s7_base.spec.json
```

**128x15_s7_n100_d1**: commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n100_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\128x15_s7_n100_d1.spec.json
```

**128x15_s7_n-100_d1**: commit `e990432a4e376606880020f1e51806ace1f6e5ee`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/128x15_s7_n-100_d1.json>).

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\128x15_s7_n-100_d1.spec.json'
```

**128x15_s7_n100_d1441**: commit `e990432a4e376606880020f1e51806ace1f6e5ee`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/128x15_s7_n100_d1441.json>).

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\128x15_s7_n100_d1441.spec.json'
```

**128x15_s7_n-100_d1441**: commit `e990432a4e376606880020f1e51806ace1f6e5ee`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/128x15_s7_n-100_d1441.json>).

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\128x15_s7_n-100_d1441.spec.json'
```

**256x60_s7_base**: commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_base.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s7_base.spec.json
```

**256x60_s7_n100_d1**: commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_n100_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s7_n100_d1.spec.json
```

**256x60_s7_n-100_d1**: commit `e990432a4e376606880020f1e51806ace1f6e5ee`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s7_n-100_d1.json>).

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s7_n-100_d1.spec.json'
```

**256x60_s7_n100_d1441**: commit `e990432a4e376606880020f1e51806ace1f6e5ee`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s7_n100_d1441.json>).

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s7_n100_d1441.spec.json'
```

**256x60_s7_n-100_d1441**: commit `e990432a4e376606880020f1e51806ace1f6e5ee`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s7_n-100_d1441.json>).

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s7_n-100_d1441.spec.json'
```

**256x60_s11_base**: commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_base.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s11_base.spec.json
```

**256x60_s11_n100_d1**: commit `3833c8d2379d3350663e624fe30be7867c559310`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_n100_d1.json>).

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s11_n100_d1.spec.json
```

**256x60_s11_n-100_d1**: commit `e990432a4e376606880020f1e51806ace1f6e5ee`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s11_n-100_d1.json>).

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s11_n-100_d1.spec.json'
```

**256x60_s11_n100_d1441**: commit `e990432a4e376606880020f1e51806ace1f6e5ee`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s11_n100_d1441.json>).

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s11_n100_d1441.spec.json'
```

**256x60_s11_n-100_d1441**: commit `e990432a4e376606880020f1e51806ace1f6e5ee`; simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`; source tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. [Full-precision JSON](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s11_n-100_d1441.json>).

```powershell
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s11_n-100_d1441.spec.json'
```

The tree-parameterised NOTE-052 runner and its one-command-per-row reproduction commands are documented in the handoff added with this section. It reruns the protocol on a target tree, retains the smallest tested size that forks the full log for every signed/timed probe, and must be rerun on the dev containing T041. Reused measurements here do not substitute for that new-base measurement.

The symmetric diagnostic exposes whether the one-sided Round 2 downward population endpoints persist under both signs/timings. A mixed classification rules out the stated all-row direction pattern in this finite sample; it does not prove a pure-noise mechanism or turn the envelope into a confidence interval. No RNG draw, simulation balance, strategy, save schema, or baseline was changed.


### Reproduce NOTE-052 (historical size-selection protocol)

The measurement HEAD is `e990432a4e376606880020f1e51806ace1f6e5ee` (the Round 2 results and NOTE-052 are committed). The simulation identities match Round 2: simbot blob `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52`, src tree `1431263237c4fd0acd55c436aa4f232ff0300fba`. New §100 records carry this HEAD; reused records retain their original commit. No simulation or bot-strategy source differs between them. The new runner and tests are uncommitted diagnostics; no production source is edited.

The new [tools/simAaForkEnvelope.mts](../../../tools/simAaForkEnvelope.mts) accepts a target tree and one balance row. It builds with that tree’s local Rolldown and launches each independent child sequentially through the quiet gate. It changes no target-tree files and writes only its explicit output directory. Later-day injection is diagnostic instrumentation, not a new bot flag. Completed evidence is reused only with matching clean `src` and simbot content identities, row, sign, timing and bot configuration. Use the same installed dependency versions for comparisons; dependency identity is not part of the reuse key.

These are the three commands used for the selected §100 matrix, each collecting the missing probes and reusing its same-source control/+day1 run. They are safe to repeat with `--report-only` to regenerate per-row summaries without bots:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simAaForkEnvelope.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T062 --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052 --reuse-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --nudge 100
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simAaForkEnvelope.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T062 --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052 --reuse-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --nudge 100
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simAaForkEnvelope.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T062 --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052 --reuse-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --nudge 100
```

The following commands reproduce the historical Round 3 size-selection protocol, measuring all four signs/timings for every grid size without assuming monotonic fork qualification. NOTE-053 now uses X=§100 ensembles; use Round 4's commands for current T041 and lane gates. These older `--all-sizes` commands remain diagnostic provenance:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simAaForkEnvelope.mts --tree PATH_TO_DEV_WITH_T041 --size 128 --years 15 --seed 7 --out-dir FRESH_T041_SCRATCH --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --all-sizes
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simAaForkEnvelope.mts --tree PATH_TO_DEV_WITH_T041 --size 256 --years 60 --seed 7 --out-dir FRESH_T041_SCRATCH --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --all-sizes
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simAaForkEnvelope.mts --tree PATH_TO_DEV_WITH_T041 --size 256 --years 60 --seed 11 --out-dir FRESH_T041_SCRATCH --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --all-sizes
```

Each `*_note052.summary.json` records `rowQualifyingXs`, every candidate's four first-log differences and envelope, and signed endpoint deltas. These commands reproduce the historical size-selection diagnostic; they are not the current final-gate workflow. NOTE-053 fixes the default X at §100 and uses the control plus its four signed/timed members, with ±2X added for stage two. The old zero-envelope fallback is superseded by ensemble gates. See Round 4 for T041 and lane commands; source identities still prevent reusing results from a different simulation.

### Round 3 verification and limits

- The selected protocol has **15 complete runs / 675 annual records**: three controls and three +§100 day-1 runs reused, nine symmetric/timed probes measured. The five additionally completed §10 probes establish rejection/supporting timing evidence; one in-progress 256×60 s7 +§10 year-5 probe was stopped after §10 had failed on seed 11. Its partial data is excluded. No other process was stopped. All completed probes and that partial attempt used the quiet gate; no two bots ran together.
- Independent `validateRound3.mjs` checked all 12 selected full-log forks and successful-command first differences, all selected annual/action NDJSON against their completed JSON, all 12 pooled metric envelopes and independently maximized relative values. It also rechecked **135 original-control hashes/non-timing rows** and **24 pre-year-5 hashes/rows** (the first four years of each of six timing probes).
- `npx tsc --noEmit`: passed. `tests/sim/botAaFundsNudge.test.ts`: **11 passed**. New `tests/sim/botAaForkEnvelope.test.ts`: **7 passed**, covering log-only qualification, insertions/timing differences, four-run/year-10 maxima, relative denominators/zero controls, and source/sign/timing reuse guards. Each single test file ran sequentially through the quiet gate with the native config loader/thread pool documented below.

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/vitest/vitest.mjs run tests/sim/botAaFundsNudge.test.ts --maxWorkers=1 --configLoader native --pool threads
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/vitest/vitest.mjs run tests/sim/botAaForkEnvelope.test.ts --maxWorkers=1 --configLoader native --pool threads
```

- Flags-off 128×15 s7 remains **192,899**, residents `[61124,93804,37971]`; controls end at **1,513,835 / 1,427,340** on the long rows. No baseline fixture, default strategy, balance constant, RNG draw, host wiring, save format, infra or cloud-held file changed. No cloud requests or outside-scope hunks.
- NOTE-053 supersedes both earlier margin rules: **base gates use ensemble medians and dev bands; variant gates use variant/base medians at the same lane commit**. The older sweep remains measured supporting evidence. The year-5 timing uses the first bot-loop day after four completed years (1441), explicitly documented above because the city calendar changes at day 1440.
- These finite symmetric probes test the specified direction patterns; mixed outcomes do not prove an absence of a money effect or define a statistical confidence interval. Sub-grid thresholds, negative sizes beyond the selected protocol, Hard/save-specific continuations, full-suite and GPU/browser checks were not measured in Round 3. The post-T041 ensembles are completed under NOTE-053 in Round 4. Browser Acceptance checklist: **N/A — T062 has no browser gates**.


## NOTE-053 SIM ensembles (Round 4)

[NOTE-053](../queue/NOTE-053-sim-ensembles.md) replaces NOTE-048 SIM balance items 1–3 and NOTE-052’s interim ±1% base-row rule. Every base and variant gate now uses an ensemble. The selected perturbation remains **X = §100**, with five members: control, ±§100 on day 1, and ±§100 on day 1441. Nine-member stage two adds ±§200 at both timings. No fixture or balance baseline is re-recorded.

This measurement compares pre-T041 dev simulation sources with the read-only T041 measurement tree. Dev’s fifteen members are reused from the committed Round 2/3 evidence after checking source identities; T041’s fifteen members are measured on `f9c94d5`, which combines T041 `8ac9668` with the nudge flag from `3833c8d` and retains both sides of the bot conflict. Documentation-only commit changes are explicit imported aliases, with the original commit and file checksum retained.

Each annual cell below is **median [minimum, maximum]**, in simulation units. Approval is in points; I-HT is the fraction of industrial jobs. Tables include years 1 through the endpoint; normal NOTE-053 base gates inspect every year from year 10. Full precision stays in the linked JSON. Display rounding does not decide verdicts.

### Measured sources and independent verification

| Tree / row | Selected commit | Bot blob | Source tree | Ensemble JSON / SHA-256 |
|---|---|---|---|---|
| Dev 128x15_s7 | `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef` | `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52` | `1431263237c4fd0acd55c436aa4f232ff0300fba` | [summary](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/128x15_s7_ensemble.summary.json>); `017f06319addf63be6b838830988d4764898250188ef72b104dfb6a737504a3d` |
| Dev 256x60_s7 | `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef` | `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52` | `1431263237c4fd0acd55c436aa4f232ff0300fba` | [summary](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s7_ensemble.summary.json>); `acceeed05e28ea0e656be56ddeac48acc422e78287f682db96a078aa2c3e385d` |
| Dev 256x60_s11 | `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef` | `7c057dfe3aabe6a8c8169e7fe433948c6ccd3a52` | `1431263237c4fd0acd55c436aa4f232ff0300fba` | [summary](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s11_ensemble.summary.json>); `7b96d52da4e114f20469879adcabfa7619aa8b1e8b7e812a655cbfeed05e9084` |
| T041 128x15_s7 | `f9c94d561455f229e6984707e4429a32350b6127` | `d3a85c7bbb593f0d9d3a10c67088c426387cc02f` | `c974ded700905f1526082c39c3fcb92b5dd0c227` | [summary](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/128x15_s7_ensemble.summary.json>); `22c91ef0b1e79cb286afc1e10399d42b1aa2f0803303e80c48874a9e89e22853` |
| T041 256x60_s7 | `f9c94d561455f229e6984707e4429a32350b6127` | `d3a85c7bbb593f0d9d3a10c67088c426387cc02f` | `c974ded700905f1526082c39c3fcb92b5dd0c227` | [summary](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s7_ensemble.summary.json>); `574b5230fdecf2d9b8184cafa57d1d82c11b16de710de58b2eb4afd985a105eb` |
| T041 256x60_s11 | `f9c94d561455f229e6984707e4429a32350b6127` | `d3a85c7bbb593f0d9d3a10c67088c426387cc02f` | `c974ded700905f1526082c39c3fcb92b5dd0c227` | [summary](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s11_ensemble.summary.json>); `62cb0c3ef055e73cf4eb46ede72f0cb2bd11ab306c3235b6b2176dc80f1fd409` |

Independent scratch verifier: `C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\round4Report.mjs`. It imports no runner statistics or comparison logic. It independently sorts five raw observations per metric/year, checks the middle element and endpoints, and asserts exact equality with all six ensemble summaries. It also checks source/row/nudge/timing/cache identities, annual indexing, residents/population, approval, I-HT job arithmetic, imported hashes and unchanged imported payloads. Counts: **30 members, 1350 raw annual observations, 270 annual ensemble rows and 1080 metric bands**; **15 imported members**, all imported payloads checked.

Shared dependency identity: `563d006dba91bbf3212dd9c02d7508488e5c901c8063576886fa9dd9c471f89e`; observer identity: `d521f1e3fbd7a0b4c03d37c356d798a87ad78e06461ba8fcd9bc217e1bf82270`. These are recorded in every member’s cache key alongside its exact selected commit, simulation sources, row, signed amount, day and bot arguments.

### NOTE-050 sign-off rechecked on ensemble medians

NOTE-050’s signed D2 base-row allowance is **±3% population at each row’s endpoint**. NOTE-053 reopens that sign-off only when an endpoint median leaves ±3%. The year-by-year departures below are reported as by-design history and do not independently reopen the sign-off. The normal NOTE-053 in-band and half-band gate is a separate diagnostic here; it does not replace T041’s explicit signed exception. The original large-effect fixed-tax sweep and delayed-tax target are not rerun in this measurement; NOTE-053 preserves those checks.

| Row / endpoint | Dev population median [min, max] | T041 population median [min, max] | Median Δ | Median Δ% | Within ±3% / reopen? |
|---|---:|---:|---:|---:|---|
| 128x15_s7 / 2015 (year 15) | 191588 [190132, 193108] | 193098 [191999, 193831] | +1510 | +0.788149570954% | Inside; do not reopen |
| 256x60_s7 / 2060 (year 60) | 1461087 [1379922, 1513835] | 1477908 [1378044, 1511394] | +16821 | +1.15126614637% | Inside; do not reopen |
| 256x60_s11 / 2060 (year 60) | 1483518 [1427340, 1503201] | 1468252 [1449829, 1483998] | -15266 | -1.02904042957% | Inside; do not reopen |

0 of 3 endpoint medians leave ±3%. T041’s NOTE-050 sign-off remains closed under its endpoint criterion.

| Row | All years outside ±3% (calendar years; count) | Years ≥10 outside ±3% (calendar years; count) | First excursion | First return within ±3% after that excursion |
|---|---|---|---|---|
| 128x15_s7 | 2002–2006; 5/15 | none; 0/6 | 2002 (year 2) | 2007 (year 7) |
| 256x60_s7 | 2002, 2006–2038, 2041, 2052; 36/60 | 2010–2038, 2041, 2052; 31/51 | 2002 (year 2) | 2003 (year 3) |
| 256x60_s11 | 2002–2003, 2006–2049, 2051–2054; 50/60 | 2010–2049, 2051–2054; 44/51 | 2002 (year 2) | 2004 (year 4) |

A first return is the first later checkpoint inside ±3%; later excursions remain listed. Relative deltas use that year’s dev ensemble population median, rather than the unnudged member or the endpoint value.

### Annual T041 population median deltas

#### 128x15_s7 — population sign-off history

| Year index | Calendar year | Dev median | T041 median | Signed Δ | Signed Δ% | Outside ±3%? |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 2001 | 3587 | 3599 | +12 | +0.334541399498% | no |
| 2 | 2002 | 9297 | 10022 | +725 | +7.79821447779% | yes |
| 3 | 2003 | 17010 | 18210 | +1200 | +7.05467372134% | yes |
| 4 | 2004 | 25619 | 27641 | +2022 | +7.89257972598% | yes |
| 5 | 2005 | 34686 | 36771 | +2085 | +6.01107074901% | yes |
| 6 | 2006 | 44579 | 47029 | +2450 | +5.49586127997% | yes |
| 7 | 2007 | 56990 | 58357 | +1367 | +2.39866643271% | no |
| 8 | 2008 | 70194 | 70599 | +405 | +0.576972390803% | no |
| 9 | 2009 | 84462 | 84478 | +16 | +0.0189434301816% | no |
| 10 | 2010 | 100141 | 100310 | +169 | +0.168762045516% | no |
| 11 | 2011 | 116914 | 117271 | +357 | +0.305352652377% | no |
| 12 | 2012 | 135052 | 135534 | +482 | +0.356899564612% | no |
| 13 | 2013 | 154050 | 154311 | +261 | +0.169425511198% | no |
| 14 | 2014 | 172301 | 173340 | +1039 | +0.603014492081% | no |
| 15 | 2015 | 191588 | 193098 | +1510 | +0.788149570954% | no |

#### 256x60_s7 — population sign-off history

| Year index | Calendar year | Dev median | T041 median | Signed Δ | Signed Δ% | Outside ±3%? |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 2001 | 3589 | 3656 | +67 | +1.86681526888% | no |
| 2 | 2002 | 9859 | 10247 | +388 | +3.93549041485% | yes |
| 3 | 2003 | 17676 | 18113 | +437 | +2.47227879611% | no |
| 4 | 2004 | 26909 | 26862 | -47 | -0.174662752239% | no |
| 5 | 2005 | 36040 | 35575 | -465 | -1.29023307436% | no |
| 6 | 2006 | 46912 | 44292 | -2620 | -5.58492496589% | yes |
| 7 | 2007 | 59034 | 53027 | -6007 | -10.1754920893% | yes |
| 8 | 2008 | 72763 | 64328 | -8435 | -11.5924302187% | yes |
| 9 | 2009 | 85695 | 77185 | -8510 | -9.93056771107% | yes |
| 10 | 2010 | 99145 | 89892 | -9253 | -9.33279540068% | yes |
| 11 | 2011 | 112884 | 103331 | -9553 | -8.46266964317% | yes |
| 12 | 2012 | 129198 | 116857 | -12341 | -9.552005449% | yes |
| 13 | 2013 | 145600 | 132822 | -12778 | -8.7760989011% | yes |
| 14 | 2014 | 162928 | 149603 | -13325 | -8.1784591967% | yes |
| 15 | 2015 | 181762 | 167640 | -14122 | -7.76950077574% | yes |
| 16 | 2016 | 201275 | 186097 | -15178 | -7.54092659297% | yes |
| 17 | 2017 | 220777 | 205169 | -15608 | -7.06957699398% | yes |
| 18 | 2018 | 241134 | 223887 | -17247 | -7.15245465177% | yes |
| 19 | 2019 | 262375 | 244050 | -18325 | -6.98427822773% | yes |
| 20 | 2020 | 284938 | 265947 | -18991 | -6.66495869277% | yes |
| 21 | 2021 | 309055 | 288598 | -20457 | -6.61921017295% | yes |
| 22 | 2022 | 332599 | 311540 | -21059 | -6.33164862191% | yes |
| 23 | 2023 | 356659 | 334344 | -22315 | -6.25667654538% | yes |
| 24 | 2024 | 380900 | 359650 | -21250 | -5.57889209766% | yes |
| 25 | 2025 | 406912 | 384590 | -22322 | -5.48570698333% | yes |
| 26 | 2026 | 433030 | 411685 | -21345 | -4.92921968455% | yes |
| 27 | 2027 | 461632 | 439616 | -22016 | -4.7691667822% | yes |
| 28 | 2028 | 491442 | 468498 | -22944 | -4.6687096341% | yes |
| 29 | 2029 | 522372 | 497990 | -24382 | -4.66755492255% | yes |
| 30 | 2030 | 553169 | 529330 | -23839 | -4.30953289139% | yes |
| 31 | 2031 | 584845 | 561093 | -23752 | -4.06124699707% | yes |
| 32 | 2032 | 616271 | 592757 | -23514 | -3.81552920712% | yes |
| 33 | 2033 | 649520 | 624609 | -24911 | -3.83529375539% | yes |
| 34 | 2034 | 681383 | 656920 | -24463 | -3.59019817049% | yes |
| 35 | 2035 | 715266 | 688697 | -26569 | -3.71456213493% | yes |
| 36 | 2036 | 747267 | 722927 | -24340 | -3.25720257953% | yes |
| 37 | 2037 | 781483 | 756906 | -24577 | -3.14491805964% | yes |
| 38 | 2038 | 816400 | 790558 | -25842 | -3.16536011759% | yes |
| 39 | 2039 | 849116 | 823848 | -25268 | -2.9758007151% | no |
| 40 | 2040 | 885781 | 859443 | -26338 | -2.97342119553% | no |
| 41 | 2041 | 922651 | 894479 | -28172 | -3.05337554503% | yes |
| 42 | 2042 | 954296 | 927255 | -27041 | -2.83360718268% | no |
| 43 | 2043 | 990452 | 964182 | -26270 | -2.65232439331% | no |
| 44 | 2044 | 1029252 | 1001797 | -27455 | -2.66747113438% | no |
| 45 | 2045 | 1066213 | 1037419 | -28794 | -2.70058609302% | no |
| 46 | 2046 | 1106293 | 1076520 | -29773 | -2.69124002412% | no |
| 47 | 2047 | 1143633 | 1115397 | -28236 | -2.46897387536% | no |
| 48 | 2048 | 1186078 | 1152504 | -33574 | -2.83067386799% | no |
| 49 | 2049 | 1225463 | 1195156 | -30307 | -2.47310608317% | no |
| 50 | 2050 | 1265741 | 1231431 | -34310 | -2.71066513607% | no |
| 51 | 2051 | 1306287 | 1267957 | -38330 | -2.93427095271% | no |
| 52 | 2052 | 1342501 | 1300168 | -42333 | -3.15329374056% | yes |
| 53 | 2053 | 1354614 | 1339536 | -15078 | -1.11308461303% | no |
| 54 | 2054 | 1374323 | 1372454 | -1869 | -0.135994231342% | no |
| 55 | 2055 | 1398399 | 1394146 | -4253 | -0.304133512681% | no |
| 56 | 2056 | 1419186 | 1416272 | -2914 | -0.205328970269% | no |
| 57 | 2057 | 1418230 | 1437575 | +19345 | +1.36402417097% | no |
| 58 | 2058 | 1442416 | 1454940 | +12524 | +0.868265465719% | no |
| 59 | 2059 | 1447648 | 1461510 | +13862 | +0.957553217357% | no |
| 60 | 2060 | 1461087 | 1477908 | +16821 | +1.15126614637% | no |

#### 256x60_s11 — population sign-off history

| Year index | Calendar year | Dev median | T041 median | Signed Δ | Signed Δ% | Outside ±3%? |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 2001 | 3634 | 3661 | +27 | +0.74298293891% | no |
| 2 | 2002 | 9461 | 10167 | +706 | +7.46221329669% | yes |
| 3 | 2003 | 17370 | 17993 | +623 | +3.58664363846% | yes |
| 4 | 2004 | 26074 | 26762 | +688 | +2.63864385978% | no |
| 5 | 2005 | 34606 | 34423 | -183 | -0.528810032942% | no |
| 6 | 2006 | 44972 | 43431 | -1541 | -3.42657653651% | yes |
| 7 | 2007 | 57137 | 54047 | -3090 | -5.40805432557% | yes |
| 8 | 2008 | 70387 | 65847 | -4540 | -6.4500546976% | yes |
| 9 | 2009 | 83746 | 78785 | -4961 | -5.92386502042% | yes |
| 10 | 2010 | 97010 | 91557 | -5453 | -5.62106999278% | yes |
| 11 | 2011 | 111220 | 104818 | -6402 | -5.75615896422% | yes |
| 12 | 2012 | 126617 | 118744 | -7873 | -6.21796441236% | yes |
| 13 | 2013 | 143996 | 135047 | -8949 | -6.21475596544% | yes |
| 14 | 2014 | 162893 | 151257 | -11636 | -7.1433394928% | yes |
| 15 | 2015 | 181910 | 168939 | -12971 | -7.13044912319% | yes |
| 16 | 2016 | 201032 | 186073 | -14959 | -7.44110390386% | yes |
| 17 | 2017 | 220264 | 203761 | -16503 | -7.49237278902% | yes |
| 18 | 2018 | 240111 | 221823 | -18288 | -7.61647737921% | yes |
| 19 | 2019 | 261751 | 241711 | -20040 | -7.65613120867% | yes |
| 20 | 2020 | 284274 | 264021 | -20253 | -7.12446442517% | yes |
| 21 | 2021 | 307076 | 286313 | -20763 | -6.7615183212% | yes |
| 22 | 2022 | 331951 | 308840 | -23111 | -6.96217212781% | yes |
| 23 | 2023 | 355340 | 331939 | -23401 | -6.58552372376% | yes |
| 24 | 2024 | 380475 | 355902 | -24573 | -6.4585058151% | yes |
| 25 | 2025 | 405400 | 380454 | -24946 | -6.15342871238% | yes |
| 26 | 2026 | 431885 | 405961 | -25924 | -6.00252382% | yes |
| 27 | 2027 | 459324 | 433539 | -25785 | -5.61368445803% | yes |
| 28 | 2028 | 488133 | 460980 | -27153 | -5.56262330144% | yes |
| 29 | 2029 | 518809 | 490355 | -28454 | -5.4844846562% | yes |
| 30 | 2030 | 549130 | 520386 | -28744 | -5.23446178501% | yes |
| 31 | 2031 | 579744 | 551293 | -28451 | -4.90751090136% | yes |
| 32 | 2032 | 610615 | 582872 | -27743 | -4.54345209338% | yes |
| 33 | 2033 | 643353 | 614803 | -28550 | -4.4376881743% | yes |
| 34 | 2034 | 675552 | 647676 | -27876 | -4.12640329686% | yes |
| 35 | 2035 | 708864 | 680440 | -28424 | -4.00979595522% | yes |
| 36 | 2036 | 741622 | 713526 | -28096 | -3.78845287761% | yes |
| 37 | 2037 | 776288 | 746890 | -29398 | -3.78699657859% | yes |
| 38 | 2038 | 811907 | 782783 | -29124 | -3.58711034638% | yes |
| 39 | 2039 | 844940 | 816910 | -28030 | -3.31739531801% | yes |
| 40 | 2040 | 880019 | 851718 | -28301 | -3.21595329192% | yes |
| 41 | 2041 | 914584 | 886954 | -27630 | -3.02104563386% | yes |
| 42 | 2042 | 952007 | 921687 | -30320 | -3.18485053156% | yes |
| 43 | 2043 | 989261 | 957752 | -31509 | -3.18510484089% | yes |
| 44 | 2044 | 1030678 | 995582 | -35096 | -3.40513720095% | yes |
| 45 | 2045 | 1068216 | 1032581 | -35635 | -3.33593580325% | yes |
| 46 | 2046 | 1109143 | 1071494 | -37649 | -3.39442254065% | yes |
| 47 | 2047 | 1144048 | 1108588 | -35460 | -3.09952029985% | yes |
| 48 | 2048 | 1186527 | 1144642 | -41885 | -3.53005030648% | yes |
| 49 | 2049 | 1225495 | 1187911 | -37584 | -3.06684237798% | yes |
| 50 | 2050 | 1262250 | 1226709 | -35541 | -2.81568627451% | no |
| 51 | 2051 | 1307156 | 1259890 | -47266 | -3.61594178507% | yes |
| 52 | 2052 | 1352531 | 1295524 | -57007 | -4.21483869871% | yes |
| 53 | 2053 | 1387290 | 1324550 | -62740 | -4.52248628621% | yes |
| 54 | 2054 | 1401401 | 1358531 | -42870 | -3.05908159049% | yes |
| 55 | 2055 | 1426671 | 1390949 | -35722 | -2.50387089946% | no |
| 56 | 2056 | 1444001 | 1410391 | -33610 | -2.32756071499% | no |
| 57 | 2057 | 1456317 | 1429503 | -26814 | -1.84122000911% | no |
| 58 | 2058 | 1462768 | 1442854 | -19914 | -1.36139155355% | no |
| 59 | 2059 | 1482680 | 1457276 | -25404 | -1.71338387245% | no |
| 60 | 2060 | 1483518 | 1468252 | -15266 | -1.02904042957% | no |

### Dev and T041 annual ensemble tables

#### Dev 128x15_s7 — five members

| Year index | Calendar year | Population median [min, max] | Approval median [min, max] | Air at homes median [min, max] | I-HT fraction median [min, max] |
|---:|---:|---:|---:|---:|---:|
| 1 | 2001 | 3587 [3587, 3587] | 51.1884035286 [51.1884035286, 51.1884035286] | 0.0147653123001 [0.0147653123001, 0.0147653123001] | 0 [0, 0] |
| 2 | 2002 | 9297 [9297, 9297] | 50.6166293818 [50.6166293818, 50.6166293818] | 0.0269580231162 [0.0269580231162, 0.0269580231162] | 0 [0, 0] |
| 3 | 2003 | 17010 [17010, 17010] | 51.9714851262 [51.9714851262, 51.9714851262] | 0.0375462229686 [0.0375462229686, 0.0375462229686] | 0 [0, 0] |
| 4 | 2004 | 25619 [25491, 25619] | 49.5648352861 [49.4477675913, 49.5648352861] | 0.0486614517515 [0.0467647058721, 0.0486614517515] | 0 [0, 0] |
| 5 | 2005 | 34686 [34443, 34852] | 47.486406189 [47.486406189, 47.6903027912] | 0.0469691969262 [0.0455844140269, 0.0469691969262] | 0 [0, 0] |
| 6 | 2006 | 44579 [44172, 45649] | 51.9172890525 [51.7539309148, 53.0823352327] | 0.0450986090006 [0.0448973945652, 0.0466892967788] | 0 [0, 0] |
| 7 | 2007 | 56990 [55962, 57714] | 56.2007453202 [56.1685842318, 57.7083707164] | 0.0454504677487 [0.0447395143377, 0.0460911328083] | 0 [0, 0] |
| 8 | 2008 | 70194 [69406, 70869] | 61.5219998507 [60.8080252149, 62.2691080503] | 0.0446455289547 [0.0446178787957, 0.0459631518627] | 0 [0, 0] |
| 9 | 2009 | 84462 [83282, 84835] | 66.5008963601 [66.2285513381, 67.359854187] | 0.0728525522913 [0.0678903063921, 0.0734849823832] | 0 [0, 0] |
| 10 | 2010 | 100141 [98826, 101026] | 70.8518853117 [69.9000558341, 72.4202017087] | 0.0737038752696 [0.0691769460273, 0.0744164291217] | 0 [0, 0] |
| 11 | 2011 | 116914 [115670, 118282] | 73.3377191709 [73.0679494545, 75.2252772179] | 0.0745574719959 [0.0734733641701, 0.0764198389775] | 0 [0, 0] |
| 12 | 2012 | 135052 [133816, 136272] | 75.0662775328 [75.0147602906, 76.9954753925] | 0.0726766850373 [0.0708048271401, 0.0737493244753] | 0 [0, 0] |
| 13 | 2013 | 154050 [151950, 154203] | 76.7186051919 [76.3292420144, 78.1388951287] | 0.0785338317705 [0.0777135397159, 0.0787714041308] | 0 [0, 0] |
| 14 | 2014 | 172301 [170539, 173724] | 78.6313229539 [78.3821382274, 79.4049512588] | 0.0864130956845 [0.0833283045672, 0.0872473908458] | 0 [0, 0] |
| 15 | 2015 | 191588 [190132, 193108] | 81.3650175025 [80.9060989013, 81.556299867] | 0.0928730666149 [0.0908835924374, 0.0964932018316] | 0 [0, 0] |

#### Dev 256x60_s7 — five members

| Year index | Calendar year | Population median [min, max] | Approval median [min, max] | Air at homes median [min, max] | I-HT fraction median [min, max] |
|---:|---:|---:|---:|---:|---:|
| 1 | 2001 | 3589 [3589, 3589] | 51.902115855 [51.902115855, 51.902115855] | 0.014912420357 [0.014912420357, 0.014912420357] | 0 [0, 0] |
| 2 | 2002 | 9859 [9859, 9859] | 56.0865856671 [56.0865856671, 56.0865856671] | 0.0341256320982 [0.0341256320982, 0.0341256320982] | 0 [0, 0] |
| 3 | 2003 | 17676 [17542, 17676] | 47.3216618305 [47.2560078014, 47.3216618305] | 0.0466639209096 [0.0434080432614, 0.0466639209096] | 0 [0, 0] |
| 4 | 2004 | 26909 [26610, 26909] | 46.6834035121 [46.3621129974, 46.6834035121] | 0.0485543255938 [0.0447409215181, 0.0485543255938] | 0 [0, 0] |
| 5 | 2005 | 36040 [35927, 36243] | 46.2379636009 [46.0634684134, 47.2787777975] | 0.049111088069 [0.0463979878456, 0.0521129137068] | 0 [0, 0] |
| 6 | 2006 | 46912 [46868, 47461] | 55.3244213147 [52.6611282722, 55.6778459348] | 0.0474273534688 [0.0457705839342, 0.0486261337664] | 0 [0, 0] |
| 7 | 2007 | 59034 [58626, 59679] | 59.2980952219 [57.2513081975, 60.4688401536] | 0.0497870514584 [0.0489292652431, 0.0513105084426] | 0 [0, 0] |
| 8 | 2008 | 72763 [72000, 72766] | 63.0542428448 [61.7518911238, 64.8843889893] | 0.0581751315694 [0.0515419581623, 0.063033363255] | 0 [0, 0] |
| 9 | 2009 | 85695 [84826, 85796] | 65.5295207164 [64.0909777825, 65.8224769737] | 0.0814106014216 [0.0710629709144, 0.0844099514083] | 0 [0, 0] |
| 10 | 2010 | 99145 [98274, 99253] | 63.8207616878 [62.1769382346, 63.8830864747] | 0.0739850444917 [0.0699563236806, 0.0802627946323] | 0 [0, 0] |
| 11 | 2011 | 112884 [112139, 113394] | 62.1163974625 [61.6347522976, 63.2229332272] | 0.0694879238085 [0.0601583915644, 0.0700432335119] | 0 [0, 0] |
| 12 | 2012 | 129198 [127207, 130031] | 61.6471759948 [61.0514145318, 67.0670374638] | 0.0590170184239 [0.0547563621067, 0.0590557211552] | 0 [0, 0] |
| 13 | 2013 | 145600 [144178, 146526] | 64.3568218479 [62.2839695264, 67.7892603094] | 0.0590546329688 [0.054735849427, 0.0602716823544] | 0 [0, 0] |
| 14 | 2014 | 162928 [160481, 163206] | 66.185627447 [64.5977660967, 67.8405307697] | 0.0585039394277 [0.0533041738602, 0.0601129027154] | 0 [0, 0] |
| 15 | 2015 | 181762 [180069, 182155] | 69.0050762861 [68.7736616745, 69.3903791891] | 0.0563234720299 [0.0520474226221, 0.0565621396886] | 0 [0, 0] |
| 16 | 2016 | 201275 [199101, 201610] | 69.9951035479 [69.923648637, 70.1598871862] | 0.0551385476053 [0.0526888852507, 0.0578913055256] | 0 [0, 0] |
| 17 | 2017 | 220777 [218074, 221905] | 69.517886913 [69.4188273617, 70.685579499] | 0.0553132853763 [0.0534986620443, 0.0620043357323] | 0 [0, 0] |
| 18 | 2018 | 241134 [239141, 242093] | 69.986378043 [69.9004616121, 70.3879066239] | 0.0577463087727 [0.0534298215879, 0.0632737035353] | 0 [0, 0] |
| 19 | 2019 | 262375 [260393, 263043] | 71.1729072576 [70.2671187341, 71.4754971645] | 0.0551992230652 [0.0533046888207, 0.0683982320683] | 0 [0, 0] |
| 20 | 2020 | 284938 [283841, 285431] | 72.1371693692 [71.2536573593, 72.5607755828] | 0.0548954530563 [0.0522226282819, 0.0595928518964] | 0 [0, 0] |
| 21 | 2021 | 309055 [307460, 309551] | 72.7557117057 [72.4112819559, 73.9583321142] | 0.0536702474236 [0.051047701643, 0.061835959954] | 0 [0, 0] |
| 22 | 2022 | 332599 [330779, 332670] | 75.4310635313 [75.3358113332, 76.3700096606] | 0.0532523899714 [0.0499785533711, 0.0608312173134] | 0 [0, 0] |
| 23 | 2023 | 356659 [354200, 357442] | 76.342032398 [76.2288094072, 76.9512044095] | 0.0536960108499 [0.0507366522873, 0.062303437841] | 0 [0, 0] |
| 24 | 2024 | 380900 [378985, 382163] | 76.6132485291 [75.4614011897, 77.0661490765] | 0.0570906756188 [0.0529724048716, 0.0694638608233] | 0 [0, 0] |
| 25 | 2025 | 406912 [404262, 407731] | 76.8474486626 [76.4997075282, 77.1276849904] | 0.0578569471507 [0.0572523507335, 0.0681830300373] | 0 [0, 0] |
| 26 | 2026 | 433030 [431806, 433598] | 76.5059936839 [76.0578162169, 77.201767656] | 0.0578413540984 [0.0576544237627, 0.0681487009787] | 0 [0, 0] |
| 27 | 2027 | 461632 [460757, 461953] | 77.7635714659 [77.6260208603, 78.2094524809] | 0.0592879334372 [0.0579550492795, 0.0694904468741] | 0 [0, 0] |
| 28 | 2028 | 491442 [489700, 491659] | 77.5878293884 [77.3822568207, 78.7304332546] | 0.0598405489781 [0.0580580143984, 0.0713018696509] | 0 [0, 0] |
| 29 | 2029 | 522372 [519724, 522937] | 78.665187276 [78.535558838, 79.3833210906] | 0.0646516106759 [0.0625188177239, 0.0766479039481] | 0 [0, 0] |
| 30 | 2030 | 553169 [550399, 553583] | 79.881255312 [79.4576306687, 80.3749907249] | 0.0662961153293 [0.0657542974046, 0.0801341995663] | 0 [0, 0] |
| 31 | 2031 | 584845 [580940, 585610] | 81.3154538597 [81.129591828, 81.3426041265] | 0.0720512714269 [0.071387970564, 0.0844021845717] | 0 [0, 0] |
| 32 | 2032 | 616271 [613290, 617395] | 81.8707557972 [81.3780773367, 82.2056823218] | 0.0777944140293 [0.0762349641241, 0.0921530972229] | 0 [0, 0] |
| 33 | 2033 | 649520 [645810, 649727] | 82.1871823006 [81.9068757713, 82.4035368299] | 0.0802682566791 [0.080072674836, 0.095025260551] | 0 [0, 0] |
| 34 | 2034 | 681383 [678863, 681622] | 81.8762409523 [81.8116427338, 82.7216193094] | 0.0862932629323 [0.0854119381418, 0.0984079420798] | 0 [0, 0] |
| 35 | 2035 | 715266 [711503, 715283] | 82.5384176932 [82.1188384802, 82.6115277297] | 0.0900893304223 [0.0888725503557, 0.106854005488] | 0 [0, 0] |
| 36 | 2036 | 747267 [745163, 747885] | 81.682528931 [80.7596983645, 82.0831285934] | 0.0985766757053 [0.096559708282, 0.112796976636] | 0 [0, 0] |
| 37 | 2037 | 781483 [778371, 781532] | 81.9702029966 [81.3545245065, 82.1080479323] | 0.111184867164 [0.102755676251, 0.122396988761] | 0 [0, 0] |
| 38 | 2038 | 816400 [814131, 818087] | 81.8263275001 [79.7789881066, 82.1077685112] | 0.113757455394 [0.111509206562, 0.132840868297] | 0 [0, 0] |
| 39 | 2039 | 849116 [848274, 853454] | 81.6680640579 [80.6149224318, 82.0318126819] | 0.117889086092 [0.117469039436, 0.138909582156] | 0 [0, 0] |
| 40 | 2040 | 885781 [885012, 890501] | 82.2978528738 [81.4937968568, 82.6186158782] | 0.123397884516 [0.118367254642, 0.13951387196] | 0 [0, 0] |
| 41 | 2041 | 922651 [917818, 928329] | 82.6811451297 [81.3243931387, 82.6850781617] | 0.125318391669 [0.121413257917, 0.143379778413] | 0 [0, 0] |
| 42 | 2042 | 954296 [951529, 957446] | 81.7318925805 [80.8415919546, 82.0639661132] | 0.131581969679 [0.128251480154, 0.147671955797] | 0 [0, 0] |
| 43 | 2043 | 990452 [988082, 997916] | 81.4184619882 [79.8445693135, 82.5827416228] | 0.132227601661 [0.130338848098, 0.155297690857] | 0 [0, 0] |
| 44 | 2044 | 1029252 [1023376, 1034676] | 81.4090083679 [80.0097050034, 81.5077523582] | 0.140588745833 [0.13882561089, 0.158979489623] | 0 [0, 0] |
| 45 | 2045 | 1066213 [1064870, 1072615] | 80.9601454361 [79.7520941943, 81.1881858681] | 0.145699677246 [0.143134952917, 0.160586629451] | 0 [0, 0] |
| 46 | 2046 | 1106293 [1098739, 1110071] | 80.8512483237 [79.5704829996, 81.0005068417] | 0.150067530572 [0.144261354987, 0.166444098207] | 0 [0, 0] |
| 47 | 2047 | 1143633 [1138642, 1152095] | 80.1748088328 [79.2554570494, 81.0588852664] | 0.147691928499 [0.14765903251, 0.167729313218] | 0 [0, 0] |
| 48 | 2048 | 1186078 [1177033, 1187726] | 80.4624820383 [79.8964904416, 80.8686423011] | 0.15336972846 [0.147753026628, 0.172723700048] | 0 [0, 0.00175555599145] |
| 49 | 2049 | 1225463 [1219475, 1232104] | 80.7488537718 [78.807667578, 80.9511105372] | 0.150475101405 [0.147350051474, 0.169689774178] | 0 [0, 0.0135973647924] |
| 50 | 2050 | 1265741 [1260949, 1271588] | 80.8282333843 [79.0001615783, 80.8447373631] | 0.155464893246 [0.154532950761, 0.177092364457] | 0.0136107814235 [0, 0.0266876566095] |
| 51 | 2051 | 1306287 [1299862, 1310245] | 79.6780085888 [78.9820083742, 80.7534327958] | 0.164149715258 [0.152603594368, 0.178798806246] | 0.017711478238 [0.00592249012918, 0.0322995310774] |
| 52 | 2052 | 1342501 [1317983, 1347980] | 80.4376637069 [78.7405308964, 80.6369747076] | 0.154956977403 [0.153368043387, 0.177893690569] | 0.0256530991081 [0.00814035221034, 0.0394797299685] |
| 53 | 2053 | 1354614 [1331848, 1392709] | 80.0034644751 [78.7171376936, 80.7548470143] | 0.164037287854 [0.155333511713, 0.174625979708] | 0.0389398138279 [0.00956450956451, 0.0588376540404] |
| 54 | 2054 | 1374323 [1341305, 1413703] | 80.5938057518 [78.74415033, 81.0113417551] | 0.164129877814 [0.152678693712, 0.182993966319] | 0.053544494721 [0.0236319752152, 0.0747528916054] |
| 55 | 2055 | 1398399 [1338273, 1433758] | 79.8113875174 [79.0876602917, 81.1146004517] | 0.16540508106 [0.156632087612, 0.175748978394] | 0.0676564334843 [0.0366587441133, 0.0799960858184] |
| 56 | 2056 | 1419186 [1351622, 1455861] | 80.0662775043 [79.0694871654, 81.0223110796] | 0.156350000107 [0.154205469717, 0.18611066335] | 0.0838448478516 [0.0559334779715, 0.0967523307406] |
| 57 | 2057 | 1418230 [1360384, 1470002] | 80.4826074625 [79.2567015091, 80.5079109207] | 0.17084205647 [0.153725182706, 0.181635705648] | 0.11023559941 [0.069570251311, 0.113108534011] |
| 58 | 2058 | 1442416 [1363572, 1488790] | 80.0913343012 [79.7689561178, 80.9268790245] | 0.168051154679 [0.153828657944, 0.187011146621] | 0.123119258943 [0.0838402495588, 0.129007519917] |
| 59 | 2059 | 1447648 [1372983, 1504810] | 79.8836708941 [79.4466630409, 80.6622888259] | 0.169665793985 [0.156109528702, 0.18516328007] | 0.122839370876 [0.0939054034731, 0.128900168955] |
| 60 | 2060 | 1461087 [1379922, 1513835] | 80.3574246959 [79.7398013242, 80.5414097299] | 0.167190377439 [0.158303165101, 0.183209193398] | 0.126146721117 [0.10239866758, 0.137623904611] |

#### Dev 256x60_s11 — five members

| Year index | Calendar year | Population median [min, max] | Approval median [min, max] | Air at homes median [min, max] | I-HT fraction median [min, max] |
|---:|---:|---:|---:|---:|---:|
| 1 | 2001 | 3634 [3634, 3634] | 51.1669426473 [51.1669426473, 51.1669426473] | 0.0125338223262 [0.0125338223262, 0.0125338223262] | 0 [0, 0] |
| 2 | 2002 | 9461 [9461, 9461] | 46.6624431035 [46.6624431035, 46.6624431035] | 0.0446199911465 [0.0446199911465, 0.0446199911465] | 0 [0, 0] |
| 3 | 2003 | 17370 [17370, 17370] | 45.4926988303 [45.4926988303, 45.4926988303] | 0.0567262029023 [0.0567262029023, 0.0567262029023] | 0 [0, 0] |
| 4 | 2004 | 26074 [25970, 26074] | 43.6985842281 [42.7042920231, 43.6985842281] | 0.056503820274 [0.0539136546406, 0.056503820274] | 0 [0, 0] |
| 5 | 2005 | 34606 [34606, 34718] | 42.832613243 [41.0578732157, 42.832613243] | 0.0546112497912 [0.0518687455972, 0.0580098089962] | 0 [0, 0] |
| 6 | 2006 | 44972 [44070, 45728] | 51.2204678328 [49.5803522644, 52.5132958993] | 0.0504781825116 [0.0478325802093, 0.0558921190968] | 0 [0, 0] |
| 7 | 2007 | 57137 [55482, 57352] | 56.6998983842 [55.9263345743, 57.234473562] | 0.049418770036 [0.0433983764311, 0.0513686760002] | 0 [0, 0] |
| 8 | 2008 | 70387 [68790, 70734] | 61.6119498453 [58.0622604459, 62.5453126489] | 0.0486642486108 [0.048573412617, 0.0547455184495] | 0 [0, 0] |
| 9 | 2009 | 83746 [82561, 83910] | 64.9856442394 [63.786206324, 66.7839555817] | 0.0669017957766 [0.0612667295704, 0.0702475385897] | 0 [0, 0] |
| 10 | 2010 | 97010 [96079, 97480] | 64.5131653156 [63.0769391389, 64.9457940974] | 0.065350349494 [0.0606476563068, 0.0741703598792] | 0 [0, 0] |
| 11 | 2011 | 111220 [110096, 111424] | 63.4003528592 [61.8757810925, 64.0420290185] | 0.0593061927397 [0.055855359234, 0.0645595073575] | 0 [0, 0] |
| 12 | 2012 | 126617 [125601, 127871] | 62.7494778673 [61.9924189426, 63.5637266137] | 0.0525824920964 [0.0497127203034, 0.0562949667144] | 0 [0, 0] |
| 13 | 2013 | 143996 [142480, 145099] | 63.4843576984 [62.4083362375, 64.4907655201] | 0.0510184235683 [0.0482164861661, 0.0555974714951] | 0 [0, 0] |
| 14 | 2014 | 162893 [159429, 163214] | 69.7922046748 [64.8070438681, 70.2355302508] | 0.0522545755233 [0.0462435253149, 0.055483865296] | 0 [0, 0] |
| 15 | 2015 | 181910 [178036, 182428] | 70.2828251982 [67.0215711403, 71.1467203415] | 0.0514671112541 [0.045746366541, 0.0565486899266] | 0 [0, 0] |
| 16 | 2016 | 201032 [198931, 202147] | 70.930926154 [70.4025500066, 72.3115621325] | 0.0522574326203 [0.0441526707332, 0.0565367466969] | 0 [0, 0] |
| 17 | 2017 | 220264 [217743, 221560] | 71.7462059723 [70.1747235226, 72.3716101346] | 0.0573060732476 [0.050383138573, 0.062884943181] | 0 [0, 0] |
| 18 | 2018 | 240111 [238125, 242039] | 72.6849184417 [70.8175666723, 73.1531831645] | 0.0563750850087 [0.0501280973105, 0.0608228784064] | 0 [0, 0] |
| 19 | 2019 | 261751 [259674, 264481] | 73.6696893807 [72.0316989205, 74.3239597793] | 0.0539889333438 [0.0504015313443, 0.0560521993084] | 0 [0, 0] |
| 20 | 2020 | 284274 [281689, 287234] | 76.1679586732 [73.2030611977, 76.4404919454] | 0.0523788745571 [0.0496295109793, 0.0557169253613] | 0 [0, 0] |
| 21 | 2021 | 307076 [303929, 310168] | 76.9415584023 [75.1840649435, 77.7540836674] | 0.0523680172558 [0.0506567511298, 0.0572027484116] | 0 [0, 0] |
| 22 | 2022 | 331951 [327213, 333566] | 77.3505446464 [76.0479120587, 77.4890035906] | 0.0552336852261 [0.0527593531738, 0.0584134414695] | 0 [0, 0] |
| 23 | 2023 | 355340 [350807, 357155] | 77.6433592556 [76.2887567216, 77.9336070815] | 0.0600525360776 [0.0567692796297, 0.0611642692479] | 0 [0, 0] |
| 24 | 2024 | 380475 [375374, 381880] | 77.7414366218 [76.4603769478, 78.1691956093] | 0.0613773650253 [0.0594275024251, 0.0656655722565] | 0 [0, 0] |
| 25 | 2025 | 405400 [400281, 406789] | 77.182950673 [76.2640054381, 78.0048748875] | 0.0629580310288 [0.0617308977597, 0.0668897743491] | 0 [0, 0] |
| 26 | 2026 | 431885 [426244, 432624] | 77.5347736949 [77.2549435325, 78.2446253242] | 0.0665075245825 [0.0612959316657, 0.0670506912252] | 0 [0, 0] |
| 27 | 2027 | 459324 [454626, 460015] | 77.5910608598 [76.5165356378, 78.2067006264] | 0.0657421438106 [0.0615860872533, 0.06960806194] | 0 [0, 0] |
| 28 | 2028 | 488133 [484568, 489945] | 78.1333126686 [77.7653943036, 80.1594304101] | 0.0630358514868 [0.0611067885077, 0.0716394825492] | 0 [0, 0] |
| 29 | 2029 | 518809 [515169, 520829] | 79.5910751866 [79.1036508928, 81.6009226435] | 0.0679750941102 [0.0636400710001, 0.0750147502442] | 0 [0, 0] |
| 30 | 2030 | 549130 [545987, 551396] | 81.4404011945 [80.1015030183, 81.6331017631] | 0.0697412838765 [0.0677812627025, 0.0769039723364] | 0 [0, 0] |
| 31 | 2031 | 579744 [577395, 582733] | 81.8911466084 [80.9234804993, 82.2232143329] | 0.0744927478238 [0.0701001861004, 0.0834208008024] | 0 [0, 0] |
| 32 | 2032 | 610615 [608730, 614845] | 81.981636368 [81.5399457676, 82.3868309707] | 0.0800183036137 [0.0724190332987, 0.0858982828134] | 0 [0, 0] |
| 33 | 2033 | 643353 [641046, 647575] | 82.2376192429 [81.4447745966, 83.1720861408] | 0.0837325368929 [0.0757977680989, 0.0908314923925] | 0 [0, 0] |
| 34 | 2034 | 675552 [671270, 679334] | 82.1385293596 [81.6148849526, 82.9694498342] | 0.0867467297895 [0.0827262118302, 0.101733974655] | 0 [0, 0] |
| 35 | 2035 | 708864 [705812, 713490] | 82.722366309 [81.2325811, 82.8921472633] | 0.0974763542354 [0.0854047246629, 0.100116876454] | 0 [0, 0] |
| 36 | 2036 | 741622 [738362, 747427] | 82.4672159037 [81.8511807927, 83.8068783412] | 0.100810481872 [0.0919302300019, 0.107488300411] | 0 [0, 0] |
| 37 | 2037 | 776288 [773730, 781066] | 82.3181606984 [82.0410693877, 83.1437641225] | 0.103445688051 [0.0981501369686, 0.113785284161] | 0 [0, 0] |
| 38 | 2038 | 811907 [807517, 816651] | 82.1592113194 [81.4223369041, 82.9540376397] | 0.108876402027 [0.102178297807, 0.119279615383] | 0 [0, 0] |
| 39 | 2039 | 844940 [841049, 852303] | 82.8090936591 [81.7314164498, 83.1101948772] | 0.117281865418 [0.107450141015, 0.126056959369] | 0 [0, 0] |
| 40 | 2040 | 880019 [878323, 889673] | 82.8624900983 [81.9454839227, 83.0747485967] | 0.12195091575 [0.113307293426, 0.129887023697] | 0 [0, 0] |
| 41 | 2041 | 914584 [913767, 924866] | 82.1884032783 [81.1310210895, 82.7341033392] | 0.124133908368 [0.12381012157, 0.142696690675] | 0 [0, 0] |
| 42 | 2042 | 952007 [947049, 958822] | 82.0540874713 [81.583606989, 82.3437330942] | 0.130450086912 [0.126086734444, 0.144575050726] | 0 [0, 0] |
| 43 | 2043 | 989261 [981631, 994389] | 81.6238087259 [81.0054729891, 82.0453687947] | 0.135476425365 [0.129741976511, 0.146611437364] | 0 [0, 0] |
| 44 | 2044 | 1030678 [1017766, 1031463] | 81.3885927267 [80.8561381665, 81.6738854807] | 0.142594588148 [0.127841465029, 0.153304499935] | 0 [0, 0] |
| 45 | 2045 | 1068216 [1055287, 1072401] | 80.9465309421 [80.5826588627, 81.3672525062] | 0.143253165617 [0.134717231435, 0.158265272862] | 0 [0, 0] |
| 46 | 2046 | 1109143 [1094324, 1109943] | 81.02390851 [80.3864119872, 81.3922144238] | 0.15197178937 [0.135719597588, 0.15990635414] | 0 [0, 0] |
| 47 | 2047 | 1144048 [1132339, 1151307] | 80.5774730815 [79.5412460772, 81.8762702293] | 0.157108470572 [0.138409774208, 0.169138761911] | 0 [0, 0] |
| 48 | 2048 | 1186527 [1169316, 1187525] | 80.4817288086 [79.7791260831, 81.4782541627] | 0.157149319071 [0.142596638453, 0.171808653885] | 0 [0, 0] |
| 49 | 2049 | 1225495 [1209924, 1233587] | 80.2711868681 [79.8305016712, 81.248412134] | 0.154546439733 [0.145552599512, 0.173847097014] | 0 [0, 0] |
| 50 | 2050 | 1262250 [1254073, 1272103] | 80.438332376 [79.8307428068, 80.9499364094] | 0.166178183192 [0.140626416381, 0.174208293745] | 0 [0, 0] |
| 51 | 2051 | 1307156 [1295571, 1313026] | 80.3679574004 [79.6633762229, 80.6414577051] | 0.165858823431 [0.146472679267, 0.175126842925] | 0.00129182146827 [0, 0.0100193668234] |
| 52 | 2052 | 1352531 [1335822, 1354608] | 80.4232597104 [79.5939078267, 80.7251923185] | 0.166770411334 [0.143862404618, 0.180875223886] | 0.00520282099724 [0, 0.0108910310306] |
| 53 | 2053 | 1387290 [1372356, 1392815] | 80.6480393726 [79.3138476557, 81.1771549768] | 0.163510597338 [0.142825009073, 0.176661749973] | 0.0161053470136 [0, 0.0244613470833] |
| 54 | 2054 | 1401401 [1388950, 1440737] | 80.2338463766 [79.7013495829, 80.4236104261] | 0.16437900878 [0.143359957365, 0.175300481566] | 0.0287983457869 [0, 0.0316264226817] |
| 55 | 2055 | 1426671 [1386414, 1464302] | 80.4130059591 [79.9308201976, 80.9548984002] | 0.169314615785 [0.144885651148, 0.184043543051] | 0.0285893289846 [0, 0.0406296878671] |
| 56 | 2056 | 1444001 [1400344, 1476049] | 80.3413496665 [80.2474455786, 80.4208527847] | 0.167833523342 [0.144751544239, 0.17942816008] | 0.0432669063547 [0, 0.0494030864797] |
| 57 | 2057 | 1456317 [1403945, 1487877] | 80.1255566076 [79.0766552494, 81.1171802385] | 0.173270672509 [0.145909746932, 0.186550533685] | 0.0547291076944 [0, 0.0605594441453] |
| 58 | 2058 | 1462768 [1414561, 1491046] | 80.053724096 [79.5188434281, 80.7983833485] | 0.170178057516 [0.142471353527, 0.182265726266] | 0.058744564988 [0, 0.0762453855407] |
| 59 | 2059 | 1482680 [1416617, 1504106] | 80.0132186901 [79.6906575395, 80.7540176635] | 0.162669681915 [0.147304497255, 0.182973823183] | 0.0722637672603 [0, 0.0910363244426] |
| 60 | 2060 | 1483518 [1427340, 1503201] | 80.4411987232 [79.1371672705, 81.3566945637] | 0.171516885347 [0.147485057472, 0.182561594583] | 0.0819100032892 [0, 0.103251506482] |

#### T041 128x15_s7 — five members

| Year index | Calendar year | Population median [min, max] | Approval median [min, max] | Air at homes median [min, max] | I-HT fraction median [min, max] |
|---:|---:|---:|---:|---:|---:|
| 1 | 2001 | 3599 [3599, 3599] | 51.5509189563 [51.5509189563, 51.5509189563] | 0.0235506397975 [0.0235506397975, 0.0235506397975] | 0 [0, 0] |
| 2 | 2002 | 10022 [10022, 10022] | 49.1172581473 [49.1172581473, 49.1172581473] | 0.0295538459448 [0.0295538459448, 0.0295538459448] | 0 [0, 0] |
| 3 | 2003 | 18210 [18210, 18210] | 51.2616058412 [51.2616058412, 51.2616058412] | 0.043981805158 [0.043981805158, 0.043981805158] | 0 [0, 0] |
| 4 | 2004 | 27641 [27641, 27641] | 50.8980726491 [50.8980726491, 50.8980726491] | 0.0462829751625 [0.0462829751625, 0.0462829751625] | 0 [0, 0] |
| 5 | 2005 | 36771 [36771, 36814] | 49.0331151609 [49.0331151609, 49.2677691026] | 0.0429726434688 [0.0429726434688, 0.0442813730652] | 0 [0, 0] |
| 6 | 2006 | 47029 [46943, 47029] | 51.9693347019 [50.4608378541, 51.9693347019] | 0.0431271324936 [0.0426214744691, 0.0431271324936] | 0 [0, 0] |
| 7 | 2007 | 58357 [58179, 58400] | 57.4539371568 [54.9847136186, 57.4553629745] | 0.0415494922038 [0.0415002480935, 0.0415774830204] | 0 [0, 0] |
| 8 | 2008 | 70599 [70032, 70720] | 61.8831444101 [59.9308866325, 62.2477799713] | 0.04208643221 [0.0419909573735, 0.0422237896072] | 0 [0, 0] |
| 9 | 2009 | 84478 [83766, 84769] | 65.8395710754 [64.8321912208, 66.4514529172] | 0.0695410798762 [0.0689319939561, 0.0710331841272] | 0 [0, 0] |
| 10 | 2010 | 100310 [98677, 100378] | 70.4226482668 [63.9517755419, 70.7004064579] | 0.068757647444 [0.0683189081973, 0.0722279209429] | 0 [0, 0] |
| 11 | 2011 | 117271 [116167, 117608] | 73.5534592166 [71.9965901544, 73.613686501] | 0.0717390904408 [0.0691787943988, 0.0727968965905] | 0 [0, 0] |
| 12 | 2012 | 135534 [134304, 136027] | 74.9283950879 [74.5266812075, 76.2205571197] | 0.0682217889314 [0.0657137964074, 0.0710972950949] | 0 [0, 0] |
| 13 | 2013 | 154311 [152614, 154335] | 76.2801400626 [76.1082520572, 77.5819084083] | 0.0732074493077 [0.0684657462714, 0.075211294198] | 0 [0, 0] |
| 14 | 2014 | 173340 [172525, 173970] | 77.8302282901 [76.5342686148, 78.7249887948] | 0.0773724046077 [0.0737751181922, 0.0806023863302] | 0 [0, 0] |
| 15 | 2015 | 193098 [191999, 193831] | 80.1444906618 [79.0573550218, 81.6001870607] | 0.0858628720047 [0.0798279768872, 0.0876237437694] | 0 [0, 0] |

#### T041 256x60_s7 — five members

| Year index | Calendar year | Population median [min, max] | Approval median [min, max] | Air at homes median [min, max] | I-HT fraction median [min, max] |
|---:|---:|---:|---:|---:|---:|
| 1 | 2001 | 3656 [3656, 3663] | 51.4322212899 [51.4322212899, 51.4595436081] | 0.0156056055256 [0.0156056055256, 0.0158155623254] | 0 [0, 0] |
| 2 | 2002 | 10247 [10034, 10247] | 52.8200144747 [46.8324147514, 52.8200144747] | 0.0301207741822 [0.0301207741822, 0.0330350810882] | 0 [0, 0] |
| 3 | 2003 | 18113 [18106, 18113] | 46.9761142845 [46.9761142845, 48.7513831012] | 0.0468406300412 [0.0460101522776, 0.0468406300412] | 0 [0, 0] |
| 4 | 2004 | 26862 [26862, 27594] | 46.542558204 [46.542558204, 49.2691821085] | 0.0491536318482 [0.044815720777, 0.0491536318482] | 0 [0, 0] |
| 5 | 2005 | 35575 [35550, 36062] | 43.3659899748 [43.3659899748, 46.8000017112] | 0.048518945227 [0.0470570445328, 0.0486735398054] | 0 [0, 0] |
| 6 | 2006 | 44292 [44292, 45756] | 48.0214551096 [48.0214551096, 52.8342777247] | 0.0465592575493 [0.0465592575493, 0.046765421201] | 0 [0, 0] |
| 7 | 2007 | 53027 [52889, 57149] | 54.7249124222 [54.7215464359, 57.894073733] | 0.0442495703083 [0.0441266530813, 0.0472856290737] | 0 [0, 0] |
| 8 | 2008 | 64328 [64199, 69097] | 58.5110980202 [58.2613807657, 60.1035345631] | 0.0464368394857 [0.044224254125, 0.0492449758852] | 0 [0, 0] |
| 9 | 2009 | 77185 [76788, 81822] | 64.9100954693 [62.1878212006, 65.637678563] | 0.0613875024146 [0.0529746438638, 0.0718236587493] | 0 [0, 0] |
| 10 | 2010 | 89892 [89405, 94414] | 64.0388905704 [61.7943499607, 64.0762406285] | 0.064445511475 [0.0616062252374, 0.0656025189545] | 0 [0, 0] |
| 11 | 2011 | 103331 [102981, 107993] | 61.9627452709 [60.9482515291, 62.4899033498] | 0.0583874831128 [0.0564794233803, 0.066537279014] | 0 [0, 0.0108720374835] |
| 12 | 2012 | 116857 [116579, 122657] | 61.3778269026 [59.0057267332, 61.4551890162] | 0.0515671469622 [0.0514695023355, 0.0557850722268] | 0 [0, 0.00675098273799] |
| 13 | 2013 | 132822 [132766, 137274] | 62.1423588567 [61.1713047084, 64.6346628291] | 0.0481720984135 [0.0468473865551, 0.0508099614778] | 0 [0, 0.00649272089366] |
| 14 | 2014 | 149603 [149412, 154702] | 67.6530056251 [62.751087189, 67.7495665551] | 0.0460229342768 [0.0454042977464, 0.051426459096] | 0 [0, 0.00614274196645] |
| 15 | 2015 | 167640 [166266, 172355] | 69.0193024525 [65.0591795653, 69.6994762251] | 0.0457097333079 [0.0445315920834, 0.0509776594941] | 0 [0, 0.00590327430059] |
| 16 | 2016 | 186097 [184628, 191605] | 69.9256631082 [69.2761033182, 70.6175098295] | 0.0440926311214 [0.042681504478, 0.050266889096] | 0 [0, 0.00581605375334] |
| 17 | 2017 | 205169 [202459, 210157] | 70.1904912862 [69.1088675685, 70.9386097065] | 0.0450787615786 [0.0439046194048, 0.0529497008384] | 0 [0, 0.00579741456915] |
| 18 | 2018 | 223887 [220564, 229127] | 70.7295969072 [68.7869275691, 70.9349100035] | 0.0509879587712 [0.0477103205667, 0.0523903365883] | 0 [0, 0.00590331922477] |
| 19 | 2019 | 244050 [241773, 248763] | 71.5799837571 [70.2879336388, 71.6143996345] | 0.0499309421966 [0.0463013462016, 0.0522880841328] | 0 [0, 0.00588387669763] |
| 20 | 2020 | 265947 [262570, 270377] | 71.7324007729 [71.037663334, 72.973469364] | 0.0484231078413 [0.0470430962692, 0.0510388294821] | 0 [0, 0.00587431189271] |
| 21 | 2021 | 288598 [285681, 292752] | 74.5770600725 [73.4165952792, 74.851724977] | 0.0490112951244 [0.0469578738121, 0.0520437759487] | 0 [0, 0.00589653254218] |
| 22 | 2022 | 311540 [308498, 316057] | 75.5144123217 [75.1294876718, 75.6631722386] | 0.047668887457 [0.0465474990494, 0.0530261865816] | 0 [0, 0.0058893251352] |
| 23 | 2023 | 334344 [330767, 339168] | 76.0073637279 [74.4321477093, 76.9394527351] | 0.0524906216339 [0.0484058962688, 0.0531331200826] | 0 [0, 0.00585163512463] |
| 24 | 2024 | 359650 [354033, 362448] | 75.5921074148 [75.2832810287, 76.9202802292] | 0.0549177510809 [0.0503141859019, 0.0588819980935] | 0 [0, 0.00585185185185] |
| 25 | 2025 | 384590 [378769, 386798] | 76.1070424892 [75.6626087621, 77.2818256227] | 0.0554803228581 [0.0514055070959, 0.0606176132062] | 0 [0, 0.00581309241706] |
| 26 | 2026 | 411685 [405809, 413189] | 77.3430076306 [75.520215678, 77.9844627392] | 0.0574083816939 [0.0515359395095, 0.0597112445718] | 0 [0, 0.00564547825776] |
| 27 | 2027 | 439616 [434077, 441310] | 77.6477691587 [77.0965275447, 78.0003988607] | 0.0596273448366 [0.0524283731093, 0.0617919253329] | 0 [0, 0.00522648083624] |
| 28 | 2028 | 468498 [462493, 469127] | 78.1470715861 [76.8908362091, 78.3156153745] | 0.0611222137634 [0.0551931552149, 0.0638314779122] | 0 [0, 0.0050371409443] |
| 29 | 2029 | 497990 [491775, 498768] | 78.6184138716 [78.1908884842, 78.9543552864] | 0.0627370185061 [0.0586458335677, 0.066094513882] | 0 [0, 0.00457123018169] |
| 30 | 2030 | 529330 [521916, 529353] | 80.5901779294 [78.0786902254, 80.965238839] | 0.0681523573131 [0.0649148776903, 0.0689160825364] | 0 [0, 0.00452152014652] |
| 31 | 2031 | 561093 [553788, 561099] | 82.1141056813 [80.624612143, 82.1551820015] | 0.0680256081602 [0.0654987306859, 0.0740149917196] | 0 [0, 0.00408109875736] |
| 32 | 2032 | 592757 [585950, 593477] | 82.3195824234 [82.0531999508, 82.3955786103] | 0.0766772971702 [0.0700277797612, 0.0781600815307] | 0 [0, 0] |
| 33 | 2033 | 624609 [617771, 625760] | 82.4852056695 [81.9823022486, 83.3712431504] | 0.0790717792962 [0.0714082510346, 0.0812255363915] | 0 [0, 0] |
| 34 | 2034 | 656920 [648457, 659221] | 82.6396534736 [82.4553834356, 83.6448071945] | 0.0837152255874 [0.0765298430148, 0.0909491692675] | 0 [0, 0] |
| 35 | 2035 | 688697 [681141, 692463] | 82.1708704815 [81.7671100717, 83.397660689] | 0.0892655004721 [0.0852548358568, 0.0948568308774] | 0 [0, 0] |
| 36 | 2036 | 722927 [714214, 724856] | 82.9413907559 [82.1065818991, 83.7847781912] | 0.0921639024105 [0.0886392526474, 0.100581532355] | 0 [0, 0] |
| 37 | 2037 | 756906 [748886, 758874] | 82.8868206227 [82.8455453805, 82.9986480811] | 0.099816999711 [0.0955451053074, 0.108203153024] | 0 [0, 0] |
| 38 | 2038 | 790558 [783255, 792731] | 82.3438398597 [82.0923669208, 82.5895025153] | 0.108462059062 [0.104949743315, 0.11107766477] | 0 [0, 0] |
| 39 | 2039 | 823848 [817635, 827825] | 81.8819628008 [81.4817419916, 82.1071228203] | 0.11508315414 [0.11043511539, 0.115322823876] | 0 [0, 0] |
| 40 | 2040 | 859443 [851797, 864028] | 82.5199420732 [82.4945583921, 82.7115861614] | 0.114385926738 [0.111257787505, 0.123008925822] | 0 [0, 0] |
| 41 | 2041 | 894479 [884622, 898626] | 82.4293729136 [82.1831874245, 82.8279587405] | 0.121920542683 [0.115480595577, 0.129980784638] | 0 [0, 0] |
| 42 | 2042 | 927255 [920263, 935959] | 82.0205882133 [81.6047298481, 82.6312700033] | 0.129456865684 [0.119304746348, 0.137292216225] | 0 [0, 0] |
| 43 | 2043 | 964182 [956598, 970181] | 81.731229475 [81.615133843, 81.8826153316] | 0.135687985595 [0.131117256754, 0.137570759161] | 0 [0, 0] |
| 44 | 2044 | 1001797 [995068, 1002990] | 81.5189627416 [81.0913418892, 82.2686047957] | 0.136064733927 [0.133407433596, 0.14216006797] | 0 [0, 0] |
| 45 | 2045 | 1037419 [1033145, 1041497] | 81.5053907828 [81.3979728526, 81.877876114] | 0.143573820607 [0.143157570273, 0.150185724238] | 0 [0, 0] |
| 46 | 2046 | 1076520 [1071882, 1077359] | 80.8287737528 [80.6726236222, 81.3333836222] | 0.146224712444 [0.145243430084, 0.154011985464] | 0 [0, 0] |
| 47 | 2047 | 1115397 [1108597, 1115550] | 80.4059430127 [80.405573491, 81.588600727] | 0.148955494223 [0.148348655824, 0.156992600353] | 0 [0, 0] |
| 48 | 2048 | 1152504 [1149500, 1155633] | 80.6246764613 [80.3871545233, 82.0661413903] | 0.15301601859 [0.141925040134, 0.157721806561] | 0 [0, 0] |
| 49 | 2049 | 1195156 [1182196, 1198595] | 81.1545622322 [80.1434760721, 81.1689231425] | 0.146208210427 [0.144162344259, 0.166117981542] | 0 [0, 0] |
| 50 | 2050 | 1231431 [1221138, 1236441] | 80.8084563819 [80.3905993566, 81.0595084865] | 0.152046778186 [0.149414458612, 0.163446984857] | 0 [0, 0.0104061895551] |
| 51 | 2051 | 1267957 [1256088, 1274301] | 80.8365790432 [80.0801054952, 80.9803084463] | 0.161327047281 [0.157040329626, 0.168832046659] | 0 [0, 0.0202254797792] |
| 52 | 2052 | 1300168 [1295407, 1310187] | 80.2780152067 [80.1174047546, 80.7751549352] | 0.162016204395 [0.157100090683, 0.172798310488] | 0 [0, 0.0230265882548] |
| 53 | 2053 | 1339536 [1326567, 1339615] | 79.8268538268 [79.561191576, 79.9949998015] | 0.164962498408 [0.152169163884, 0.171395389477] | 0 [0, 0.025076765609] |
| 54 | 2054 | 1372454 [1338999, 1373403] | 79.5991342114 [79.392842052, 79.8784330062] | 0.171312237839 [0.150614792727, 0.171648243525] | 0 [0, 0.0385445898572] |
| 55 | 2055 | 1394146 [1342625, 1408819] | 79.5601145966 [79.3494281789, 81.2102361554] | 0.166246589856 [0.154689673401, 0.176078292961] | 0 [0, 0.0502346380114] |
| 56 | 2056 | 1416272 [1344171, 1441663] | 79.5308245085 [79.3571716323, 80.0601903695] | 0.170984217332 [0.157927765098, 0.17683008927] | 0 [0, 0.0627822117067] |
| 57 | 2057 | 1437575 [1355184, 1473387] | 79.9503159522 [79.6123834038, 80.5396929647] | 0.170962835358 [0.157903240575, 0.175659596914] | 0 [0, 0.0808186593276] |
| 58 | 2058 | 1454940 [1363167, 1487041] | 79.8112595147 [79.7516488543, 81.2660516274] | 0.170685282602 [0.157035109122, 0.17831548378] | 0 [0, 0.081351521842] |
| 59 | 2059 | 1461510 [1364186, 1498509] | 80.1856396107 [78.9833133489, 80.4407663312] | 0.178941935019 [0.157679647205, 0.1799110599] | 0 [0, 0.0964508013203] |
| 60 | 2060 | 1477908 [1378044, 1511394] | 80.2047309022 [79.2760368644, 80.7510081268] | 0.180354716095 [0.15455811756, 0.182215495351] | 0 [0, 0.107601467122] |

#### T041 256x60_s11 — five members

| Year index | Calendar year | Population median [min, max] | Approval median [min, max] | Air at homes median [min, max] | I-HT fraction median [min, max] |
|---:|---:|---:|---:|---:|---:|
| 1 | 2001 | 3661 [3661, 3661] | 51.2601366225 [51.2601366225, 51.2601366225] | 0.0137441692749 [0.0137441692749, 0.0137441692749] | 0 [0, 0] |
| 2 | 2002 | 10167 [10167, 10167] | 51.4609204871 [51.4609204871, 51.4609204871] | 0.0267196565116 [0.0267196565116, 0.0267196565116] | 0 [0, 0] |
| 3 | 2003 | 17993 [17993, 17993] | 50.3348612399 [50.3348612399, 50.3348612399] | 0.0430012369466 [0.0430012369466, 0.0430012369466] | 0 [0, 0] |
| 4 | 2004 | 26762 [26762, 26762] | 49.6134607946 [49.6134607946, 49.6134607946] | 0.0463797061939 [0.0463797061939, 0.0463797061939] | 0 [0, 0] |
| 5 | 2005 | 34423 [34423, 34423] | 48.4880823033 [48.4880823033, 48.4880823033] | 0.0475154704282 [0.0475154704282, 0.0475154704282] | 0 [0, 0] |
| 6 | 2006 | 43431 [43328, 43431] | 53.6732720555 [53.6732720555, 53.9675729971] | 0.0440840352445 [0.0440840352445, 0.0442530951447] | 0 [0, 0] |
| 7 | 2007 | 54047 [54046, 54132] | 58.4859216105 [58.1752962356, 58.5997848242] | 0.0433898592342 [0.0424553619744, 0.0434127493076] | 0 [0, 0] |
| 8 | 2008 | 65847 [65687, 65859] | 60.8245723534 [57.1957748732, 61.0189766193] | 0.043028331212 [0.0427306382635, 0.0444374263848] | 0 [0, 0] |
| 9 | 2009 | 78785 [78240, 79070] | 64.8926837283 [58.733738186, 67.1425314161] | 0.0619401985945 [0.051416913702, 0.0686944089932] | 0 [0, 0] |
| 10 | 2010 | 91557 [90936, 92275] | 64.7081707404 [60.162623984, 65.725177877] | 0.0614204937029 [0.0592993100253, 0.0679439766783] | 0 [0, 0] |
| 11 | 2011 | 104818 [104539, 106085] | 63.1066358728 [62.4387975316, 64.6597657706] | 0.0575759579868 [0.0569242407582, 0.0588629500875] | 0 [0, 0] |
| 12 | 2012 | 118744 [118307, 120427] | 62.7662686052 [61.1432164057, 65.2804401605] | 0.0532665365304 [0.0512268661201, 0.054831523938] | 0 [0, 0] |
| 13 | 2013 | 135047 [133388, 137075] | 64.7849535399 [62.0990669407, 69.3150965307] | 0.0489488587548 [0.0488747295933, 0.0494100913925] | 0 [0, 0] |
| 14 | 2014 | 151257 [150939, 153867] | 68.8455717391 [65.7997988841, 70.5650320971] | 0.0471871621918 [0.046671363108, 0.0477781549712] | 0 [0, 0] |
| 15 | 2015 | 168939 [167808, 171568] | 70.3125023656 [70.1145560865, 71.0358161411] | 0.0459344965078 [0.0433950389938, 0.0462340749828] | 0 [0, 0] |
| 16 | 2016 | 186073 [185570, 189372] | 70.6595823844 [70.5316182619, 70.9904826748] | 0.0448851128161 [0.0424534366456, 0.0451911780668] | 0 [0, 0] |
| 17 | 2017 | 203761 [203438, 207129] | 71.3251021367 [70.3191340204, 71.3812514408] | 0.0458976916709 [0.042148503524, 0.0474141633612] | 0 [0, 0] |
| 18 | 2018 | 221823 [221724, 225625] | 71.3039580623 [70.3441663966, 71.5362755468] | 0.050184405189 [0.0494477418146, 0.0506275617725] | 0 [0, 0] |
| 19 | 2019 | 241711 [241471, 246189] | 72.3913838553 [70.4390821967, 72.4377910149] | 0.0494425491359 [0.0486185322777, 0.0503924714785] | 0 [0, 0] |
| 20 | 2020 | 264021 [262509, 268434] | 73.2111821815 [72.1336410539, 75.0892524751] | 0.049789517707 [0.0481402639317, 0.0501231750977] | 0 [0, 0] |
| 21 | 2021 | 286313 [285337, 290825] | 74.4647136035 [74.3271902731, 74.7135927508] | 0.0493106026075 [0.0483872133905, 0.0521013985653] | 0 [0, 0] |
| 22 | 2022 | 308840 [308667, 313327] | 74.8627394261 [74.4950288887, 76.1786726774] | 0.050077594102 [0.0493755377055, 0.0533313171278] | 0 [0, 0] |
| 23 | 2023 | 331939 [331708, 337160] | 76.6857035306 [74.2228529216, 77.325263318] | 0.0539014259958 [0.0528426663659, 0.054745005496] | 0 [0, 0] |
| 24 | 2024 | 355902 [355700, 361388] | 76.6238765511 [75.3587528307, 77.098508326] | 0.0568240803371 [0.0539149867379, 0.0569722266101] | 0 [0, 0] |
| 25 | 2025 | 380454 [379873, 385542] | 76.2473307851 [75.0896116203, 77.3651383116] | 0.0584385349993 [0.0568925457849, 0.0605950028992] | 0 [0, 0] |
| 26 | 2026 | 405961 [405292, 412075] | 76.397200941 [75.1754363522, 76.7125102159] | 0.0575989046747 [0.0571254828006, 0.0595046130356] | 0 [0, 0] |
| 27 | 2027 | 433539 [431578, 440141] | 77.1797007336 [75.1140898235, 77.4207999023] | 0.0586812516215 [0.0585589677539, 0.0598485721841] | 0 [0, 0] |
| 28 | 2028 | 460980 [459656, 469071] | 77.8842565746 [77.1452841177, 78.1244926789] | 0.0632230836529 [0.0616352454415, 0.0638384607831] | 0 [0, 0] |
| 29 | 2029 | 490355 [489172, 499419] | 78.1069810145 [78.0725807037, 78.6338068086] | 0.0639288745123 [0.0634802277466, 0.0645218719827] | 0 [0, 0] |
| 30 | 2030 | 520386 [520014, 530527] | 78.9147676823 [78.7006287102, 79.9880891627] | 0.0685828817485 [0.0672683129751, 0.0696808123693] | 0 [0, 0] |
| 31 | 2031 | 551293 [551086, 560998] | 80.4608136933 [79.8749377231, 81.8092193914] | 0.0707722851724 [0.0696612503569, 0.072232965522] | 0 [0, 0] |
| 32 | 2032 | 582872 [582105, 592372] | 80.8912090595 [80.1047009889, 82.0245657557] | 0.078336111361 [0.0757138484809, 0.0816156357147] | 0 [0, 0] |
| 33 | 2033 | 614803 [614799, 624553] | 82.0482172062 [80.4456660835, 82.4569058987] | 0.0807160890747 [0.0788074315477, 0.0834461132494] | 0 [0, 0] |
| 34 | 2034 | 647676 [646748, 656833] | 81.6597494868 [79.6371479789, 82.925097904] | 0.0860446517681 [0.0817886366475, 0.0864457728064] | 0 [0, 0] |
| 35 | 2035 | 680440 [679260, 689842] | 82.1196046137 [81.3536542264, 83.0866757922] | 0.0916550485911 [0.0892464211282, 0.0939512475134] | 0 [0, 0] |
| 36 | 2036 | 713526 [711158, 722554] | 82.326995055 [81.1714450593, 83.3884584402] | 0.0971178917064 [0.0952644981914, 0.102049424151] | 0 [0, 0] |
| 37 | 2037 | 746890 [744645, 755392] | 82.2010584763 [80.4491745759, 83.174122234] | 0.102576044705 [0.100262643219, 0.104616624696] | 0 [0, 0] |
| 38 | 2038 | 782783 [778213, 789590] | 81.7717958738 [80.1751832982, 82.9579557473] | 0.110551338062 [0.100419178266, 0.113827214311] | 0 [0, 0] |
| 39 | 2039 | 816910 [813809, 823820] | 81.7017446554 [80.2282364247, 82.7458001231] | 0.112063249493 [0.108978715097, 0.114294406222] | 0 [0, 0] |
| 40 | 2040 | 851718 [848619, 858199] | 82.3775150424 [80.5485287185, 83.0565762807] | 0.118842927116 [0.111167374452, 0.119224477991] | 0 [0, 0] |
| 41 | 2041 | 886954 [880850, 892626] | 82.1978783865 [80.2646399566, 82.7551976354] | 0.126366602375 [0.115969359718, 0.127786665203] | 0 [0, 0] |
| 42 | 2042 | 921687 [917192, 926241] | 81.591331649 [79.5555319912, 83.4574854965] | 0.125467793213 [0.121413426626, 0.134412029861] | 0 [0, 0] |
| 43 | 2043 | 957752 [952365, 965514] | 82.0876544482 [80.2694694067, 83.2138538047] | 0.129658157992 [0.128450113, 0.132027498523] | 0 [0, 0] |
| 44 | 2044 | 995582 [993420, 1001262] | 82.2435773457 [79.7355525347, 83.017841181] | 0.13400244587 [0.127027234022, 0.135963117444] | 0 [0, 0] |
| 45 | 2045 | 1032581 [1029866, 1042770] | 82.0270779201 [79.9295168247, 82.7397604223] | 0.139390282065 [0.136648408591, 0.141977811046] | 0 [0, 0] |
| 46 | 2046 | 1071494 [1070745, 1079951] | 82.043767555 [80.0403680235, 82.0856260052] | 0.141087919932 [0.134259049097, 0.148383979385] | 0 [0, 0] |
| 47 | 2047 | 1108588 [1106941, 1120230] | 81.1364225576 [79.1113958413, 81.7448289424] | 0.144025420523 [0.138666006633, 0.15082870358] | 0 [0, 0] |
| 48 | 2048 | 1144642 [1142536, 1155239] | 81.7615394265 [79.7597126089, 82.2898236534] | 0.152525179927 [0.142725881966, 0.160589204936] | 0 [0, 0] |
| 49 | 2049 | 1187911 [1177712, 1188854] | 81.2362325597 [78.9857252493, 82.5433450645] | 0.149657120447 [0.146139029675, 0.151412035199] | 0 [0, 0] |
| 50 | 2050 | 1226709 [1215369, 1227450] | 81.1820687695 [78.6718726575, 82.3557110271] | 0.158352635402 [0.149114096175, 0.15979307485] | 0 [0, 0] |
| 51 | 2051 | 1259890 [1252939, 1261980] | 80.8204470918 [78.2323831328, 82.0359112652] | 0.159867477313 [0.154484621235, 0.163638338602] | 0 [0, 0] |
| 52 | 2052 | 1295524 [1286932, 1296661] | 80.5210896033 [78.1525811255, 81.4831494629] | 0.163854927428 [0.154477753838, 0.164559820547] | 0 [0, 0] |
| 53 | 2053 | 1324550 [1323645, 1330122] | 79.9751298408 [78.3774226314, 81.3865882059] | 0.166531064859 [0.149750315932, 0.170360119737] | 0 [0, 0] |
| 54 | 2054 | 1358531 [1354438, 1367457] | 79.9939877215 [78.4171879153, 81.89012524] | 0.166179474286 [0.157315040937, 0.168463111991] | 0 [0, 0] |
| 55 | 2055 | 1390949 [1386607, 1398063] | 80.3373093613 [77.9910708975, 81.5864819983] | 0.170749607845 [0.153706001415, 0.171225234218] | 0 [0, 0.00961026254281] |
| 56 | 2056 | 1410391 [1406405, 1433225] | 79.758293159 [77.7793026052, 81.9018248235] | 0.16845086526 [0.158779797355, 0.175279348229] | 0 [0, 0.020459204592] |
| 57 | 2057 | 1429503 [1424835, 1439815] | 79.9811031534 [77.6360491367, 81.9349546454] | 0.174078267612 [0.158466236824, 0.177999436207] | 0 [0, 0.0380557202134] |
| 58 | 2058 | 1442854 [1425026, 1449639] | 79.9337004269 [78.2997378996, 80.2964259054] | 0.175330073724 [0.16866330339, 0.177363535909] | 0 [0, 0.0536888309597] |
| 59 | 2059 | 1457276 [1437790, 1465157] | 80.0957758428 [77.9749737442, 80.7902233054] | 0.174085541279 [0.171045105503, 0.18037700598] | 0 [0, 0.0599810695693] |
| 60 | 2060 | 1468252 [1449829, 1483998] | 80.2315774679 [77.8228413634, 81.3126102294] | 0.176889172829 [0.167134737453, 0.180964205428] | 0 [0, 0.0680416911333] |

### Annual-band widths and historical control-relative envelopes

The active gate uses each year’s dev min-max band, shown above. A maximum width over all later years must not be substituted for an individual year’s band. For continuity with NOTE-052, this table also retains max |probe − control| over all four probes from year 10. The latter is a diagnostic, rather than permission to forgive a target miss.

| Tree / row | Metric | Maximum annual band width, years ≥10 | Peak year | Width / median at peak | Max absolute probe − control, years ≥10 | Peak member / year |
|---|---|---:|---:|---:|---:|---|
| Dev 128x15_s7 | Population | 3185 | 2014 | 1.84850929478% | 2767 | p100-d1 / 2015 |
| Dev 128x15_s7 | Approval (points) | 2.52014587462 | 2010 | 3.55692140517% | 1.92919785979 | p100-d1441 / 2012 |
| Dev 128x15_s7 | Air at homes | 0.00560960939425 | 2015 | 6.04008201593% | 0.00560960939425 | p100-d1441 / 2015 |
| Dev 128x15_s7 | I-HT share (fraction) | 0 | 2010 | 0% | 0 | p100-d1 / 2010 |
| Dev 256x60_s7 | Population | 133913 | 2060 | 9.16529953384% | 133913 | p100-d1 / 2060 |
| Dev 256x60_s7 | Approval (points) | 6.01562293198 | 2012 | 9.75814842271% | 5.50529078302 | m100-d1 / 2013 |
| Dev 256x60_s7 | Air at homes | 0.0331824886772 | 2058 | 19.7454690154% | 0.0248380385345 | m100-d1 / 2056 |
| Dev 256x60_s7 | I-HT share (fraction) | 0.0511209163901 | 2054 | 95.4737114554% | 0.0511209163901 | p100-d1 / 2054 |
| Dev 256x60_s11 | Population | 87489 | 2059 | 5.90073380635% | 87489 | p100-d1441 / 2059 |
| Dev 256x60_s11 | Approval (points) | 5.42848638277 | 2014 | 7.77806978311% | 5.42848638277 | m100-d1 / 2014 |
| Dev 256x60_s11 | Air at homes | 0.0406407867526 | 2057 | 23.4550868673% | 0.0406407867526 | m100-d1 / 2057 |
| Dev 256x60_s11 | I-HT share (fraction) | 0.103251506482 | 2060 | 126.054819113% | 0.103251506482 | m100-d1441 / 2060 |
| T041 128x15_s7 | Population | 1832 | 2015 | 0.948741053765% | 1832 | p100-d1 / 2015 |
| T041 128x15_s7 | Approval (points) | 6.74863091597 | 2010 | 9.58304051617% | 6.74863091597 | p100-d1 / 2010 |
| T041 128x15_s7 | Air at homes | 0.00779576688221 | 2015 | 9.07932229635% | 0.00603489511748 | p100-d1 / 2015 |
| T041 128x15_s7 | I-HT share (fraction) | 0 | 2010 | 0% | 0 | p100-d1 / 2010 |
| T041 256x60_s7 | Population | 134323 | 2059 | 9.19070002942% | 134323 | p100-d1441 / 2059 |
| T041 256x60_s7 | Approval (points) | 4.99847936607 | 2014 | 7.38840694495% | 3.39558019499 | p100-d1441 / 2015 |
| T041 256x60_s7 | Air at homes | 0.0276573777907 | 2060 | 15.3349900627% | 0.0257965985348 | p100-d1441 / 2060 |
| T041 256x60_s7 | I-HT share (fraction) | 0.107601467122 | 2060 | undefined (zero reference) | 0.0583378558985 | p100-d1441 / 2057 |
| T041 256x60_s11 | Population | 34169 | 2060 | 2.32718906564% | 26820 | p100-d1 / 2056 |
| T041 256x60_s11 | Approval (points) | 7.21602958999 | 2013 | 11.13843446% | 7.21602958999 | p100-d1 / 2013 |
| T041 256x60_s11 | Air at homes | 0.020609803805 | 2053 | 12.3759514914% | 0.020609803805 | p100-d1 / 2053 |
| T041 256x60_s11 | I-HT share (fraction) | 0.0680416911333 | 2060 | undefined (zero reference) | 0.0680416911333 | m100-d1 / 2060 |

Round 2’s one-sided sweep remains supporting evidence: its response to §10/100/1,000/10,000 was non-monotonic, so a larger grant is not a justified way to enlarge a gate’s tolerance. The ensemble fixes the tested amount and timings and judges medians and annual bands.

### Systematic-shift and second-stage diagnostics

The systematic check below uses each row’s last checkpoint (128×15 ends at year 15; the other rows at year 60), as requested for this protocol. A metric triggers only if all three endpoint median deltas exceed one quarter of the corresponding dev band in the same signed direction. Equality does not trigger. This diagnostic is reported separately from T041’s signed ±3% exception.

| Metric | 128×15 s7 endpoint Δ / quarter dev band | 256×60 s7 endpoint Δ / quarter dev band | 256×60 s11 endpoint Δ / quarter dev band | Common systematic shift? |
|---|---:|---:|---:|---|
| Population | +1510 / 744 | +16821 / 33478.25 | -15266 / 18965.25 | no |
| Approval (points) | -1.22052684068 / 0.162550241409 | -0.15269379372 / 0.200402101428 | -0.209621255337 / 0.554881823306 | no |
| Air at homes | -0.00701019461024 / 0.00140240234856 | +0.0131643386561 / 0.00622650707426 | +0.00537228748237 / 0.00876913427793 | no |
| I-HT share (fraction) | 0 / 0 | -0.126146721117 / 0.00880630925789 | -0.0819100032892 / 0.0258128766205 | no |

For transparency, the generic NOTE-053 base comparison below uses zero item tolerance and all four metrics from year 10. It is **not** T041’s sign-off criterion. It flags proximity to the active acceptance interval’s lower or upper boundary when distance is at most half that year’s dev band. This literal rule can flag a passing or even identical median, especially with narrow/zero bands. A row marked here needs matched nine-member ensembles before a normal lane final gate; the five-member measurement is not silently presented as a nine-member verdict.

| Row | Generic base years failing any metric | Years near a base threshold | Second-stage row |
|---|---|---|---|
| 128x15_s7 | 2010–2015 | 2010–2015 | 128x15_s7: rerun both compared ensembles with --runs 9 |
| 256x60_s7 | 2010–2060 | 2010–2060 | 256x60_s7: rerun both compared ensembles with --runs 9 |
| 256x60_s11 | 2010–2060 | 2010–2060 | 256x60_s11: rerun both compared ensembles with --runs 9 |

The separately generated comparison files are independently cross-checked against the raw recomputation: **432 base metric verdicts** and **135 population sign-off verdicts** agree, including every outside-year list, endpoint reopening decision, stage-two row and systematic-shift result. Generic base status: **needs-nine-runs**; NOTE-050 population sign-off status: **pass**. Files: [base comparison](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-compare/base.compare.json>), [sign-off comparison](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-compare/signoff.compare.json>).


### Raw member provenance

The cached JSON links below contain full-precision observations, annual state hashes, successful-action journals, the complete bot say-log and the exact executed quiet-gated member command. Imported members link to their original record and retain its SHA-256. Reusing these files does not re-record a balance fixture.

| Tree / row | Member / nudge / day | Raw JSON / SHA-256 | Original imported evidence |
|---|---|---|---|
| Dev 128x15_s7 | control / 0 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/128x15_s7_base_74ab1200c7355b13.json>); `599e26806db327947e0296f3174a5d703eff1b9812daedc69d80ce7db5796ee1` | [3833c8d2379d3350663e624fe30be7867c559310](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_base.json>); `23ec81e9b2e15b1a58438a2f39cda5991ea5a1d3e4a1f11563ac3bdfd2253b57` |
| Dev 128x15_s7 | p100-d1 / 100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/128x15_s7_n100_d1_4102a04d19df1efe.json>); `386e0eeb59d2be7cd493820374f975cb0f89fbcba561818fb3c2cfe7c530afe6` | [3833c8d2379d3350663e624fe30be7867c559310](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/128x15_s7_n100_d1.json>); `182e21e9ae4c5c0dcd7661129a243935fadea66f0da4b10fd57ea03329b94ade` |
| Dev 128x15_s7 | m100-d1 / -100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/128x15_s7_n-100_d1_3fdf0a6e60437bd4.json>); `4151e9f4774b89de4fb065f9fe48f22119642a284c0737b023fcda86bb42c649` | [e990432a4e376606880020f1e51806ace1f6e5ee](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/128x15_s7_n-100_d1.json>); `619519cd8046a21a8160a7438a4e35f8e0f25fd03caa789d966cd40b6546aef0` |
| Dev 128x15_s7 | p100-d1441 / 100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/128x15_s7_n100_d1441_86b31e13c447ded6.json>); `bcfac6d82e0eabcddae34bdb93ad14a22eff33517ad9703c27da5cbae86ee9cd` | [e990432a4e376606880020f1e51806ace1f6e5ee](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/128x15_s7_n100_d1441.json>); `b6d0da07a5cbc291e649267996ce42d72cbe5152c7ad470d7bf02c29f0680087` |
| Dev 128x15_s7 | m100-d1441 / -100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/128x15_s7_n-100_d1441_23dbb8662ba19e27.json>); `578d9091a6aebf41ff1e9d39c8ac154067fca26228b64ad1350b32812f77f61f` | [e990432a4e376606880020f1e51806ace1f6e5ee](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/128x15_s7_n-100_d1441.json>); `454fc5295d6aeaf91aaf43165488d2a1a605726375c44faf427f861698815bb0` |
| Dev 256x60_s7 | control / 0 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s7_base_a02a89fe27fbd4ae.json>); `848c17e3321a0da276b9912582f408a85e22123ba50e2cad9fb73dd9ff50adeb` | [3833c8d2379d3350663e624fe30be7867c559310](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_base.json>); `0dd760930b3bfc7c1b584c714fc547798f6b56ba31f339674c42ab2bc48a17d0` |
| Dev 256x60_s7 | p100-d1 / 100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s7_n100_d1_6eea087ebdc95f44.json>); `fea19f1062b557f68a24c27557d8fc8b8883ec7d7ccc6aa2e3ceab3853434a2f` | [3833c8d2379d3350663e624fe30be7867c559310](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s7_n100_d1.json>); `ed57f24b01c3ab41c86ef3f892439cb05e63579d77658f66772e18df9ce0d14a` |
| Dev 256x60_s7 | m100-d1 / -100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s7_n-100_d1_3dd51894abf7c405.json>); `9368bcbff7b82a9bd1c33f7f3c58d9a898b90aff6c557b17bfd70b058f3fb10c` | [e990432a4e376606880020f1e51806ace1f6e5ee](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s7_n-100_d1.json>); `5b7184f5f9ae37af9e06279d9c185a3dcd81e62480f6467afdf86e5275fc1514` |
| Dev 256x60_s7 | p100-d1441 / 100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s7_n100_d1441_1134801bc1a0c318.json>); `df4b6dcfd323050a647de66cf2b64d481959936c3f267250674b12f43712bc51` | [e990432a4e376606880020f1e51806ace1f6e5ee](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s7_n100_d1441.json>); `0177b794959624ae30e4e710a2a690d4ff7dbe389358c3bdc7246efb0a6251b5` |
| Dev 256x60_s7 | m100-d1441 / -100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s7_n-100_d1441_db360dd474cf7451.json>); `1d355f40328a40e3ffa15e0343f4e5af377d20562a3ce6abed41340f8da750ca` | [e990432a4e376606880020f1e51806ace1f6e5ee](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s7_n-100_d1441.json>); `6d037a8d51595d9cf49c8edb083a27bc5117d7b71f19d5d648d7a76a769c8651` |
| Dev 256x60_s11 | control / 0 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s11_base_9142e261f9007dbb.json>); `7562f1e0fda1c72521481b8eaa4a3800fe86c84f7ddd01e4d9fc554366647eb5` | [3833c8d2379d3350663e624fe30be7867c559310](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_base.json>); `724aace335ae1e18e4c417516a0639570332a7a3e703f3bdfef826e8a5d2fa0e` |
| Dev 256x60_s11 | p100-d1 / 100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s11_n100_d1_fa493988d1952d94.json>); `aff30b2e09af9f47b677db614eb8c99857012cd59c73479a94b6a8134724632c` | [3833c8d2379d3350663e624fe30be7867c559310](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks/256x60_s11_n100_d1.json>); `088b3b75666b06acc0e2443778cca21fe83eeb3902ec93e2ccca87eb378e4377` |
| Dev 256x60_s11 | m100-d1 / -100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s11_n-100_d1_765dcbdc7609b11b.json>); `c1a2d1bb5c821a4765d5d30693f8a5e751f78b3cba8eb3265b946cd5fb018e4a` | [e990432a4e376606880020f1e51806ace1f6e5ee](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s11_n-100_d1.json>); `b3662136b92187681cdf0457b7d35740915fd2e01e70f50d3bc73569635a0464` |
| Dev 256x60_s11 | p100-d1441 / 100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s11_n100_d1441_3ae81d8d99f29e19.json>); `5e486c92a8ce2dde9254cfa38249f911fbd1d28d5479d393fd32db3b4bae4b39` | [e990432a4e376606880020f1e51806ace1f6e5ee](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s11_n100_d1441.json>); `e88b13ff191b535c55789a863475a254eaa264f787b7948c142e7199254425a3` |
| Dev 256x60_s11 | m100-d1441 / -100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s11_n-100_d1441_6502098c843cd042.json>); `8f8707fe246324635c3b8d0b0a8876ce098ec717e95a4f7560dff4354245b7a0` | [e990432a4e376606880020f1e51806ace1f6e5ee](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052/256x60_s11_n-100_d1441.json>); `7f0855320b2d510930d18b0cc3897f8b50aec55522c3d217fcd60df33fa837e7` |
| T041 128x15_s7 | control / 0 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/128x15_s7_base_5c0a5db521746aef.json>); `dd85ef90210d241236309969ce577f782e64a6da1b2ff7bdb480f22933c5050f` | new measurement |
| T041 128x15_s7 | p100-d1 / 100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/128x15_s7_n100_d1_7d2b1902e6c647f3.json>); `19543d26d75327ef690783ba7a8b44900108ba74e975cb2f116d75e527f19eb9` | new measurement |
| T041 128x15_s7 | m100-d1 / -100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/128x15_s7_n-100_d1_b10db23c5f1ba135.json>); `d757f87752cd96a7b042e65c0d014ae7e705f948a8050e9958464f61090f9c9b` | new measurement |
| T041 128x15_s7 | p100-d1441 / 100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/128x15_s7_n100_d1441_5616f8ee0c9f4b3d.json>); `9266aa0ee39e85c55597747c3144d6930fcb8babe078925129c4bcba27ef0023` | new measurement |
| T041 128x15_s7 | m100-d1441 / -100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/128x15_s7_n-100_d1441_7f8ed2552bb2c745.json>); `8f0b019b8e9d39a25f1bb31eecc86ae4f44f2c9c7811d12fc22fa8b778a5f301` | new measurement |
| T041 256x60_s7 | control / 0 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s7_base_f1c0988dd61fe72b.json>); `f356e7abc930cb328a1761b85f5343a7dba972eeee6f8a1192102c69e06b480b` | new measurement |
| T041 256x60_s7 | p100-d1 / 100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s7_n100_d1_dbea6f6aa548d098.json>); `fab3438ea26342e0052940438b9163f18e866e476d6f9261e08df00602f57940` | new measurement |
| T041 256x60_s7 | m100-d1 / -100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s7_n-100_d1_582f30f3f0e7f849.json>); `80ff8cc74affa90ad21d2f00260e6b2f94a4073266a2585f3c833fbc66f00ba3` | new measurement |
| T041 256x60_s7 | p100-d1441 / 100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s7_n100_d1441_68bfa89217438145.json>); `4d7ebe703cf03361d285efbfe20b04ec29cce66d64c8bd60cc765631d063a9cb` | new measurement |
| T041 256x60_s7 | m100-d1441 / -100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s7_n-100_d1441_fdb5bd41135990ed.json>); `7a0e7756dd3171b0b91b4f528fcb57b04a7ee5de68f40b99ba9be2b0838555e1` | new measurement |
| T041 256x60_s11 | control / 0 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s11_base_fa8eb618377c64c9.json>); `e1e15158c5fb97e3974383194a130585f1f52bda5093b1be55f8080ee1383033` | new measurement |
| T041 256x60_s11 | p100-d1 / 100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s11_n100_d1_c3b7051a9303008f.json>); `4ec5cdec0b02b3b640610d2b3735a8b70a31caefb6c493b584bbac71e30f5acb` | new measurement |
| T041 256x60_s11 | m100-d1 / -100 / 1 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s11_n-100_d1_2004399ee73211f9.json>); `e67aad599f2a5489e7bae0c5b06d4f0fd2c5894dcf92d9caf2ae798708dd2595` | new measurement |
| T041 256x60_s11 | p100-d1441 / 100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s11_n100_d1441_b599505f8582b5da.json>); `facd5cc491eaf1bc8ade09491e7e83122a62928089556677a36fd4b5d5a34a37` | new measurement |
| T041 256x60_s11 | m100-d1441 / -100 / 1441 | [raw](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s11_n-100_d1441_1308815e4c7b00c7.json>); `b6dc1599240aa79d5ba2e0ebb98e071ac5e800670087ffca5467b016bbb6c64e` | new measurement |

Member invocations are rendered below in PowerShell syntax for audit. Native argument-array launches whose displayed executable path starts with a quote receive the PowerShell call operator `&`; this is a display-only correction and the raw recorded command strings and output files remain unchanged. Imported records show the original invocation, rather than inventing a new execution on the documentation-only alias commit.

#### Dev 128x15_s7 — executed member commands

```powershell
# control
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\128x15_s7_base.spec.json
# p100-d1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\128x15_s7_n100_d1.spec.json
# m100-d1
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\128x15_s7_n-100_d1.spec.json'
# p100-d1441
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\128x15_s7_n100_d1441.spec.json'
# m100-d1441
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\128x15_s7_n-100_d1441.spec.json'
```

#### Dev 256x60_s7 — executed member commands

```powershell
# control
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s7_base.spec.json
# p100-d1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s7_n100_d1.spec.json
# m100-d1
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s7_n-100_d1.spec.json'
# p100-d1441
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s7_n100_d1441.spec.json'
# m100-d1441
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s7_n-100_d1441.spec.json'
```

#### Dev 256x60_s11 — executed member commands

```powershell
# control
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s11_base.spec.json
# p100-d1
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\fork-bundle\forkChild.mjs C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\forks\256x60_s11_n100_d1.spec.json
# m100-d1
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s11_n-100_d1.spec.json'
# p100-d1441
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s11_n100_d1441.spec.json'
# m100-d1441
node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' node 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note052\256x60_s11_n-100_d1441.spec.json'
```

#### T041 128x15_s7 — executed member commands

```powershell
# control
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\128x15_s7_base_5c0a5db521746aef.spec.json'
# p100-d1
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\128x15_s7_n100_d1_7d2b1902e6c647f3.spec.json'
# m100-d1
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\128x15_s7_n-100_d1_b10db23c5f1ba135.spec.json'
# p100-d1441
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\128x15_s7_n100_d1441_5616f8ee0c9f4b3d.spec.json'
# m100-d1441
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\128x15_s7_n-100_d1441_7f8ed2552bb2c745.spec.json'
```

#### T041 256x60_s7 — executed member commands

```powershell
# control
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\256x60_s7_base_f1c0988dd61fe72b.spec.json'
# p100-d1
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\256x60_s7_n100_d1_dbea6f6aa548d098.spec.json'
# m100-d1
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\256x60_s7_n-100_d1_582f30f3f0e7f849.spec.json'
# p100-d1441
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\256x60_s7_n100_d1441_68bfa89217438145.spec.json'
# m100-d1441
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\256x60_s7_n-100_d1441_fdb5bd41135990ed.spec.json'
```

#### T041 256x60_s11 — executed member commands

```powershell
# control
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\256x60_s11_base_fa8eb618377c64c9.spec.json'
# p100-d1
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\256x60_s11_n100_d1_c3b7051a9303008f.spec.json'
# m100-d1
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\256x60_s11_n-100_d1_2004399ee73211f9.spec.json'
# p100-d1441
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\256x60_s11_n100_d1441_b599505f8582b5da.spec.json'
# m100-d1441
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\quietrun.mjs' 'C:\Program Files\nodejs\node.exe' 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\fork-child.mjs' --fork-child 'C:\Users\techsin\AppData\Local\Temp\claude\d1b83ee1fc675451\a2e68b0e-17ac-5b5a-9911-c4f474b44f9a\scratchpad\lanes\T062\scratch\note053-t041\256x60_s11_n-100_d1441_1308815e4c7b00c7.spec.json'
```


### Exact collection and verification commands

The reference is the supplied dev-equivalent simulation at T062 HEAD `805d7d466972eaf89cfba4e1fc8c5f2df16ae0ef` (NOTE-053 documentation merged). Its simulation source matches the prior measurements. The fifteen explicit legacy imports retain their original commits, commands and content hashes; promotion to this documentation-only commit is recorded rather than pretending the bots ran again. Normal new cache reuse requires the exact measured tree commit and configuration. T041 was measured at `f9c94d561455f229e6984707e4429a32350b6127`; that tree was read only and remained clean.

These are the commands used for the six ensembles. Dev imported all fifteen completed members; T041 ran fifteen members with up to three active members, one row at a time:

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T062 --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052 --report-only
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T062 --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052 --report-only
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T062 --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/forks --import-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note052 --report-only

node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T041aa --size 128 --years 15 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041 --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --jobs 3
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T041aa --size 256 --years 60 --seed 7 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041 --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --jobs 3
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T041aa --size 256 --years 60 --seed 11 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041 --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs --jobs 3
```

Actual comparison commands (native exits **2** and **0**, respectively):

```powershell
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts compare base --dev C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/128x15_s7_ensemble.summary.json --lane C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/128x15_s7_ensemble.summary.json --dev C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s7_ensemble.summary.json --lane C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s7_ensemble.summary.json --dev C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s11_ensemble.summary.json --lane C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s11_ensemble.summary.json --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-compare
node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts compare signoff --dev C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/128x15_s7_ensemble.summary.json --lane C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/128x15_s7_ensemble.summary.json --dev C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s7_ensemble.summary.json --lane C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s7_ensemble.summary.json --dev C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-dev/256x60_s11_ensemble.summary.json --lane C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/256x60_s11_ensemble.summary.json --metric population --signoff-percent 3 --from-year 1 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-compare
```

The generic comparison is provisional and requests nine-member stage two for all three rows; it is not presented as a passing final base gate. T041 has NOTE-050’s explicit population endpoint exception: its five-member median sign-off stays closed. The current task measures these six five-member ensembles; nine-member final lane gates use the staged commands below. Nine-member city measurements and additional variant ensembles are not included in these tables.

### Serial-versus-parallel identity proof

The T041 128×15 s7 control ran in the three-worker collection alongside +§100 and −§100 day-1 members. Their parent execution intervals and recorded bot durations establish more than 11 seconds of overlapping simulation work. After all ensemble jobs finished, the same control was replayed alone through the quiet gate in an isolated proof directory. This is the one explicitly requested verification replay, excluded from ensemble statistics and normal member-cache reuse.

All **15/15 canonical city hashes and 15/15 full annual non-timing records** are identical, as are all **1689 successful commands** and **1123 complete decision-log entries**. [Proof metadata](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/round4-parallel-proof.json>) links the [parallel member](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/128x15_s7_base_5c0a5db521746aef.json>) and [serial replay](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-parallel-proof/alone.json>) and records the overlap and timestamps.

| Year | Shared canonical city SHA-256 (parallel = alone) |
|---:|---|
| 2001 | `49bd29ecdfc398d30ec966789e223894f03630683160a922818a4639a52206a7` |
| 2002 | `af3482b472c83983da2c1f7cc23477542e8804ed79f145c9b555f045e212b84f` |
| 2003 | `9c1885e56159d35b8d5f1e76f808cc44e385f0723dc6c093b6c533734c6bc188` |
| 2004 | `30620b7d9d6be4ad08c47de57efa9fdf3e29f47c1cb804160c60e368ec3d91d5` |
| 2005 | `c414531d5411ed347d5e8738770a645adf00fa8b520000e922dc4c0176d4165e` |
| 2006 | `adae67ccdc310dab98235e7d43d85ce5c90841c8593b9387fc01312a25e8d35b` |
| 2007 | `5bd6f2f35da4a246035aedfbddc66cb23eb77572ae3d2bd02ee22207213e7040` |
| 2008 | `fe98b43c7c38b83e49e7e79b0b06616aad988258b010efa19e5e2af505243dd1` |
| 2009 | `2d8d9128db50b5b3a6001371339c12b1e61a26ec0f944c727ce9b120249353c7` |
| 2010 | `8701f77a27515f91dd269bfd1a50742bbcd75528946306e380f783ccccb136c0` |
| 2011 | `7acab0095b71c15ac3651617b036a1abe806ce9e9de7b7765be79be56cfcf4cd` |
| 2012 | `483e24f59311de4b7a57d3685b03118393d98a8de5148ea21840eb1718f03390` |
| 2013 | `bdd1aed03a89200696e2c2e56272a98d6879eaa5bf6b5c0529622cc88b039376` |
| 2014 | `b65f5ac94d188bfdb2e71da18d2202c69ab142d6855da8df9a7c52e4b5e8a4e4` |
| 2015 | `f2696df0dba4e54bfe926313fd355871b1e9266387525d9ce900cb988101c6db` |

Exact replay command:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-t041/fork-child.mjs --fork-child C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-parallel-proof/alone.spec.json
```

Repeating all six collection commands with `--report-only` restored missing imported journals and reused all thirty members. Their raw JSON content hashes **and modification times** were unchanged, and every annual/action/text sidecar exists. [Cache proof](<C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/round4-cache-proof.json>). No completed ensemble member was rerun by collection.

### Round 4 checks and limits

- `npx tsc --noEmit`: passed. Four sequential quiet-gated single-file Vitest commands passed: `botEnsembleStats.test.ts` **15**, `botSimEnsembleRunner.test.ts` **7**, `botAaForkEnvelope.test.ts` **7**, and `botAaFundsNudge.test.ts` **11** — **40 tests total**. The tests cover medians/bands, inclusive thresholds, zero bands, year ranges and missing years, systematic shifts, same-commit targets, stage two, membership/cache keys, argument guards and the unchanged funds-only flag.

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/vitest/vitest.mjs run tests/sim/botEnsembleStats.test.ts --maxWorkers=1 --configLoader native --pool threads
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/vitest/vitest.mjs run tests/sim/botSimEnsembleRunner.test.ts --maxWorkers=1 --configLoader native --pool threads
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/vitest/vitest.mjs run tests/sim/botAaForkEnvelope.test.ts --maxWorkers=1 --configLoader native --pool threads
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/vitest/vitest.mjs run tests/sim/botAaFundsNudge.test.ts --maxWorkers=1 --configLoader native --pool threads
```

- Independent verification recomputed all **1,080 metric bands from 1,350 raw annual records**, checked all fifteen imported payloads and their source hashes, and checked **432 generic base metric verdicts plus 135 population sign-off verdicts** against the actual compare output. It also checked **48 pre-year-5 state matches** across both trees. The serial/parallel proof and thirty-member no-rerun cache check passed.
- The dev control remains **192,899** with residents `[61124,93804,37971]`; the dev long controls remain **1,513,835 / 1,427,340**. These are unchanged exact single-run references, distinct from the new median gates. No simulation formula, default strategy, RNG call, save format, baseline fixture, UI, worker or infra file changed. The fork observer only gains optional variant argument forwarding and matching `noInfra` system selection; its default path remains identical.
- Current guidance throughout both reports is updated to NOTE-053. The original measured tables and the explicitly labelled old direction diagnostic remain historical evidence. User-authorised `--jobs` replaces the older one-process SIM-lane rule for this measurement. The endpoint check uses years 15/60/60, matching the user’s clarification of NOTE-053’s shorthand. The matching-nine-reference and inclusive-threshold choices are explicit in the lane workflow.
- No cloud-held or outside-scope hunks or cloud requests. The supplied T041 measurement tree was not edited. Changes remain uncommitted; no push, merge or `.done` file.
- Left for lane final gates: collect the rows named by stage two with matching nine-member ensembles, and measure each actual lane variant at its base commit. The large-effect Hard/tax sweeps, full suite, old-save continuations and real-GPU checks were not rerun here. Browser Acceptance checklist: **N/A — no browser criteria are specified for T062**.

### How a SIM lane runs its ensemble gate

This is the historical NOTE-053 workflow. The NOTE-062 section below replaces its member-count, staging and zero-width guidance for final gates; retain these commands as the provenance of the earlier measurements.

Use [tools/simEnsemble.mts](../../../tools/simEnsemble.mts) from this tree, or the merged copy in dev, against the selected `--tree`. The runner reads that tree and writes only the specified output directory. It bundles the selected tree's bot with its local Rolldown; `tsx` is unnecessary. Run the row commands sequentially so there are at most `--jobs` members across this lane. The default is three concurrent members; each goes through the supplied quiet gate. The gate waits before launching a member while a timing hold exists; the existing gate does not suspend an already running member.

Until T062 is in dev, the measured lane tree needs the funds flag from `3833c8d`:

```powershell
git -C LANE_TREE cherry-pick 3833c8d
```

If `tools/simbot.ts` conflicts, merge its small flag hunks into the lane's bot. Keep the `aaFundsNudge` option, finite signed parsing, usage and optional saved provenance; keep the once-only addition after `advanceDay(); this.days++`, before `daily()`. Preserve the lane's own rules and arguments. In T041, retain `taxStartYear`/`applyFixedTax`, including its before-advance call, alongside the after-advance nudge. Do not replace the whole bot with the older file. The supplied T041 measurement tree `f9c94d5` already has both sides merged correctly. The collection tool itself can stay in T062; its absolute path and `--tree` select the bot to measure.

For each final gate, use clean committed simulation sources. Choose separate output directories for the reference, the lane base, and each variant. The member cache includes the tree commit, simulation and bot identities, dependency files, observer, row, signed amount, timing and bot arguments. Changing only `--jobs` or upgrading from five to nine members reuses existing members. Completed members are never replaced by a normal collection command. Interrupted members have no complete JSON and restart. `--report-only` rebuilds tables from complete members without bots.

The following PowerShell variables are placeholders for the intended measurement trees and scratch directories. For T042–T045, `DEV_BASE_TREE` must be dev containing T041; the tables above describe the supplied T041 base. When that dev has a different simulation identity, measure it afresh.

```powershell
$ensembleTool = 'C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts'
$ensembleQuietGate = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$ensembleDevTree = 'DEV_BASE_TREE'
$ensembleLaneTree = 'LANE_TREE'
$ensembleDevOut = 'REFERENCE_SCRATCH'
$ensembleLaneOut = 'LANE_BASE_SCRATCH'
$ensembleVariantOut = 'LANE_VARIANT_SCRATCH'
$ensembleCompareOut = 'COMPARISON_SCRATCH'

node --experimental-strip-types $ensembleTool --tree $ensembleDevTree --size 128 --years 15 --seed 7 --out-dir $ensembleDevOut --quiet-gate $ensembleQuietGate --jobs 3
node --experimental-strip-types $ensembleTool --tree $ensembleDevTree --size 256 --years 60 --seed 7 --out-dir $ensembleDevOut --quiet-gate $ensembleQuietGate --jobs 3
node --experimental-strip-types $ensembleTool --tree $ensembleDevTree --size 256 --years 60 --seed 11 --out-dir $ensembleDevOut --quiet-gate $ensembleQuietGate --jobs 3

node --experimental-strip-types $ensembleTool --tree $ensembleLaneTree --size 128 --years 15 --seed 7 --out-dir $ensembleLaneOut --quiet-gate $ensembleQuietGate --jobs 3
node --experimental-strip-types $ensembleTool --tree $ensembleLaneTree --size 256 --years 60 --seed 7 --out-dir $ensembleLaneOut --quiet-gate $ensembleQuietGate --jobs 3
node --experimental-strip-types $ensembleTool --tree $ensembleLaneTree --size 256 --years 60 --seed 11 --out-dir $ensembleLaneOut --quiet-gate $ensembleQuietGate --jobs 3

node --experimental-strip-types $ensembleTool compare base --dev "$ensembleDevOut/128x15_s7_ensemble.summary.json" --lane "$ensembleLaneOut/128x15_s7_ensemble.summary.json" --dev "$ensembleDevOut/256x60_s7_ensemble.summary.json" --lane "$ensembleLaneOut/256x60_s7_ensemble.summary.json" --dev "$ensembleDevOut/256x60_s11_ensemble.summary.json" --lane "$ensembleLaneOut/256x60_s11_ensemble.summary.json" --out-dir $ensembleCompareOut
```

The base comparison defaults to all four metrics and zero item tolerance. It requires the lane median inside dev's min-max band **and** `abs(lane median − dev median) <= max(item tolerance, (dev max − dev min)/2)` for every year from year 10. There is no implicit percentage floor. Use `--metric population` to gate only that metric, `--tolerance N` for absolute metric units, or `--tolerance-percent N` for a percentage of each year's dev median. Multiple `--metric` flags or a comma-separated list select the item's gated metrics. Approval uses points; air uses the balance-test mean at homes; I-HT shares are fractions.

The systematic-shift table requires all three row pairs. It flags a common endpoint direction with each delta strictly greater than a quarter of that row's dev band. The short row contributes year 15 and the long rows year 60, as requested; this resolves NOTE-053's shorthand “year 60 in all three rows.” A partial row comparison cannot report a final passing base gate with that check missing.

For a variant, collect both its ensemble and its base at the **same lane commit**, keeping the simulation source unchanged between them. For example, `--neglect` at least 2% below base on 256×60 s7:

```powershell
node --experimental-strip-types $ensembleTool --tree $ensembleLaneTree --size 256 --years 60 --seed 7 --out-dir $ensembleVariantOut --quiet-gate $ensembleQuietGate --jobs 3 -- --neglect
node --experimental-strip-types $ensembleTool compare variant --dev "$ensembleDevOut/256x60_s7_ensemble.summary.json" --base "$ensembleLaneOut/256x60_s7_ensemble.summary.json" --variant "$ensembleVariantOut/256x60_s7_ensemble.summary.json" --metric population --target-below-percent 2 --out-dir $ensembleCompareOut
```

Repeat for each required variant row. `--target-above-percent`, `--target-below` and `--target-above` support the other direction and absolute units. The target is evaluated against the lane base median, not dev's median and not an individual control run. `--from-year` defaults to 10; `--to-year` can restrict a target to its specified checkpoint/range. Supported bot arguments are validated against the selected parser; an unsupported argument fails rather than silently running the default strategy.

For every base check or target, the JSON records threshold distances and the reference half-band. A distance **at most** half of dev's band requests stage two, for passes as well as failures. This literal inclusive rule often requests nine members even for an unchanged base; a zero-width band requests stage two exactly at its threshold. It is not restricted to misses. The base thresholds are the active endpoints of the intersection of its two acceptance intervals. The compare output names the affected rows.

Rerun each named reference and lane row with `--runs 9`, keeping its output directory, nudge and bot arguments. For a variant, expand dev, the lane base and the variant for that row. This tool uses matching nine-member designs on both sides; NOTE-053 does not explicitly name the reference's second-stage count, so the matching-reference choice is stated here. Each command reuses the original five and adds only ±§200 on days 1/1441:

```powershell
node --experimental-strip-types $ensembleTool --tree $ensembleDevTree --size 256 --years 60 --seed 7 --out-dir $ensembleDevOut --quiet-gate $ensembleQuietGate --jobs 3 --runs 9
node --experimental-strip-types $ensembleTool --tree $ensembleLaneTree --size 256 --years 60 --seed 7 --out-dir $ensembleLaneOut --quiet-gate $ensembleQuietGate --jobs 3 --runs 9
node --experimental-strip-types $ensembleTool --tree $ensembleLaneTree --size 256 --years 60 --seed 7 --out-dir $ensembleVariantOut --quiet-gate $ensembleQuietGate --jobs 3 --runs 9 -- --neglect
```

Repeat the comparison command with the updated summaries. Nine-member results retain proximity evidence without requesting another stage. The summary/Markdown filenames are the same at five and nine; retain a copy of the five-member summary if both stages need to appear together in a report. All raw members remain cached, and `--runs 5 --report-only` can rebuild the first-stage table without simulation.

Compare exit statuses are: **0** final pass, **1** fail, **2** named rows need nine runs, **3** investigate a systematic shift, **4** a base comparison lacks the three-row systematic check. JSON distinguishes current median pass/fail from a provisional staged verdict. Paste the generated `ROW_ensemble.md` median/band tables and the comparison table into the lane report; the cloud checks those tables instead of rerunning ensembles.

NOTE-050's existing T041 D2 sign-off has its own command. It reports intermediate population excursions but reopens only at each actual row endpoint, even if a display range is selected:

```powershell
node --experimental-strip-types $ensembleTool compare signoff --dev "$ensembleDevOut/128x15_s7_ensemble.summary.json" --lane "$ensembleLaneOut/128x15_s7_ensemble.summary.json" --dev "$ensembleDevOut/256x60_s7_ensemble.summary.json" --lane "$ensembleLaneOut/256x60_s7_ensemble.summary.json" --dev "$ensembleDevOut/256x60_s11_ensemble.summary.json" --lane "$ensembleLaneOut/256x60_s11_ensemble.summary.json" --metric population --signoff-percent 3 --from-year 1 --out-dir $ensembleCompareOut
```

The collection tool keeps the original exact checks available: every raw annual record includes the full non-timing bot row and canonical serialized-state hash. Medium bit-identity, two-process hashes and non-SIM “bot identical” checks remain exact. NOTE-053 also leaves the specified large-effect Hard/NEW-05 sweep checks intact; medians do not authorize compensating mechanics or changing the default bot strategy.

### Round 5: interim lane judgements (NOTE-055)

The T043/T044/T045 campaign completed all five-member ensembles and required nine-member stages against the original dev simulation at `805d7d4`. Paste-ready `T043.md`, `T044.md`, `T045.md` and `SUMMARY.md` are in `C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note053-lanes/`, beside exact commands, verdict JSON, independent audits and `validation.json`. Shared nine-member dev references are under `data/dev/base`. Fifteen existing dev members were reused; 170 new members ran with `--jobs 4` through the quiet gate, one ensemble command at a time. No baseline or simulation code changed. These are interim judgements; final gates after T041 lands remain separate.

## NOTE-062 final-gate runner and observers

The lead's `scratchpad/lanes/NOTE-062.md` supersedes the Round 5 interim verdicts where amended. T043 has a fix round; its neglect targets cannot be confirmed while the corresponding base fails. T044's mechanics are accepted provisionally under its own narrow amendments, with the late approval target still open. T045 is held pending diagnosis and final measurements. This implementation changes collection and reporting only; it does not rerun those campaigns or sign off any lane. Final gates run on dev including B2, T041 and the preceding SIM lanes.

### Member counts, gates and origin

- Every base row and every 256×60 variant uses **nine members directly**, for lane and dev: control, ±§100 and ±§200 on days 1 and 1441. `--nudge` overrides X, with the outer members at ±2X. Nine is final; there is no third stage.
- Only 128×15 variants start with five members, retaining NOTE-053's inclusive half-dev-band proximity rule for stage two. When a short variant has five members and its base/dev summaries have nine, the comparison reads the actual matching control/±X raw members and recomputes five-member bands. It never infers those medians from a nine-member aggregate. Output records original and effective member counts. Stage two compares nine on all sides.
- Base checks retain both NOTE-053 clauses in every year from year 10: lane median inside dev's band, and absolute median difference at most `max(item tolerance, half dev's band)`. Population tolerance is 1% for T043/T044/T045; approval, air and I-HT have no generic percentage floor. T044's intended-direction and realised-I-HT exemptions remain lane-specific report decisions. T045 selects `approvalNetCommute` instead of raw approval, with zero tolerance.
- In addition to the three-row endpoint check, **three consecutive disjoint lane/dev bands in any row/metric are a real shift**. Touching endpoints overlap. A mixed-direction sequence still qualifies under the literal consecutive-years rule. The JSON records each run and direction; a lane must explain the mechanism. The tool does not infer it.
- When all nine dev members have I-HT share exactly zero, that year does not gate I-HT or contribute to either shift check. Values remain reported, along with the first year the lane's median leaves zero. Other zero-width metrics retain the usual exact boundary.
- Every 256×60 collection/comparison includes transposed year-60 member columns, population in 2050, growth through 2060, each member's stalled flag, and counts for the compared lane/base/variant and dev. Growth **under 100,000** is stalled; exactly 100,000 is not. These diagnostics do not gate.

New summaries carry the measured commit, its parent, source/dependency identities and each raw member path/observer. Existing members from the known pre-collector observer are reused in place when commit, simulation, dependencies, row, signed nudge, timing and bot arguments match. The new observer identity includes the collector helper's bytes. Missing old observations are **unavailable**, never invented as zero; a gate requesting a missing metric fails explicitly. `--report-only` rebuilds reports without bots. An incomplete `--members` selection writes `.partial.json` and `.partial.md`, explicitly not a final ensemble.

The earlier measured trees trace to these lane parents; no push or measurement-tree edit was made:

| Measured tree | Measured commit | Lane parent before the funds flag |
|---|---|---|
| T043m | `414e491e08b847e425323d67b79ed4aeedfa97a9` | `4a6aaff2c5263f3282542f82cc8ec8fd73110fef` |
| T044m | `a1a4e79e709e12a368af0645c3ac9dd50e9ac7f1` | `57ed98340cf91aeeb3dcebe13ca46a3708d54c59` |
| T045m | `f8b3f145a379694adedb1e26bb825886d49282a2` | `59f7ce9aff92ceecb3f1fc1ff815100b92dfe5f4` |

`git diff e01526a 4a6aaff -- src/sim` and `git diff 4a6aaff 414e491 -- src/sim` are empty, confirming NOTE-062's T043 simulation-source statement for the measured parent and tree.

### Observation columns (FX1, FX2 and T044)

The bot's original `YearRow`, decisions and state remain separate from observations. `tools/simBotObservations.ts` attaches in the external fork wrapper; neither `tools/simbot.ts` nor simulation files need edits. Annual NDJSON and raw member JSON add these optional fields, and ensemble tables give each available field's median and min-max band:

| Field | Definition |
|---|---|
| `commuteTermRaw` | Stored `economy.approvalTerms.commute`, including LG-08's population fade; no reconstruction from average commute. |
| `commuteTerm` | That member's commute term, seeded after new-city approval initialization and updated after every monthly approval tick with the selected tree's `APPROVAL.ema`. |
| `resCommute` | Stored resident-weighted survey commute, distinct from the traffic-wide `stats.avgCommute`. |
| `approvalNetCommute` | Recorded approval minus that member's smoothed `commuteTerm`; derived before taking ensemble medians. The separately named clamp contribution remains in approval. This is not a simulated counterfactual city. |
| `ihtDemandShareRaw` | I-HT uncapped target / (I-D + I-M + I-HT uncapped targets). |
| `ihtDemandShareCapped` | I-HT capped target / (I-D + I-M + I-HT capped targets). |
| `ihtDemandShare` | Positive I-HT `demandAbs` / sum of positive I-D, I-M and I-HT `demandAbs`; zero when that denominator is zero. This is T044 gate (a)'s incremental-demand metric. |
| `dirtyJobShare` | `industrialStrategy(st).dirtyShare`, whose filled-industrial-job denominator includes farms; old dev derives the same filled-job share. |
| `retooledIM`, `retooledIHT` | Read-only `industrialStrategy(st)` readings. Unavailable on trees without that strategy. |

The member JSON also carries `approvalActions`: successful reward/landmark purchases and newly enacted ordinances, stamped with absolute day, calendar date/year and approval at the decision. Approval thresholds are included where applicable (reward unlock or bot ordinance gate). Preview attempts, failed purchases and unchanged ordinance setters do not add entries. The original successful-action journal and full decision log remain unchanged. Stored economy data is read directly; the collector does not call mutating initialization/survey getters or draw RNG.

### Current command workflow

Use this tool against a clean selected tree; the tree still needs the `3833c8d` funds flag. Resolve a `simbot.ts` conflict by retaining both the lane's rules and the small nudge option/parser/once-only after-advance addition described in Round 4. The observation helper stays with this runner and is bundled against the selected tree's tuning, reward metadata and optional industry getter.

```powershell
$ensembleTool = 'C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts'
$ensembleQuietGate = 'C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs'
$ensembleTree = 'CLEAN_MEASUREMENT_TREE'
$ensembleBaseOut = 'BASE_SCRATCH'
$ensembleVariantOut = 'VARIANT_SCRATCH'

node --experimental-strip-types $ensembleTool --tree $ensembleTree --base --size 128 --years 15 --seed 7 --runs 9 --jobs 3 --out-dir $ensembleBaseOut --quiet-gate $ensembleQuietGate
node --experimental-strip-types $ensembleTool --tree $ensembleTree --base --size 256 --years 60 --seed 7 --runs 9 --jobs 3 --out-dir $ensembleBaseOut --quiet-gate $ensembleQuietGate
node --experimental-strip-types $ensembleTool --tree $ensembleTree --base --size 256 --years 60 --seed 11 --runs 9 --jobs 3 --out-dir $ensembleBaseOut --quiet-gate $ensembleQuietGate

node --experimental-strip-types $ensembleTool --tree $ensembleTree --variant --size 256 --years 60 --seed 7 --runs 9 --jobs 3 --out-dir $ensembleVariantOut --quiet-gate $ensembleQuietGate -- --skip dirty
node --experimental-strip-types $ensembleTool --tree $ensembleTree --variant --size 128 --years 15 --seed 7 --runs 5 --jobs 3 --out-dir $ensembleVariantOut --quiet-gate $ensembleQuietGate -- --skip dirty
```

Repeat the base commands on dev and lane trees, and long variants on every required seed/strategy, using distinct output directories. `--base` explicitly marks configured bases; bot arguments otherwise imply a variant, while `--variant` can label an unflagged variant. Five-member base/long requests and any count other than five/nine are rejected. Run one outer command at a time; every member uses quietrun, and this follow-up uses at most three bot processes.

Comparison syntax is unchanged. Supply all three dev/lane row pairs for the endpoint check. Select `--metric population --tolerance-percent 1` for population; select `--metric approvalNetCommute --tolerance 0` for T045's approval gate, and `--metric air,ihtShare --tolerance 0` for its remaining generic metrics. Collection tables report both raw approval and its commute term beside the net metric. T044 gate (a) can select `--metric ihtDemandShare --target-above 0.25 --from-year N --to-year 40`, with N chosen from the first year the EQ ensemble median reaches 110. Its other special exemptions and targets remain explicit in its report.

For a short variant flagged near its threshold, expand that variant to `--runs 9` in the same directory and compare against the already-nine base/dev. Exit 2 names required nine-member rows; exit 3 reports a real disjoint/systematic shift requiring explanation; exit 4 denotes a missing three-row endpoint check. Nine-member results never request another stage. A real shift remains reported even when an ordinary median check passes.

### NOTE-062 verification and limits

Implemented uncommitted on T062 HEAD `818a040`, parent `49c491b`. No `src/**`, `simbot.ts`, save-format or baseline-fixture changes. The wrapper adds observation fields alongside the original non-timing bot row, not inside it. No cloud-held or infra hunks and no cloud requests.

TypeScript passed. Single-file tests passed sequentially through quietrun with the native config loader and threads pool:

| Test file | Passed |
|---|---:|
| `tests/sim/botEnsembleStats.test.ts` | 15 |
| `tests/sim/botEnsembleNote062.test.ts` | 8 |
| `tests/sim/botSimEnsembleRunner.test.ts` | 9 |
| `tests/sim/botObservations.test.ts` | 6 |
| `tests/sim/botAaForkEnvelope.test.ts` | 7 |
| `tests/sim/botAaFundsNudge.test.ts` | 11 |
| Total | **56** |

Collector tests include a changing nonzero commute term with approval smoothed on the same monthly ticks (net approval stays constant), absent-system disposal, all three demand denominators, getter purity, action forwarding/dates, and a real 64×1 collectors-off/on pair with equal bot rows, successful commands, full decision logs and serialized-state hashes. The native CLI check also covers module loading outside Vitest. The first typecheck exposed an optional-system disposal guard; the first native CLI probe exposed an extensionless source import. Both were corrected before the passing checks and before the smoke.

The only ensemble smoke selected **two 128×15 s7 members**, control and +§100/day1, with jobs=2. Each exactly reproduces its existing reference's **15 annual core records and 15 city digests**, including every original bot-row field, funds/residents/jobs, successful actions and full decision log. The new preview is explicitly partial, not a gate. No new 256×60 run occurred.

| Smoke member | Final population | Residents | Equal annual rows / hashes | Equal successful actions | Equal full-log entries | New dated approval actions |
|---|---:|---|---|---:|---:|---:|
| control | **192899** | **[61124,93804,37971]** | 15 / 15 | 1699 | 1111 | 24 |
| +§100/day1 | 190132 | [60354,93256,36522] | 15 / 15 | 1665 | 1123 | 25 |

Example year-15 observations from those two members (individual values, not a final ensemble):

| Field | Control | +§100/day1 |
|---|---:|---:|
| `commuteTermRaw` / `commuteTerm` | 0 / 0 | 0 / 0 |
| `resCommute` | 7.51611626613 | 7.74743779252 |
| `approvalNetCommute` | 81.3650175025 | 81.5562998670 |
| `ihtDemandShareRaw` | 0.167659574468 | 0.151918172981 |
| `ihtDemandShareCapped` | 0.180178382278 | 0.162018109688 |
| `ihtDemandShare` (positive incremental) | 0.270611852557 | 0.253042259156 |
| `dirtyJobShare` (including farms) | 0.513955908790 | 0.496271245231 |
| `retooledIM` / `retooledIHT` | unavailable on this old dev | unavailable on this old dev |

Report-only collection reused **all 27 cached nine-member dev base records** with identical raw bytes and modification times. It added endpoint/stall tables and explicit unavailable-observation lists to their summaries; originals of the summary/Markdown files were saved under `note062/old-summaries`. Comparing the existing T043 campaign with those cached references reports the **44-year seed-11 population disjoint run** (2010–2053), exit 3, without another stage or a bot. Its endpoint diagnostics give dev/lane stalled counts **0/0 on s7** and **0/1 on s11**, each out of nine. These are a reporting check on old measurements, not the final post-B2/T041 verdict.

Proofs, exact commands, generated tables and logs are under:

`C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note062/`

- `smoke/128x15_s7_ensemble.partial.md` and `.partial.json`: every annual new median/band column and raw member paths.
- `smoke-proof.json`: both members' 30 exact annual digests, original rows/actions/log equality and resident counts.
- `cache-proof.json`: 27 unchanged raw members, 44-year shift and independently recomputed endpoint/stalled values.
- `cached-comparison/base.compare.md` and `.json`: disjoint-band, I-HT activation, origin and member-column output from cached data.
- `gates.json`, `proof-commands.json`: actual command arrays, exits, log paths and execution timestamps, including the corrected initial failures.

Actual smoke command (every child also passes through the quiet gate):

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/tools/simEnsemble.mts --tree C:/Users/techsin/Desktop/projects/simcityweb-T062 --base --size 128 --years 15 --seed 7 --runs 9 --members control,p100-d1 --jobs 2 --out-dir C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/T062/scratch/note062/smoke --quiet-gate C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs
```

Equivalent selected bot arguments are `tools/simbot.ts --size 128 --years 15 --seed 7 --quiet` and the same plus `--aa-funds-nudge 100`; the wrapper supplies the collectors and journals. Tests use this single-file command, sequentially for the six files in the table:

```powershell
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs node --experimental-strip-types C:/Users/techsin/Desktop/projects/simcityweb-T062/node_modules/vitest/vitest.mjs run tests/sim/botObservations.test.ts --maxWorkers=1 --configLoader native --pool threads
node C:/Users/techsin/AppData/Local/Temp/claude/d1b83ee1fc675451/a2e68b0e-17ac-5b5a-9911-c4f474b44f9a/scratchpad/lanes/quietrun.mjs npx tsc --noEmit
```

The initial gate waited for the worker's timing hold to clear. Peak bot concurrency was two. No full suite, benchmark or browser ran. Old cache records cannot supply retrospectively missing commute/retool observations. Long-run nonzero commute measurements, monthly commute/tourism/failure probes, T043/T045 diagnosis, T044's spatial industry probe and all lane-specific browser/timing/save checks remain with the lanes/lead. After B2 and T041 merge, T062 still supplies the new A/A measurement, nine-member dev bases, dev neglect on s7/s11, dev skip-dirty on s7 and dev subway on s7 under NOTE-062's scheduling rules. Browser Acceptance checklist for this runner-only follow-up: **N/A**. All changes remain uncommitted; no push, merge or `.done` file.
