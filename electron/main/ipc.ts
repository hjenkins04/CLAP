import { ipcMain, app, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { IpcChannels } from '../shared/channels';
import { getMainWindow } from './window';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Resolve a file path that may be a URL route (e.g. /pointclouds/test/edits.bin)
 * to an actual filesystem path. In dev, URL routes map to the public/ directory.
 * Absolute filesystem paths are returned as-is.
 */
function resolveFilePath(filePath: string): string {
  // Already an absolute filesystem path (not a URL route)
  if (filePath.startsWith('/home/') || filePath.startsWith('/tmp/') ||
      filePath.startsWith('/Users/') || /^[A-Z]:\\/.test(filePath)) {
    return filePath;
  }

  // URL route like /pointclouds/test/edits.bin → resolve to public/ or dist/
  if (isDev) {
    return path.join(app.getAppPath(), 'public', filePath);
  }
  return path.join(app.getAppPath(), 'dist', 'clap-app', filePath);
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.GET_APP_VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(IpcChannels.GET_PLATFORM, () => {
    return process.platform;
  });

  ipcMain.handle(IpcChannels.OPEN_FILE_DIALOG, async () => {
    const window = getMainWindow();
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [
        { name: 'Point Cloud Files', extensions: ['las', 'laz'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IpcChannels.READ_FILE, async (_event, args: { path: string }) => {
    try {
      const resolved = resolveFilePath(args.path);
      const data = await fs.promises.readFile(resolved);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } catch {
      return null;
    }
  });

  ipcMain.handle(IpcChannels.SAVE_DIRECTORY_DIALOG, async () => {
    const window = getMainWindow();
    if (!window) return null;

    const result = await dialog.showOpenDialog(window, {
      title: 'Choose save location for edits',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IpcChannels.WRITE_FILE, async (_event, args: { path: string; data: ArrayBuffer }) => {
    const resolved = resolveFilePath(args.path);
    const dir = path.dirname(resolved);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(resolved, Buffer.from(args.data));
  });

  ipcMain.on(IpcChannels.TO_MAIN, (_event, data) => {
    console.log('Received from renderer:', data);
  });
}

export function removeIpcHandlers(): void {
  ipcMain.removeHandler(IpcChannels.GET_APP_VERSION);
  ipcMain.removeHandler(IpcChannels.GET_PLATFORM);
  ipcMain.removeHandler(IpcChannels.OPEN_FILE_DIALOG);
  ipcMain.removeHandler(IpcChannels.READ_FILE);
  ipcMain.removeHandler(IpcChannels.WRITE_FILE);
  ipcMain.removeHandler(IpcChannels.SAVE_DIRECTORY_DIALOG);
  ipcMain.removeAllListeners(IpcChannels.TO_MAIN);
}
