'use strict';
// 完整 UI 流程：点加号新建文章 -> 检查列表；点铅笔重命名 -> 检查
(async () => {
  const log1 = (...a) => console.warn('[ui-flow]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const hooks = window.__hhapp_smoke;
  if (!hooks || !hooks.autoCreate) return { error: 'no smoke hooks' };

  // 1. 创建工作区
  const created = await hooks.autoCreate('uiflow-' + Date.now());
  if (!created || !created.ok) return { error: 'autoCreate failed', created };
  const wsDir = created.path;
  log1('workspace:', wsDir);
  await sleep(1500);

  // 2. 检查侧边栏是否显示 welcome
  const items0 = $$('#file-list li').filter(li => !li.classList.contains('empty'));
  log1('sidebar items after open:', items0.length, items0.map(li => li.textContent));

  // 3. 点加号（btn-new-post）
  const addBtn = $('#btn-new-post');
  if (!addBtn) return { error: 'no add button' };
  addBtn.click();
  log1('clicked add button');
  await sleep(600);

  // 4. prompt 弹窗出现，填名字
  let modal = null;
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    modal = $('.modal-backdrop .modal');
    if (modal) break;
  }
  if (!modal) return { error: 'prompt modal did not appear', sidebar: items0.map(li => li.textContent) };
  log1('prompt modal appeared:', modal.textContent.slice(0, 50));
  const input = modal.querySelector('input');
  if (!input) return { error: 'prompt input not found' };
  input.value = 'new-article';
  log1('typed new-article');
  await sleep(200);

  // 5. 点"创建"按钮
  const okBtn = $$('.modal-footer button').find(b => b.textContent.includes('创建') || b.textContent.includes('确定'));
  if (!okBtn) return { error: 'ok button not found' };
  okBtn.click();
  log1('clicked create');
  await sleep(2000);

  // 6. 检查列表是否新增
  const items1 = $$('#file-list li').filter(li => !li.classList.contains('empty'));
  log1('sidebar items after create:', items1.length, items1.map(li => li.textContent));
  const names = items1.map(li => li.textContent);

  // 7. 点铅笔重命名 new-article
  const targetLi = items1.find(li => li.textContent.includes('new-article'));
  if (!targetLi) return { ok: false, error: 'new-article not in sidebar', names };

  // 找到铅笔按钮并点击（hover 才显示，直接 trigger）
  const renameBtn = targetLi.querySelector('button[data-act="rename"]');
  if (!renameBtn) return { ok: false, error: 'no rename button', names };
  renameBtn.click();
  log1('clicked rename button');
  await sleep(600);

  // 等待重命名 modal 出现
  let modal2 = null;
  for (let i = 0; i < 15; i++) {
    await sleep(200);
    modal2 = $('.modal-backdrop .modal');
    if (modal2) break;
  }
  if (!modal2) return { ok: false, error: 'rename modal did not appear', names };

  log1('rename modal appeared:', modal2.textContent.slice(0, 50));
  const input2 = modal2.querySelector('input');
  if (!input2) return { ok: false, error: 'rename input not found' };
  input2.value = 'renamed-article';
  log1('typed renamed-article');
  await sleep(200);
  const okBtn2 = $$('.modal-footer button').find(b => b.textContent.includes('确定') || b.textContent.includes('重命名'));
  if (!okBtn2) return { ok: false, error: 'rename ok button not found', btns: $$('.modal-footer button').map(b => b.textContent) };
  log1('rename ok button:', JSON.stringify(okBtn2.textContent));
  okBtn2.click();
  await sleep(2000);

  const items2 = $$('#file-list li').filter(li => !li.classList.contains('empty'));
  const names2 = items2.map(li => li.textContent);
  log1('sidebar items after rename:', items2.length, names2);

  // 验证磁盘上确实重命名了
  const listFinal = await window.hh.files.list(wsDir);
  const finalPaths = listFinal.map(x => x.path);

  return {
    ok: names2.some(n => n.includes('renamed-article')) && !names2.some(n => n.includes('new-article'))
      && finalPaths.includes('posts/renamed-article/index.md'),
    afterCreate: names,
    afterRename: names2,
    finalPaths: finalPaths,
  };
})()
