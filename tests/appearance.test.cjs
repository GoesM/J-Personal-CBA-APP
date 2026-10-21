const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Appearance, TYPES } = require("../desktop/appearance.cjs");
test("形象设置重启保留，拒绝路径及未知类型，所有形象资源存在", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-appearance-"));
  try {
    const settings = new Appearance(root);
    assert.equal(await settings.load(), "INTJ");
    for (const type of TYPES) {
      await fs.access(settings.icon(type));
      await fs.access(path.join(path.dirname(settings.icon(type)), "icon.png"));
      await settings.save(type);
      assert.equal(await new Appearance(root).load(), type);
    }
    await assert.rejects(settings.save("../../invalid"));
    await assert.rejects(settings.save("INFP"));
    assert.equal(await new Appearance(root).load(), "ESFJ");
    await fs.writeFile(settings.file, "{");
    assert.equal(await new Appearance(root).load(), "INTJ");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
