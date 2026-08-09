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
    _modal({ title, contentHtml, footerButtons = [], onBeforeClose = null }) {
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
          // 在 DOM 移除前同步回调（用于读取表单值）
          if (onBeforeClose) {
            try { onBeforeClose(); } catch (e) { console.error('[hhAPP-modal] onBeforeClose failed:', e); }
          }
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
        // 在 DOM 被移除前缓存输入值（_modal 的 close() 会 remove backdrop，
        // 之后再 getElementById 会拿到 null）
        let cachedValue = defaultValue;
        const readInput = () => {
          const el = document.getElementById(inputId);
          if (el) cachedValue = el.value.trim();
        };
        this._modal({
          title,
          contentHtml,
          footerButtons: [
            { label: cancelText, value: null },
            { label: okText, className: 'btn-primary', value: '__ok__' },
          ],
          onBeforeClose: readInput,
        }).then((v) => {
          if (v === '__ok__') {
            resolve(cachedValue || null);
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
        // 在 DOM 被移除前缓存表单值（_modal 的 close() 会 remove backdrop）
        let cachedName = '';
        let cachedDir = defaultRoot || '';

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

        // 包装 _modal：点"创建"时先同步读取表单值（DOM 还在），再让 _modal close。
        // 通过改 _modal 的返回 Promise resolve 前调用的钩子不可行（close 已 remove），
        // 所以这里用 readForm 在点击发生瞬间同步缓存。
        const readForm = () => {
          const nameEl = document.getElementById('nw-name');
          const dirEl = document.getElementById('nw-dir');
          cachedName = nameEl ? nameEl.value.trim() : '';
          cachedDir = dirEl ? dirEl.value.trim() : cachedDir;
          return cachedName;
        };

        this._modal({
          title: '新建工作区',
          contentHtml,
          footerButtons: [
            { label: '取消', value: null },
            { label: '创建', className: 'btn-primary', value: '__create__' },
          ],
          onBeforeClose: readForm,
        }).then((v) => {
          cleanup();
          if (v !== '__create__') { resolve(null); return; }
          const name = cachedName;
          const dir = cachedDir;
          if (!name) { this.toast({ message: '请输入工作区名称', type: 'error' }); resolve(null); return; }
          if (existingNames.includes(name)) { this.toast({ message: '已存在同名工作区', type: 'error' }); resolve(null); return; }
          const fullDir = dir.endsWith(name) ? dir : `${dir.replace(/[\\/]+$/, '')}/${name}`;
          resolve({ dir: fullDir, name, theme: selectedTheme });
        });

        setTimeout(() => {
          document.getElementById('nw-pick').addEventListener('click', async (e) => {
            e.stopPropagation();
            const dirInput = document.getElementById('nw-dir');
            try {
              const picked = await window.hh.workspace.pickDir();
              if (picked) {
                selectedDir = picked;
                if (dirInput) dirInput.value = picked;
              } else {
                this.toast({ message: '未选择目录，仍将使用默认位置', type: 'info' });
              }
            } catch (err) {
              console.error('[hhAPP] pickDir failed:', err);
              this.toast({ message: '选择目录失败: ' + window.HHerrMsg(err), type: 'error' });
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
              this.toast({ message: '下载失败: ' + window.HHerrMsg(e), type: 'error' });
            }
          });
        }, 30);
      });
    },

    /**
     * 图片管理对话框。
     * opts: { workspaceDir, postPath, onInsert }
     * onInsert(ref) 在用户点"插入"时回调，把引用写进正文。
     */
    async images({ workspaceDir, postPath, onInsert }) {
      return new Promise((resolve) => {
        let images = [];

        const renderGrid = () => {
          const grid = document.getElementById('img-grid');
          if (!grid) return;
          grid.innerHTML = '';
          if (images.length === 0) {
            grid.innerHTML = '<div style="color:var(--fg-muted);font-size:12px;padding:8px;">还没有图片，点上方或拖入图片上传。</div>';
            return;
          }
          for (const img of images) {
            const card = document.createElement('div');
            card.className = 'image-card';
            card.innerHTML = `
              <img class="img-thumb" src="${escapeAttr('data:image/svg+xml')}" data-imgpath="${escapeAttr(img.path)}" alt="">
              <div class="img-meta" title="${escapeAttr(img.ref)}">${escapeHtml(img.ref)}</div>
              <div class="img-actions">
                <button data-act="insert" title="插入到正文">插入</button>
                <button data-act="delete" title="删除">删除</button>
              </div>
            `;
            const thumb = card.querySelector('.img-thumb');
            // 异步加载真实缩略图
            window.hh.files.readImage(workspaceDir, img.path).then((r) => {
              if (r && r.data) thumb.src = `data:${r.mime};base64,${r.data}`;
            }).catch(() => {});
            card.addEventListener('click', async (e) => {
              const act = e.target.dataset && e.target.dataset.act;
              if (act === 'insert') {
                if (onInsert) await onInsert(img.ref);
                this.toast({ message: '已插入: ' + img.ref, type: 'success' });
              } else if (act === 'delete') {
                const ok = await this.confirm({
                  title: '删除图片', message: `确定删除 "${img.ref}"？`, okText: '删除', okClass: 'btn-danger',
                });
                if (ok) {
                  await window.hh.files.deleteImage(workspaceDir, img.path);
                  images = images.filter(i => i.path !== img.path);
                  renderGrid();
                }
              }
            });
            grid.appendChild(card);
          }
        };

        const contentHtml = `
          <div style="font-size:12px;color:var(--fg-muted);margin-bottom:8px;">
            图片会保存到当前帖子的目录（与 index.md 同位置），正文用 ![](图片名) 引用即可。
          </div>
          <div class="upload-zone" id="upload-zone">
            <span>点击选择图片 或 拖拽到此处（上传即复制到帖子目录）</span>
            <input type="file" id="img-file-input" accept="image/*" multiple>
          </div>
          <div class="image-grid" id="img-grid"></div>
        `;

        this._modal({
          title: '上传 / 管理图片',
          contentHtml,
          footerButtons: [{ label: '关闭', value: null }],
        }).then(() => {
          // 关闭对话框时移除粘贴刷新监听
          window.removeEventListener('hhapp:image-saved', onImageSaved);
          resolve();
        });

        const loadImages = async () => {
          try {
            images = await window.hh.files.listImages(workspaceDir, postPath);
            renderGrid();
          } catch (e) {
            this.toast({ message: '读取图片失败: ' + window.HHerrMsg(e), type: 'error' });
          }
        };

        // 编辑器里粘贴截图保存成功后自动刷新列表
        const onImageSaved = () => loadImages();
        window.addEventListener('hhapp:image-saved', onImageSaved);

        setTimeout(() => {
          loadImages();
          const zone = document.getElementById('upload-zone');
          const fileInput = document.getElementById('img-file-input');
          if (!zone || !fileInput) return;

          const uploadFiles = async (fileList) => {
            for (const file of Array.from(fileList || [])) {
              const reader = new FileReader();
              reader.onload = async () => {
                try {
                  const base64 = String(reader.result).split(',')[1];
                  await window.hh.files.saveImage(workspaceDir, { postPath, fileName: file.name, dataBase64: base64 });
                  this.toast({ message: '已上传: ' + file.name, type: 'success' });
                  await loadImages();
                } catch (e) {
                  this.toast({ message: '上传失败: ' + window.HHerrMsg(e), type: 'error' });
                }
              };
              reader.readAsDataURL(file);
            }
          };

          zone.addEventListener('click', () => fileInput.click());
          zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--accent-2)'; });
          zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
          zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.style.borderColor = '';
            uploadFiles(e.dataTransfer.files);
          });
          fileInput.addEventListener('change', () => { uploadFiles(fileInput.files); fileInput.value = ''; });
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
