const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LedgerLocation } = require("../desktop/location.cjs");

const state = () => ({
  schemaVersion: 1,
  categories: [
    { id: "food", name: "餐饮", type: "expense", color: "#e3a681", icon: "☕" },
  ],
  entries: [
    {
      id: "entry-1",
      type: "expense",
      date: "2026-09-30",
      categoryId: "food",
      description: "测试午餐",
      amount: 25.5,
      color: "#e7f0e6",
    },
  ],
  finance: {
    initialCapital: 0,
    initialDate: "2026-09-30",
    transfers: [],
    projects: [],
  },
});

test("迁移完整账本后切换路径，并保留原文件", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cba-location-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const location = await new LedgerLocation(
    path.join(root, "appdata"),
  ).initialize();
  assert.equal(await location.load(), null);
  await location.store.save(state());
  const oldFile = location.file;
  const target = path.join(root, "custom", "个人账本.json");
  const migrated = await location.migrateTo(target);
  assert.equal(migrated.info.dataPath, target);
  assert.equal((await location.load()).entries[0].description, "测试午餐");
  assert.equal(
    JSON.parse(await fs.readFile(oldFile, "utf8")).entries.length,
    1,
  );
  const reopened = await new LedgerLocation(
    path.join(root, "appdata"),
  ).initialize();
  assert.equal(reopened.info().dataPath, target);
  assert.equal((await reopened.load()).entries[0].amount, 25.5);
  const changed = state();
  changed.entries[0].amount = 28;
  await reopened.store.save(changed);
  assert.equal((await reopened.load()).entries[0].amount, 28);
  assert.equal(
    JSON.parse(await fs.readFile(oldFile, "utf8")).entries[0].amount,
    25.5,
  );
  assert(
    (await fs.readdir(path.join(root, "custom", "backups"))).some((name) =>
      name.startsWith("before-"),
    ),
  );
});

test("目标已存在时拒绝迁移，不覆盖任何账本", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cba-location-exists-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const location = await new LedgerLocation(
    path.join(root, "appdata"),
  ).initialize();
  await location.load();
  await location.store.save(state());
  const target = path.join(root, "already.json");
  await fs.writeFile(target, "keep this file");
  await assert.rejects(location.migrateTo(target), /目标文件已存在/);
  assert.equal(await fs.readFile(target, "utf8"), "keep this file");
  assert.equal(location.file, location.defaultFile);
  await assert.rejects(
    location.migrateTo(path.join(root, "wrong.txt")),
    /\.json/,
  );
});

test("切换已有账本先校验；原路径失效时不创建空账本", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cba-location-switch-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const location = await new LedgerLocation(
    path.join(root, "appdata"),
  ).initialize();
  await location.load();
  await location.store.save(state());
  const custom = path.join(root, "custom", "ledger.json");
  await location.migrateTo(custom);
  const invalid = path.join(root, "invalid.json");
  await fs.writeFile(invalid, '{"schemaVersion":99}');
  await assert.rejects(location.useExisting(invalid), /不支持的版本/);
  assert.equal(location.file, custom);
  await fs.rm(custom);
  const reopened = await new LedgerLocation(
    path.join(root, "appdata"),
  ).initialize();
  await assert.rejects(reopened.load(), /不存在/);
  assert.equal(reopened.ready, false);
  await assert.rejects(fs.stat(custom), /ENOENT/);
  const recovered = await reopened.useExisting(location.defaultFile);
  assert.equal(recovered.state.entries[0].amount, 25.5);
  assert.equal(reopened.info().dataPath, location.defaultFile);
});
