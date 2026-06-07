'use strict';

/**
 * 侧边栏文件列表。
 * 负责：
 *   - 列出工作区下 content/posts/*.md
 *   - 点击切换文件
 *   - 新建 / 删除 / 重命名（通过回调通知主入口）
 */

(function () {
  const Sidebar = {
    _listEl: null,
    _onSelect: null,     // (file) => void
    _onCreate: null,     // () => void  (来自 header 的 + 按钮)
    _onReveal: null,     // () => void
    _onDelete: null,     // (file) => Promise<void>
    _onRename: null,     // (file, newName) => Promise<void>
    _active: null,
    _files: [],

    init({ listEl, onSelect, onCreate, onDelete, onRename, onReveal }) {
      this._listEl = listEl;
      this._onSelect = onSelect;
      this._onCreate = onCreate;
      this._onDelete = onDelete;
      this._onRename = onRename;
      this._onReveal = onReveal;
    },

    setFiles(files) {
      this._files = files || [];
      this._render();
    },

    setActive(filePath) {
      this._active = filePath;
      this._render();
    },

    _render() {
      const ul = this._listEl;
      ul.innerHTML = '';
      if (this._files.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '还没有笔记';
        ul.appendChild(li);
        return;
      }
      for (const f of this._files) {
        const li = document.createElement('li');
        if (f.path === this._active) li.classList.add('active');
        li.dataset.path = f.path;
        li.innerHTML = `
          <span class="file-icon">📄</span>
          <span class="file-name" title="${escapeAttr(f.path)}">${escapeHtml(stripMdExt(f.name))}</span>
          <span class="file-actions">
            <button data-act="rename" title="重命名">✎</button>
            <button data-act="delete" title="删除">×</button>
          </span>
        `;
        li.addEventListener('click', (e) => {
          const act = e.target.dataset && e.target.dataset.act;
          if (act === 'delete') {
            e.stopPropagation();
            this._handleDelete(f);
          } else if (act === 'rename') {
            e.stopPropagation();
            this._handleRename(f);
          } else {
            if (this._onSelect) this._onSelect(f);
          }
        });
        ul.appendChild(li);
      }
    },

    async _handleDelete(f) {
      if (!this._onDelete) return;
      const ok = window.HHDialogs.confirm({
        title: '删除笔记',
        message: `确定删除 "${stripMdExt(f.name)}"？此操作不可撤销。`,
        okText: '删除',
        okClass: 'btn-danger',
      });
      if (!ok) return;
      await this._onDelete(f);
    },

    async _handleRename(f) {
      if (!this._onRename) return;
      const newName = window.HHDialogs.prompt({
        title: '重命名笔记',
        message: '输入新文件名（不含 .md）',
        defaultValue: stripMdExt(f.name),
        okText: '重命名',
      });
      if (!newName || newName === stripMdExt(f.name)) return;
      await this._onRename(f, newName);
    },
  };

  function stripMdExt(name) {
    return name.replace(/\.md$/i, '');
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  window.HHSidebar = Sidebar;
})();
