# 拾光账本 0.4.1 · 关联账目删除修复

下载 `Shiguang-Ledger-0.4.1-win.zip`，完整解压后运行 `拾光账本.exe`。

## 本版更新

- 删除借入记录时，如果已有还款关联，先查找同一债权方较早、未结清且足额的借入或信用付款。确认框会列出还款转关联的账目；确认后删除与转关联一起保存。
- 找不到合理去向时，直接指出关联的结算账目，需先编辑或删除结算记录。垫付收回与报销不会被自动关联到其他原始消费。

账本仍使用 v2 格式。升级程序不改动现有账本；建议在“数据与备份”中保留完整备份。

[使用说明](https://github.com/GoesM/J-Personal-CBA-APP/blob/main/docs/USAGE.md) · [数据规范](https://github.com/GoesM/J-Personal-CBA-APP/blob/main/docs/DATA_FORMAT.md)
