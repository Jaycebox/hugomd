'use strict';

/**
 * 弹窗 / Toast / Confirm / Prompt / 自定义表单。
 * 所有方法返回 Promise。
 */

(function () {
  const Dialogs = {
    /**
     * 通用弹窗 builder。
     * opts: { title, contentHtml, footerButtons: [{label, className, value}], onClose }
     * 返回 Promise，resolve 用户点击的按钮 value，或 null（点 X / 背景）。
     */
    _modal({ title, contentHtml, footerButtons = [] }) {
      return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        const buttonsHtml = footerButtons.map((b, i) =>
          `<button class="btn ${b.className || ''}" data-idx="${i}">${escapeHtml(b.label)}</button>`
        ).join('');
        backdrop.innerHTML = `
          <div class="modal" role="dialog" aria-modal="true">
            <div class="modal-header">
              <h2>${escapeHtml(title)}</h2>
              <button class="modal-close" data-act="close">×</button>
            </div>
            <div class="modal-body">${contentHtml}</div>
            ${footerButtons.length ? `<div class="modal-footer">${buttonsHtml}</div>` : ''}
          </div>
        `;
        const close = (value) => {
          backdrop.remove();
          resolve(value);
        };
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop) close(null);
          else if (e.target.dataset.act === 'close') close(null);
          else if (e.target.dataset.idx !== undefined) {
            close(footerButtons[Number(e.target.dataset.idx)].value);
          }
        });
        document.body.appendChild(backdrop);
      });
    },

    alert({ title = '提示', message = '' }) {
      return this._modal({
        title,
        contentHtml: `<p>${escapeHtml(message)}</p>`,
        footerButtons: [{ label: '好', className: 'btn-primary', value: true }],
      });
    },

    confirm({ title = '确认', message = '', okText = '确定', cancelText = '取消', okClass = 'btn-primary' }) {
      return this._modal({
        title,
        contentHtml: `<p>${escapeHtml(message)}</p>`,
        footerButtons: [
          { label: cancelText, value: false },
          { label: okText, className: okClass, value: true },
        ],
      }).then((v) => v === true);
    },

    prompt({ title = '输入', message = '', defaultValue = '', okText = '确定', cancelText = '取消' }) {
      const inputId = 'hh-prompt-' + Math.random().toString(36).slice(2, 8);
      const contentHtml = `
        <div class="form-row">
          <label for="${inputId}">${escapeHtml(message)}</label>
          <input type="text" id="${inputId}" value="${escapeAttr(defaultValue)}" autofocus />
        </div>
      `;
      return new Promise((resolve) => {
        this._modal({
          title,
          contentHtml,
          footerButtons: [
            { label: cancelText, value: null },
            { label: okText, className: 'btn-primary', value: '__ok__' },
          ],
        }).then((v) => {
          if (v === '__ok__') {
            const el = document.getElementById(inputId);
            resolve(el ? el.value.trim() : null);
          } else {
            resolve(null);
          }
        });
        setTimeout(() => {
          const el = document.getElementById(inputId);
          if (el) { el.focus(); el.select(); }
        }, 30);
      });
    },

    /**
     * 新建工作区对话框
     * resolve({ dir, name, theme }) 或 null
     */
    async newWorkspace({ defaultRoot, themes, defaultName, defaultTheme, existingNames = [] }) {
      return new Promise((resolve) => {
        let selectedDir = defaultRoot;
        let selectedTheme = defaultTheme || themes[0];

        const renderThemes = () => themes.map((t) => `
          <div class="theme-card ${t === selectedTheme ? 'selected' : ''}" data-theme="${t}">
            <div class="theme-preview ${t}">${t}</div>
            <div class="theme-name">${themeDisplayName(t)}</div>
          </div>
        `).join('');

        const contentHtml = `
          <div class="form-row">
            <label>工作区名称</label>
            <input type="text" id="nw-name" value="${escapeAttr(defaultName || '')}" placeholder="my-blog" autofocus />
            <div class="hint">用作站点标题</div>
          </div>
          <div class="form-row">
            <label>保存位置</label>
            <div style="display:flex; gap:8px;">
              <input type="text" id="nw-dir" value="${escapeAttr(selectedDir)}" readonly />
              <button class="btn" id="nw-pick">📂 选择…</button>
            </div>
            <div class="hint">该目录下会自动创建 &lt;工作区名称&gt; 文件夹</div>
          </div>
          <div class="form-row">
            <label>主题</label>
            <div class="theme-grid">${renderThemes()}</div>
          </div>
        `;

        const cleanup = () => {
          document.removeEventListener('click', themeClickHandler);
        };

        const themeClickHandler = (e) => {
          const card = e.target.closest('.theme-card');
          if (!card) return;
          selectedTheme = card.dataset.theme;
          document.querySelectorAll('.theme-card').forEach((c) => c.classList.toggle('selected', c.dataset.theme === selectedTheme));
        };

        this._modal({
          title: '新建工作区',
          contentHtml,
          footerButtons: [
            { label: '取消', value: null },
            { label: '创建', className: 'btn-primary', value: '__create__' },
          ],
        }).then((v) => {
          cleanup();
          if (v !== '__create__') { resolve(null); return; }
          const name = document.getElementById('nw-name').value.trim();
          const dir = document.getElementById('nw-dir').value.trim();
          if (!name) { this.toast({ message: '请输入工作区名称', type: 'error' }); resolve(null); return; }
          if (existingNames.includes(name)) { this.toast({ message: '已存在同名工作区', type: 'error' }); resolve(null); return; }
          const fullDir = dir.endsWith(name) ? dir : `${dir.replace(/[\\/]+$/, '')}/${name}`;
          resolve({ dir: fullDir, name, theme: selectedTheme });
        });

        setTimeout(() => {
          document.getElementById('nw-pick').addEventListener('click', async () => {
            const picked = await window.hh.workspace.pickDir();
            if (picked) {
              selectedDir = picked;
              document.getElementById('nw-dir').value = picked;
            }
          });
          document.addEventListener('click', themeClickHandler);
        }, 30);
      });
    },

    /**
     * 设置面板
     */
    async settings({ current, hugoStatus }) {
      return new Promise((resolve) => {
        const statusHtml = `
          <div class="hugo-status">
            <span class="label">当前来源：</span>
            <span class="source-tag">${hugoStatus.source}</span>
            <span class="value">${hugoStatus.manualPath || (hugoStatus.userBinExists ? 'embedded' : 'path')}</span>
          </div>
        `;
        const contentHtml = `
          <div class="form-row">
            <label>Hugo 可执行文件路径（留空使用默认查找顺序）</label>
            <div style="display:flex; gap:8px;">
              <input type="text" id="set-hugo-path" value="${escapeAttr(hugoStatus.manualPath || '')}" placeholder="留空 = 自动" />
              <button class="btn" id="set-pick">📂</button>
              <button class="btn" id="set-clear">清除</button>
            </div>
            <div class="hint">优先使用此路径；否则使用内置二进制，再否则用 PATH 中的 hugo</div>
          </div>
          <div class="form-row">
            <label>Hugo 状态</label>
            ${statusHtml}
            <button class="btn" id="set-download">⬇ 下载/重新下载 Hugo</button>
          </div>
        `;
        this._modal({
          title: '设置',
          contentHtml,
          footerButtons: [
            { label: '关闭', value: null },
          ],
        }).then(() => { resolve(); });

        setTimeout(() => {
          document.getElementById('set-pick').addEventListener('click', async () => {
            const p = await window.hh.hugo.pickPath();
            if (p) document.getElementById('set-hugo-path').value = p;
          });
          document.getElementById('set-clear').addEventListener('click', () => {
            document.getElementById('set-hugo-path').value = '';
          });
          document.getElementById('set-download').addEventListener('click', async () => {
            try {
              this.toast({ message: '开始下载 Hugo…', type: 'info' });
              await window.hh.hugo.ensure();
              this.toast({ message: 'Hugo 下载完成', type: 'success' });
            } catch (e) {
              this.toast({ message: '下载失败：' + e.message, type: 'error' });
            }
          });
        }, 30);
      });
    },

    /**
     * 底部 toast
     */
    toast({ message, type = 'info', duration = 2500 }) {
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      el.textContent = message;
      document.body.appendChild(el);
      setTimeout(() => {
        el.style.transition = 'opacity 0.2s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 200);
      }, duration);
    },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function themeDisplayName(t) {
    return ({ minimal: '极简', terminal: '终端', paper: '纸质' })[t] || t;
  }

  window.HHDialogs = Dialogs;
})();
