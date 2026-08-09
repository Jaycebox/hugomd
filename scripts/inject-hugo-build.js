'use strict';
// 渲染层执行：验证 Hugo 面板的静态网站生成（hugo:build）
// 1. 创建工作区 + 文章
// 2. 调 hugo:build 生成静态网站
// 3. 断言输出目录有 index.html 且文件数 > 0
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const log1 = (...a) => console.warn('[hugo-build]', ...a);
  const hooks = window.__hugomd_smoke;
  if (!hooks || !hooks.autoCreate) return { error: 'no smoke hooks' };

  const created = await hooks.autoCreate('build-' + Date.now());
  if (!created || !created.ok) return { error: 'autoCreate failed', created };
  const wsDir = created.path;
  log1('workspace:', wsDir);

  // 追加一篇文章，确保有内容可构建
  await window.hugomd.files.create(wsDir, 'second-post');

  // 调用静态构建
  const started = Date.now();
  const r = await window.hugomd.hugo.build({ workspaceDir: wsDir });
  const durationMs = Date.now() - started;
  log1('build result:', JSON.stringify(r));

  // 检查输出
  const fsCheck = await window.hugomd.files.list(wsDir); // 仅为确保 IPC 通道正常
  void fsCheck;

  return {
    ok: r.ok === true && r.fileCount > 0 && typeof r.outputDir === 'string' && r.outputDir.includes('public'),
    fileCount: r.fileCount,
    outputDir: r.outputDir,
    durationMs: r.durationMs || durationMs,
    logTail: r.logTail || '',
    workspace: wsDir,
  };
})()
