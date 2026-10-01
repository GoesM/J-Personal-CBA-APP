# 拾光账本 0.2.0 · 自定义账本位置

下载 `Shiguang-Ledger-0.2.0-win.zip`，完整解压后运行 `拾光账本.exe`。升级时替换程序文件即可；原有 0.1.0 账本继续从原路径读取。

## 本版更新

- 在“数据与备份”查看当前账本与自动备份目录；可将完整账本迁移到指定 `.json` 新文件，旧文件保留。
- 可切换到另一份已存在且通过校验的账本；两份账本不会合并。
- 自定义账本文件丢失或损坏时显示恢复入口，避免误建空账本覆盖历史。
- 公开 [账本数据规范](https://github.com/GoesM/J-Personal-CBA-APP/blob/main/docs/DATA_FORMAT.md) 和 [JSON Schema](https://github.com/GoesM/J-Personal-CBA-APP/blob/main/schemas/ledger-v1.schema.json)。

账本和备份均为明文 JSON。请将文件放在可信目录，并定期导出备份。若放在同步盘，两台设备不要同时编辑同一个文件。程序没有代码签名，Windows 可能提示“未知发布者”。
