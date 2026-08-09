'use strict';
// 渲染层执行：创建 bundle 帖子 -> 上传图片 -> 读取 -> 插入引用
// 由主进程 executeJavaScript(fs.readFileSync(...)) 调用。
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const log1 = (...a) => console.warn('[image-flow]', ...a);

  const hooks = window.__hugomd_smoke;
  if (!hooks || !hooks.autoCreate) return { error: 'no smoke hooks' };

  const created = await hooks.autoCreate('img-' + Date.now());
  if (!created || !created.ok) return { error: 'autoCreate failed', created };
  const wsDir = created.path;
  log1('workspace:', wsDir);

  const files = await window.hugomd.files.list(wsDir);
  log1('files:', JSON.stringify(files));

  const post = await window.hugomd.files.create(wsDir, 'photo-post');
  log1('created post:', JSON.stringify(post));
  if (!post.isBundle) return { error: 'expected bundle', post };

  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const saved = await window.hugomd.files.saveImage(wsDir, { postPath: post.path, fileName: 'pic.png', dataBase64: png1x1 });
  log1('saved image:', JSON.stringify(saved));

  const imgs = await window.hugomd.files.listImages(wsDir, post.path);
  log1('images:', JSON.stringify(imgs));
  if (imgs.length !== 1) return { error: 'expected 1 image', imgs };

  const rd = await window.hugomd.files.readImage(wsDir, imgs[0].path);
  log1('read image mime:', rd.mime, 'len:', rd.data.length);
  if (rd.mime !== 'image/png') return { error: 'wrong mime', rd };

  await window.hugomd.files.write(wsDir, post.path, '---\ntitle: Photo Post\n---\n\n![](pic.png)');
  const back = await window.hugomd.files.read(wsDir, post.path);
  log1('post content contains img ref:', back.content.includes('![](pic.png)'));

  return {
    ok: imgs.length === 1 && rd.mime === 'image/png' && back.content.includes('![](pic.png)'),
    workspace: wsDir,
    images: imgs,
    postContent: back.content,
  };
})()
