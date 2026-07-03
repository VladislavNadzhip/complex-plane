const { app, BrowserWindow, nativeImage } = require("electron");
const http = require("http");
const path = require("path");

const isPackaged = app.isPackaged;
const wantDev = process.env.COMPLEX_PLANE_DEV === "1";

function waitForDevServer(url, attempts = 40, intervalMs = 250) {
  return new Promise((resolve) => {
    let left = attempts;
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => {
        left -= 1;
        if (left <= 0) resolve(false);
        else setTimeout(tick, intervalMs);
      });
      req.setTimeout(1500, () => {
        req.destroy();
        left -= 1;
        if (left <= 0) resolve(false);
        else setTimeout(tick, intervalMs);
      });
    };
    tick();
  });
}

function distIndex() {
  return path.join(__dirname, "../dist/index.html");
}

async function resolveLoadTarget() {
  if (isPackaged) return { type: "file", target: distIndex() };
  if (wantDev) {
    const ok = await waitForDevServer("http://127.0.0.1:5173/");
    if (ok) return { type: "url", target: "http://127.0.0.1:5173/" };
  }
  const fs = require("fs");
  if (fs.existsSync(distIndex())) return { type: "file", target: distIndex() };
  return { type: "url", target: "http://127.0.0.1:5173/" };
}

function createWindow() {
  const iconPath = path.join(__dirname, "../public/icon.png");
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0e0e12",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  win.once("ready-to-show", () => win.show());

  resolveLoadTarget().then(({ type, target }) => {
    if (type === "file") win.loadFile(target);
    else win.loadURL(target);
    if (!isPackaged && wantDev) win.webContents.openDevTools({ mode: "detach" });
  });

  win.webContents.on("did-fail-load", async (_e, code, desc, url) => {
    if (code === -102 || String(desc).includes("ERR_CONNECTION_REFUSED")) {
      const fallback = distIndex();
      const fs = require("fs");
      if (fs.existsSync(fallback)) win.loadFile(fallback);
    }
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});