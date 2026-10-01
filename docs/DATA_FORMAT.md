# 账本数据与存储规范（v1）

[返回首页](../README.md) · [使用说明](USAGE.md) · [JSON Schema](../schemas/ledger-v1.schema.json)

## 当前保存方式

拾光账本使用**单个 UTF-8 JSON 快照文件**保存完整账本，默认文件名为 `ledger.json`。新增、修改或删除账目后，程序在内存中更新账本，校验后写入同目录临时文件，再替换主文件。它不是“每笔账一份文件”，也不是数据库或逐条追加的操作日志。

默认位置是 Electron 用户数据目录下的 `data/ledger.json`；在“数据与备份”页面可查看实际绝对路径。每天第一次覆盖旧账本前，程序在账本同目录的 `backups/` 中留一份 `before-YYYY-MM-DD.json`。导入备份前另留一份带时间戳的 `before-import-*.json`。**编辑或删除某条账目会改变当前快照；旧版备份只是恢复点，不是逐次修改审计日志。**

## 根对象

| 字段            | 类型 | 规则                                 |
| --------------- | ---- | ------------------------------------ |
| `schemaVersion` | 整数 | 当前固定为 `1`；不支持的版本拒绝读取 |
| `categories`    | 数组 | 收入和支出类别，最多 1000 个         |
| `entries`       | 数组 | 日常收支记录，最多 100000 条         |
| `finance`       | 对象 | 理财资金池、资金划转和项目           |

### 类别 `categories[]`

`id`（非空稳定字符串，最长 80）、`name`（1–12 字符）、`type`（`income`/`expense`）、`color`（`#RRGGBB`）、`icon`（1–4 字符）。同一列表内 `id` 不可重复。修改名称或颜色后，引用其 `id` 的历史账目会同步显示新值。

### 日常账目 `entries[]`

`id`（非空稳定字符串，最长 80）、`type`（`income`/`expense`）、`date`（`YYYY-MM-DD` 本地日历日期）、`categoryId`（必须指向同类型的类别）、`description`（1–80 字符）、`amount`（人民币金额，正数，最多两位小数，最大 10 亿）、`color`（该笔账目的 `#RRGGBB` 背景色）。同一列表内 `id` 不可重复。存储数组的先后顺序没有业务含义，界面按日期排序。

### 理财资金池 `finance`

| 字段             | 类型 | 规则                          |
| ---------------- | ---- | ----------------------------- |
| `initialCapital` | 金额 | 起始资金，非负                |
| `initialDate`    | 日期 | 起始资金生效日                |
| `transfers`      | 数组 | 外部转入/转出，最多 100000 条 |
| `projects`       | 数组 | 理财项目，最多 100000 个      |

`transfers[]`：`id`、`type`（`deposit` 转入/`withdraw` 转出）、`date`、`amount`（正数）、`note`（可为空，最长 50 字符）。

`projects[]`：`id`、`name`（1–30 字符）、`form`（理财形式，1–20 字符）、`investedDate`、`invested`（正数本金）、`maturityDate`（预计到期日，或空字符串）、`annualRate`（参考年化百分数，或 `null`）、`currentValue`（非负手动估值）、`status`（`active`/`redeemed`）。`redeemed` 项目还必须有 `redeemedDate` 和非负 `redeemedAmount`。预计到期日不产生自动资金流水；参考年化不自动计算当前价值。

所有金额存为 JSON 十进制数字，最多两位小数。涉及资金池余额的校验换算为整数分后计算，避免浮点误差使余额小于零。

## 关系与资金守恒

1. 日常账目的 `categoryId` 必须指向存在且收支类型一致的类别。
2. 资金池余额 = 起始资金 + 外部转入 − 外部转出 − 项目投入 + 已赎回到账。
3. 对资金事件按日期排序；同日先转入、赎回，再投入、转出。任一事件后余额为负则拒绝保存或导入。
4. 理财本金流转不计入日常 `entries` 的收入/支出分析。
5. `id` 在各自数组内唯一。修改现有项目仍保留原 `id`，账目与类别的关联不依赖名称。

## 示例（虚构数据）

```json
{
  "schemaVersion": 1,
  "categories": [
    {
      "id": "food",
      "name": "餐饮",
      "type": "expense",
      "color": "#e3a681",
      "icon": "☕"
    }
  ],
  "entries": [
    {
      "id": "entry-1",
      "type": "expense",
      "date": "2026-10-01",
      "categoryId": "food",
      "description": "午餐",
      "amount": 25.5,
      "color": "#f8eadd"
    }
  ],
  "finance": {
    "initialCapital": 1000,
    "initialDate": "2026-10-01",
    "transfers": [],
    "projects": [
      {
        "id": "project-1",
        "name": "短期定期",
        "form": "定期存款",
        "investedDate": "2026-10-01",
        "invested": 500,
        "maturityDate": "2027-01-01",
        "annualRate": 1.1,
        "currentValue": 500,
        "status": "active"
      }
    ]
  }
}
```

实际文件必须通过 [`schemas/ledger-v1.schema.json`](../schemas/ledger-v1.schema.json) 的字段约束和程序的跨记录校验。导入备份使用同一格式，没有另设包装层。

## 自定义路径与恢复

路径设置单独写在本机 Electron 用户数据目录的 `storage-location.json`，格式为 `{"schemaVersion":1,"dataPath":"绝对路径/账本.json"}`。这个**指针文件不包含账目，也不包含在 JSON 备份里**。程序启动时先读取指针，再加载账本。

- **迁移当前账本到新路径**：先验证并复制当前快照到一个尚不存在的 `.json` 文件；复制成功后才更新指针。旧账本和旧备份留在原位置，新备份写在新账本同目录的 `backups/`。若复制或指针更新失败，旧账本仍可用。
- **切换到已有账本**：先验证所选 JSON 的结构、类别引用和资金池历史余额，再更新指针；不合并、不覆盖两份账本。
- 若自定义路径的文件丢失、磁盘未连接或文件损坏，程序拒绝创建空白账本覆盖历史，并提供重试和重新选择有效账本的入口。

请在关闭程序后再用其他工具移动或编辑账本文件；两台设备同时写同一云盘文件可能互相覆盖。本版没有并发合并或端到端加密，JSON 文件和备份都是明文，应保存在可信目录。
