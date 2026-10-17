const { Plugin: ObsidianPlugin, PluginSettingTab, Setting, Modal, Notice, MarkdownView } = require("obsidian");

const ROOT = "阅读进度同步";
const DEVICE_KEY = "reading-progress-sync-bridge:device-v1";
const MAX_BYTES = 5 * 1024 * 1024;
const FUTURE_MS = 5 * 60 * 1000;
const clone = value => JSON.parse(JSON.stringify(value));
const signature = value => JSON.stringify(position(value));

const safePath = function (value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\\") &&
    !value.startsWith("/") && !value.includes(":") && !value.split("/").some(p => !p || p === "." || p === "..");
};

const position = function (value) {
  if (!value || typeof value !== "object" || !Number.isFinite(value.scroll) || value.scroll < 0) return null;
  const result = { scroll: Math.round(value.scroll * 10000) / 10000 };
  if (value.cursor) {
    const cursor = {};
    for (const key of ["from", "to"]) {
      const point = value.cursor[key];
      if (!point || !Number.isSafeInteger(point.line) || point.line < 0 ||
          !Number.isSafeInteger(point.ch) || point.ch < 0) return null;
      cursor[key] = { line: point.line, ch: point.ch };
    }
    result.cursor = cursor;
  }
  return result;
};

const parseManifest = function (text, expectedId) {
  if (text.length > MAX_BYTES) throw new Error("设备进度文件过大，已停止导入");
  const data = JSON.parse(text);
  if (data.schema !== 1 || data.deviceId !== expectedId || !/^[a-z0-9-]{8,80}$/.test(data.deviceId) ||
      typeof data.deviceName !== "string" || !data.records || Array.isArray(data.records) || typeof data.records !== "object") {
    throw new Error("设备进度文件的版本、身份或格式不匹配");
  }
  for (const [path, record] of Object.entries(data.records)) {
    if (!safePath(path) || !path.toLowerCase().endsWith(".md") ||
        !position(record?.position) || !Number.isSafeInteger(record.updatedAt) || record.updatedAt <= 0) {
      throw new Error("设备进度文件含有无效的位置或时间");
    }
  }
  return data;
};

const latestPositions = function (manifests, now = Date.now()) {
  const grouped = new Map();
  const issues = [];
  for (const manifest of manifests) {
    for (const [path, record] of Object.entries(manifest.records)) {
      const item = { ...record, deviceId: manifest.deviceId, deviceName: manifest.deviceName };
      if (record.updatedAt > now + FUTURE_MS) {
        issues.push({ path, deviceId: manifest.deviceId, reason: "更新时间超过本机时间五分钟，请检查系统校时" });
        continue;
      }
      if (!grouped.has(path)) grouped.set(path, []);
      grouped.get(path).push(item);
    }
  }
  const winners = new Map();
  const conflicts = [];
  for (const [path, records] of grouped) {
    const newest = Math.max(...records.map(r => r.updatedAt));
    const candidates = records.filter(r => r.updatedAt === newest);
    if (new Set(candidates.map(r => signature(r.position))).size > 1) {
      conflicts.push({ path, candidates });
    } else {
      winners.set(path, candidates.sort((a, b) => a.deviceId.localeCompare(b.deviceId))[0]);
    }
  }
  return { winners, conflicts, issues };
};

