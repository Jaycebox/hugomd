'use strict';

/**
 * Monaco 编辑器封装。
 * - 使用 monaco 官方 AMD loader，路径指向本地 vendor
 * - 性能：关闭 worker（用 null 模式），在 Electron 内足够快
 * - 自动保存：停写 600ms 后触发 onChange 回调
 */

(function () {
  const SAVE_DEBOUNCE_MS = 600;

  const Editor = {
    _monaco: null,
    _editor: null,
    _model: null,
    _onChangeCallback: null,
    _onCursorCallback: null,
    _saveTimer: null,
    _disposed: false,

    /**
     * 初始化 monaco loader。
     * 必须等待此 resolve 后才能创建编辑器。
     */
    init() {
      return new Promise((resolve, reject) => {
        if (!window.require) {
          reject(new Error('Monaco loader.js 未加载'));
          return;
        }
        window.require.config({ paths: { vs: 'vendor/monaco/vs' } });
        window.MonacoEnvironment = {
          getWorkerUrl: function () {
            return 'vendor/monaco/vs/base/worker/workerMain.js';
          },
        };
        window.require(['vs/editor/editor.main'], () => {
          this._monaco = window.monaco;
          this._monaco.editor.onDidCreateGrammarProvider = () => {};
          resolve();
        });
      });
    },

    /**
     * 挂载到容器。container 必须是已显示的 DOM 元素。
     */
    mount(container, initialContent) {
      if (!this._monaco) throw new Error('Editor.init() 未完成');
      this._disposed = false;
      this._editor = this._monaco.editor.create(container, {
        value: initialContent || '',
        language: 'markdown',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, "Microsoft YaHei Mono", monospace',
        lineNumbers: 'on',
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        wrappingIndent: 'same',
        tabSize: 2,
        insertSpaces: true,
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        padding: { top: 16, bottom: 16 },
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      });

      this._model = this._editor.getModel();
      this._model.onDidChangeContent(() => this._scheduleSave());
      this._editor.onDidChangeCursorPosition((e) => {
        if (this._onCursorCallback) this._onCursorCallback(e);
      });
    },

    _scheduleSave() {
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => {
        if (this._disposed) return;
        if (this._onChangeCallback) {
          this._onChangeCallback(this._editor.getValue());
        }
      }, SAVE_DEBOUNCE_MS);
    },

    setValue(content) {
      if (!this._editor) return;
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
      }
      if (this._editor.getValue() === content) return;
      this._editor.setValue(content);
    },

    getValue() {
      return this._editor ? this._editor.getValue() : '';
    },

    focus() {
      if (this._editor) this._editor.focus();
    },

    insertText(text) {
      if (!this._editor) return;
      const selection = this._editor.getSelection();
      this._editor.executeEdits('hhapp', [{ range: selection, text: text, forceMoveMarkers: true }]);
      this._editor.focus();
    },

    onChange(cb) { this._onChangeCallback = cb; },
    onCursor(cb) { this._onCursorCallback = cb; },

    dispose() {
      this._disposed = true;
      if (this._saveTimer) clearTimeout(this._saveTimer);
      if (this._editor) {
        this._editor.dispose();
        this._editor = null;
        this._model = null;
      }
    },
  };

  window.HHEditor = Editor;
})();
