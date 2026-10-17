# Reading Progress Sync Bridge

独立连接 **Remember cursor position** 与 **Remotely Save**，同步 Markdown 阅读进度并核对冲突。

本地测试版 0.1.0。基准环境：Obsidian 1.14.4、Remember cursor position 1.0.16、Remotely Save 0.5.25。

由 [DLf2001](https://github.com/DLf2001) 维护的独立第三方插件，与 Obsidian、Remember cursor position 和 Remotely Save 官方无隶属关系。当前发布仅支持桌面版 Obsidian 1.14.4 及以上。发布到 GitHub 不表示已经通过 Obsidian 社区审核。

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

每台电脑均需安装并启用上述两个依赖及本插件。将本项目 `main.js`、`manifest.json`、`styles.css` 放入：

```
<知识库>/.obsidian/plugins/reading-progress-sync-bridge/
```

重启 Obsidian，在第三方插件中启用 **Reading Progress Sync Bridge**。在设置中给每台电脑设置易区分的名称。

三个安装文件可从 [GitHub Releases](https://github.com/DLf2001/reading-progress-sync-bridge/releases/latest) 下载。社区审核通过前请使用手动安装，不要假设已能在社区插件列表中搜索到。

Remotely Save 必须连接同一个远程知识库，使用**双向同步**，并允许同步 `阅读进度同步/` 下的 JSON 文件。不要将原插件的数据文件路径改到共享目录；保持默认 `.obsidian/plugins/remember-cursor-position/cursor-positions.json`。桥接插件负责把合并结果写回这个本机数据库。

如启用了 Remotely Save 的配置目录同步，请在桥接设置里点击“添加排除规则”，精确排除原位置数据库和桥接插件的 `local/`、`backups/` 子目录，避免旧数据库直接覆盖合并结果；不会关闭其他配置同步。

先执行“导出并检查”，再像往常一样使用 Remotely Save。手动同步、定时同步、启动同步都会联动；空跑不导出或合并进度。

## 使用

- 默认同步后不打断当前阅读；下次打开笔记由 Remember cursor position 恢复位置。
- 希望立刻跳转，可执行命令“恢复当前笔记的已合并阅读位置”，或开启设置中的同步后跳转。
- 状态栏区分等待连接、正在核对、核对完成、异常、冲突及待下次上传。
- 同步过程中继续阅读的新位置，或手动解决冲突的结果，标为待上传，**下次**同步发送。
- 时间相同的位置冲突，在“查看冲突”中选择设备记录。此选择会生成新的更新时间，代表这次人为确认。
- 数据异常只跳过有问题的设备文件，不修改或删除它。

## 数据和恢复

共享记录只包含笔记相对路径、光标/滚动位置、阅读时间和设备名称，不含正文或密钥。文件名仍能反映阅读了哪些笔记；由现有 Remotely Save 的云服务和加密设置负责传输。本插件不自行发起网络请求，不读取云服务凭据，不连接 AI。

本机合并基线：`.obsidian/plugins/reading-progress-sync-bridge/local/<设备ID>/state.json`。

导入前备份：`.obsidian/plugins/reading-progress-sync-bridge/backups/<设备ID>/positions-*.json`。备份不会自动清理。恢复时先关闭桥接和 Remember cursor position，备份当前数据库，再将所需备份复制到原插件数据路径，重新启用插件。

停用桥接插件会恢复依赖插件原来的运行时方法，不改写依赖插件的 `main.js`。已导入的进度数据保留。

## 验证边界

本插件使用两个依赖的非公开运行时接口：`syncRun`、`updateLastSyncMsg`、位置数据库及写入方法。依赖更新后需重新验证。插件会检查接口是否存在，但不能保证未来版本的语义不变。

“核对完成”表示 Remotely Save 报告成功、本机导出文件回读一致，并且下载记录已校验合并；**不表示独立从云端重新下载并验证过服务器文件哈希**。

第一版不支持 PDF。采用笔记相对路径匹配，不自动合并不同文件名的笔记。Markdown 内容和窗口尺寸变化后，恢复位置可能有偏差。手机端代码未使用 Node 原生模块，但需实机验证后才能声称手机兼容。

## 开发与测试

独立源码目录，不包含真实进度数据库、云配置或密钥。

```sh
npm ci --ignore-scripts
npm test
npm run lint
```

测试包含三台电脑的隔离数据、内存云端模拟、按时间合并、时钟异常、同时间冲突、磁盘持久化、同步失败、空跑和依赖方法恢复。模拟云端不能替代两台实体电脑及真实云服务联调。

本次验证详情与多电脑验收步骤见 [TESTING.md](TESTING.md)。

采用 MIT 许可证；作者 DLf2001。

## English

Sync Markdown reading positions across multiple computers by connecting **Remember cursor position** and **Remotely Save**. Each device writes its own progress file; the latest actual reading timestamp wins, even if that reader moved backward. Different positions with the same timestamp require a manual choice.

### Requirements and installation

- Obsidian Desktop 1.14.4 or later. Mobile and PDF are not supported in this release.
- Remember cursor position 1.0.16 and Remotely Save 0.5.25, installed and enabled. Other dependency versions need validation.
- Remotely Save configured for bidirectional synchronization to the same remote vault on every computer, including the `阅读进度同步/` folder.

Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/DLf2001/reading-progress-sync-bridge/releases/latest), put them in `<vault>/.obsidian/plugins/reading-progress-sync-bridge/`, and enable the plugin. Settings and notices currently use Simplified Chinese. Give each computer a distinct device name. Device IDs are stored locally, not in shared plugin settings.

The bridge exports saved positions before synchronization and validates and merges downloaded device records after Remotely Save reports success. It backs up the local position database before import. Failed synchronization does not import remote progress. By default, the current page does not jump; reopen the note or use the restore-current command. Changes made during a transfer are preserved for the next synchronization.

If configuration-directory synchronization is enabled, use the bridge's exclusion-rule button to exclude the original position database and this plugin's local state and backups. Keep the original position database in its default plugin directory. Enable automatic clock synchronization on every computer; timestamps alone cannot resolve small clock skew.

### Privacy, compatibility, and verification

This plugin makes no network requests, reads no service credentials, collects no telemetry, and accesses no files outside the vault. Shared records contain note paths, positions, device names, and reading timestamps, not note contents. Those metadata are synchronized through the service and encryption settings you configure in Remotely Save. A remote service may require an account or payment; this bridge itself is free.

The integration wraps non-public runtime methods and restores them when disabled, without modifying dependency source files. Dependency updates may require changes. A successful check verifies the sync result callback, local file readback, and downloaded record validity; it is not an independent server-side hash audit.

Eighteen automated tests, including a three-device simulated cloud, and an actual local export/readback have passed. Real multi-computer cloud handoff has not yet been verified. See [TESTING.md](TESTING.md). This initial release is for early adopters; keep backups. GitHub publication does not imply Obsidian community approval.

This independent companion plugin is maintained by [DLf2001](https://github.com/DLf2001), is not affiliated with Obsidian or its dependencies, and is licensed under [MIT](LICENSE).
