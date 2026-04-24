import { app, BrowserWindow } from 'electron';
import { createWindow } from './window';
import { createSplashWindow, attachSplash } from './splash';
import { registerIpcHandlers, removeIpcHandlers } from './ipc';
import { initAutoUpdater } from './auto-updater';

app.whenReady().then(() => {
  // Show splash immediately, then set up the main window in parallel
  const splash = createSplashWindow();

  registerIpcHandlers();
  const win = createWindow();
  attachSplash(splash, win);
  initAutoUpdater(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  removeIpcHandlers();
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
});
