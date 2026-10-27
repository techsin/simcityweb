# T000-specs: report this computer's specs and what it can run
base: claude/beautiful-johnson-u2jqoz (any recent commit)
owns: docs/dev/reports/local-T000-specs.md only; change nothing else
do: Collect and report, without installing or changing anything system-wide:
  1. OS and version; CPU model, cores/threads; RAM total and free; disk free on the clone's drive.
  2. GPU(s): model, VRAM, driver version; display attached or not.
  3. Tool versions: node -v, npm -v, git --version, claude --version, codex --version (and whether Codex is logged in,
     e.g. `codex login status` if that exists — do not log in or change anything).
  4. Browser GPU check from the clone: a tiny Playwright script that launches chromium headless and then headed (if a
     display exists) with hardware acceleration (no SwiftShader flags; try args ['--enable-gpu', '--ignore-gpu-blocklist',
     '--use-angle=default']), creates a WebGL2 context and prints the WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL
     string. Say whether it is a real GPU or SwiftShader/llvmpipe in each mode.
  5. A quick speed sample: time `npx tsc --noEmit` and `npx vitest run tests/sim` in the clone.
  6. Practical limits: laptop or desktop, on battery or mains, sleep settings, whether it can keep running for days,
     the clone's path and `git status --short | wc -l`, the local time zone.
gates: nothing installed or changed outside the report file; no secrets, tokens or personal data in the report
report: docs/dev/reports/local-T000-specs.md on branch local/T000-specs (push it), then notify the lead:
  claude -p "DONE T000 local/T000-specs@<sha> report: docs/dev/reports/local-T000-specs.md" --cloud session_01KT9tXthEhyzExdUuGEecAJ
