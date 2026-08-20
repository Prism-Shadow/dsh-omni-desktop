# dsh omni desktop

中文 | [English](README.en.md)

dsh omni desktop 是面向普通用户的 DeepSeek Harness 桌面发行版。下载安装后即可在桌面窗口中使用 DeepSeek Harness 的本地 Web UI、会话、工作区和插件能力，无需手动准备 Node.js 或命令行启动流程。

![dsh omni desktop screenshot](assets/readme/desktop-vision-demo.png)

## 下载

推荐从 GitHub Releases 下载桌面安装包：

- [GitHub Releases](https://github.com/Prism-Shadow/dsh-omni-desktop/releases)

这是桌面端的 GitHub 源下载入口，也适合作为 OSS 或官网镜像不可用时的备用下载来源。

当前发布流程会产出这些桌面端文件，实际可下载内容以对应 Release 页面为准：

| 平台 | 安装包 |
| --- | --- |
| Windows x64 | `.exe` 安装程序 |
| macOS Universal | `.dmg` 和 `.zip` |
| Linux x64 | `.AppImage` 和 `.deb` |

如果 Release 同时提供 OSS 或官网镜像下载，任选一个来源下载即可；文件内容应与 GitHub Release 中的发布产物一致。

## 安装与首次启动

1. 从 GitHub Releases 下载适合你系统的安装包。
2. 按系统提示完成安装。
3. 启动 dsh omni desktop。
4. 选择或创建工作区。
5. 新建会话并开始使用。

首次启动时，桌面端会用 DeepSeek Harness 官方的 `dsh plugin add` 方式，把桌面托管的第三方插件安装到用户的 `web` profile 中。插件源码不打进 Harness runtime；它们以公开 npm 包的形式发布和更新。

## 日常使用

- **工作区**：在侧边栏选择或新建工作区，会话记录按工作区组织。
- **新会话**：点击 `New Session` 开始一次新的任务。
- **模型选择**：在输入框右侧选择当前会话使用的模型。
- **图片理解**：粘贴或上传图片后，视觉插件会把图片交给已配置的视觉模型并返回说明。
- **会话日志**：右上角 `Session log` 可下载当前会话日志，便于排查问题。
- **设置**：左下角 `Settings` 中管理桌面端配置和平台账号状态。

## 内置托管插件

桌面端首次启动会自动安装这些 npm 插件：

| 插件 | npm 包 | 作用 |
| --- | --- | --- |
| DeepSeek Eyes | [`@prismshadow/dsh-deepseek-eyes`](https://www.npmjs.com/package/@prismshadow/dsh-deepseek-eyes) | 提供 `describe_image` 图片理解工具 |
| Penguin LLM Router | [`@prismshadow/dsh-penguin-llm-router`](https://www.npmjs.com/package/@prismshadow/dsh-penguin-llm-router) | 提供平台登录、模型路由和账号状态集成 |

如果自动安装失败，请查看桌面日志。Windows 上日志通常位于：

```text
%APPDATA%\DeepSeek Harness\desktop.log
```

## 常见问题

### 这是 DeepSeek Harness 官方桌面端吗？

不是。dsh omni desktop 是社区维护的桌面发行项目，用于打包和分发基于 DeepSeek Harness 的桌面体验。它与深度求索及 DeepSeek Harness 上游官方团队不存在隶属、合作、授权或背书关系。

### dsh omni desktop 和 DeepSeek Harness 是什么关系？

DeepSeek Harness 提供核心智能体能力、Web UI、会话系统和插件机制。dsh omni desktop 跟踪上游 DeepSeek Harness 源码，并在打包时应用桌面端 overlay，负责桌面窗口、安装包、发布流程和桌面托管插件。

上游项目地址：

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)

### 插件为什么不是直接写进 Harness？

这两个插件按第三方插件发布到 npm。桌面端只负责在用户首次启动时用官方插件安装流程安装它们。这样插件可以独立发布，桌面端也可以在后续 release 中选择是否更新安装版本。

### 能从 GitHub 下载吗？

可以。桌面端安装包会发布到本仓库的 [GitHub Releases](https://github.com/Prism-Shadow/dsh-omni-desktop/releases)。如果同时提供其他镜像，GitHub Releases 仍然是最直接的下载源之一。

## 给维护者

本仓库只保存桌面发行相关内容：

- `deepseek-harness/`：上游 DeepSeek Harness 子模块
- `overlays/deepseek-harness/`：应用到上游 checkout 的桌面发行 overlay
- `overlays/deepseek-harness/apps/desktop/`：桌面壳 overlay
- `overlays/deepseek-harness/plugins/`：桌面托管插件源码
- `scripts/sync-harness.ps1`：同步上游并应用 overlay
- `scripts/package-desktop.ps1`：本地 Windows 打包脚本
- `.github/workflows/`：桌面构建、Release、OSS 和 npm 插件发布工作流

本地同步：

```powershell
git submodule update --init --recursive
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-harness.ps1 -Force
```

本地 Windows 打包：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-desktop.ps1
```

生成的安装包会输出到脚本打印的目录，通常是：

```text
.work/package/<run>/apps/desktop/stage/out/
```

## 许可证与商标

本项目基于 [MIT License](LICENSE) 开源发布。

文档中提到 “DeepSeek Harness”，仅用于说明本桌面发行版所兼容和引用的上游开源项目；相关名称和商标归其权利人所有。

dsh omni desktop 由社区独立维护，不代表深度求索或 DeepSeek Harness 上游团队，也不表示本项目获得其官方授权或推荐。
