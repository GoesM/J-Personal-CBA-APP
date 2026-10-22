const fs = require("node:fs/promises");
const path = require("node:path");
const TYPES = ["INTJ", "ENTJ", "INFJ", "ENFJ", "ISTJ", "ESTJ", "ISFJ", "ESFJ"];
class Appearance {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, "appearance.json");
    this.type = "INTJ";
    this.shortcuts = [];
  }
  async load() {
    try {
      const value = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (TYPES.includes(value?.type)) this.type = value.type;
      if (Array.isArray(value?.shortcuts))
        this.shortcuts = value.shortcuts.filter(
          (file) =>
            typeof file === "string" &&
            path.isAbsolute(file) &&
            file.toLowerCase().endsWith(".lnk"),
        );
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
    return this.type;
  }
  async save(type) {
    if (!TYPES.includes(type)) throw new Error("请选择已有形象的 MBTI 类型");
    await fs.mkdir(this.root, { recursive: true });
    const temp = this.file + ".tmp";
    await fs.writeFile(
      temp,
      JSON.stringify({ type, shortcuts: this.shortcuts }, null, 2),
      "utf8",
    );
    await fs.rename(temp, this.file);
    this.type = type;
    return type;
  }
  icon(type = this.type) {
    if (!TYPES.includes(type)) throw new Error("无效形象");
    return path.join(__dirname, "../src/assets/characters", type, "app.ico");
  }
  async externalIcon() {
    const icon = path.join(this.root, `ledger-${this.type}.ico`);
    await fs.mkdir(this.root, { recursive: true });
    await fs.copyFile(this.icon(), icon);
    return icon;
  }
  async rememberShortcut(file) {
    if (!this.shortcuts.includes(file)) this.shortcuts.push(file);
    await this.save(this.type);
  }
}
module.exports = { Appearance, TYPES };
