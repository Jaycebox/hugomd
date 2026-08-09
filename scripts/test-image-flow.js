'use strict';

// UI 全链路：真实 electron 中
//  1. 创建 bundle 帖子
//  2. 侧边栏显示 bundle 标识 + 图片数
//  3. 通过 IPC 上传图片、读取、插入正文
// 验证用户能"管理图片和 md 文档"。

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(os.tmpdir(), 'hugomd-image-smoke');
if (fs.existsSync(userData)) fs.rmSync(userData, { recursive: true, force: true });

const proc = spawn(electronPath, ['.', '--enable-logging'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    HHAPP_SMOKE_RENDERER: '1',
    HHAPP_SMOKE: 'image-flow',
    HHAPP_USER_DATA: userData,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stderr.on('data', (d) => process.stderr.write('ERR: ' + d));

(async () => {
  await new Promise((r) => setTimeout(r, 18000));
  proc.kill();
  process.exit(0);
})();
