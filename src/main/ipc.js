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

  // 包装一层：把 handler 抛出的错误打 stderr 后再抛回去，
  // 避免渲染层收到一个静默失败。
  // 注意：直接 throw Error 对象在部分 Electron 版本会触发
  // "An object could not be cloned"（Error 无法被结构化克隆）。
  // 因此这里把错误转成普通对象 { error: message } 抛出。
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await fn(event, ...args);
      } catch (err) {
        process.stderr.write(`[hhAPP] IPC ${channel} failed: ${err.stack || err.message}\n`);
        throw { error: String((err && err.message) || err) };
      }
    });
  };

  // ---- 应用 / 设置 ----
  handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    userData: app.getPath('userData'),
    platform: process.platform,
  }));

  handle('settings:getAll', () => settings.all());
  handle('settings:set', (_e, key, value) => { settings.set(key, value); return true; });
  handle('settings:setMany', (_e, obj) => { settings.setMany(obj || {}); return true; });

  // ---- Hugo ----
  handle('hugo:status', () => hugo.status());
  handle('hugo:resolve', async () => {
    const bin = await hugo.resolve();
    return { path: bin, version: await safe(() => hugo.checkVersion(bin), 'unknown') };
  });
  handle('hugo:ensure', async (event) => {
    const win = window.win;
    const onProgress = (p) => {
      event.sender.send('hugo:download-progress', p);
    };
    const bin = await hugo.ensureBinary({ onProgress });
    return { path: bin, version: await safe(() => hugo.checkVersion(bin), 'unknown') };
  });
  handle('hugo:setPath', async (_e, p) => {
    if (!p) throw new Error('路径不能为空');
    if (!fs.existsSync(p)) throw new Error('路径不存在: ' + p);
    settings.set('hugoPath', p);
    return true;
  });
  handle('hugo:clearPath', () => { settings.set('hugoPath', null); return true; });
  handle('hugo:pickPath', async () => {
    const res = await dialog.showOpenDialog(window.win, {
      title: '选择 hugo 可执行文件',
      properties: ['openFile'],
      filters: [{ name: 'Executable', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return res.filePaths[0];
  });

  // ---- 工作区 ----
  handle('workspace:list', () => workspace.list());
  handle('workspace:exists', (_e, dir) => workspace.exists(dir));
  handle('workspace:defaultRoot', () => workspace.defaultWorkspacesRoot());
  handle('workspace:create', async (_e, payload) => {
    const result = await workspace.create(payload || {});
    workspace.markOpened(result.path);
    return result;
  });
  handle('workspace:pickDir', async () => {
    // 测试模式：从环境变量注入模拟的所选路径（跳过原生对话框）
    if (process.env.HHAPP_MOCK_PICK_DIR) {
      return process.env.HHAPP_MOCK_PICK_DIR;
    }
    const res = await dialog.showOpenDialog(window.win, {
      title: '选择工作区根目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('workspace:pickExisting', async () => {
    const res = await dialog.showOpenDialog(window.win, {
      title: '选择已存在的工作区',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const dir = res.filePaths[0];
    if (!workspace.exists(dir)) {
      throw new Error('所选目录不是 hhAPP 工作区 (缺少 hugo.toml): ' + dir);
    }
    workspace.markOpened(dir);
    return { path: dir, name: path.basename(dir) };
  });
  handle('workspace:reveal', async (_e, dir) => {
    if (!dir) return false;
    shell.openPath(dir);
    return true;
  });

  // ---- hugo server ----
  handle('server:start', async (_e, payload) => {
    const workspaceDir = payload && payload.workspaceDir;
    const options = (payload && payload.options) || {};
    // 自动附加站点模板目录：从工作区元数据读主题
    if (workspaceDir && !options.siteTemplateDir) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(workspaceDir, '.hhapp.json'), 'utf8'));
        options.siteTemplateDir = await workspace.ensureSiteTemplate(meta.theme || 'minimal');
      } catch (err) {
        process.stderr.write(`[hhAPP] resolve siteTemplateDir failed: ${err.message}\n`);
      }
    }
    const result = await hugoServer.start(workspaceDir, options);
    return result;
  });
  handle('server:stop', async () => {
    await hugoServer.stop();
    return true;
  });
  handle('server:status', () => ({
    state: hugoServer.state(),
    baseURL: hugoServer.baseURL,
    port: hugoServer.port,
    workspaceDir: hugoServer.workspaceDir,
  }));
  handle('server:restart', async (_e, workspaceDir) => {
    const result = await hugoServer.restart(workspaceDir);
    return result;
  });

  // 透传 hugo server 日志到渲染层
  hugoServer.on((event) => {
    if (event && event.type === 'state') {
      process.stderr.write(`[hhAPP-server-event] state=${event.state} baseURL=${event.baseURL || ''} code=${event.code || ''} signal=${event.signal || ''} error=${event.error || ''}\n`);
    }
    window.send('server:event', event);
  });

  // ---- smoke 测试：触发渲染层 flowNewWorkspace ----
  if (process.env.HHAPP_SMOKE_RENDERER === '1') {
    handle('smoke:runRendererCreate', async () => {
      window.send('smoke:runRendererCreate');
      return { triggered: true };
    });
  }

  // ---- 文件 ----
  handle('files:list', async (_e, workspaceDir) => files.list(workspaceDir));
  handle('files:read', async (_e, workspaceDir, relPath) => files.read(workspaceDir, relPath));
  handle('files:write', async (_e, workspaceDir, relPath, content) =>
    files.write(workspaceDir, relPath, content));
  handle('files:create', async (_e, workspaceDir, baseName) =>
    files.create(workspaceDir, baseName));
  handle('files:delete', async (_e, workspaceDir, relPath) =>
    files.delete(workspaceDir, relPath));
  handle('files:rename', async (_e, workspaceDir, relPath, newName) =>
    files.rename(workspaceDir, relPath, newName));

  // ---- 图片资源 ----
  handle('files:listImages', async (_e, workspaceDir, postPath) => files.listImages(workspaceDir, postPath));
  handle('files:readImage', async (_e, workspaceDir, imagePath) => files.readImage(workspaceDir, imagePath));
  // 保存图片：payload = { postPath, fileName, dataBase64 }
  handle('files:saveImage', async (_e, workspaceDir, payload) => {
    const data = Buffer.from(payload.dataBase64, 'base64');
    return files.saveImage(workspaceDir, payload.postPath, payload.fileName, data);
  });
  handle('files:deleteImage', async (_e, workspaceDir, imagePath) => files.deleteImage(workspaceDir, imagePath));
  handle('files:renameImage', async (_e, workspaceDir, imagePath, newName) =>
    files.renameImage(workspaceDir, imagePath, newName));
}

async function safe(fn, fallback) {
  try { return await fn(); } catch (e) { return fallback; }
}

module.exports = registerIpc;
