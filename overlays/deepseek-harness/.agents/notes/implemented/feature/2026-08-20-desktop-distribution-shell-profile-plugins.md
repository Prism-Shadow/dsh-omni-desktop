# Agent Note: Desktop distribution shell and profile plugins

Status: implemented

English | [中文](2026-08-20-desktop-distribution-shell-profile-plugins.zh.md)

## Problem

Users who want the Web UI without installing Node or running a terminal need an application bundle, but a desktop app must not become a second Harness runtime or a place to vendor product plugins. The desktop distribution also needs release assets, update metadata, checksum publication, an OSS mirror path, and a download page without binding the repository to a temporary release host before the desktop release repository exists.

## Decision

`apps/desktop` is a private Electron workspace that hosts the existing Web profile. The app stages the built Harness packages as local tarballs, installs them into an app-local production tree, bundles a Node runtime, and starts `dsh web --host 127.0.0.1 --port 0 --no-open` from Electron main. It treats the `dsh web:` readiness line as the handoff point, loads that loopback URL into the BrowserWindow, and keeps external navigation in the system browser. The desktop shell owns only process lifetime, the loading/error pages, the single-instance lock, the external-window policy, the updater control channel, and the child environment scrubber; the Web runtime remains the application owner. This keeps the desktop path separate from the [`dsh web` browser handoff](2026-08-12-open-ready-web-ui.md), which is disabled inside Electron with `--no-open`.

Profile plugins are third-party registry packages, not Harness packages. On startup, the shell ensures the desktop-managed package ranges with `dsh plugin --profile web add @prismshadow/dsh-deepseek-eyes@^0.1.3 @prismshadow/dsh-penguin-llm-router@^0.1.3` using the bundled Node runtime and a bundled `pnpm` on `PATH`. The ensure step happens before the Web child starts, skips only plugins already listed in the profile whose dependency range satisfies the desktop target, logs stdout/stderr to the desktop log, times out, terminates the installer process tree, and fails open so the app remains usable and retries on the next launch. `SHIPPED_PROFILE_BUNDLES` stays empty unless a later desktop release deliberately ships an app-local bundle; plugin package source does not live under `packages/`.

Profiles containing desktop-managed plugins get a longer `dsh web` readiness budget because the Web bundle announces readiness only after its Loader tree settles, and third-party profile rows can add cold-start work before the `dsh web:` URL line is printed. If readiness still times out, the shell logs the child pid, output counters, the last observed line, and the process-tree termination result before showing the startup failure.

The desktop release workflows build Windows, macOS, and Linux installers, stamp the requested desktop tag into the private app metadata, publish immutable GitHub Release assets, generate `SHA256SUMS.desktop`, and mirror the same bytes plus update metadata to Alibaba Cloud OSS. `electron-builder.yml` does not name a GitHub owner or repository. Release builds pass a `generic` publish URL from `DSH_DESKTOP_UPDATE_BASE_URL`, and the public landing page takes its desktop GitHub and OSS download origins from `VITE_DESKTOP_RELEASE_REPO_URL` and `VITE_DESKTOP_OSS_ORIGIN`. Until those values are configured, the download UI builds but does not emit stale release links.

## Alternatives considered

**Bundle the desktop plugins into the Harness monorepo** — rejected because the Harness composition model already supports third-party profile bundles. Keeping plugin package source under `packages/` would make optional product integrations look first-party and would couple plugin updates to desktop releases.

**Require users to run `dsh plugin add` after installing the desktop app** — rejected because first launch should produce the intended desktop profile without a terminal. The shell can perform the same official profile mutation before `dsh web` starts while preserving the user's ability to update or remove those plugins later.

**Hard-code the current fork or source repository as the desktop release host** — rejected because the desktop release repository is not established. A checked-in owner/repo would leak a temporary operational choice into auto-update metadata and public download links. Build and site environment variables keep the code path testable while leaving the host selection explicit.

**Embed the Web server directly inside Electron** — rejected because the Web profile, plugin loader, process supervision, and `dsh web` readiness behavior already exist. Reusing the CLI entry keeps one Web runtime and lets the desktop shell own only desktop-specific lifecycle and packaging.

## Consequences

The desktop app gains a packaging surface that depends on built artifacts and local tarball staging, so release packaging must build Harness first and cannot be validated by compiling the Electron entry alone. First launch or a managed plugin version change may take longer while registry plugins install; network or registry failure degrades to the current Web profile and records a log line instead of blocking the app. A profile with these plugins can also take longer to emit the readiness URL on cold start, so the desktop shell waits longer and tears down the child tree on failure rather than leaving a late-starting Web process behind. Auto-update metadata and download links remain disabled until the release repository and public mirror origin are configured. The release workflow therefore has one required operational variable, `DSH_DESKTOP_UPDATE_BASE_URL`, and the landing build has two optional public variables for desktop downloads.
