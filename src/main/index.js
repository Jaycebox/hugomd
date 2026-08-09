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

    // 先把 WindowManager 实例建出来（内部 _win 还没赋值，但实例本身存在），
    // 然后再注册 IPC —— 否则 handler 闭包里捕获的 window 是 null，
    // dialog.showOpenDialog(window.win, ...) 会 TypeError。
    this.window = new WindowManager({ preload: path.join(__dirname, '..', 'preload', 'index.js') });

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

    await this.window.create();

    // 烟囱测试钩子：HHAPP_SMOKE=create 时自动跑一遍"新建工作区"流程。
    // 仅在 hugomd_SMOKE 环境变量存在时启用，用于回归测试。
    if (process.env.HHAPP_SMOKE === 'create') {
      setTimeout(() => this._runCreateSmoke().catch((e) => {
        process.stderr.write(`[hugomd-smoke] fatal: ${e.stack || e.message}\n`);
      }), 1500);
    } else if (process.env.HHAPP_SMOKE === 'stop-test') {
      // 测试：启动 server -> 停 2s -> stop，观察事件序列
      setTimeout(() => this._runStopTest().catch((e) => {
        process.stderr.write(`[hugomd-stop-test] fatal: ${e.stack || e.message}\n`);
      }), 1500);
    } else if (process.env.HHAPP_SMOKE === 'status-check') {
      // 测试：启动后不做任何操作，观察状态栏文本（复现"启动后无操作就显示 hugo 出错"）
      setTimeout(() => this._runStatusCheck().catch((e) => {
        process.stderr.write(`[hugomd-status-check] fatal: ${e.stack || e.message}\n`);
      }), 1500);
    } else if (process.env.HHAPP_SMOKE === 'create-pick') {
      // 测试：打开新建对话框 -> 把路径输入框改为自定义路径 -> 点创建，
      // 验证工作区创建到自定义路径而非默认路径。
      setTimeout(() => this._runCreatePickSmoke().catch((e) => {
        process.stderr.write(`[hugomd-create-pick] fatal: ${e.stack || e.message}\n`);
      }), 1500);
    } else if (process.env.HHAPP_SMOKE === 'image-flow') {
      // 测试：创建 bundle 帖子 -> 上传图片 -> 读取 -> 插入引用
      setTimeout(() => this._runImageFlowSmoke().catch((e) => {
        process.stderr.write(`[hugomd-image-flow] fatal: ${e.stack || e.message}\n`);
      }), 1500);
    } else if (process.env.HHAPP_SMOKE === 'rename-test') {
      // 测试：复现重命名报 "An object could not be cloned"
      setTimeout(() => this._runInjectSmoke('scripts/inject-rename-test.js', 'hugomd-rename-test').catch((e) => {
        process.stderr.write(`[hugomd-rename-test] fatal: ${e.stack || e.message}\n`);
      }), 1500);
    } else if (process.env.HHAPP_SMOKE === 'rename-fail') {
      // 测试：重命名失败时 IPC 返回 {error} 而非抛 clone 错误
      setTimeout(() => this._runInjectSmoke('scripts/inject-rename-fail.js', 'hugomd-rename-fail').catch((e) => {
        process.stderr.write(`[hugomd-rename-fail] fatal: ${e.stack || e.message}\n`);
      }), 1500);
    } else if (process.env.HHAPP_SMOKE === 'ui-flow') {
      // 测试：真实 UI 点击 加号新建 + 铅笔重命名
      setTimeout(() => this._runInjectSmoke('scripts/inject-ui-flow.js', 'hugomd-ui-flow').catch((e) => {
        process.stderr.write(`[hugomd-ui-flow] fatal: ${e.stack || e.message}\n`);
      }), 1500);
    } else if (process.env.HHAPP_SMOKE === 'create-dbg') {
      // 测试：直接调 files.create/list 排查新建不刷新
      setTimeout(() => this._runInjectSmoke('scripts/inject-create-dbg.js', 'hugomd-create-dbg').catch((e) => {
        process.stderr.write(`[hugomd-create-dbg] fatal: ${e.stack || e.message}\n`);
      }), 1500);
    } else if (process.env.HHAPP_SMOKE === 'delete-test') {
      // 测试：点删除 -> 取消，帖子不应被删除
      setTimeout(() => this._runInjectSmoke('scripts/inject-delete-test.js', 'hugomd-delete-test').catch((e) => {
        process.stderr.write(`[hugomd-delete-test] fatal: ${e.stack || e.message}\n`);
      }), 1500);
    } else if (process.env.HHAPP_SMOKE === 'paste-test') {
      // 测试：模拟 Ctrl+V 粘贴截图 -> 自动保存 + 插入引用
      setTimeout(() => this._runInjectSmoke('scripts/inject-paste-test.js', 'hugomd-paste-test').catch((e) => {
        process.stderr.write(`[hugomd-paste-test] fatal: ${e.stack || e.message}\n`);
      }), 1500);
    }

    this.buildMenu();

    // 启动诊断
    try {
      const bin = await this.hugo.resolve();
      const ver = await this.hugo.checkVersion(bin);
      const src = this.hugo._pickSourceSync();
      process.stderr.write(`[hugomd] hugo: ${ver} (${bin}) [${src}]\n`);
    } catch (e) {
      process.stderr.write(`[hugomd] hugo not found: ${e.message}\n`);
    }
  }

  resolveResourcesDir() {
    if (isDev) {
      return path.join(__dirname, '..', 'resources');
    }
    return path.join(process.resourcesPath, 'resources');
  }

  async _runCreateSmoke() {
    // 模拟真实用户：点击"＋工作区"按钮 -> modal -> 填表单 -> 点"创建"。
    // 走真实 UI 交互路径，能复现用户手动操作遇到的 bug。
    const log = (...a) => process.stderr.write('[hugomd-smoke] ' + a.join(' ') + '\n');
    log('begin (real UI click)');
    const wc = this.window.win && this.window.win.webContents;
    if (!wc) { log('FAILED: no webContents'); return; }
    try {
      const result = await wc.executeJavaScript(`
        (async () => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          const log1 = (...a) => console.warn('[smoke-ui]', ...a);
          const $ = (sel) => document.querySelector(sel);

          // 1. 点击标题栏"＋工作区"按钮
          const btn = $('#btn-new-workspace');
          if (!btn) return { error: 'no #btn-new-workspace' };
          btn.click();
          log1('clicked new-workspace button');

          // 2. 等待 modal 出现
          let modal = null;
          for (let i = 0; i < 30; i++) {
            await sleep(200);
            modal = $('.modal-backdrop .modal');
            if (modal && $('#nw-name')) break;
          }
          if (!modal) return { error: 'workspace modal did not appear' };
          log1('modal appeared, name input exists:', !!$('#nw-name'));
          log1('modal title:', modal.querySelector('.modal-header h2') && modal.querySelector('.modal-header h2').textContent);

          // 3. 填工作区名称
          const nameInput = $('#nw-name');
          if (!nameInput) return { error: 'no #nw-name input' };
          const wsName = 'ui-' + Date.now();
          nameInput.value = wsName;
          log1('filled name:', wsName);

          // 4. 点"创建"按钮
          const createBtn = Array.from(modal.querySelectorAll('.modal-footer button'))
            .find(b => b.textContent.includes('创建'));
          if (!createBtn) return { error: 'create button not found' };
          createBtn.click();
          log1('clicked 创建');

          // 5. 等待流程跑完（创建 + 打开 + hugo server 启动）
          let state = null;
          for (let i = 0; i < 40; i++) {
            await sleep(500);
            if (window.__hugomd_smoke && window.__hugomd_smoke.getState) {
              state = window.__hugomd_smoke.getState();
              if (state.workspaceDir && state.server && state.server.state === 'running') break;
            }
          }
          return {
            uiDone: !document.querySelector('.modal-backdrop'),
            state: state,
          };
        })()
      `, true);
      log('renderer result:', JSON.stringify(result, null, 2));
    } catch (e) {
      log('renderer-driven FAILED:', e.message);
      log(e.stack || '');
    }
  }

  async _runStopTest() {
    const log = (...a) => process.stderr.write('[hugomd-stop-test] ' + a.join(' ') + '\n');
    try {
      const dir = this.workspace.defaultWorkspacesRoot() + '/myblog';
      if (!fs.existsSync(path.join(dir, '.hugomd.json'))) {
        log('no workspace, creating');
        await this.workspace.create({ dir, name: 'myblog', theme: 'minimal' });
      }
      const meta = JSON.parse(fs.readFileSync(path.join(dir, '.hugomd.json'), 'utf8'));
      const siteTemplateDir = await this.workspace.ensureSiteTemplate(meta.theme || 'minimal');
      log('starting server... (template: ' + siteTemplateDir + ')');
      await this.hugoServer.start(dir, { draft: true, siteTemplateDir });
      log('server running, waiting 2s...');
      await new Promise((r) => setTimeout(r, 2000));
      log('stopping server...');
      await this.hugoServer.stop();
      log('stop done, waiting 1s for exit event...');
      await new Promise((r) => setTimeout(r, 1000));
      log('final state:', this.hugoServer.state());
    } catch (e) {
      log('FAILED:', e.message);
    }
  }

  async _runCreatePickSmoke() {
    const log = (...a) => process.stderr.write('[hugomd-create-pick] ' + a.join(' ') + '\n');
    const wc = this.window.win && this.window.win.webContents;
    if (!wc) { log('FAILED: no webContents'); return; }
    const customRoot = process.env.HHAPP_CUSTOM_ROOT;
    log('customRoot:', customRoot);
    // 用 JSON 序列化路径，避免反斜杠在 JS 模板字符串里被转义吞掉
    const customJson = JSON.stringify(customRoot || '');
    try {
      const result = await wc.executeJavaScript(`
        (async () => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          const log1 = (...a) => console.warn('[pick-ui]', ...a);
          const $ = (sel) => document.querySelector(sel);
          const custom = ${customJson};

          const btn = $('#btn-new-workspace');
          if (!btn) return { error: 'no #btn-new-workspace' };
          btn.click();
          log1('clicked new-workspace');

          let modal = null;
          for (let i = 0; i < 30; i++) {
            await sleep(200);
            modal = $('.modal-backdrop .modal');
            if (modal && $('#nw-name')) break;
          }
          if (!modal) return { error: 'modal did not appear' };

          // 真实点击"选择…"按钮（主进程 mock 返回自定义路径）
          const pickBtn = $('#nw-pick');
          if (!pickBtn) return { error: 'no #nw-pick button' };
          pickBtn.click();
          log1('clicked 选择 button');
          await sleep(500);

          const dirInput = $('#nw-dir');
          if (!dirInput) return { error: 'no #nw-dir input' };
          log1('dir input value after pick:', dirInput.value);
          log1('custom expected:', custom);
          if (dirInput.value !== custom) {
            return { error: 'dir input NOT updated after pick', input: dirInput.value, expected: custom };
          }

          // 填名称
          const nameInput = $('#nw-name');
          const wsName = 'pick-' + Date.now();
          nameInput.value = wsName;
          log1('filled name:', wsName);

          // 点创建
          const createBtn = Array.from(modal.querySelectorAll('.modal-footer button'))
            .find(b => b.textContent.includes('创建'));
          if (!createBtn) return { error: 'no create button' };
          createBtn.click();
          log1('clicked 创建');

          // 等待创建完成
          for (let i = 0; i < 40; i++) {
            await sleep(500);
            if (window.__hugomd_smoke && window.__hugomd_smoke.getState) {
              const s = window.__hugomd_smoke.getState();
              if (s.workspaceDir && s.workspaceDir.startsWith(custom)) return { state: s };
            }
          }
          return { note: 'timed out waiting for custom-dir workspace', state: window.__hugomd_smoke && window.__hugomd_smoke.getState() };
        })()
      `, true);
      log('renderer result:', JSON.stringify(result, null, 2));
    } catch (e) {
      log('FAILED:', e.message);
      log(e.stack || '');
    }
  }

  async _runImageFlowSmoke() {
    const log = (...a) => process.stderr.write('[hugomd-image-flow] ' + a.join(' ') + '\n');
    const wc = this.window.win && this.window.win.webContents;
    if (!wc) { log('FAILED: no webContents'); return; }
    const inject = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'inject-image-flow.js'), 'utf8');
    try {
      const result = await wc.executeJavaScript(inject, true);
      log('renderer result:', JSON.stringify(result, null, 2));
    } catch (e) {
      log('FAILED:', e.message);
      log(e.stack || '');
    }
  }

  async _runInjectSmoke(scriptRelPath, logTag) {
    const log = (...a) => process.stderr.write('[' + logTag + '] ' + a.join(' ') + '\n');
    const wc = this.window.win && this.window.win.webContents;
    if (!wc) { log('FAILED: no webContents'); return; }
    const inject = fs.readFileSync(path.join(__dirname, '..', '..', scriptRelPath), 'utf8');
    try {
      const result = await wc.executeJavaScript(inject, true);
      log('renderer result:', JSON.stringify(result, null, 2));
    } catch (e) {
      log('FAILED:', e.message);
      log(e.stack || '');
    }
  }

  async _runStatusCheck() {
    const log = (...a) => process.stderr.write('[hugomd-status-check] ' + a.join(' ') + '\n');
    const wc = this.window.win && this.window.win.webContents;
    if (!wc) { log('FAILED: no webContents'); return; }
    // 等 6s（让自动恢复 workpace / hugo 启动的时序走完），期间不点任何东西
    await new Promise((r) => setTimeout(r, 6000));
    try {
      const text = await wc.executeJavaScript(`
        (function() {
          const el = document.getElementById('server-status');
          if (!el) return 'NO_STATUS_ELEMENT';
          const t = el.querySelector('.text');
          const s = (window.__hugomd_smoke && window.__hugomd_smoke.getState) ? window.__hugomd_smoke.getState() : null;
          return 'className=' + el.className + '|text=' + (t ? t.textContent : 'NO_TEXT') +
                 '|serverState=' + (s && s.server ? s.server.state : 'n/a') +
                 '|workspace=' + (s ? s.workspaceDir : 'n/a');
        })()
      `, true);
      log('status-after-idle => ' + text);
    } catch (e) {
      log('FAILED:', e.message);
    }
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

// 测试/隔离模式下允许覆盖 userData 路径（HHAPP_USER_DATA=<dir>）
if (process.env.HHAPP_USER_DATA) {
  app.setPath('userData', process.env.HHAPP_USER_DATA);
}

app.whenReady().then(() => {
  application.init().catch((err) => {
    console.error('[hugomd] init failed:', err);
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
      console.error('[hugomd] failed to stop hugo server:', err);
    }
    app.quit();
  }
});