const syncRules = function (settings, file, size, sourceDb, localFolder, configDir) {
  if (settings.syncDirection !== undefined && settings.syncDirection !== "bidirectional") {
    throw new Error("阅读进度接力需要 Remotely Save 使用双向同步");
  }
  const matches = (pattern, value) => {
    try { return new RegExp(pattern, "u").test(value); }
    catch { throw new Error("同步规则含有无法核对的正则表达式，请先检查 Remotely Save 设置"); }
  };
  const parts = file.split("/");
  const paths = parts.map((_, index) => parts.slice(0, index + 1).join("/") + (index < parts.length - 1 ? "/" : ""));
  const ignores = (settings.ignorePaths || []).filter(p => p.trim());
  const allows = (settings.onlyAllowPaths || []).filter(p => p.trim());
  if (paths.some(path => ignores.some(pattern => matches(pattern, path)))) {
    throw new Error("Remotely Save 的排除规则挡住了阅读进度同步目录");
  }
  if (allows.length && !allows.some(pattern => matches(pattern, file))) {
    throw new Error("请将阅读进度同步目录加入 Remotely Save 的仅允许同步规则");
  }
  if (settings.skipSizeLargerThan > 0 && size > settings.skipSizeLargerThan) {
    throw new Error("阅读进度文件超过 Remotely Save 的文件大小限制");
  }
  if (!configDir || !sourceDb.startsWith(`${configDir}/`)) {
    throw new Error("原始位置数据库不在当前配置目录中，请先将它恢复到插件默认路径，避免两个进度同步通道互相覆盖");
  }
  if (settings.syncConfigDir) {
    if (!ignores.some(p => matches(p, sourceDb)) || !ignores.some(p => matches(p, `${localFolder}/state.json`))) {
      throw new Error("当前同步了配置目录：请在桥接设置中添加本地数据库排除规则后重试");
    }
  }
};

class ConflictModal extends Modal {
  constructor(app, bridge) { super(app); this.bridge = bridge; }
  onOpen() { this.render(); }
  render() {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "阅读进度冲突" });
    this.contentEl.createEl("p", { text: "时间相同但位置不同的记录不会自动覆盖。选择结果后，下次 Remotely Save 同步会上传。" });
    if (!this.bridge.conflicts.length) this.contentEl.createEl("p", { text: "当前没有待处理冲突。" });
    for (const conflict of this.bridge.conflicts) {
      this.contentEl.createEl("h3", { text: conflict.path });
      for (const record of conflict.candidates) {
        new Setting(this.contentEl)
          .setName(record.deviceName)
          .setDesc(`${new Date(record.updatedAt).toLocaleString()} · ${describePosition(record.position)}`)
          .addButton(button => button.setButtonText("使用此进度").onClick(async () => {
            try {
              await this.bridge.resolveConflict(conflict.path, record);
              this.render();
            } catch (error) { this.bridge.fail(error); }
          }));
      }
    }
  }
  onClose() { this.contentEl.empty(); }
}

const describePosition = function (value) {
  return value.cursor ? `第 ${value.cursor.from.line + 1} 行，滚动位置 ${value.scroll}` : `滚动位置 ${value.scroll}`;
};

class BridgeSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.bridge = plugin; }
  display() {
    const bridge = this.bridge;
    this.containerEl.empty();
    bridge.summaryEl = this.containerEl.createEl("p", { text: bridge.statusText() });
    new Setting(this.containerEl).setName("本机设备名称").setDesc("每台电脑单独保存。设备 ID 不随知识库配置同步。")
      .addText(text => text.setValue(bridge.identity.name).onChange(async value => {
        bridge.identity.name = value.trim().slice(0, 80) || "未命名设备";
        bridge.app.saveLocalStorage(DEVICE_KEY, bridge.identity);
      }));
    new Setting(this.containerEl).setName("自动连接同步流程").setDesc("Remotely Save 同步前导出阅读位置，确认同步成功后核对并导入最新进度。")
      .addToggle(toggle => toggle.setValue(bridge.settings.enabled).onChange(async value => {
        bridge.settings.enabled = value;
        await bridge.saveData(bridge.settings);
      }));
    new Setting(this.containerEl).setName("同步后立即跳转当前笔记").setDesc("默认关闭，避免阅读中途跳动。重新打开笔记时仍由原插件恢复位置。")
      .addToggle(toggle => toggle.setValue(bridge.settings.restoreActive).onChange(async value => {
        bridge.settings.restoreActive = value;
        await bridge.saveData(bridge.settings);
      }));
    new Setting(this.containerEl).setName("配置核对").setDesc(`同步目录固定为「${ROOT}」。按最后阅读时间更新，不按文件修改时间或阅读距离判断。`)
      .addButton(button => button.setButtonText("检查配置").onClick(async () => {
        try { await bridge.checkConfiguration(); new Notice("阅读进度同步配置检查通过"); }
        catch (error) { bridge.fail(error); }
        this.display();
      }));
    new Setting(this.containerEl).setName("本机导出验证").setDesc("保存并检查本机的进度文件，不发起云同步，也不导入其他设备的记录。")
      .addButton(button => button.setButtonText("导出并检查").onClick(() => bridge.exportAndCheck()));
    new Setting(this.containerEl).setName("排除原始数据库和本机状态").setDesc("仅在 Remotely Save 开启配置目录同步时需要。保留现有规则，只追加精确排除项，避免旧数据库覆盖合并结果。")
      .addButton(button => button.setButtonText("添加排除规则").onClick(async () => {
        try { await bridge.addExclusions(); new Notice("已追加阅读进度本地文件的排除规则"); }
        catch (error) { bridge.fail(error); }
      }));
    new Setting(this.containerEl).setName("手动同步并核对").setDesc("调用你已经配置的 Remotely Save，不另建云端连接。")
      .addButton(button => button.setButtonText("开始同步").onClick(() => bridge.runSync()));
    new Setting(this.containerEl).setName("同时间冲突").setDesc(`当前 ${bridge.conflicts.length} 篇笔记需要选择。`)
      .addButton(button => button.setButtonText("查看冲突").onClick(() => new ConflictModal(this.app, bridge).open()));
    if (bridge.report.issues?.length) {
      new Setting(this.containerEl).setName("需要核对").setHeading();
      for (const issue of bridge.report.issues) this.containerEl.createEl("p", { text: `${issue.path || ""}：${issue.reason}` });
    }
  }
}

