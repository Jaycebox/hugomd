'use strict';
// 真实 UI：点删除 -> 确认弹窗 -> 点"取消" -> 帖子不应被删除
(async () => {
  const log1 = (...a) => console.warn('[del-test]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const hooks = window.__hhapp_smoke;
  if (!hooks || !hooks.autoCreate) return { error: 'no smoke hooks' };

  const created = await hooks.autoCreate('del-' + Date.now());
  if (!created || !created.ok) return { error: 'autoCreate failed' };
  const wsDir = created.path;
  await sleep(1200);

  // 侧边栏当前只有 welcome.md
  const items0 = $$('#file-list li').filter(li => !li.classList.contains('empty'));
  log1('items before:', items0.length, items0.map(li => li.textContent));

  // 点 welcome 的删除按钮
  const targetLi = items0.find(li => li.textContent.includes('welcome'));
  if (!targetLi) return { error: 'welcome not in sidebar' };
  const delBtn = targetLi.querySelector('button[data-act="delete"]');
  if (!delBtn) return { error: 'no delete button' };
  delBtn.click();
  log1('clicked delete button');
  await sleep(500);

  // 确认弹窗出现
  let modal = null;
  for (let i = 0; i < 15; i++) {
    await sleep(200);
    modal = $('.modal-backdrop .modal');
    if (modal) break;
  }
  if (!modal) return { error: 'confirm modal did not appear' };
  log1('confirm modal appeared:', modal.textContent.slice(0, 60));

  // 点"取消"按钮（非删除）
  const cancelBtn = $$('.modal-footer button').find(b => b.textContent.includes('取消'));
  if (!cancelBtn) return { error: 'no cancel button', btns: $$('.modal-footer button').map(b => b.textContent) };
  log1('clicking cancel');
  cancelBtn.click();
  await sleep(1200);

  // 检查 welcome 是否还在
  const items1 = $$('#file-list li').filter(li => !li.classList.contains('empty'));
  const stillThere = items1.some(li => li.textContent.includes('welcome'));
  log1('items after cancel:', items1.length, items1.map(li => li.textContent));
  log1('welcome still there:', stillThere);

  // 磁盘上检查
  const files = await window.hh.files.list(wsDir);
  const onDisk = files.some(x => x.name.includes('welcome'));
  log1('on disk:', onDisk);

  return { ok: stillThere && onDisk, onDisk, sidebarCount: items1.length };
})()
