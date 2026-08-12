const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const BACKEND_PORT = Number(process.env.MOBIEER_PORT || 3333);
const DB_URL = process.env.DATABASE_URL || "postgresql://mobieer:mobieer_dev_2026@localhost:5434/mobieer?schema=public";

let mainWindow = null;
let backendProcess = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function isPortUp(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

async function waitForBackend(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isPortUp(BACKEND_PORT)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function startBackend() {
  const entry = path.join(__dirname, "backend", "dist", "server.js");
  const userData = app.getPath("userData");

  backendProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(BACKEND_PORT),
      DATABASE_URL: DB_URL,
      JWT_SECRET: process.env.JWT_SECRET || "mobieer-dev-secret",
      JWT_EXPIRES_IN: "12h",
      FRONTEND_URLS: `http://localhost:${BACKEND_PORT}`,
      NODE_ENV: "production",
    },
    cwd: userData,
    stdio: ["ignore", "pipe", "pipe"],
  });

  backendProcess.stdout.on("data", (d) => console.log("[backend]", String(d).trim()));
  backendProcess.stderr.on("data", (d) => console.error("[backend]", String(d).trim()));

  backendProcess.on("exit", (code) => {
    console.log("[backend] encerrado com código", code);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "MOBIEER",
        "O serviço interno do sistema foi encerrado.\n\nVerifique se o banco de dados PostgreSQL está rodando (docker compose up -d) e reabra o aplicativo."
      );
    }
    app.quit();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: "#16181d",
    icon: path.join(__dirname, "build", "icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://localhost:${BACKEND_PORT}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startBackend();

  const ok = await waitForBackend(25000);
  if (!ok) {
    dialog.showErrorBox(
      "MOBIEER",
      "Não foi possível iniciar o serviço do sistema.\n\nVerifique se o PostgreSQL está rodando (docker compose up -d) e tente novamente."
    );
    app.quit();
    return;
  }

  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("quit", () => {
  if (backendProcess && !backendProcess.killed) {
    try {
      backendProcess.kill();
    } catch {
      /* ignore */
    }
  }
});
