'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const FileService = require('../src/main/files/service');

const svc = new FileService();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hhapp-file-test-'));
const ws = path.join(tmp, 'ws');

const checks = [];
const check = (name, pass, extra) => {
  checks.push({ name, pass, extra });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  await svc.ensurePostsDir(ws);

  // 1. 创建 bundle 帖子
  const created = await svc.create(ws, 'my-post');
  check('create 返回 bundle path', created.isBundle === true && created.path === 'posts/my-post/index.md', created.path);
  check('index.md 存在', fs.existsSync(path.join(ws, 'posts', 'my-post', 'index.md')));

  // 2. 列表识别 bundle
  const list1 = await svc.list(ws);
  check('list 识别为 bundle', list1.length === 1 && list1[0].isBundle === true, JSON.stringify(list1[0]));

  // 3. 保存图片到 bundle
  const img = await svc.saveImage(ws, created.path, 'photo.png', Buffer.from([1, 2, 3, 4]));
  check('saveImage 返回 ref', img.ref === 'photo.png' && img.path === 'posts/my-post/photo.png', img.path);
  check('图片文件已写', fs.existsSync(path.join(ws, 'posts', 'my-post', 'photo.png')));

  // 4. 列图片
  const imgs = await svc.listImages(ws, created.path);
  check('listImages 找到图片', imgs.length === 1 && imgs[0].ref === 'photo.png', JSON.stringify(imgs.map(i => i.ref)));

  // 5. 读图片 base64
  const rd = await svc.readImage(ws, 'posts/my-post/photo.png');
  check('readImage 返回 base64', rd.mime === 'image/png' && rd.data === Buffer.from([1, 2, 3, 4]).toString('base64'), rd.mime);

  // 6. 非图片文件拒绝保存
  try { await svc.saveImage(ws, created.path, 'note.txt', Buffer.from('x')); check('保存非图片应拒绝', false, '未拒绝'); }
  catch (e) { check('保存非图片应拒绝', e.message.includes('不支持的图片格式'), e.message); }

  // 7. 重命名图片
  const ren = await svc.renameImage(ws, 'posts/my-post/photo.png', 'pic2.jpg');
  check('renameImage 更新路径', ren.newPath === 'posts/my-post/pic2.jpg', ren.newPath);
  check('旧文件已删', !fs.existsSync(path.join(ws, 'posts', 'my-post', 'photo.png')));

  // 8. 删除图片
  await svc.deleteImage(ws, 'posts/my-post/pic2.jpg');
  const imgs2 = await svc.listImages(ws, created.path);
  check('删除图片后为空', imgs2.length === 0);

  // 9. 重命名 bundle（整个目录）
  const renPost = await svc.rename(ws, created.path, 'renamed-post');
  check('rename bundle 目录', renPost.newPath === 'posts/renamed-post/index.md', renPost.newPath);
  check('旧 bundle 目录已删', !fs.existsSync(path.join(ws, 'posts', 'my-post')));

  // 10. 删除 bundle（整个目录）
  await svc.delete(ws, renPost.newPath);
  const list2 = await svc.list(ws);
  check('删除 bundle 后列表为空', list2.length === 0);

  // 11. 裸 MD 兼容：写入一个裸帖
  await svc.write(ws, 'posts/plain.md', '# plain');
  const list3 = await svc.list(ws);
  check('兼容裸 MD 帖子', list3.length === 1 && list3[0].isBundle === false, JSON.stringify(list3[0]));

  const failed = checks.filter(c => !c.pass);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
