# 拾光账本

Windows 离线个人记账与理财管理软件。账目和理财数据只保存在本机；GitHub 仓库保存的是源码和发行包，不会自动上传个人财务记录。

**[下载最新版 Windows 免安装包](https://github.com/GoesM/J-Personal-CBA-APP/releases/latest)** · [使用说明](docs/USAGE.md) · [开发指引](docs/DEVELOPMENT.md) · [版本记录](docs/CHANGELOG.md)

## 功能

- 记录收入和支出：日期、金额、类别、描述、背景色；可搜索、筛选和增删改查。
- 自建收入/支出类别；按月和按年看净结余、趋势与类别分布。
- 管理理财资金池、投入项目、手动估值与赎回；区分浮动和已实现盈亏。
- 按日期防止资金池出现负余额。理财本金划转不计入日常消费或收入。
- JSON 备份导入、导出；导入前自动保留原账本。

## 安装

从 [Releases](https://github.com/GoesM/J-Personal-CBA-APP/releases) 下载 `拾光账本-0.1.0-win.zip`，解压到任意目录后运行 `拾光账本.exe`。升级时解压新版即可；账目位于 Windows 用户数据目录，不在程序目录。当前 Windows 程序没有代码签名，首次运行可能出现发布者未知提示。

首次启动是空白账本，只有预设类别。`demo与设计/` 中的虚构示例不会自动导入正式程序。

## 数据与隐私

程序没有账号、云同步、银行连接或自动行情。账本文件和 JSON 备份是**明文**，请将备份保存在可信位置并妥善保管。推荐定期在“数据与备份”页面导出。源码仓库不应提交 `ledger.json`、备份、密钥或任何真实个人账目。

## 开发

需要 Node.js 24+、npm。首次安装需要从官方 npm 源获取依赖：

```powershell
npm ci
npm test
npm run package:win
```

输出在 `release/`，包括解压即用的 Windows ZIP。模块划分、测试和发布步骤见 [开发指引](docs/DEVELOPMENT.md)。
