const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { LedgerStore } = require("./storage.cjs");

function normalizeLedgerPath(filePath) {
  if (
    typeof filePath !== "string" ||
    !path.isAbsolute(filePath) ||
    path.extname(filePath).toLowerCase() !== ".json"
  )
    throw new Error("请选择绝对路径下的 .json 账本文件");
  return path.resolve(filePath);
}

function samePath(a, b) {
  if (process.platform === "win32") return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** Per-computer pointer to the active ledger; the ledger itself stays portable. */
class LedgerLocation {
  constructor(appDataRoot) {
    this.appDataRoot = path.resolve(appDataRoot);
    this.configFile = path.join(this.appDataRoot, "storage-location.json");
    this.defaultFile = path.join(this.appDataRoot, "data", "ledger.json");
    this.file = this.defaultFile;
    this.store = this.storeFor(this.file);
    this.configError = null;
    this.ready = false;
  }

  storeFor(filePath) {
    return new LedgerStore(path.dirname(filePath), filePath);
  }

  async initialize() {
    try {
      const config = JSON.parse(await fs.readFile(this.configFile, "utf8"));
      if (config.schemaVersion !== 1)
        throw new Error("不支持的账本位置设置版本");
      const filePath = normalizeLedgerPath(config.dataPath);
      if (samePath(filePath, this.configFile))
        throw new Error("账本文件不能与位置设置文件相同");
      this.file = filePath;
      this.store = this.storeFor(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") this.configError = error;
    }
    return this;
  }

  info() {
    return {
      dataPath: this.file,
      backupPath: this.store.backups,
      defaultPath: this.defaultFile,
      customPath: !samePath(this.file, this.defaultFile),
    };
  }

  async load() {
    if (this.configError)
      throw new Error(`账本位置设置无法读取：${this.configError.message}`);
    const state = await this.store.load();
    if (state === null && !samePath(this.file, this.defaultFile))
      throw new Error(`已设置的账本文件不存在：${this.file}`);
    this.ready = true;
    return state;
  }

  async writeConfig(filePath) {
    await fs.mkdir(this.appDataRoot, { recursive: true });
    const temporary = path.join(
      this.appDataRoot,
      `.storage-location-${randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify({ schemaVersion: 1, dataPath: filePath }, null, 2) +
          "\n",
        { flag: "wx" },
      );
      await fs.rename(temporary, this.configFile);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  async migrateTo(filePath) {
    const target = normalizeLedgerPath(filePath);
    if (samePath(target, this.file))
      return { state: await this.load(), info: this.info() };
    if (samePath(target, this.configFile))
      throw new Error("账本文件不能与位置设置文件相同");
    const state = await this.load();
    if (!state) throw new Error("当前还没有可迁移的账本");
    const candidate = this.storeFor(target);
    try {
      await candidate.createNew(state);
    } catch (error) {
      if (error.code === "EEXIST")
        throw new Error(
          "目标文件已存在。请使用“切换到已有账本”或选择新文件名。",
        );
      throw error;
    }
    await this.writeConfig(target);
    this.file = target;
    this.store = candidate;
    this.configError = null;
    this.ready = true;
    return { state, info: this.info() };
  }

  async useExisting(filePath) {
    const target = normalizeLedgerPath(filePath);
    if (samePath(target, this.configFile))
      throw new Error("账本文件不能与位置设置文件相同");
    const candidate = this.storeFor(target);
    const state = await candidate.load();
    if (!state) throw new Error("所选文件不存在或不是有效账本");
    await this.writeConfig(target);
    this.file = target;
    this.store = candidate;
    this.configError = null;
    this.ready = true;
    return { state, info: this.info() };
  }
}

module.exports = { LedgerLocation, normalizeLedgerPath };
