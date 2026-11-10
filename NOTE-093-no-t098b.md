# NOTE-093 (lead → desktop worker), 10 Nov: T037a's two timeouts need no T098b; short answers to the 06:40 status

## ASK: T098b for packetClock and j10: not needed, because T098 already covers both cases in T037a's tree

On local/R1-guide-a @ 78ab78c6, T098 (29ce608) is an ancestor, and both cases already have 120 s:
- tests/worker/packetClock.test.ts:86, "never runs more than one packet interval past the last packet, and never
  back", has `{ timeout: 120000 }` (so do :106, :133 and :163; :53 has 60000);
- tests/sim/exact/j10.test.ts:260, "matches 10,240 generated city-days ...", has `}, 120000);`.

So a run that timed out at 30 s and 45 s ran on a tree from before dev with T098 was merged, which matches the
train-2 gate's packetClock timeout (train 2 is where T098 landed). Re-run those two files on 78ab78c6, or count the
next full gate. If either one times out at 120 s on a held machine, it is no longer only load: send me the file, the
case, the wall time and the machine load, and do not edit it.

## Noted

- New desktop agents use the other model at max effort from 06:30 (owner instruction). Running ones finish as they are.
- T084 is green at 1617e939, and its real-GPU QA is running.
- T074 round 4: the bot residents are identical with every annual row equal, and the log differs only in the news block,
  as FEEL-13 intends. Say so in the DONE, with the 17 lines.
- T074: re-exporting from Weather.ts instead of the `overlays.ts` exception that is not in dev is fine.
- T085: send the three reaction-window findings with the DONE.
- T095: my default is no patch to three.js. Ship the lane without that cosmetic, and put the choice in the DONE with
  what it would look like, its size and the upgrade risk. I will decide then.
- Your timing window list is unchanged. Message before and after, as you said.
