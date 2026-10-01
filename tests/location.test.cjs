const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LedgerLocation } = require("../desktop/location.cjs");
const { LedgerStore } = require("../desktop/storage.cjs");

const state = () => ({
  schemaVersion: 2,
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
const isolated = async (t, prefix) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
};

test("迁移完整账本文件夹后切换路径，并保留原目录", async (t) => {
  const root = await isolated(t, "cba-location-test-");
  const location = await new LedgerLocation(
    path.join(root, "appdata"),
  ).initialize();
  assert.equal(await location.load(), null);
  await location.store.save(state());
  const oldDirectory = location.directory;
  const target = path.join(root, "custom", "个人账本");
  const migrated = await location.migrateTo(target);
  assert.equal(migrated.info.dataPath, target);
  assert.equal((await location.load()).entries[0].description, "测试午餐");
  assert.equal(
    (await new LedgerStore(oldDirectory).load()).entries[0].amount,
    25.5,
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
    (await new LedgerStore(oldDirectory).load()).entries[0].amount,
    25.5,
  );
  assert((await fs.readdir(path.join(target, "backups"))).length > 0);
});

test("目标文件夹已存在时拒绝迁移", async (t) => {
  const root = await isolated(t, "cba-location-exists-");
  const location = await new LedgerLocation(
    path.join(root, "appdata"),
  ).initialize();
  await location.load();
  await location.store.save(state());
  const target = path.join(root, "already");
  await fs.mkdir(target);
  await assert.rejects(location.migrateTo(target), /目标文件夹已存在/);
  assert.equal(location.directory, location.defaultDirectory);
  await assert.rejects(
    location.migrateTo(path.join(root, "wrong.json")),
    /\.json 文件/,
  );
});

test("切换已有目录先校验；路径失效时不创建空账本", async (t) => {
  const root = await isolated(t, "cba-location-switch-");
  const location = await new LedgerLocation(
    path.join(root, "appdata"),
  ).initialize();
  await location.load();
  await location.store.save(state());
  const custom = path.join(root, "custom", "ledger");
  await location.migrateTo(custom);
  const invalid = path.join(root, "invalid");
  await fs.mkdir(invalid);
  await fs.writeFile(
    path.join(invalid, "manifest.json"),
    '{"schemaVersion":99}',
  );
  await assert.rejects(location.useExisting(invalid), /清单版本/);
  assert.equal(location.directory, custom);
  await fs.rename(custom, path.join(root, "moved-away"));
  const reopened = await new LedgerLocation(
    path.join(root, "appdata"),
  ).initialize();
  await assert.rejects(reopened.load(), /不存在/);
  assert.equal(reopened.ready, false);
  await assert.rejects(fs.stat(custom), /ENOENT/);
  const recovered = await reopened.useExisting(location.defaultDirectory);
  assert.equal(recovered.state.entries[0].amount, 25.5);
  assert.equal(reopened.info().dataPath, location.defaultDirectory);
});
