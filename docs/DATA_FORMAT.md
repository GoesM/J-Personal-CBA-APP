# 账本历史存储规范（v2）

[返回首页](../README.md) · [使用说明](USAGE.md) · [JSON Schema](../schemas/ledger-v2.schema.json)

## 为什么按日拆分

旧版把类别、全部账目和理财信息放在一个 JSON 快照里。个人账本即使只有数 MB，整文件读写通常也不会立刻变得极慢；真正的问题是**每次记账都要重写所有历史**。新版把日常账目按日期拆分，普通记账只写被改动的日期文件。改变一笔账目的日期时，原日期和新日期两个文件都会更新。类别或理财变化只改独立的元数据文件。

拆分不等于按需读取：当前界面启动时仍加载所有日期文件，以支持全历史搜索和分析。启动读取量仍随历史增长，且大量小文件有文件系统开销。后续如需明显优化启动速度，应增加按月份加载和统计索引，而不是继续细拆文件。

## 目录结构

默认账本目录是 Electron 用户数据目录下的 `data/ledger/`，用户可在“数据与备份”中选择其他绝对路径下的账本**文件夹**。结构如下：

```text
ledger/
├─ manifest.json
├─ generations/
│  └─ g-<UUID>/
│     ├─ meta.json
│     ├─ entries/
│     │  └─ 2026/
│     │     ├─ 2026-10-01.json
│     │     └─ 2026-10-02.json
│     └─ pending.json                 # 仅在跨文件写入尚未完成时出现
└─ backups/
   ├─ 2026-10-02/
   │  ├─ meta.json                    # 当日首次修改前的旧版
   │  └─ entries/2026/2026-10-01.json
   └─ before-import-<时间戳>.json    # 导入前的旧清单
```

`manifest.json` 是活动存储代的指针，例如 `{"schemaVersion":2,"generation":"g-..."}`。导入完整备份时先写入全新的存储代，再原子切换清单；旧存储代保留在 `generations/`。普通保存只修改活动存储代。

### `meta.json`

```json
{
  "schemaVersion": 2,
  "categories": [
    {
      "id": "food",
      "name": "餐饮",
      "type": "expense",
      "color": "#e3a681",
      "icon": "☕"
    }
  ],
  "analysisPreferences": { "excludedCategoryIds": [] },
  "finance": {
    "initialCapital": 1000,
    "initialDate": "2026-10-01",
    "transfers": [],
    "projects": []
  }
}
```

`categories` 最多 1000 个。类别字段为 `id`（非空稳定字符串，最长 80）、`name`（1–12 字符）、`type`（`income` 或 `expense`）、`color`（`#RRGGBB`）、`icon`（1–4 字符）。**类别属于当前账本**，与账目、理财数据一起保存在该账本目录；切换账本会加载另一份账本自己的类别，完整导出和导入也包含类别。`id` 不可重复；历史账目通过 `categoryId` 引用类别，改名会同步改变历史显示。

`analysisPreferences.excludedCategoryIds` 保存当前账本分析页**不参与支出／收入占比图**的类别 ID。未列出的类别默认参与，新建类别也默认参与；删除类别时会清理对应 ID。饼图及其“所选总计”只用已勾选类别重新计算，页面顶部总收支、净结余和趋势仍统计全部类别的账目，并使用当前统计口径。这个设置跟随账本目录、迁移和完整 JSON 备份。已有 v2 账本没有该字段时按空数组处理，即全部类别参与。

`finance` 包含 `initialCapital`、`initialDate`、`transfers[]`、`projects[]`。划转记录有 `id`、`type`（`deposit`／`withdraw`）、`date`、`amount`、`note`。项目有 `id`、`name`、`form`、`investedDate`、`invested`、`maturityDate`、`annualRate`、`currentValue`、`status`；已赎回项目还需要 `redeemedDate` 与 `redeemedAmount`。参考年化与预计到期日只供记录，不自动计算收益或赎回。当前一个项目只支持一次投入和一次完整赎回。

### `entries/YYYY/YYYY-MM-DD.json`

只有存在账目的日期才生成文件。文件名、`date` 和其中每笔账目的 `date` 必须相同：

```json
{
  "schemaVersion": 2,
  "date": "2026-10-02",
  "entries": [
    {
      "id": "entry-1",
      "type": "expense",
      "date": "2026-10-02",
      "categoryId": "food",
      "description": "午餐",
      "amount": 25.5,
      "color": "#f8eadd"
    }
  ]
}
```

账目 `id` 在全账本内唯一；`categoryId` 必须指向同一收支类型的现存类别。`description` 为 1–80 字符，金额为正数、最多两位小数、不超过 10 亿，背景色为 `#RRGGBB`。没有账目的日期文件会删除。单个日期文件上限 1 MB，`meta.json` 上限 10 MB；总账目最多 100000 条。

日期统一为本地日历日期 `YYYY-MM-DD`，不附加时区。金额以 JSON 十进制数字保存；资金池校验先换算为整数分。资金池余额 = 起始资金 + 外部转入 − 外部转出 − 项目投入 + 赎回到账。按日期检查事件，同日先转入和赎回，再投入和转出；任何时点余额为负都会拒绝保存。理财本金流转不计入日常收支分析。

## 特定标签与信用付款（v0.4.0 扩展）

