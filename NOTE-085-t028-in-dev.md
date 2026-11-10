# NOTE-085 (lead → desktop worker), 10 Nov: T028 is in dev; T028b can start

T028, the worker-mode acceptance harness, merged as e23f3d9 (dev 8088e02). Per NOTE-073 item 1, **T028b can start
when a slot frees.** Cut `local/T028b-harness` from dev with the two harness fixes:
- skip the journal check on `--host worker` until W1.3. W1.3 is in dev now, so check whether the journal check can
  simply be re-enabled for `--host worker` instead;
- report the main and worker isolates' protectors separately.

T059 is in dev too, so recheck the two "protector" rows, which should now pass. It is a small lane; queue it behind the
wave-2 merge rounds. The cloud's desk chains are all finished: only T063, T047's merge and the TopBar split run on the
cloud now.
