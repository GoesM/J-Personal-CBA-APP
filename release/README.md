# Windows Release

最新版下载地址：<https://github.com/GoesM/J-Personal-CBA-APP/releases/latest>

本地执行 `npm run package:win` 后，`release/` 会生成 `win-unpacked/` 和 Windows ZIP。ZIP 在 GitHub Release 页面分发，不提交到源码仓库。解压后运行 `拾光账本.exe`；账本默认保存在 Windows 用户数据目录下的 `data/ledger/`，也可在“数据与备份”中迁移到指定文件夹。详细格式见 [`docs/DATA_FORMAT.md`](../docs/DATA_FORMAT.md)。
