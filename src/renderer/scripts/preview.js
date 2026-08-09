'use strict';

/**
 * 预览面板：管理 iframe，加载 hugo server 提供的 URL。
 * - baseURL 变化时自动重载
 * - 通过 postMessage 无法直接注入 hugo live reload 脚本到 iframe（sandbox 限制），
 *   所以采用定时轮询 + 文件保存事件触发的策略
 */

(function () {
  const Preview = {
    _frameEl: null,
    _placeholderEl: null,
    _rootEl: null,
    _currentBaseURL: null,
    _reloadTimer: null,
    _lastReloaded: 0,
    _reloadDebounceMs: 800,
    _visible: true,

    init({ frameEl, placeholderEl, rootEl }) {
      this._frameEl = frameEl;
      this._placeholderEl = placeholderEl;
      this._rootEl = rootEl;
    },

    setVisible(v) {
      this._visible = !!v;
      if (this._rootEl) {
        this._rootEl.style.display = this._visible ? '' : 'none';
      }
    },

    setBaseURL(baseURL, currentDocPath) {
      this._currentBaseURL = baseURL;
      if (!baseURL) {
        this._frameEl.style.display = 'none';
        this._placeholderEl.style.display = 'flex';
        this._placeholderEl.querySelector('p').textContent = 'hugo server 未运行。';
        return;
      }
      this._frameEl.style.display = '';
      this._placeholderEl.style.display = 'none';
      this._loadIntoFrame(currentDocPath);
    },

    _targetURL(docPath) {
      if (!this._currentBaseURL) return null;
      if (docPath) {
        // 渲染当前文档：
        //   裸帖  posts/foo.md       -> /posts/foo/
        //   bundle posts/xxx/index.md -> /posts/xxx/
        let cleaned = String(docPath).replace(/^content\//, '');
        if (cleaned.endsWith('index.md')) {
          cleaned = cleaned.replace(/index\.md$/, '');
        } else {
          cleaned = cleaned.replace(/\.md$/, '/');
        }
        return `${this._currentBaseURL}/${cleaned}`;
      }
      return `${this._currentBaseURL}/`;
    },

    _loadIntoFrame(docPath) {
      const url = this._targetURL(docPath);
      if (!url) return;
      this._lastReloaded = Date.now();
      this._frameEl.src = url;
    },

    /**
     * 文档保存后调用，防抖刷新预览。
     */
    scheduleReload(docPath) {
      if (!this._currentBaseURL) return;
      if (this._reloadTimer) clearTimeout(this._reloadTimer);
      this._reloadTimer = setTimeout(() => {
        this._loadIntoFrame(docPath);
        this._showFlash('刷新中…');
      }, this._reloadDebounceMs);
    },

    _showFlash(text) {
      const existing = this._rootEl.querySelector('.preview-loading');
      if (existing) existing.remove();
      const el = document.createElement('div');
      el.className = 'preview-loading';
      el.textContent = text;
      this._rootEl.appendChild(el);
      setTimeout(() => el.remove(), 1500);
    },
  };

  window.HHPreview = Preview;
})();
