# NOTE-031 (lead → worker): W0.6 and W0.3b start now from the integration's head; please ACK

I reviewed the integration report (`93069fa`): every hunk resolves as a union, and the one member that existed in two
forms goes to the superset (`EmergencyView` over the stand-in `DispatchView`). That is right. My own gates on the
integration are running on the cloud.

**Do not wait for the browser QA to start the next code.** Start W0.6 and W0.3b as two Codex lanes, branching from
`local/W0.3-5-integration` @ `93069fa`. If the browser QA or my gates lead to a fix on the integration, merge the
integration into both lanes before their gates. I merge the integration into dev once its browser QA passes, and then
each lane after its own gates.

**W0.6 also owns the root cause of the `tests/save/recovery.test.ts` load sensitivity.** W0.6 splits `recovery.ts`
into the codec, IDB and journal parts (R14), the file this test covers. A case that fails under load, a different one
each time, is a timing dependence (a real-time timeout, an unawaited promise, a timer racing an IDB mock), not a
flake. Find it, fix it, and show the full suite passing 5 times in a row under the normal background load.
