'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposes a safe, typed API bridge to the renderer process.
 * Only the listed methods are accessible via window.electronAPI.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /** Returns desktop capture sources for system audio loopback. */
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

  /** Frameless window chrome controls. */
  windowMinimize:         () => ipcRenderer.invoke('window-minimize'),
  windowMaximize:         () => ipcRenderer.invoke('window-maximize'),
  windowClose:            () => ipcRenderer.invoke('window-close'),
  windowFullscreenToggle: () => ipcRenderer.invoke('window-fullscreen-toggle'),
  windowIsFullscreen:     () => ipcRenderer.invoke('window-is-fullscreen'),
  windowAlwaysOnTopToggle: () => ipcRenderer.invoke('window-always-on-top-toggle'),

  /**
   * Subscribes to global (OS-level) hotkeys and tray-menu actions forwarded
   * from the main process. Returns an unsubscribe function.
   */
  onGlobalShortcut: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('global-shortcut', listener);
    return () => ipcRenderer.removeListener('global-shortcut', listener);
  },

  /**
   * Subscribes to native OS fullscreen enter/leave (distinct from the browser
   * Fullscreen API, which the frameless custom titlebar doesn't respond to
   * on its own). Returns an unsubscribe function.
   */
  onFullscreenChange: (callback) => {
    const listener = (_event, isFullScreen) => callback(isFullScreen);
    ipcRenderer.on('fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('fullscreen-changed', listener);
  },

  /**
   * Spotify "now playing" companion connection — read-only (see spotify-auth.js).
   * `spotifyConnect` opens a browser login and resolves once approved or
   * rejected; `spotifyNowPlaying` is meant to be polled periodically while
   * connected, and resolves to null whenever nothing is currently playing.
   */
  spotifyConnect:    () => ipcRenderer.invoke('spotify-connect'),
  spotifyDisconnect: () => ipcRenderer.invoke('spotify-disconnect'),
  spotifyStatus:     () => ipcRenderer.invoke('spotify-status'),
  spotifyNowPlaying: () => ipcRenderer.invoke('spotify-now-playing'),

  /** Current OS ('win32' | 'darwin' | 'linux'). */
  platform: process.platform,
});
