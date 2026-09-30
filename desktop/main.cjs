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
const { LedgerStore } = require("./storage.cjs");

const smoke = process.argv.includes("--smoke-test");
let window,
  store,
  allowClose = false,
  closeRequested = false;
let writeQueue = Promise.resolve();
let smokeRoot;

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

ipcMain.handle("ledger", async (event, method, value) => {
  authorized(event);
  switch (method) {
    case "load":
      return store.load();
    case "save": {
      writeQueue = writeQueue.catch(() => {}).then(() => store.save(value));
      await writeQueue;
      return true;
    }
    case "info":
      return { dataPath: store.file };
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
        message:
          "导入会替换当前账本。程序会先把旧账本留在本机 backups 文件夹。",
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
      ready: document.querySelector('#data-path')?.textContent?.includes('ledger.json'),
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
    if (smoke) {
      smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "shiguang-smoke-"));
      store = new LedgerStore(smokeRoot);
    } else store = new LedgerStore(path.join(app.getPath("userData"), "data"));
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    window = new BrowserWindow({
      width: 1320,
      height: 900,
      minWidth: 860,
      minHeight: 660,
      title: "拾光账本",
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
