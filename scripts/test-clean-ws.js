'use strict';

// 验证新架构：干净工作区（只含 markdown）+ 站点模板分离
// 1. 创建干净工作区（posts/ + .hhapp.json）
// 2. 生成站点模板（userData/site-template/<theme>）
// 3. 用 -s template -c workspace 启动 hugo server
// 4. 验证渲染 /posts/ 路径和 bundle 图片

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hhapp-clean-flow-'));
const ws = path.join(tmp, 'myblog');          // 工作区（纯 markdown）
const userData = path.join(tmp, 'userdata');  // 模拟 userData
fs.mkdirSync(userData, { recursive: true });

const SettingsStore = require('../src/main/settings');
const HugoManager = require('../src/main/hugo/manager');
const WorkspaceManager = require('../src/main/workspace/manager');
const FileService = require('../src/main/files/service');

const settings = new SettingsStore(path.join(userData, 'settings.json'));
const hugo = new HugoManager({ userDataDir: userData, resourcesDir: path.join(__dirname, '..', 'src', 'resources'), settings });
const wm = new WorkspaceManager({ hugo, settings });
const files = new FileService();

const checks = [];
const check = (name, pass, extra) => {
  checks.push({ name, pass, extra });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

(async () => {
  await hugo.init();

  // 1. 创建干净工作区
  const created = await wm.create({ dir: ws, name: 'myblog', theme: 'minimal' });
  const wsEntries = fs.readdirSync(ws);
  check('工作区只有 posts + .hhapp.json',
    wsEntries.every(e => e === 'posts' || e === '.hhapp.json'),
    JSON.stringify(wsEntries));
  check('工作区无主题/配置', !wsEntries.includes('themes') && !wsEntries.includes('hugo.toml'));
  check('posts/welcome.md 存在', fs.existsSync(path.join(ws, 'posts', 'welcome.md')));

  // 2. 站点模板在 userData，不含工作区内容
  const template = await wm.ensureSiteTemplate('minimal');
  check('站点模板存在', fs.existsSync(path.join(template, 'hugo.toml')));
  check('站点模板有主题', fs.existsSync(path.join(template, 'themes', 'minimal', 'layouts')));
  check('站点模板不含工作区内容', !fs.existsSync(path.join(template, 'posts', 'welcome.md')));

  // 3. 建一个 bundle 帖 + 图片
  const post = await files.create(ws, 'photo-post');
  await files.saveImage(ws, post.path, 'pic.png', Buffer.from([1, 2, 3, 4]));
  await files.write(ws, post.path, '---\ntitle: Photo\ndraft: false\n---\n\n![](pic.png)');
  // welcome.md 默认 draft:true，改成非 draft 以便首页可见
  await files.write(ws, 'posts/welcome.md', '---\ntitle: Hello\ndraft: false\n---\n\n# Hi');
  check('bundle 帖路径正确', post.path === 'posts/photo-post/index.md', post.path);

  // 4. 用 -s template -c ws 启动 hugo server
  const bin = await hugo.resolve();
  const port = 14540;
  const proc = spawn(bin, ['server', '-s', template, '-c', ws, '--port', String(port), '--bind', '127.0.0.1', '--watch', '--noHTTPCache', '--disableFastRender', '--buildDrafts'], { cwd: template, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => process.stderr.write('HERR: ' + d));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  await sleep(5000);

  const r1 = await fetch(`http://127.0.0.1:${port}/`);
  const home = await r1.text();
  check('首页列出帖子', home.includes('Photo') && home.includes('Hello'), r1.status);

  const r2 = await fetch(`http://127.0.0.1:${port}/posts/photo-post/`);
  const postHtml = await r2.text();
  const img = (postHtml.match(/<img[^>]*>/g) || []);
  check('bundle 图片相对路径解析', img.some(t => t.includes('pic.png')), JSON.stringify(img));

  const r3 = await fetch(`http://127.0.0.1:${port}/posts/photo-post/pic.png`);
  check('图片可访问', r3.status === 200);

  proc.kill();
  await sleep(300);

  const failed = checks.filter(c => !c.pass);
  console.log(`\n${failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED'}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
