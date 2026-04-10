import { app, BrowserWindow } from 'electron';
import { createWindow } from './window';
import { registerIpcHandlers, removeIpcHandlers } from './ipc';
import { initAutoUpdater } from './auto-updater';

app.whenReady().then(() => {
  registerIpcHandlers();
  const win = createWindow();
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
