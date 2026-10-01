# 开发指引

[返回首页](../README.md) · [使用说明](USAGE.md) · [版本记录](CHANGELOG.md)

## 目录结构

| 路径                   | 用途                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| `src/`                 | 账目、分析、理财与类别界面；无外部前端框架                                   |
| `desktop/main.cjs`     | Electron 窗口、受限 IPC、导入导出原生对话框、关闭前等待写入                  |
| `desktop/storage.cjs`  | 分日 JSON 存储、负余额校验、写入恢复记录与备份                               |
| `desktop/location.cjs` | 当前账本路径设置、迁移与切换                                                 |
| `desktop/preload.cjs`  | 只向界面暴露必要的账本 API                                                   |
| `schemas/`             | 公开的账本 JSON Schema                                                       |
| `tests/`               | 持久化、无效备份和主要交互测试                                               |
| `demo与设计/`          | 本机保留的早期交互 demo 和讨论约定，不上传公开仓库；正式程序不读取这里的数据 |
| `release/`             | 本地打包输出和版本说明；ZIP 不提交到 Git                                     |

## 本地开发

```powershell
npm ci
npm test
npm start
```

正常 `npm start` 会打开真实本机账本。**不要用真实账本做自动测试。** `node_modules/electron/dist/electron.exe . --smoke-test` 使用隔离临时目录和空白数据，适合打包前检查。

## Windows 打包和发布

```powershell
npm test
npm run package:win
```

检查 `release/win-unpacked/拾光账本.exe` 能启动，ZIP 包含 EXE 与 `resources/app.asar`，并对 ZIP 计算 SHA-256。每个发布版维护 [CHANGELOG](CHANGELOG.md) 与 [`release/README.md`](../release/README.md)。确认没有账目数据、备份、凭据后，再打 Git tag，并把 ZIP 与 SHA-256 上传到 GitHub Release。

`release/` 中的二进制被 `.gitignore` 排除，GitHub Release 是对外下载入口。不要把本机的账本目录或备份文件放到源码仓库或 Release。

## 数据格式与限制

当前格式是 `schemaVersion: 2` 的目录式 JSON，完整定义见[账本数据规范](DATA_FORMAT.md)及[JSON Schema](../schemas/ledger-v2.schema.json)。类别、账目、资金划转、理财项目使用稳定 ID；账目引用类别 ID。理财项目当前只支持一次投入、一次完整赎回；追加投入和部分赎回需要未来改为项目流水模型。金额保留两位小数，存储前校验。

备份导入在切换前验证类别引用、日期、金额、项目状态与资金池历史余额。若读取现有数据失败，界面停止初始化，避免误建空账本覆盖原数据。日常保存先写未完成操作记录，再按日原子替换相关文件；每天首次覆盖每个文件前保留旧版。账本目录路径单独记录在应用用户数据目录的 `storage-location.json`；迁移先写好新目录，再更新位置设置。本版不兼容 v1 单文件格式。
