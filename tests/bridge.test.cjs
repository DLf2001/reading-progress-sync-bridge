const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const BASE_TIME = 1792210000000;

function load(clock = { now: BASE_TIME }) {
  class Clock extends Date { static now() { return clock.now; } }
  const notices = [];
  const context = {
    module: { exports: {} }, Date: Clock, Error, TextEncoder, Map, Set, window: { crypto: webcrypto },
    require: name => {
      assert.equal(name, "obsidian");
      return { Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Modal: class {},
        Notice: class { constructor(text) { notices.push(text); } }, MarkdownView: class {} };
    },
  };
  vm.runInNewContext(source, context);
  return { Bridge: context.module.exports, core: context.module.exports.internals, notices };
}

const p = (line, scroll = line) => ({ scroll, cursor: { from: { line, ch: 0 }, to: { line, ch: 0 } } });
const record = (line, updatedAt) => ({ position: p(line), updatedAt });
const manifest = (id, records) => ({ schema: 1, deviceId: id, deviceName: id, records });
const plain = value => JSON.parse(JSON.stringify(value));

class MemoryAdapter {
  constructor() { this.files = new Map(); this.dirs = new Set(); this.writes = []; this.blockWrite = null; }
  async exists(file) { return this.files.has(file) || this.dirs.has(file); }
  async mkdir(file) { this.dirs.add(file); }
  async read(file) { if (!this.files.has(file)) throw Error("Missing file"); return this.files.get(file); }
  async write(file, text) {
    if (this.blockWrite) await this.blockWrite(file);
    this.writes.push(file);
    this.files.set(file, text);
  }
  async list(dir) { return { files: [...this.files.keys()].filter(file => file.startsWith(dir + "/") && !file.slice(dir.length + 1).includes("/")), folders: [] }; }
  async stat(file) { return { size: Buffer.byteLength(await this.read(file)) }; }
}

async function device(id, cloud, initial = {}, clock = { now: BASE_TIME }) {
  const { Bridge, notices } = load(clock);
  const bridge = new Bridge();
  const adapter = new MemoryAdapter();
  const dbPath = ".obsidian/plugins/remember-cursor-position/cursor-positions.json";
  adapter.files.set(dbPath, JSON.stringify(initial));
  const rcp = {
    db: plain(initial), lastSavedDb: plain(initial), settings: { dbFileName: dbPath },
    checkEphemeralStateChanged() {}, isExcluded: () => false,
    async writeDb(db) { await adapter.write(dbPath, JSON.stringify(db)); },
    setEphemeralState(value) { this.restored = plain(value); },
  };
  let syncCalls = 0;
  const remote = {
    settings: { syncDirection: "bidirectional", syncConfigDir: false, ignorePaths: [], onlyAllowPaths: [], skipSizeLargerThan: -1 },
    isSyncing: false, fail: false, duringSync: null,
    updateLastSyncMsg() {},
    async syncRun(trigger = "manual") {
      syncCalls++;
      if (trigger === "dry") return "dry";
      this.isSyncing = true;
      this.updateLastSyncMsg(trigger, "syncing", -1, -1);
      if (this.duringSync) await this.duringSync();
      if (this.fail) {
        this.updateLastSyncMsg(trigger, "not_syncing", null, clock.now);
        this.isSyncing = false;
        return "failed";
      }
      if (adapter.files.has(bridge.ownPath)) cloud.set(bridge.ownPath, adapter.files.get(bridge.ownPath));
      for (const [file, text] of cloud) if (file !== bridge.ownPath) adapter.files.set(file, text);
      this.updateLastSyncMsg(trigger, "not_syncing", clock.now, null);
      this.isSyncing = false;
      return "synced";
    },
    async saveSettings() { this.savedSettings = plain(this.settings); },
  };
  bridge.app = {
    vault: { adapter, configDir: ".obsidian", getAbstractFileByPath: file => file.endsWith(".md") ? { path: file } : null },
    plugins: { getPlugin: name => name === "remotely-save" ? remote : rcp },
    workspace: { getActiveViewOfType: () => null },
  };
  Object.assign(bridge, {
    identity: { id, name: id }, manifest: { dir: ".obsidian/plugins/reading-progress-sync-bridge" },
    localRoot: `.obsidian/plugins/reading-progress-sync-bridge/local/${id}`,
    backupRoot: `.obsidian/plugins/reading-progress-sync-bridge/backups/${id}`,
    ownPath: `阅读进度同步/devices/${id}.json`,
    settings: { enabled: true, restoreActive: false }, local: { baselines: {} },
    report: { phase: "initial", issues: [] }, conflicts: [], running: false, disabled: false,
    dbWriteTail: Promise.resolve(), statusEl: { setText() {} },
  });
  await bridge.connect();
  return { bridge, adapter, rcp, remote, clock, notices, get syncCalls() { return syncCalls; } };
}

