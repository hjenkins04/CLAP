import { BrowserWindow } from 'electron';
import path from 'path';

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;

export function createWindow(): BrowserWindow {
  // Resolve icon: in production the ICO sits next to the exe in resources/,
  // in dev we use the build/ source directly.
  const iconPath = isDev
    ? path.join(__dirname, '../../build/icon.png')
    : path.join(process.resourcesPath, 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 768,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    // __dirname = dist-electron/main/ → go up two levels to reach the app root
    mainWindow.loadFile(
      path.join(__dirname, '../../dist/clap-app/index.html')
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
