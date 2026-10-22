const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  session,
} = require("electron");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { LedgerLocation } = require("./location.cjs");
const { Appearance } = require("./appearance.cjs");
const {
  syncShortcuts,
  shortcutRoots,
  refreshIcons,
} = require("./shortcuts.cjs");
let appearance;
let appearanceQueue = Promise.resolve();

const smoke = process.argv.includes("--smoke-test");
let window,
  store,
  location,
  allowClose = false,
  closeRequested = false;
let writeQueue = Promise.resolve();
let smokeRoot;
if (smoke) {
  smokeRoot = require("node:fs").mkdtempSync(
    path.join(os.tmpdir(), "shiguang-smoke-"),
  );
  app.setPath("userData", smokeRoot);
}

if (!app.requestSingleInstanceLock()) app.quit();
else
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

function authorized(event) {
  if (!window || event.sender !== window.webContents)
    throw new Error("非法调用来源");
}

async function syncAppearanceShortcuts() {
  if (smoke || !app.isPackaged || process.platform !== "win32") return null;
  const icon = await appearance.externalIcon();
  const result = await syncShortcuts({
    roots: shortcutRoots(app),
    extraPaths: appearance.shortcuts,
    target: process.execPath,
    icon,
    shell,
  });
  result.refreshed = result.matched > 0 ? await refreshIcons() : true;
  return result;
}

