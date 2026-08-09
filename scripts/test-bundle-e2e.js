'use strict';

// Bundle + 图片端到端：hugo server 渲染 page bundle 及其图片。

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmp = path.join(os.tmpdir(), 'hhapp-bundle-e2e');
if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, 'themes', 'minimal'), { recursive: true });
fs.cpSync(path.join(__dirname, '..', 'src', 'resources', 'themes', 'minimal'),
          path.join(tmp, 'themes', 'minimal'), { recursive: true });
const toml = fs.readFileSync(path.join(__dirname, '..', 'src', 'resources', 'scaffolds', 'hugo.toml'), 'utf8')
  .replace('${SITE_NAME}', 'e2e').replace('${THEME}', 'minimal');
fs.writeFileSync(path.join(tmp, 'hugo.toml'), toml);

// 建 bundle 帖子 + 图片
const bundleDir = path.join(tmp, 'content', 'posts', 'my-post');
fs.mkdirSync(bundleDir, { recursive: true });
fs.writeFileSync(path.join(bundleDir, 'index.md'),
  '---\ntitle: Bundle Post\ndate: 2026-01-01\ndraft: false\n---\n\n# Bundle Post\n\nText with image:\n\n![](sunset.jpg)');
fs.writeFileSync(path.join(bundleDir, 'sunset.jpg'), Buffer.from([255, 216, 255, 224, 0, 1, 2, 3]));

const proc = spawn('hugo', [
  'server', '-s', tmp, '--port', '14535', '--bind', '127.0.0.1', '--watch', '--noHTTPCache', '--disableFastRender',
], { stdio: ['ignore', 'pipe', 'pipe'] });
proc.stderr.on('data', (d) => process.stderr.write('ERR: ' + d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(5000);
  const r1 = await fetch('http://127.0.0.1:14535/');
  const homeText = await r1.text();
  console.log('Home:', r1.status, 'hasBundlePost:', homeText.includes('Bundle Post'));

  const r2 = await fetch('http://127.0.0.1:14535/posts/my-post/');
  const postText = await r2.text();
  const img = (postText.match(/<img[^>]*>/g) || []);
  console.log('Post:', r2.status, 'imgTags:', JSON.stringify(img));

  const r3 = await fetch('http://127.0.0.1:14535/posts/my-post/sunset.jpg');
  console.log('Image:', r3.status, 'bytes:', (await r3.arrayBuffer()).byteLength);

  // 验证列表页出现 bundle 帖
  const listOk = homeText.includes('Bundle Post');
  const postOk = img.length > 0 && img[0].includes('sunset.jpg');
  const imgOk = r3.status === 200;
  console.log('\nRESULT:', listOk && postOk && imgOk ? 'ALL PASS' : 'FAIL');
  console.log(JSON.stringify({ listOk, postOk, imgOk }));

  proc.kill();
  process.exit(0);
})();
