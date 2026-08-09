'use strict';
// 渲染层执行：模拟 Ctrl+V 粘贴截图（ClipboardEvent + DataTransfer）
// 验证: 事件被拦截(defaultPrevented) -> 自动保存到帖子目录 -> 光标处插入 ![](ref)
// 由主进程 executeJavaScript(fs.readFileSync(...)) 调用。
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const log1 = (...a) => console.warn('[paste-test]', ...a);

  const hooks = window.__hhapp_smoke;
  if (!hooks || !hooks.autoCreate) return { error: 'no smoke hooks' };

  const created = await hooks.autoCreate('paste-' + Date.now());
  if (!created || !created.ok) return { error: 'autoCreate failed', created };
  const wsDir = created.path;

  const state = hooks.getState();
  const current = state.currentFile; // autoCreate 后打开的是 welcome.md
  if (!current) return { error: 'no current file after open', state };
  log1('current file:', current.path);

  // 构造剪贴板图片粘贴事件（1x1 PNG）
  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bytes = Uint8Array.from(atob(png1x1), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
  const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  document.dispatchEvent(evt);
  const defaultPrevented = evt.defaultPrevented;
  log1('paste defaultPrevented:', defaultPrevented);

  // 等待自动保存 + 引用插入（保存有 300ms debounce，轮询最多 20s）
  let contentHasRef = false;
  let ref = '';
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const content = (await window.hh.files.read(wsDir, current.path)).content;
      const m = content.match(/!\[\]\((截图-[^)]+)\)/);
      if (m) { contentHasRef = true; ref = m[1]; break; }
    } catch (_) { /* 文件可能尚未写入 */ }
  }
  log1('ref found:', ref, '| contentHasRef:', contentHasRef);

  const imgs = await window.hh.files.listImages(wsDir, current.path);
  log1('images after paste:', JSON.stringify(imgs));

  const ok = !!defaultPrevented && !!contentHasRef && imgs.length === 1 && imgs[0].ref === ref;
  return {
    ok,
    defaultPrevented,
    ref,
    images: imgs.length,
    contentHasRef,
    workspace: wsDir,
  };
})()
