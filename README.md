# DSH Omni Desktop

DSH Omni Desktop is the desktop distribution repository for DeepSeek Harness.
The upstream harness source is tracked as the `deepseek-harness/` submodule,
while desktop distribution files live in `overlays/deepseek-harness/`.

## Repository Layout

- `deepseek-harness/` is the upstream `deepseek-ai/deepseek-harness` submodule.
- `overlays/deepseek-harness/` contains desktop, landing, plugin, workflow, and release files that are applied over upstream for builds.
- `scripts/sync-harness.ps1` creates `.work/deepseek-harness` from the submodule and applies the overlay.
- `scripts/package-desktop.ps1` syncs the workspace and builds the Windows desktop installer locally.

## Local Packaging

```powershell
git submodule update --init --recursive
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-desktop.ps1
```

The generated Windows installer is written under the printed `.work/package/<run>/apps/desktop/stage/out/` path.

## Updating Upstream

```powershell
git -C deepseek-harness fetch origin master
git -C deepseek-harness checkout origin/master
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-harness.ps1 -Force
```

Review overlay conflicts in `.work/deepseek-harness`, then commit the updated submodule pointer and any overlay changes together.
