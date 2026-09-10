'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
} = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow = null;
let tray = null;
let rendererWatcher = null;
let reloadTimer = null;

// ─── Tray icon ────────────────────────────────────────────────────────────────

/**
 * Draws a small circular gradient icon (neon → cyan, matching the default
 * theme) directly as a raw BGRA bitmap, so the tray works without shipping a
 * separate .ico/.png asset.
 */
function createTrayIconImage() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const r = size / 2 - 1.5;
  const cx = size / 2;
  const cy = size / 2;
  const colorA = [0x73, 0x00, 0xff]; // R,G,B — matches --acc-a
  const colorB = [0x00, 0xbf, 0xff]; // R,G,B — matches --acc-b
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      if (Math.sqrt(dx * dx + dy * dy) > r) continue;
      const t = x / (size - 1);
      const red = Math.round(colorA[0] + (colorB[0] - colorA[0]) * t);
      const green = Math.round(colorA[1] + (colorB[1] - colorA[1]) * t);
      const blue = Math.round(colorA[2] + (colorB[2] - colorA[2]) * t);
      const i = (y * size + x) * 4;
      buf[i] = blue; buf[i + 1] = green; buf[i + 2] = red; buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function toggleWindowVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else { mainWindow.show(); mainWindow.focus(); }
}

function createTray() {
  tray = new Tray(createTrayIconImage());
  tray.setToolTip('Afterimage — Music Visualizer');
  tray.on('click', () => toggleWindowVisibility());

  const rebuildMenu = () => {
    const menu = Menu.buildFromTemplate([
      { label: mainWindow?.isVisible() ? 'Hide window' : 'Show window', click: () => toggleWindowVisibility() },
      { type: 'separator' },
      { label: 'Play / Pause', click: () => mainWindow?.webContents.send('global-shortcut', 'play-pause') },
      { label: 'Next visualizer', click: () => mainWindow?.webContents.send('global-shortcut', 'next-viz') },
      { label: 'Next color', click: () => mainWindow?.webContents.send('global-shortcut', 'next-color') },
      { type: 'separator' },
      {
        label: 'Always on top',
        type: 'checkbox',
        checked: mainWindow?.isAlwaysOnTop() ?? false,
        click: () => {
          if (!mainWindow) return;
          mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop());
          rebuildMenu();
        },
      },
      { type: 'separator' },
      { label: 'Quit Afterimage', click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
  };
  rebuildMenu();
}

/**
 * Media-key-style global shortcuts, active even when the window isn't
 * focused (e.g. fullscreen on a second monitor). Forwarded to the renderer,
 * which reuses the same logic as its on-screen keyboard shortcuts.
 */
function registerGlobalShortcuts() {
  const bindings = {
    'Alt+Shift+P': 'play-pause',
    'Alt+Shift+]': 'next-viz',
    'Alt+Shift+[': 'prev-viz',
    'Alt+Shift+C': 'next-color',
  };
  for (const [accelerator, action] of Object.entries(bindings)) {
    try {
      globalShortcut.register(accelerator, () => {
        mainWindow?.webContents.send('global-shortcut', action);
      });
    } catch (err) {
      console.error(`[main] failed to register global shortcut ${accelerator}:`, err.message);
    }
  }
}

function watchRenderer() {
  if (rendererWatcher) return;

  rendererWatcher = fs.watch(
    path.join(__dirname, 'renderer'),
    { recursive: true },
    (_event, filename) => {
      // Ignore OneDrive/editor temp files; only reload on actual source changes
      if (!filename || !/\.(js|html|css)$/.test(filename)) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
      }, 300);
    },
  );
}

// ─── Window Creation ──────────────────────────────────────────────────────────

/**
 * Creates the frameless main window.
 * contextIsolation ON; nodeIntegration OFF for security.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#000000',
    show: false,
    // Launch straight into true OS fullscreen (covers the taskbar) instead of a
    // maximized window — width/height above are just the fallback size Electron
    // restores to if the user later exits fullscreen (F / Esc).
    fullscreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Auto-approve media permissions so getUserMedia + desktopCapturer work
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const allowed = ['media', 'audioCapture', 'videoCapture', 'desktopCapture'];
      callback(allowed.includes(permission));
    }
  );

  // Content-Security-Policy — local files only, no eval
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob: data:;",
          ],
        },
      });
    }
  );

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // Native OS fullscreen (setFullScreen) is distinct from the browser Fullscreen
  // API — the renderer can't detect it on its own, so tell it explicitly to hide
  // the custom titlebar. Covers every trigger (our button, F11, OS shortcuts).
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('fullscreen-changed', true));
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('fullscreen-changed', false));

  // Reload automatically if the renderer process crashes
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] Renderer process gone:', details.reason);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    watchRenderer();
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  registerGlobalShortcuts();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  rendererWatcher?.close();
  clearTimeout(reloadTimer);
  globalShortcut.unregisterAll();
});

// ─── IPC: Audio Sources ───────────────────────────────────────────────────────

/**
 * Returns all screen sources from desktopCapturer.
 * On Windows, Chromium/Electron captures WASAPI loopback audio when
 * getUserMedia is called with { chromeMediaSource: 'desktop' }.
 */
ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      fetchWindowIcons: false,
    });
    return sources.map((s) => ({ id: s.id, name: s.name }));
  } catch (err) {
    console.error('[main] desktopCapturer failed:', err.message);
    return [];
  }
});

// ─── IPC: Window Controls ─────────────────────────────────────────────────────

ipcMain.handle('window-minimize', () => mainWindow?.minimize());

ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) { mainWindow.unmaximize(); return false; }
  mainWindow.maximize();
  return true;
});

ipcMain.handle('window-close', () => mainWindow?.close());

ipcMain.handle('window-fullscreen-toggle', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  mainWindow.webContents.send('fullscreen-changed', next);
  return next;
});

ipcMain.handle('window-is-fullscreen', () => {
  return !!mainWindow?.isFullScreen();
});

ipcMain.handle('window-always-on-top-toggle', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next);
  return next;
});
