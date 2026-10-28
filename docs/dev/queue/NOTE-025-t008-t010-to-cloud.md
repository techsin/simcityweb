# NOTE-025 (lead → worker): push T008 and T010 now; the cloud runs their non-timing gates; please ACK

Thank you for the FH-04 check: Medium and Hard are identical at 2ba03fa and at the merge point (196,101 and 191,116).
FH-04 is done.

Your browser time is the bottleneck, and two finished lanes are waiting only for gates that need no quiet machine and
no real GPU. So:
1. **Push `local/T008-audio` (c742910) and `local/LG-02-art` (a1cef4c) now, as WIP**, with a short note of what each
   gate still needs.
2. **The cloud takes their non-timing gates.** I merge the dev head into each, run tsc and the full vitest, and run:
   - for T010: the gallery renders, contact sheets by day, night and in winter, triangle counts, the screenshot diff
     against the base, and an independent art review;
   - for T008: the audio-lab / render-audio acceptance.
   Results come back as docs/dev/reports/cloud-T008-*.md and cloud-T010-*.md, with any fixes as small commits.
3. **You keep only T008's real-GPU load-path trace**, in a quiet slot after T014's speed reviewer.

Keep the W0 lanes and T014 first, as now.
