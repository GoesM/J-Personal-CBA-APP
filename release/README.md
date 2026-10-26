# Windows Release

最新版下载地址：<https://github.com/GoesM/J-Personal-CBA-APP/releases/latest>

本地执行 `npm run package:win` 后，`release/` 会生成 `win-unpacked/` 和 Windows ZIP。ZIP 在 GitHub Release 页面分发，不提交到源码仓库。解压后运行 `拾光账本.exe`；账本默认保存在 Windows 用户数据目录下的 `data/ledger/`，也可在“数据与备份”中迁移到指定文件夹。详细格式见 [`docs/DATA_FORMAT.md`](../docs/DATA_FORMAT.md)。

0.5.0 新增 MBTI 形象选择及个性化桌面快捷方式，操作入口位于‘数据与备份’。

0.5.1 修复已有桌面、开始菜单和任务栏快捷方式的形象自动同步。

0.6.0 新增债务与报销三组独立金钱流饼图，普通收支仅统计拆分后的实际金额。
