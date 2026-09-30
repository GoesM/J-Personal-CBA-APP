const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const MAX_BYTES = 10 * 1024 * 1024;
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
  assert(state.schemaVersion === 1, "不支持的版本");
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

class LedgerStore {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, "ledger.json");
    this.backups = path.join(root, "backups");
  }
  async load() {
    try {
      const stat = await fs.stat(this.file);
      assert(stat.size <= MAX_BYTES, "数据文件过大");
      return validateState(JSON.parse(await fs.readFile(this.file, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async write(state, backupName = null) {
    validateState(state);
    const body = JSON.stringify(state, null, 2) + "\n";
    assert(Buffer.byteLength(body) <= MAX_BYTES, "账本超过 10 MB");
    await fs.mkdir(this.root, { recursive: true });
    if (backupName) {
      await fs.mkdir(this.backups, { recursive: true });
      try {
        await fs.copyFile(
          this.file,
          path.join(this.backups, backupName),
          require("node:fs").constants.COPYFILE_EXCL,
        );
      } catch (error) {
        if (!["ENOENT", "EEXIST"].includes(error.code)) throw error;
      }
    }
    const temporary = path.join(this.root, `.ledger-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, body, { flag: "wx" });
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    return state;
  }
  async save(state) {
    return this.write(
      state,
      `before-${new Date().toISOString().slice(0, 10)}.json`,
    );
  }
  async importFrom(filePath) {
    const stat = await fs.stat(filePath);
    assert(stat.size <= MAX_BYTES, "备份文件过大");
    const state = validateState(
      JSON.parse(await fs.readFile(filePath, "utf8")),
    );
    await this.write(
      state,
      `before-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    return state;
  }
  async exportTo(filePath) {
    const state = await this.load();
    assert(state, "当前还没有账本文件");
    await fs.writeFile(filePath, JSON.stringify(state, null, 2) + "\n");
  }
}

module.exports = { LedgerStore, validateState, financeEvents };
