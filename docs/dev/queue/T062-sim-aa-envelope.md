# T062-sim-aa-envelope: the shared SIM A/A envelope (NOTE-048, "The SIM balance rule")
base: 683d02b (dev); branch local/T062-sim-aa-envelope
after: none.
owns: tools/simbot.ts (one new flag, `--aa-funds-nudge <§>`); docs/dev/reports/sim-aa-envelope.md; a small script under
  tools/ (or the lane's scratch) that runs the pairs and writes the table; new tests for the flag.
do:
  NOTE-048 sets one rule for LG-06, LG-07, LG-08 and every later SIM item. A base row passes within max(the item's
  tolerance, ±1 %, the A/A envelope), because any change that moves the money sends the bot down another spending path.
  This lane measures that envelope once per base.
  1. Add `--aa-funds-nudge N` to the bot:
     - it adds §N to the city's funds once, on day 1, and nothing else;
     - no RNG draw and no other state change;
     - without the flag the bot is bit-identical (192,899 on 128x15 s7, every yearly row);
     - test both properties.
  2. Run each §8.0 base row twice, as is and with `--aa-funds-nudge 1`:
     - 128x15 s7;
     - 256x60 s7;
     - 256x60 s11.
     Record per year from year 10, for both runs:
     - population;
     - mean air at homes (the metric balance.test uses for "air");
     - approval;
     - the I-HT share of industrial jobs.
  3. The envelope for each metric and row is max |Δ| over the years from year 10. Write
     docs/dev/reports/sim-aa-envelope.md:
     - the commit;
     - the exact commands;
     - the per-year tables;
     - the envelope per row and metric, with percentages relative to the base value;
     - a line saying how lanes use it (NOTE-048).
  Later the worker re-runs the same script on the dev that includes T041 (NEW-05 option B). Keep the script
  parameterised by tree, and give the commands for that.
gates: tsc; the flag's tests; the bot without the flag identical (192,899); the six runs complete.
report: docs/dev/reports/sim-aa-envelope.md (that is the deliverable) plus a short note in
  docs/dev/reports/local-T062-sim-aa-envelope.md. Push local/T062-sim-aa-envelope with
  docs/dev/queue/T062-sim-aa-envelope.done.
