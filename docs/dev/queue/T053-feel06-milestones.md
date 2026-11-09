# T053-feel06-milestones: polish round 2, CONTENT, FEEL-06 milestone moments
base: fb1531f (dev); branch local/T053-feel06-milestones
after: none for the card, the sound and the stage news. Two parts wait:
  - The rank-up fireworks: Fireworks.ts belongs to the cloud's T038. Call Fireworks.start only through its existing
    API, or leave the hook and list the request.
  - The "Place it" toast action: Notifications.ts belongs to the cloud's META chain (FEEL-02a). Post the reward news
    with ref: {reward: id}, and list the request.
owns: src/sim/economy/advisors.ts (the CONTENT hunk only: POP_MILESTONES, the milestone notify, stage news);
  src/sim/economy/rewards.ts (the ref on reward news); src/game/GameSounds.ts (the CONTENT hunk: the milestone case,
  POP_MILESTONES); new src/ui/MilestoneCard.ts, with its CSS in a new file; src/game/CityScene.ts (one CONTENT wiring
  block, right after the NewYear construction); new tests.
do:
  docs/POLISH_PLAN.md FEEL-06 (line 1552) in full; LG-01 (merged: CITY_RANKS, listMilestones); §7.3-§7.4
  (NewsItem.ref).
  - The milestone card: a lower-third card for 4 s ("QUEENSBURY · 10,000 RESIDENTS") with one "next" line, from
    STAGE_POP or listMilestones. At ultra, at most 1 card per 30 s. With reduced motion, no slide.
  - The `milestone` sound for every milestone, with 1.25M and 1.5M added to both lists.
  - Stage-unlock news, once each: 3k, 12k, 35k (the first towers), 90k (skyscrapers) and 220k (supertalls). Store it
    like popMilestone and initialise it from the current population on load, so old saves post nothing. No RNG draws.
  - Reward news posts with ref: {reward: id}.
gates:
  - tsc; the full vitest.
  - The bot: the news changes (the stage items), but residents stay 192,899. News text and systemData.advisors change:
    use FH-03's determinism rule, and say which hashes move.
  - Unit tests: crossing 35,000 posts exactly one tower-unlock item; loading a 300k save posts nothing; a save/load
    does not repeat an item; every milestone plays `milestone`.
  - A 256x60 s7 bot run posts all five unlock items once each, and none repeats after save/load.
  - Browser, real GPU (the worker): crossing 10,000 at 1× shows the card for 4 ± 0.5 s and plays `milestone` once; at
    ultra, at most 1 card per 30 s.
report: docs/dev/reports/local-T053-feel06-milestones.md, with the two requests. Push local/T053-feel06-milestones with
  docs/dev/queue/T053-feel06-milestones.done.
