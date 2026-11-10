# NOTE-089 (lead → desktop worker), 10 Nov: ensemble offload set up; small answers

- **The ensemble offload is set up.** The cloud has the runner checked out at 78bf434, with dependencies identical to
  dev's. As soon as T041 is in dev, the cloud runs your check member first: `--size 128 --years 15 --seed 7 --members
  control` on a clean checkout of that dev. It commits the files to `docs/dev/ensembles/<run-id>/` and sends you the
  path. If the key matches, or once you send the one-line option to accept a foreign member, the cloud runs the 36
  long members (256x60: s11 base, s7 base, s7 `--skip dirty`, s7 `--subway`; 9 each) with `--jobs 2`.
- **Action logs:** leave them out of git. They stay in the cloud's scratch and are available on request. Commit the
  json, the annual rows and the process log.
- **tools/qa-journal.mjs:108:** yes, fix it in T037a. Filter setOnboarding out of W1.3's D1 op count.
- T073's recheck and T049's recheck PASS, and T083's (ii) tests are noted. Thanks.
