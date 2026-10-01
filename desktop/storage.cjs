const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MAX_META_BYTES = 10 * 1024 * 1024;
const MAX_DAY_BYTES = 1024 * 1024;
const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const colorPattern = /^#[0-9a-fA-F]{6}$/;
const text = (value, max = 100) =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const validDate = (value) =>
  datePattern.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validAmount = (value, positive = false) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= (positive ? 0.01 : 0) &&
  value <= 1e9 &&
  Number.isInteger(Math.round(value * 100)) &&
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
const assert = (condition, message) => {
  if (!condition) throw new Error(`账本格式错误：${message}`);
};

function financeEvents(finance) {
  const events = finance.transfers.map((item) => ({
    date: item.date,
    amount: item.type === "deposit" ? item.amount : -item.amount,
    priority: item.type === "deposit" ? 0 : 3,
  }));
  for (const project of finance.projects) {
    events.push({
      date: project.investedDate,
      amount: -project.invested,
      priority: 2,
    });
    if (project.status === "redeemed")
      events.push({
        date: project.redeemedDate,
        amount: project.redeemedAmount,
        priority: 1,
      });
  }
  return events.sort(
    (a, b) => a.date.localeCompare(b.date) || a.priority - b.priority,
  );
}

function validateState(state) {
  assert(
    state && typeof state === "object" && !Array.isArray(state),
    "根对象无效",
  );
  assert(state.schemaVersion === 2, "不支持的版本");
  assert(
    Array.isArray(state.categories) && state.categories.length <= 1000,
    "类别列表无效",
  );
  assert(
    Array.isArray(state.entries) && state.entries.length <= 100000,
    "账目列表无效",
  );
  const ids = new Set(),
    categories = new Map();
  for (const item of state.categories) {
    assert(text(item.id, 80) && !ids.has(item.id), "类别 ID 重复或无效");
    ids.add(item.id);
    assert(
      text(item.name, 12) && ["income", "expense"].includes(item.type),
      "类别名称或类型无效",
    );
    assert(
      colorPattern.test(item.color) && text(item.icon, 4),
      "类别颜色或图标无效",
    );
    categories.set(item.id, item);
  }
  if (state.analysisPreferences === undefined)
    state.analysisPreferences = { excludedCategoryIds: [] };
  const excluded = state.analysisPreferences?.excludedCategoryIds;
  assert(
    Array.isArray(excluded) &&
      excluded.length <= state.categories.length &&
      excluded.every((id) => typeof id === "string" && categories.has(id)) &&
      new Set(excluded).size === excluded.length,
    "分析图表的类别筛选无效",
  );
  ids.clear();
  for (const item of state.entries) {
    assert(text(item.id, 80) && !ids.has(item.id), "账目 ID 重复或无效");
    ids.add(item.id);
    assert(
      ["income", "expense"].includes(item.type) && validDate(item.date),
      "账目类型或日期无效",
    );
    assert(
      validAmount(item.amount, true) &&
        text(item.description, 80) &&
        colorPattern.test(item.color),
      "账目内容无效",
    );
    assert(
      categories.get(item.categoryId)?.type === item.type,
      "账目类别不存在或类型不匹配",
    );
  }
  const finance = state.finance;
  assert(
    finance &&
      validAmount(finance.initialCapital) &&
      validDate(finance.initialDate),
    "资金池起始信息无效",
  );
  assert(
    Array.isArray(finance.transfers) && finance.transfers.length <= 100000,
    "资金划转列表无效",
  );
  assert(
    Array.isArray(finance.projects) && finance.projects.length <= 100000,
    "理财项目列表无效",
  );
  ids.clear();
  for (const item of finance.transfers) {
    assert(text(item.id, 80) && !ids.has(item.id), "划转 ID 重复或无效");
    ids.add(item.id);
    assert(
      ["deposit", "withdraw"].includes(item.type) &&
        validAmount(item.amount, true) &&
        validDate(item.date),
      "划转内容无效",
    );
    assert(
      typeof item.note === "string" && item.note.length <= 50,
      "划转备注无效",
    );
  }
  ids.clear();
  for (const item of finance.projects) {
    assert(text(item.id, 80) && !ids.has(item.id), "项目 ID 重复或无效");
    ids.add(item.id);
    assert(text(item.name, 30) && text(item.form, 20), "项目名称或形式无效");
    assert(
      validDate(item.investedDate) &&
        validAmount(item.invested, true) &&
        validAmount(item.currentValue),
      "项目投入或估值无效",
    );
    assert(
      item.maturityDate === "" ||
        (validDate(item.maturityDate) &&
          item.maturityDate >= item.investedDate),
      "项目到期日无效",
    );
    assert(
      item.annualRate === null ||
        (typeof item.annualRate === "number" &&
          Number.isFinite(item.annualRate) &&
          item.annualRate >= -100 &&
          item.annualRate <= 1000),
      "参考年化无效",
    );
    assert(["active", "redeemed"].includes(item.status), "项目状态无效");
    if (item.status === "redeemed")
      assert(
        validDate(item.redeemedDate) &&
          item.redeemedDate >= item.investedDate &&
          validAmount(item.redeemedAmount),
        "赎回信息无效",
      );
  }
  let pool = Math.round(finance.initialCapital * 100);
  for (const event of financeEvents(finance)) {
    assert(event.date >= finance.initialDate, "资金流水早于起始日期");
    pool += Math.round(event.amount * 100);
    assert(pool >= 0, `${event.date} 的资金池余额不能为负`);
  }
  return state;
}

