# Agent Note: 桌面分发壳与 profile 插件

Status: implemented

[English](2026-08-20-desktop-distribution-shell-profile-plugins.md) | 中文

## Problem

希望在不安装 Node、不开终端的情况下使用 Web UI 的用户需要应用包，但桌面应用不能变成第二套 Harness 运行时，也不能成为内置产品插件的地方。桌面分发还需要发布产物、更新元数据、校验和发布、OSS 镜像路径和下载页，同时在桌面发布仓库存在之前，不能把仓库绑定到临时发布主机。

## Decision

`apps/desktop` 是一个私有 Electron workspace，用来承载现有 Web profile。应用会把构建后的 Harness 包暂存为本地 tarball，安装进应用自有的生产依赖树，打包 Node 运行时，并从 Electron main 启动 `dsh web --host 127.0.0.1 --port 0 --no-open`。它把 `dsh web:` 就绪行作为交接点，把该 loopback URL 加载进 BrowserWindow，并把外部导航留给系统浏览器。桌面壳只持有进程生命周期、加载/错误页、单实例锁、外部窗口策略、更新器控制通道和子进程环境脱敏；Web 运行时仍是应用所有者。这让桌面路径和 [`dsh web` 浏览器交接](2026-08-12-open-ready-web-ui.md) 保持分离，后者在 Electron 内通过 `--no-open` 关闭。

Profile 插件是第三方 registry 包，不是 Harness 包。启动时，桌面壳使用打包的 Node 运行时，并把打包的 `pnpm` 放到 `PATH` 上，通过 `dsh plugin --profile web add @prismshadow/dsh-deepseek-eyes@^0.1.3 @prismshadow/dsh-penguin-llm-router@^0.1.3` 确保桌面管理的包版本范围。确保步骤发生在 Web 子进程启动前，只跳过已经列在 profile 中且依赖规格满足桌面目标版本的插件，把 stdout/stderr 记入桌面日志，设置超时，超时后终止安装器进程树，并在失败时保持开放，所以应用仍可使用，并会在下次启动重试。除非后续桌面发布明确要随应用携带本地 bundle，`SHIPPED_PROFILE_BUNDLES` 保持为空；插件包源码不放在 `packages/` 下。

包含桌面管理插件的 profile 会使用更长的 `dsh web` 就绪等待时间，因为 Web bundle 只有在 Loader 树 settle 后才宣布就绪，而第三方 profile 行可能在打印 `dsh web:` URL 行之前增加冷启动工作。如果仍然超时，桌面壳会先记录子进程 pid、输出计数、最后一行输出和进程树终止结果，再显示启动失败。

桌面发布 workflow 会构建 Windows、macOS 和 Linux 安装包，把请求的桌面 tag 写入私有应用元数据，发布不可变 GitHub Release 产物，生成 `SHA256SUMS.desktop`，并把相同字节和更新元数据镜像到阿里云 OSS。`electron-builder.yml` 不写 GitHub owner 或 repository。发布构建从 `DSH_DESKTOP_UPDATE_BASE_URL` 传入 `generic` 发布 URL；公开 landing 页从 `VITE_DESKTOP_RELEASE_REPO_URL` 和 `VITE_DESKTOP_OSS_ORIGIN` 读取桌面 GitHub 与 OSS 下载来源。在这些值配置完成之前，下载 UI 可以构建，但不会输出过期发布链接。

## Alternatives considered

**把桌面插件打包进 Harness monorepo** — 否决，因为 Harness 的组合模型已经支持第三方 profile bundle。把插件包源码放在 `packages/` 下会让可选产品集成看起来像第一方能力，并把插件更新绑定到桌面发布。

**要求用户安装桌面应用后手动运行 `dsh plugin add`** — 否决，因为首次启动就应得到目标桌面 profile，而不是要求用户打开终端。桌面壳可以在 `dsh web` 启动前执行同一套官方 profile 变更，同时保留用户之后更新或移除这些插件的能力。

**把当前 fork 或源码仓库硬编码成桌面发布主机** — 否决，因为桌面发布仓库尚未建立。检入 owner/repo 会把临时运维选择泄露进 auto-update 元数据和公开下载链接。构建和站点环境变量让代码路径可测试，同时让主机选择保持显式。

**把 Web server 直接嵌进 Electron** — 否决，因为 Web profile、插件 loader、进程监督和 `dsh web` 就绪行为已经存在。复用 CLI 入口可以保持单一 Web 运行时，让桌面壳只持有桌面专属生命周期和打包职责。

## Consequences

桌面应用新增了依赖构建产物和本地 tarball 暂存的打包面，所以发布打包必须先构建 Harness，不能只通过编译 Electron 入口验证。首次启动或桌面管理插件版本变化时，可能因为 registry 插件安装而变慢；网络或 registry 失败会降级到当前 Web profile 并记录日志，而不是阻止应用启动。带有这些插件的 profile 在冷启动时也可能更晚输出就绪 URL，所以桌面壳会等待更久，并在失败时清理子进程树，避免留下迟到启动的 Web 进程。Auto-update 元数据会保持禁用，直到 updater 插件纳入；发布下载只要求公开镜像来源。Landing 构建有两个可选的桌面下载公开变量。
