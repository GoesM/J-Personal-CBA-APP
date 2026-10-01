const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { LedgerStore } = require("./storage.cjs");

function normalizeLedgerDirectory(directory) {
  if (
    typeof directory !== "string" ||
    !path.isAbsolute(directory) ||
    path.extname(directory).toLowerCase() === ".json"
  )
    throw new Error("请选择绝对路径下的账本文件夹，不要选择 .json 文件");
  return path.resolve(directory);
}

function samePath(a, b) {
  if (process.platform === "win32") return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** Per-computer pointer to the active ledger directory. */
class LedgerLocation {
  constructor(appDataRoot) {
    this.appDataRoot = path.resolve(appDataRoot);
    this.configFile = path.join(this.appDataRoot, "storage-location.json");
    this.defaultDirectory = path.join(this.appDataRoot, "data", "ledger");
    this.directory = this.defaultDirectory;
    this.store = this.storeFor(this.directory);
    this.configError = null;
    this.ready = false;
  }

  storeFor(directory) {
    return new LedgerStore(directory);
  }

  async initialize() {
    try {
      const config = JSON.parse(await fs.readFile(this.configFile, "utf8"));
      if (config.schemaVersion !== 2)
        throw new Error("不支持的账本位置设置版本");
      const directory = normalizeLedgerDirectory(config.dataDirectory);
      if (samePath(directory, this.appDataRoot))
        throw new Error("账本文件夹不能与程序配置目录相同");
      this.directory = directory;
      this.store = this.storeFor(directory);
    } catch (error) {
      if (error.code !== "ENOENT") this.configError = error;
    }
    return this;
  }

  info() {
    return {
      dataPath: this.directory,
      backupPath: this.store.backups,
      defaultPath: this.defaultDirectory,
      customPath: !samePath(this.directory, this.defaultDirectory),
    };
  }

  async load() {
    if (this.configError)
      throw new Error(`账本位置设置无法读取：${this.configError.message}`);
    const state = await this.store.load();
    if (state === null && !samePath(this.directory, this.defaultDirectory))
      throw new Error(`已设置的账本文件夹不存在：${this.directory}`);
    this.ready = true;
    return state;
  }

  async writeConfig(directory) {
    await fs.mkdir(this.appDataRoot, { recursive: true });
    const temporary = path.join(
      this.appDataRoot,
      `.storage-location-${randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify(
          { schemaVersion: 2, dataDirectory: directory },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      );
      await fs.rename(temporary, this.configFile);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }

  async migrateTo(directory) {
    const target = normalizeLedgerDirectory(directory);
    if (samePath(target, this.directory))
      return { state: await this.load(), info: this.info() };
    if (samePath(target, this.appDataRoot))
      throw new Error("账本文件夹不能与程序配置目录相同");
    const state = await this.load();
    if (!state) throw new Error("当前还没有可迁移的账本");
    const candidate = this.storeFor(target);
    try {
      await candidate.createNew(state);
    } catch (error) {
      if (error.code === "EEXIST")
        throw new Error(
          "目标文件夹已存在。请使用“切换到已有账本”或选择新文件夹名。",
        );
      throw error;
    }
    await this.writeConfig(target);
    this.directory = target;
    this.store = candidate;
    this.configError = null;
    this.ready = true;
    return { state, info: this.info() };
  }

  async useExisting(directory) {
    const target = normalizeLedgerDirectory(directory);
    if (samePath(target, this.appDataRoot))
      throw new Error("账本文件夹不能与程序配置目录相同");
    const candidate = this.storeFor(target);
    const state = await candidate.load();
    if (!state) throw new Error("所选文件夹不存在或不是有效账本");
    await this.writeConfig(target);
    this.directory = target;
    this.store = candidate;
    this.configError = null;
    this.ready = true;
    return { state, info: this.info() };
  }
}

module.exports = { LedgerLocation, normalizeLedgerDirectory };
