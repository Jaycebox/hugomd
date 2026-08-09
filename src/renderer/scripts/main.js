'use strict';

/**
 * hugomd 渲染层主入口。
 * 职责：
 *   1. 初始化 Monaco、Sidebar、Preview
 *   2. 监听菜单事件
 *   3. 编排：工作区切换 / 文件加载保存 / hugo server 启停 / 预览刷新
 */

(function () {
  const $ = (id) => document.getElementById(id);

  // 统一错误信息提取：兼容 Error 对象和 IPC 返回的 { error: string }
  function errMsg(e) {
    if (!e) return '未知错误';
    if (typeof e === 'string') return e;
    if (typeof e === 'object' && typeof e.error === 'string') return e.error;
    if (typeof e === 'object' && e.message) return e.message;
    return String(e);
  }
  window.HHerrMsg = errMsg;

  const Store = {
    state: {
      workspaceDir: null,
      workspaceName: null,
      theme: 'minimal',
      files: [],
      currentFile: null,
      currentContent: '',
      dirty: false,
      saving: false,
      server: { state: 'idle', baseURL: null, port: null },
      previewVisible: true,
      hugo: { source: 'path', version: null },
    },
  };

  // ============= 启动 =============

  async function bootstrap() {
    bindStaticUI();
    bindMenuEvents();
    bindServerEvents();

    try {
      await window.HHEditor.init();
    } catch (e) {
      console.error('Monaco init failed:', e);
      window.HHDialogs.toast({ message: '编辑器初始化失败: ' + window.HHerrMsg(e), type: 'error', duration: 5000 });
      return;
    }
    window.HHEditor.mount($('editor-container'), '');
    window.HHEditor.onChange(handleEditorChange);
    window.HHEditor.onCursor(handleCursorChange);

    await tryRestoreLastSession();
  }

  // ============= UI 绑定 =============

  function bindStaticUI() {
    $('btn-new-workspace').addEventListener('click', () => flowNewWorkspace());
    $('btn-open-workspace').addEventListener('click', () => flowOpenWorkspace());
    $('btn-settings').addEventListener('click', () => flowSettings());
    $('btn-toggle-preview').addEventListener('click', () => togglePreview());
    $('btn-new-post').addEventListener('click', () => createNewPost());
    $('btn-reveal-workspace').addEventListener('click', () => revealWorkspace());
    $('btn-empty-new').addEventListener('click', () => flowNewWorkspace());
    $('btn-image').addEventListener('click', () => manageCurrentImages());

    window.HHSidebar.init({
      listEl: $('file-list'),
      onSelect: (file) => openFile(file),
      onCreate: () => createNewPost(),
      onDelete: (file) => deleteFile(file),
      onRename: (file, newName) => renameFile(file, newName),
      onReveal: () => revealWorkspace(),
    });

    window.HHPreview.init({
      frameEl: $('preview-frame'),
      placeholderEl: $('preview-placeholder'),
      rootEl: $('preview-pane'),
    });

    // 粘贴截图：Win+Shift+S 截图后直接在编辑器 Ctrl+V，
    // 自动保存到当前帖子目录并插入 ![](ref)
    document.addEventListener('paste', handlePaste, true);
  }

  function bindMenuEvents() {
    window.hugomd.menu.on((action) => {
      switch (action) {
        case 'new-workspace': flowNewWorkspace(); break;
        case 'open-workspace': flowOpenWorkspace(); break;
        case 'new-post': createNewPost(); break;
        case 'toggle-preview': togglePreview(); break;
        case 'open-settings': flowSettings(); break;
        case 'reveal-workspace': revealWorkspace(); break;
      }
    });
  }

  function bindServerEvents() {
    window.hugomd.hugo.onDownloadProgress((p) => {
      if (p.stage === 'start') {
        window.HHDialogs.toast({ message: '开始下载 Hugo: ' + p.url, duration: 4000 });
      } else if (p.stage === 'progress') {
        const pct = Math.round((p.received / p.total) * 100);
        setStatus('下载 Hugo: ' + pct + '%');
      } else if (p.stage === 'done') {
        setStatus('Hugo 下载完成');
      }
    });
    let _crashToastTimer = null;
    window.hugomd.server.onEvent((ev) => {
      if (ev.type === 'state') {
        Store.state.server = { state: ev.state, baseURL: ev.baseURL, port: ev.port };
        renderServerStatus();
        if (ev.state === 'running' && ev.baseURL) {
          window.HHPreview.setBaseURL(ev.baseURL, Store.state.currentFile && Store.state.currentFile.path);
        } else if (ev.state === 'stopped' || ev.state === 'crashed' || ev.state === 'error') {
          window.HHPreview.setBaseURL(null);
        }
        // 意外崩溃：若 2s 内没有新的 starting（自动重试），说明已耗尽，给出明确提示
        if (ev.state === 'crashed') {
          if (_crashToastTimer) clearTimeout(_crashToastTimer);
          _crashToastTimer = setTimeout(() => {
            window.HHDialogs.toast({
              message: 'hugo 预览服务已停止，请检查工作区内容（front matter / markdown）',
              type: 'error',
              duration: 6000,
            });
          }, 2000);
        } else if (ev.state === 'starting' || ev.state === 'running') {
          if (_crashToastTimer) { clearTimeout(_crashToastTimer); _crashToastTimer = null; }
        }
      } else if (ev.type === 'log') {
        // reserved
      } else if (ev.type === 'error-log') {
        console.warn('[hugo]', ev.line);
      }
    });
  }

  // ============= 状态渲染 =============

  function renderServerStatus() {
    const el = $('server-status');
    const s = Store.state.server.state;
    el.classList.remove('running', 'starting', 'error');
    let text = 'hugo 未运行';
    if (s === 'starting') { text = 'hugo 启动中'; el.classList.add('starting'); }
    else if (s === 'running') { text = 'hugo: ' + Store.state.server.baseURL; el.classList.add('running'); }
    else if (s === 'error') { text = 'hugo 启动失败'; el.classList.add('error'); }
    else if (s === 'crashed') { text = 'hugo 已停止'; el.classList.add('error'); }
    el.querySelector('.text').textContent = text;
  }

  function renderWorkspaceName() {
    const el = $('workspace-name');
    el.textContent = Store.state.workspaceName
      ? Store.state.workspaceName + ' · ' + Store.state.workspaceDir
      : '未打开工作区';
  }

  function setStatus(text) { $('status-left').textContent = text; }

  // ============= 工作区流程 =============

  async function tryRestoreLastSession() {
    const all = await window.hugomd.settings.getAll();
    if (all.lastWorkspace && await window.hugomd.workspace.exists(all.lastWorkspace)) {
      await openWorkspace(all.lastWorkspace, { silent: true });
    }
  }

  async function flowNewWorkspace() {
    if (Store.state.workspaceDir) {
      const ok = await window.HHDialogs.confirm({
        title: '新建工作区',
        message: '当前工作区会先被关闭。是否继续？',
        okText: '继续',
      });
      if (!ok) return;
      await closeCurrentWorkspace();
    }
    const defaultRoot = await window.hugomd.workspace.defaultRoot();
    const settings = await window.hugomd.settings.getAll();
    const result = await window.HHDialogs.newWorkspace({
      defaultRoot,
      themes: ['minimal', 'terminal', 'paper'],
      defaultTheme: settings.lastTheme || 'minimal',
      existingNames: (await window.hugomd.workspace.list()).map(w => w.name),
    });
    if (!result) return;
    console.warn('[hugomd-flow] new-workspace result:', result);
    try {
      const ws = await window.hugomd.hugo.ensure();
      console.warn('[hugomd-flow] hugo ensure OK:', ws.path);
      Store.state.hugo = { source: ws.path, version: ws.version };
      const created = await window.hugomd.workspace.create(result);
      console.warn('[hugomd-flow] workspace create OK:', created.path);
      await window.hugomd.settings.setMany({ lastWorkspace: created.path, lastTheme: result.theme });
      await openWorkspace(created.path, { silent: true });
      window.HHDialogs.toast({ message: '已创建工作区: ' + created.name, type: 'success' });
    } catch (e) {
      console.warn('[hugomd-flow] CREATE FAILED:', e.stack || window.HHerrMsg(e));
      window.HHDialogs.toast({ message: '创建失败: ' + window.HHerrMsg(e), type: 'error', duration: 5000 });
    }
  }

  async function flowOpenWorkspace() {
    const res = await window.hugomd.workspace.pickExisting();
    if (!res) return;
    if (Store.state.workspaceDir) await closeCurrentWorkspace();
    await openWorkspace(res.path, { silent: true });
  }

  async function openWorkspace(dir, options) {
    options = options || {};
    const silent = options.silent;
    Store.state.workspaceDir = dir;
    Store.state.workspaceName = dir.split(/[\\/]/).pop();
    renderWorkspaceName();
    try {
      const files = await window.hugomd.files.list(dir);
      Store.state.files = files;
      window.HHSidebar.setFiles(files);
      $('editor-empty').style.display = 'none';
      $('editor-container').style.display = '';
      $('editor-status').style.display = '';
      $('editor-toolbar').style.display = '';
      if (files.length > 0) {
        await openFile(files[0]);
      } else {
        window.HHEditor.setValue('');
        $('doc-path').textContent = '';
        $('save-state').textContent = '已保存';
      }
      const ws = await window.hugomd.hugo.ensure();
      Store.state.hugo = { source: ws.path, version: ws.version };
      try {
        await window.hugomd.server.start(dir, { draft: true });
        setStatus('hugo server 已在 ' + ws.path + ' 启动');
      } catch (e) {
        window.HHDialogs.toast({ message: 'hugo server 启动失败: ' + window.HHerrMsg(e), type: 'error', duration: 5000 });
        setStatus('hugo 启动失败');
      }
      if (!silent) window.HHDialogs.toast({ message: '已打开: ' + Store.state.workspaceName, type: 'success' });
    } catch (e) {
      window.HHDialogs.toast({ message: '打开失败: ' + window.HHerrMsg(e), type: 'error', duration: 5000 });
    }
  }

  async function closeCurrentWorkspace() {
    try { await window.hugomd.server.stop(); } catch (_) { /* noop */ }
    window.HHPreview.setBaseURL(null);
    window.HHEditor.setValue('');
    window.HHSidebar.setFiles([]);
    Store.state.workspaceDir = null;
    Store.state.workspaceName = null;
    Store.state.currentFile = null;
    Store.state.currentContent = '';
    $('editor-empty').style.display = '';
    $('editor-container').style.display = 'none';
    $('editor-status').style.display = 'none';
    $('editor-toolbar').style.display = 'none';
    renderWorkspaceName();
  }

  async function flowSettings() {
    const status = await window.hugomd.hugo.status();
    await window.HHDialogs.settings({ hugoStatus: status });
  }

  function togglePreview() {
    Store.state.previewVisible = !Store.state.previewVisible;
    document.querySelector('.main').classList.toggle('no-preview', !Store.state.previewVisible);
    window.HHPreview.setVisible(Store.state.previewVisible);
  }

  function revealWorkspace() {
    if (Store.state.workspaceDir) window.hugomd.workspace.reveal(Store.state.workspaceDir);
  }

  // ============= 文件流程 =============

  async function openFile(file) {
    if (Store.state.dirty && Store.state.currentFile) {
      await saveCurrent();
    }
    try {
      const result = await window.hugomd.files.read(Store.state.workspaceDir, file.path);
      const content = result.content;
      Store.state.currentFile = file;
      Store.state.currentContent = content;
      Store.state.dirty = false;
      window.HHEditor.setValue(content);
      window.HHSidebar.setActive(file.path);
      $('doc-path').textContent = file.path;
      $('save-state').textContent = '已保存';
      $('save-state').className = '';
      window.HHEditor.focus();
      if (Store.state.server.state === 'running') {
        window.HHPreview.setBaseURL(Store.state.server.baseURL, file.path);
      }
      setStatus('已打开 ' + file.name);
    } catch (e) {
      window.HHDialogs.toast({ message: '读取失败: ' + window.HHerrMsg(e), type: 'error' });
    }
  }

  async function createNewPost() {
    if (!Store.state.workspaceDir) {
      window.HHDialogs.toast({ message: '请先打开或创建一个工作区', type: 'error' });
      return;
    }
    try {
      const baseName = await window.HHDialogs.prompt({
        title: '新建笔记',
        message: '输入文件名(不含 .md)',
        defaultValue: 'untitled',
        okText: '创建',
      });
      if (!baseName) return;
      const created = await window.hugomd.files.create(Store.state.workspaceDir, baseName);
      const files = await window.hugomd.files.list(Store.state.workspaceDir);
      Store.state.files = files;
      window.HHSidebar.setFiles(files);
      const newFile = files.find(f => f.path === created.path);
      if (newFile) await openFile(newFile);
    } catch (e) {
      window.HHDialogs.toast({ message: '创建失败: ' + window.HHerrMsg(e), type: 'error' });
    }
  }

  async function deleteFile(file) {
    if (!Store.state.workspaceDir) return;
    try {
      await window.hugomd.files.delete(Store.state.workspaceDir, file.path);
      const files = await window.hugomd.files.list(Store.state.workspaceDir);
      Store.state.files = files;
      window.HHSidebar.setFiles(files);
      if (Store.state.currentFile && Store.state.currentFile.path === file.path) {
        if (files.length > 0) {
          await openFile(files[0]);
        } else {
          window.HHEditor.setValue('');
          Store.state.currentFile = null;
          $('doc-path').textContent = '';
        }
      }
      window.HHDialogs.toast({ message: '已删除', type: 'success' });
    } catch (e) {
      window.HHDialogs.toast({ message: '删除失败: ' + window.HHerrMsg(e), type: 'error' });
    }
  }

  async function renameFile(file, newName) {
    if (!Store.state.workspaceDir) return;
    try {
      const result = await window.hugomd.files.rename(Store.state.workspaceDir, file.path, newName);
      const files = await window.hugomd.files.list(Store.state.workspaceDir);
      Store.state.files = files;
      window.HHSidebar.setFiles(files);
      if (Store.state.currentFile && Store.state.currentFile.path === file.path) {
        const newFile = files.find(f => f.path === result.newPath);
        if (newFile) {
          Store.state.currentFile = newFile;
          window.HHSidebar.setActive(result.newPath);
          $('doc-path').textContent = result.newPath;
        }
      }
      window.HHDialogs.toast({ message: '已重命名', type: 'success' });
    } catch (e) {
      window.HHDialogs.toast({ message: '重命名失败: ' + window.HHerrMsg(e), type: 'error' });
    }
  }

  async function manageImages(file) {
    if (!Store.state.workspaceDir) return;
    await window.HHDialogs.images({
      workspaceDir: Store.state.workspaceDir,
      postPath: file.path,
      onInsert: (ref) => insertImageRef(ref),
    });
  }

  // 工具栏"图片"按钮：管理当前打开帖子的图片
  async function manageCurrentImages() {
    if (!Store.state.workspaceDir || !Store.state.currentFile) {
      window.HHDialogs.toast({ message: '请先打开一个帖子', type: 'info' });
      return;
    }
    await manageImages(Store.state.currentFile);
  }

  // 在编辑器光标处插入图片引用 ![](ref)
  function insertImageRef(ref) {
    const snippet = '\n\n![](' + ref + ')\n\n';
    if (window.HHEditor && window.HHEditor.insertText) {
      window.HHEditor.insertText(snippet);
    }
  }

  // ============= 粘贴截图 =============

  const PASTE_EXT_BY_MIME = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };

  function pad2(n) { return String(n).padStart(2, '0'); }

  // 生成可读文件名: 截图-20260809-215530.png
  function pasteFileName(mime) {
    const d = new Date();
    const stamp = '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    const ext = PASTE_EXT_BY_MIME[mime] || 'png';
    return '截图-' + stamp + '.' + ext;
  }

  // 处理 Ctrl+V：剪贴板里有图片时拦截，保存到当前帖子目录并插入引用。
  // 没有图片则放行（正常文本粘贴）。
  async function handlePaste(e) {
    const ws = Store.state.workspaceDir;
    const file = Store.state.currentFile;
    if (!ws || !file) return; // 没打开帖子时不影响其他输入框的粘贴
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const imageItems = Array.from(items).filter((it) => it.kind === 'file' && it.type && it.type.startsWith('image/'));
    if (imageItems.length === 0) return; // 纯文本粘贴，放行

    e.preventDefault(); // 图片粘贴：交给下面的保存流程
    e.stopPropagation();

    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (!blob) continue;
      try {
        const dataBase64 = await readBlobAsBase64(blob);
        const fileName = pasteFileName(item.type);
        const saved = await window.hugomd.files.saveImage(ws, { postPath: file.path, fileName, dataBase64 });
        insertImageRef(saved.ref);
        window.HHDialogs.toast({ message: '已粘贴截图: ' + saved.ref, type: 'success' });
        // 通知图片管理对话框刷新（如果正开着）
        window.dispatchEvent(new CustomEvent('hugomd:image-saved'));
      } catch (err) {
        console.error('[hugomd] paste image failed:', err);
        window.HHDialogs.toast({ message: '粘贴图片失败: ' + window.HHerrMsg(err), type: 'error', duration: 5000 });
      }
    }
  }

  function readBlobAsBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
      reader.readAsDataURL(blob);
    });
  }

  // ============= 编辑器事件 =============

  let _saveTimer = null;
  function handleEditorChange(newContent) {
    Store.state.dirty = true;
    Store.state.currentContent = newContent;
    $('save-state').textContent = '编辑中';
    $('save-state').className = 'dirty';
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => saveCurrent(), 300);
  }

  async function saveCurrent() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    if (!Store.state.dirty || !Store.state.currentFile || !Store.state.workspaceDir) return;
    Store.state.saving = true;
    $('save-state').textContent = '保存中';
    $('save-state').className = 'saving';
    try {
      const content = window.HHEditor.getValue();
      await window.hugomd.files.write(Store.state.workspaceDir, Store.state.currentFile.path, content);
      Store.state.dirty = false;
      const files = await window.hugomd.files.list(Store.state.workspaceDir);
      Store.state.files = files;
      window.HHSidebar.setFiles(files);
      $('save-state').textContent = '已保存';
      $('save-state').className = 'saved';
      window.HHPreview.scheduleReload(Store.state.currentFile.path);
    } catch (e) {
      $('save-state').textContent = '保存失败';
      $('save-state').className = 'dirty';
      window.HHDialogs.toast({ message: '保存失败: ' + window.HHerrMsg(e), type: 'error' });
    } finally {
      Store.state.saving = false;
    }
  }

  function handleCursorChange(e) {
    const pos = e.position;
    const lineNumber = pos.lineNumber;
    const column = pos.column;
    $('cursor-pos').textContent = 'Ln ' + lineNumber + ', Col ' + column;
  }

  window.addEventListener('beforeunload', () => {
    if (Store.state.dirty) saveCurrent();
  });

  // ============= 启动 =============
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // ============= smoke 钩子（仅 smoke 模式下启用） =============
  if (window.location && window.location.search && window.location.search.includes('smoke=1')) {
    window.__hugomd_smoke = {
      runNewWorkspace: () => flowNewWorkspace(),
      runOpenWorkspace: () => flowOpenWorkspace(),
      getState: () => JSON.parse(JSON.stringify(Store.state)),
      async autoCreate(name) {
        const displayName = name || ('smoke-' + Date.now());
        try {
          const defaultRoot = await window.hugomd.workspace.defaultRoot();
          const fullDir = defaultRoot.replace(/[\\/]+$/, '') + '/' + displayName;
          const ws = await window.hugomd.hugo.ensure();
          const created = await window.hugomd.workspace.create({ dir: fullDir, name: displayName, theme: 'minimal' });
          await window.hugomd.settings.setMany({ lastWorkspace: created.path, lastTheme: 'minimal' });
          await openWorkspace(created.path, { silent: true });
          return {
            ok: true,
            path: created.path,
            state: window.__hugomd_smoke.getState(),
          };
        } catch (e) {
          return { ok: false, error: window.HHerrMsg(e), stack: (e.stack || '').split('\n')[0] };
        }
      },
    };
    console.warn('[hugomd-smoke] hooks installed:', Object.keys(window.__hugomd_smoke).join(', '));
  }
})();