test("latest actual reading time wins, even when the latest reader moved backward", () => {
  const { core } = load();
  const result = core.latestPositions([
    manifest("device-a1", { "Book.md": record(200, BASE_TIME - 100) }),
    manifest("device-b1", { "Book.md": record(150, BASE_TIME - 50) }),
    manifest("device-c1", { "Other.md": record(10, BASE_TIME - 25) }),
  ]);
  assert.equal(result.winners.get("Book.md").position.cursor.from.line, 150);
  assert.equal(result.winners.size, 2);
});

test("equal time and differing positions produce a conflict, identical positions do not", () => {
  const { core } = load();
  const a = manifest("device-a1", { "Book.md": record(20, BASE_TIME) });
  const b = manifest("device-b1", { "Book.md": record(30, BASE_TIME) });
  assert.equal(core.latestPositions([a, b]).conflicts.length, 1);
  b.records["Book.md"] = record(20, BASE_TIME);
  assert.equal(core.latestPositions([a, b]).conflicts.length, 0);
});

test("future clock outliers are reported and never automatically adopted", () => {
  const { core } = load();
  const result = core.latestPositions([
    manifest("device-a1", { "Book.md": record(10, BASE_TIME) }),
    manifest("device-b1", { "Book.md": record(99, BASE_TIME + 600000) }),
  ]);
  assert.equal(result.issues.length, 1);
  assert.equal(result.winners.get("Book.md").position.scroll, 10);
});

test("manifest validation rejects traversal, mismatched IDs, invalid positions, and unsupported schema", () => {
  const { core } = load();
  const valid = manifest("device-a1", { "Book.md": record(10, BASE_TIME) });
  assert.equal(core.parseManifest(JSON.stringify(valid), "device-a1").schema, 1);
  assert.throws(() => core.parseManifest(JSON.stringify(valid), "device-b1"));
  for (const bad of [
    { ...valid, schema: 2 },
    { ...valid, records: { "../Book.md": record(10, BASE_TIME) } },
    { ...valid, records: { "Book.md": { position: { scroll: -1 }, updatedAt: BASE_TIME } } },
  ]) assert.throws(() => core.parseManifest(JSON.stringify(bad), "device-a1"));
});

test("sync filters and direction are checked before marking progress synchronized", () => {
  const { core } = load();
  const file = "阅读进度同步/devices/device-a1.json";
  const args = [file, 100, ".obsidian/plugins/remember-cursor-position/cursor-positions.json", ".obsidian/plugins/bridge/local/device-a1", ".obsidian"];
  assert.doesNotThrow(() => core.syncRules({}, ...args));
  for (const settings of [
    { ignorePaths: ["^阅读进度同步/"] }, { ignorePaths: ["^阅读进度同步/$"] },
    { onlyAllowPaths: ["\\.md$"] }, { syncDirection: "incremental_push_only" },
    { skipSizeLargerThan: 50 }, { syncConfigDir: true },
  ]) assert.throws(() => core.syncRules(settings, ...args));
});

test("three computers converge through wrapped Remotely Save, with backups and persistent local DB", async () => {
  const cloud = new Map();
  const a = await device("device-a1", cloud, { "Book.md": { ...p(200), lastModified: BASE_TIME - 300 } });
  const b = await device("device-b1", cloud);
  const c = await device("device-c1", cloud);
  await a.remote.syncRun("manual");
  await b.remote.syncRun("auto");
  assert.equal(b.rcp.db["Book.md"].scroll, 200);
  b.rcp.db["Book.md"] = { ...p(150), lastModified: BASE_TIME - 100 };
  await b.remote.syncRun("manual");
  await c.remote.syncRun("auto_once_init");
  await a.remote.syncRun("auto");
  for (const d of [a, b, c]) assert.equal(d.rcp.db["Book.md"].scroll, 150);
  assert.equal(JSON.parse(await a.adapter.read(a.rcp.settings.dbFileName))["Book.md"].scroll, 150);
  assert.ok([...a.adapter.files.keys()].some(file => file.includes("/backups/")));
  assert.equal(a.bridge.report.devices, 3);
  assert.equal(a.bridge.report.phase, "同步和进度核对完成");
});

test("syncing or reopening the same saved position does not publish a newer timestamp", async () => {
  const d = await device("device-a1", new Map(), { "Book.md": { ...p(12), lastModified: BASE_TIME - 500 } });
  await d.remote.syncRun();
  const before = await d.adapter.read(d.bridge.ownPath);
  d.clock.now += 50000;
  d.rcp.db["Book.md"].lastModified = d.clock.now;
  await d.remote.syncRun();
  assert.equal(await d.adapter.read(d.bridge.ownPath), before);
});

test("reading during a transfer is preserved and marked for the next upload", async () => {
  const d = await device("device-a1", new Map(), { "Book.md": { ...p(10), lastModified: BASE_TIME - 1000 } });
  d.remote.duringSync = async () => { d.rcp.db["Book.md"] = { ...p(30), lastModified: BASE_TIME }; };
  await d.remote.syncRun();
  assert.equal(d.rcp.db["Book.md"].scroll, 30);
  assert.equal(d.bridge.report.pendingUpload, true);
  assert.equal(JSON.parse(await d.adapter.read(d.bridge.ownPath)).records["Book.md"].position.scroll, 30);
});

