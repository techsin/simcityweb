# local-T000-specs: local worker machine specs and GPU check

Collected 2026-10-26 (local evening, US Eastern). Nothing was installed or changed system-wide; the only file written in the
repo is this report. The Playwright check script lived outside the repo.

## 1. Machine

| | |
|---|---|
| OS | Windows 10 Education 10.0.19045 (build 19045), x64 |
| Form factor | Desktop (MSI MS-7E16 motherboard, `PCSystemType=1`), no battery, always on mains |
| CPU | AMD Ryzen 7 9800X3D, 8 cores / 16 threads |
| RAM | 61.6 GB total, 25.2 GB free at the time of the check |
| Disk | C: 743 GB free of 1244 GB (the clone is on C:) |

## 2. GPUs

| GPU | VRAM | Driver | Display |
|---|---|---|---|
| NVIDIA GeForce RTX 5070 Ti (PCI 0x2C05) | 15.9 GB | 32.0.16.1047 (NVIDIA 610.47) | Yes: 3840×2160 monitor attached |
| AMD Radeon Graphics (CPU iGPU) | 2 GB shared | 32.0.21030.2001 | No display attached |

Windows reports AdapterRAM as 4 GB for the NVIDIA card because that field is 32-bit. The 15.9 GB figure comes from the driver's
`qwMemorySize` registry value.

## 3. Tools

| Tool | Version |
|---|---|
| node | v22.12.0 |
| npm | 10.9.0 |
| git | 2.34.1.windows.1 |
| claude | 2.1.305 (Claude Code) |
| codex | codex-cli 0.163.0; `codex login status` → "Logged in using ChatGPT" |
| Playwright (repo) | 1.56.1, bundled Chromium 141.0.7390.37 |
| TypeScript (repo) | 7.0.2 |

## 4. Browser GPU check

Playwright `chromium.launch` with args `['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default']` and no
SwiftShader flags. The script creates a WebGL2 context and reads `WEBGL_debug_renderer_info`.

| Mode | WebGL2 | UNMASKED_RENDERER_WEBGL | Verdict |
|---|---|---|---|
| headless | yes | `ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 Ti (0x00002C05) Direct3D11 vs_5_0 ps_5_0, D3D11)` | Real GPU |
| headed | yes | same | Real GPU |

Chromium uses the discrete RTX 5070 Ti through ANGLE/D3D11 in both modes, not the AMD iGPU or SwiftShader. Headless runs need
no extra setup to measure on real hardware.

## 5. Speed sample (in the clone, warm `node_modules`)

| Command | Wall time | Result |
|---|---|---|
| `npx tsc --noEmit` | 1.5 s | exit 0, no errors |
| `npx vitest run tests/sim` | 6.4 s (vitest reports 5.62 s) | 241 passed, 3 skipped (244) |

## 6. Practical limits

- **Power:** a desktop on mains, so battery isn't a factor.
- **Sleep:** the "Balanced" plan puts the PC to sleep after **30 min** idle on AC. The display turns off after 10 min, and
  hibernate is off. I did not change these settings. To run for days, the owner must stop it sleeping (set sleep to Never, or
  run `powercfg /change standby-timeout-ac 0`). An active Claude/Playwright process may not hold the machine awake.
- **Clone:** `C:\Users\techsin\Desktop\projects\simcityweb`. `git status --short | wc -l` = 0 before this report. This is the
  owner's main project checkout, not a separate worker clone.
- **Time zone:** Eastern Standard Time (US Eastern).
- **Shared GPU:** the owner's main display runs on the same RTX card, so their own use can add noise to long benchmarks. For
  A/B work, keep runs interleaved and include A/A copies.
