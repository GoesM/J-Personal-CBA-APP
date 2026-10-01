const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LedgerStore, validateState } = require("../desktop/storage.cjs");

const baseline = () => ({
  schemaVersion: 2,
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
const isolated = async (t, prefix) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  return { temp, root: path.join(temp, "ledger") };
};

test("按日拆分，只改动相关日期并保留旧版", async (t) => {
  const { root } = await isolated(t, "cba-store-test-");
  const store = new LedgerStore(root);
  assert.equal(await store.load(), null);
  const original = baseline();
  await store.save(original);
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "manifest.json"), "utf8"),
  );
  const dayFile = path.join(
    root,
    "generations",
    manifest.generation,
    "entries",
    "2026",
    "2026-09-01.json",
  );
  assert.equal(
    JSON.parse(await fs.readFile(dayFile, "utf8")).entries.length,
    1,
  );
  const changed = structuredClone(original);
  changed.entries[0].amount = 30;
  await store.save(changed);
  assert.equal((await store.load()).entries[0].amount, 30);
  const backupRoot = path.join(root, "backups");
  const backupDay = (await fs.readdir(backupRoot))[0];
  const backup = await fs.readFile(
    path.join(backupRoot, backupDay, "entries", "2026", "2026-09-01.json"),
    "utf8",
  );
  assert.equal(JSON.parse(backup).entries[0].amount, 20);
  const next = structuredClone(changed);
  next.entries.push({ ...next.entries[0], id: "e2", date: "2026-09-02" });
  const oldDayBody = await fs.readFile(dayFile, "utf8");
  await store.save(next);
  assert.equal(await fs.readFile(dayFile, "utf8"), oldDayBody);
  assert.equal((await store.load()).entries.length, 2);
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

test("类别随各自账本保存，并包含在完整备份中", async (t) => {
  const { temp, root } = await isolated(t, "cba-categories-test-");
  const first = new LedgerStore(root);
  const second = new LedgerStore(path.join(temp, "another-ledger"));
  const firstState = baseline();
  await first.save(firstState);
  const secondState = baseline();
  secondState.categories[0].name = "饮食";
  await second.save(secondState);

  firstState.categories[0].name = "食";
  firstState.categories[0].color = "#123456";
  await first.save(firstState);
  assert.equal((await first.load()).categories[0].name, "食");
  assert.equal((await second.load()).categories[0].name, "饮食");

  const backup = path.join(temp, "complete-backup.json");
  await first.exportTo(backup);
  const exported = JSON.parse(await fs.readFile(backup, "utf8"));
  assert.deepEqual(exported.categories, firstState.categories);
  assert.equal(exported.entries[0].categoryId, "food");
  await second.importFrom(backup);
  assert.deepEqual((await second.load()).categories, firstState.categories);
});

test("导入无效备份不覆盖；有效导入切换存储代并保留原代", async (t) => {
  const { temp, root } = await isolated(t, "cba-import-test-");
  const store = new LedgerStore(root);
  await store.save(baseline());
  const invalid = path.join(temp, "bad.json");
  await fs.writeFile(invalid, '{"schemaVersion":99}');
  await assert.rejects(store.importFrom(invalid), /不支持的版本/);
  assert.equal((await store.load()).entries[0].amount, 20);
  const replacement = baseline();
  replacement.entries[0].amount = 40;
  const valid = path.join(temp, "valid.json");
  await fs.writeFile(valid, JSON.stringify(replacement));
  await store.importFrom(valid);
  assert.equal((await store.load()).entries[0].amount, 40);
  assert(
    (await fs.readdir(path.join(root, "backups"))).some((name) =>
      name.startsWith("before-import-"),
    ),
  );
  assert.equal((await fs.readdir(path.join(root, "generations"))).length, 2);
});

test("未完成的跨日期写入在下次加载时重放", async (t) => {
  const { root } = await isolated(t, "cba-pending-test-");
  const store = new LedgerStore(root);
  await store.save(baseline());
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "manifest.json"), "utf8"),
  );
  const generationRoot = path.join(root, "generations", manifest.generation);
  const moved = { ...baseline().entries[0], date: "2026-09-02" };
  await fs.writeFile(
    path.join(generationRoot, "pending.json"),
    JSON.stringify({
      schemaVersion: 2,
      operations: [
        { path: "entries/2026/2026-09-01.json", body: null },
        {
          path: "entries/2026/2026-09-02.json",
          body: JSON.stringify({
            schemaVersion: 2,
            date: "2026-09-02",
            entries: [moved],
          }),
        },
      ],
    }),
  );
  await fs.writeFile(
    path.join(
      generationRoot,
      "entries",
      "2026",
      ".ledger-12345678-1234-1234-1234-123456789abc.tmp",
    ),
    "unfinished temporary file",
  );
  const reopened = new LedgerStore(root);
  const state = await reopened.load();
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].date, "2026-09-02");
  await assert.rejects(
    fs.stat(path.join(generationRoot, "pending.json")),
    /ENOENT/,
  );
});

test("运行中账本文件夹被移走时拒绝保存", async (t) => {
  const { temp, root } = await isolated(t, "cba-disconnected-test-");
  const store = new LedgerStore(root);
  await store.save(baseline());
  await fs.rename(root, path.join(temp, "moved-away"));
  const changed = baseline();
  changed.entries[0].amount = 21;
  await assert.rejects(store.save(changed), /文件夹已丢失/);
  await assert.rejects(fs.stat(root), /ENOENT/);
});