ipcMain.handle("ledger", async (event, method, value) => {
  authorized(event);
  switch (method) {
    case "getAppearance":
      return appearance.type;
    case "setAppearance": {
      appearanceQueue = appearanceQueue
        .catch(() => {})
        .then(async () => {
          const type = await appearance.save(value);
          window.setIcon(appearance.icon());
          try {
            return { type, shortcuts: await syncAppearanceShortcuts() };
          } catch (error) {
            return { type, shortcutError: error.message };
          }
        });
      return appearanceQueue;
    }
    case "createShortcut": {
      await appearanceQueue;
      if (!app.isPackaged)
        throw new Error("请在打包后的 Windows 应用中创建快捷方式");
      const chosen = await dialog.showSaveDialog(window, {
        title: "保存个性化启动快捷方式",
        defaultPath: path.join(app.getPath("desktop"), "拾光账本.lnk"),
        filters: [{ name: "Windows 快捷方式", extensions: ["lnk"] }],
      });
      if (chosen.canceled || !chosen.filePath) return false;
      const icon = await appearance.externalIcon();
      if (
        !shell.writeShortcutLink(chosen.filePath, "create", {
          target: process.execPath,
          cwd: path.dirname(process.execPath),
          icon,
          iconIndex: 0,
          description: `拾光账本 · ${appearance.type}`,
          appUserModelId: "cn.goesm.jpersonalcba",
        })
      )
        throw new Error("快捷方式保存失败");
      await appearance.rememberShortcut(chosen.filePath);
      await refreshIcons();
      return true;
    }
    case "load":
      return location.load();
    case "save": {
      if (!location.ready) throw new Error("账本尚未成功读取，禁止覆盖保存");
      writeQueue = writeQueue.catch(() => {}).then(() => store.save(value));
      await writeQueue;
      return true;
    }
    case "info":
      return location.info();
    case "moveLedger": {
      await writeQueue;
      const chosen = await dialog.showSaveDialog(window, {
        title: "为新账本文件夹选择位置和名称",
        defaultPath: path.join(path.dirname(store.root), "拾光账本"),
      });
      if (chosen.canceled || !chosen.filePath) return null;
      const operation = (writeQueue = writeQueue
        .catch(() => {})
        .then(async () => {
          const result = await location.migrateTo(chosen.filePath);
          store = location.store;
          return result;
        }));
      return operation;
    }
    case "switchLedger": {
      await writeQueue;
      const chosen = await dialog.showOpenDialog(window, {
        title: "选择已有的拾光账本文件夹",
        properties: ["openDirectory"],
      });
      if (chosen.canceled || !chosen.filePaths[0]) return null;
      const confirmation = await dialog.showMessageBox(window, {
        type: "question",
        title: "切换当前账本",
        message: "验证所选文件夹后，将把它作为当前账本。原账本不会删除或覆盖。",
        detail: chosen.filePaths[0],
        buttons: ["取消", "切换账本"],
        defaultId: 0,
        cancelId: 0,
      });
      if (confirmation.response !== 1) return null;
      const operation = (writeQueue = writeQueue
        .catch(() => {})
        .then(async () => {
          const result = await location.useExisting(chosen.filePaths[0]);
          store = location.store;
          return result;
        }));
      return operation;
    }
    case "openDataFolder": {
      await fs.mkdir(store.root, { recursive: true });
      const error = await shell.openPath(store.root);
      if (error) throw new Error(error);
      return true;
    }
    case "export": {
      await writeQueue;
      const result = await dialog.showSaveDialog(window, {
        title: "导出拾光账本备份",
        defaultPath: `拾光账本备份-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON 备份", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return false;
      await store.exportTo(result.filePath);
      return true;
    }
    case "import": {
      await writeQueue;
      const chosen = await dialog.showOpenDialog(window, {
        title: "选择拾光账本备份",
        properties: ["openFile"],
        filters: [{ name: "JSON 备份", extensions: ["json"] }],
      });
      if (chosen.canceled || !chosen.filePaths[0]) return null;
      const confirmation = await dialog.showMessageBox(window, {
        type: "warning",
        title: "确认导入账本",
        message: "导入会替换当前账本。程序会保留原有账本存储代，供故障恢复。",
        buttons: ["取消", "导入并替换"],
        defaultId: 0,
        cancelId: 0,
      });
      if (confirmation.response !== 1) return null;
      return store.importFrom(chosen.filePaths[0]);
    }
    default:
      throw new Error("未知操作");
  }
});

ipcMain.on("close-ready", async (event) => {
  authorized(event);
  try {
    await writeQueue;
    await appearanceQueue;
    allowClose = true;
    window.close();
  } catch (error) {
    closeRequested = false;
    dialog.showMessageBox(window, {
      type: "error",
      title: "账本尚未保存",
      message: `保存失败，程序暂不退出：${error.message}`,
    });
  }
});

async function smokeCheck() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const report = await window.webContents.executeJavaScript(`({
      title: document.title,
      ready: document.querySelector('#data-path')?.textContent?.includes('ledger'),
      pool: document.querySelector('#finance-pool')?.textContent,
      entries: document.querySelector('#record-count')?.textContent,
      categories: document.querySelectorAll('.category-row').length
    })`);
    if (report.ready) {
      console.log(`SMOKE_REPORT ${JSON.stringify(report)}`);
      if (
        report.pool !== "¥ 0.00" ||
        report.entries !== "0" ||
        report.categories < 8
      )
        throw new Error("初始界面数据异常");
      const selected = await window.webContents
        .executeJavaScript(`(async () => {
        await window.ledgerApi.setAppearance('ENFJ');
        return window.ledgerApi.getAppearance();
      })()`);
      if (
        selected !== "ENFJ" ||
        (await new Appearance(smokeRoot).load()) !== "ENFJ"
      )
        throw new Error("形象未持久保存");
      console.log("SMOKE_APPEARANCE ENFJ persisted through IPC");
      const shortcut = path.join(smokeRoot, "test.lnk");
      if (
        !shell.writeShortcutLink(shortcut, "create", {
          target: process.execPath,
          args: "--example",
          description: "keep-description",
          icon: appearance.icon("INTJ"),
          iconIndex: 0,
        })
      )
        throw new Error("测试快捷方式创建失败");
      const icon = await appearance.externalIcon();
      const synced = await syncShortcuts({
        roots: [smokeRoot],
        target: process.execPath,
        icon,
        shell,
      });
      const details = shell.readShortcutLink(shortcut);
      if (
        synced.updated !== 1 ||
        details.icon !== icon ||
        details.args !== "--example" ||
        details.description !== "keep-description"
      )
        throw new Error("快捷方式更新或属性保留异常");
      if (!(await refreshIcons())) throw new Error("系统图标刷新失败");
      console.log(
        "SMOKE_SHORTCUT updated actual Windows link; arguments preserved; refresh succeeded",
      );
      app.quit();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("页面初始化超时");
}

app
  .whenReady()
  .then(async () => {
    const appDataRoot = app.getPath("userData");
    location = await new LedgerLocation(appDataRoot).initialize();
    store = location.store;
    appearance = new Appearance(appDataRoot);
    await appearance.load();
    app.setAppUserModelId("cn.goesm.jpersonalcba");
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    window = new BrowserWindow({
      width: 1320,
      height: 900,
      minWidth: 860,
      minHeight: 660,
      title: "拾光账本",
      icon: appearance.icon(),
      show: !smoke,
      backgroundColor: "#f6f5f1",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("close", (event) => {
      if (allowClose || smoke) return;
      event.preventDefault();
      if (closeRequested) return;
      closeRequested = true;
      window.webContents.send("before-close");
      setTimeout(async () => {
        if (allowClose || !window || window.isDestroyed()) return;
        const result = await dialog.showMessageBox(window, {
          type: "warning",
          title: "无法确认保存状态",
          message: "程序暂时无法确认账本是否已保存。是否直接退出？",
          buttons: ["继续使用", "直接退出"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1) {
          allowClose = true;
          window.close();
        } else closeRequested = false;
      }, 4000);
    });
    if (smoke)
      window.webContents.on("did-finish-load", () =>
        smokeCheck().catch((error) => {
          console.error(error);
          app.exit(1);
        }),
      );
    await window.loadFile(path.join(__dirname, "../src/index.html"));
    appearanceQueue = appearanceQueue
      .catch(() => {})
      .then(() => syncAppearanceShortcuts())
      .catch((error) => console.error("Shortcut sync:", error.message));
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

app.on("window-all-closed", () => app.quit());
app.on("quit", () => {
  if (smokeRoot)
    fs.rm(smokeRoot, { recursive: true, force: true }).catch(() => {});
});
