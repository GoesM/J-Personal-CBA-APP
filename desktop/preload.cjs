const { contextBridge, ipcRenderer } = require("electron");

const invoke = (method, value) => ipcRenderer.invoke("ledger", method, value);
contextBridge.exposeInMainWorld("ledgerApi", {
  aiRates: (value) => invoke("aiRates", value),
  aiInfo: (value) => invoke("aiInfo", value),
  aiConfigure: (value) => invoke("aiConfigure", value),
  aiModels: (value) => invoke("aiModels", value),
  aiUsage: (value) => invoke("aiUsage", value),
  aiHistory: (value) => invoke("aiHistory", value),
  aiTurn: (value) => invoke("aiTurn", value),
  aiApply: (value) => invoke("aiApply", value),
  aiDiscard: (value) => invoke("aiDiscard", value),
  getAppearance: () => invoke("getAppearance"),
  setAppearance: (type) => invoke("setAppearance", type),
  createShortcut: () => invoke("createShortcut"),
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
