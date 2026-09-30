const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LedgerStore, validateState } = require("../desktop/storage.cjs");

const baseline = () => ({
  schemaVersion: 1,
  categories: [
    { id: "food", name: "餐饮", type: "expense", color: "#e3a681", icon: "☕" },
  ],
  entries: [
    {
      id: "e1",
      type: "expense",
      date: "2026-09-01",
      categoryId: "food",
      description: "午餐",
      amount: 20,
      color: "#e7f0e6",
    },
  ],
  finance: {
    initialCapital: 100,
    initialDate: "2026-09-01",
    transfers: [],
    projects: [],
  },
});

test("账本原子保存、读取、每日旧版备份", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cba-store-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LedgerStore(root);
  assert.equal(await store.load(), null);
  const original = baseline();
  await store.save(original);
  const changed = structuredClone(original);
  changed.entries[0].amount = 30;
  await store.save(changed);
  assert.equal((await store.load()).entries[0].amount, 30);
  const backup = await fs.readFile(
    path.join(
      root,
      "backups",
      `before-${new Date().toISOString().slice(0, 10)}.json`,
    ),
    "utf8",
  );
  assert.equal(JSON.parse(backup).entries[0].amount, 20);
});

test("拒绝类别错配与资金池历史负余额", () => {
  const wrongCategory = baseline();
  wrongCategory.entries[0].type = "income";
  assert.throws(() => validateState(wrongCategory), /类别不存在或类型不匹配/);
  const negative = baseline();
  negative.finance.projects.push({
    id: "p1",
    name: "定期",
    form: "定存",
    investedDate: "2026-09-02",
    invested: 101,
    maturityDate: "",
    annualRate: null,
    currentValue: 101,
    status: "active",
  });
  assert.throws(() => validateState(negative), /资金池余额不能为负/);
});

test("损坏或无效导入不会覆盖原账本", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cba-import-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LedgerStore(root);
  await store.save(baseline());
  const invalid = path.join(root, "bad.json");
  await fs.writeFile(invalid, '{"schemaVersion":99}');
  await assert.rejects(store.importFrom(invalid), /不支持的版本/);
  assert.equal((await store.load()).entries[0].amount, 20);
  const replacement = baseline();
  replacement.entries[0].amount = 40;
  const valid = path.join(root, "valid.json");
  await fs.writeFile(valid, JSON.stringify(replacement));
  await store.importFrom(valid);
  assert.equal((await store.load()).entries[0].amount, 40);
  const names = await fs.readdir(path.join(root, "backups"));
  assert(names.some((name) => name.startsWith("before-import-")));
});
