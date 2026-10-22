const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { syncShortcuts } = require("../desktop/shortcuts.cjs");
test("同步递归发现的快捷方式及自定义位置，仅修改精确目标的图标，隔离失败", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-links-"));
  try {
    await fs.mkdir(path.join(root, "nested"));
    for (const name of [
      "good.lnk",
      "other.lnk",
      "bad.lnk",
      "broken.lnk",
      "nested/second.lnk",
    ])
      await fs.writeFile(path.join(root, name), "");
    const writes = [];
    const target = "C:\\Ledger\\拾光账本.exe";
    const shell = {
      readShortcutLink(file) {
        if (file.endsWith("broken.lnk")) throw new Error("corrupt");
        return {
          target: file.endsWith("other.lnk")
            ? "C:\\Other\\拾光账本.exe"
            : target.toUpperCase(),
          icon: "old.ico",
          args: "--keep",
        };
      },
      writeShortcutLink(file, operation, options) {
        if (file.endsWith("bad.lnk")) return false;
        writes.push({ file, operation, options });
        return true;
      },
    };
    const result = await syncShortcuts({
      roots: [root, root],
      extraPaths: [path.join(root, "good.lnk"), "C:\\Custom\\custom.lnk"],
      target,
      icon: "new.ico",
      shell,
    });
    assert.equal(result.matched, 4);
    assert.equal(result.updated, 3);
    assert.equal(result.failed, 1);
    assert.equal(writes.length, 3);
    for (const write of writes) {
      assert.equal(write.operation, "update");
      assert.deepEqual(write.options, { icon: "new.ico", iconIndex: 0 });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
