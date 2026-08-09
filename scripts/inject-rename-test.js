'use strict';
// 渲染层执行：验证重命名通过 IPC 正常，不报 "An object could not be cloned"
(async () => {
  const log1 = (...a) => console.warn('[rename-test]', ...a);
  const hooks = window.__hugomd_smoke;
  if (!hooks || !hooks.autoCreate) return { error: 'no smoke hooks' };

  const created = await hooks.autoCreate('rn-' + Date.now());
  if (!created || !created.ok) return { error: 'autoCreate failed', created };
  const wsDir = created.path;
  log1('workspace:', wsDir);

  const files = await window.hugomd.files.list(wsDir);
  log1('files:', JSON.stringify(files));
  if (files.length === 0) return { error: 'no files' };
  const target = files[0];

  try {
    const r = await window.hugomd.files.rename(wsDir, target.path, 'renamed-' + Date.now());
    log1('rename OK:', JSON.stringify(r));
    return { ok: true, result: r };
  } catch (e) {
    log1('rename FAILED:', e.message);
    log1('rename FAILED stack:', e.stack);
    return { ok: false, error: e.message };
  }
})()