const json = (value) => JSON.stringify(value, null, 2) + "\n";
const localDay = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const generationPattern =
  /^g-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const dayFilePattern = /^entries\/(\d{4})\/(\d{4}-\d{2}-\d{2})\.json$/;
const dayFile = (date) => `entries/${date.slice(0, 4)}/${date}.json`;
const groups = (entries) => {
  const result = new Map();
  for (const entry of entries) {
    if (!result.has(entry.date)) result.set(entry.date, []);
    result.get(entry.date).push(entry);
  }
  return result;
};
const metaBody = (state) =>
  json({
    schemaVersion: 2,
    categories: state.categories,
    finance: state.finance,
    analysisPreferences: state.analysisPreferences,
  });
const dayBody = (date, entries) => json({ schemaVersion: 2, date, entries });

async function readJson(file, limit) {
  const stat = await fs.stat(file);
  assert(stat.size <= limit, `${path.basename(file)} 超过大小限制`);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function atomicWrite(file, body) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(
    path.dirname(file),
    `.ledger-${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporary, body, { flag: "wx" });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

class LedgerStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.file = path.join(this.root, "manifest.json");
    this.backups = path.join(this.root, "backups");
    this.manifest = null;
    this.cachedState = null;
  }

  generationRoot(generation) {
    assert(generationPattern.test(generation), "存储代号无效");
    return path.join(this.root, "generations", generation);
  }

  async readManifest() {
    let rootStat;
    try {
      rootStat = await fs.stat(this.root);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    assert(rootStat.isDirectory(), "账本位置不是文件夹");
    const manifest = await readJson(this.file, 1024);
    assert(
      manifest.schemaVersion === 2 &&
        generationPattern.test(manifest.generation),
      "清单版本或存储代号无效",
    );
    return manifest;
  }

  async recoverPending(generationRoot) {
    const pendingFile = path.join(generationRoot, "pending.json");
    let pending;
    try {
      pending = await readJson(pendingFile, MAX_BACKUP_BYTES);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    assert(
      pending.schemaVersion === 2 && Array.isArray(pending.operations),
      "未完成写入记录无效",
    );
    for (const operation of pending.operations) {
      assert(
        operation &&
          (operation.path === "meta.json" ||
            dayFilePattern.test(operation.path)) &&
          (operation.body === null || typeof operation.body === "string"),
        "未完成写入路径无效",
      );
      const target = path.join(generationRoot, ...operation.path.split("/"));
      if (operation.body === null) await fs.rm(target, { force: true });
      else await atomicWrite(target, operation.body);
    }
    await fs.rm(pendingFile);
  }

  async load() {
    const manifest = await this.readManifest();
    if (!manifest) return null;
    const generationRoot = this.generationRoot(manifest.generation);
    await this.recoverPending(generationRoot);
    const meta = await readJson(
      path.join(generationRoot, "meta.json"),
      MAX_META_BYTES,
    );
    assert(
      meta.schemaVersion === 2 &&
        Array.isArray(meta.categories) &&
        meta.finance &&
        typeof meta.finance === "object",
      "类别或理财文件无效",
    );
    const entries = [];
    const entriesRoot = path.join(generationRoot, "entries");
    let years;
    try {
      years = await fs.readdir(entriesRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") years = [];
      else throw error;
    }
    for (const year of years) {
      assert(
        year.isDirectory() && /^\d{4}$/.test(year.name),
        "账目年份目录无效",
      );
      const names = await fs.readdir(path.join(entriesRoot, year.name));
      for (const name of names) {
        if (/^\.ledger-[0-9a-f-]{36}\.tmp$/.test(name)) continue;
        const relative = `entries/${year.name}/${name}`;
        const match = dayFilePattern.exec(relative);
        assert(
          match && match[1] === match[2].slice(0, 4),
          "每日账目文件名无效",
        );
        const day = await readJson(
          path.join(entriesRoot, year.name, name),
          MAX_DAY_BYTES,
        );
        assert(
          day.schemaVersion === 2 &&
            day.date === match[2] &&
            validDate(day.date) &&
            Array.isArray(day.entries) &&
            day.entries.length > 0 &&
            day.entries.every((entry) => entry.date === day.date),
          `${name} 内容或日期无效`,
        );
        entries.push(...day.entries);
      }
    }
    const state = validateState({
      schemaVersion: 2,
      categories: meta.categories,
      entries,
      finance: meta.finance,
      analysisPreferences: meta.analysisPreferences,
    });
    this.manifest = manifest;
    this.cachedState = structuredClone(state);
    return state;
  }

  async writeGeneration(root, state) {
    const generation = `g-${randomUUID()}`;
    const generationRoot = path.join(root, "generations", generation);
    const meta = metaBody(state);
    assert(
      Buffer.byteLength(meta) <= MAX_META_BYTES,
      "类别与理财文件超过 10 MB",
    );
    await atomicWrite(path.join(generationRoot, "meta.json"), meta);
    for (const [date, entries] of groups(state.entries)) {
      const body = dayBody(date, entries);
      assert(
        Buffer.byteLength(body) <= MAX_DAY_BYTES,
        `${date} 的账目超过 1 MB`,
      );
      await atomicWrite(
        path.join(generationRoot, ...dayFile(date).split("/")),
        body,
      );
    }
    const manifest = { schemaVersion: 2, generation };
    await atomicWrite(path.join(root, "manifest.json"), json(manifest));
    return manifest;
  }

  async createNew(state) {
    validateState(state);
    try {
      await fs.stat(this.root);
      const error = new Error("目标账本文件夹已存在");
      error.code = "EEXIST";
      throw error;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.mkdir(path.dirname(this.root), { recursive: true });
    const stage = path.join(
      path.dirname(this.root),
      `.ledger-stage-${randomUUID()}.tmp`,
    );
    await fs.mkdir(stage);
    try {
      const manifest = await this.writeGeneration(stage, state);
      await fs.rename(stage, this.root);
      this.manifest = manifest;
      this.cachedState = structuredClone(state);
    } catch (error) {
      await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return state;
  }

  async save(state) {
    validateState(state);
    if (!this.manifest) {
      const existing = await this.readManifest();
      if (!existing) return this.createNew(state);
      await this.load();
    } else {
      const currentManifest = await this.readManifest();
      assert(currentManifest, "当前账本文件夹已丢失，保存已停止");
      assert(
        currentManifest.generation === this.manifest.generation,
        "账本清单已在程序外被更改，保存已停止",
      );
    }
    const generationRoot = this.generationRoot(this.manifest.generation);
    try {
      await fs.stat(path.join(generationRoot, "pending.json"));
      await this.load();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const previous = this.cachedState;
    const operations = [];
    const previousMeta = metaBody(previous);
    const nextMeta = metaBody(state);
    assert(
      Buffer.byteLength(nextMeta) <= MAX_META_BYTES,
      "类别与理财文件超过 10 MB",
    );
    if (previousMeta !== nextMeta)
      operations.push({ path: "meta.json", body: nextMeta });
    const oldGroups = groups(previous.entries);
    const newGroups = groups(state.entries);
    const dates = new Set([...oldGroups.keys(), ...newGroups.keys()]);
    for (const date of [...dates].sort()) {
      const oldEntries = oldGroups.get(date) || [];
      const newEntries = newGroups.get(date) || [];
      if (JSON.stringify(oldEntries) === JSON.stringify(newEntries)) continue;
      const body = newEntries.length ? dayBody(date, newEntries) : null;
      if (body)
        assert(
          Buffer.byteLength(body) <= MAX_DAY_BYTES,
          `${date} 的账目超过 1 MB`,
        );
      operations.push({ path: dayFile(date), body });
    }
    if (!operations.length) return state;
    for (const operation of operations) {
      const source = path.join(generationRoot, ...operation.path.split("/"));
      const oldDate = dayFilePattern.exec(operation.path)?.[2];
      if (operation.path === "meta.json" || oldGroups.has(oldDate)) {
        try {
          await fs.stat(source);
        } catch (error) {
          if (error.code === "ENOENT")
            throw new Error(
              `原有账本文件已丢失，保存已停止：${operation.path}`,
            );
          throw error;
        }
      }
      const backup = path.join(
        this.backups,
        localDay(),
        ...operation.path.split("/"),
      );
      await fs.mkdir(path.dirname(backup), { recursive: true });
      try {
        await fs.copyFile(source, backup, constants.COPYFILE_EXCL);
      } catch (error) {
        if (error.code !== "ENOENT" || !oldDate || oldGroups.has(oldDate)) {
          if (error.code !== "EEXIST") throw error;
        }
      }
    }
    const pendingFile = path.join(generationRoot, "pending.json");
    const pending = json({ schemaVersion: 2, operations });
    assert(
      Buffer.byteLength(pending) <= MAX_BACKUP_BYTES,
      "待写入账目超过 100 MB",
    );
    await atomicWrite(pendingFile, pending);
    await this.recoverPending(generationRoot);
    this.cachedState = structuredClone(state);
    return state;
  }

  async importFrom(filePath) {
    const state = validateState(await readJson(filePath, MAX_BACKUP_BYTES));
    const current = await this.load();
    if (!current) return this.createNew(state);
    const oldManifest = this.manifest;
    const nextGeneration = `g-${randomUUID()}`;
    const temporaryRoot = path.join(this.root, "generations", nextGeneration);
    await fs.mkdir(temporaryRoot, { recursive: true });
    const meta = metaBody(state);
    assert(
      Buffer.byteLength(meta) <= MAX_META_BYTES,
      "类别与理财文件超过 10 MB",
    );
    await atomicWrite(path.join(temporaryRoot, "meta.json"), meta);
    for (const [date, entries] of groups(state.entries)) {
      const body = dayBody(date, entries);
      assert(
        Buffer.byteLength(body) <= MAX_DAY_BYTES,
        `${date} 的账目超过 1 MB`,
      );
      await atomicWrite(
        path.join(temporaryRoot, ...dayFile(date).split("/")),
        body,
      );
    }
    await atomicWrite(
      path.join(
        this.backups,
        `before-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      ),
      json(oldManifest),
    );
    await atomicWrite(
      this.file,
      json({ schemaVersion: 2, generation: nextGeneration }),
    );
    this.manifest = { schemaVersion: 2, generation: nextGeneration };
    this.cachedState = structuredClone(state);
    return state;
  }

  async exportTo(filePath) {
    const state = await this.load();
    assert(state, "当前还没有账本文件");
    const body = json(state);
    assert(Buffer.byteLength(body) <= MAX_BACKUP_BYTES, "导出文件超过 100 MB");
    await fs.writeFile(filePath, body);
  }
}

module.exports = { LedgerStore, validateState, financeEvents };