test("sync failure never imports remote positions or claims success", async () => {
  const cloud = new Map();
  const a = await device("device-a1", cloud, { "Book.md": { ...p(90), lastModified: BASE_TIME } });
  await a.remote.syncRun();
  const b = await device("device-b1", cloud, { "Book.md": { ...p(10), lastModified: BASE_TIME - 100 } });
  b.remote.fail = true;
  await b.remote.syncRun();
  assert.equal(b.rcp.db["Book.md"].scroll, 10);
  assert.match(b.bridge.report.phase, /未确认成功/);
});

test("a broken bridge configuration does not prevent ordinary note synchronization", async () => {
  const d = await device("device-a1", new Map());
  d.remote.settings.ignorePaths = ["^阅读进度同步/"];
  await d.remote.syncRun();
  assert.equal(d.syncCalls, 1);
  assert.match(d.bridge.report.phase, /排除规则/);
  assert.equal(d.bridge.report.checkedAt, undefined);
});

test("dry run does not export, merge, or create backups", async () => {
  const d = await device("device-a1", new Map(), { "Book.md": { ...p(10), lastModified: BASE_TIME } });
  const before = [...d.adapter.files];
  assert.equal(await d.remote.syncRun("dry"), "dry");
  assert.deepEqual([...d.adapter.files], before);
});

test("manual tie resolution becomes a newer record and reaches other computers next sync", async () => {
  const cloud = new Map();
  const a = await device("device-a1", cloud, { "Book.md": { ...p(10), lastModified: BASE_TIME } });
  const b = await device("device-b1", cloud, { "Book.md": { ...p(20), lastModified: BASE_TIME } });
  await a.remote.syncRun(); await b.remote.syncRun();
  assert.equal(b.bridge.conflicts.length, 1);
  const chosen = b.bridge.conflicts[0].candidates.find(r => r.deviceId === "device-a1");
  await b.bridge.resolveConflict("Book.md", chosen);
  assert.equal(b.bridge.report.pendingUpload, true);
  await b.remote.syncRun(); await a.remote.syncRun();
  assert.equal(a.rcp.db["Book.md"].scroll, 10);
  assert.equal(a.bridge.conflicts.length, 0);
});

test("malformed device records are reported without breaking valid records", async () => {
  const d = await device("device-a1", new Map());
  await d.bridge.captureLocal();
  d.adapter.files.set("阅读进度同步/devices/device-b1.json", "broken");
  await d.bridge.reconcile();
  assert.equal(d.bridge.report.issues.length, 1);
  assert.equal(await d.adapter.read("阅读进度同步/devices/device-b1.json"), "broken");
});

test("local database writing is awaited and serialized", async () => {
  const d = await device("device-a1", new Map());
  let release;
  let first = true;
  d.adapter.blockWrite = async file => {
    if (first && file === d.rcp.settings.dbFileName) {
      first = false;
      await new Promise(resolve => { release = resolve; });
    }
  };
  const one = d.rcp.writeDb({ "Book.md": { ...p(10), lastModified: BASE_TIME } });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const two = d.rcp.writeDb({ "Book.md": { ...p(20), lastModified: BASE_TIME + 1 } });
  assert.deepEqual(d.rcp.lastSavedDb, {});
  release();
  await Promise.all([one, two]);
  assert.equal(JSON.parse(await d.adapter.read(d.rcp.settings.dbFileName))["Book.md"].scroll, 20);
});

test("unloading restores original dependency methods, without touching upstream files", async () => {
  const d = await device("device-a1", new Map());
  const h = d.bridge.hooks;
  d.bridge.detach();
  assert.equal(d.remote.syncRun, h.originalSync);
  assert.equal(d.remote.updateLastSyncMsg, h.originalStatus);
  assert.equal(d.rcp.writeDb, h.originalWrite);
});

test("source files contain no network transport or credential handling", () => {
  assert.doesNotMatch(source, /\bfetch\s*\(|\brequestUrl\s*\(|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY/);
});

test("local export verification reads back actual records without calling sync", async () => {
  const d = await device("device-a1", new Map(), { "Book.md": { ...p(9), lastModified: BASE_TIME } });
  await d.bridge.exportAndCheck();
  assert.equal(d.syncCalls, 0);
  assert.equal(d.bridge.report.exported, 1);
  assert.match(d.bridge.report.phase, /回读检查通过/);
});

test("a local read that changes during backup is not overwritten by downloaded state", async () => {
  const cloud = new Map();
  const a = await device("device-a1", cloud, { "Book.md": { ...p(20), lastModified: BASE_TIME - 100 } });
  await a.remote.syncRun();
  const b = await device("device-b1", cloud, { "Book.md": { ...p(10), lastModified: BASE_TIME - 200 } });
  const backup = b.bridge.backupDb.bind(b.bridge);
  b.bridge.backupDb = async rcp => {
    await backup(rcp);
    rcp.db["Book.md"] = { ...p(99), lastModified: BASE_TIME };
  };
  await b.remote.syncRun();
  assert.equal(b.rcp.db["Book.md"].scroll, 99);
  assert.equal(b.bridge.report.pendingUpload, true);
});
