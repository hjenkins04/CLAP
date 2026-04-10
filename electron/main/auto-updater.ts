import { autoUpdater } from 'electron-updater';
import { dialog, app } from 'electron';
import type { BrowserWindow } from 'electron';
import log from 'electron-log/main';

// Route electron-updater logs through electron-log (written to userData/logs/)
autoUpdater.logger = log;
log.transports.file.level = 'info';

// Don't silently download — ask the user first
autoUpdater.autoDownload = false;
// If the user clicks "Later" on the install prompt, install on next quit
autoUpdater.autoInstallOnAppQuit = true;

export function initAutoUpdater(win: BrowserWindow): void {
  // Skip update checks in dev — Vite dev server is not a packaged app
  if (!app.isPackaged) return;

  // ── Event handlers ────────────────────────────────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] Checking for update…');
  });

  autoUpdater.on('update-not-available', () => {
    log.info('[updater] No update available.');
  });

  autoUpdater.on('update-available', (info) => {
    log.info(`[updater] Update available: ${info.version}`);

    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} is available`,
      detail: 'A new version has been released. Would you like to download it now?\n\nThe app will restart automatically once the download is complete.',
      buttons: ['Download Now', 'Remind Me Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.downloadUpdate().catch((err: Error) => {
          log.error('[updater] Download failed:', err.message);
        });
      }
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    log.info(`[updater] Download progress: ${Math.round(progress.percent)}%`);
    win.setProgressBar(progress.percent / 100);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`[updater] Update ${info.version} downloaded.`);
    win.setProgressBar(-1); // clear taskbar progress

    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Ready to Install',
      message: `Version ${info.version} is ready`,
      detail: 'The update has been downloaded. The application will restart to apply it.',
      buttons: ['Restart Now', 'Install on Next Launch'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        // false = don't run after install; true = force quit all windows
        autoUpdater.quitAndInstall(false, true);
      }
    });
  });

  autoUpdater.on('error', (err) => {
    log.error('[updater] Error:', err.message);
    win.setProgressBar(-1);
  });

  // ── Scheduled checks ──────────────────────────────────────────────────────

  // Wait 5 seconds after launch before the first check so the app feels snappy
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      log.error('[updater] Check failed:', err.message);
    });
  }, 5_000);

  // Re-check every 4 hours while the app is open
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      log.error('[updater] Periodic check failed:', err.message);
    });
  }, 4 * 60 * 60 * 1_000);
}
