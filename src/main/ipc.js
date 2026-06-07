'use strict';

const path = require('path');
const fs = require('fs');
const { ipcMain, dialog, shell, app } = require('electron');

/**
 * 注册所有 IPC 处理器。统一在这里维护 channel 列表。
 * 每个 channel 都是 (event, ...args) => Promise<result>。
 */
function registerIpc(ctx) {
  const { ipcMain, window, hugo, hugoServer, workspace, files, settings, app, shell, dialog } = ctx;

  // ---- 应用 / 设置 ----
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    userData: app.getPath('userData'),
    platform: process.platform,
  }));

  ipcMain.handle('settings:getAll', () => settings.all());
  ipcMain.handle('settings:set', (_e, key, value) => { settings.set(key, value); return true; });
  ipcMain.handle('settings:setMany', (_e, obj) => { settings.setMany(obj || {}); return true; });

  // ---- Hugo ----
  ipcMain.handle('hugo:status', () => hugo.status());
  ipcMain.handle('hugo:resolve', async () => {
    const bin = await hugo.resolve();
    return { path: bin, version: await safe(() => hugo.checkVersion(bin), 'unknown') };
  });
  ipcMain.handle('hugo:ensure', async (event) => {
    const win = window.win;
    const onProgress = (p) => {
      event.sender.send('hugo:download-progress', p);
    };
    const bin = await hugo.ensureBinary({ onProgress });
    return { path: bin, version: await safe(() => hugo.checkVersion(bin), 'unknown') };
  });
  ipcMain.handle('hugo:setPath', async (_e, p) => {
    if (!p) throw new Error('路径不能为空');
    if (!fs.existsSync(p)) throw new Error(`路径不存在: ${p}`);
    settings.set('hugoPath', p);
    return true;
  });
  ipcMain.handle('hugo:clearPath', () => { settings.set('hugoPath', null); return true; });
  ipcMain.handle('hugo:pickPath', async () => {
    const res = await dialog.showOpenDialog(window.win, {
      title: '选择 hugo 可执行文件',
      properties: ['openFile'],
      filters: [{ name: 'Executable', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return res.filePaths[0];
  });

  // ---- 工作区 ----
  ipcMain.handle('workspace:list', () => workspace.list());
  ipcMain.handle('workspace:exists', (_e, dir) => workspace.exists(dir));
  ipcMain.handle('workspace:defaultRoot', () => workspace.defaultWorkspacesRoot());
  ipcMain.handle('workspace:create', async (_e, payload) => {
    const result = await workspace.create(payload || {});
    workspace.markOpened(result.path);
    return result;
  });
  ipcMain.handle('workspace:pickDir', async () => {
    const res = await dialog.showOpenDialog(window.win, {
      title: '选择工作区根目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('workspace:pickExisting', async () => {
    const res = await dialog.showOpenDialog(window.win, {
      title: '选择已存在的工作区',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    if (!workspace.exists(dir)) {
      throw new Error(`所选目录不是 hhAPP 工作区（缺少 hugo.toml）: ${dir}`);
    }
    workspace.markOpened(dir);
    return { path: dir, name: path.basename(dir) };
  });
  ipcMain.handle('workspace:reveal', async (_e, dir) => {
    if (!dir) return false;
    shell.openPath(dir);
    return true;
  });

  // ---- hugo server ----
  ipcMain.handle('server:start', async (_e, { workspaceDir, options }) => {
    const result = await hugoServer.start(workspaceDir, options || {});
    return result;
  });
  ipcMain.handle('server:stop', async () => {
    await hugoServer.stop();
    return true;
  });
  ipcMain.handle('server:status', () => ({
    state: hugoServer.state(),
    baseURL: hugoServer.baseURL,
    port: hugoServer.port,
    workspaceDir: hugoServer.workspaceDir,
  }));
  ipcMain.handle('server:restart', async (_e, workspaceDir) => {
    const result = await hugoServer.restart(workspaceDir);
    return result;
  });

  // 透传 hugo server 日志到渲染层
  hugoServer.on((event) => window.send('server:event', event));

  // ---- 文件 ----
  ipcMain.handle('files:list', async (_e, workspaceDir) => files.list(workspaceDir));
  ipcMain.handle('files:read', async (_e, workspaceDir, relPath) => files.read(workspaceDir, relPath));
  ipcMain.handle('files:write', async (_e, workspaceDir, relPath, content) =>
    files.write(workspaceDir, relPath, content));
  ipcMain.handle('files:create', async (_e, workspaceDir, baseName) =>
    files.create(workspaceDir, baseName));
  ipcMain.handle('files:delete', async (_e, workspaceDir, relPath) =>
    files.delete(workspaceDir, relPath));
  ipcMain.handle('files:rename', async (_e, workspaceDir, relPath, newName) =>
    files.rename(workspaceDir, relPath, newName));
}

async function safe(fn, fallback) {
  try { return await fn(); } catch (e) { return fallback; }
}

module.exports = registerIpc;
