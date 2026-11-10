# T081-readme: the release README and build notes (#29), docs only
base: dev 146c885; branch local/T081-readme
owns: README.md (the repository root); docs/BUILD.md if build notes need their own page. No source, test or tool
  changes.
do:
  Draft README.md for the playable build:
  - what Metropolis is, how to run and build it (the npm scripts as package.json has them), system requirements
    (WebGL2, the browsers and GPUs the project tests on, as the docs say);
  - the controls and keys (from src/game/bindings or the key handling code and the in-game help, not from memory),
    and the main features: the region map, emergencies with manual dispatch, the soundtrack, New Year fireworks,
    cities past 1M residents, difficulty levels, saving and export;
  - the settings, including the worker opt-in `?simworker=1` (until W1.4 makes it the default) and the other URL
    parameters a player may use, and known limits.
  Take every fact from docs/ and the code, and cite nothing you did not find there. Leave final numbers (frame
  rates, soak hours, save sizes, the version) as `TODO(release)` markers: the lead fills them at release. Plain,
  short sentences; no marketing voice; no emoji. If a README.md already exists, keep what is still true.
gates:
  - Every command in the README runs as written (check the npm scripts exist; do not run long ones).
  - Every key and setting named exists in the code (give the file for each in the report).
report: docs/dev/reports/local-T081-readme.md (the sources for each section, and the list of TODO(release) markers).