目录格式仍为 v2。固有特定标签由程序内置，无法增删或改名；它们与自建类别独立。每笔账目仍只保存一次总金额，在原来按日保存的账目对象内增加可选 `special[]` 和 `credit` 字段。完整使用场景见[债务与报销](DEBTS.md)。

```json
{
  "id": "meal-1",
  "type": "expense",
  "date": "2026-10-08",
  "categoryId": "food",
  "description": "四人聚餐",
  "amount": 100,
  "color": "#f8eadd",
  "special": [
    { "id": "advance-a", "kind": "lent", "party": "A", "amount": 25 },
    { "id": "advance-b", "kind": "lent", "party": "B", "amount": 25 },
    { "id": "advance-c", "kind": "lent", "party": "C", "amount": 25 }
  ],
  "credit": { "party": "花呗", "amount": 100 }
}
```

`special` 最多 50 项；每项必需 `id`（非空稳定字符串，最长 80）、`kind`、`party`（去除首尾空白，最长 60）、`amount`（正数，两位小数，最多 10 亿）。明细 ID 在全账本内唯一，不得占用任何账目的 `<entryId>:credit` 保留 ID。

| kind         | 固有标签     | 账目类型 | 参数 / 关联                                              |
| ------------ | ------------ | -------- | -------------------------------------------------------- |
| borrowed     | 债务（借入） | income   | 非空借款来源，形成应还本金                               |
| repaid       | 债务（还出） | expense  | 非空还款对方，`targetId` 指向 borrowed 明细或信用付款    |
| lent         | 债务（借出） | expense  | 非空借款 / 垫付对象，形成应收本金                        |
| recovered    | 债务（收回） | income   | 非空归还对方，`targetId` 指向 lent 明细                  |
| reimbursable | 可报销       | expense  | 单位 / 项目可为空，形成待报销金额                        |
| reimbursed   | 报销         | income   | `targetId` 必须指向 reimbursable；原单位为空时来源可为空 |

`credit` 是独立可选对象，只用于支出，必需非空 `party` 与正数 `amount`，金额不得超过原账总额。它产生 ID 为 `<entryId>:credit` 的虚拟 borrowed 记录供还款关联，无须存一笔额外收入；`targetId` 因此最长 87 字符。信用付款是资金来源，不与用途拆分争用金额。

`special` 金额之和不得超过原账 `amount`。自动拆分是从原账推导的计算明细，不另存重复的付款。实际收支金额 = 原账总额 − special 合计；支出现金金额 = 原账总额 − credit 金额，收入现金金额 = 原账总额。计算先转为整数分。信用消费在消费当天计入实际收支，还本金及报销到账不重复进入实际收支。

结算关联使用原始明细 ID。引用必须存在、标签方向正确、对方一致（原可报销单位为空例外）、日期不早于原账、不能结算自身信用欠款；所有关联结算金额合计不得超过原额。保存 / 导入前校验完整状态，阻止导致已有结算失效的修改或删除。余额从原账与结算记录推导，不另存余额缓存。

`meta.json` 的 `analysisPreferences.basis` 可为 `actual`（默认，实际收支）或 `cash`（资金进出）；汇总、趋势与占比图统一使用该口径。类别勾选仍只影响占比图。债务与报销余额累计截至所选期末的全历史，且不受图表类别筛选影响。

无 `special` / `credit` 的旧 v2 账目可继续使用。旧自建债务 / 报销类别不自动转换，以免猜错对方或关联；界面提供补充入口。新字段随按日存储、迁移与完整备份保存。启用新功能后应使用 v0.4.0 或更新程序，旧程序编辑账目可能丢弃新字段。

## 写入、恢复与备份

1. 程序先校验完整内存状态，并比较当前状态，找出变化的日期文件和 `meta.json`。
2. 覆盖现有文件前，在 `backups/当天日期/` 对每个被改动文件最多保存一份旧版。新日期没有旧版可备份。
3. 将本次文件操作写入 `pending.json`，再逐个通过临时文件与原子替换写入目标。全部完成后删除 `pending.json`。
4. 如进程中断，下次启动先重放 `pending.json`，再读取账本。损坏或缺失的正式文件会阻止正常初始化，不会悄悄生成空账本。

自动旧版文件是恢复材料，并非每次修改的审计日志。请定期手动导出完整备份。导出文件仍是**单个 JSON**，方便携带和导入，但它只用于偶发备份，不承担日常写入。导出对象格式为 `{"schemaVersion":2,"categories":[],"entries":[],"finance":{...},"analysisPreferences":{"excludedCategoryIds":[]}}`，最多 100 MB；字段约束见 [JSON Schema](../schemas/ledger-v2.schema.json)。导入前先校验完整内容，再写新存储代并切换活动清单。

## 路径设置

当前账本文件夹的绝对路径单独保存在应用用户数据目录的 `storage-location.json`：`{"schemaVersion":2,"dataDirectory":"D:\\账本\\我的账本"}`。该文件没有财务记录，也不包含在导出备份中。迁移到新文件夹时先生成完整的新账本，成功后更新位置设置；旧目录与旧备份留在原处。切换已有账本时先验证所选目录，不合并两份数据。

v2 **不读取 v1 的单文件账本或位置设置**。v0.3.0 引入 v2 时，软件尚未实际使用，因而未提供 v1 自动迁移。v0.4.0 可以继续打开已有 v2 账本。账本及备份均为明文。请在关闭程序后用其他工具移动或编辑，避免两台设备同时写同一个同步盘目录。
