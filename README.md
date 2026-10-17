# Reading Progress Sync Bridge

[中文介绍](#中文介绍) · [English](#english) · [Obsidian 社区 / Community](https://community.obsidian.md/plugins/reading-progress-sync-bridge) · [GitHub Releases](https://github.com/DLf2001/reading-progress-sync-bridge/releases/latest)

## 中文介绍

在多台电脑之间同步 Obsidian 的 Markdown 阅读进度，换一台电脑也能接着阅读。本插件连接 **Remember cursor position** 与 **Remotely Save**，按最后阅读更新时间合并位置，并处理进度冲突。

**每台电脑都需要安装并启用这三个插件：Remember cursor position、Remotely Save 和 Reading Progress Sync Bridge。** 前者负责记录与恢复位置，Remotely Save 负责云端同步，本插件负责进度合并、核对和完成提示。

版本 0.1.1。基准环境：Obsidian 1.14.4、Remember cursor position 1.0.16、Remotely Save 0.5.25。

由 [DLf2001](https://github.com/DLf2001) 维护的独立第三方插件，与 Obsidian、Remember cursor position 和 Remotely Save 官方无隶属关系。支持桌面版 Obsidian 1.14.4 及以上，可从 [Obsidian 社区页面](https://community.obsidian.md/plugins/reading-progress-sync-bridge) 安装。

## 主要功能

- **多电脑阅读接力**：每台设备保存独立进度记录，通过同一个远程知识库交换。
- **按最后阅读时间合并**：采用更新时间更晚的位置，而不是读得最远的位置，支持向前翻阅后继续接力。
- **自动联动同步**：连接 Remotely Save 的手动、定时、启动和保存触发同步，同步前导出、成功后核对并合并。
- **冲突与异常处理**：同一时间但位置不同的记录由用户选择，异常数据和明显超前的设备时间不会直接覆盖进度。
- **位置恢复与备份**：配合 Remember cursor position 恢复位置，支持同步后立即跳转，导入前备份本机进度。
- **2 秒完成提示**：同步完成、手动跳转完成时显示应用内小提示；同步后立即跳转时合并为一条提示。

## 工作方式

1. 每台电脑生成独立设备 ID，保存在 Obsidian 本机存储，不把 ID 放入共享设置文件。
2. 每台电脑只写 `阅读进度同步/devices/<设备ID>.json`，不共同修改一个共享数据库。
3. Remotely Save 开始前，保存原插件内存中的实际阅读位置，等待磁盘写入，再导出。
4. Remotely Save 成功回调确认后，回读核对本机导出文件，再读取下载的其他设备记录。
5. 每篇笔记按 `lastModified`（实际阅读位置的最后更新时间）采用最新记录。同步时间、笔记正文修改时间不作为阅读时间。
6. 自动恢复的相同位置不再发布新时间。同一位置重复同步不会改变导出文件内容。
7. 时间相同但位置不同，提示人工选择；超过本机时间五分钟的记录暂停自动采用，并在设置里提示校时。
8. 导入前备份原位置数据库；同步失败不导入其他设备进度。

所有电脑需开启系统自动校时。五分钟以内的时钟误差无法仅靠时间戳识别，最新时间优先不等于能推断真实的人类操作顺序。

## 安装与多电脑配置

### 从社区安装（推荐）

1. 在 Obsidian 的「设置 → 第三方插件 → 浏览」中搜索 **Reading Progress Sync Bridge**，安装并启用。
2. 也可以打开 [社区插件页面](https://community.obsidian.md/plugins/reading-progress-sync-bridge)，点击 **Add to Obsidian**，在 Obsidian 中安装并启用。
3. 安装并启用 **Remember cursor position** 和 **Remotely Save**。

### 手动安装

从 [GitHub Releases](https://github.com/DLf2001/reading-progress-sync-bridge/releases/latest) 下载同一版本的 `main.js`、`manifest.json`、`styles.css`，放入：

```
<知识库>/.obsidian/plugins/reading-progress-sync-bridge/
```

重启 Obsidian，在第三方插件中启用 **Reading Progress Sync Bridge**。上述两个依赖插件也需安装并启用。

### 多电脑配置

每台电脑都重复安装步骤，在本插件设置中给设备设置易区分的名称。

Remotely Save 必须连接同一个远程知识库，使用**双向同步**，并允许同步 `阅读进度同步/` 下的 JSON 文件。不要将原插件的数据文件路径改到共享目录；保持默认 `.obsidian/plugins/remember-cursor-position/cursor-positions.json`。桥接插件负责把合并结果写回这个本机数据库。

如启用了 Remotely Save 的配置目录同步，请在桥接设置里点击“添加排除规则”，精确排除原位置数据库和桥接插件的 `local/`、`backups/` 子目录，避免旧数据库直接覆盖合并结果；不会关闭其他配置同步。

先执行“导出并检查”，再像往常一样使用 Remotely Save。手动同步、定时同步、启动同步都会联动；空跑不导出或合并进度。

## 使用

- 默认同步后不打断当前阅读；下次打开笔记由 Remember cursor position 恢复位置。
- 希望立刻跳转，可执行命令“恢复当前笔记的已合并阅读位置”，或开启设置中的同步后跳转。
- 状态栏区分等待连接、正在核对、核对完成、异常、冲突及待下次上传。
- 同步完成或手动跳转完成后显示应用内小提示，2 秒后自动消失；同步后立即跳转时合并为一条提示。异常和冲突继续使用原有提醒。
- 同步过程中继续阅读的新位置，或手动解决冲突的结果，标为待上传，**下次**同步发送。
- 时间相同的位置冲突，在“查看冲突”中选择设备记录。此选择会生成新的更新时间，代表这次人为确认。
- 数据异常只跳过有问题的设备文件，不修改或删除它。

## 数据和恢复

共享记录只包含笔记相对路径、光标/滚动位置、阅读时间和设备名称，不含正文或密钥。文件名仍能反映阅读了哪些笔记；由现有 Remotely Save 的云服务和加密设置负责传输。本插件不自行发起网络请求，不读取云服务凭据，不连接 AI。

本机合并基线：`.obsidian/plugins/reading-progress-sync-bridge/local/<设备ID>/state.json`。

导入前备份：`.obsidian/plugins/reading-progress-sync-bridge/backups/<设备ID>/positions-*.json`。备份不会自动清理。恢复时先关闭桥接和 Remember cursor position，备份当前数据库，再将所需备份复制到原插件数据路径，重新启用插件。

停用桥接插件会恢复依赖插件原来的运行时方法，不改写依赖插件的 `main.js`。已导入的进度数据保留。

## 兼容说明

本插件使用两个依赖的非公开运行时接口：`syncRun`、`updateLastSyncMsg`、位置数据库及写入方法。依赖升级可能需要对应的兼容更新。

“核对完成”表示 Remotely Save 报告成功、本机导出文件回读一致，并且下载记录已校验合并。

当前支持桌面版 Markdown，不支持 PDF 或手机端。采用笔记相对路径匹配，不自动合并不同文件名的笔记。Markdown 内容和窗口尺寸变化后，恢复位置可能有偏差。

采用 MIT 许可证；作者 DLf2001。

## English

Sync Markdown reading positions across multiple computers by connecting **Remember cursor position** and **Remotely Save**. Each device writes its own progress file; the latest actual reading timestamp wins, even if that reader moved backward. Different positions with the same timestamp require a manual choice.

**Install and enable all three plugins on every computer: Remember cursor position, Remotely Save, and Reading Progress Sync Bridge.** Remember cursor position records and restores positions, Remotely Save handles cloud synchronization, and this bridge merges progress, checks records, and shows completion notices.

### Features

- **Multi-computer reading handoff:** exchange independent per-device progress records through the same remote vault.
- **Latest reading time wins:** adopt the most recently updated position, not the farthest position, including when you move backward in a note.
- **Automatic sync integration:** connect to manual, scheduled, startup, and save-triggered Remotely Save runs; export before syncing and check and merge afterward.
- **Conflict and anomaly handling:** manually choose between different positions with equal timestamps; skip malformed records and clearly future-dated timestamps.
- **Restoration and backups:** restore with Remember cursor position, optionally jump after syncing, and back up local positions before importing changes.
- **Two-second completion notices:** show an in-app notice after syncing or manually restoring a position, with one combined notice for sync followed by immediate restoration.

### Requirements

- Obsidian Desktop 1.14.4 or later. Mobile and PDF are not supported in this release.
- Remember cursor position 1.0.16 and Remotely Save 0.5.25, installed and enabled.
- Remotely Save configured for bidirectional synchronization to the same remote vault on every computer, including the `阅读进度同步/` folder.

### Installation

**Community installation (recommended):** open **Settings → Community plugins → Browse**, search for **Reading Progress Sync Bridge**, then install and enable it. Alternatively, open the [community listing](https://community.obsidian.md/plugins/reading-progress-sync-bridge) and select **Add to Obsidian**. Also install and enable **Remember cursor position** and **Remotely Save**.

**Manual installation:** download `main.js`, `manifest.json`, and `styles.css` from the same [GitHub release](https://github.com/DLf2001/reading-progress-sync-bridge/releases/latest), put them in `<vault>/.obsidian/plugins/reading-progress-sync-bridge/`, restart Obsidian, and enable the plugin together with its two dependencies.

### Multi-computer setup and usage

Repeat installation on every computer and configure Remotely Save for bidirectional synchronization to the same remote vault. Settings and notices currently use Simplified Chinese. Give each computer a distinct device name. Device IDs are stored locally, not in shared plugin settings. Use the local export-and-check action, then synchronize with Remotely Save as usual.

The bridge exports saved positions before synchronization and validates and merges downloaded device records after Remotely Save reports success. It backs up the local position database before import. Failed synchronization does not import remote progress. By default, the current page does not jump; reopen the note or use the restore-current command. Changes made during a transfer are preserved for the next synchronization.

Successful synchronization and manual position restoration show an in-app notice for two seconds. Synchronization followed by immediate restoration uses one combined notice. Errors and conflicts keep their existing alerts.

If configuration-directory synchronization is enabled, use the bridge's exclusion-rule button to exclude the original position database and this plugin's local state and backups. Keep the original position database in its default plugin directory. Enable automatic clock synchronization on every computer; timestamps alone cannot resolve small clock skew.

### Privacy and compatibility

This plugin makes no network requests, reads no service credentials, collects no telemetry, and accesses no files outside the vault. Shared records contain note paths, positions, device names, and reading timestamps, not note contents. Those metadata are synchronized through the service and encryption settings you configure in Remotely Save. A remote service may require an account or payment; this bridge itself is free.

The integration wraps non-public runtime methods and restores them when disabled, without modifying dependency source files. Dependency updates may require compatibility changes. The synchronization check covers the sync result callback, local file readback, and downloaded record validity. Keep backups. Notes are matched by relative path; renaming notes or changing their content or window layout can affect position matching and restoration.

This independent companion plugin is maintained by [DLf2001](https://github.com/DLf2001), is not affiliated with Obsidian or its dependencies, and is licensed under [MIT](LICENSE).
