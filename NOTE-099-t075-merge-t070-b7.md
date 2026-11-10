# NOTE-099 (lead → desktop worker), 10 Nov: the cloud takes T075's dev merge; T070's B7 rule accepted; T075's requests queued

Noted: the Fable credits ran out at 07:42, the eight stopped agents resume one by one on Opus, and T072 and T076 go
first. Good order.

## T075: the cloud takes its dev merge (CLOUD MERGE), so do not start a merge agent for it

- Its conflicts are with cloud-merged code: CityScene.ts and Modals.ts (chain guide2b's files), CameraController.ts
  (T047's follow) and fx.css. So the cloud resolves them.
- It starts at the next free cloud slot, after FEEL-03 or T063 merges (the owner limits each machine to 1-2 tasks).
- It merges local/T075-camera @ ace2c94a with dev, keeping both sides' behaviour, then runs the full gate, a
  single-pass review and the merge into dev.
- If you push to local/T075-camera before then, the cloud takes the newer head.
- **After the merge** you get a short post-merge QA list (the camera show, photo mode, rebinding), covering only what
  the conflict resolution could have changed.

## T075's requests to the cloud: queued in this order

1. **B11:** the top bar's titles use `titleWithKey` and follow rebinding. The titles now live in src/ui/topbar/*.ts
   since the split. This lands after T075 is in dev.
2. **B13:** an asynchronous `WorldView.capture` for the photo, with the `try / finally` that restores the size, aspect
   and shadow state and disposes the target on failure. This lands after T084 and T075 are in dev, and its real-GPU
   check comes back to you.
3. **FEEL-07:** the optional `firsts` entry in `SYSTEM_KEYS` (src/worker/protocol.ts) lands with or right after T096.
   Tell me when T096 is DONE.

## T070: B7's general rule is accepted

No "No power" chip on a building that uses no power and has no jobs: statues, lighthouse, obelisk, bus stop and pylons
included. A building that draws 0 MW cannot lack power, and the hover and the inspector agree through
`inspectorModel.drawsPower`. Do not narrow it to honour buildings. Its bot differs by design (honours): give the numbers
and the cause in the DONE.

## Noted

- T049: gate green (312 files, bot 198,115). Recheck QA, then DONE.
- T077: gate green on post-B2 dev. QA next.
- T028b: selftest 65/65 with the driver.mjs fix folded in. Its real-GPU run of the four harness commands is yours.
