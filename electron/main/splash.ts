import { BrowserWindow, screen } from 'electron';
import path from 'path';
import fs from 'fs';

const isDev = process.env.NODE_ENV === 'development';
const SPLASH_DURATION_MS = 3000;

function getIconPath(): string {
  return isDev
    ? path.join(__dirname, '../../build/icon.png')
    : path.join(process.resourcesPath, 'icon.png');
}

function buildSplashHtml(iconB64: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background: #0d1117;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    overflow: hidden;
    user-select: none;
    -webkit-app-region: drag;
  }
  .logo {
    width: 140px;
    height: 140px;
    border-radius: 28px;
    margin-bottom: 28px;
    animation: fadeIn 0.35s ease-out;
  }
  .title {
    color: #f0f6fc;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 0.04em;
    animation: fadeIn 0.35s ease-out 0.1s both;
  }
  .subtitle {
    color: #8b949e;
    font-size: 12px;
    margin-top: 6px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    animation: fadeIn 0.35s ease-out 0.2s both;
  }
  .bar-track {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 3px;
    background: #161b22;
  }
  .bar-fill {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #2d81f7, #58a6ff);
    border-radius: 0 2px 2px 0;
    animation: progress ${SPLASH_DURATION_MS}ms linear forwards;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes progress {
    from { width: 0%; }
    to   { width: 100%; }
  }
</style>
</head>
<body>
  <img class="logo" src="data:image/png;base64,${iconB64}" alt="CLAP"/>
  <div class="title">CLAP</div>
  <div class="subtitle">LiDAR Segmentation Platform</div>
  <div class="bar-track"><div class="bar-fill"></div></div>
</body>
</html>`;
}

export function createSplashWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const splash = new BrowserWindow({
    width: 420,
    height: 280,
    x: Math.round((width - 420) / 2),
    y: Math.round((height - 280) / 2),
    frame: false,
    transparent: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: true,                // show immediately — no ready-to-show delay
    backgroundColor: '#0d1117',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Inline the logo so there are zero additional file loads
  let iconB64 = '';
  try {
    iconB64 = fs.readFileSync(getIconPath()).toString('base64');
  } catch {
    // icon missing — splash still shows without image
  }

  splash.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildSplashHtml(iconB64))}`
  );

  return splash;
}

/**
 * Wait until both the 3-second minimum AND the main window's ready-to-show
 * event have fired, then close the splash and reveal the main window.
 */
export function attachSplash(
  splash: BrowserWindow,
  mainWindow: BrowserWindow,
): void {
  let timerDone = false;
  let windowReady = false;

  function tryReveal() {
    if (!timerDone || !windowReady) return;
    if (!splash.isDestroyed()) splash.close();
    if (!mainWindow.isDestroyed()) mainWindow.show();
  }

  setTimeout(() => {
    timerDone = true;
    tryReveal();
  }, SPLASH_DURATION_MS);

  mainWindow.once('ready-to-show', () => {
    windowReady = true;
    tryReveal();
  });
}
