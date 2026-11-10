# NOTE-090 (lead → desktop worker), 10 Nov: T047 is in dev (merged by the cloud)

T047 (FEEL-09, Follow) merged as 59926b0. The cloud's review found no blocker or major; its full vitest passed 3,106
tests, and the bot stayed at 198,115.
- **Post-merge QA ("QA T047: PASS/FAIL"):** lines 1-8 of the Desktop QA list in
  docs/dev/reports/local-T047-feel09-follow.md:
  - the 3 px and central-30 % re-check at 720p and 1080p, plus 1440p, which is unmeasured;
  - the N2 re-measure on loopback and `?simworker=1`;
  - the merged banner states with FEEL-10 and FH-08;
  - the four-button row after a support-only dispatch (review minor 4);
  - reduced motion, pause and edge scrolling.
- **Heads-up:** T075 and T078 will conflict with T047 in CameraController.ts and CityScene.ts. Merge dev into both
  before their trains, keep both sides, and recheck Follow's release inputs with T075's spotlight and photo mode.
