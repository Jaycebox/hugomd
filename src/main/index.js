'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const WindowManager = require('./window');
const HugoManager = require('./hugo/manager');
const HugoServer = require('./hugo/server');
const WorkspaceManager = require('./workspace/manager');
const FileService = require('./files/service');
const SettingsStore = require('./settings');
const registerIpc = require('./ipc');

const isDev = !app.isPackaged;

class App {
  constructor() {
    this.window = null;
    this.settings = null;
    this.hugo = null;
    this.hugoServer = null;
    this.workspace = null;
    this.files = null;
  }

  async init() {
    this.settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));

    this.hugo = new HugoManager({
      userDataDir: app.getPath('userData'),
      resourcesDir: this.resolveResourcesDir(),
      settings: this.settings,
    });
    await this.hugo.init();

    this.hugoServer = new HugoServer({ hugo: this.hugo });
    this.workspace = new WorkspaceManager({ hugo: this.hugo, settings: this.settings });
    this.files = new FileService();

    // 必须在窗口创建之前注册 IPC：渲染进程在 loadFile 完成后
    // 立即会调用 settings.getAll() 等 IPC。
    registerIpc({
      ipcMain,
      window: this.window,
      hugo: this.hugo,
      hugoServer: this.hugoServer,
      workspace: this.workspace,
      files: this.files,
      settings: this.settings,
      app,
      shell,
      dialog,
    });

    this.window = new WindowManager({ preload: path.join(__dirname, '..', 'preload', 'index.js') });
    await this.window.create();

    this.buildMenu();

    // 启动诊断
    try {
      const bin = await this.hugo.resolve();
      const ver = await this.hugo.checkVersion(bin);
      const src = this.hugo._pickSourceSync();
      process.stderr.write(`[hhAPP] hugo: ${ver} (${bin}) [${src}]\n`);
    } catch (e) {
      process.stderr.write(`[hhAPP] hugo not found: ${e.message}\n`);
    }
  }

  resolveResourcesDir() {
    if (isDev) {
      return path.join(__dirname, '..', 'resources');
    }
    return path.join(process.resourcesPath, 'resources');
  }

  buildMenu() {
    const isMac = process.platform === 'darwin';
    const template = [
      ...(isMac ? [{ role: 'appMenu' }] : []),
      {
        label: '文件',
        submenu: [
          {
            label: '新建工作区',
            accelerator: 'CmdOrCtrl+Shift+N',
            click: () => this.window.send('menu:new-workspace'),
          },
          {
            label: '打开工作区',
            accelerator: 'CmdOrCtrl+Shift+O',
            click: () => this.window.send('menu:open-workspace'),
          },
          { type: 'separator' },
          {
            label: '新建笔记',
            accelerator: 'CmdOrCtrl+N',
            click: () => this.window.send('menu:new-post'),
          },
          { type: 'separator' },
          isMac ? { role: 'close' } : { role: 'quit' },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: '视图',
        submenu: [
          {
            label: '切换预览',
            accelerator: 'CmdOrCtrl+P',
            click: () => this.window.send('menu:toggle-preview'),
          },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: '设置',
        submenu: [
          {
            label: '偏好设置',
            accelerator: 'CmdOrCtrl+,',
            click: () => this.window.send('menu:open-settings'),
          },
          {
            label: '在文件管理器中打开工作区',
            click: () => this.window.send('menu:reveal-workspace'),
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
}

const application = new App();

app.whenReady().then(() => {
  application.init().catch((err) => {
    console.error('[hhAPP] init failed:', err);
    dialog.showErrorBox('启动失败', err.stack || String(err));
    app.quit();
  });
});

app.on('window-all-closed', async () => {
  try {
    if (application.hugoServer) await application.hugoServer.stop();
  } catch (e) {
    /* noop */
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && application.window) {
    application.window.create();
  }
});

app.on('before-quit', async (e) => {
  if (application.hugoServer && application.hugoServer.isRunning()) {
    e.preventDefault();
    try {
      await application.hugoServer.stop();
    } catch (err) {
      console.error('[hhAPP] failed to stop hugo server:', err);
    }
    app.quit();
  }
});
