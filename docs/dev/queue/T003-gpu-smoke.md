# T003-gpu-smoke: real-GPU smoke test of the current tree (Direct3D 11 through ANGLE)
base: claude/beautiful-johnson-u2jqoz at 41f8d85 or newer (work in the ..\simcityweb-worker worktree)
owns: docs/dev/reports/local-T003-gpu-smoke.md and docs/dev/reports/local-T003-gpu-smoke/ (small evidence only); no source edits
do:
  Why: players on Windows render through ANGLE/D3D11 on a real GPU; the cloud only has SwiftShader. Find what only shows up
  on real hardware. Read docs/dev/STATUS.md first.
  1. In the worktree: npm ci if needed; start your own vite server (npx vite --port 5199 --strictPort). Playwright chromium with
     args ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'] (real GPU); a reference run of the same views with
     ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] in the same browser build.
  2. Scenes: demo-city.html (dense city), demo-ui.html (game UI town), demo-world.html (terrain, water, trees), and the game
     itself (index.html): a city you make with `npx tsx tools/simbot.ts --size 256 --years 21 --seed 7 --save-years 21
     --save-prefix <dir>/vet_s7_` and import via Load Region → Import file… → Play (about 300k residents), plus a freshly
     founded small city. Find the quality and camera/time/season controls the pages and src expose (src/main.ts query
     params, src/render/world/quality.ts, the demo pages' query strings, tools/shoot*.mjs for examples).
  3. For each scene at LOW, HIGH and ULTRA, at 1920x1080 and 3840x2160: every console error/warning (shader compile or link
     errors, 'WebGL: INVALID_*', context lost, NaN warnings), screenshots (street, default and far zoom; day and night;
     January and June), and frame timing from requestAnimationFrame intervals over 30 s idle and over a scripted 20 s camera
     sequence (pan, zoom-out, zoom-in, orbit): p50/p95/p99 frame ms and the number of frames over 16.7 / 33 ms. Add
     renderer.info draw calls/triangles if a page exposes them.
  4. Look at every screenshot. Flag anything that looks wrong on the real GPU (missing/black meshes, shadow acne or peter-
     panning, z-fighting, flicker between frames, wrong colours, aliasing, water/sky artefacts, fog banding), using the
     SwiftShader reference pair: differences beyond normal precision are findings.
  5. Optional: ask Codex for an independent look at the screenshot pairs (codex exec, attaching images if it supports that)
     and check every claim it makes yourself; say which findings came from Codex.
gates: no source changes; at most ~30 small PNGs (downscale 4K shots) under the report folder, bulky evidence outside git;
  stop every browser and server you started.
report: docs/dev/reports/local-T003-gpu-smoke.md: findings (blocker/major/minor, evidence paths, suggested fix), the frame-time
  table per scene × quality × resolution, renderer string, browser/driver versions, run times. Push local/T003-gpu-smoke
  (with docs/dev/queue/T003-gpu-smoke.done), then: claude -p "DONE T003 local/T003-gpu-smoke@<sha> report: docs/dev/reports/local-T003-gpu-smoke.md" --cloud session_01KT9tXthEhyzExdUuGEecAJ
  Send PROGRESS lines the same way at most every hour if it runs long.
