const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

function sameTarget(a, b) {
  return (
    typeof a === "string" &&
    path.win32.normalize(a).toLowerCase() ===
      path.win32.normalize(b).toLowerCase()
  );
}

// Only existing links to this exact executable are changed. Never follow directory links.
async function syncShortcuts({ roots, extraPaths = [], target, icon, shell }) {
  const files = new Set(extraPaths);
  const result = { updated: 0, matched: 0, failed: 0, scanFailed: 0 };
  async function walk(root, depth = 0) {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") result.scanFailed++;
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(root, entry.name);
      if (entry.isDirectory() && depth < 8) await walk(file, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".lnk"))
        files.add(file);
    }
  }
  for (const root of new Set(roots)) await walk(root);
  for (const file of files) {
    let details;
    try {
      details = shell.readShortcutLink(file);
    } catch {
      continue;
    }
    if (!sameTarget(details.target, target)) continue;
    result.matched++;
    if (sameTarget(details.icon, icon) && details.iconIndex === 0) continue;
    try {
      if (!shell.writeShortcutLink(file, "update", { icon, iconIndex: 0 }))
        throw new Error("write failed");
      result.updated++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

function shortcutRoots(app, env = process.env) {
  const roots = [app.getPath("desktop")];
  if (env.PUBLIC) roots.push(path.join(env.PUBLIC, "Desktop"));
  if (env.APPDATA) {
    roots.push(path.join(env.APPDATA, "Microsoft/Windows/Start Menu/Programs"));
    roots.push(
      path.join(
        env.APPDATA,
        "Microsoft/Internet Explorer/Quick Launch/User Pinned",
      ),
    );
  }
  if (env.ProgramData)
    roots.push(
      path.join(env.ProgramData, "Microsoft/Windows/Start Menu/Programs"),
    );
  return roots;
}

function refreshIcons() {
  const executable = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  // Notify Explorer without restarting it or deleting its icon cache.
  const command =
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class LedgerShellNotify { [DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(uint e, uint f, IntPtr a, IntPtr b); }'; [LedgerShellNotify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)";
  return new Promise((resolve) =>
    execFile(
      executable,
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { windowsHide: true, timeout: 15000 },
      (error) => resolve(!error),
    ),
  );
}
module.exports = { syncShortcuts, shortcutRoots, refreshIcons, sameTarget };
