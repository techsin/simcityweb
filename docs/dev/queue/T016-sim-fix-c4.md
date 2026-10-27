# T016-sim-fix-c4: close-out fix round 4 on this machine (the exit leak only this machine reproduces, plus 5 minors)
base: 5a16942 (the commit check 3 reviewed); branch local/T016-sim-fix-c4
after: T013's tie-break repro (fold its result into this round). Priority: right after T013, before T015's timing runs:
  the close-out is the longest chain to the finish.
owns: src/sim/economy/desirability.ts and landValue.ts (the breakdown contexts); src/game/CityScene.ts and the other
  teardown paths in src/game/** (including src/game/fallback/**); src/ui/** (EmergencyBanner.ts, thumbs.ts, InfoPanel.ts
  and whatever the leak needs); tests outside tests/render/**. In src/render, teardown-only edits (dispose and release
  paths; nothing drawn and nothing per-frame changes). Graphics revision 2 is editing src/render right now, including
  BuildingRenderer.ts, so keep any render hunk to a few lines in dispose paths and say exactly which.
do:
  Why: check 3 on this machine (docs/dev/reports/local-T013-playtest-c3.md, local-T013-audit-c3.md) found 1 MAJOR and 5
  minors. The cloud fix engineer's own probes never reproduced the major, so the fix has to be made where it
  reproduces. Read both reports in full first, then docs/dev/reports/simB-close_fix-c2.md (what fix c2 changed).
  You are the fix engineer for this round. A sub-agent of yours may do the work; Codex may write well-specified parts.
  Whoever fixes, the check after it (T017) is done by fresh reviewers.

  MAJOR: after one growable inspection, exit to region keeps the whole previous city alive (+1 city per visit). The
  playtester's heap snapshots show:
  - the dead graph is reached only through '(Traced handles)' wrapper roots;
  - it includes a DOMException, the reason of an AbortSignal, whose CallSiteInfo holds the CityScene;
  - also the AbortController and its signal, 4 ResizeObservers, 1 MutationObserver, 1 <img>, 2 PointerEvents, the
    city's WebGL2 context, and one detached 'mp-scene' tree per leaked city.

  Fix it at the root and also make the teardown robust:
  (a) The breakdown contexts (TermCtx / LvCtx in desirability.ts / landValue.ts) must not outlive the call. Allocate
      them per call, or clear st, rt and traffic after use.
  (b) CityScene.dispose breaks every path from DOM- or Blink-held objects to the city:
      - remove or abort every listener the scene and HUD registered;
      - the guardSystem wrappers stop closing over the scene (a disposed flag);
      - null the scene's big fields.
  (c) Every abort in teardown passes a plain string reason (controller.abort('dispose')), so no DOMException with a
      captured stack keeps frames alive.
  (d) A browser-level gate that reproduces the playtester's setup:
      - steps: query one growable, Esc, Save & exit, GC;
      - CityScene and CityState must be 0 at +3 s, for 3 cycles;
      - both in a freshly launched browser per run AND in one long-running browser with a persistent profile;
      - coordinate clicks only, and an objectGroup on every CDP call that returns objects (the auditor's probe
        pitfall: a Playwright locator click on HUD elements alone can pin the city).
      Find the Blink-side owner if you can (headed DevTools retainers with weak/internal shown, or exposeInternals
      snapshots) and name it in the report.

  Minors, each at the root:
  1. The city stays alive 1-3 s after exit when a dispatch ran just before: add cancel(owner) to the shared LOD builder,
     called from BuildingRenderer.dispose (teardown-only; see owns).
  2. The EmergencyBanner settle-guard slot ignores height changes of banners above: add each shown banner's measured
     height to the signature, or fix the comment if the behaviour is right.
  3. The fallback 3D view keeps each disposed WebGLRenderer and GL context: per-view geometry and material clones as
     thumbs.ts does, and renderer.forceContextLoss() in FallbackWorldView.dispose.
  4. Toolbar and inspector thumbnail renderers survive their 15 s idle dispose and pile up within a city session.
  5. At 1024x600 the emergency stack covers a centred Budget panel's body and tax sliders.
gates:
  - npx tsc --noEmit clean;
  - npx vitest run passes;
  - the 128x15 seed-7 bot bit-identical (194,432 in 2015);
  - old saves load and continue;
  - a failing-then-passing test per item where practical (the WeakRef retention tests did not reproduce the browser:
    add the browser gate (d) as a script in the repo, e.g. tools/leakprobe/, with a README);
  - real-input browser evidence and screenshots you looked at, at 1024x600, 1280x720 and 1366x650.
report: docs/dev/reports/local-T016-sim-fix-c4.md (per item: root cause, files and lines, evidence, what is left open;
  the Blink-side owner if found; which hunks touch src/render); push local/T016-sim-fix-c4; DONE. The lead then queues
  check 4 (T017) for fresh reviewers here.
