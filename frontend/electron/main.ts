import { app, BrowserWindow, ipcMain, shell } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "path";

import { dialog } from "electron";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null;

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  // Test active push message to Renderer-process.
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

let python: ReturnType<typeof spawn> | null = null;

function startPythonProcess() {
  python = spawn("python", [path.join(__dirname, "../../server/monitor.py")], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  python.stdout?.on("data", (data) => {
    const res = data.toString().trim();
    console.log(`[PYTHON STDOUT]: ${res}\n`);
    // if (res.startsWith(".SCAN_RESULT.") && res.endsWith(".END.")) {
    //   // resolve(res); // Send the result back to renderer
    //   win?.webContents.send("scan-result", res);
    // } else if (res.startsWith(".LIST.") && res.endsWith(".END.")) {
    //   win?.webContents.send(res.slice(6, -6));
    // }
  });

  python.stderr?.on("data", (data) => {
    console.error("[PYTHON STDERR]", data.toString());
  });

  python.on("exit", (code) => {
    console.warn(`[Python exited with code ${code}]`);
    python = null;
  });
}

ipcMain.handle("scannedFile", async () => {
  if (python && python.stdin?.writable) python.stdin.write(`scan\n`);

  return new Promise((resolve) => {
    if (python) {
      python.stdout?.once("data", (data) => {
        const res = data.toString().trim();
        if (res.startsWith(".SCAN_RESULTS.") && res.endsWith(".END.")) {
          // console.log(res.slice(14, -5));
          resolve(res.slice(14, -5));
        }
      });
    } else {
      resolve("Python process not running or stdout not readable.");
    }
  });
});

ipcMain.handle("list", async () => {
  if (python && python.stdin?.writable) {
    python.stdin.write(`list\n`);

    return new Promise((resolve) => {
      if (python)
        python.stdout?.once("data", (data) => {
          const result = data.toString().trim();
          if (result.startsWith(".LIST.") && result.endsWith(".END.")) {
            console.log(result.slice(6, -5));
            resolve(result.slice(6, -5));
          }
        });
    });
  } else {
    return "Python process not ready";
  }
});

ipcMain.handle("addFolder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  if (python && python.stdin?.writable) {
    python.stdin.write(`add ${result.filePaths[0]}\n`);
  }
  return result;
});

ipcMain.handle("openPath", async (e, path: string) => {
  e.preventDefault();
  shell.showItemInFolder(path);
});

ipcMain.handle("removeFolder", async (e, path: string) => {
  e.preventDefault();
  if (python && python.stdin?.writable) {
    python.stdin.write(`remove ${path}`);
  }
});

app.whenReady().then(() => {
  createWindow();
  startPythonProcess();
});
