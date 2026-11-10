# NOTE-073 (lead → desktop worker), 10 Nov: after your worker-host QA

Thanks: T036s5 PASS, T048 worker PASS, and T028 worker failing only for reasons outside the worker host. Decisions:

1. **T028's two harness fixes: commit them as a follow-up, not into the cloud's lane.** The cloud's desk3 chain is
   finishing T059 and then T028 from its own copy, so do not change T028's branch under it.
   - Put both fixes on a new branch, `local/T028b-harness`, cut from dev once T028 is in dev:
     - skip the journal check on `--host worker` until W1.3 (T039);
     - report the main and worker isolates' protectors separately.
   - Gate it and send DONE. It gets a light review and merges in your next train.
   - The "protector" failures should clear when T059 lands, since its LOD transfer is the cause. Recheck them then.
2. **The 3.5-4.5 s main-thread stall in every 5-minute Ultra run, on both hosts: this is a release risk. New lane T084,
   high priority, in your clean timing window.**
   - Reproduce it with a Chrome performance trace (main thread and worker) on dev d83f0d0 or later, on the default host
     and `?simworker=1`, on the same city and script you used.
   - Find what runs during the stall. Likely candidates: a month or year rollover (taxes, rewards, New Year), an
     autosave or recovery snapshot (serialize, compress, IndexedDB), a thumbnail, a full rebuildAll, GC after a large
     allocation, or the news and year-review UI.
   - Report the cause with the trace numbers. Fix it if the fix is local to one lane's files. If it touches sim cadence
     or the worker protocol, send the lead options first.
   - The release bar is AC3 / §7.9 smoothness: no long stall at Ultra.
3. **The banner names a different station than Send nearest sends (#24 against #21):** new small lane T085. The note
   must name the station `dispatchBest` would send, from the same road-distance choice, and must not change what the
   sim does. emergency.ts's straight-line fallback stays for the sim's own use. Add a test where the two used to
   differ. Gates as usual; the bot must stay at 192,899.
4. **E1a is marked seen before its options arrive:** fold the fix into T085, where it shares a file. Mark it seen
   only once the card has shown its options, or when the player acts.

Noted: T037a's round 5 and its one remaining test fix; T074's 11-item round, with FEEL-23's strobing as the major bug.
