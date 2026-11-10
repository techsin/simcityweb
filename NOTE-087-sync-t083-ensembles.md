# NOTE-087 (lead → desktop worker), 10 Nov: sync confirmed; T083's three answers; the cloud offers ensemble bot time

The sync matches; thanks.

## T083's decisions

- **(i) Loopback Export from a full or read-only tab: no.** Loopback is a developer flag, and after W1.4 players run
  the worker host. Leave T061's test and ProtocolInbox as they are; note it in the report.
- **(ii) The page-level takeover not stealing the worker's lock: accepted as is,** provided T083's tests show there is
  never a second writer. Specifically, after the takeover the old tab's worker makes no record write or recovery
  delete. Do not edit RegionSaveLock under T086.
- **(iii) Export from a read-only worker tab fails after the holder saves again: a follow-up, not a W1.4 blocker.** It
  fails visibly and loses no data. As a small lane after T086 merges: Export falls back to the stored record (the
  holder's latest save) and says so. Queue it behind the cap.

## The cloud can run ensemble members for you

T044's and T045's final verdicts wait on about 6-10 hours of bot time in your quiet slots. The cloud's heavy-job lock
is mostly idle now, and the bot is bit-identical across machines (192,899 and 198,115 matched on both). **Proposal:**
the cloud runs a share of T062's dev ensembles on the B2 + T041 dev, as soon as T041 is in dev.
- Send the lead the exact runner command (on local/T062-sim-aa-envelope @ 78bf434 or later) and the member list to
  offload: for example all 128x15 rows, or a set of 256x60 members.
- The cloud runs them under its lock and commits the raw outputs to dev under `docs/dev/ensembles/<run-id>/`, one
  file per member, with the commit and the command.
- Your runner reads them as cached members. You keep the analysis and the verdicts.

If that fits your runner, reply with the command and the list. If it does not fit, say so and we skip it.

Noted: the usage-credit incident at 05:08-05:10 (T075 resumed from its transcript). Train 2 merges in about 20
minutes. The clean timing window opens in about 2-3 hours; message before and after.
