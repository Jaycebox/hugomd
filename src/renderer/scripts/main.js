'use strict';

/**
 * hhAPP 渲染层主入口。
 * 职责：
 *   1. 初始化 Monaco、Sidebar、Preview
 *   2. 监听菜单事件
 *   3. 编排：工作区切换 / 文件加载保存 / hugo server 启停 / 预览刷新
 */

(function () {
  const $ = (id) => document.getElementById(id);
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
      window.HHDialogs.toast({ message: '编辑器初始化失败: ' + e.message, type: 'error', duration: 5000 });
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
  }

  function bindMenuEvents() {
    window.hh.menu.on((action) => {
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
    window.hh.hugo.onDownloadProgress((p) => {
      if (p.stage === 'start') {
        window.HHDialogs.toast({ message: '开始下载 Hugo: ' + p.url, duration: 4000 });
      } else if (p.stage === 'progress') {
        const pct = Math.round((p.received / p.total) * 100);
        setStatus('下载 Hugo: ' + pct + '%');
      } else if (p.stage === 'done') {
        setStatus('Hugo 下载完成');
      }
    });
    window.hh.server.onEvent((ev) => {
      if (ev.type === 'state') {
        Store.state.server = { state: ev.state, baseURL: ev.baseURL, port: ev.port };
        renderServerStatus();
        if (ev.state === 'running' && ev.baseURL) {
          window.HHPreview.setBaseURL(ev.baseURL, Store.state.currentFile && Store.state.currentFile.path);
        } else if (ev.state === 'stopped' || ev.state === 'crashed' || ev.state === 'error') {
          window.HHPreview.setBaseURL(null);
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
    else if (s === 'error' || s === 'crashed') { text = 'hugo 出错'; el.classList.add('error'); }
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
    const all = await window.hh.settings.getAll();
    if (all.lastWorkspace && await window.hh.workspace.exists(all.lastWorkspace)) {
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
    const defaultRoot = await window.hh.workspace.defaultRoot();
    const settings = await window.hh.settings.getAll();
    const result = await window.HHDialogs.newWorkspace({
      defaultRoot,
      themes: ['minimal', 'terminal', 'paper'],
      defaultTheme: settings.lastTheme || 'minimal',
      existingNames: (await window.hh.workspace.list()).map(w => w.name),
    });
    if (!result) return;
    try {
      const ws = await window.hh.hugo.ensure();
      Store.state.hugo = { source: ws.path, version: ws.version };
      const created = await window.hh.workspace.create(result);
      await window.hh.settings.setMany({ lastWorkspace: created.path, lastTheme: result.theme });
      await openWorkspace(created.path, { silent: true });
      window.HHDialogs.toast({ message: '已创建工作区: ' + created.name, type: 'success' });
    } catch (e) {
      window.HHDialogs.toast({ message: '创建失败: ' + e.message, type: 'error', duration: 5000 });
    }
  }

  async function flowOpenWorkspace() {
    const res = await window.hh.workspace.pickExisting();
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
      const files = await window.hh.files.list(dir);
      Store.state.files = files;
      window.HHSidebar.setFiles(files);
      $('editor-empty').style.display = 'none';
      $('editor-container').style.display = '';
      $('editor-status').style.display = '';
      if (files.length > 0) {
        await openFile(files[0]);
      } else {
        window.HHEditor.setValue('');
        $('doc-path').textContent = '';
        $('save-state').textContent = '已保存';
      }
      const ws = await window.hh.hugo.ensure();
      Store.state.hugo = { source: ws.path, version: ws.version };
      try {
        await window.hh.server.start(dir, { draft: true });
        setStatus('hugo server 已在 ' + ws.path + ' 启动');
      } catch (e) {
        window.HHDialogs.toast({ message: 'hugo server 启动失败: ' + e.message, type: 'error', duration: 5000 });
        setStatus('hugo 启动失败');
      }
      if (!silent) window.HHDialogs.toast({ message: '已打开: ' + Store.state.workspaceName, type: 'success' });
    } catch (e) {
      window.HHDialogs.toast({ message: '打开失败: ' + e.message, type: 'error', duration: 5000 });
    }
  }

  async function closeCurrentWorkspace() {
    try { await window.hh.server.stop(); } catch (_) { /* noop */ }
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
    renderWorkspaceName();
  }

  async function flowSettings() {
    const status = await window.hh.hugo.status();
    await window.HHDialogs.settings({ hugoStatus: status });
  }

  function togglePreview() {
    Store.state.previewVisible = !Store.state.previewVisible;
    document.querySelector('.main').classList.toggle('no-preview', !Store.state.previewVisible);
    window.HHPreview.setVisible(Store.state.previewVisible);
  }

  function revealWorkspace() {
    if (Store.state.workspaceDir) window.hh.workspace.reveal(Store.state.workspaceDir);
  }

  // ============= 文件流程 =============

  async function openFile(file) {
    if (Store.state.dirty && Store.state.currentFile) {
      await saveCurrent();
    }
    try {
      const result = await window.hh.files.read(Store.state.workspaceDir, file.path);
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
      window.HHDialogs.toast({ message: '读取失败: ' + e.message, type: 'error' });
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
      const created = await window.hh.files.create(Store.state.workspaceDir, baseName);
      const files = await window.hh.files.list(Store.state.workspaceDir);
      Store.state.files = files;
      window.HHSidebar.setFiles(files);
      const newFile = files.find(f => f.path === created.path);
      if (newFile) await openFile(newFile);
    } catch (e) {
      window.HHDialogs.toast({ message: '创建失败: ' + e.message, type: 'error' });
    }
  }

  async function deleteFile(file) {
    if (!Store.state.workspaceDir) return;
    try {
      await window.hh.files.delete(Store.state.workspaceDir, file.path);
      const files = await window.hh.files.list(Store.state.workspaceDir);
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
      window.HHDialogs.toast({ message: '删除失败: ' + e.message, type: 'error' });
    }
  }

  async function renameFile(file, newName) {
    if (!Store.state.workspaceDir) return;
    try {
      const result = await window.hh.files.rename(Store.state.workspaceDir, file.path, newName);
      const files = await window.hh.files.list(Store.state.workspaceDir);
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
      window.HHDialogs.toast({ message: '重命名失败: ' + e.message, type: 'error' });
    }
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
      await window.hh.files.write(Store.state.workspaceDir, Store.state.currentFile.path, content);
      Store.state.dirty = false;
      const files = await window.hh.files.list(Store.state.workspaceDir);
      Store.state.files = files;
      window.HHSidebar.setFiles(files);
      $('save-state').textContent = '已保存';
      $('save-state').className = 'saved';
      window.HHPreview.scheduleReload(Store.state.currentFile.path);
    } catch (e) {
      $('save-state').textContent = '保存失败';
      $('save-state').className = 'dirty';
      window.HHDialogs.toast({ message: '保存失败: ' + e.message, type: 'error' });
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
})();
