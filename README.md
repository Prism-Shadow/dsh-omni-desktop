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

## Plugin npm Release

The desktop-managed profile plugins live under `overlays/deepseek-harness/plugins/` and are published as normal public npm packages. The desktop app installs them into the user's `web` profile with `dsh plugin add`; the plugin source is not bundled into the harness runtime.

Before the first real publish from this repository, configure npm Trusted Publishing for both packages:

- `@prismshadow/dsh-deepseek-eyes`
- `@prismshadow/dsh-penguin-llm-router`

Use these npm Trusted Publisher settings for each package:

- Publisher: GitHub Actions
- Organization or user: `Prism-Shadow`
- Repository: `dsh-omni-desktop`
- Workflow filename: `plugin-release.yml`
- Environment name: `npm-production`
- Allowed actions: `npm publish`

The workflow supports a safe dry run:

```text
Actions -> Plugin Release -> Run workflow -> dryRun=true
```

To publish, bump the selected plugin `version`, update the desktop profile plugin reference in `overlays/deepseek-harness/apps/desktop/src/main.ts`, merge the PR to `main`, then run the same workflow from `main` with `dryRun=false`. The workflow checks that the desktop install range matches each plugin package version before it publishes.

## Updating Upstream

```powershell
git -C deepseek-harness fetch origin master
git -C deepseek-harness checkout origin/master
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-harness.ps1 -Force
```

Review overlay conflicts in `.work/deepseek-harness`, then commit the updated submodule pointer and any overlay changes together.
