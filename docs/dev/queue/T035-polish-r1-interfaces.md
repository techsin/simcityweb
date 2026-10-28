# T035-polish-r1-interfaces: polish round 1's interfaces, NewsItem.ref and the art-pipeline stubs (a Codex lane)
base: local/W0.3-5-integration @ 93069fa now; rebase onto local/W0-complete when it exists; branch local/R1-interfaces
owns:
  - `NewsItem.ref` (the SIM lane): src/sim/Simulation.ts (`notify` gains an optional ref argument), the news types and
    their save, the main-side news consumers' types, and tests.
  - The art-pipeline stubs (the CONTENT lane): new model ids with placeholder geometry in src/assets/** and their
    manifest entries, for the round 2-3 content that needs models (LG-03's projects, LG-19's expansion levels, and the
    rest §7.4 names), so content lanes never wait mid-round.
do:
  Read docs/POLISH_PLAN.md §7.4 (Interfaces land first) and §7.6 (Worker additions).
  - `NewsItem.ref?: {advice?: string; reward?: string}`: set by `notify` as a new optional argument, saved with the
    news. Toast actions (FH-03, FEEL-06, FEEL-02a's queue) key on `ref`, never on text.
  - The worker's news stream must carry `ref`. Write that part as a short request in the report: T032 owns
    protocol.ts and recorder.ts, and adds it there.
  - Old saves without `ref` load as before.
gates: the bot is bit-identical (196,101: `ref` changes no sim outcome); old saves load; tsc; the full vitest. For the
  stubs: a gallery render of each placeholder, and the manifest test passes.
report: docs/dev/reports/local-R1-interfaces.md; push local/R1-interfaces with docs/dev/queue/T035-polish-r1-interfaces.done; DONE.
