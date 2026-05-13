import { app, BrowserWindow, dialog, type MessageBoxOptions } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';

// How often to poll for updates after the initial launch check. 4h is the
// "noticeable next time you sit down to work" cadence — frequent enough that
// users with the app open all day still get prompted within a session, rare
// enough that we're not hammering GitHub's API.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let started = false;
// When a check originates from the menu item we want explicit feedback
// ("you're up to date" / "couldn't reach the update server"). For the silent
// background checks we suppress those dialogs and only surface available
// updates. This flag is set just before kicking off a manual check and
// reset by the corresponding event handler — single-flight by design.
let lastCheckWasManual = false;

function showMessage(win: BrowserWindow | null, options: MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  // Make the dialog window-modal when we have a window, sheet-style on macOS;
  // app-modal as a fallback so the message doesn't get lost behind other apps.
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

export function setupAutoUpdater(getWindow: () => BrowserWindow | null): void {
  // electron-updater needs a real packaged + signed .app on disk to know
  // where the current install lives. In `npm run dev` there's no .app, so
  // any check throws "ENOENT app-update.yml". Skip the wiring entirely.
  if (!app.isPackaged) return;
  if (started) return;
  started = true;

  // Confirm before downloading. The default behaviour silently pulls the
  // new build the moment a check finds one, which feels jarring on a
  // metered connection. autoInstallOnAppQuit keeps the "apply on next quit"
  // fallback in case the user dismisses the restart prompt.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err: Error) => {
    console.error('[updater] error:', err?.message ?? err);
    if (lastCheckWasManual) {
      lastCheckWasManual = false;
      void showMessage(getWindow(), {
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not check for updates.',
        detail: err instanceof Error ? err.message : String(err),
        buttons: ['OK'],
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (lastCheckWasManual) {
      lastCheckWasManual = false;
      void showMessage(getWindow(), {
        type: 'info',
        title: 'No Update',
        message: 'Treeline is up to date.',
        detail: `You're running v${app.getVersion()}.`,
        buttons: ['OK'],
      });
    }
  });

  autoUpdater.on('update-available', async (info: UpdateInfo) => {
    lastCheckWasManual = false;
    const { response } = await showMessage(getWindow(), {
      type: 'info',
      title: 'Update Available',
      message: `Treeline ${info.version} is available.`,
      detail: `You're running v${app.getVersion()}. Download the update now?`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) void autoUpdater.downloadUpdate();
  });

  autoUpdater.on('update-downloaded', async (info: UpdateInfo) => {
    const { response } = await showMessage(getWindow(), {
      type: 'info',
      title: 'Update Ready',
      message: `Treeline ${info.version} is ready to install.`,
      detail: 'Restart Treeline now to apply, or it will install the next time you quit.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  // Initial check shortly after launch, then on a slow interval.
  void autoUpdater.checkForUpdates().catch(() => {
    /* errors surface via the 'error' event */
  });
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => {
      /* errors surface via the 'error' event */
    });
  }, CHECK_INTERVAL_MS);
}

export async function checkForUpdatesManual(): Promise<void> {
  const win = BrowserWindow.getFocusedWindow();
  if (!app.isPackaged) {
    void showMessage(win, {
      type: 'info',
      title: 'Updates Disabled',
      message: 'Update checks only run in packaged builds.',
      detail: 'You\'re running a development build; updates are managed by your local git checkout.',
      buttons: ['OK'],
    });
    return;
  }
  lastCheckWasManual = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    // The error event handler shows the dialog and clears the flag.
  }
}
