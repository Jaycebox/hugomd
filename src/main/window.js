'use strict';

const { BrowserWindow, shell } = require('electron');
const path = require('path');

class WindowManager {
  constructor({ preload }) {
    this.preload = preload;
    this._win = null;
  }

  async create() {
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 600,
      title: 'hhAPP',
      backgroundColor: '#1e1e1e',
      show: false,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: true,
      },
    });

    win.once('ready-to-show', () => win.show());

    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    this._win = win;
    return win;
  }

  get win() {
    return this._win;
  }

  send(channel, ...args) {
    if (this._win && !this._win.isDestroyed()) {
      this._win.webContents.send(channel, ...args);
    }
  }

  close() {
    if (this._win && !this._win.isDestroyed()) {
      this._win.close();
    }
  }
}

module.exports = WindowManager;
