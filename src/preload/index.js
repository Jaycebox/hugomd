'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 暴露给渲染层的安全 API。
 * 渲染层只能通过 window.hugomd.* 调用主进程能力。
 */
const api = {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    setMany: (obj) => ipcRenderer.invoke('settings:setMany', obj),
  },
  hugo: {
    status: () => ipcRenderer.invoke('hugo:status'),
    resolve: () => ipcRenderer.invoke('hugo:resolve'),
    ensure: () => ipcRenderer.invoke('hugo:ensure'),
    setPath: (p) => ipcRenderer.invoke('hugo:setPath', p),
    clearPath: () => ipcRenderer.invoke('hugo:clearPath'),
    pickPath: () => ipcRenderer.invoke('hugo:pickPath'),
    onDownloadProgress: (cb) => {
      const fn = (_e, p) => cb(p);
      ipcRenderer.on('hugo:download-progress', fn);
      return () => ipcRenderer.removeListener('hugo:download-progress', fn);
    },
  },
  workspace: {
    list: () => ipcRenderer.invoke('workspace:list'),
    exists: (dir) => ipcRenderer.invoke('workspace:exists', dir),
    defaultRoot: () => ipcRenderer.invoke('workspace:defaultRoot'),
    create: (payload) => ipcRenderer.invoke('workspace:create', payload),
    pickDir: () => ipcRenderer.invoke('workspace:pickDir'),
    pickExisting: () => ipcRenderer.invoke('workspace:pickExisting'),
    reveal: (dir) => ipcRenderer.invoke('workspace:reveal', dir),
  },
  server: {
    start: (workspaceDir, options) => ipcRenderer.invoke('server:start', { workspaceDir, options }),
    stop: () => ipcRenderer.invoke('server:stop'),
    status: () => ipcRenderer.invoke('server:status'),
    restart: (workspaceDir) => ipcRenderer.invoke('server:restart', workspaceDir),
    onEvent: (cb) => {
      const fn = (_e, ev) => cb(ev);
      ipcRenderer.on('server:event', fn);
      return () => ipcRenderer.removeListener('server:event', fn);
    },
  },
  files: {
    list: (workspaceDir) => ipcRenderer.invoke('files:list', workspaceDir),
    read: (workspaceDir, relPath) => ipcRenderer.invoke('files:read', workspaceDir, relPath),
    write: (workspaceDir, relPath, content) => ipcRenderer.invoke('files:write', workspaceDir, relPath, content),
    create: (workspaceDir, baseName) => ipcRenderer.invoke('files:create', workspaceDir, baseName),
    delete: (workspaceDir, relPath) => ipcRenderer.invoke('files:delete', workspaceDir, relPath),
    rename: (workspaceDir, relPath, newName) => ipcRenderer.invoke('files:rename', workspaceDir, relPath, newName),
    listImages: (workspaceDir, postPath) => ipcRenderer.invoke('files:listImages', workspaceDir, postPath),
    readImage: (workspaceDir, imagePath) => ipcRenderer.invoke('files:readImage', workspaceDir, imagePath),
    saveImage: (workspaceDir, payload) => ipcRenderer.invoke('files:saveImage', workspaceDir, payload),
    deleteImage: (workspaceDir, imagePath) => ipcRenderer.invoke('files:deleteImage', workspaceDir, imagePath),
    renameImage: (workspaceDir, imagePath, newName) => ipcRenderer.invoke('files:renameImage', workspaceDir, imagePath, newName),
  },
  menu: {
    on: (cb) => {
      const channels = [
        'menu:new-workspace',
        'menu:open-workspace',
        'menu:new-post',
        'menu:toggle-preview',
        'menu:open-settings',
        'menu:reveal-workspace',
      ];
      const offs = channels.map((ch) => {
        const fn = () => cb(ch.replace(/^menu:/, ''));
        ipcRenderer.on(ch, fn);
        return () => ipcRenderer.removeListener(ch, fn);
      });
      return () => offs.forEach((f) => f());
    },
  },
  smoke: {
    runRendererCreate: () => ipcRenderer.invoke('smoke:runRendererCreate'),
  },
};

contextBridge.exposeInMainWorld('hugomd', api);