module.exports = class ReadingProgressSyncBridge extends ObsidianPlugin {
  async onload() {
    this.settings = { enabled: true, restoreActive: false, ...(await this.loadData()) };
    this.identity = this.app.loadLocalStorage(DEVICE_KEY);
    if (!this.identity || !/^[a-z0-9-]{8,80}$/.test(this.identity.id)) {
      const id = window.crypto.randomUUID();
      this.identity = { id, name: `电脑-${id.slice(0, 6)}` };
      this.app.saveLocalStorage(DEVICE_KEY, this.identity);
    }
    this.conflicts = [];
    this.report = { phase: "等待插件连接", issues: [] };
    this.localRoot = `${this.manifest.dir}/local/${this.identity.id}`;
    this.backupRoot = `${this.manifest.dir}/backups/${this.identity.id}`;
    this.ownPath = `${ROOT}/devices/${this.identity.id}.json`;
    this.local = { baselines: {} };
    this.dbWriteTail = Promise.resolve();
    this.running = false;
    this.disabled = false;
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addEventListener("click", () => this.app.setting.openTabById(this.manifest.id));
    this.addSettingTab(new BridgeSettings(this.app, this));
    this.addCommand({ id: "sync-and-verify", name: "同步阅读进度并核对", callback: () => this.runSync() });
    this.addCommand({ id: "export-and-check", name: "导出本机阅读进度并检查（不联网）", callback: () => this.exportAndCheck() });
    this.addCommand({ id: "show-conflicts", name: "查看阅读进度冲突", callback: () => new ConflictModal(this.app, this).open() });
    this.addCommand({ id: "restore-current", name: "恢复当前笔记的已合并阅读位置", callback: () => this.restoreCurrent() });
    this.register(() => {
      this.disabled = true;
      this.detach();
    });
    this.app.workspace.onLayoutReady(() => {
      this.connect().catch(error => this.fail(error));
    });
    this.registerInterval(window.setInterval(() => {
      if (!this.running) this.connect().catch(error => this.fail(error, false));
    }, 3000));
  }

  adapter() { return this.app.vault.adapter; }
  deps() {
    const rcp = this.app.plugins.getPlugin("remember-cursor-position");
    const remote = this.app.plugins.getPlugin("remotely-save");
    if (!rcp?.db || !rcp.settings?.dbFileName || typeof rcp.checkEphemeralStateChanged !== "function" ||
        typeof rcp.writeDb !== "function" || typeof remote?.syncRun !== "function" || typeof remote.updateLastSyncMsg !== "function") {
      throw new Error("请先启用 Remember cursor position 和 Remotely Save；若已启用，可能是版本接口变化");
    }
    return { rcp, remote };
  }

  async connect() {
    if (this.disabled) return;
    const { rcp, remote } = this.deps();
    if (this.hooks?.rcp === rcp && this.hooks.remote === remote) return;
    this.detach();
    await this.ensureDir(this.localRoot);
    const localPath = `${this.localRoot}/state.json`;
    if (await this.adapter().exists(localPath)) {
      this.local = JSON.parse(await this.adapter().read(localPath));
      if (!this.local.baselines || typeof this.local.baselines !== "object") throw new Error("本机核对状态格式无效");
    }
    this.own = await this.loadOwn();
    // The wrappers must preserve each dependency's dynamic receiver.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- The dependency wrappers require their own dynamic this receiver.
    const bridge = this;
    const originalSync = remote.syncRun;
    const originalStatus = remote.updateLastSyncMsg;
    const originalWrite = rcp.writeDb;
    const wrappedWrite = function (db) { return bridge.writeLocalDb(rcp, clone(db)); };
    const wrappedStatus = function (trigger, status, successAt, failureAt) {
      if (bridge.activeResult && status === "not_syncing") {
        if (typeof successAt === "number" && successAt > 0) bridge.activeResult.success = true;
        if (typeof failureAt === "number" && failureAt > 0) bridge.activeResult.failed = true;
      }
      return originalStatus.apply(this, arguments);
    };
    const wrappedSync = function (...args) {
      if (!bridge.settings.enabled || args[0] === "dry" || bridge.disabled) return originalSync.apply(this, args);
      return bridge.aroundSync(this, originalSync, args);
    };
    rcp.writeDb = wrappedWrite;
    remote.syncRun = wrappedSync;
    remote.updateLastSyncMsg = wrappedStatus;
    this.hooks = { rcp, remote, originalSync, originalStatus, originalWrite, wrappedSync, wrappedStatus, wrappedWrite };
    this.setReport({ phase: "已连接，等待同步" });
  }

  detach() {
    const h = this.hooks;
    if (!h) return;
    if (h.remote.syncRun === h.wrappedSync) h.remote.syncRun = h.originalSync;
    if (h.remote.updateLastSyncMsg === h.wrappedStatus) h.remote.updateLastSyncMsg = h.originalStatus;
    if (h.rcp.writeDb === h.wrappedWrite) h.rcp.writeDb = h.originalWrite;
    this.hooks = null;
  }

  async ensureDir(path) {
    if (!safePath(path)) throw new Error("目录路径无效");
    let current = "";
    for (const part of path.split("/")) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.adapter().exists(current))) {
        try { await this.adapter().mkdir(current); }
        catch (error) { if (!(await this.adapter().exists(current))) throw error; }
      }
    }
  }

  async loadOwn() {
    if (await this.adapter().exists(this.ownPath)) {
      return parseManifest(await this.adapter().read(this.ownPath), this.identity.id);
    }
    return { schema: 1, deviceId: this.identity.id, deviceName: this.identity.name, records: {} };
  }

  writeLocalDb(rcp, snapshot) {
    const operation = this.dbWriteTail.catch(() => {}).then(async () => {
      const file = rcp.settings.dbFileName;
      if (!safePath(file)) throw new Error("原插件的位置数据路径无效");
      if (JSON.stringify(snapshot) === JSON.stringify(rcp.lastSavedDb)) return;
      const parent = file.slice(0, file.lastIndexOf("/"));
      if (parent) await this.ensureDir(parent);
      await this.adapter().write(file, JSON.stringify(snapshot));
      rcp.lastSavedDb = clone(snapshot);
    });
    this.dbWriteTail = operation;
    // Remember Cursor Position's timer does not await writeDb. Report errors
    // here as well as retaining rejection for callers that do await it.
    operation.catch(() => this.fail(new Error("阅读位置写入失败，请检查知识库可写状态"), false));
    return operation;
  }

  async saveLocal() {
    await this.ensureDir(this.localRoot);
    await this.adapter().write(`${this.localRoot}/state.json`, JSON.stringify(this.local));
  }

  async captureLocal() {
    const { rcp } = this.deps();
    rcp.checkEphemeralStateChanged();
    await rcp.writeDb(rcp.db);
    let changed = false;
    for (const [path, current] of Object.entries(rcp.db)) {
      if (!safePath(path) || !path.toLowerCase().endsWith(".md") || rcp.isExcluded?.(path)) continue;
      const pos = position(current);
      if (!pos) continue;
      const sig = signature(pos);
      const baseline = this.local.baselines[path];
      if (baseline?.signature === sig) continue;
      // Never use sync time as a fallback; it would revive an old reading position.
      const updatedAt = current.lastModified;
      if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) continue;
      if (baseline && updatedAt < baseline.updatedAt) {
        this.addIssue(path, "本机时间或位置时间倒退，暂未导出该变化");
        continue;
      }
      this.own.records[path] = { position: pos, updatedAt };
      this.local.baselines[path] = { signature: sig, updatedAt };
      changed = true;
    }
    if (this.own.deviceName !== this.identity.name) {
      this.own.deviceName = this.identity.name;
      changed = true;
    }
    await this.ensureDir(`${ROOT}/devices`);
    const text = JSON.stringify(this.own, null, 2);
    if (changed || !(await this.adapter().exists(this.ownPath))) await this.adapter().write(this.ownPath, text);
    await this.saveLocal();
    return text;
  }

  async checkConfiguration() {
    await this.connect();
    const { rcp, remote } = this.deps();
    const sample = JSON.stringify(this.own || {}).length * 3;
    syncRules(remote.settings, this.ownPath, sample, rcp.settings.dbFileName, this.localRoot, this.app.vault.configDir);
    this.setReport({ phase: "配置检查通过，尚未执行云同步" });
    return true;
  }

  async exportAndCheck() {
    if (this.running) { new Notice("同步或核对正在进行，请稍后再试"); return; }
    this.running = true;
    try {
      await this.connect();
      const text = await this.captureLocal();
      await this.checkConfiguration();
      const parsed = parseManifest(await this.adapter().read(this.ownPath), this.identity.id);
      if (JSON.stringify(parsed) !== JSON.stringify(JSON.parse(text))) throw new Error("导出文件回读核对不一致");
      this.setReport({ phase: "本机导出及回读检查通过，尚未云同步", exported: Object.keys(parsed.records).length });
      new Notice(`已导出并回读核对 ${Object.keys(parsed.records).length} 条阅读进度；未发起云同步`);
    } catch (error) { this.fail(error); }
    finally { this.running = false; }
  }

  async addExclusions() {
    const { rcp, remote } = this.deps();
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const additions = [`^${escape(rcp.settings.dbFileName)}$`, `^${escape(this.manifest.dir)}/(?:local|backups)/`];
    const current = remote.settings.ignorePaths || [];
    remote.settings.ignorePaths = [...new Set([...current, ...additions])];
    try { await remote.saveSettings(); }
    catch (error) { remote.settings.ignorePaths = current; throw error; }
  }

  async aroundSync(remote, original, args) {
    if (this.running || remote.isSyncing) {
      if (!args[0] || args[0] === "manual") new Notice("同步或进度核对正在进行，请稍后再试");
      return;
    }
    this.running = true;
    this.report.issues = [];
    let preflightOK = false;
    let exported;
    let syncReturn;
    try {
      this.setReport({ phase: "同步前：保存和核对进度" });
      try {
        exported = await this.captureLocal();
        const { rcp } = this.deps();
        syncRules(remote.settings, this.ownPath, new TextEncoder().encode(exported).length, rcp.settings.dbFileName, this.localRoot, this.app.vault.configDir);
        preflightOK = true;
      } catch (error) {
        this.fail(error);
      }
      // A bridge failure must not stop ordinary note synchronization.
      this.activeResult = { success: false, failed: false };
      syncReturn = await original.apply(remote, args);
      if (!preflightOK) return syncReturn;
      if (this.disabled) return syncReturn;
      if (!this.activeResult.success || this.activeResult.failed) {
        throw new Error("Remotely Save 未确认成功，保留本机进度，未自动导入云端位置");
      }
      if (!(await this.adapter().exists(this.ownPath)) || (await this.adapter().read(this.ownPath)) !== exported) {
        await this.adapter().write(this.ownPath, exported);
        throw new Error("同步后的本机进度文件与导出内容不符，已恢复导出副本，请检查同步冲突后重试");
      }
      // Reading may have continued while a cloud transfer was in flight.
      const afterText = await this.captureLocal();
      const restored = await this.reconcile(afterText !== exported);
      if (!this.conflicts.length && !this.report.issues.length) {
        const message = restored ? "阅读进度同步并跳转完成" : "阅读进度同步完成";
        new Notice(this.report.pendingUpload ? `${message}，新进度待下次上传` : message, 2000);
      }
      return syncReturn;
    } catch (error) {
      this.fail(error);
      return syncReturn;
    } finally {
      this.activeResult = null;
      this.running = false;
    }
  }

  async readManifests() {
    const directory = `${ROOT}/devices`;
    if (!(await this.adapter().exists(directory))) return [];
    const { files } = await this.adapter().list(directory);
    const manifests = [];
    for (const file of files) {
      const name = file.slice(file.lastIndexOf("/") + 1);
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      try {
        const stat = await this.adapter().stat(file);
        if (stat?.size > MAX_BYTES) throw new Error("文件超过 5 MB 限制");
        manifests.push(parseManifest(await this.adapter().read(file), id));
      } catch {
        this.addIssue(file, "设备进度文件损坏或格式不匹配，已跳过，未覆盖原文件");
      }
    }
    return manifests;
  }

  async reconcile(pendingUpload = false) {
    const { rcp } = this.deps();
    const manifests = await this.readManifests();
    const merged = latestPositions(manifests);
    this.conflicts = merged.conflicts;
    for (const issue of merged.issues) this.addIssue(issue.path, issue.reason);
    const changes = [];
    for (const [path, winner] of merged.winners) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !path.toLowerCase().endsWith(".md") || rcp.isExcluded?.(path)) continue;
      const current = rcp.db[path];
      const same = signature(current) === signature(winner.position);
      if (!same && current?.lastModified > winner.updatedAt) {
        pendingUpload = true;
        continue;
      }
      if (current && !same && current.lastModified === winner.updatedAt) {
        this.conflicts.push({ path, candidates: [winner, {
          deviceId: this.identity.id, deviceName: this.identity.name,
          position: position(current), updatedAt: current.lastModified,
        }] });
        continue;
      }
      if (!same || current?.lastModified !== winner.updatedAt) changes.push({ path, winner, before: signature(current) });
    }
    if (changes.length) await this.backupDb(rcp);
    let applied = 0;
    for (const change of changes) {
      // Recheck after asynchronous backup: never overwrite a newer local read.
      if (signature(rcp.db[change.path]) !== change.before) { pendingUpload = true; continue; }
      rcp.db[change.path] = { ...clone(change.winner.position), lastModified: change.winner.updatedAt };
      this.local.baselines[change.path] = { signature: signature(change.winner.position), updatedAt: change.winner.updatedAt };
      applied++;
    }
    await rcp.writeDb(rcp.db);
    await this.saveLocal();
    const oldFingerprint = this.lastConflictFingerprint;
    this.lastConflictFingerprint = JSON.stringify(this.conflicts);
    this.setReport({
      phase: this.conflicts.length ? "同步完成，有进度冲突" : this.report.issues.length ? "同步完成，有核对异常" : pendingUpload ? "已核对，同步期间的新进度待下次上传" : "同步和进度核对完成",
      checkedAt: Date.now(), devices: manifests.length, applied, pendingUpload, conflicts: this.conflicts.length,
    });
    if (this.conflicts.length && oldFingerprint !== this.lastConflictFingerprint) {
      new Notice(`发现 ${this.conflicts.length} 篇笔记的同时间进度冲突，请在桥接设置中选择`, 8000);
    }
    if (applied && this.settings.restoreActive) return this.restoreCurrent({ notify: false });
    return false;
  }

  async backupDb(rcp) {
    await this.ensureDir(this.backupRoot);
    const suffix = `${Date.now()}-${window.crypto.randomUUID().slice(0, 8)}`;
    await this.adapter().write(`${this.backupRoot}/positions-${suffix}.json`, JSON.stringify(rcp.db));
  }

  async resolveConflict(path, selected) {
    if (this.running) throw new Error("同步进行中，请等待核对完成再选择冲突结果");
    const conflict = this.conflicts.find(item => item.path === path);
    if (!conflict || !conflict.candidates.some(item => item.deviceId === selected.deviceId && signature(item.position) === signature(selected.position))) {
      throw new Error("冲突记录已变化，请重新打开冲突窗口");
    }
    const { rcp } = this.deps();
    const updatedAt = Math.max(Date.now(), ...conflict.candidates.map(c => c.updatedAt + 1));
    if (updatedAt > Date.now() + FUTURE_MS) throw new Error("设备时间异常，请先校时");
    await this.backupDb(rcp);
    const winner = { position: clone(selected.position), updatedAt };
    rcp.db[path] = { ...winner.position, lastModified: updatedAt };
    this.own.records[path] = winner;
    this.local.baselines[path] = { signature: signature(winner.position), updatedAt };
    await rcp.writeDb(rcp.db);
    await this.ensureDir(`${ROOT}/devices`);
    await this.adapter().write(this.ownPath, JSON.stringify(this.own, null, 2));
    await this.saveLocal();
    this.conflicts = this.conflicts.filter(item => item.path !== path);
    this.setReport({ phase: "冲突已选择，结果待下次同步上传", pendingUpload: true });
  }

  restoreCurrent({ notify = true } = {}) {
    const { rcp } = this.deps();
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const path = view?.file?.path;
    const saved = path ? rcp.db[path] : null;
    if (!saved) { new Notice("当前笔记没有已保存的阅读位置"); return false; }
    rcp.setEphemeralState(clone(saved));
    rcp.lastEphemeralState = clone(saved);
    if (notify) new Notice("已跳转到保存的阅读位置", 2000);
    return true;
  }

  async runSync() {
    try {
      await this.connect();
      await this.deps().remote.syncRun("manual");
    } catch (error) { this.fail(error); }
  }

  addIssue(path, reason) {
    if (!this.report.issues.some(issue => issue.path === path && issue.reason === reason)) this.report.issues.push({ path, reason });
  }

  setReport(patch) {
    this.report = { ...this.report, ...patch };
    this.statusEl?.setText(`阅读进度：${this.report.phase}`);
    if (this.summaryEl?.isConnected) this.summaryEl.setText(this.statusText());
  }

  statusText() {
    const report = this.report;
    return `${report.phase}。设备：${report.devices || 0} 台；本次导入：${report.applied || 0} 条；冲突：${this.conflicts.length} 条。` +
      (report.exported !== undefined ? `本机导出：${report.exported} 条。` : "") +
      (report.checkedAt ? `上次核对：${new Date(report.checkedAt).toLocaleString()}。` : "尚未完成首次核对。");
  }

  fail(error, notify = true) {
    const message = error instanceof Error ? error.message : "阅读进度核对失败";
    this.setReport({ phase: message });
    if (notify) new Notice(message, 8000);
  }
};

module.exports.internals = { safePath, position, signature, parseManifest, latestPositions, syncRules };
