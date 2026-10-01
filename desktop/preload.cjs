const { contextBridge, ipcRenderer } = require("electron");

const invoke = (method, value) => ipcRenderer.invoke("ledger", method, value);
contextBridge.exposeInMainWorld("ledgerApi", {
  load: () => invoke("load"),
  save: (state) => invoke("save", state),
  exportBackup: () => invoke("export"),
  importBackup: () => invoke("import"),
  info: () => invoke("info"),
  moveLedger: () => invoke("moveLedger"),
  switchLedger: () => invoke("switchLedger"),
  openDataFolder: () => invoke("openDataFolder"),
  onBeforeClose: (callback) => ipcRenderer.on("before-close", callback),
  closeReady: () => ipcRenderer.send("close-ready"),
});
